/**
 * Live particle preview for the Particle Effect Editor (dev-only).
 *
 * Owns its own `WebGLRenderer` / `Scene` / raf loop (like the mesh editors) and
 * reuses the shared orbit camera + studio rig (`assetViewportCamera.ts`). The
 * effect is simulated by the same runtime {@link ParticleEffect} the game path
 * uses, fed the flat definition collapsed from the editor's rich
 * {@link ParticleEffectDefinition} — so what the author sees here is what the
 * `/` route renders.
 *
 * Preview state (elapsed time, particle buffers, play/pause, speed, loop-preview)
 * lives entirely in this class and the `ParticleEffect` instance, never in the
 * asset data (plan task: "editor preview state ayrı tutulur").
 *
 * VFX Lite Faz 3 layers authoring affordances on the Faz 2 minimum: an axis +
 * origin marker, the fixed-bounds box (driven by `system.bounds`), a preview
 * speed multiplier, a loop-preview toggle (auto-replay one-shots on/off), a
 * single-burst restart, and a live alive/capacity stat readout for the HUD.
 */
import {
  AxesHelper,
  Box3,
  Box3Helper,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Spherical,
  Vector3,
  WebGLRenderer,
} from "three";

import { ParticleEffect, toRuntimeParticleEffect } from "@engine/render-three/particleEffect";
import { MeshParticleEffect } from "@engine/render-three/meshParticleEffect";
import { GltfModelLoader } from "@engine/render-three/gltfModelLoader";
import type { ParticleEffectDefinition } from "@engine/vfx/particleEffectTypes";
import { OrbitViewportCamera, createAssetViewportRig } from "@/editor/assetViewportCamera";

/** Seconds a finished one-shot waits before it auto-replays in the preview. */
const ONE_SHOT_REPLAY_DELAY = 0.4;

/** Live simulation stats surfaced to the editor HUD each frame. */
export interface PreviewStats {
  alive: number;
  capacity: number;
}

type PreviewParticleEffect = ParticleEffect | MeshParticleEffect;

