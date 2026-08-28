/**
 * Per-fragment hiding driven by a world-space mask texture.
 *
 * A material patched here asks, for every fragment it shades, "what does the
 * mask say about the ground directly under this pixel?" and throws the fragment
 * away when the answer is *hidden*. Nothing about the containing object enters
 * into it — so a model that straddles a mask boundary is cut by that boundary
 * rather than being shown or hidden as a whole.
 *
 * That distinction is the entire reason this module exists. Object-level hiding
 * (`Object3D.visible`, or a zeroed instance matrix) has to answer for a whole
 * model at one point in space, and there is no good point to pick: a mountain
 * scaled 20× either reveals from a spot deep inside its own silhouette — so the
 * player walks into it before it appears — or reveals from bounds so wide that
 * it is on screen before they have been anywhere near it. Both are the same bug
 * seen from opposite ends, and neither can be tuned away, because the model is
 * not in one place.
 *
 * **Projection is X/Z only.** The mask is a top-down field, so a fragment's
 * height is ignored and a peak is masked by the ground beneath it. That is what
 * makes "half of it is under the mask, so half of it is drawn" true.
 *
 * **Hiding is a dithered `discard`, not a fade.** The three ways to remove a
 * fragment are not equivalent here:
 *
 *  - Blending toward the mask's own colour keeps the material opaque and costs
 *    nothing, but only works where the hidden thing is seen *against* the mask.
 *    A peak standing above the horizon would read as a black silhouette on the
 *    sky, which is exactly the scenery this is meant to hide.
 *  - Real alpha (`transparent: true`) is correct against the sky but moves whole
 *    landscapes into the sorted transparent queue, where instanced scenery sorts
 *    badly and overdraw is paid in full.
 *  - Discarding under a dither threshold keeps the material opaque and
 *    depth-correct, is right against sky and ground alike, and pays only the
 *    lookup. The cost is that the transition band is stippled rather than
 *    smooth — invisible in practice, because the band is a few metres wide and
 *    an antialiasing pass resolves it.
 *
 * The dither is {@link https://www.shadertoy.com/view/MtVDla interleaved
 * gradient noise}: one line, no lookup table, and *static in screen space*, so a
 * held camera shows a still pattern instead of boiling noise.
 *
 * Generic on purpose (CLAUDE.md: engine stays project-agnostic). This module
 * knows about a texture, a world span and a threshold range; it does not know
 * what the mask means. Fog of war is one caller.
 */
import {
  DoubleSide,
  Material,
  MeshDepthMaterial,
  RGBADepthPacking,
  Vector2,
  type IUniform,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from "three";

/** The shader param object three.js hands `onBeforeCompile` (uniforms + GLSL sources). */
type ShaderPatch = Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];
/** A material's own `onBeforeCompile`, chained ahead of this patch when one exists. */
type MaterialOnBeforeCompile = MeshStandardMaterial["onBeforeCompile"];

/**
 * `customProgramCacheKey` marker. Patched and unpatched programs must not share
 * a cache entry, or a material compiled before the patch is installed is handed
 * back afterwards with no mask in it.
 */
const WORLD_MASK_CACHE_KEY = "forge-world-mask";

/**
 * Vertex anchor. Present in every material program, and the one place where the
 * instancing and batching matrices are both in scope — see the patch below.
 */
const VERTEX_ANCHOR = "#include <project_vertex>";

/**
 * Fragment anchor: the first statement of `main()` in every material's fragment
 * shader, including `MeshDepthMaterial`'s. Anchoring at the top rather than at
 * the end is deliberate — a discarded fragment should not pay for the lighting
 * that was about to be thrown away.
 */
const FRAGMENT_ANCHOR = "#include <clipping_planes_fragment>";

/**
 * World position, mirroring `project_vertex`'s own sequence exactly.
 *
 * `transformed` is object-local at this point: `project_vertex` applies the
 * batching and instancing matrices to its own `mvPosition` copy and leaves
 * `transformed` alone. Skipping either matrix would put every instance of a
 * batched model at the *model's* origin, which for an authored world means the
 * whole map reads one texel of the mask.
 */
