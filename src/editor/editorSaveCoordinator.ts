import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { foliageDataPath, type LayoutFoliageData } from "@engine/scene/foliage";
import { meshPaintDataPath, type LayoutMeshPaintData } from "@engine/scene/meshPaint";
import type { LayoutSavePayload, LayoutSaver, LayoutSaveResult } from "@/scene/SceneApp";
import { saveMeshPaintData } from "./meshPaintStore";
import { captureTerrainWrite, type WorldTerrainEditSession } from "./terrainStore";
import { levelTerrainPath } from "@engine/terrain/terrainTypes";
import { terrainTransformNeedsSave } from "@engine/terrain/terrainLandscapeBridge";
import {
  foliageCellFootprints,
  foliageCellPath,
  foliageFootprintsFit,
  partitionFoliageData,
  type FoliageCellFootprint,
} from "@engine/world/foliageCells";
import { normalizeWorldPartitionSettings, type WorldPartitionGridSettings } from "@engine/world/worldPartition";

/** In-memory edit revisions; these are never written into authored content. */
export class SaveRevision {
  private revision = 0;
  private savedRevision = 0;

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  /** Grows with every change: a cheap "document changed" signal for views. */
  get current(): number {
    return this.revision;
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
  /**
   * 1x1 Landscape data whose terrain may not be on disk yet: newly added, or
   * restored by undo after a Save pruned its level-owned files. Save writes its
   * tile and definition before the level that names them, like a migration.
   */
  private readonly unwrittenLandscapes = new WeakSet<ForgeLandscapeData>();
  private readonly queue = new EditorSaveCoordinator();
  /** Calls waiting for the next snapshot share one operation; active saves never do. */
  private queuedLayoutSave: { layout: EditorSaveSource["layout"]; operation: Promise<void> } | null = null;
  /**
   * The foliage cell files on disk (null: one sidecar, or none). A save
   * re-partitions when they do not match the level's partition settings, even
   * with no foliage edit — turning partition on/off or changing the foliage
   * cell size moves the instances between files.
   */
  private foliageDiskCells: FoliageCellFootprint[] | null = null;

  constructor(
    private readonly source: () => EditorSaveSource,
    private readonly onStatus: (message: string, tone: "success" | "warning") => void,
  ) {}

  /** A level's foliage was (re)loaded: nothing is dirty and `cells` is what is on disk. */
  foliageLoaded(cells: FoliageCellFootprint[] | null): void {
    this.foliageSaveRevision.reset();
    this.foliageDiskCells = cells;
  }

  markLandscapeUnwritten(id: string, data: ForgeLandscapeData): void {
    this.unwrittenLandscapes.add(data);
    this.markLandscapeDirty(id);
  }

  markLandscapeDirty(id: string): void {
    let revision = this.landscapeSaveRevisions.get(id);
    if (!revision) {
      revision = new SaveRevision();
      this.landscapeSaveRevisions.set(id, revision);
    }
    revision.markDirty();
  }

  async saveLayout(): Promise<void> {
    const layout = this.source().layout;
    if (this.queuedLayoutSave?.layout === layout) return this.queuedLayoutSave.operation;
    const queued = { layout, operation: Promise.resolve() };
    this.queuedLayoutSave = queued;
    queued.operation = this.writeLayout(() => {
      if (this.queuedLayoutSave === queued) this.queuedLayoutSave = null;
    });
    return queued.operation;
  }

  private async writeLayout(started: () => void): Promise<void> {
    let result: LayoutSaveResult = {};
    await this.queue.save(() => {
      // Clear before taking the snapshot: later edits need one more save, but
      // every caller already queued for this turn observes the same result.
      started();
      const source = this.source();
      // Capture the whole batch before awaiting the first response. Later edits
      // belong to a later save, even for sidecars not written yet.
      const payload = structuredClone({ layout: source.layout, editor: source.editor, scenePath: source.scenePath });
      const migrations: EditorSaveStep[] = [];
      const pendingReferences: { id: string; from: string; to: string; actor: object }[] = [];
      const writtenFirst = new Set<string>();
      for (const actor of source.layout.landscapes ?? []) {
        if (source.worldTerrainIds.has(actor.id)) {
          // Tiles and definition before the level, so the level never names a
          // terrain that is not on disk yet (a new World Terrain).
          const step = this.captureLandscapeSave(source, actor.id);
          if (step) migrations.push(step);
          continue;
        }
        const path = levelTerrainPath(source.scenePath, actor.id);
        const data = source.landscapeData.get(actor.id);
        if (actor.dataRef === path) {
          if (!data || !this.unwrittenLandscapes.has(data)) continue;
          const step = this.captureLandscapeSave(source, actor.id);
          if (step) migrations.push({ path: step.path, write: async () => { await step.write(); this.unwrittenLandscapes.delete(data); } });
          writtenFirst.add(actor.id);
          continue;
        }
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
        if (source.worldTerrainIds.has(actor.id) || writtenFirst.has(actor.id) || pendingReferences.some((entry) => entry.id === actor.id)) continue;
        const step = this.captureLandscapeSave(source, actor.id);
        if (step) steps.push(step);
      }
      steps.push(...this.captureFoliageSave(source));
      if (this.meshPaintSaveRevision.dirty) steps.push(this.captureMeshPaintSave(source));
      return steps;
    });
    const dropped = result.dropped ?? [];
    const warnings = result.warnings ?? [];
    const saved = `Saved ${result.path ?? "layout"}${partitionSummary(result)}`;
    if (warnings.length) console.warn("[save]", warnings.join("; "));
    if (dropped.length > 0) {
      console.warn("[save] dropped by the save validator:", dropped.join(", "));
      this.onStatus(
        `${saved} — ${dropped.length} unsupported field(s) dropped: ${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? ", …" : ""}${warnings.length ? `; ${warnings.join("; ")}` : ""}`,
        "warning",
      );
      return;
    }
    if (warnings.length) {
      this.onStatus(`${saved} — ${warnings.join("; ")}`, "warning");
      return;
    }
    const pending = this.foliageSaveRevision.dirty || this.meshPaintSaveRevision.dirty ||
      [...this.landscapeSaveRevisions.values()].some((revision) => revision.dirty) ||
      [...this.source().worldTerrainSessions?.values() ?? []].some((session) => session.dirty);
    this.onStatus(
      pending
        ? `${saved} snapshot; newer sidecar edits are still pending. Save again to finish.`
        : `${saved}.`,
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
    const data = this.source().landscapeData.get(id);
    // A direct first sidecar save must persist its new level reference as well;
    // a terrain not on disk yet goes through the level save, which writes it first.
    if (actor && actor.dataRef !== levelTerrainPath(this.source().scenePath, actor.id)) return this.saveLayout();
    if (data && this.unwrittenLandscapes.has(data)) return this.saveLayout();
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

  /**
   * Foliage steps for this save: none when nothing changed. A partitioned level
   * writes its cells (changed files only, nothing deleted), then the index
   * sidecar, then deletes cells the index no longer lists — so a failure never
   * leaves the sidecar naming a missing cell. Turning partition off writes the
   * merged sidecar first and only then removes the cells.
   */
  private captureFoliageSave(source: EditorSaveSource): EditorSaveStep[] {
    const grid = foliageGrid(source.layout);
    const disk = this.foliageDiskCells;
    const reshape = grid
      ? !(disk && foliageFootprintsFit(disk, grid)) && !(disk === null && isEmptyFoliage(source.foliageData))
      : disk !== null;
    if (!this.foliageSaveRevision.dirty && !reshape) return [];
    const path = foliageDataPath(source.scenePath);
    const level = source.scenePath;
    if (!grid) {
      const body = JSON.stringify({ path, foliage: source.foliageData });
      const sidecar = this.foliageSaveRevision.capture(path, () => postFoliage("/__save-foliage", body));
      if (disk === null) return [sidecar];
      return [sidecar, {
        path: foliageCellPath(level, "0_0").replace(/\/[^/]+$/, ""),
        write: async () => {
          await postFoliage("/__save-foliage-cells", JSON.stringify({ level, cells: [], keep: [] }));
          if (this.foliageDiskCells === disk) this.foliageDiskCells = null;
        },
      }];
    }
    const { index, cells } = partitionFoliageData(source.foliageData, grid);
    const cellsBody = JSON.stringify({ level, cells });
    const indexBody = JSON.stringify({ path, foliage: index });
    const keepBody = JSON.stringify({ level, cells: [], keep: index.foliageCells });
    const written = foliageCellFootprints(cells);
    return [
      { path: foliageCellPath(level, cells[0]?.key ?? "0_0"), write: () => postFoliage("/__save-foliage-cells", cellsBody) },
      { path, write: () => postFoliage("/__save-foliage", indexBody) },
      this.foliageSaveRevision.capture(foliageCellPath(level, "0_0").replace(/\/[^/]+$/, ""), async () => {
        await postFoliage("/__save-foliage-cells", keepBody);
        if (this.foliageDiskCells === disk) this.foliageDiskCells = written;
      }),
    ];
  }

  private captureMeshPaintSave(source: EditorSaveSource): EditorSaveStep {
    const path = meshPaintDataPath(source.scenePath);
    const data = structuredClone(source.meshPaintData);
    return this.meshPaintSaveRevision.capture(path, () => saveMeshPaintData(path, data));
  }
}

async function postFoliage(url: string, body: string): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!response.ok) {
    const detail = await response.json().then((json: { error?: string }) => json.error ?? "", () => "");
    throw new Error(`Foliage save failed (${url}): HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }
}

/** The foliage grid of a partitioned level, or null when the level is not partitioned. */
function foliageGrid(layout: EditorSaveSource["layout"]): WorldPartitionGridSettings | null {
  const partition = layout.worldSettings?.partition;
  if (!partition?.enabled) return null;
  return normalizeWorldPartitionSettings(partition).grids.foliage;
}

/** No group and no rule: a partitioned level without foliage needs no sidecar. */
function isEmptyFoliage(data: LayoutFoliageData): boolean {
  return data.groups.length === 0 && (data.landscapeRules?.length ?? 0) === 0;
}

function partitionSummary(result: LayoutSaveResult): string {
  const partition = result.partition;
  if (!partition) return "";
  const cells = `${partition.cells} cell${partition.cells === 1 ? "" : "s"}`;
  return ` (World Partition: ${cells}, ${partition.written} written; ${partition.streamed} streamed, ${partition.persistent} persistent)`;
}
