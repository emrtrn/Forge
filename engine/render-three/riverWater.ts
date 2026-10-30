import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  type DataTexture,
  type DataArrayTexture,
  Scene,
} from "three";

import type { ForgeLandscapeSpline, LandscapeSplinePolylineSample } from "@engine/scene/landscape";
import { splineToPolyline } from "@engine/scene/landscape";
import type {
  LayoutRiverWaterFoamStamp,
  LayoutRiverWaterSegmentProfile,
  Vec3,
} from "@engine/scene/layout";
import type { ResolvedRiverWater } from "@engine/scene/riverWater";
import { createWaterEnvironmentUniforms, updateWaterEnvironment, WATER_ENVIRONMENT_GLSL, type WaterEnvironmentProbes } from "./waterEnvironment";
import { createRiverSunShadowUniforms, updateRiverSunShadow, RIVER_SUN_SHADOW_GLSL } from "./riverSunShadow";
import { createWaterShoreMask, riverContactSegments, WATER_FOAM_GLSL, WATER_CONTACT_GLSL, createWaterContactUniforms } from "./waterFoam";
import { RiverSurfaceQuery } from "../terrain/riverSurface";
import { riverFoamSurfaceFingerprint } from "./lakeFoamBake";
import { lakeFoamTexture, LAKE_GEOMETRY_FOAM_GLSL } from "./lakeFoamTexture";
import type { LakeFoamData } from "../scene/lakeFoamBake";
import { registerRiverCaustics } from "./terrain/terrainCaustics";
import { registerRiverShoreWetness } from "./terrain/terrainShoreWetness";
import { WATER_OPTICS_GLSL } from "./waterOptics";
import { WaterFoamMaterial } from "./waterFoamMaterial";
import { LAKE_SURFACE_GLSL } from "./lakeSurface";

export { resolveRiverWater, RIVER_WATER_DEFAULTS, uniqueRiverWaterId, type ResolvedRiverWater } from "@engine/scene/riverWater";

/** Pure ribbon arrays, kept inspectable for engine tests without a WebGL context. */
export interface RiverWaterRibbonData {
  bedDepths: number[];
  positions: number[];
  uvs: number[];
  flowDirections: number[];
  shoreDistances: number[];
  waterDepths: number[];
  rapidness: number[];
  foamMasks: number[];
  flowSpeedMultipliers: number[];
  indices: number[];
}

export interface BuildRiverWaterRibbonOptions {
  /** Height at the first authored point; the ribbon follows spline Y from there. */
  surfaceLevel: number;
  widthScale: number;
  /** Maximum centreline spacing in world units. */
  sampleSpacing?: number;
  /** World units represented by one U repeat of the normal texture. */
  normalTileLength?: number;
  /** Optional Landscape data used to bake shallow/deep water into the ribbon. */
  /** Exact bed height in ribbon-local coordinates; null clips real terrain holes. */
  heightAt?: (x: number, z: number) => number | null;
  /** Legacy strip data is accepted for saved-layout compatibility, but ignored. */
  foamStamps?: readonly LayoutRiverWaterFoamStamp[];
  /** Per-segment flow/rapid overrides keyed by the Landscape spline segment id. */
  segmentProfiles?: readonly LayoutRiverWaterSegmentProfile[];
}

interface RiverPolylineSample extends LandscapeSplinePolylineSample {
  segmentId: string;
}

interface RiverSample extends RiverPolylineSample {
  distance: number;
}

const EPSILON = 1e-5;
const DEFAULT_SAMPLE_SPACING = 1.25;
const DEFAULT_NORMAL_TILE_LENGTH = 3;
const MAX_RIVER_VERTICES = 1_048_576;

/**
 * Resolves the common directed Landscape-spline case into continuous chains.
 * Branches become independent strips in the same geometry until the dedicated
 * junction/flow-map phase supplies a junction patch.
 */