const VERTEX_PATCH = `${VERTEX_ANCHOR}
	vec4 worldMaskPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldMaskPosition = batchingMatrix * worldMaskPosition;
	#endif
	#ifdef USE_INSTANCING
		worldMaskPosition = instanceMatrix * worldMaskPosition;
	#endif
	worldMaskPosition = modelMatrix * worldMaskPosition;
	vWorldMaskPosition = worldMaskPosition.xz;`;

const VERTEX_DECLS = "varying vec2 vWorldMaskPosition;\n";

/**
 * The UV relation is the caller's to match: this is the same mapping the mask's
 * own author uses to place its texels in the world, with the span passed in as a
 * uniform. Getting it wrong is silent — the mask simply lands somewhere else,
 * and the picture stays plausible — so a caller that generates the mask should
 * pin the relation with a test of its own, the way {@link WORLD_MASK_SHADER_SOURCE}
 * lets this module's tests pin the shader.
 *
 * Coordinates are clamped rather than left to the sampler's wrap mode, so a
 * fragment outside the mask's span reads the nearest edge texel no matter how
 * the texture was configured. That is what lets scenery standing *beyond* the
 * masked area inherit the state of the strip it stands behind, instead of
 * wrapping in the far side of the world.
 */
const FRAGMENT_DECLS = `uniform sampler2D tWorldMask;
uniform float worldMaskSpan;
uniform vec2 worldMaskRange;
uniform float worldMaskStrength;
varying vec2 vWorldMaskPosition;

float worldMaskDither( const in vec2 fragment ) {
	return fract( 52.9829189 * fract( dot( fragment, vec2( 0.06711056, 0.00583715 ) ) ) );
}
`;

const FRAGMENT_PATCH = `${FRAGMENT_ANCHOR}
	{
		vec2 worldMaskUv = clamp(
			vec2( 0.5 + vWorldMaskPosition.x / worldMaskSpan, 0.5 - vWorldMaskPosition.y / worldMaskSpan ),
			0.0,
			1.0
		);
		float worldMaskValue = texture2D( tWorldMask, worldMaskUv ).g;
		float worldMaskHidden = smoothstep( worldMaskRange.x, worldMaskRange.y, worldMaskValue ) * worldMaskStrength;
		// Strictly greater, so a strength or mask of exactly zero can never discard
		// (the dither's own range starts at zero) and a mask of one always does.
		if ( worldMaskHidden > worldMaskDither( gl_FragCoord.xy ) ) discard;
	}`;

/** Live uniforms shared by every material one mask drives. */
export interface WorldMaskUniforms {
  /** The mask itself; the patch reads its green channel. */
  readonly tWorldMask: IUniform<Texture | null>;
  /** World-unit width of the square the mask's 0..1 UV range covers, centred on the origin. */
  readonly worldMaskSpan: IUniform<number>;
  /** Mask values below `x` never hide and above `y` always do; between them it dithers. */
  readonly worldMaskRange: IUniform<Vector2>;
  /** Global multiplier; zero disables hiding without recompiling anything. */
  readonly worldMaskStrength: IUniform<number>;
}

export interface WorldMaskOptions {
  readonly span: number;
  readonly rangeLow: number;
  readonly rangeHigh: number;
}

export function createWorldMaskUniforms(options: WorldMaskOptions): WorldMaskUniforms {
  return {
    tWorldMask: { value: null },
    worldMaskSpan: { value: options.span },
    worldMaskRange: { value: new Vector2(options.rangeLow, options.rangeHigh) },
    worldMaskStrength: { value: 1 },
  };
}

/**
 * Install the mask patch on one material.
 *
 * Idempotent: a material already carrying this patch is left alone, so a caller
 * that walks a scene graph where several meshes share a material — the normal
 * case for an instanced authored world — does not stack patches or force
 * needless recompiles.
 *
 * Any `onBeforeCompile` the material already had runs first. The Forge layer
 * blend and the reflection capture both use that hook and anchor on different
 * `#include`s, so the three compose; dropping the prior patch instead would
 * silently flatten a layer-blended surface the moment it came under a mask.
 */
