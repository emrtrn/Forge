import type { WaterReflectionRegistry } from "./waterReflectionRegistry";
import { RiverPlanarSurface, createRiverPlanarUniforms, effectiveRiverReflectionQuality, RIVER_PLANAR_GLSL } from "./riverPlanarReflection";
import { createWaterCrestFoamUniforms, WATER_CREST_FOAM_GLSL } from "./waterCrestFoam";
import { FULL_LAKE_QUALITY, type LakeQuality } from "../perf/lakeQuality";
import {
  BufferGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
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
import { createWaterSceneUniforms, readWaterScene, WATER_SCENE_GLSL } from "./waterSceneSnapshot";
import { RIVER_WAVE_GLSL, RIVER_SHADING_NORMAL_GLSL, riverWaveFrames } from "./riverWaves";
import { RIVER_FLOW_GLSL } from "./riverFlow";
import { createRiverRefractionSurface, RIVER_REFRACTION_GLSL } from "./riverRefraction";

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
  /** Build-time downstream whitewater trail (rapidness carried with decay). */
  foamMasks: number[];
  /** Signed metres from the centreline, for flow-aligned foam sampling. */
  lateralOffsets: number[];
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
/** Metres over which rapid whitewater thins out downstream. */
export const RIVER_FOAM_TRAIL_LENGTH = 25;

/** Rapidness carried downstream with exponential decay: whitewater below a
 * rapid thins into trailing streaks. One pass per chain at build time; each
 * chain (including independent branches) starts without inherited foam. */
export function riverFoamTrail(distances: readonly number[], rapidness: readonly number[], length = RIVER_FOAM_TRAIL_LENGTH): number[] {
  const trail: number[] = [];
  for (let i = 0; i < rapidness.length; i += 1) {
    const carried = i > 0 ? trail[i - 1]! * Math.exp(-Math.max(0, distances[i]! - distances[i - 1]!) / Math.max(length, EPSILON)) : 0;
    trail.push(Math.max(rapidness[i]!, carried));
  }
  return trail;
}

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
  const lateralOffsets: number[] = [];
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
    const chainRapidness: number[] = [];
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
      chainRapidness.push(segmentRapidness);
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
        lateralOffsets.push(offset);
        flowSpeedMultipliers.push(flowSpeedMultiplier);
      }
    }
    for (const value of riverFoamTrail(chain.map((sample) => sample.distance), chainRapidness)) {
      for (let lateral = 0; lateral < width; lateral += 1) foamMasks.push(value);
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
  return { bedDepths, positions, uvs, flowDirections, shoreDistances, waterDepths, rapidness, foamMasks, lateralOffsets, flowSpeedMultipliers, indices };
}

const VERTEX_SHADER = `
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec4 riverPlanarWeights;
varying vec4 vRiverPlanarWeights;
attribute vec2 flowDirection;
attribute float shoreDistance;
attribute float waterDepth;
attribute float rapidness;
attribute float foamMask;
attribute float flowSpeedMultiplier;
attribute float riverLateral;
varying float vRiverLateral;
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
varying vec3 vShadingNormal;
uniform float time;
uniform float flowSpeed;
uniform float waveAmplitude;
uniform float waveLength;
varying vec2 vCrestWave;
${RIVER_WAVE_GLSL}
${RIVER_SHADING_NORMAL_GLSL}
void main() {
  vRiverPlanarWeights = riverPlanarWeights;
  vContactPosition = position;
  vContactFlow=flowDirection;
  vRiverUv = uv;
  vShoreDistance = shoreDistance;
  vWaterDepth = waterDepth;
  vRapidness = rapidness;
  vFoamMask = foamMask;
  vFlowSpeedMultiplier = flowSpeedMultiplier;
  vRiverLateral = riverLateral;
  vec3 displaced = position;
  float wave = riverVertexWave(uv, shoreDistance, rapidness, flowSpeedMultiplier, time, flowSpeed, waveAmplitude, waveLength);
  displaced.y += wave;
  // Steepness per metre; rapids whitecap at gentler slopes than a smooth glide.
  vCrestWave=vec2(wave,abs(riverVertexWaveSlope(uv, shoreDistance, rapidness, flowSpeedMultiplier, time, flowSpeed,
    waveAmplitude, waveLength, ${DEFAULT_NORMAL_TILE_LENGTH.toFixed(1)}))*(1.0+rapidness*1.5));
  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = worldPosition.xyz;
  vFlowTangent = mat3(modelMatrix) * vec3(flowDirection.x, 0.0, flowDirection.y);
  vShadingNormal = riverShadingNormal(uv, vec3(shoreDistance, rapidness, flowSpeedMultiplier));
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;

const FRAGMENT_SHADER = `
${RIVER_PLANAR_GLSL}
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
varying vec3 vShadingNormal;
varying float vRiverLateral;

