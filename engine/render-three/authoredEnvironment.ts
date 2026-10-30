/**
 * The authored environment singletons, applied identically by every shell that
 * renders a Forge Level: the Sky Atmosphere dome, the Sky Light (IBL) capture,
 * Exponential Height Fog, and the Cloud Layer.
 *
 * **Why this exists next to {@link LevelRuntime} rather than inside it.** The two
 * answer different halves of the same question and neither replaces the other:
 *
 *  - `LevelRuntime` owns the *order* — which content groups are built, and in
 *    what sequence, so the editor viewport and the runtime agree about
 *    dependencies (reflections before the surfaces that sample them, landscape
 *    before the water that follows it).
 *  - This owns the *implementation* of one of those groups. Before it, each
 *    shell had its own copy of "how do I put a sky dome in a scene", and the
 *    copies had already drifted in three places: the runtime left a stale sky
 *    dome standing when a rebuilt level authored none, did the same with the
 *    cloud dome, and skipped the probe-envmap rebind the editor did after a Sky
 *    Light Capture change. Every one of those is invisible in the shell that is
 *    right and only shows up in the other one, which is the failure mode a
 *    shared step ordering cannot catch: the steps ran in the correct order, and
 *    two of them did different things.
 *
 * The host keeps what is genuinely its own. Background/ambient world settings
 * stay with the shell (they are coupled to its light teardown) and so does the
 * Post Process pipeline (it is quality-gated in the runtime and viewport-sized
 * in the editor). Post Process's one hook into this layer — the sky dome's local
 * tone-mapping exposure — is exposed as {@link applySkyPostProcessExposure} so
 * the owner keeps driving it.
 */
