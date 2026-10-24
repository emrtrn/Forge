import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGFormat,
  UnsignedByteType,
  Vector4,
  type WebGLRenderer,
} from "three";

import { PHYSICAL_MATERIALS, resolvePhysicalMaterial } from "@engine/scene/collision";
import { DEFORMATION_DEPTH_SCALE, type DeformationDirtyRect, type DeformationField } from "@engine/scene/deformationField";
import { TERRAIN_RENDER_LAYERS } from "@engine/terrain/terrainRenderData";

import { TerrainTextureUpdates } from "./terrainTextureUpdates";

type TerrainUniforms = Record<string, { value: unknown }>;

/**
 * The GPU copy of the runtime track field (TERRAIN_DEFORMATION Faz 2). The CPU
 * {@link DeformationField} stays authoritative — physics and gameplay read it —
 * and this only mirrors it into an RG8 texture the CDLOD terrain material
 * samples: R = depth over {@link TERRAIN_DEFORMATION_DEPTH_RANGE}, G =
 * disturbance. The texture repeats like the field's toroidal storage, so a
 * world position maps to `world / windowSize` with no shift on recentre.
 *
 * Changes travel as the field's dirty rectangles (at most four, split at the
 * wrap seam) through {@link TerrainTextureUpdates}, one sub-image copy each,
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

export interface TerrainDeformationStats {
  /** Texels sent to the GPU by the last {@link TerrainDeformationTexture.update}. */
  readonly uploadedTexels: number;
  /** CPU time of the last pack (ms). */
  readonly packMs: number;
}

export class TerrainDeformationTexture {
  readonly uniforms: TerrainUniforms = {
    uDeformTex: { value: null },
    /** World X/Z of the window's min corner, window size, cell size (m). */
    uDeformWindow: { value: new Vector4(0, 0, 1, 1) },
    uDeformDepthRange: { value: TERRAIN_DEFORMATION_DEPTH_RANGE },
    uDeformActive: { value: 0 },
  };
  private texture: DataTexture | null = null;
  private updates: TerrainTextureUpdates | null = null;
  private field: DeformationField | null = null;
  private lastStats: TerrainDeformationStats = { uploadedTexels: 0, packMs: 0 };

  /** Mirrors `field` from now on: a full copy now, then its dirty rectangles via {@link update}. */
  attach(field: DeformationField): void {
    const size = field.cellsPerSide;
    if (!this.texture || this.texture.image.width !== size) {
      this.disposeTexture();
      const texture = new DataTexture(new Uint8Array(size * size * 2), size, size, RGFormat, UnsignedByteType);
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.minFilter = texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.unpackAlignment = 1;
      texture.name = "terrain-deformation";
      this.texture = texture;
      this.updates = new TerrainTextureUpdates([texture]);
      this.uniforms.uDeformTex!.value = texture;
    }
    this.field = field;
    this.pack({ x: 0, y: 0, width: size, height: size });
    this.texture.needsUpdate = true;
    this.syncWindow();
    this.uniforms.uDeformActive!.value = 1;
  }

