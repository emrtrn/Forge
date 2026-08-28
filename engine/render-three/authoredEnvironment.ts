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
import { Mesh, Vector3 } from "three";
import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
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
    applySkyUniforms(this.skyObject, resolved);
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
    const sun = this.resolveSunActor();
    if (!sun) return;
    applySkySunDirection(this.skyObject, sunDirectionFromLightRotation(readRotation(sun)));
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
    applySceneFog(this.scene, actor ? resolveHeightFog(actor) : null);
  }

  /** Builds the static Cloud Layer dome; an absent actor removes it (see {@link applySky}). */
  applyClouds(layout: RoomLayout | null): void {
    const actor = layout?.cloudLayer ?? null;
    if (!actor) {
      this.disposeClouds();
      return;
    }
    const resolved = resolveCloudLayer(actor);
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
      const sun = this.resolveSunActor();
      const sunDirection = sun
        ? sunDirectionFromLightRotation(readRotation(sun))
        : new Vector3(0, 1, 0);
      this.reflectionTarget = captureSkyEnvironment(this.renderer, sky, sunDirection);
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
      setSkyLocalToneMappingExposure(this.skyObject, null);
      return;
    }
    setSkyLocalToneMappingExposure(
      this.skyObject,
      postProcessToneMappingExposure(post.exposure) * skyAtmosphereToneMappingExposure(sky.exposure),
    );
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