import { Color, Fog, FogExp2, Mesh, Vector3 } from "three";
import type {
  AmbientLight,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { Sky } from "three/examples/jsm/objects/Sky.js";

import {
  applySkySunDirection,
  applySkyToneMapping,
  applySkyUniforms,
  createSkyObject,
  followCameraWithSky,
  resolveSkyAtmosphere,
  setSkyLocalToneMappingExposure,
  skyAtmosphereToneMappingExposure,
  sunDirectionFromLightRotation,
} from "./skyAtmosphere";
import { applySceneFog, resolveHeightFog } from "./heightFog";
import {
  advanceCloudTime,
  applyCloudUniforms,
  createCloudObject,
  followCameraWithClouds,
  resolveCloudLayer,
  type CloudDome,
} from "./cloudLayer";
import {
  applyReflectionEnvironment,
  captureSkyEnvironment,
  resolveReflection,
} from "./reflection";
import { postProcessToneMappingExposure, type ResolvedPostProcess } from "./postProcess";
import { readRotation } from "../scene/transform";
import type { LayoutLightActor, RoomLayout } from "../scene/layout";
import {
  resolveEnvironment,
  type ResolvedEnvironment,
  type WorldEnvironmentState,
} from "../environment/environmentResolve";
import { shouldRecapture, type CaptureRecord } from "../environment/recapturePolicy";
import { normalizeWorldEnvironment, resolveWorldEnvironment } from "../environment/worldEnvironment";
import type { ResolvedHeightFog } from "../scene/heightFog";

/** What a shell hands {@link AuthoredEnvironment.applyWorldEnvironment} each frame. */
export interface WorldEnvironmentFrame {
  /** The live WES state (editor preview / Play capability); null = no state, authored look. */
  state: WorldEnvironmentState | null;
  /** Real milliseconds, for the IBL recapture interval. */
  nowMs: number;
  /** The editor clock slider is being dragged: no IBL capture until release. */
  scrubbing?: boolean;
  /** The Sun's three light, overridden in place (never the layout actor). */
  sun: DirectionalLight | null;
  ambient: AmbientLight | null;
}

export interface WorldEnvironmentFrameResult {
  /** A World Environment override is being rendered this frame. */
  active: boolean;
  /** The Sun light's direction changed: a shell fitting its shadow to scene bounds refits. */
  sunMoved: boolean;
}

/** Host resources + callbacks an {@link AuthoredEnvironment} draws into. */
export interface AuthoredEnvironmentDeps {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  /**
   * The camera the sky and cloud domes follow.
   *
   * A getter rather than a reference because the editor swaps cameras (viewport
   * vs. a previewed Camera actor) while the environment stays put; a captured
   * reference would leave the dome centred on whichever camera happened to be
   * active when the level loaded.
   */
  readonly camera: () => PerspectiveCamera;
  /**
   * Resolves the scene's Sun (directional) light actor — its persisted rotation
   * is the source of truth for the sun disc *and* the IBL capture direction, so
   * Play matches the editor. Returning null leaves the sky lit from straight
   * overhead (the reflection fallback).
   */
  readonly resolveSunActor: () => LayoutLightActor | null;
  /**
   * Called after `scene.environment` changes, so a shell holding Sphere
   * Reflection Capture probes can rebind the global env map those probes fade
   * toward at their boundary. Optional: a shell with no probes passes nothing.
   */
  readonly onEnvironmentChanged?: () => void;
}

export class AuthoredEnvironment {
  private readonly scene: Scene;
  private readonly renderer: WebGLRenderer;
  private readonly camera: () => PerspectiveCamera;
  private readonly resolveSunActor: () => LayoutLightActor | null;
  private readonly onEnvironmentChanged: (() => void) | null;

  /** Sky Atmosphere dome (singleton); null when no sky actor is in the layout. */
  private skyObject: Sky | null = null;
  private cloudObject: CloudDome | null = null;
  /** Captured Sky Light environment (PMREM) backing `scene.environment`; null when none. */
  private reflectionTarget: WebGLRenderTarget | null = null;
  /** The World Environment override rendered this frame; null renders the authored look. */
  private override: ResolvedEnvironment | null = null;
  private lastCapture: CaptureRecord | null = null;
  private readonly sunSlot = new SunLightOverride();
  private readonly ambientSlot = new NumberOverride();
  private readonly exposureSlot = new NumberOverride();
  private ambientTarget: AmbientLight | null = null;
  /** The sky dome's authored local tone-mapping exposure (null = follows the renderer). */
  private skyLocalExposure: number | null = null;

  constructor(deps: AuthoredEnvironmentDeps) {
    this.scene = deps.scene;
    this.renderer = deps.renderer;
    this.camera = deps.camera;
    this.resolveSunActor = deps.resolveSunActor;
    this.onEnvironmentChanged = deps.onEnvironmentChanged ?? null;
  }

  /** The live sky dome, for a shell that still owns something coupled to it. */
  get sky(): Sky | null {
    return this.skyObject;
  }

  /**
   * Renders the Sky Atmosphere dome. The directional Sun light is the source of
   * truth for the sun: its persisted rotation places the sun disc.
   *
   * An absent actor **removes** the dome rather than merely resetting tone
   * mapping. That is the editor's behaviour, and it is the correct one for both
   * shells: deleting the actor must clear the sky, and a level rebuilt into a
   * layout that authors no sky must not inherit the last one's.
   */
  applySky(layout: RoomLayout | null): void {
    const actor = layout?.skyAtmosphere ?? null;
    if (!actor) {
      this.disposeSky();
      applySkyToneMapping(this.renderer, null);
      return;
    }
    const resolved = resolveSkyAtmosphere(actor);
    if (!this.skyObject) {
      this.skyObject = createSkyObject();
      this.scene.add(this.skyObject);
    }
    applySkyUniforms(this.skyObject, this.withSkyOverride(resolved));
    this.applySunDirection();
    followCameraWithSky(this.skyObject, this.camera());
    applySkyToneMapping(this.renderer, resolved);
  }

  /**
   * Re-reads the Sun light's rotation and repositions the sun disc / horizon
   * glow. Cheap, so the editor calls it from the render loop: rotating the Sun
   * with the gizmo moves the sky live.
   */
  applySunDirection(): void {
    if (!this.skyObject) return;
    const direction = this.sunDirection();
    if (direction) applySkySunDirection(this.skyObject, direction);
  }

  /** Ground → sun: the World Environment's while it is active, else the Sun light's rotation. */
  private sunDirection(): Vector3 | null {
    if (this.override) return new Vector3(...this.override.sunDirection);
    const sun = this.resolveSunActor();
    return sun ? sunDirectionFromLightRotation(readRotation(sun)) : null;
  }

  /**
   * Whether the Level authors a Sky Light (IBL) contribution — i.e. a non-hidden
   * Sky Atmosphere. A shell with a fallback ambient light queries this to retire
   * that fallback once the authored sky supplies the ambient bounce; otherwise
   * the two stack and wash the scene out.
   */
  hasAuthoredSkyLight(layout: RoomLayout | null): boolean {
    const actor = layout?.skyAtmosphere ?? null;
    if (!actor) return false;
    return !resolveSkyAtmosphere(actor).hidden;
  }

  /** Applies the Exponential Height Fog to `scene.fog` (distance-based). */
  applyFog(layout: RoomLayout | null): void {
    const actor = layout?.heightFog ?? null;
    applySceneFogInPlace(this.scene, actor ? (this.override?.fog ?? resolveHeightFog(actor)) : null);
  }

  /** Builds the static Cloud Layer dome; an absent actor removes it (see {@link applySky}). */
  applyClouds(layout: RoomLayout | null): void {
    const actor = layout?.cloudLayer ?? null;
    if (!actor) {
      this.disposeClouds();
      return;
    }
    const resolved = this.override?.cloud ?? resolveCloudLayer(actor);
    if (!this.cloudObject) {
      this.cloudObject = createCloudObject();
      this.scene.add(this.cloudObject);
    }
    applyCloudUniforms(this.cloudObject, resolved);
    followCameraWithClouds(this.cloudObject, this.camera());
  }

  /**
   * Captures the authored sky once and uses it as the global PBR environment /
   * ambient bounce wherever no local Sphere Reflection Capture applies. Pass
   * `recapture` to force a fresh cubemap render (the sun or the sky changed).
   *
   * `onEnvironmentChanged` fires afterwards in both directions — a capture and a
   * clear are both a change to the global env that probe boundary-blending fades
   * toward, and a shell that only rebound on capture would leave its probes
   * fading toward a freed target.
   */
  applyReflection(layout: RoomLayout | null, recapture = false): void {
    const skyActor = layout?.skyAtmosphere ?? null;
    const sky = skyActor ? resolveSkyAtmosphere(skyActor) : null;
    if (!sky || sky.hidden) {
      this.disposeReflectionTarget();
      applyReflectionEnvironment(this.scene, null, null);
      this.onEnvironmentChanged?.();
      return;
    }

    if (recapture || !this.reflectionTarget) {
      this.disposeReflectionTarget();
      const sunDirection = this.sunDirection() ?? new Vector3(0, 1, 0);
      this.reflectionTarget = captureSkyEnvironment(this.renderer, this.withSkyOverride(sky), sunDirection);
    }

    applyReflectionEnvironment(
      this.scene,
      this.reflectionTarget,
      resolveReflection(sky.skyLightCapture),
    );
    this.onEnvironmentChanged?.();
  }

  /**
   * Couples the sky dome's local tone-mapping exposure to the authored Post
   * Process. The owner keeps the Post Process pipeline (quality-gated in the
   * runtime, viewport-sized in the editor) and calls this after resolving it so
   * the sky matches the composited exposure.
   */
  applySkyPostProcessExposure(post: ResolvedPostProcess | null, layout: RoomLayout | null): void {
    if (!this.skyObject) return;
    const sky = layout?.skyAtmosphere ? resolveSkyAtmosphere(layout.skyAtmosphere) : null;
    if (!sky || sky.hidden || !post || post.hidden) {
      this.skyLocalExposure = null;
      setSkyLocalToneMappingExposure(this.skyObject, null);
      return;
    }
    this.skyLocalExposure = postProcessToneMappingExposure(post.exposure) * skyAtmosphereToneMappingExposure(sky.exposure);
    setSkyLocalToneMappingExposure(this.skyObject, this.skyLocalExposure * (this.override?.exposureMultiplier ?? 1));
  }

  /**
   * Per frame: renders the World Environment (WES v0.3 §4.4) as an override of
   * the authored actors — the sky's sun and haze, fog, clouds, the Sun's three
   * light, ambient and exposure — and re-captures the Sky Light by
   * {@link shouldRecapture}. The layout is never written.
   *
   * A level with no World Environment, a hidden one, or no `state` renders the
   * authored look; the frame the override ends restores every value it changed.
   * The Sun light, ambient and exposure keep their authored base by noticing
   * when the shell rewrites them (an edit, a quality change) and re-reading it.
   */
  applyWorldEnvironment(layout: RoomLayout | null, frame: WorldEnvironmentFrame): WorldEnvironmentFrameResult {
    const actor = layout?.worldEnvironment;
    const env = actor ? resolveWorldEnvironment(normalizeWorldEnvironment(actor).environment) : null;
    const wasActive = this.override !== null;
    if (!env || env.hidden || !frame.state) {
      if (!wasActive) return { active: false, sunMoved: false };
      this.override = null;
      this.lastCapture = null;
      const sunMoved = frame.sun ? this.sunSlot.restore(frame.sun) : false;
      this.restoreAmbient();
      this.restoreExposure();
      // Only the sky's uniforms: applySky would also reset tone mapping, which
      // the shell's Post Process owns after it.
      const authoredSky = layout?.skyAtmosphere ? resolveSkyAtmosphere(layout.skyAtmosphere) : null;
      if (this.skyObject && authoredSky) applySkyUniforms(this.skyObject, authoredSky);
      this.applySunDirection();
      this.applyFog(layout);
      this.applyClouds(layout);
      this.applyReflection(layout, true);
      return { active: false, sunMoved };
    }

    const skyActor = layout?.skyAtmosphere ?? null;
    const sky = skyActor ? resolveSkyAtmosphere(skyActor) : null;
    const sunBase = frame.sun ? this.sunSlot.base(frame.sun) : null;
    this.override = resolveEnvironment({
      // The light's own (authored) color multiplies the curve when applied.
      sun: sunBase ? { color: "#ffffff", intensity: sunBase.intensity } : null,
      sky: sky ? { turbidity: sky.turbidity, hidden: sky.hidden } : null,
      fog: layout?.heightFog ? resolveHeightFog(layout.heightFog) : null,
      cloud: layout?.cloudLayer ? resolveCloudLayer(layout.cloudLayer) : null,
    }, env, frame.state);

    if (this.skyObject && sky) applySkyUniforms(this.skyObject, this.withSkyOverride(sky));
    this.applySunDirection();
    this.applyFog(layout);
    if (this.cloudObject && this.override.cloud) applyCloudUniforms(this.cloudObject, this.override.cloud);
    const sunMoved = frame.sun && this.override.light ? this.sunSlot.apply(frame.sun, this.override.light) : false;
    this.applyAmbient(frame.ambient, this.override.ambientMultiplier);
    this.applyExposure(this.override.exposureMultiplier);

    const capture = {
      sunDirection: this.override.sunDirection,
      captureKey: this.override.captureKey,
      nowMs: frame.nowMs,
      scrubbing: frame.scrubbing === true,
      immediate: !wasActive,
    };
    if (sky && !sky.hidden && shouldRecapture(this.lastCapture, capture)) {
      this.applyReflection(layout, true);
      this.lastCapture = { sunDirection: capture.sunDirection, captureKey: capture.captureKey, timeMs: frame.nowMs };
    }
    return { active: true, sunMoved };
  }

  /** The World Environment override rendered last frame (null = authored look), for tests and diagnostics. */
  get worldEnvironmentOverride(): ResolvedEnvironment | null {
    return this.override;
  }

  private withSkyOverride<T extends { turbidity: number }>(sky: T): T {
    const turbidity = this.override?.skyTurbidity;
    return turbidity === null || turbidity === undefined ? sky : { ...sky, turbidity };
  }

  private applyAmbient(ambient: AmbientLight | null, multiplier: number): void {
    if (ambient !== this.ambientTarget) {
      this.ambientSlot.reset();
      this.ambientTarget = ambient;
    }
    if (ambient) ambient.intensity = this.ambientSlot.apply(ambient.intensity, (base) => base * multiplier);
  }

  private restoreAmbient(): void {
    if (this.ambientTarget) {
      const restored = this.ambientSlot.restore(this.ambientTarget.intensity);
      if (restored !== null) this.ambientTarget.intensity = restored;
    }
    this.ambientSlot.reset();
    this.ambientTarget = null;
  }

  private applyExposure(multiplier: number): void {
    this.renderer.toneMappingExposure = this.exposureSlot.apply(
      this.renderer.toneMappingExposure,
      (base) => base * multiplier,
    );
    if (this.skyObject && this.skyLocalExposure !== null) {
      setSkyLocalToneMappingExposure(this.skyObject, this.skyLocalExposure * multiplier);
    }
  }

  private restoreExposure(): void {
    const restored = this.exposureSlot.restore(this.renderer.toneMappingExposure);
    if (restored !== null) this.renderer.toneMappingExposure = restored;
    this.exposureSlot.reset();
    if (this.skyObject) setSkyLocalToneMappingExposure(this.skyObject, this.skyLocalExposure);
  }

  /** Per-frame: keep the domes centred on the camera and advance the clouds. */
  update(deltaSeconds: number): void {
    const camera = this.camera();
    if (this.skyObject) followCameraWithSky(this.skyObject, camera);
    if (this.cloudObject) {
      followCameraWithClouds(this.cloudObject, camera);
      advanceCloudTime(this.cloudObject, deltaSeconds);
    }
  }

  /** Frees the captured Sky Light environment (does not clear `scene.environment`). */
  disposeReflectionTarget(): void {
    if (!this.reflectionTarget) return;
    this.reflectionTarget.dispose();
    this.reflectionTarget = null;
  }

  /**
   * Removes and disposes the domes and the Sky Light capture, and clears
   * `scene.environment`. Called on scene rebuild/teardown; safe to call twice.
   */
  teardown(): void {
    this.override = null;
    this.lastCapture = null;
    this.sunSlot.reset();
    this.ambientSlot.reset();
    this.exposureSlot.reset();
    this.ambientTarget = null;
    this.disposeSky();
    this.disposeClouds();
    this.disposeReflectionTarget();
    this.scene.environment = null;
  }

  private disposeSky(): void {
    if (!this.skyObject) return;
    this.scene.remove(this.skyObject);
    disposeDomeResources(this.skyObject);
    this.skyObject = null;
  }

  private disposeClouds(): void {
    if (!this.cloudObject) return;
    this.scene.remove(this.cloudObject);
    disposeDomeResources(this.cloudObject);
    this.cloudObject = null;
  }
}

/**
 * Disposes the geometry + materials of every mesh under a scene-owned dome (sky
 * or cloud). These own their geometry and shader material outright — unlike
 * loader-cached GLTFs, which must never be disposed this way.
 */
function disposeDomeResources(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material?.dispose();
    }
  });
}