${WATER_OPTICS_GLSL}
${WATER_ENVIRONMENT_GLSL}
${LAKE_SURFACE_GLSL}
${RIVER_FLOW_GLSL}
${WATER_SCENE_GLSL}
#ifdef FORGE_RIVER_REFRACTION
${RIVER_REFRACTION_GLSL}
#endif
${RIVER_SUN_SHADOW_GLSL}
${WATER_FOAM_GLSL}
${WATER_CREST_FOAM_GLSL}
${WATER_CONTACT_GLSL}
${LAKE_GEOMETRY_FOAM_GLSL}
uniform float realContactEnabled;
uniform sampler2D realShoreMask;
uniform vec2 realShoreOrigin;
uniform vec2 realShoreSize;
uniform float hasRealShore;
// Lengthwise breakup of trailing whitewater; m = metres downstream x across.
float riverFoamStreak(vec2 m) {
  return smoothstep(0.35, 0.75, waterNoise(vec2(m.x * 0.06, m.y * 0.7)) * 0.7
    + waterNoise(vec2(m.x * 0.15, m.y * 1.9) + vec2(5.2, 1.3)) * 0.3);
}
void main() {
  // Derivatives include spline slope, vertex waves and the object's transform.
  // Evaluate them before discard so shoreline quads retain valid derivatives.
  vec3 surfaceNormal = cross(dFdx(vWorldPosition), dFdy(vWorldPosition));
  float normalLength = length(surfaceNormal);
  surfaceNormal = normalLength > 0.000001 ? surfaceNormal / normalLength : vec3(0.0, 1.0, 0.0);
  if (surfaceNormal.y < 0.0) surfaceNormal = -surfaceNormal;
  // Exact face normal remains the authority for depth/refraction intersection.
  // Lighting uses shared-vertex normals, so HDR sun cannot reveal the diagonal.
  vec3 shadingNormal = normalize(vShadingNormal);
  vec3 viewDirection = isOrthographic
    ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
    : cameraPosition - vWorldPosition;
  viewDirection /= max(length(viewDirection), 0.000001);
  float bankSpeed = mix(1.0, 0.38, pow(vShoreDistance, 2.0));
  vec2 advected = vec2(vRiverUv.x * 3.0 - time * flowSpeed * vFlowSpeedMultiplier * bankSpeed, vRiverUv.y * 8.0);
  vec2 warp = vec2(waterNoise(advected * 0.21), waterNoise(advected * 0.19 + vec2(9.3, 2.7))) - 0.5;
  vec3 tangent = vFlowTangent - shadingNormal * dot(vFlowTangent, shadingNormal);
  tangent /= max(length(tangent), 0.000001);
  vec3 bitangent = cross(shadingNormal, tangent);
  // Lake micro detail travels in the River flow frame, including bank slowing.
  // Only the optical normal changes; spline elevation and vertex waves stay intact.
  vec3 flowPhases = riverFlowPhases(time, flowSpeed, 2.0);
  vec2 baseSurfaceUv = vec2(vRiverUv.x * 3.0, vRiverUv.y * 8.0);
  float localSpeed = vFlowSpeedMultiplier * bankSpeed;
  vec2 slopeA = lakeSurfaceSlopes((baseSurfaceUv - vec2(flowPhases.x * localSpeed, 0.0)) * normalScale * 0.12, time * flowSpeed);
  vec2 slopeB = lakeSurfaceSlopes((baseSurfaceUv - vec2(flowPhases.y * localSpeed, 0.0)) * normalScale * 0.12, time * flowSpeed);
  // Rapids chop harder than glides and pools.
  vec2 slope = mix(slopeB, slopeA, flowPhases.z) * 0.10 * mix(0.8, 1.6, vRapidness);
  float visibleDepth = max(vWaterDepth, 0.0);
  float visiblePath = waterPath(visibleDepth, abs(dot(surfaceNormal, viewDirection)));
  vec2 screenUv = gl_FragCoord.xy / waterSceneSize;
  if (waterSceneEnabled > 0.5) {
    vec3 bedView = waterScenePosition(screenUv, texture2D(waterSceneDepth, screenUv).r);
    vec3 surfaceView = waterScenePosition(screenUv, gl_FragCoord.z);
    vec3 column = surfaceView - bedView;
    // A local tangent plane, not the Lake's constant world-Y surface. Convert
    // normal thickness to vertical depth for authored metre-based shore bands;
    // extinction uses the actual ray length and never this vertical projection.
    float normalDepth = max(0.0, dot(column, mat3(viewMatrix) * surfaceNormal));
    visibleDepth = normalDepth / max(surfaceNormal.y, 0.05);
    visiblePath = min(length(column), 100.0);
    if (normalDepth <= 0.0) visiblePath = 0.0;
  }
  float edgeDepth = min(max(vWaterDepth, 0.0), visibleDepth);
  float edgeNoise = waterNoise(vWorldPosition.xz * 0.9 + time * vec2(0.013, -0.009));
  float shoreBlend = smoothstep(0.0, 0.12 * mix(0.85, 1.15, edgeNoise), edgeDepth);
  vec3 opticalNormal = normalize(shadingNormal + shoreBlend
    * (tangent * slope.x + bitangent * slope.y));
  // Derivatives precede discard, so dry-bank helper fragments do not make the
  // filtered highlights unstable. Low detail keeps the continuous GGX lobe.
  float reflectionRoughness = waterFilteredRoughness(opticalNormal, surfaceRoughness + (1.0 - waterDetail) * 0.15 + vRapidness * 0.06);
  float sunRoughness = reflectionRoughness;
  float sunSparkle = waterSunSparkle(vWorldPosition, time, waterDetail);
  if (clipDryBed > 0.5 && vWaterDepth <= 0.001) discard;
  float viewCosine = clamp(abs(dot(opticalNormal, viewDirection)), 0.0, 1.0);
  // Air/water F0 is approximately 0.02. Strength remains an authored multiplier.
  float fresnel = waterRoughFresnel(viewCosine, reflectionRoughness);
  vec3 color = mix(deepColor, shallowColor, exp(-visibleDepth / 2.2));
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
  if(realContactEnabled>.5) {
    vec2 shoreUv=(vContactPosition.xz-realShoreOrigin)/realShoreSize;
    float distanceToContact=hasRealShore>.5 ? texture2D(realShoreMask,shoreUv).r : 1.;
    shoreFoam=waterFoamPatches((vContactPosition.xz-vContactFlow/max(length(vContactFlow),.0001)*time*flowSpeed*vFlowSpeedMultiplier),
      distanceToContact,time,contactScale,contactSpeed)*hasRealShore;
  }
  // Baked obstacle contact as a density: thick upstream of the rock, then three
  // bounded downstream taps of the same mask for the trailing wake.
  float obstacleDensity=0.;
  #ifdef FORGE_LAKE_GEOMETRY_FOAM
  vec2 wakeDirection=vContactFlow/max(length(vContactFlow),.0001);
  float wakeSpeed=max(0.,flowSpeed*vFlowSpeedMultiplier);
  obstacleDensity=waterFoamBand(lakeGeometryFoamDistance(vWorldPosition.xz));
  for(int wake=1;wake<=3;wake++) {
    float distance=float(wake)*.65*min(2.,wakeSpeed);
    obstacleDensity=max(obstacleDensity,waterFoamBand(lakeGeometryFoamDistance(vWorldPosition.xz-wakeDirection*distance))
      *(.45-float(wake)*.1)*min(1.,wakeSpeed));
  }
  obstacleDensity*=geometryFoamStrength;
  #endif
  // One flow-aligned foam frame (metres downstream x across) for whitewater,
  // wakes and crests: streaks stretch with the current. Two overlapping
  // windows keep bank shear from stretching it without bound.
  float materialScale=contactScale;
  #ifdef FORGE_LAKE_GEOMETRY_FOAM
  if(obstacleDensity>shoreFoam) materialScale=geometryFoamScale;
  #endif
  vec3 foamPhases=riverFlowPhases(time, flowSpeed, 24.0);
  float foamAlong=vRiverUv.x*${DEFAULT_NORMAL_TILE_LENGTH.toFixed(1)};
  float foamSpeed=vFlowSpeedMultiplier*bankSpeed;
  vec2 foamFlowA=vec2(foamAlong-foamPhases.x*foamSpeed, vRiverLateral);
  vec2 foamFlowB=vec2(foamAlong-foamPhases.y*foamSpeed, vRiverLateral);
  vec4 foamDetail=waterFoamReady>.5
    ? mix(waterFoamDetailFlow(foamFlowB,materialScale,3.0),waterFoamDetailFlow(foamFlowA,materialScale,3.0),foamPhases.z)
    : vec4(mix(waterFoamFallbackPattern(foamFlowB*vec2(.33,1.)/max(materialScale,.1),vec2(0.),0.),
        waterFoamFallbackPattern(foamFlowA*vec2(.33,1.)/max(materialScale,.1),vec2(0.),0.),foamPhases.z),.5,.5,.5);
  float streaks=mix(riverFoamStreak(foamFlowB),riverFoamStreak(foamFlowA),foamPhases.z);
  // Rapids churn white; below them the build-time trail thins into streaks
  // that gather in the current rather than along the banks.
  float whitewater=smoothstep(.15,.7,vRapidness)*mix(.75,1.,streaks);
  float trailFoam=vFoamMask*streaks*mix(.45,1.,1.-vShoreDistance)*.7;
  float rapidFoam=waterFoamErosion(max(whitewater,trailFoam),foamDetail.r);
  float obstacleFoam=max(waterObstacleFoam(vContactPosition,vContactFlow,flowSpeed*vFlowSpeedMultiplier,time),
    waterFoamErosion(obstacleDensity,foamDetail.r));
  float foam = realContactEnabled>.5 ? clamp(max(shoreFoam,obstacleFoam) + rapidFoam*(1.-max(shoreFoam,obstacleFoam)), 0., 1.) : clamp(shoreFoam+rapidFoam,0.,1.);
  // Standing-wave crests break where the current streaks, not as even bars.
  float crestFoam=waterFoamErosion(waterCrestFoamDensity(min(vWaterDepth,visibleDepth))*mix(.25,1.,streaks),foamDetail.r);
  foam=max(foam,crestFoam);
  vec3 reflectionDirection = reflect(-viewDirection, opticalNormal);
  reflectionDirection.y = abs(reflectionDirection.y);
  float aboveSurface = step(0.0, dot(surfaceNormal, viewDirection));
  float environmentCoverage = waterEnvironmentCoverage(vWorldPosition);
  vec3 reflected = waterReflectedEnvironment(vWorldPosition, reflectionDirection, reflectionRoughness);
  vec4 planar = riverPlanar(vWorldPosition, slope, reflectionRoughness);
  float planarCoverage = clamp(planar.a, 0.0, 1.0);
  reflected = reflected * (1.0 - planarCoverage) + planar.rgb;
  environmentCoverage = environmentCoverage * (1.0 - planarCoverage) + planarCoverage;
  reflected /= max(environmentCoverage, 0.00001);
  float reflectionAmount = clamp(reflectionStrength * fresnel * environmentCoverage, 0.0, 1.0)
    * aboveSurface * smoothstep(0.0, 0.08, vWaterDepth);
  float wetness = smoothstep(0.0, 0.12, vWaterDepth);
  float pathDepth = waterPath(vWaterDepth, abs(dot(surfaceNormal, viewDirection)));
  float bedTransmission = waterTransmission(vWaterDepth, pathDepth, bedVisibility, absorptionDistance);
  float bedOpacity = 1.0 - bedTransmission;
  float authoredOpacity = opacity * wetness * mix(0.58, 1.0, smoothstep(0.0, 3.0, vWaterDepth));
  vec3 litFoam=waterFoamLighting(foamDetail,foam,shadingNormal,viewDirection,foamColor,sunVisibility);
  float reflectedCoverage = reflectionAmount;
  wetness = smoothstep(0.0, 0.35, vWaterDepth);
  gl_FragColor = waterComposite(color, max(authoredOpacity, bedOpacity), reflected, reflectedCoverage,
    litFoam, foam * foamOpacity, waterSunGlint(opticalNormal, viewDirection, sunRoughness, sunVisibility)
      * sunSparkle * aboveSurface * wetness);
  if (waterSceneEnabled > 0.5) {
    vec3 visibleBed = texture2D(waterSceneColor, screenUv).rgb;
    vec3 refractedBed = visibleBed;
    float refractedPath = visiblePath;
    #ifdef FORGE_RIVER_REFRACTION
    riverRefract(screenUv, opticalNormal, surfaceNormal, shadingNormal, waterScenePosition(screenUv, gl_FragCoord.z),
      edgeDepth, refractedBed, refractedPath);
    #endif
    float visibleWetness = smoothstep(0.0, 0.35, visibleDepth);
    float opacityFloor = opacity * visibleWetness * mix(0.3, 1.0, smoothstep(0.0, 3.0, visibleDepth));
    vec3 tint = deepColor / max(max(deepColor.r, deepColor.g), max(deepColor.b, 0.00001));
    vec3 extinction = (vec3(1.0) + (vec3(1.0) - tint) * 2.0) / max(absorptionDistance, 0.01);
    vec3 opticalTransmission = exp(-extinction * refractedPath);
    vec3 transmitted = min(opticalTransmission * mix(1.0, bedVisibility, visibleWetness), vec3(1.0 - opacityFloor));
    vec3 tintExtinction = extinction + vec3(1.0 / max(absorptionDistance, 0.01));
    vec3 shallowWeight = (extinction / tintExtinction) * (vec3(1.0) - exp(-tintExtinction * refractedPath))
      / max(vec3(1.0) - opticalTransmission, vec3(0.00001));
    vec3 scatter = mix(deepColor, shallowColor, clamp(shallowWeight, 0.0, 1.0));
    vec3 scatterLight = waterSurfaceLight(opticalNormal, viewDirection, reflectionRoughness, sunVisibility)
      + waterSunColor * max(dot(surfaceNormal, waterSunDirection), 0.0) * 0.318309886 * waterLightingEnabled * sunVisibility;
    vec3 body = refractedBed * transmitted + scatter * scatterLight * (vec3(1.0) - transmitted);
    float r = reflectedCoverage * smoothstep(0.0, 0.08, visibleDepth);
    vec3 radiance = mix(body, reflected, r)
      + waterSunGlint(opticalNormal, viewDirection, sunRoughness, sunVisibility)
        * sunSparkle * aboveSurface * visibleWetness;
    radiance = mix(radiance, litFoam, clamp(foam * foamOpacity, 0.0, 1.0));
    // Already contains the bed: alpha blending it again would double the bed.
    // Fade foam and the complete interface to the same visible/source boundary.
    gl_FragColor = vec4(mix(visibleBed, radiance, shoreBlend), 1.0);
  } else {
    gl_FragColor.a *= shoreBlend;
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface RiverWaterRenderItem extends ResolvedRiverWater {
  /** Transient graphics ceiling; never serialized over authored settings. */
  refractionAllowed?: boolean;
  quality?: LakeQuality;
  reflections?: WaterReflectionRegistry;
  spline: ForgeLandscapeSpline;
  heightAt?: (x: number, z: number) => number | null;
  sampleSpacing?: number;
  position: Vec3;
  rotation: Vec3;
  /** Repeating grayscale noise used to break up inward shore-wave fronts. */
  foamNoiseMap: Texture | null;
  bakedFoam?: LakeFoamData;
  loadBakedFoam?: () => Promise<LakeFoamData | undefined>;
  /** Existing sky/probe maps, borrowed from the owning scene. No new render pass. */
  environmentProbes?: WaterEnvironmentProbes;
}

export class RiverWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  readonly isRiverWaterObject = true;
  private contactTexture: DataTexture | null;
  private bakedTexture: DataArrayTexture | null;
  private qualityRevision = 0;
  private readonly foamMaterial = new WaterFoamMaterial();
  private refractionSurface: ReturnType<typeof createRiverRefractionSurface> | null = null;
  private refractionAllowed: boolean;
  private readonly authoredRefractionStrength: number;
  private readonly authoredRefractionQuality: boolean;
  private disposed = false;
  private effectSurface: RiverSurfaceQuery | undefined;
  private releaseCaustics: () => void = () => {};
  private releaseShore: () => void = () => {};
  private shoreAllowed = true;
  private quality: LakeQuality;
  private readonly item: RiverWaterRenderItem;
  private readonly planar: RiverPlanarSurface;
  private refreshTerrainEffects:()=>void=()=>{};
  readonly effectErrors: string[] = [];
  getSurface(): RiverSurfaceQuery { return this.effectSurface ??= new RiverSurfaceQuery(this.ribbon, [...this.position.toArray()] as Vec3); }
  private readonly ribbon: RiverWaterRibbonData;

  constructor(item: RiverWaterRenderItem, normalMap: Texture | null) {
    const quality = item.quality ?? FULL_LAKE_QUALITY;
    // The store owns CPU bake data. A disabled GPU consumer must not pin it.
    const bakedFoam = item.bakedFoam;
    item = { ...item }; delete item.bakedFoam;
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
    if((item.caustics?.enabled && quality.causticsAllowed) || (item.shoreWetness?.enabled && quality.shoreWetnessAllowed) || (quality.foamAllowed && item.geometryFoam?.enabled && bakedFoam)) {
      try {
        surface=new RiverSurfaceQuery(ribbon,item.position);
        if(quality.foamAllowed&&item.geometryFoam?.enabled&&bakedFoam?.metadata.surface==="river"&&bakedFoam.metadata.surfaceFingerprint===riverFoamSurfaceFingerprint(surface)) bake=lakeFoamTexture(bakedFoam);
      } catch(error) { errors.push(String(error)); }
    }
    const min = [Infinity,Infinity], max = [-Infinity,-Infinity];
    for(let i=0;i<ribbon.positions.length;i+=3) {
      min[0]=Math.min(min[0]!,ribbon.positions[i]!); min[1]=Math.min(min[1]!,ribbon.positions[i+2]!);
      max[0]=Math.max(max[0]!,ribbon.positions[i]!); max[1]=Math.max(max[1]!,ribbon.positions[i+2]!);
    }
    const segments=quality.foamAllowed && item.contactFoam?.enabled ? riverContactSegments(ribbon.positions,ribbon.bedDepths,ribbon.indices) : [];
    const contactTexture=segments.length ? createWaterShoreMask(min,max,segments,(item.contactFoam?.shoreWidth??.5)) : null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(ribbon.positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(ribbon.uvs, 2));
    geometry.setAttribute("flowDirection", new Float32BufferAttribute(ribbon.flowDirections, 2));
    geometry.setAttribute("shoreDistance", new Float32BufferAttribute(ribbon.shoreDistances, 1));
    geometry.setAttribute("waterDepth", new Float32BufferAttribute(contact ? ribbon.bedDepths : ribbon.waterDepths, 1));
    geometry.setAttribute("rapidness", new Float32BufferAttribute(ribbon.rapidness, 1));
    geometry.setAttribute("foamMask", new Float32BufferAttribute(ribbon.foamMasks, 1));
    geometry.setAttribute("riverLateral", new Float32BufferAttribute(ribbon.lateralOffsets, 1));
    geometry.setAttribute("flowSpeedMultiplier", new Float32BufferAttribute(ribbon.flowSpeedMultipliers, 1));
    geometry.setIndex(ribbon.indices);
    const waveFrames = riverWaveFrames(ribbon);
    geometry.setAttribute("riverDu", new BufferAttribute(waveFrames.du, 3));
    geometry.setAttribute("riverDv", new BufferAttribute(waveFrames.dv, 3));
    geometry.setAttribute("riverWaveDu", new BufferAttribute(waveFrames.waveDu, 3));
    geometry.setAttribute("riverWaveDv", new BufferAttribute(waveFrames.waveDv, 3));
    geometry.setAttribute("riverWaveSteps", new BufferAttribute(waveFrames.steps, 2));
    geometry.computeBoundingSphere();
    const material = new ShaderMaterial({
      defines: bake ? { FORGE_LAKE_GEOMETRY_FOAM: 1 } : {},
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...UniformsUtils.clone(UniformsLib.lights),
        ...createRiverSunShadowUniforms(),
        ...createRiverPlanarUniforms(),
        ...createWaterEnvironmentUniforms(),
        ...createWaterSceneUniforms(), ...createWaterCrestFoamUniforms(item, quality.foamAllowed),
        riverRefractionSurface: { value: null }, riverRefractionSize: { value: new Vector2(1, 1) },
        riverRefractionMin: { value: new Vector2() }, riverRefractionGrid: { value: new Vector2(1, 1) },
        riverRefractionBases: { value: new Vector3() },
        riverRefractionSpacing: { value: 1 }, riverRefractionStrength: { value: 0 },
        riverViewToLocal: { value: new Matrix4() }, riverLocalToView: { value: new Matrix4() },
        ...createWaterContactUniforms(item.contactFoam?{...item.contactFoam,obstacles:[]}:undefined),
        geometryFoamMask: {value:bake?.texture??null},geometryFoamMin:{value:new Vector2(...(bakedFoam?.metadata.min??[0,0]) as [number,number])},
        geometryFoamSize:{value:new Vector2(bakedFoam?bakedFoam.metadata.max[0]-bakedFoam.metadata.min[0]:1,bakedFoam?bakedFoam.metadata.max[1]-bakedFoam.metadata.min[1]:1)},
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
        foamOpacity: { value: quality.foamAllowed ? item.foamOpacity : 0 },
        shoreWaveSpacing: { value: item.shoreWaveSpacing },
        shoreWaveSpeed: { value: item.shoreWaveSpeed },
        shoreWaveReach: { value: item.shoreWaveReach },
        shoreWaveBreakupScale: { value: item.shoreWaveBreakupScale },
        foamNoiseMap: { value: item.foamNoiseMap },
        hasFoamNoiseMap: { value: item.foamNoiseMap ? 1 : 0 },
        reflectionStrength: { value: item.reflectionMode === "off" ? 0 : item.reflectionStrength },
        waterDetail: { value: quality.reflectionQuality === "off" || item.reflectionQuality === "low" ? 0 : 1 },
      },
      transparent: true,
      fog: true,
      lights: true,
      depthWrite: false,
      side: DoubleSide,
    });
    super(geometry, material);
    Object.assign(material.uniforms, this.foamMaterial.uniforms);
    this.item = item; this.quality = { ...quality }; this.shoreAllowed = quality.shoreWetnessAllowed;
    this.planar = new RiverPlanarSurface(this, ribbon, item.reflectionGroup ?? `river:${item.id}`,
      item.reflectionMode === "off" || item.reflectionStrength <= 0 ? null : effectiveRiverReflectionQuality(item.reflectionQuality, quality.reflectionQuality), item.reflections);
    this.addEventListener("added", () => { if (!this.disposed) this.planar.attachToScene(); });
    this.addEventListener("removed", () => this.planar.detach());
    this.ribbon=ribbon; this.effectSurface=surface; this.bakedTexture=bake?.texture??null;
    this.refractionAllowed = (item.refractionAllowed ?? true) && quality.reflectionQuality !== "off";
    this.authoredRefractionStrength = item.refractionStrength;
    this.authoredRefractionQuality = item.reflectionQuality !== "low";
    this.refreshRefractionSurface();
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
    this.userData.waterSceneTransmission = true;
    this.refreshTerrainEffects=()=>{
      this.releaseShore();this.releaseShore=()=>{};this.releaseCaustics();this.releaseCaustics=()=>{};
      if(this.parent instanceof Scene && ((item.caustics?.enabled && this.quality.causticsAllowed) || (item.shoreWetness?.enabled&&this.shoreAllowed))) {
        const water={...item,...(item.caustics?{caustics:{...item.caustics,enabled:item.caustics.enabled&&this.quality.causticsAllowed}}:{}),...(item.shoreWetness?{shoreWetness:{...item.shoreWetness,enabled:item.shoreWetness.enabled&&this.shoreAllowed}}:{})};
        try { this.releaseCaustics=registerRiverCaustics(this.parent,water,this.getSurface(),this); }
        catch(error) { this.effectErrors.push(String(error)); console.warn("[river-caustics]",item.id,error); return; }
        try {this.releaseShore=registerRiverShoreWetness(this.parent,water,this.getSurface(),this);}
        catch(error) {
          if(!(item.caustics?.enabled && this.quality.causticsAllowed)){this.releaseCaustics();this.releaseCaustics=()=>{};}
          this.effectErrors.push(String(error));console.warn("[river-wet-shore]",item.id,error);
        }
      }
    };
    this.addEventListener("added",this.refreshTerrainEffects);
    this.addEventListener("removed",()=>{this.releaseShore();this.releaseShore=()=>{};this.releaseCaustics();this.releaseCaustics=()=>{};});
    this.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial) return;
      this.planar.attachToScene();
      // Every River reads the same pre-transparency snapshot as Lake.
      const snapshot = readWaterScene(renderer, scene, camera);
      const transmission = !!snapshot;
      this.material.uniforms.waterSceneEnabled!.value = transmission ? 1 : 0;
      const refraction = this.refractionSurface;
      const refract = transmission && !!refraction && Math.abs(this.matrixWorld.determinant()) > 1e-12
        && renderer.capabilities.maxTextureSize >= Math.max(refraction.size.x, refraction.size.y);
      this.material.uniforms.riverRefractionStrength!.value = refract ? item.refractionStrength : 0;
      this.material.uniforms.riverRefractionSurface!.value = refract && refraction ? refraction.texture : null;
      if (refract) {
        this.material.uniforms.riverViewToLocal!.value.copy(this.matrixWorld).invert().multiply(camera.matrixWorld);
        this.material.uniforms.riverLocalToView!.value.copy(camera.matrixWorldInverse).multiply(this.matrixWorld);
      }
      this.userData.compositedWaterSurface = transmission;
      if (transmission && snapshot) {
        this.material.uniforms.waterSceneColor!.value = snapshot.texture;
        this.material.uniforms.waterSceneDepth!.value = snapshot.depthTexture;
        this.material.uniforms.waterSceneSize!.value.set(snapshot.width, snapshot.height);
        this.material.uniforms.waterSceneInverseProjection!.value.copy(camera.projectionMatrixInverse);
        this.material.uniforms.waterSceneReversed!.value = camera.reversedDepth ? 1 : 0;
      } else {
        this.material.uniforms.waterSceneColor!.value = null;
        this.material.uniforms.waterSceneDepth!.value = null;
      }
      this.foamMaterial.update(this.quality.foamAllowed && item.foamOpacity > 0, scene, camera);
      this.material.uniforms["time"]!.value = performance.now() / 1000;
      updateRiverSunShadow(this.material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
      updateWaterEnvironment(this.material.uniforms as ReturnType<typeof createWaterEnvironmentUniforms>, scene, camera, item.environmentProbes?.());
    };
  }

  /** Presentation-only ceiling, shared by editor/runtime/adaptive transitions.
   * Late bake loads cannot revive disposed or newly disabled consumers. */
  async applyQuality(quality: LakeQuality): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.qualityRevision;
    const terrainChanged = quality.causticsAllowed !== this.quality.causticsAllowed || quality.shoreWetnessAllowed !== this.shoreAllowed;
    this.quality = { ...quality };
    const item = this.item, u = this.material.uniforms;
    this.planar.setQuality(item.reflectionMode === "off" || item.reflectionStrength <= 0 ? null
      : effectiveRiverReflectionQuality(item.reflectionQuality, quality.reflectionQuality));
    this.setRefractionAllowed(quality.reflectionQuality !== "off");
    this.shoreAllowed = quality.shoreWetnessAllowed;
    if (terrainChanged) this.refreshTerrainEffects();
    u.waterDetail!.value = quality.reflectionQuality === "off" || item.reflectionQuality === "low" ? 0 : 1;
    u.foamOpacity!.value = quality.foamAllowed ? item.foamOpacity : 0;
    u.crestFoamStrength!.value = createWaterCrestFoamUniforms(item, quality.foamAllowed).crestFoamStrength.value;
    if (!quality.foamAllowed) {
      this.foamMaterial.dispose();
      this.contactTexture?.dispose(); this.contactTexture = null;
      this.bakedTexture?.dispose(); this.bakedTexture = null;
    } else if (item.foamOpacity > 0 && item.contactFoam?.enabled && !this.contactTexture) {
      const shore = riverContactSegments(this.ribbon.positions, this.ribbon.bedDepths, this.ribbon.indices);
      if (shore.length) {
        const min = u.realShoreOrigin!.value as Vector2, size = u.realShoreSize!.value as Vector2;
        this.contactTexture = createWaterShoreMask(min.toArray(), [min.x + size.x, min.y + size.y], shore, item.contactFoam.shoreWidth);
      }
    }
    u.realShoreMask!.value = this.contactTexture;
    u.hasRealShore!.value = this.contactTexture ? 1 : 0;
    u.contactCount!.value = 0; // Manual obstacle sources remain retired.
    this.bindFoamBake();
    if (!quality.foamAllowed || item.foamOpacity <= 0 || !item.geometryFoam?.enabled || this.bakedTexture || !item.loadBakedFoam) return;
    try {
      const data = await item.loadBakedFoam();
      if (this.disposed || revision !== this.qualityRevision || !this.quality.foamAllowed || !data) return;
      if (data.metadata.surface !== "river" || data.metadata.surfaceFingerprint !== riverFoamSurfaceFingerprint(this.getSurface())) return;
      // Recheck immediately before allocation: several quality recoveries can
      // finish their reads together, after their original loader budget check.
      let used = 0;
      this.parent?.traverse(object => {
        if (object instanceof Mesh && object.material instanceof ShaderMaterial) {
          used += object.material.uniforms.geometryFoamMask?.value?.image?.data?.byteLength ?? 0;
        }
      });
      const { nx, nz } = data.metadata, tw = Math.min(1024, nx), th = Math.min(1024, nz);
      if (used + tw * th * Math.ceil(nx / tw) * Math.ceil(nz / th) > 32 * 1024 ** 2) throw new Error("over-budget: combined water geometry foam exceeds 32 MiB");
      const bake = lakeFoamTexture(data);
      this.bakedTexture = bake.texture;
      u.geometryFoamMin!.value.set(...data.metadata.min);
      u.geometryFoamSize!.value.set(data.metadata.max[0] - data.metadata.min[0], data.metadata.max[1] - data.metadata.min[1]);
      u.geometryFoamGrid!.value.copy(bake.grid); u.geometryFoamTile!.value.copy(bake.tile);
      this.bindFoamBake();
    } catch (error) {
      if (!this.disposed && revision === this.qualityRevision) {
        this.effectErrors.push(String(error)); console.warn("[river-quality]", item.id, error);
      }
    }
  }

  private bindFoamBake(): void {
    this.material.uniforms.geometryFoamMask!.value = this.bakedTexture;
    const enabled = !!this.bakedTexture;
    if (!!this.material.defines.FORGE_LAKE_GEOMETRY_FOAM === enabled) return;
    if (enabled) this.material.defines.FORGE_LAKE_GEOMETRY_FOAM = 1;
    else delete this.material.defines.FORGE_LAKE_GEOMETRY_FOAM;
    this.material.needsUpdate = true;
  }

  /** Quality switches release only this consumer's atlas, never shared scene snapshots. */
  setRefractionAllowed(allowed: boolean): void {
    if (this.disposed || allowed === this.refractionAllowed) return;
    this.refractionAllowed = allowed;
    this.refreshRefractionSurface();
  }

  private refreshRefractionSurface(): void {
    const uniforms = this.material.uniforms;
    const previous = this.material.defines.FORGE_RIVER_REFRACTION;
    this.refractionSurface?.texture.dispose(); this.refractionSurface = null;
    uniforms.riverRefractionStrength!.value = 0;
    uniforms.riverRefractionSurface!.value = null;
    delete this.userData.riverRefractionBytes;
    delete this.userData.riverRefractionFallback;
    delete this.material.defines.FORGE_RIVER_REFRACTION;
    if (this.refractionAllowed && this.authoredRefractionQuality && this.authoredRefractionStrength > 0) {
      try {
        const atlas = createRiverRefractionSurface(this.ribbon, this.effectSurface);
        this.refractionSurface = atlas;
        this.material.defines.FORGE_RIVER_REFRACTION = 1;
        uniforms.riverRefractionSize!.value.copy(atlas.size);
        uniforms.riverRefractionMin!.value.copy(atlas.min);
        uniforms.riverRefractionGrid!.value.copy(atlas.grid);
        uniforms.riverRefractionBases!.value.copy(atlas.bases);
        uniforms.riverRefractionSpacing!.value = atlas.spacing;
        this.userData.riverRefractionBytes = atlas.bytes;
      } catch (error) { this.userData.riverRefractionFallback = String(error); }
    }
    if (previous !== this.material.defines.FORGE_RIVER_REFRACTION) this.material.needsUpdate = true;
  }

  setShoreWetnessAllowed(allowed:boolean):void {
    if(this.disposed || this.shoreAllowed===allowed)return;
    this.shoreAllowed=allowed;this.refreshTerrainEffects();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.planar.detach();
    this.releaseShore();this.releaseShore=()=>{};
    this.foamMaterial.dispose();
    this.releaseCaustics(); this.releaseCaustics=()=>{};
    this.bakedTexture?.dispose();
    this.refractionSurface?.texture.dispose();
    this.refractionSurface = null;
    this.contactTexture?.dispose();
    this.contactTexture = null; this.bakedTexture = null;
    this.material.uniforms.geometryFoamMask!.value = null;
    this.material.uniforms.realShoreMask!.value = null;
    this.material.uniforms.riverRefractionSurface!.value = null;
    this.material.uniforms.riverRefractionStrength!.value = 0;
    delete this.userData.riverRefractionBytes;
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
