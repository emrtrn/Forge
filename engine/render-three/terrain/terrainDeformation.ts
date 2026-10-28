import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  type WebGLRenderer,
} from "three";

import { PHYSICAL_MATERIALS, resolvePhysicalMaterial } from "@engine/scene/collision";
import { DEFORMATION_DEPTH_SCALE, type DeformationDirtyRect, type DeformationField } from "@engine/scene/deformationField";
import { TERRAIN_RENDER_LAYERS } from "@engine/terrain/terrainRenderData";

import { TerrainTextureUpdates } from "./terrainTextureUpdates";
import { TerrainWater, TERRAIN_WATER_PARS, TERRAIN_WATER_REFLECTION } from "./terrainWater";
import type { TerrainWetTrail } from "./terrainWetTrail";

type TerrainUniforms = Record<string, { value: unknown }>;

/**
 * The GPU copy of the runtime track field (TERRAIN_DEFORMATION Faz 2). The CPU
 * {@link DeformationField} stays authoritative — physics and gameplay read it —
 * and this only mirrors it into an RGBA8 texture the CDLOD terrain material
 * samples: R = depth over {@link TERRAIN_DEFORMATION_DEPTH_RANGE}, G =
 * disturbance, B = wet tyre prints ({@link TerrainWetTrail}, presentation
 * state beside the field), all softened by a one-cell tent filter (rendering
 * only). A is unused.
 * The texture repeats like the field's toroidal storage, so a
 * world position maps to `world / windowSize` with no shift on recentre.
 *
 * Changes travel as the field's dirty rectangles with a one-cell filter halo,
 * split at the wrap seam, through {@link TerrainTextureUpdates},
 * the partial path the Faz 0 spike measured (full 512² uploads spiked GPU p95).
 *
 * One instance per page is shared by every terrain material
 * ({@link sharedTerrainDeformation}); it stays inactive — the shader skips the
 * whole block — until a runtime module attaches a field.
 */

/** Deepest depth the 8-bit channel encodes: the deepest built-in soft preset (≈1.2 mm steps at 0.3 m). */
export const TERRAIN_DEFORMATION_DEPTH_RANGE = Math.max(
  0.05, ...Object.values(PHYSICAL_MATERIALS).map((material) => material.deformation?.maxDepth ?? 0),
);

/** Berm (raised rim) gain: the share of the surrounding ring's extra depth lifted beside a track (visual only). */
export const TERRAIN_DEFORMATION_BERM = 0.6;
/** Ring radius (m) the berm looks across: about a tyre's half-width plus its rim. */
export const TERRAIN_DEFORMATION_BERM_RADIUS = 0.3;
/** Highest berm (m). */
export const TERRAIN_DEFORMATION_BERM_MAX = 0.06;
/** Share of the window, on each side, over which tracks fade out (the window's moving edge never shows a seam). */
export const TERRAIN_DEFORMATION_EDGE_FADE = 0.06;
/** Track wetness (roughness drop) a fully wet Lake shore lends a disturbed track; it never adds puddles. */
export const TERRAIN_DEFORMATION_SHORE_WETNESS = 0.7;

/** World X/Z rectangle the track texture covers while a field is attached. */
export interface TerrainDeformationWindow {
  readonly minX: number;
  readonly minZ: number;
  readonly size: number;
}

export interface TerrainDeformationStats {
  /** Texels sent to the GPU by the last {@link TerrainDeformationTexture.update}. */
  readonly uploadedTexels: number;
  /** CPU time of the last pack (ms). */
  readonly packMs: number;
}

export class TerrainDeformationTexture {
  readonly water = new TerrainWater();
  readonly uniforms: TerrainUniforms = {
    ...this.water.uniforms,
    uDeformTex: { value: null },
    /** World X/Z of the window's min corner, window size, cell size (m). */
    uDeformWindow: { value: new Vector4(0, 0, 1, 1) },
    uDeformDepthRange: { value: TERRAIN_DEFORMATION_DEPTH_RANGE },
    uDeformActive: { value: 0 },
  };
  private texture: DataTexture | null = null;
  private updates: TerrainTextureUpdates | null = null;
  private field: DeformationField | null = null;
  private trail: TerrainWetTrail | null = null;
  private lastStats: TerrainDeformationStats = { uploadedTexels: 0, packMs: 0 };
  private windowRevision = 0;