function riverChains(spline: ForgeLandscapeSpline, sampleSpacing: number): RiverSample[][] {
  const piecesBySegment = new Map<string, RiverPolylineSample[]>();
  for (const sub of splineToPolyline(spline, 24)) {
    const pieces = piecesBySegment.get(sub.segment.id) ?? [];
    if (pieces.length === 0) pieces.push({ ...sub.start, segmentId: sub.segment.id });
    const dx = sub.end.position[0] - sub.start.position[0];
    const dy = sub.end.position[1] - sub.start.position[1];
    const dz = sub.end.position[2] - sub.start.position[2];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / sampleSpacing));
    if (pieces.length + steps > MAX_RIVER_VERTICES) throw new Error("River Water exceeds the ribbon vertex budget");
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      pieces.push({
        position: [sub.start.position[0] + dx * t, sub.start.position[1] + dy * t, sub.start.position[2] + dz * t],
        width: sub.start.width + (sub.end.width - sub.start.width) * t,
        falloff: sub.start.falloff + (sub.end.falloff - sub.start.falloff) * t,
        segmentId: sub.segment.id,
      });
    }
    piecesBySegment.set(sub.segment.id, pieces);
  }

  const outgoing = new Map<string, typeof spline.segments>();
  const incoming = new Set<string>();
  for (const segment of spline.segments) {
    const list = outgoing.get(segment.startPointId) ?? [];
    list.push(segment);
    outgoing.set(segment.startPointId, list);
    incoming.add(segment.endPointId);
  }
  const starts = spline.segments.filter((segment) => !incoming.has(segment.startPointId));
  const pending = [...starts, ...spline.segments];
  const used = new Set<string>();
  const chains: RiverSample[][] = [];
  for (const seed of pending) {
    if (used.has(seed.id)) continue;
    const samples: RiverPolylineSample[] = [];
    let segment: typeof spline.segments[number] | undefined = seed;
    while (segment && !used.has(segment.id)) {
      used.add(segment.id);
      const piece = piecesBySegment.get(segment.id) ?? [];
      samples.push(...(samples.length === 0 ? piece : piece.slice(1)));
      segment = (outgoing.get(segment.endPointId) ?? []).find((next) => !used.has(next.id));
    }
    if (samples.length < 2) continue;
    let distance = 0;
    chains.push(samples.map((sample, index) => {
      if (index > 0) {
        const previous = samples[index - 1]!.position;
        distance += Math.hypot(sample.position[0] - previous[0], sample.position[1] - previous[1], sample.position[2] - previous[2]);
      }
      return { ...sample, distance };
    }));
  }
  return chains;
}

/** Builds a spline ribbon with arc-length UVs and per-vertex flow data. */
export function buildRiverWaterRibbon(
  spline: ForgeLandscapeSpline,
  options: BuildRiverWaterRibbonOptions,
): RiverWaterRibbonData {
  const bedDepths: number[] = [];
  const positions: number[] = [];
  const uvs: number[] = [];
  const flowDirections: number[] = [];
  const shoreDistances: number[] = [];
  const waterDepths: number[] = [];
  const rapidness: number[] = [];
  const foamMasks: number[] = [];
  const flowSpeedMultipliers: number[] = [];
  const indices: number[] = [];
  const valid: boolean[] = [];
  // Strip Foam has been retired. Keep the legacy data loadable, but do not
  // allocate mask resolution or render it into newly built river ribbons.
  const sampleSpacing = Math.max(options.heightAt ? 0.001 : 0.25, options.sampleSpacing ?? DEFAULT_SAMPLE_SPACING);
  const width = options.heightAt ? Math.max(5, Math.ceil(spline.points.reduce((max, point) => Math.max(max, point.width), 0)
    * options.widthScale * 2 / sampleSpacing) + 1) : 5;
  const tileLength = Math.max(EPSILON, options.normalTileLength ?? DEFAULT_NORMAL_TILE_LENGTH);
  const profiles = new Map((options.segmentProfiles ?? []).map((profile) => [profile.splineSegmentRef, profile]));
  const referenceHeight = spline.points[0]?.position[1] ?? 0;
  let vertexBase = 0;
  for (const chain of riverChains(spline, sampleSpacing)) {
    if (positions.length / 3 + chain.length * width > MAX_RIVER_VERTICES) throw new Error("River Water exceeds the ribbon vertex budget");
    for (let index = 0; index < chain.length; index += 1) {
      const sample = chain[index]!;
      const previous = chain[Math.max(0, index - 1)]!;
      const next = chain[Math.min(chain.length - 1, index + 1)]!;
      const dx = next.position[0] - previous.position[0];
      const dz = next.position[2] - previous.position[2];
      const length = Math.hypot(dx, dz) || 1;
      const flowX = dx / length;
      const flowZ = dz / length;
      const previousDx = sample.position[0] - previous.position[0];
      const previousDz = sample.position[2] - previous.position[2];
      const nextDx = next.position[0] - sample.position[0];
      const nextDz = next.position[2] - sample.position[2];
      const previousLength = Math.hypot(previousDx, previousDz) || 1;
      const nextLength = Math.hypot(nextDx, nextDz) || 1;
      const turn = 1 - Math.max(-1, Math.min(1, (previousDx * nextDx + previousDz * nextDz) / (previousLength * nextLength)));
      const slope = Math.abs(next.position[1] - previous.position[1]) / Math.max(length, EPSILON);
      const localRapidness = Math.min(1, turn * 1.5 + slope * 0.75);
      const profile = profiles.get(sample.segmentId);
      const segmentRapidness = Math.max(localRapidness, profile?.rapidness ?? 0);
      const flowSpeedMultiplier = profile?.flowSpeedMultiplier ?? 1;
      const sideX = -flowZ;
      const sideZ = flowX;
      // Keep the saved start height while preserving the spline's elevation
      // changes, including curved samples and independently chained branches.
      const surfaceHeight = options.surfaceLevel + (sample.position[1] - referenceHeight);
      for (let lateral = 0; lateral < width; lateral += 1) {
        const v = lateral / (width - 1);
        const offset = (v - 0.5) * 2 * sample.width * options.widthScale;
        const x = sample.position[0] + sideX * offset;
        const z = sample.position[2] + sideZ * offset;
        positions.push(x, surfaceHeight, z);
        uvs.push(sample.distance / tileLength, v);
        flowDirections.push(flowX, flowZ);
        shoreDistances.push(Math.abs(v - 0.5) * 2);
        const terrainHeight = options.heightAt ? options.heightAt(x, z) : surfaceHeight - 1;
        valid.push(terrainHeight !== null);
        bedDepths.push(terrainHeight === null ? 0 : surfaceHeight - terrainHeight);
        waterDepths.push(terrainHeight === null ? 0 : Math.max(0, surfaceHeight - terrainHeight));
        rapidness.push(segmentRapidness);
        foamMasks.push(0);
        flowSpeedMultipliers.push(flowSpeedMultiplier);
      }
    }
    for (let row = 0; row < chain.length - 1; row += 1) {
      for (let lateral = 0; lateral < width - 1; lateral += 1) {
        const a = vertexBase + row * width + lateral;
        const b = a + width;
        if (valid[a] && valid[b] && valid[a + 1]) indices.push(a, b, a + 1);
        if (valid[b] && valid[b + 1] && valid[a + 1]) indices.push(b, b + 1, a + 1);
      }
    }
    vertexBase += chain.length * width;
  }
  return { bedDepths, positions, uvs, flowDirections, shoreDistances, waterDepths, rapidness, foamMasks, flowSpeedMultipliers, indices };
}