  /** Copies the field's changed cells (its `takeDirty()` rectangles) and its window position. */
  update(rects: readonly DeformationDirtyRect[]): void {
    if (!this.field || !this.texture || !this.updates) return;
    const started = performance.now();
    let texels = 0;
    for (const rect of rects) {
      this.pack(rect);
      this.updates.add(this.texture, 0, { x0: rect.x, z0: rect.y, x1: rect.x + rect.width - 1, z1: rect.y + rect.height - 1 });
      texels += rect.width * rect.height;
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
    this.field = null;
    this.uniforms.uDeformActive!.value = 0;
  }

  stats(): TerrainDeformationStats {
    return this.lastStats;
  }

  dispose(): void {
    this.detach();
    this.disposeTexture();
  }

  private pack(rect: DeformationDirtyRect): void {
    const field = this.field!;
    const data = this.texture!.image.data as Uint8Array;
    const size = field.cellsPerSide;
    const scale = 255 / (TERRAIN_DEFORMATION_DEPTH_RANGE * DEFORMATION_DEPTH_SCALE);
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const index = y * size + x;
        data[index * 2] = Math.min(255, Math.round(field.depth[index]! * scale));
        data[index * 2 + 1] = field.disturbance[index]!;
      }
    }
  }

  private syncWindow(): void {
    const field = this.field!;
    const [cx, cz] = field.originCell;
    (this.uniforms.uDeformWindow!.value as Vector4).set(cx * field.cellSize, cz * field.cellSize, field.windowSize, field.cellSize);
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

export const TERRAIN_DEFORMATION_VERTEX_PARS = /* glsl */ `
varying vec2 vForgeDeformWorld;
`;

/** After `transformed` is set: the deformation lookup works in world X/Z. */
export const TERRAIN_DEFORMATION_VERTEX = /* glsl */ `
vForgeDeformWorld = (modelMatrix * vec4(transformed, 1.0)).xz;
`;

export const TERRAIN_DEFORMATION_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uDeformTex;
uniform vec4 uDeformWindow;
uniform float uDeformDepthRange;
uniform float uDeformActive;
uniform vec4 uDeformLayerTint[${TERRAIN_RENDER_LAYERS}];
uniform float uDeformLayerWet[${TERRAIN_RENDER_LAYERS}];
varying vec2 vForgeDeformWorld;
// x: depth (m), y: disturbance (0..1), z/w: depth gradient along world X/Z.
vec4 forgeDeform = vec4(0.0);
float forgeDeformWetness = 0.0;

void forgeSampleDeformation() {
  if (uDeformActive < 0.5) return;
  vec2 t = (vForgeDeformWorld - uDeformWindow.xy) / uDeformWindow.z;
  if (any(lessThan(t, vec2(0.0))) || any(greaterThan(t, vec2(1.0)))) return;
  // Fade over the outer 6% so the window's moving edge never shows a seam.
  vec2 edge = smoothstep(vec2(0.0), vec2(0.06), t) * (1.0 - smoothstep(vec2(0.94), vec2(1.0), t));
  float fade = edge.x * edge.y;
  vec2 uv = vForgeDeformWorld / uDeformWindow.z;
  float texel = uDeformWindow.w / uDeformWindow.z;
  vec2 c = texture(uDeformTex, uv).rg;
  float dxp = texture(uDeformTex, uv + vec2(texel, 0.0)).r;
  float dxn = texture(uDeformTex, uv - vec2(texel, 0.0)).r;
  float dzp = texture(uDeformTex, uv + vec2(0.0, texel)).r;
  float dzn = texture(uDeformTex, uv - vec2(0.0, texel)).r;
  float scale = uDeformDepthRange * fade;
  forgeDeform = vec4(c.r * scale, c.g * fade,
    (dxp - dxn) * scale / (2.0 * uDeformWindow.w), (dzp - dzn) * scale / (2.0 * uDeformWindow.w));
}
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
    forgeColor = mix(forgeColor, forgeTint.rgb, clamp(forgeTint.a * forgeDeform.y, 0.0, 1.0));
    forgeColor *= 1.0 - 0.3 * clamp(forgeDeform.x / max(0.0001, uDeformDepthRange), 0.0, 1.0);
    forgeDeformWetness = clamp(forgeWet / forgeWeightSum * forgeDeform.y, 0.0, 1.0);
  }
`;

export const TERRAIN_DEFORMATION_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - 0.7 * forgeDeformWetness;
`;

/** After the terrain normal is set (view space): tilt it by the track's depth gradient in world X/Z. */
export const TERRAIN_DEFORMATION_NORMAL = /* glsl */ `
  if (forgeDeform.y > 0.0 || forgeDeform.x > 0.0) {
    normal = normalize(normal + mat3(viewMatrix) * vec3(forgeDeform.z, 0.0, forgeDeform.w));
    nonPerturbedNormal = normal;
  }
`;