export class ParticleEffectPreviewViewport {
  private readonly renderer: WebGLRenderer;
  private readonly modelLoader: GltfModelLoader;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 200);
  private readonly orbit: OrbitViewportCamera;
  private readonly spherical = new Spherical(6, 1.15, 0.7);
  private readonly target = new Vector3(0, 1, 0);
  private readonly resizeObserver: ResizeObserver;

  private readonly axes: AxesHelper;
  private readonly originMarker: Mesh;
  private boundsHelper: Box3Helper | null = null;

  private definition: ParticleEffectDefinition | null = null;
  private effect: PreviewParticleEffect | null = null;
  private effectRevision = 0;
  private rafId = 0;
  private lastTime = 0;
  private playing = true;
  private speed = 1;
  private loopPreview = true;
  private replayCooldown = 0;
  /** Short author-facing feedback for asynchronous mesh-source loading. */
  private previewMessage: string | null = null;
  private disposed = false;

  /**
   * @param resolveTextureUrl Turns a `renderer.texture` asset id into a fetchable
   *   image URL (the editor injects a manifest-backed resolver). Absent keeps the
   *   procedural sprite, matching a texture-less effect.
   * @param applyModelAuthoredSurface Applies a mesh source's asset-level material
   *   slot assignments (`*.materials.json`) to the freshly loaded root, so the
   *   preview shows the surface the game will render rather than the GLB's
   *   exported default. Absent leaves the model exactly as it was exported.
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly resolveTextureUrl?: (textureId: string) => string | null,
    private readonly resolveModelUrl?: (modelId: string) => string | null,
    private readonly applyModelAuthoredSurface?: (
      modelId: string,
      root: Object3D,
    ) => Promise<void>,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.modelLoader = new GltfModelLoader(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.append(this.renderer.domElement);

    createAssetViewportRig(this.scene);

    this.axes = new AxesHelper(0.6);
    this.scene.add(this.axes);
    this.originMarker = new Mesh(
      new SphereGeometry(0.045, 12, 8),
      new MeshBasicMaterial({ color: 0xf0a54a }),
    );
    this.scene.add(this.originMarker);

    this.orbit = new OrbitViewportCamera(this.camera, this.spherical, this.target, () => 4);
    this.orbit.update();
    this.orbit.bind(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Swaps in a new definition, rebuilding the simulated effect from scratch. */
  setDefinition(definition: ParticleEffectDefinition): void {
    this.definition = definition;
    this.rebuildEffect();
    this.rebuildBounds();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Sets the simulation time multiplier (0.25×–2× in the UI). */
  setSpeed(multiplier: number): void {
    this.speed = multiplier > 0 ? multiplier : 1;
  }

  getSpeed(): number {
    return this.speed;
  }

  /** When off, a finished one-shot stays finished instead of auto-replaying. */
  setLoopPreview(enabled: boolean): void {
    this.loopPreview = enabled;
    if (enabled && this.effect?.isFinished() && this.replayCooldown <= 0) {
      this.replayCooldown = ONE_SHOT_REPLAY_DELAY;
    }
  }

  isLoopPreview(): boolean {
    return this.loopPreview;
  }

  /** Emits a fresh burst (restart from the beginning) and resumes playback. */
  burst(): void {
    this.restart();
  }

  /** Restarts the effect from the beginning (fresh particle buffers). */
  restart(): void {
    this.replayCooldown = 0;
    this.rebuildEffect();
    this.playing = true;
  }

  /** Live alive/capacity counts for the HUD (0/0 when no effect is built). */
  getStats(): PreviewStats {
    if (!this.effect) return { alive: 0, capacity: 0 };
    return { alive: this.effect.aliveCount(), capacity: this.effect.maxCapacity };
  }

  /** Non-null while a mesh preview is loading or its selected sources are unusable. */
  getStatus(): string | null {
    return this.previewMessage;
  }

  private rebuildEffect(): void {
    const revision = ++this.effectRevision;
    this.previewMessage = null;
    if (this.effect) {
      this.scene.remove(this.effect.object3D);
      this.effect.dispose();
      this.effect = null;
    }
    if (!this.definition) return;
    const runtime = toRuntimeParticleEffect(this.definition);
    if (runtime.rendererType === "mesh") {
      void this.buildMeshEffect(runtime, revision);
      return;
    }
    const textureUrl =
      runtime.texture && this.resolveTextureUrl ? this.resolveTextureUrl(runtime.texture) : null;
    this.effect = new ParticleEffect(runtime, undefined, textureUrl);
    this.effect.setOrigin(0, 0, 0);
    this.scene.add(this.effect.object3D);
  }

  private async buildMeshEffect(
    runtime: ReturnType<typeof toRuntimeParticleEffect>,
    revision: number,
  ): Promise<void> {
    const modelIds = (runtime.modelIds ?? []).filter((id) => id.trim().length > 0);
    if (!this.resolveModelUrl || modelIds.length === 0) {
      this.setPreviewMessage(revision, "Select at least one static mesh source.");
      return;
    }
    this.setPreviewMessage(revision, `Loading ${modelIds.length} mesh source${modelIds.length === 1 ? "" : "s"}…`);
    const roots = (
      await Promise.all(
        modelIds.map(async (id): Promise<Object3D | null> => {
          const url = this.resolveModelUrl?.(id);
          if (!url) return null;
          try {
            const scene = (await this.modelLoader.load(id, url)).scene;
            // Before the effect is built: `MeshParticleEffect` reads the root's
            // materials at construction, so a slot swap afterwards never lands.
            await this.applyModelAuthoredSurface?.(id, scene);
            return scene;
          } catch {
            return null;
          }
        }),
      )
    ).filter((root): root is Object3D => root !== null);
    if (this.disposed || revision !== this.effectRevision) return;
    if (roots.length === 0) {
      this.previewMessage = "No valid static mesh source could be loaded.";
      return;
    }
    const effect = new MeshParticleEffect(runtime, roots);
    effect.setOrigin(0, 0, 0);
    this.effect = effect;
    this.scene.add(effect.object3D);
    this.previewMessage = null;
  }

  private setPreviewMessage(revision: number, message: string): void {
    if (!this.disposed && revision === this.effectRevision) this.previewMessage = message;
  }

  /** Rebuilds the fixed-bounds wireframe from `system.bounds` (or hides it). */
  private rebuildBounds(): void {
    if (this.boundsHelper) {
      this.scene.remove(this.boundsHelper);
      this.boundsHelper.geometry.dispose();
      (this.boundsHelper.material as MeshBasicMaterial).dispose();
      this.boundsHelper = null;
    }
    const bounds = this.definition?.system.bounds;
    if (!bounds || !bounds.showInPreview || bounds.mode !== "fixed") return;
    const box = new Box3(
      new Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
      new Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
    );
    if (box.isEmpty()) return;
    this.boundsHelper = new Box3Helper(box, new Color(0x4a90d9));
    this.scene.add(this.boundsHelper);
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000) * this.speed;
    this.lastTime = now;

    if (this.playing && this.effect && dt > 0) {
      if (this.replayCooldown > 0) {
        this.replayCooldown -= dt;
        if (this.replayCooldown <= 0) this.rebuildEffect();
      } else {
        this.effect.update(dt);
        if (this.effect.isFinished() && this.loopPreview) {
          this.replayCooldown = ONE_SHOT_REPLAY_DELAY;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    if (this.effect) {
      this.scene.remove(this.effect.object3D);
      this.effect.dispose();
      this.effect = null;
    }
    if (this.boundsHelper) {
      this.scene.remove(this.boundsHelper);
      this.boundsHelper.geometry.dispose();
      (this.boundsHelper.material as MeshBasicMaterial).dispose();
      this.boundsHelper = null;
    }
    this.axes.dispose();
    this.originMarker.geometry.dispose();
    (this.originMarker.material as MeshBasicMaterial).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