  /**
   * Bumps whenever {@link trackWindow} changes (attach, detach, recentre), so
   * a terrain renderer re-selects its detail nodes only then.
   */
  get revision(): number {
    return this.windowRevision;
  }

  /** The covered world rectangle, or null while no field is attached. */
  trackWindow(): TerrainDeformationWindow | null {
    if (!this.field) return null;
    const window = this.uniforms.uDeformWindow!.value as Vector4;
    return { minX: window.x, minZ: window.y, size: window.z };
  }

  /**
   * Mirrors `field` (and the wet prints of `trail`, which must share its
   * window) from now on: a full copy now, then dirty rectangles via {@link update}.
   */
  attach(field: DeformationField, trail: TerrainWetTrail | null = null): void {
    if (trail && (trail.cellsPerSide !== field.cellsPerSide || trail.cellSize !== field.cellSize)) {
      throw new RangeError("Wet trail must share the deformation field's cells");
    }
    const size = field.cellsPerSide;
    if (!this.texture || this.texture.image.width !== size) {
      this.disposeTexture();
      const texture = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat, UnsignedByteType);
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.minFilter = texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.unpackAlignment = 4;
      texture.name = "terrain-deformation";
      this.texture = texture;
      this.updates = new TerrainTextureUpdates([texture]);
      this.uniforms.uDeformTex!.value = texture;
    }
    this.field = field;
    this.trail = trail;
    this.pack({ x: 0, y: 0, width: size, height: size });
    this.texture.needsUpdate = true;
    this.syncWindow();
    this.uniforms.uDeformActive!.value = 1;
  }

  /** Copies changed cells (the field's and the trail's `takeDirty()` rectangles) and the window position. */
  update(rects: readonly DeformationDirtyRect[]): void {
    if (!this.field || !this.texture || !this.updates) return;
    const started = performance.now();
    let texels = 0;
    const size = this.field.cellsPerSide;
    // The filter reads one neighbouring cell. Refresh that halo too, splitting
    // it at either storage seam so retained neighbours never keep stale edges.
    const spans = (start: number, length: number): [number, number][] => {
      if (length + 2 >= size) return [[0, size]];
      const first = (start - 1 + size) % size;
      const count = length + 2;
      return first + count <= size ? [[first, count]] : [[first, size - first], [0, first + count - size]];
    };
    for (const rect of rects) {
      for (const [y, height] of spans(rect.y, rect.height)) for (const [x, width] of spans(rect.x, rect.width)) {
        this.pack({ x, y, width, height });
        this.updates.add(this.texture, 0, { x0: x, z0: y, x1: x + width - 1, z1: y + height - 1 });
        texels += width * height;
      }
    }
    this.syncWindow();
    this.lastStats = { uploadedTexels: texels, packMs: performance.now() - started };
  }

  /** Called from the terrain material's `onBeforeRender`; a no-op until a field is attached. */
  flush(renderer: WebGLRenderer): void {
    if (this.field) this.updates?.flush(renderer);
  }

  /** Stops drawing tracks (level unload); the texture is kept for the next attach. */
  detach(): void {
    if (this.field) this.windowRevision += 1;
    this.field = null;
    this.trail = null;
    this.uniforms.uDeformActive!.value = 0;
    this.water.reset();
  }

  stats(): TerrainDeformationStats {
    return this.lastStats;
  }

  dispose(): void {
    this.detach();
    this.water.dispose();
    this.disposeTexture();
  }

  private pack(rect: DeformationDirtyRect): void {
    const field = this.field!;
    const data = this.texture!.image.data as Uint8Array;
    const size = field.cellsPerSide;
    const wet = this.trail?.wet;
    const scale = 255 / (TERRAIN_DEFORMATION_DEPTH_RANGE * DEFORMATION_DEPTH_SCALE);
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const index = y * size + x;
        let depth = 0;
        let disturbance = 0;
        let wetness = 0;
        for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const neighbour = ((y + dz + size) % size) * size + (x + dx + size) % size;
          const weight = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
          depth += field.depth[neighbour]! * weight;
          disturbance += field.disturbance[neighbour]! * weight;
          if (wet) wetness += wet[neighbour]! * weight;
        }
        data[index * 4] = Math.min(255, Math.round(depth * scale / 16));
        data[index * 4 + 1] = Math.round(disturbance / 16);
        data[index * 4 + 2] = Math.round(wetness / 16);
      }
    }
  }

  private syncWindow(): void {
    const field = this.field!;
    const [cx, cz] = field.originCell;
    const window = this.uniforms.uDeformWindow!.value as Vector4;
    const x = cx * field.cellSize;
    const z = cz * field.cellSize;
    if (window.x !== x || window.y !== z || window.z !== field.windowSize || window.w !== field.cellSize || this.uniforms.uDeformActive!.value !== 1) {
      this.windowRevision += 1;
    }
    window.set(x, z, field.windowSize, field.cellSize);
  }

  private disposeTexture(): void {
    this.updates?.dispose();
    this.updates = null;
    this.texture?.dispose();
    this.texture = null;
    this.uniforms.uDeformTex!.value = null;
  }
}