const VERTEX_SHADER = `
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec2 flowDirection;
attribute float shoreDistance;
attribute float waterDepth;
attribute float rapidness;
attribute float foamMask;
attribute float flowSpeedMultiplier;
varying vec3 vContactPosition;
varying vec2 vContactFlow;
varying vec2 vRiverUv;
varying float vShoreDistance;
varying float vWaterDepth;
varying float vRapidness;
varying float vFoamMask;
varying float vFlowSpeedMultiplier;
varying vec3 vWorldPosition;
varying vec3 vFlowTangent;
uniform float time;
uniform float flowSpeed;
uniform float waveAmplitude;
uniform float waveLength;
void main() {
  vContactPosition = position;
  vContactFlow=flowDirection;
  vRiverUv = uv;
  vShoreDistance = shoreDistance;
  vWaterDepth = waterDepth;
  vRapidness = rapidness;
  vFoamMask = foamMask;
  vFlowSpeedMultiplier = flowSpeedMultiplier;
  float centreWeight = pow(max(0.0, 1.0 - shoreDistance), 1.6);
  float wavePhase = uv.x * 6.283185 / max(waveLength, 0.01) - time * flowSpeed * flowSpeedMultiplier * 2.0;
  float wave = sin(wavePhase) + sin(wavePhase * 1.73 + uv.y * 5.0) * 0.35;
  vec3 displaced = position;
  displaced.y += wave * waveAmplitude * centreWeight * (0.65 + rapidness * 0.35);
  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = worldPosition.xyz;
  vFlowTangent = mat3(modelMatrix) * vec3(flowDirection.x, 0.0, flowDirection.y);
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;

const FRAGMENT_SHADER = `
#include <fog_pars_fragment>
uniform sampler2D normalMap;
uniform float time;
uniform float flowSpeed;
uniform float normalScale;
uniform float hasNormal;
uniform float clipDryBed;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform float opacity;
uniform float bedVisibility;
uniform float absorptionDistance;
uniform vec3 foamColor;
uniform float foamOpacity;
uniform float shoreWaveSpacing;
uniform float shoreWaveSpeed;
uniform float shoreWaveReach;
uniform float shoreWaveBreakupScale;
uniform sampler2D foamNoiseMap;
uniform float hasFoamNoiseMap;
uniform float reflectionStrength;
uniform float waterDetail;
varying vec3 vContactPosition;
varying vec2 vContactFlow;
varying vec2 vRiverUv;
varying float vShoreDistance;
varying float vWaterDepth;
varying float vRapidness;
varying float vFoamMask;
varying float vFlowSpeedMultiplier;
varying vec3 vWorldPosition;
varying vec3 vFlowTangent;

