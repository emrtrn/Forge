/**
 * Minimal CPU-simulated particle effect for the runtime VFX path. Renders a
 * pre-authored effect asset (`.effect.json`) as a `THREE.Points` cloud with soft
 * round, color-tinted particles. Emission is driven by `rate`/`lifetime`; each
 * particle ages out, growing `startSize`→`endSize` and fading. A non-looping
 * effect emits for one `lifetime` window then finishes.
 *
 * Deliberately simple (no textures, no GPU sim, no sub-emitters) — a first VFX
 * version that makes authored effects visible on Play. The class consumes the
 * flat {@link RuntimeParticleEffect} collapsed by `engine/vfx/particleEffectParser`
 * from either schema; parsing/normalization is pure and headless-testable, while
 * this renderer class is Three.js glue like the other render-three modules.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Texture,
  TextureLoader,
  Vector2,
} from "three";

import type { RuntimeParticleEffect, Vec3 } from "../vfx/particleEffectTypes";

/**
 * Per-instance overrides a {@link ParticleEmitterComponent} applies on top of the
 * shared effect asset (VFX Lite §8). All optional; absent means "use the asset's
 * own value", so an emitter with no overrides renders identically to the asset.
 */
export interface ParticleEffectOverrides {
  /** Uniform scale on particle size, spawn spread and velocity (default 1). */
  scale?: number;
  /** Hex tint (`#rrggbb`) replacing the effect's colour. */
  tint?: string;
  /** Force looping on/off for this instance; absent keeps the asset's own loop. */
  loop?: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const clampMin0 = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

// Back-compat aliases: the runtime path (RuntimeSceneApp) and tests reference the
// flat runtime effect + the normalize→collapse entry point through these names.
export {
  normalizeEffectDefinition,
  parseRuntimeParticleEffect,
  parseRuntimeParticleEffect as parseEffectDefinition,
  toRuntimeParticleEffect,
} from "../vfx/particleEffectParser";
export type { RuntimeParticleEffect as EffectDefinition } from "../vfx/particleEffectTypes";
export type { ParticleBlendMode as EffectMaterialMode } from "../vfx/particleEffectTypes";

const POINT_PIXEL_SCALE = 320;

const VERTEX_SHADER = `
attribute float aSize;
attribute float aAlpha;
attribute float aLifeT;
varying float vAlpha;
varying float vLifeT;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vLifeT = aLifeT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (uScale / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

// Textures are loaded with flipY = false, so gl_PointCoord (top-left origin) maps
// straight to image space: no per-axis flip, and a SubUV atlas indexes frame 0 at
// the top-left cell. A 1×1 grid samples the whole texture (single sprite, Faz 6a).
const FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uHasTexture;
uniform vec2 uSubUV;
varying float vAlpha;
varying float vLifeT;
void main() {
  if (uHasTexture > 0.5) {
    vec2 cell = 1.0 / uSubUV;
    float frames = uSubUV.x * uSubUV.y;
    float f = min(floor(vLifeT * frames), frames - 1.0);
    float col = mod(f, uSubUV.x);
    float row = floor(f / uSubUV.x);
    vec2 uv = (vec2(col, row) + gl_PointCoord) * cell;
    vec4 tex = texture2D(uMap, uv);
    gl_FragColor = vec4(uColor * tex.rgb, vAlpha * tex.a);
  } else {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, dist);
    gl_FragColor = vec4(uColor, vAlpha * soft);
  }
}
`;

/** A live, CPU-simulated instance of an effect definition, ready to add to a scene. */
export class ParticleEffect {
  readonly object3D: Points;
  /** The base asset; retained so {@link reset} can re-apply new overrides on reuse. */
  private readonly definition: RuntimeParticleEffect;
  // Buffer capacity + rate/lifetime are fixed by the definition (scale never grows
  // them), so a pooled instance can be reset with new overrides in place.
  private readonly capacity: number;
  private readonly lifetime: number;
  private readonly rate: number;
  // Authored opacity ramp + fade windows. Not override-affected, so they are read
  // once from the definition; the defaults reproduce the old linear 1 → 0 ramp.
  private readonly startOpacity: number;
  private readonly endOpacity: number;
  private readonly fadeInTime: number;
  private readonly fadeOutTime: number;
  // Effective (override-applied) simulation params; recomputed by applyOverrides.
  private loop: boolean;
  private startSize: number;
  private endSize: number;
  private velocity: Vec3;
  private spread: number;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  /** Per-particle life fraction (age/lifetime, 0→1); drives the flipbook frame. */
  private readonly lifeTs: Float32Array;
  private readonly velocities: Float32Array;
  /** Per-particle age in seconds; negative marks an inactive slot. */
  private readonly ages: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  /** Loaded sprite texture (VFX Lite Faz 6a), or null for the procedural sprite. */
  private texture: Texture | null = null;
  private readonly origin: [number, number, number] = [0, 0, 0];
  private elapsed = 0;
  private spawnAccumulator = 0;
  /** Global density multiplier on the spawn rate (quality knob, 1 = authored). */
  private densityScale = 1;
  /** Authored burst, or 0 particles for a pure rate emitter. */
  private readonly burstCount: number;
  private readonly burstDelay: number;
  /** Whether this play has already released its burst; cleared by {@link reset}. */
  private burstFired = false;

