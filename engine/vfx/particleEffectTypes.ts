/**
 * VFX Lite — particle effect asset types.
 *
 * Two shapes live here:
 *
 * 1. {@link ParticleEffectDefinition} — the *normalized* rich authoring form
 *    (schema-2 shaped, fully defaulted). This is the single internal
 *    representation the editor, validation, and (later) the full CPU simulation
 *    speak. Both schema-1 and schema-2 asset files normalize into it.
 *
 * 2. {@link RuntimeParticleEffect} — the *flat* runtime contract the current
 *    simple `THREE.Points` renderer consumes. A best-effort collapse of the
 *    normalized form (see `toRuntimeParticleEffect`). Deliberately narrow: the
 *    first renderer only does continuous-rate emission, a single size lerp, one
 *    tint, and linear spread jitter. Richer authoring fields (ranges, burst
 *    shapes, start/end colour, curves) are stored but not yet honoured by this
 *    renderer — they light up as the simulation grows (VFX Lite Faz 3+).
 *
 * This module knows nothing about the DOM or Three.js; it is pure data, so it
 * lives under `engine/vfx/` per the plan's layering rules (§9).
 */

export type Vec3 = [number, number, number];
/** An inclusive `[min, max]` range; `min <= max` after normalization. */
export type NumberRange = [number, number];

export type SpawnMode = "rate" | "burst";
export type SpawnShape = "point" | "sphere" | "box" | "circle";
export type RendererType = "sprite" | "mesh";
export type ParticleBlendMode = "alpha" | "additive";
export type ParticleMeshMaterialMode = "source" | "tint";
/** How a mesh emitter picks a source among its models on each spawn. */
export type ParticleMeshSelectionMode = "random" | "sequence";
export type SortMode = "none" | "distance";
export type BoundsMode = "fixed" | "autoPreview";

export interface ParticleBounds {
  mode: BoundsMode;
  min: Vec3;
  max: Vec3;
  showInPreview: boolean;
}

export interface ParticleSystemBlock {
  enabled: boolean;
  loop: boolean;
  /** Spawn-phase duration in seconds (how long a one-shot keeps emitting). */
  duration: number;
  /** Deterministic-preview seed, or null for a random seed each play. */
  seed: number | null;
  maxParticles: number;
  bounds: ParticleBounds;
}

export interface ParticleSpawnBlock {
  mode: SpawnMode;
  /** Particles per second (rate mode). */
  rate: number;
  /** Particles per burst (burst mode). */
  count: number;
  delay: number;
  interval: number;
  shape: SpawnShape;
  radius: number;
  boxSize: Vec3;
}

export interface ParticleInitializeBlock {
  lifetime: NumberRange;
  startSize: NumberRange;
  startColor: string;
  startOpacity: number;
  direction: Vec3;
  speed: NumberRange;
  spreadAngleDeg: number;
  rotation: NumberRange;
  angularVelocity: NumberRange;
}

export interface ParticleUpdateBlock {
  gravityScale: number;
  drag: number;
  acceleration: Vec3;
  endSize: NumberRange;
  endColor: string;
  endOpacity: number;
  fadeInTime: number;
  fadeOutTime: number;
}

/**
 * A sprite-sheet (flipbook) grid: the texture is `cols × rows` frames animated
 * over a particle's life (VFX Lite Faz 6b). `{ cols: 1, rows: 1 }` (the default)
 * means "whole texture, no animation" — so a single-sprite texture is just the
 * degenerate 1×1 flipbook.
 */
export interface SubUVGrid {
  cols: number;
  rows: number;
}

export interface ParticleSpriteRendererBlock {
  type: "sprite";
  blendMode: ParticleBlendMode;
  softness: number;
  sortMode: SortMode;
  /**
   * Optional sprite texture, referenced as a manifest texture asset id (matching
   * the material convention). `null` keeps the procedural soft-round sprite. The
   * id → URL → `THREE.Texture` resolution happens at the app boundary that owns
   * the manifest (VFX Lite Faz 6a); `engine/vfx` stays manifest-free.
   */
  texture: string | null;
  /** Flipbook grid for the sprite texture; `{1,1}` = no animation (Faz 6b). */
  subUV: SubUVGrid;
}