/**
 * Scene fog from a resolved Height Fog, updating the existing fog object in
 * place when its kind matches: the World Environment re-applies fog every frame
 * and must not allocate a new `Fog` each time.
 */
function applySceneFogInPlace(scene: Scene, resolved: ResolvedHeightFog | null): void {
  if (resolved && !resolved.hidden) {
    const fog = scene.fog;
    if (resolved.mode === "exp" && fog instanceof FogExp2) {
      fog.color.set(resolved.color);
      fog.density = resolved.density;
      return;
    }
    if (resolved.mode === "linear" && fog instanceof Fog) {
      fog.color.set(resolved.color);
      fog.near = resolved.start;
      fog.far = resolved.end;
      return;
    }
  }
  applySceneFog(scene, resolved);
}

/**
 * One overridden number (ambient intensity, renderer exposure): remembers the
 * authored base and what it last wrote. A value that differs from the last
 * write was set by its owner since — an edit or a quality change — and becomes
 * the new base, so the override never compounds and never hides an edit.
 */
class NumberOverride {
  private baseValue: number | null = null;
  private written: number | null = null;

  apply(current: number, next: (base: number) => number): number {
    if (this.baseValue === null || current !== this.written) this.baseValue = current;
    this.written = next(this.baseValue);
    return this.written;
  }

