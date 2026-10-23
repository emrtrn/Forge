import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { foliageDataPath, type LayoutFoliageData } from "@engine/scene/foliage";
import { meshPaintDataPath, type LayoutMeshPaintData } from "@engine/scene/meshPaint";
import type { LayoutSavePayload, LayoutSaver, LayoutSaveResult } from "@/scene/SceneApp";
import { saveMeshPaintData } from "./meshPaintStore";
import { captureTerrainWrite, type WorldTerrainEditSession } from "./terrainStore";
import { levelTerrainPath } from "@engine/terrain/terrainTypes";
import { terrainTransformNeedsSave } from "@engine/terrain/terrainLandscapeBridge";

/** In-memory edit revisions; these are never written into authored content. */
export class SaveRevision {
  private revision = 0;
  private savedRevision = 0;

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  markDirty(): void {
    this.revision += 1;
  }

  /** Loading/replacing a document also invalidates acknowledgements in flight. */
  reset(): void {
    this.revision += 1;
    this.savedRevision = this.revision;
  }

  /** Call after capturing the payload, before any asynchronous work. */
  capture(path: string, write: () => Promise<void>): EditorSaveStep {
    const revision = this.revision;
    return {
      path,
      write: async () => {
        await write();
        if (this.revision === revision) this.savedRevision = revision;
      },
    };
  }
}

export interface EditorSaveStep {
  readonly path: string;
  readonly write: () => Promise<void>;
}

