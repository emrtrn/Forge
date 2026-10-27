import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  UniformsLib,
  UniformsUtils,
} from "three";
import { PLANAR_REFLECTION_EXCLUDED_LAYER } from "./planarReflectionSource";

import type { ForgeLandscapeData, ForgeLandscapeSpline, LandscapeSplinePolylineSample } from "@engine/scene/landscape";
import { landscapeHeightAtLocal, splineToPolyline } from "@engine/scene/landscape";
import type {
  LayoutRiverWaterFoamStamp,
  LayoutRiverWaterSegmentProfile,
  Vec3,
} from "@engine/scene/layout";
import type { ResolvedRiverWater } from "@engine/scene/riverWater";
import { createWaterEnvironmentUniforms, updateWaterEnvironment, WATER_ENVIRONMENT_GLSL, type WaterEnvironmentProbes } from "./waterEnvironment";
import { createRiverSunShadowUniforms, updateRiverSunShadow, RIVER_SUN_SHADOW_GLSL } from "./riverSunShadow";
import { WATER_OPTICS_GLSL } from "./waterOptics";

export { resolveRiverWater, RIVER_WATER_DEFAULTS, uniqueRiverWaterId, type ResolvedRiverWater } from "@engine/scene/riverWater";

/** Pure ribbon arrays, kept inspectable for engine tests without a WebGL context. */
export interface RiverWaterRibbonData {
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
  landscapeData?: ForgeLandscapeData;
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
        const terrainHeight = options.heightAt ? options.heightAt(x, z) : options.landscapeData
          ? landscapeHeightAtLocal(options.landscapeData, x, z)
          : surfaceHeight - 1;
        valid.push(terrainHeight !== null);
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
  return { positions, uvs, flowDirections, shoreDistances, waterDepths, rapidness, foamMasks, flowSpeedMultipliers, indices };
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
uniform float hasNormalMap;
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
${RIVER_SUN_SHADOW_GLSL}
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
  if (clipDryBed > 0.5 && vWaterDepth <= 0.001) discard;
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
  vec3 opticalNormal = normalize(surfaceNormal + hasNormalMap
    * (tangent * slope.x + bitangent * slope.y));
  float viewCosine = clamp(abs(dot(opticalNormal, viewDirection)), 0.0, 1.0);
  // Air/water F0 is approximately 0.02. Strength remains an authored multiplier.
  float fresnel = waterFresnel(viewCosine);
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
  float foam = clamp(shoreFoam + rapidFoam, 0.0, 1.0);
  vec3 reflected = min(waterReflectedEnvironment(vWorldPosition, reflect(-viewDirection, opticalNormal), 0.38 + (1.0 - waterDetail) * 0.2), vec3(2.0));
  float aboveSurface = step(0.0, dot(surfaceNormal, viewDirection));
  float hasEnvironment = step(0.0001, waterEnvironmentIntensity + waterProbeIntensity);
  float reflectionAmount = clamp(reflectionStrength * (0.025 + fresnel * 0.425) * aboveSurface * hasEnvironment
    * (1.0 - foam * foamOpacity * 0.65), 0.0, 1.0);
  float wetness = smoothstep(0.0, 0.12, vWaterDepth);
  float pathDepth = waterPath(vWaterDepth, abs(dot(surfaceNormal, viewDirection)));
  float bedTransmission = waterTransmission(vWaterDepth, pathDepth, bedVisibility, absorptionDistance);
  float bedOpacity = 1.0 - bedTransmission;
  float authoredOpacity = opacity * wetness * mix(0.58, 1.0, smoothstep(0.0, 3.0, vWaterDepth));
  gl_FragColor = waterComposite(color, max(authoredOpacity, bedOpacity), reflected, reflectionAmount * wetness,
    foamColor * mix(vec3(0.34), vec3(0.72), sunVisibility), foam * foamOpacity, waterSunGlint(opticalNormal, viewDirection, 0.28, sunVisibility)
      * wetness * smoothstep(0.03, 0.3, vWaterDepth) * 0.35);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface RiverWaterRenderItem extends ResolvedRiverWater {
  spline: ForgeLandscapeSpline;
  landscapeData?: ForgeLandscapeData;
  heightAt?: (x: number, z: number) => number | null;
  sampleSpacing?: number;
  position: Vec3;
  rotation: Vec3;
  /** Repeating grayscale noise used to break up inward shore-wave fronts. */
  foamNoiseMap: Texture | null;
  /** Existing sky/probe maps, borrowed from the owning scene. No new render pass. */
  environmentProbes?: WaterEnvironmentProbes;
}

export class RiverWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  readonly isRiverWaterObject = true;