let shared: TerrainDeformationTexture | null = null;

/** The page's one track texture, shared by every terrain material. */
export function sharedTerrainDeformation(): TerrainDeformationTexture {
  return shared ??= new TerrainDeformationTexture();
}

/**
 * Per-layer track look from each paint layer's physical material: tint colour
 * and strength (`vec4`), and how much the track's roughness drops (wetness).
 * Layers without a soft profile get no tint.
 */
export function terrainDeformationLayerUniforms(physicalMaterials: readonly (string | null | undefined)[]): TerrainUniforms {
  const tints = Array.from({ length: TERRAIN_RENDER_LAYERS }, () => new Vector4(0, 0, 0, 0));
  const wetness = new Array<number>(TERRAIN_RENDER_LAYERS).fill(0);
  physicalMaterials.slice(0, TERRAIN_RENDER_LAYERS).forEach((id, index) => {
    const profile = id ? resolvePhysicalMaterial(id).deformation : undefined;
    if (!profile || profile.maxDepth <= 0) return;
    tints[index]!.set(profile.tint[0], profile.tint[1], profile.tint[2], profile.tintStrength);
    wetness[index] = profile.wetness;
  });
  return { uDeformLayerTint: { value: tints }, uDeformLayerWet: { value: wetness } };
}

/**
 * Track depth (m) at world X/Z from a bilinear sampler of the render-filtered field, faded
 * toward the window's edge exactly as the shaders fade it: 0 on and past the
 * edge. Mirrors `forgeDeformDepthAt`.
 */
export function terrainDeformationDepthAt(
  depthAt: (worldX: number, worldZ: number) => number,
  window: TerrainDeformationWindow,
  worldX: number,
  worldZ: number,
): number {
  const fade = terrainDeformationFade(window, worldX, worldZ);
  return fade > 0 ? Math.max(0, depthAt(worldX, worldZ)) * fade : 0;
}

/** Edge fade at world X/Z (mirrors `forgeDeformFade`): 1 inside, smoothly 0 on and past the window's edge. */
export function terrainDeformationFade(window: TerrainDeformationWindow, worldX: number, worldZ: number): number {
  const tx = (worldX - window.minX) / window.size;
  const tz = (worldZ - window.minZ) / window.size;
  if (!(tx >= 0 && tx <= 1 && tz >= 0 && tz <= 1)) return 0;
  const smooth = (edge0: number, edge1: number, value: number): number => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  const fade = (t: number): number => smooth(0, TERRAIN_DEFORMATION_EDGE_FADE, t) * (1 - smooth(1 - TERRAIN_DEFORMATION_EDGE_FADE, 1, t));
  return fade(tx) * fade(tz);
}

/**
 * Vertex height change at world X/Z (mirrors `forgeDeformDisplacement`): down
 * by the track depth, up by a berm where the ring at
 * {@link TERRAIN_DEFORMATION_BERM_RADIUS} around it is deeper than the point
 * itself (just outside a rut's edge), faded like the depth so the edge stays
 * at exactly 0. Visual only: physics reads the field.
 */
