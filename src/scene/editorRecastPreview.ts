import type { Group, Scene } from "three";

import type { NavAabb, NavAgent } from "@engine/navigation/navigationTypes";
import { loadRecastModules, type RecastModules } from "@engine/navigation/recastNavMesh";
import { RecastPlanner, type RecastTileWorker } from "@engine/navigation/recastPlanner";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { disposeAiNavigationView } from "@engine/render-three/aiNavigationView";
import { createRecastNavMeshView } from "@engine/render-three/recastNavMeshView";
import type { Entity } from "@engine/scene/entity";
import type { Vec3 } from "@engine/scene/layout";

import { RecastTileWorkerPool } from "./capabilities/recastTileWorkerPool";

/** What the editor's nav mesh preview is built from, read from the live layout. */
export interface EditorRecastPreviewInput {
  /** The level's collider entities (placed + terrain tiles); only static ones become nav geometry. */
  readonly entities: readonly Entity[];
  readonly agent: NavAgent;
  /** Authored AI Navigation Volumes; tiles outside them are never built. */
  readonly bounds: readonly NavAabb[];
  /** Points the preview builds tiles around, as runtime invokers do. */
  readonly invokers: readonly Vec3[];
  readonly buildRadius: number;
}

export interface EditorRecastPreviewOptions {
  readonly scene: Scene;
  /** Quiet time after the last request before a rebuild. Default 400 ms. */
  readonly delayMs?: number;
  /** Longest one rebuild waits for its tiles. Default 10 s. */
  readonly settleTimeoutMs?: number;
  readonly loadModules?: () => Promise<RecastModules>;
  /** Tile builder; default worker lanes when the platform has workers, else the main thread. */
  readonly createWorker?: () => RecastTileWorker | null;
  /** Called after the view in the scene changed (the host may need to redraw). */
  readonly onViewChanged?: () => void;
}

const DEFAULT_DELAY_MS = 400;
const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;

/**
 * The Recast polygons behind "Show > AI Navigation" in the editor
 * (OPEN_WORLD_PLAN Faz 9, R4). The runtime builds its nav mesh from the
 * physics world; the editor's physics is only filled at scene load, so the
 * preview builds a throwaway physics world from the live layout's entities
 * instead — the same collider-to-triangle path the runtime uses — and runs a
 * {@link RecastPlanner} over it with the runtime's tile streaming rules.
 *
 * Requests are debounced: a drag only restarts the timer. When it fires the
 * input is read once and compared with the last build's; an unchanged level
 * (a selection change, say) does not rebuild. A rebuild started before a newer
 * one finishes is discarded.
 */
export class EditorRecastPreview {
  private readonly scene: Scene;
  private readonly delayMs: number;
  private readonly settleTimeoutMs: number;
  private readonly loadModules: () => Promise<RecastModules>;
  private readonly createWorker: () => RecastTileWorker | null;
  private readonly onViewChanged: (() => void) | undefined;
  private worker: RecastTileWorker | null | undefined = undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private read: (() => EditorRecastPreviewInput | null) | null = null;
  private view: Group | null = null;
  private signature: string | null = null;
  private generation = 0;
  private running: Promise<void> = Promise.resolve();
  private disposed = false;
  /** Rebuilds that reached the scene (tests, debug). */
  builds = 0;

  constructor(options: EditorRecastPreviewOptions) {
    this.scene = options.scene;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.settleTimeoutMs = options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
    this.loadModules = options.loadModules ?? loadRecastModules;
    this.createWorker = options.createWorker ??
      (() => (typeof Worker !== "undefined" ? new RecastTileWorkerPool() : null));
    this.onViewChanged = options.onViewChanged;
  }

  /** The current view's group, if any (tests, debug). */
  get object(): Group | null {
    return this.view;
  }

  /** Schedules a rebuild from `read`, called once the requests have gone quiet. */
  request(read: () => EditorRecastPreviewInput | null): void {
    if (this.disposed) return;
    this.read = read;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.rebuild();
    }, this.delayMs);
  }

  /** Resolves once no rebuild is scheduled or running. */
  async whenIdle(): Promise<void> {
    for (;;) {
      const running = this.running;
      await running;
      if (this.timer === null && running === this.running) return;
      if (this.timer !== null) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  /** Hides the preview and forgets the last build; a later request rebuilds. */
  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.generation += 1;
    this.signature = null;
    this.removeView();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
    (this.worker as { dispose?: () => void } | null | undefined)?.dispose?.();
    this.worker = null;
  }

  private async rebuild(): Promise<void> {
    const input = this.read?.() ?? null;
    if (!input || input.invokers.length === 0) {
      this.signature = null;
      this.removeView();
      return;
    }
    const signature = previewSignature(input);
    if (signature === this.signature) return;
    const generation = ++this.generation;
    const modules = await this.loadModules();
    if (generation !== this.generation || this.disposed) return;
    if (this.worker === undefined) this.worker = this.createWorker();
    const physics = new PhysicsSubsystem();
    physics.setEntities(input.entities);
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) =>
        physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
      forEachObstacleInRect: (minX, minZ, maxX, maxZ, visit) =>
        physics.forEachNavigationObstacleInRect(minX, minZ, maxX, maxZ, visit),
    }, {
      buildRadius: input.buildRadius,
      keepRadius: input.buildRadius,
      maxSyncBuilds: 0,
      ...(this.worker ? { tileWorker: this.worker } : {}),
    });
    try {
      await planner.settle({
        invokers: input.invokers.map((position) => ({ position, agent: input.agent })),
        bounds: input.bounds,
        now: 0,
      }, this.settleTimeoutMs);
      if (generation !== this.generation || this.disposed) return;
      this.removeView();
      this.signature = signature;
      const mesh = planner.debugMeshes()[0];
      if (mesh && mesh.tiles.length > 0) {
        const { positions, indices } = mesh.geometry();
        this.view = createRecastNavMeshView({ positions, indices, tiles: mesh.tiles, tileSize: mesh.tileSize });
        this.view.name = "editor-ai-navmesh-preview";
        this.scene.add(this.view);
      }
      this.builds += 1;
      this.onViewChanged?.();
    } finally {
      planner.dispose();
    }
  }

  private removeView(): void {
    if (!this.view) return;
    this.scene.remove(this.view);
    disposeAiNavigationView(this.view);
    this.view = null;
    this.onViewChanged?.();
  }
}

/**
 * Content key of a preview input. Typed arrays (terrain heights) are folded
 * into a digest instead of being spelled out sample by sample.
 */
export function previewSignature(input: EditorRecastPreviewInput): string {
  return JSON.stringify(input, (_key, value: unknown) => {
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const array = value as unknown as ArrayLike<number>;
      let sum = 0;
      let weighted = 0;
      for (let index = 0; index < array.length; index += 1) {
        const sample = array[index]!;
        sum += sample;
        weighted += sample * ((index % 1021) + 1);
      }
      return `#${array.length}:${sum}:${weighted}`;
    }
    return value;
  });
}