${WATER_OPTICS_GLSL}
${WATER_ENVIRONMENT_GLSL}
#ifdef FORGE_RIVER_LAKE_SURFACE
${LAKE_SURFACE_GLSL}
#endif
${RIVER_SUN_SHADOW_GLSL}
${WATER_FOAM_GLSL}
${WATER_CONTACT_GLSL}
${LAKE_GEOMETRY_FOAM_GLSL}
uniform float realContactEnabled;
uniform sampler2D realShoreMask;
uniform vec2 realShoreOrigin;
uniform vec2 realShoreSize;
uniform float hasRealShore;
void main() {
  // Derivatives include spline slope, vertex waves and the object's transform.
  // Evaluate them before discard so shoreline quads retain valid derivatives.
  vec3 surfaceNormal = cross(dFdx(vWorldPosition), dFdy(vWorldPosition));
  float normalLength = length(surfaceNormal);
  surfaceNormal = normalLength > 0.000001 ? surfaceNormal / normalLength : vec3(0.0, 1.0, 0.0);
  if (surfaceNormal.y < 0.0) surfaceNormal = -surfaceNormal;
  vec3 viewDirection = isOrthographic
    ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
    : cameraPosition - vWorldPosition;
  viewDirection /= max(length(viewDirection), 0.000001);
  float bankSpeed = mix(1.0, 0.38, pow(vShoreDistance, 2.0));
  vec2 advected = vec2(vRiverUv.x * 3.0 - time * flowSpeed * vFlowSpeedMultiplier * bankSpeed, vRiverUv.y * 8.0);
  vec2 warp = vec2(waterNoise(advected * 0.21), waterNoise(advected * 0.19 + vec2(9.3, 2.7))) - 0.5;
  vec2 baseUv = (advected + warp * 1.6) * normalScale * vec2(0.42, 0.7);
  vec2 normalA = texture2D(normalMap, baseUv).xy * 2.0 - 1.0;
  vec2 normalB = texture2D(normalMap, baseUv * 1.73 + vec2(0.37, 0.61) - vec2(time * flowSpeed * 0.13, 0.0)).xy * 2.0 - 1.0;
  float phase = 0.5 + 0.5 * sin(time * 0.43 + waterNoise(advected * 0.3) * 3.0);
  vec2 flowingNormal = mix(normalA, normalB, phase * waterDetail);
  // Metre-scale, broken current patches travel downstream. The normal-map
  // micro detail rides these rather than tinting the whole bed uniformly.
  vec2 currentSlope = (vec2(waterNoise(advected * vec2(0.65, 1.2) + warp * 2.0),
    waterNoise(advected * vec2(0.85, 2.1) + vec2(4.7, 8.1))) * 2.0 - 1.0) * vec2(0.24, 0.14);
  vec3 tangent = vFlowTangent - surfaceNormal * dot(vFlowTangent, surfaceNormal);
  tangent /= max(length(tangent), 0.000001);
  vec3 bitangent = cross(surfaceNormal, tangent);
  vec2 slope = flowingNormal * (0.22 + vRapidness * 0.12) + currentSlope;
  #ifdef FORGE_RIVER_LAKE_SURFACE
  // Lake micro detail travels in the River flow frame, including bank slowing.
  // Only the optical normal changes; spline elevation and vertex waves stay intact.
  slope = lakeSurfaceSlopes(advected * normalScale * 0.12, time * flowSpeed)
    * 0.10 * (1.0 + vRapidness * 0.5);
  #endif
  float slopeEnabled = hasNormal;
  #ifdef FORGE_RIVER_LAKE_SURFACE
  slopeEnabled = 1.0;
  #endif
  vec3 opticalNormal = normalize(surfaceNormal + slopeEnabled
    * (tangent * slope.x + bitangent * slope.y));
  // Derivatives precede discard, so dry-bank helper fragments do not make the
  // filtered highlights unstable. Low detail keeps the continuous GGX lobe.
  float reflectionRoughness = waterFilteredRoughness(opticalNormal, 0.38 + (1.0 - waterDetail) * 0.2);
  float sunRoughness = waterFilteredRoughness(opticalNormal, 0.28);
  #ifdef FORGE_RIVER_LAKE_SURFACE
  reflectionRoughness = waterFilteredRoughness(opticalNormal, surfaceRoughness + (1.0 - waterDetail) * 0.15);
  sunRoughness = reflectionRoughness;
  #endif
  float sunSparkle = waterSunSparkle(vWorldPosition, time, waterDetail);
  if (clipDryBed > 0.5 && vWaterDepth <= 0.001) discard;
  float viewCosine = clamp(abs(dot(opticalNormal, viewDirection)), 0.0, 1.0);
  // Air/water F0 is approximately 0.02. Strength remains an authored multiplier.
  float fresnel = waterRoughFresnel(viewCosine, reflectionRoughness);
  float depth = clamp(vWaterDepth / 2.2, 0.0, 1.0);
  // Ribbon width is not a measurement of bed depth or distance to a rock.
  float shallow = 1.0 - depth;
  float turbulence = waterNoise(advected * vec2(0.35, 1.7)) * 0.55
    + waterNoise(advected * vec2(0.67, 3.4) + vec2(7.3, 1.2)) * 0.45;
  vec3 color = mix(deepColor, shallowColor, shallow) * (0.84 + turbulence * 0.32);
  float sunVisibility = riverSunVisibility();
  color *= waterSurfaceLight(opticalNormal, viewDirection, 0.38, sunVisibility);
  vec2 foamUv = vec2(
    vRiverUv.x * 0.78 - time * flowSpeed * vFlowSpeedMultiplier * 0.34,
    vRiverUv.y * 4.5
  ) * 1.35;
  float broadFoamNoise = waterNoise(foamUv);
  float detailFoamNoise = waterNoise(foamUv * 2.13 + vec2(7.1, 3.7));
  float foamBreakup = smoothstep(0.38, 0.70, mix(broadFoamNoise, detailFoamNoise, 0.52));
  // vShoreDistance is 1 on either bank and 0 at the centre. Move several
  // narrow wave fronts along its inverse so they visibly travel bank -> centre
  // instead of tinting the shoreline as one static border.
  float inwardDistance = 1.0 - vShoreDistance;
  vec2 shoreNoiseUv = vec2(
    vRiverUv.x * 0.38 - time * flowSpeed * vFlowSpeedMultiplier * 0.09,
    inwardDistance * 3.0
  ) * max(shoreWaveBreakupScale, 0.1);
  float textureBreakup = texture2D(foamNoiseMap, shoreNoiseUv).r;
  float shoreBreakup = mix(foamBreakup, textureBreakup, hasFoamNoiseMap);
  // The final 38% of Reach is feathered. This is intentionally fixed so Foam
  // Opacity remains the single visible foam-strength control in Details.
  float shoreFadeStart = max(0.01, shoreWaveReach * 0.62);
  float shoreZone = 1.0 - smoothstep(shoreFadeStart, max(shoreFadeStart + 0.01, shoreWaveReach), inwardDistance);
  float shorePhase = waterNoise(vec2(advected.x * 0.8, inwardDistance * shoreWaveSpacing * 4.0 - time * shoreWaveSpeed) + warp);
  float shoreBands = smoothstep(0.68, 0.88, shorePhase);
  float shallowContact = smoothstep(0.0, 0.08, vWaterDepth)
    * (1.0 - smoothstep(0.08, 0.8, vWaterDepth));
  float shoreFoam = shoreZone * shoreBands * smoothstep(0.46, 0.78, shoreBreakup) * shallowContact * 0.55;
  float brokenCrest = smoothstep(0.67, 0.88, waterNoise(advected * vec2(0.4, 3.8) + warp * 2.0))
    * smoothstep(0.42, 0.72, turbulence);
  float rapidFoam = smoothstep(0.035, 0.3, vRapidness) * brokenCrest * foamBreakup * 0.75;
  if(realContactEnabled>.5) {
    vec2 shoreUv=(vContactPosition.xz-realShoreOrigin)/realShoreSize;
    float distanceToContact=hasRealShore>.5 ? texture2D(realShoreMask,shoreUv).r : 1.;
    shoreFoam=waterFoamPatches((vContactPosition.xz-vContactFlow/max(length(vContactFlow),.0001)*time*flowSpeed*vFlowSpeedMultiplier),
      distanceToContact,time,contactScale,contactSpeed)*hasRealShore;
  }
  float obstacleFoam=waterObstacleFoam(vContactPosition,vContactFlow,flowSpeed*vFlowSpeedMultiplier,time);
  vec2 foamFlowOffset=vContactFlow/max(length(vContactFlow),.0001)*time*flowSpeed*vFlowSpeedMultiplier;
  #ifdef FORGE_LAKE_GEOMETRY_FOAM
  obstacleFoam=lakeGeometryFoamFlow(vWorldPosition.xz,time,foamFlowOffset);
  vec2 wakeDirection=vContactFlow/max(length(vContactFlow),.0001);
  float wakeSpeed=max(0.,flowSpeed*vFlowSpeedMultiplier);
  // Three bounded downstream taps of the baked obstacle mask. No authored sources.
  for(int wake=1;wake<=3;wake++) {
    float distance=float(wake)*.65*min(2.,wakeSpeed);
    obstacleFoam=max(obstacleFoam,lakeGeometryFoamFlow(vWorldPosition.xz-wakeDirection*distance,time,foamFlowOffset-wakeDirection*distance)*(.45-float(wake)*.1)*min(1.,wakeSpeed));
  }
  #endif
  float foam = realContactEnabled>.5 ? clamp(max(shoreFoam,obstacleFoam) + rapidFoam*(1.-max(shoreFoam,obstacleFoam)), 0., 1.) : clamp(shoreFoam+rapidFoam,0.,1.);
  vec3 reflectionDirection = reflect(-viewDirection, opticalNormal);
  reflectionDirection.y = abs(reflectionDirection.y);
  vec3 reflected = min(waterReflectedEnvironment(vWorldPosition, reflectionDirection, reflectionRoughness), vec3(2.0));
  float aboveSurface = step(0.0, dot(surfaceNormal, viewDirection));
  float hasEnvironment = step(0.0001, waterEnvironmentIntensity + waterProbeIntensity);
  float reflectionAmount = clamp(reflectionStrength * (0.025 + fresnel * 0.425) * aboveSurface * hasEnvironment
    * (1.0 - foam * foamOpacity * 0.65), 0.0, 1.0);
  #ifdef FORGE_RIVER_LAKE_SURFACE
  float environmentCoverage = waterEnvironmentCoverage(vWorldPosition);
  reflected = waterReflectedEnvironment(vWorldPosition, reflectionDirection, reflectionRoughness)
    / max(environmentCoverage, 0.00001);
  reflectionAmount = clamp(reflectionStrength * fresnel * environmentCoverage, 0.0, 1.0)
    * aboveSurface * smoothstep(0.0, 0.08, vWaterDepth);
  #endif
  float wetness = smoothstep(0.0, 0.12, vWaterDepth);
  float pathDepth = waterPath(vWaterDepth, abs(dot(surfaceNormal, viewDirection)));
  float bedTransmission = waterTransmission(vWaterDepth, pathDepth, bedVisibility, absorptionDistance);
  float bedOpacity = 1.0 - bedTransmission;
  float authoredOpacity = opacity * wetness * mix(0.58, 1.0, smoothstep(0.0, 3.0, vWaterDepth));
  vec2 foamWorld=vWorldPosition.xz-foamFlowOffset;
  float materialScale=contactScale,materialSpeed=contactSpeed;
  #ifdef FORGE_LAKE_GEOMETRY_FOAM
  if(obstacleFoam>shoreFoam) { materialScale=geometryFoamScale;materialSpeed=geometryFoamSpeed; }
  #endif
  vec4 foamDetail=waterFoamReady>.5 ? waterFoamDetail(foamWorld,time,materialScale,materialSpeed) : vec4(.5);
  vec3 litFoam=waterFoamLighting(foamDetail,foam,surfaceNormal,viewDirection,foamColor,sunVisibility);
  float reflectedCoverage = reflectionAmount * wetness;
  float sunGain = smoothstep(0.03, 0.3, vWaterDepth) * 0.35;
  #ifdef FORGE_RIVER_LAKE_SURFACE
  reflectedCoverage = reflectionAmount;
  sunGain = 1.0;
  wetness = smoothstep(0.0, 0.35, vWaterDepth);
  #endif
  gl_FragColor = waterComposite(color, max(authoredOpacity, bedOpacity), reflected, reflectedCoverage,
    litFoam, foam * foamOpacity, waterSunGlint(opticalNormal, viewDirection, sunRoughness, sunVisibility)
      * sunSparkle * aboveSurface * wetness * sunGain);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface RiverWaterRenderItem extends ResolvedRiverWater {
  spline: ForgeLandscapeSpline;
  heightAt?: (x: number, z: number) => number | null;
  sampleSpacing?: number;
  position: Vec3;
  rotation: Vec3;
  /** Repeating grayscale noise used to break up inward shore-wave fronts. */
  foamNoiseMap: Texture | null;
  bakedFoam?: LakeFoamData;
  /** Existing sky/probe maps, borrowed from the owning scene. No new render pass. */
  environmentProbes?: WaterEnvironmentProbes;
}

export class RiverWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  readonly isRiverWaterObject = true;
  private readonly contactTexture: DataTexture | null;
  private readonly bakedTexture: DataArrayTexture | null;
  private readonly foamMaterial = new WaterFoamMaterial();
  private effectSurface: RiverSurfaceQuery | undefined;
  private releaseCaustics: () => void = () => {};
  private releaseShore: () => void = () => {};
  private shoreAllowed = true;
  private refreshTerrainEffects:()=>void=()=>{};
  readonly effectErrors: string[] = [];
  getSurface(): RiverSurfaceQuery { return this.effectSurface ??= new RiverSurfaceQuery(this.ribbon, [...this.position.toArray()] as Vec3); }
  private readonly ribbon: RiverWaterRibbonData;

  constructor(item: RiverWaterRenderItem, normalMap: Texture | null) {
    const ribbon = buildRiverWaterRibbon(item.spline, {
      surfaceLevel: item.surfaceLevel,
      widthScale: item.widthScale,
      ...(item.heightAt ? { heightAt: item.heightAt } : {}),
      ...(item.sampleSpacing !== undefined ? { sampleSpacing: item.sampleSpacing } : {}),
      foamStamps: item.foamStamps,
      segmentProfiles: item.segmentProfiles,
    });
    const contact = item.contactFoam?.enabled === true || !!item.geometryFoam;
    let surface: RiverSurfaceQuery | undefined;
    let bake: ReturnType<typeof lakeFoamTexture> | null = null;
    const errors:string[]=[];
    if(item.caustics?.enabled || item.shoreWetness?.enabled || (item.geometryFoam?.enabled && item.bakedFoam)) {
      try {
        surface=new RiverSurfaceQuery(ribbon,item.position);
        if(item.geometryFoam?.enabled&&item.bakedFoam?.metadata.surface==="river"&&item.bakedFoam.metadata.surfaceFingerprint===riverFoamSurfaceFingerprint(surface)) bake=lakeFoamTexture(item.bakedFoam);
      } catch(error) { errors.push(String(error)); }
    }
    const min = [Infinity,Infinity], max = [-Infinity,-Infinity];
    for(let i=0;i<ribbon.positions.length;i+=3) {
      min[0]=Math.min(min[0]!,ribbon.positions[i]!); min[1]=Math.min(min[1]!,ribbon.positions[i+2]!);
      max[0]=Math.max(max[0]!,ribbon.positions[i]!); max[1]=Math.max(max[1]!,ribbon.positions[i+2]!);
    }
    const segments=item.contactFoam?.enabled ? riverContactSegments(ribbon.positions,ribbon.bedDepths,ribbon.indices) : [];
    const contactTexture=segments.length ? createWaterShoreMask(min,max,segments,(item.contactFoam?.shoreWidth??.5)) : null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(ribbon.positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(ribbon.uvs, 2));
    geometry.setAttribute("flowDirection", new Float32BufferAttribute(ribbon.flowDirections, 2));
    geometry.setAttribute("shoreDistance", new Float32BufferAttribute(ribbon.shoreDistances, 1));
    geometry.setAttribute("waterDepth", new Float32BufferAttribute(contact ? ribbon.bedDepths : ribbon.waterDepths, 1));
    geometry.setAttribute("rapidness", new Float32BufferAttribute(ribbon.rapidness, 1));
    geometry.setAttribute("foamMask", new Float32BufferAttribute(ribbon.foamMasks, 1));
    geometry.setAttribute("flowSpeedMultiplier", new Float32BufferAttribute(ribbon.flowSpeedMultipliers, 1));
    geometry.setIndex(ribbon.indices);
    geometry.computeBoundingSphere();
    const material = new ShaderMaterial({
      defines: { ...(bake ? { FORGE_LAKE_GEOMETRY_FOAM: 1 } : {}),
        ...(item.surfaceStyle === "lake" ? { FORGE_RIVER_LAKE_SURFACE: 1 } : {}) },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...UniformsUtils.clone(UniformsLib.lights),
        ...createRiverSunShadowUniforms(),
        ...createWaterEnvironmentUniforms(),
        ...createWaterContactUniforms(item.contactFoam?{...item.contactFoam,obstacles:[]}:undefined),
        geometryFoamMask: {value:bake?.texture??null},geometryFoamMin:{value:new Vector2(...(item.bakedFoam?.metadata.min??[0,0]) as [number,number])},
        geometryFoamSize:{value:new Vector2(item.bakedFoam?item.bakedFoam.metadata.max[0]-item.bakedFoam.metadata.min[0]:1,item.bakedFoam?item.bakedFoam.metadata.max[1]-item.bakedFoam.metadata.min[1]:1)},
        geometryFoamGrid:{value:bake?.grid??new Vector2(1,1)},geometryFoamTile:{value:bake?.tile??new Vector2(1,1)},
        geometryFoamStrength:{value:item.geometryFoam?.strength??0},geometryFoamScale:{value:item.geometryFoam?.scale??.8},geometryFoamSpeed:{value:item.geometryFoam?.speed??.3},
        realContactEnabled: { value: contact ? 1 : 0 }, realShoreMask: { value: contactTexture },
        hasRealShore: { value: contactTexture ? 1 : 0 },
        realShoreOrigin: { value: new Vector2(...min as [number,number]) },
        realShoreSize: { value: new Vector2(Math.max(.001,max[0]!-min[0]!),Math.max(.001,max[1]!-min[1]!)) },
        normalMap: { value: normalMap },
        time: { value: 0 },
        flowSpeed: { value: item.flowSpeed },
        normalScale: { value: item.normalScale },
        surfaceStrength: { value: item.surfaceStrength },
        surfaceRoughness: { value: item.surfaceRoughness },
        hasNormal: { value: normalMap ? 1 : 0 },
        clipDryBed: { value: item.heightAt ? 1 : 0 },
        deepColor: { value: new Color(item.deepColor) },
        shallowColor: { value: new Color(item.shallowColor) },
        opacity: { value: item.opacity },
        bedVisibility: { value: item.bedVisibility },
        absorptionDistance: { value: item.absorptionDistance },
        waveAmplitude: { value: item.waveAmplitude },
        waveLength: { value: item.waveLength },
        foamColor: { value: new Color(item.foamColor) },
        foamOpacity: { value: item.foamOpacity },
        shoreWaveSpacing: { value: item.shoreWaveSpacing },
        shoreWaveSpeed: { value: item.shoreWaveSpeed },
        shoreWaveReach: { value: item.shoreWaveReach },
        shoreWaveBreakupScale: { value: item.shoreWaveBreakupScale },
        foamNoiseMap: { value: item.foamNoiseMap },
        hasFoamNoiseMap: { value: item.foamNoiseMap ? 1 : 0 },
        reflectionStrength: { value: item.reflectionMode === "off" ? 0 : item.reflectionStrength },
        waterDetail: { value: item.reflectionQuality === "low" ? 0 : 1 },
      },
      transparent: true,
      fog: true,
      lights: true,
      depthWrite: false,
      side: DoubleSide,
    });
    super(geometry, material);
    Object.assign(material.uniforms, this.foamMaterial.uniforms);
    this.ribbon=ribbon; this.effectSurface=surface; this.bakedTexture=bake?.texture??null;
    this.effectErrors.push(...errors);
    this.contactTexture = contactTexture;
    this.name = item.name;
    this.position.set(...item.position);
    this.rotation.set(
      (item.rotation[0] * Math.PI) / 180,
      (item.rotation[1] * Math.PI) / 180,
      (item.rotation[2] * Math.PI) / 180,
      "XYZ",
    );
    this.visible = !item.hidden;
    // Water is a visual transparent overlay: it neither writes opaque depth nor
    // casts into shadow maps/collision, leaving terrain and authored blockers as
    // their respective render/gameplay authorities.
    this.castShadow = false;
    this.receiveShadow = true;
    this.renderOrder = 1;
    this.refreshTerrainEffects=()=>{
      this.releaseShore();this.releaseShore=()=>{};this.releaseCaustics();this.releaseCaustics=()=>{};
      if(this.parent instanceof Scene && (item.caustics?.enabled || (item.shoreWetness?.enabled&&this.shoreAllowed))) {
        const water={...item,...(item.shoreWetness?{shoreWetness:{...item.shoreWetness,enabled:item.shoreWetness.enabled&&this.shoreAllowed}}:{})};
        try { this.releaseCaustics=registerRiverCaustics(this.parent,water,this.getSurface(),this); }
        catch(error) { this.effectErrors.push(String(error)); console.warn("[river-caustics]",item.id,error); return; }
        try {this.releaseShore=registerRiverShoreWetness(this.parent,water,this.getSurface(),this);}
        catch(error) {
          if(!item.caustics?.enabled){this.releaseCaustics();this.releaseCaustics=()=>{};}
          this.effectErrors.push(String(error));console.warn("[river-wet-shore]",item.id,error);
        }
      }
    };
    this.addEventListener("added",this.refreshTerrainEffects);
    this.addEventListener("removed",()=>{this.releaseShore();this.releaseShore=()=>{};this.releaseCaustics();this.releaseCaustics=()=>{};});
    this.onBeforeRender = (_renderer, scene, camera) => {
      if (scene.overrideMaterial) return;
      this.foamMaterial.update(item.foamOpacity > 0, scene, camera);
      this.material.uniforms["time"]!.value = performance.now() / 1000;
      updateRiverSunShadow(this.material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
      updateWaterEnvironment(this.material.uniforms as ReturnType<typeof createWaterEnvironmentUniforms>, scene, camera, item.environmentProbes?.());
    };
  }

  setShoreWetnessAllowed(allowed:boolean):void {
    if(this.shoreAllowed===allowed)return;
    this.shoreAllowed=allowed;this.refreshTerrainEffects();
  }

  dispose(): void {
    this.releaseShore();this.releaseShore=()=>{};
    this.foamMaterial.dispose();
    this.releaseCaustics(); this.releaseCaustics=()=>{};
    this.bakedTexture?.dispose();
    this.contactTexture?.dispose();
    for (const child of this.children) {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}

export type RiverWaterObjectLike = RiverWaterObject;

export function createRiverWaterObject(item: RiverWaterRenderItem, normalMap: Texture | null): RiverWaterObject {
  return new RiverWaterObject(item, normalMap);
}

export function disposeRiverWaterObject(object: RiverWaterObjectLike): void {
  object.dispose();
}