  /** The value to put back (the base, unless the owner rewrote it since), or null when nothing was overridden. */
  restore(current: number): number | null {
    if (this.baseValue === null) return null;
    return current === this.written ? this.baseValue : current;
  }

  reset(): void {
    this.baseValue = null;
    this.written = null;
  }
}

/**
 * The Sun's three `DirectionalLight` under the World Environment: color,
 * intensity and aim, with the same authored-base tracking as
 * {@link NumberOverride}. The light keeps its position; only the target moves,
 * so follow-shadow and cascade code that reads `target - light` sees the new
 * direction. Aim is tracked as a direction, not a target position: the
 * follow shadow slides light and target together every frame, which is not an
 * edit of the authored aim.
 */
class SunLightOverride {
  private light: DirectionalLight | null = null;
  private readonly baseColor = new Color();
  private baseIntensity = 0;
  /** Authored light → target unit vector (world). */
  private readonly baseForward = new Vector3();
  private readonly writtenColor = new Color();
  private writtenIntensity = Number.NaN;
  private readonly writtenForward = new Vector3();
  private hasWritten = false;
  private readonly scratchColor = new Color();
  private readonly lightWorld = new Vector3();
  private readonly targetWorld = new Vector3();
  private readonly forward = new Vector3();

  /** The authored color/intensity, re-read if the owner rewrote the light since the last override. */
  base(light: DirectionalLight): { color: Color; intensity: number } {
    this.capture(light);
    return { color: this.baseColor, intensity: this.baseIntensity };
  }