  constructor(item: RiverWaterRenderItem, normalMap: Texture | null) {
    const ribbon = buildRiverWaterRibbon(item.spline, {
      surfaceLevel: item.surfaceLevel,
      widthScale: item.widthScale,
      ...(item.landscapeData ? { landscapeData: item.landscapeData } : {}),
      ...(item.heightAt ? { heightAt: item.heightAt } : {}),
      ...(item.sampleSpacing !== undefined ? { sampleSpacing: item.sampleSpacing } : {}),
      foamStamps: item.foamStamps,
      segmentProfiles: item.segmentProfiles,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(ribbon.positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(ribbon.uvs, 2));
    geometry.setAttribute("flowDirection", new Float32BufferAttribute(ribbon.flowDirections, 2));
    geometry.setAttribute("shoreDistance", new Float32BufferAttribute(ribbon.shoreDistances, 1));
    geometry.setAttribute("waterDepth", new Float32BufferAttribute(ribbon.waterDepths, 1));
    geometry.setAttribute("rapidness", new Float32BufferAttribute(ribbon.rapidness, 1));
    geometry.setAttribute("foamMask", new Float32BufferAttribute(ribbon.foamMasks, 1));
    geometry.setAttribute("flowSpeedMultiplier", new Float32BufferAttribute(ribbon.flowSpeedMultipliers, 1));
    geometry.setIndex(ribbon.indices);
    geometry.computeBoundingSphere();
    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ...UniformsUtils.clone(UniformsLib.lights),
        ...createRiverSunShadowUniforms(),
        ...createWaterEnvironmentUniforms(),
        normalMap: { value: normalMap },
        time: { value: 0 },
        flowSpeed: { value: item.flowSpeed },
        normalScale: { value: item.normalScale },
        hasNormalMap: { value: normalMap ? 1 : 0 },
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
    for (const stamp of item.foamStamps) {
      if (stamp.kind !== "point") continue;
      this.add(createRiverWaterRadialFoamObject(stamp, item));
    }
    this.onBeforeRender = (_renderer, scene, camera) => {
      this.material.uniforms["time"]!.value = performance.now() / 1000;
      updateRiverSunShadow(this.material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
      updateWaterEnvironment(this.material.uniforms as ReturnType<typeof createWaterEnvironmentUniforms>, scene, camera, item.environmentProbes?.());
    };
  }

  dispose(): void {
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

const RING_FOAM_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPosition;
#include <shadowmap_pars_vertex>
void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RADIAL_FOAM_FRAGMENT_SHADER = `
uniform sampler2D foamNoiseMap;
uniform float hasFoamNoiseMap;
uniform float time;
uniform float intensity;
uniform vec3 foamColor;
uniform float foamOpacity;
uniform float shoreWaveSpacing;
uniform float shoreWaveSpeed;
uniform float shoreWaveReach;
uniform float shoreWaveBreakupScale;
varying vec2 vUv;
varying vec3 vWorldPosition;
${WATER_OPTICS_GLSL}
${WATER_ENVIRONMENT_GLSL}
${RIVER_SUN_SHADOW_GLSL}

void main() {
  vec2 centred = vUv - 0.5;
  float radialDistance = length(centred) * 2.0;
  float angle = atan(centred.y, centred.x) * 0.159154943 + 0.5;
  vec2 radialNoiseUv = vec2(angle * 2.4 - time * shoreWaveSpeed * 0.035, radialDistance * 3.0) * max(shoreWaveBreakupScale, 0.1);
  float textureBreakup = texture2D(foamNoiseMap, radialNoiseUv).r;
  float breakup = mix(0.72, textureBreakup, hasFoamNoiseMap);
  float fadeStart = max(0.01, shoreWaveReach * 0.62);
  float radialZone = 1.0 - smoothstep(fadeStart, max(fadeStart + 0.01, shoreWaveReach), radialDistance);
  // Irregular moving patches, not complete concentric white rings. This is
  // an authored presentation stamp, not obstacle hydrodynamics.
  float foamPatch = waterNoise(centred * vec2(9.0, 13.0) * max(shoreWaveSpacing, 0.1)
    + vec2(time * shoreWaveSpeed * 0.7, -time * shoreWaveSpeed * 0.4));
  float radialBands = smoothstep(0.53, 0.82, foamPatch + (breakup - 0.5) * 0.3);
  float alpha = radialZone * radialBands * smoothstep(0.40, 0.76, breakup) * intensity * foamOpacity * 0.48;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(foamColor * mix(vec3(0.34), vec3(0.72), riverSunVisibility()), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Creates an obstacle-centred version of the regular shore-wave foam for one point stamp.
 * It is parented under the river ribbon, so authored landscape transforms are
 * inherited. Layer 31 keeps it out of planar-reflection captures.
 */
function createRiverWaterRadialFoamObject(
  stamp: LayoutRiverWaterFoamStamp,
  item: RiverWaterRenderItem,
): Mesh<PlaneGeometry, ShaderMaterial> {
  const radius = Math.max(0.05, stamp.radius);
  const geometry = new PlaneGeometry(radius * 2, radius * 2, 1, 1);
  const material = new ShaderMaterial({
    vertexShader: RING_FOAM_VERTEX_SHADER,
    fragmentShader: RADIAL_FOAM_FRAGMENT_SHADER,
    lights: true,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.lights),
      ...createWaterEnvironmentUniforms(),
      ...createRiverSunShadowUniforms(),
      foamNoiseMap: { value: item.foamNoiseMap },
      hasFoamNoiseMap: { value: item.foamNoiseMap ? 1 : 0 },
      time: { value: 0 },
      intensity: { value: stamp.intensity },
      foamColor: { value: new Color(item.foamColor) },
      foamOpacity: { value: item.foamOpacity },
      shoreWaveSpacing: { value: item.shoreWaveSpacing },
      shoreWaveSpeed: { value: item.shoreWaveSpeed },
      shoreWaveReach: { value: item.shoreWaveReach },
      shoreWaveBreakupScale: { value: item.shoreWaveBreakupScale },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const overlay = new Mesh(geometry, material);
  overlay.name = `radial-foam:${stamp.id}`;
  overlay.position.set(stamp.position[0], stamp.position[1] + 0.025, stamp.position[2]);
  overlay.rotation.x = -Math.PI / 2;
  overlay.renderOrder = 2;
  overlay.receiveShadow = true;
  overlay.layers.enable(PLANAR_REFLECTION_EXCLUDED_LAYER);
  overlay.raycast = () => {};
  overlay.onBeforeRender = (_renderer, scene, camera) => {
    updateRiverSunShadow(material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
    material.uniforms["time"]!.value = performance.now() / 1000;
  };
  return overlay;
}

export type RiverWaterObjectLike = RiverWaterObject;

export function createRiverWaterObject(item: RiverWaterRenderItem, normalMap: Texture | null): RiverWaterObject {
  return new RiverWaterObject(item, normalMap);
}

export function disposeRiverWaterObject(object: RiverWaterObjectLike): void {
  object.dispose();
}