export function applyWorldMask(material: Material, uniforms: WorldMaskUniforms): boolean {
  const target = material as MeshStandardMaterial & { [MASK_FLAG]?: true };
  if (target[MASK_FLAG]) return false;
  const priorPatch: MaterialOnBeforeCompile | null = Object.prototype.hasOwnProperty.call(
    material,
    "onBeforeCompile",
  )
    ? target.onBeforeCompile
    : null;
  const priorCacheKey = Object.prototype.hasOwnProperty.call(material, "customProgramCacheKey")
    ? target.customProgramCacheKey
    : null;
  target.onBeforeCompile = (shader, renderer) => {
    priorPatch?.call(target, shader, renderer);
    patchShader(shader, uniforms);
  };
  target.customProgramCacheKey = () =>
    `${WORLD_MASK_CACHE_KEY}|${priorCacheKey ? priorCacheKey.call(target) : ""}`;
  target[MASK_FLAG] = true;
  material.needsUpdate = true;
  return true;
}

/**
 * Give a mesh a shadow that agrees with what it draws.
 *
 * Without this, hiding is colour-only: a mountain the mask removes still writes
 * the shadow map, so its shadow lies across ground the player *can* see — a
 * mountain-shaped hole in the light with no mountain above it. The stock depth
 * material cannot inherit the patch, because three.js keeps its own internal one
 * per geometry; assigning a patched `customDepthMaterial` is the supported way
 * in.
 *
 * `alphaTest` and its maps are carried across for the usual reason custom depth
 * materials carry them: a cutout leaf whose shadow is cast by its quad reads as
 * a floating rectangle on the ground.
 */
export function applyWorldMaskShadow(mesh: Mesh, uniforms: WorldMaskUniforms): MeshDepthMaterial | null {
  if (mesh.customDepthMaterial) return null;
  const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  const cutout = source as Partial<MeshStandardMaterial> | undefined;
  if (cutout?.alphaTest) {
    depth.alphaTest = cutout.alphaTest;
    depth.map = cutout.map ?? null;
    depth.alphaMap = cutout.alphaMap ?? null;
  }
  if (cutout?.side === DoubleSide) depth.side = DoubleSide;
  applyWorldMask(depth, uniforms);
  mesh.customDepthMaterial = depth;
  return depth;
}

/** Marks a material as already patched, so shared materials are only patched once. */
const MASK_FLAG = "__forgeWorldMask" as const;

function patchShader(shader: ShaderPatch, uniforms: WorldMaskUniforms): void {
  if (
    !shader.vertexShader.includes(VERTEX_ANCHOR) ||
    !shader.fragmentShader.includes(FRAGMENT_ANCHOR)
  ) {
    return;
  }
  shader.uniforms.tWorldMask = uniforms.tWorldMask;
  shader.uniforms.worldMaskSpan = uniforms.worldMaskSpan;
  shader.uniforms.worldMaskRange = uniforms.worldMaskRange;
  shader.uniforms.worldMaskStrength = uniforms.worldMaskStrength;
  shader.vertexShader = `${VERTEX_DECLS}${shader.vertexShader.replace(VERTEX_ANCHOR, VERTEX_PATCH)}`;
  shader.fragmentShader = `${FRAGMENT_DECLS}${shader.fragmentShader.replace(
    FRAGMENT_ANCHOR,
    FRAGMENT_PATCH,
  )}`;
}

/**
 * The GLSL the patch injects, exported so `test:engine` can pin the parts that
 * fail silently: a mask that samples the wrong channel, forgets the instancing
 * matrix, or maps UV differently from the mask's author renders a perfectly
 * plausible picture that is simply wrong, and no type check sees it.
 */
export const WORLD_MASK_SHADER_SOURCE = {
  vertexAnchor: VERTEX_ANCHOR,
  fragmentAnchor: FRAGMENT_ANCHOR,
  vertexPatch: VERTEX_PATCH,
  fragmentPatch: FRAGMENT_PATCH,
  fragmentDecls: FRAGMENT_DECLS,
} as const;