/**
 * Renders each live particle as a shared, manifest-backed static-model instance.
 * `modelIds` never stores a URL/path: host code resolves these ids against its
 * asset manifest before it allows a GLTF load, and the normalizer additionally
 * refuses anything that *looks* like a path or URL (see `isModelAssetId`), so a
 * hand-edited asset cannot smuggle one past a lenient host resolver.
 */
export interface ParticleMeshRendererBlock {
  type: "mesh";
  /** One or more manifest static-mesh ids selected by the emitter on spawn. */
  modelIds: string[];
  /** `random` picks any source per particle; `sequence` cycles them in list order. */
  modelSelection: ParticleMeshSelectionMode;
  /** Keep source materials or permit the renderer's future per-instance tint path. */
  materialMode: ParticleMeshMaterialMode;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Per-effect upper bound, applied in addition to `system.maxParticles`. */
  maxModelParticles: number;
}

export type ParticleRendererBlock = ParticleSpriteRendererBlock | ParticleMeshRendererBlock;

/** The normalized, fully-defaulted authoring form (schema-2 shaped). */
export interface ParticleEffectDefinition {
  name: string;
  category: string;
  tags: string[];
  system: ParticleSystemBlock;
  spawn: ParticleSpawnBlock;
  initialize: ParticleInitializeBlock;
  update: ParticleUpdateBlock;
  renderer: ParticleRendererBlock;
}

/**
 * The flat shape the simple `THREE.Points` renderer simulates. Collapsed from a
 * {@link ParticleEffectDefinition}; see `toRuntimeParticleEffect`.
 */
export interface RuntimeParticleEffect {
  name?: string;
  /** Renderer selected by the authored asset; absent means legacy sprite. */
  rendererType?: RendererType;
  loop: boolean;
  /** Particles spawned per second. Zero on a burst effect, which emits no trickle. */
  rate: number;
  /**
   * Burst emission: `count` particles released together, `delay` seconds after
   * the effect starts. Present only for `spawn.mode: "burst"` assets.
   *
   * This is what makes an explosion read as a hit rather than as a cloud fading
   * up. It used to be approximated as a continuous rate of `count / lifetime`,
   * which put the *first* particle a whole `lifetime / count` seconds after the
   * blow — half a second on a ten-particle burst, long enough that the blast
   * looked like it belonged to something else.
   */
  burst?: { count: number; delay: number };
  /** Particle lifetime in seconds. */
  lifetime: number;
  /** Authored upper bound for live particles; renderers must never exceed it. */
  maxParticles?: number;
  startSize: number;
  endSize: number;
  velocity: Vec3;
  /** Random linear spread applied to spawn velocity/position. */
  spread: number;
  materialMode: ParticleBlendMode;
  /** Particle tint (hex `#rrggbb`). */
  color: string;
  /**
   * Sprite opacity ramp over a particle's life, gated by the fade windows below.
   * All four are optional and their defaults (1 → 0, no fades) reproduce the plain
   * linear `1 - t` ramp the sprite renderer used before opacity was authorable.
   */
  startOpacity?: number;
  endOpacity?: number;
  /** Seconds spent ramping up from 0 at birth; 0 = the particle pops in at full. */
  fadeInTime?: number;
  /** Seconds spent ramping down to 0 before death; 0 = it pops out. */
  fadeOutTime?: number;
  /** Optional sprite texture asset id; absent renders the procedural sprite. */
  texture?: string;
  /** Flipbook grid; present only when animating (`cols*rows > 1`), Faz 6b. */
  subUV?: SubUVGrid;
  /** Manifest static-mesh ids; populated only for `rendererType: "mesh"`. */
  modelIds?: string[];
  /** Per-spawn source pick policy for mesh effects (default `random`). */
  meshModelSelection?: ParticleMeshSelectionMode;
  /** Mesh renderer material policy; populated only for mesh effects. */
  meshMaterialMode?: ParticleMeshMaterialMode;
  castShadow?: boolean;
  receiveShadow?: boolean;
  maxModelParticles?: number;
  gravityScale?: number;
  drag?: number;
  acceleration?: Vec3;
  rotation?: NumberRange;
  angularVelocity?: NumberRange;
}