  /** Applies the override; returns whether the light's aim changed. */
  apply(light: DirectionalLight, next: NonNullable<ResolvedEnvironment["light"]>): boolean {
    const distance = this.capture(light);
    if (next.isMoon) light.color.setRGB(next.color[0], next.color[1], next.color[2]);
    else light.color.copy(this.baseColor).multiply(this.scratchColor.setRGB(next.color[0], next.color[1], next.color[2]));
    light.intensity = next.intensity;
    // The light shines from the body toward the scene: forward = -direction.
    this.forward.set(-next.direction[0], -next.direction[1], -next.direction[2]).normalize();
    const moved = !this.hasWritten || this.forward.distanceToSquared(this.writtenForward) > 1e-12;
    this.aim(light, this.forward, distance);
    this.writtenColor.copy(light.color);
    this.writtenIntensity = light.intensity;
    this.writtenForward.copy(this.forward);
    this.hasWritten = true;
    return moved;
  }

  /** Puts the authored values back; returns whether the aim changed. */
  restore(light: DirectionalLight): boolean {
    if (this.light !== light || !this.hasWritten) {
      this.reset();
      return false;
    }
    if (light.color.equals(this.writtenColor)) light.color.copy(this.baseColor);
    if (light.intensity === this.writtenIntensity) light.intensity = this.baseIntensity;
    const distance = this.measure(light);
    const moved = this.forward.distanceToSquared(this.writtenForward) <= 1e-10;
    if (moved) this.aim(light, this.baseForward, distance);
    this.reset();
    return moved;
  }