export function terrainDeformationDisplacement(
  depthAt: (worldX: number, worldZ: number) => number,
  window: TerrainDeformationWindow,
  worldX: number,
  worldZ: number,
): { offset: number; berm: number } {
  const at = (x: number, z: number) => terrainDeformationDepthAt(depthAt, window, x, z);
  const r = TERRAIN_DEFORMATION_BERM_RADIUS;
  const depth = at(worldX, worldZ);
  const ring = (at(worldX + r, worldZ) + at(worldX - r, worldZ) + at(worldX, worldZ + r) + at(worldX, worldZ - r)) / 4;
  const berm = Math.min(TERRAIN_DEFORMATION_BERM_MAX, TERRAIN_DEFORMATION_BERM * Math.max(0, ring - depth))
    * terrainDeformationFade(window, worldX, worldZ);
  return { offset: berm - depth, berm };
}

const glslFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

/**
 * Every terrain material's vertex shader (lit, GTAO normal, DOF depth): the
 * track displacement, so all passes see the same dented surface.
 */
export const TERRAIN_DEFORMATION_DISPLACEMENT_PARS = /* glsl */ `
uniform sampler2D uDeformTex;
uniform vec4 uDeformWindow;
uniform float uDeformDepthRange;
uniform float uDeformActive;

float forgeDeformFade(vec2 world) {
  vec2 t = (world - uDeformWindow.xy) / uDeformWindow.z;
  if (any(lessThan(t, vec2(0.0))) || any(greaterThan(t, vec2(1.0)))) return 0.0;
  vec2 edge = smoothstep(vec2(0.0), vec2(${glslFloat(TERRAIN_DEFORMATION_EDGE_FADE)}), t)
    * (1.0 - smoothstep(vec2(${glslFloat(1 - TERRAIN_DEFORMATION_EDGE_FADE)}), vec2(1.0), t));
  return edge.x * edge.y;
}

float forgeDeformDepthAt(vec2 world) {
  float fade = forgeDeformFade(world);
  return fade > 0.0 ? textureLod(uDeformTex, world / uDeformWindow.z, 0.0).r * uDeformDepthRange * fade : 0.0;
}

// x: height change (berm - depth), y: berm.
vec2 forgeDeformDisplacement(vec2 world) {
  if (uDeformActive < 0.5) return vec2(0.0);
  float depth = forgeDeformDepthAt(world);
  float r = ${glslFloat(TERRAIN_DEFORMATION_BERM_RADIUS)};
  float ring = (forgeDeformDepthAt(world + vec2(r, 0.0)) + forgeDeformDepthAt(world - vec2(r, 0.0))
    + forgeDeformDepthAt(world + vec2(0.0, r)) + forgeDeformDepthAt(world - vec2(0.0, r))) * 0.25;
  float berm = min(${glslFloat(TERRAIN_DEFORMATION_BERM_MAX)}, ${glslFloat(TERRAIN_DEFORMATION_BERM)} * max(0.0, ring - depth))
    * forgeDeformFade(world);
  return vec2(berm - depth, berm);
}
`;

export const TERRAIN_DEFORMATION_VERTEX_PARS = /* glsl */ `
varying vec2 vForgeDeformWorld;
varying float vForgeDeformBerm;
varying float vForgeDeformBaseY;
`;

/** After `transformed` is set: the deformation lookup works in world X/Z. */
export const TERRAIN_DEFORMATION_VERTEX = /* glsl */ `
vForgeDeformWorld = (modelMatrix * vec4(transformed, 1.0)).xz;
vForgeDeformBerm = forgeDisp.y;
vForgeDeformBaseY = (modelMatrix * vec4(transformed, 1.0)).y - forgeDisp.x * modelMatrix[1].y;
`;