export class EditorSaveError extends Error {
  constructor(
    readonly savedPaths: readonly string[],
    readonly pendingPaths: readonly string[],
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Save failed for ${pendingPaths[0]}. ` +
        `Saved: ${savedPaths.length > 0 ? savedPaths.join(", ") : "none"}. ` +
        `Pending: ${pendingPaths.join(", ")}. Retry Save to finish. ${reason}`,
      { cause },
    );
    this.name = "EditorSaveError";
  }
}

/**
 * Serializes manual, automatic and direct sidecar saves in one editor session.
 * Each turn snapshots its documents before writing any of them. Successful
 * files stay acknowledged on a partial failure; failed/unattempted files stay
 * dirty so the next Save can recover. This is not a disk transaction.
 */
export class EditorSaveCoordinator {
  private tail: Promise<void> = Promise.resolve();

  save(prepare: () => readonly EditorSaveStep[]): Promise<void> {
    const operation = this.tail.then(async () => {
      const steps = prepare();
      const savedPaths: string[] = [];
      for (const [index, step] of steps.entries()) {
        try {
          await step.write();
          savedPaths.push(step.path);
        } catch (cause) {
          throw new EditorSaveError(savedPaths, steps.slice(index).map((entry) => entry.path), cause);
        }
      }
    });
    // A rejected save belongs to its caller; it must not poison later retries.
    this.tail = operation.catch(() => {});
    return operation;
  }
}

export interface EditorSaveSource {
  readonly layout: LayoutSavePayload["layout"];
  readonly editor: LayoutSavePayload["editor"];
  readonly layoutSaver: LayoutSaver;
  readonly scenePath: string;
  readonly landscapeData: ReadonlyMap<string, ForgeLandscapeData>;
  /**
   * Landscape actors referencing a multi-tile World Terrain. Save keeps their
   * `dataRef` exactly as authored (no fork into the level folder) and writes
   * only their edited tiles plus the definition, in place, through
   * `worldTerrainSessions`.
   */
  readonly worldTerrainIds: ReadonlySet<string>;
  /** Edit sessions of the World Terrain actors, by actor id; absent when nothing can be edited. */
  readonly worldTerrainSessions?: ReadonlyMap<string, WorldTerrainEditSession>;
  readonly foliageData: LayoutFoliageData;
  readonly meshPaintData: LayoutMeshPaintData;
}

/** Owns save state and payload capture independently of the viewport/render loop. */
export class EditorSaveSession {
  readonly meshPaintSaveRevision = new SaveRevision();
  readonly foliageSaveRevision = new SaveRevision();
  readonly landscapeSaveRevisions = new Map<string, SaveRevision>();
  private readonly queue = new EditorSaveCoordinator();

  constructor(
    private readonly source: () => EditorSaveSource,
    private readonly onStatus: (message: string, tone: "success" | "warning") => void,
  ) {}

  markLandscapeDirty(id: string): void {
    let revision = this.landscapeSaveRevisions.get(id);
    if (!revision) {
      revision = new SaveRevision();
      this.landscapeSaveRevisions.set(id, revision);
    }
    revision.markDirty();
  }

  async saveLayout(): Promise<void> {
    let result: LayoutSaveResult = {};
    await this.queue.save(() => {
      const source = this.source();
      // Capture the whole batch before awaiting the first response. Later edits
      // belong to a later save, even for sidecars not written yet.
      const payload = structuredClone({ layout: source.layout, editor: source.editor });
      const migrations: EditorSaveStep[] = [];
      const pendingReferences: { id: string; from: string; to: string; actor: object }[] = [];
      for (const actor of source.layout.landscapes ?? []) {
        if (source.worldTerrainIds.has(actor.id)) continue;
        const path = levelTerrainPath(source.scenePath, actor.id);
        if (actor.dataRef === path) continue;
        const data = source.landscapeData.get(actor.id);
        if (!data) throw new Error(`Cannot migrate missing landscape data: ${actor.id}`);
        // Fork legacy/shared/copied references before writing anything. Never
        // overwrite another level's definition or its tile binaries.
        const write = captureTerrainWrite({ ...actor, dataRef: path }, data);
        const revision = this.landscapeSaveRevisions.get(actor.id);
        migrations.push(revision ? revision.capture(write.path, write.write) : write);
        payload.layout.landscapes!.find((entry) => entry.id === actor.id)!.dataRef = write.path;
        pendingReferences.push({ id: actor.id, from: actor.dataRef, to: write.path, actor });
      }
      const steps: EditorSaveStep[] = [...migrations, {
        path: source.scenePath,
        write: async () => {
          result = await source.layoutSaver(payload);
          // A reload/delete/recreate while saving must not mutate a replacement document.
          if (this.source().layout !== source.layout) return;
          for (const ref of pendingReferences) {
            const actor = source.layout.landscapes?.find((entry) => entry.id === ref.id);
            if (actor === ref.actor && actor.dataRef === ref.from) actor.dataRef = ref.to;
          }
        },
      }];
      for (const actor of source.layout.landscapes ?? []) {
        if (pendingReferences.some((entry) => entry.id === actor.id)) continue;
        const step = this.captureLandscapeSave(source, actor.id);
        if (step) steps.push(step);
      }
      if (this.foliageSaveRevision.dirty) steps.push(this.captureFoliageSave(source));
      if (this.meshPaintSaveRevision.dirty) steps.push(this.captureMeshPaintSave(source));
      return steps;
    });
    const dropped = result.dropped ?? [];
    if (dropped.length > 0) {
      console.warn("[save] dropped by the save validator:", dropped.join(", "));
      this.onStatus(
        `Saved ${result.path ?? "layout"} — ${dropped.length} unsupported field(s) dropped: ${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? ", …" : ""}`,
        "warning",
      );
      return;
    }
    const pending = this.foliageSaveRevision.dirty || this.meshPaintSaveRevision.dirty ||
      [...this.landscapeSaveRevisions.values()].some((revision) => revision.dirty) ||
      [...this.source().worldTerrainSessions?.values() ?? []].some((session) => session.dirty);
    this.onStatus(
      pending
        ? `Saved ${result.path ?? "layout"} snapshot; newer sidecar edits are still pending. Save again to finish.`
        : `Saved ${result.path ?? "layout"}.`,
      pending ? "warning" : "success",
    );
  }

  saveLandscapeData(id: string): Promise<void> {
    if (this.source().worldTerrainIds.has(id)) {
      return this.queue.save(() => {
        const step = this.captureLandscapeSave(this.source(), id);
        return step ? [step] : [];
      });
    }
    const actor = this.source().layout.landscapes?.find((entry) => entry.id === id);
    // A direct first sidecar save must persist its new level reference as well.
    if (actor && actor.dataRef !== levelTerrainPath(this.source().scenePath, actor.id)) return this.saveLayout();
    return this.queue.save(() => {
      const step = this.captureLandscapeSave(this.source(), id);
      return step ? [step] : [];
    });
  }

  private captureLandscapeSave(source: EditorSaveSource, id: string): EditorSaveStep | null {
    if (source.worldTerrainIds.has(id)) return source.worldTerrainSessions?.get(id)?.capture() ?? null;
    const actor = source.layout.landscapes?.find((entry) => entry.id === id);
    const data = source.landscapeData.get(id);
    const revision = this.landscapeSaveRevisions.get(id);
    if (!actor || !data || (!revision?.dirty && !terrainTransformNeedsSave(actor, data))) return null;
    if (actor.dataRef !== levelTerrainPath(source.scenePath, actor.id)) {
      throw new Error(`Terrain reference changed; retry Save to isolate ${id}`);
    }
    const write = captureTerrainWrite(actor, data);
    return revision ? revision.capture(write.path, write.write) : write;
  }

  private captureFoliageSave(source: EditorSaveSource): EditorSaveStep {
    const path = foliageDataPath(source.scenePath);
    const body = JSON.stringify({ path, foliage: source.foliageData });
    return this.foliageSaveRevision.capture(path, async () => {
      const response = await fetch("/__save-foliage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) throw new Error(`Foliage save failed: HTTP ${response.status}`);
    });
  }

  private captureMeshPaintSave(source: EditorSaveSource): EditorSaveStep {
    const path = meshPaintDataPath(source.scenePath);
    const data = structuredClone(source.meshPaintData);
    return this.meshPaintSaveRevision.capture(path, () => saveMeshPaintData(path, data));
  }
}