  reset(): void {
    this.light = null;
    this.hasWritten = false;
    this.writtenIntensity = Number.NaN;
  }

  /** Re-reads whatever the owner changed since the last write; returns the light → target distance. */
  private capture(light: DirectionalLight): number {
    if (this.light !== light) {
      this.reset();
      this.light = light;
    }
    const distance = this.measure(light);
    if (!this.hasWritten || !light.color.equals(this.writtenColor)) this.baseColor.copy(light.color);
    if (!this.hasWritten || light.intensity !== this.writtenIntensity) this.baseIntensity = light.intensity;
    if (!this.hasWritten || this.forward.distanceToSquared(this.writtenForward) > 1e-10) this.baseForward.copy(this.forward);
    return distance;
  }

  /** Light → target in world space into {@link forward} (unit); returns the distance. */
  private measure(light: DirectionalLight): number {
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.getWorldPosition(this.lightWorld);
    light.target.getWorldPosition(this.targetWorld);
    this.forward.subVectors(this.targetWorld, this.lightWorld);
    const distance = this.forward.length();
    if (distance > 1e-9) this.forward.divideScalar(distance);
    else this.forward.set(0, -1, 0);
    return Math.max(1, distance);
  }

  private aim(light: DirectionalLight, forward: Vector3, distance: number): void {
    const target = light.target;
    target.position.copy(this.lightWorld).addScaledVector(forward, distance);
    if (target.parent) target.parent.worldToLocal(target.position);
    target.updateMatrixWorld();
  }
}