  /**
   * @param textureUrl Resolved sprite-texture URL (the app boundary turns the
   *   definition's texture asset id into a URL). Absent/null keeps the procedural
   *   soft-round sprite. Loaded asynchronously; the sprite pops in when ready.
   */
  constructor(
    definition: RuntimeParticleEffect,
    overrides?: ParticleEffectOverrides,
    textureUrl?: string | null,
  ) {
    this.definition = definition;
    this.lifetime = definition.lifetime;
    this.rate = definition.rate;
    this.startOpacity = clamp01(definition.startOpacity ?? 1);
    this.endOpacity = clamp01(definition.endOpacity ?? 0);
    this.fadeInTime = clampMin0(definition.fadeInTime ?? 0);
    this.fadeOutTime = clampMin0(definition.fadeOutTime ?? 0);
    // Effective params default to the un-scaled asset; applyOverrides() below
    // re-derives them (and the shader colour) from `overrides`.
    this.loop = definition.loop;
    this.startSize = definition.startSize;
    this.endSize = definition.endSize;
    this.velocity = [...definition.velocity];
    this.spread = definition.spread;
    this.burstCount = Math.max(0, Math.round(definition.burst?.count ?? 0));
    this.burstDelay = clampMin0(definition.burst?.delay ?? 0);
    // Max particles alive at once ≈ rate * lifetime, plus a burst that lands all
    // at once; pad for spawn jitter. The burst term is not optional padding — a
    // capacity that cannot hold it would silently drop the tail of every blast.
    this.capacity = Math.max(8, Math.ceil(this.rate * this.lifetime) + this.burstCount + 4);
    this.positions = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);
    this.lifeTs = new Float32Array(this.capacity);
    this.velocities = new Float32Array(this.capacity * 3);
    this.ages = new Float32Array(this.capacity).fill(-1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute("aLifeT", new BufferAttribute(this.lifeTs, 1));
    const subUV = definition.subUV ?? { cols: 1, rows: 1 };
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(definition.color) },
        uScale: { value: POINT_PIXEL_SCALE },
        uMap: { value: null },
        uHasTexture: { value: 0 },
        uSubUV: { value: new Vector2(subUV.cols, subUV.rows) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      // Blend comes from the definition, so it is constant across pool reuse.
      blending: definition.materialMode === "additive" ? AdditiveBlending : NormalBlending,
    });
    this.applyOverrides(overrides);
    if (textureUrl) this.loadTexture(textureUrl);
    this.object3D = new Points(this.geometry, this.material);
    // Particles move past the emitter origin; skip frustum culling so the cloud
    // is not clipped by its (stationary) bounding sphere.
    this.object3D.frustumCulled = false;
  }

  /** Loads the sprite texture and binds it to the shader once it arrives. */
  private loadTexture(url: string): void {
    new TextureLoader().load(url, (texture) => {
      // flipY = false so gl_PointCoord (top-left) maps straight to image space and
      // a SubUV atlas indexes frame 0 at the top-left cell (see FRAGMENT_SHADER).
      texture.flipY = false;
      texture.needsUpdate = true;
      this.texture = texture;
      this.material.uniforms.uMap!.value = texture;
      this.material.uniforms.uHasTexture!.value = 1;
    });
  }

  /**
   * Re-derives the override-affected params from `overrides`: `scale` uniformly
   * grows sizes/spread/velocity (so particles reach a proportionally larger extent
   * in the same lifetime — capacity is unchanged), `tint` recolours the shader,
   * and `loop` overrides the asset's own loop flag. Called by the constructor and
   * by {@link reset} (pool reuse). Absent fields fall back to the asset value.
   */
  private applyOverrides(overrides?: ParticleEffectOverrides): void {
    const d = this.definition;
    const scale =
      typeof overrides?.scale === "number" && Number.isFinite(overrides.scale) && overrides.scale > 0
        ? overrides.scale
        : 1;
    this.loop = overrides?.loop ?? d.loop;
    this.startSize = d.startSize * scale;
    this.endSize = d.endSize * scale;
    this.velocity = [d.velocity[0] * scale, d.velocity[1] * scale, d.velocity[2] * scale];
    this.spread = d.spread * scale;
    const color =
      typeof overrides?.tint === "string" && HEX_COLOR.test(overrides.tint) ? overrides.tint : d.color;
    (this.material.uniforms.uColor!.value as Color).set(color);
  }

  /**
   * Rewinds this instance to a fresh, un-emitted state and applies a new set of
   * overrides — so a pooled effect can be reused for another play without a new
   * allocation. Same definition (hence same capacity/blend), so only the buffers,
   * timers and override-derived params are reset.
   */
  reset(overrides?: ParticleEffectOverrides): void {
    this.applyOverrides(overrides);
    this.elapsed = 0;
    this.spawnAccumulator = 0;
    this.burstFired = false;
    this.ages.fill(-1);
    this.positions.fill(0);
    this.sizes.fill(0);
    this.alphas.fill(0);
    this.lifeTs.fill(0);
    this.velocities.fill(0);
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.aSize!.needsUpdate = true;
    this.geometry.attributes.aAlpha!.needsUpdate = true;
    this.geometry.attributes.aLifeT!.needsUpdate = true;
  }

  /**
   * Sets the global density multiplier on the spawn rate (a runtime quality
   * knob): `1` keeps the authored rate, `0` suppresses emission entirely, and a
   * fraction thins the cloud without touching the buffer. Clamps bad input to 1.
   * Applied on top of the per-instance `scale` override.
   */
  setDensityScale(scale: number): void {
    this.densityScale = Number.isFinite(scale) && scale >= 0 ? scale : 1;
  }

  /** Sets the emitter origin (world space) new particles spawn from. */
  setOrigin(x: number, y: number, z: number): void {
    this.origin[0] = x;
    this.origin[1] = y;
    this.origin[2] = z;
  }

  /** Advances the simulation by `dt` seconds and uploads the updated buffers. */
  update(dt: number): void {
    if (dt <= 0) return;
    const { lifetime, rate, startSize, endSize, loop } = this;
    this.elapsed += dt;

    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! < 0) continue;
      const age = this.ages[i]! + dt;
      if (age >= lifetime) {
        this.ages[i] = -1;
        this.sizes[i] = 0;
        this.alphas[i] = 0;
        continue;
      }
      this.ages[i] = age;
      const t = age / lifetime;
      const base = i * 3;
      this.positions[base] = this.positions[base]! + this.velocities[base]! * dt;
      this.positions[base + 1] = this.positions[base + 1]! + this.velocities[base + 1]! * dt;
      this.positions[base + 2] = this.positions[base + 2]! + this.velocities[base + 2]! * dt;
      this.sizes[i] = startSize + (endSize - startSize) * t;
      this.alphas[i] = this.opacityAt(age, t);
      this.lifeTs[i] = t;
    }

    // The burst goes out whole, on the first tick at or past its delay — this is
    // the frame the effect was played on when the delay is 0, which is what makes
    // a blast land with the blow instead of trailing it.
    if (!this.burstFired && this.burstCount > 0 && this.elapsed >= this.burstDelay) {
      this.burstFired = true;
      // Thinned by the same quality knob as the rate below: a low-density setting
      // must reduce the blast, not exempt it.
      const count = Math.round(this.burstCount * this.densityScale);
      for (let i = 0; i < count; i += 1) this.spawnParticle();
    }

    // A looping effect emits forever; a one-shot emits for one lifetime window.
    if (loop || this.elapsed <= lifetime) {
      // Density scales the emission rate (fewer particles → less fill/overdraw);
      // capacity is unchanged, but the alive count falls proportionally.
      this.spawnAccumulator += rate * this.densityScale * dt;
      while (this.spawnAccumulator >= 1) {
        this.spawnAccumulator -= 1;
        this.spawnParticle();
      }
    }

    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.aSize!.needsUpdate = true;
    this.geometry.attributes.aAlpha!.needsUpdate = true;
    this.geometry.attributes.aLifeT!.needsUpdate = true;
  }

  /**
   * Per-particle alpha at `age` seconds (life fraction `t`): the authored
   * start→end opacity ramp, multiplied by the fade-in window measured from birth
   * and the fade-out window measured into death. The two windows are independent
   * multipliers, so overlapping them on a short lifetime lowers the peak rather
   * than fighting over the curve.
   */
  private opacityAt(age: number, t: number): number {
    let alpha = this.startOpacity + (this.endOpacity - this.startOpacity) * t;
    if (this.fadeInTime > 0) alpha *= Math.min(1, age / this.fadeInTime);
    if (this.fadeOutTime > 0) alpha *= Math.min(1, (this.lifetime - age) / this.fadeOutTime);
    return clamp01(alpha);
  }

  /** A non-looping effect is finished once it stopped emitting and all particles died. */
  isFinished(): boolean {
    if (this.loop) return false;
    // A burst still owed is work outstanding, however long the effect has run:
    // a delay past the lifetime would otherwise see the instance recycled before
    // it ever emitted, and the blast would simply never appear.
    if (!this.burstFired && this.burstCount > 0) return false;
    if (this.elapsed <= this.lifetime) return false;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! >= 0) return false;
    }
    return true;
  }

  /** Particles currently alive (age >= 0). Preview/diagnostics only. */
  aliveCount(): number {
    let alive = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! >= 0) alive += 1;
    }
    return alive;
  }

  /** Max particles this instance can hold at once (simulation buffer size). */
  get maxCapacity(): number {
    return this.capacity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.texture = null;
  }

  private spawnParticle(): void {
    let slot = -1;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! < 0) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return;
    const { spread, velocity, startSize } = this;
    const jitter = (): number => (Math.random() * 2 - 1) * spread;
    this.ages[slot] = 0;
    this.positions[slot * 3] = this.origin[0] + jitter() * 0.2;
    this.positions[slot * 3 + 1] = this.origin[1];
    this.positions[slot * 3 + 2] = this.origin[2] + jitter() * 0.2;
    this.velocities[slot * 3] = velocity[0] + jitter();
    this.velocities[slot * 3 + 1] = velocity[1] + (Math.random() * 2 - 1) * spread * 0.3;
    this.velocities[slot * 3 + 2] = velocity[2] + jitter();
    this.sizes[slot] = startSize;
    // Birth alpha comes from the same curve, so a fade-in starts at 0 instead of
    // flashing at full opacity for the frame between spawn and the next update.
    this.alphas[slot] = this.opacityAt(0, 0);
    this.lifeTs[slot] = 0;
  }
}