export const TERRAIN_DEFORMATION_FRAGMENT_PARS = /* glsl */ `
${TERRAIN_DEFORMATION_DISPLACEMENT_PARS}
uniform vec4 uDeformLayerTint[${TERRAIN_RENDER_LAYERS}];
uniform float uDeformLayerWet[${TERRAIN_RENDER_LAYERS}];
varying vec2 vForgeDeformWorld;
varying float vForgeDeformBerm;
// Undented world Y: classifications against a fixed level (Lake shores) must
// not change where a track dips below it.
varying float vForgeDeformBaseY;
// x: depth (m), y: disturbance (0..1), z/w: full displacement gradient along world X/Z.
vec4 forgeDeform = vec4(0.0);
float forgeDeformWetness = 0.0;
float forgePuddle = 0.0;
// Wet tyre prints (B channel, TerrainWetTrail): 0 dry .. 1 soaked.
float forgeTrailWet = 0.0;

void forgeSampleDeformation() {
  if (uDeformActive < 0.5) return;
  vec2 t = (vForgeDeformWorld - uDeformWindow.xy) / uDeformWindow.z;
  if (any(lessThan(t, vec2(0.0))) || any(greaterThan(t, vec2(1.0)))) return;
  float fade = forgeDeformFade(vForgeDeformWorld);
  vec2 uv = vForgeDeformWorld / uDeformWindow.z;
  vec3 c = texture(uDeformTex, uv).rgb;
  forgeDeform.xy = vec2(c.r * uDeformDepthRange, c.g) * fade;
  forgeTrailWet = c.b * fade;
  if (c.r > 0.0 || c.g > 0.0 || vForgeDeformBerm > 0.0) {
    // The same height function as every vertex pass, including the berm and
    // window fade. No triangle-constant derivatives of interpolated rim heights.
    float stepSize = uDeformWindow.w;
    float dxp = forgeDeformDisplacement(vForgeDeformWorld + vec2(stepSize, 0.0)).x;
    float dxn = forgeDeformDisplacement(vForgeDeformWorld - vec2(stepSize, 0.0)).x;
    float dzp = forgeDeformDisplacement(vForgeDeformWorld + vec2(0.0, stepSize)).x;
    float dzn = forgeDeformDisplacement(vForgeDeformWorld - vec2(0.0, stepSize)).x;
    forgeDeform.zw = vec2(dxp - dxn, dzp - dzn) / (2.0 * stepSize);
  }
}

vec3 forgeDeformedWorldNormal(vec3 baseNormal) {
  // Add height slopes, rather than adding slopes to an already unit-length
  // normal (which exaggerates the change on sloped terrain).
  return normalize(vec3(baseNormal.x / max(0.05, baseNormal.y) - forgeDeform.z,
    1.0, baseNormal.z / max(0.05, baseNormal.y) - forgeDeform.w));
}
${TERRAIN_WATER_PARS}
`;

/**
 * Inside the colour block, after the splat: tints the track by its layers'
 * profiles (weights `forgeW0`/`forgeW1`), darkens it slightly with depth, and
 * leaves the blended wetness for the roughness chunk.
 */
export const TERRAIN_DEFORMATION_COLOR = /* glsl */ `
  if (uTerrainView < 0.5 && forgeDeform.y > 0.0) {
    vec4 forgeTint = uDeformLayerTint[0] * forgeW0.x + uDeformLayerTint[1] * forgeW0.y
      + uDeformLayerTint[2] * forgeW0.z + uDeformLayerTint[3] * forgeW0.w
      + uDeformLayerTint[4] * forgeW1.x + uDeformLayerTint[5] * forgeW1.y
      + uDeformLayerTint[6] * forgeW1.z + uDeformLayerTint[7] * forgeW1.w;
    float forgeWet = uDeformLayerWet[0] * forgeW0.x + uDeformLayerWet[1] * forgeW0.y
      + uDeformLayerWet[2] * forgeW0.z + uDeformLayerWet[3] * forgeW0.w
      + uDeformLayerWet[4] * forgeW1.x + uDeformLayerWet[5] * forgeW1.y
      + uDeformLayerWet[6] * forgeW1.z + uDeformLayerWet[7] * forgeW1.w;
    float forgeWeightSum = max(0.0001, dot(forgeW0, vec4(1.0)) + dot(forgeW1, vec4(1.0)));
    forgeTint /= forgeWeightSum;
    // A profile's tint is its dry disturbed look. On a wet Lake shore or bed
    // (forgeShoreWet, set before this block) the track keeps the painted
    // layer's own albedo and turns wet instead, whatever the profile.
    forgeTint.a *= 1.0 - forgeShoreWet;
    forgeColor = mix(forgeColor, forgeTint.rgb, clamp(forgeTint.a * forgeDeform.y, 0.0, 1.0));
    forgeColor *= 1.0 - 0.3 * clamp(forgeDeform.x / max(0.0001, uDeformDepthRange), 0.0, 1.0);
    float forgeProfileWet = clamp(forgeWet / forgeWeightSum * forgeDeform.y, 0.0, 1.0);
    forgeDeformWetness = max(forgeProfileWet, ${glslFloat(TERRAIN_DEFORMATION_SHORE_WETNESS)} * forgeShoreWet * forgeDeform.y);
    vec3 forgeBase = forgeTerrainLocalNormal();
    vec3 forgeBaseWorld = inverseTransformDirection(normalize(vTerrainAxisX * forgeBase.x
      + vTerrainAxisY * forgeBase.y + vTerrainAxisZ * forgeBase.z), viewMatrix);
    // Evaluate the dented surface: steep rut walls must remain muddy even on
    // flat authored terrain. The raised rim stays rough, with a soft shoreline.
    // Puddles follow the profile only (shore wetness darkens, it does not
    // flood ruts) and never form under a Lake's surface.
    forgePuddle = smoothstep(0.02, 0.08, forgeDeform.x)
      * smoothstep(0.4, 0.8, forgeProfileWet) * (1.0 - forgeShoreSubmerged)
      * smoothstep(0.94, 0.995, forgeDeformedWorldNormal(forgeBaseWorld).y)
      * (1.0 - smoothstep(0.002, 0.012, vForgeDeformBerm));
    forgePuddle *= forgePuddlePatch(vForgeDeformWorld, forgeDeform.x) * forgeShorePuddleFade;
    forgeColor = mix(forgeColor, vec3(0.025, 0.029, 0.027), forgePuddle * 0.6);
  }
`;

export const TERRAIN_DEFORMATION_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - 0.45 * forgeDeformWetness;
roughnessFactor *= forgeLayerRoughness;
roughnessFactor = max(roughnessFactor, 0.32 * smoothstep(0.0, 0.5, forgeDeformWetness));
float forgePuddleRoughness = .24 + .04 * forgePuddleNoise(vForgeDeformWorld * 5.0);
roughnessFactor = mix(roughnessFactor, forgePuddleRoughness, forgePuddle);
`;

/** Environment-lit water; an analytic sky is the fallback without an env map. */
export const TERRAIN_DEFORMATION_WATER = /* glsl */ `
#ifndef USE_ENVMAP
if (forgePuddle > 0.0) {
  vec3 forgeReflection = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
  vec3 forgeSky = mix(vec3(0.55, 0.62, 0.68), vec3(0.18, 0.35, 0.58), smoothstep(0.0, 0.8, forgeReflection.y));
  float forgeFresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
  outgoingLight = mix(outgoingLight, forgeSky, forgePuddle * (0.04 + 0.55 * forgeFresnel));
}
#endif
${TERRAIN_WATER_REFLECTION}
// A restrained muddy crest remains readable under a vehicle's dark reflection.
// Its mask uses the calm surface; animated normals never move the shoreline.
outgoingLight += vec3(0.50, 0.44, 0.32) * forgeWaterCrest * forgePuddle;
`;

/**
 * After the terrain normal is set (view space): tilt it by the track's depth
 * gradient in world X/Z, including the berm. This stays continuous across
 * triangle edges and uses the same surface slope as the puddle mask.
 */
export const TERRAIN_DEFORMATION_NORMAL = /* glsl */ `
  if (forgeDeform.y > 0.0 || forgeDeform.x > 0.0 || vForgeDeformBerm > 0.0) {
    normal = mat3(viewMatrix) * forgeDeformedWorldNormal(inverseTransformDirection(normal, viewMatrix));
    if (forgePuddle > 0.0) {
      forgeSampleWater();
      forgeWaterGradient += forgePuddleMicroGradient(vForgeDeformWorld, uTerrainWaterTime);
    }
    normal = normalize(mix(normal, mat3(viewMatrix) * normalize(vec3(-forgeWaterGradient.x, 1.0, -forgeWaterGradient.y)), forgePuddle));
    nonPerturbedNormal = normal;
  }
`;
