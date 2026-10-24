/**
 * Play-side procedural foliage ring (OPEN_WORLD_PLAN Faz 6 F3).
 *
 * Every Landscape foliage rule grows in 32 m cells around the camera, out to
 * its type's cull distance (× the quality cull scale), thinning in distance
 * bands (`engine/world/foliageRing.ts`). Cells are generated off the main
 * thread (`FoliageCellGenerator`) over terrain tiles mirrored into it, then
 * built as packed batches within a per-frame budget. Nothing is saved: the same
 * rule over the same terrain gives the same instances on every machine.
 */
import type { FoliageRenderBinding, FoliageRenderResolver } from "@engine/render-three/foliage";
import type { ForgeFoliageTypeDef, LandscapeFoliageRule } from "@engine/scene/foliage";
import type { TerrainTileLookup } from "@engine/terrain/terrainHeightQuery";
import { tileKey, type TerrainTileData } from "@engine/terrain/terrainTypes";
import { FOLIAGE_RING_CELL_SIZE, foliageRingRadius, planFoliageRing, type FoliageRingBounds } from "@engine/world/foliageRing";
import type { FoliageCellGenerator, FoliageGeneratorTerrainDef } from "./foliageCellGenerator";

/** A terrain the ring grows on: World Terrain tiles, or a 1×1 Landscape as one tile. */
export interface ProceduralFoliageTerrain {
  /** Stable id (the Landscape actor id). */
  id: string;
  def: FoliageGeneratorTerrainDef;
  /** Resident tiles (live for a streamed World Terrain). */
  tiles: TerrainTileLookup;
  /** Tile slots that exist (`"x_z"`); a slot outside it is a hole and never waited for. Null: every slot. */
  existingTiles: ReadonlySet<string> | null;
}

export interface ProceduralFoliageRuleSource {
  rule: LandscapeFoliageRule;
  type: ForgeFoliageTypeDef;
  terrain: ProceduralFoliageTerrain;
}

export interface ProceduralFoliageRingOptions {
  rules: readonly ProceduralFoliageRuleSource[];
  binding: FoliageRenderBinding;
  resolver: FoliageRenderResolver;
  generator: FoliageCellGenerator;
  /** Jobs in flight at once (default 8). */
  maxInFlight?: number;
  debug?: boolean;
}

export interface ProceduralFoliageRingSnapshot {
  cells: number;
  instances: number;
  pending: number;
}

interface PendingCell {
  keep: number;
  token: number;
}

interface ReadyCell {
  rule: number;
  key: string;
  keep: number;
  token: number;
  matrices: Float32Array;
  count: number;
}

interface RuleState {
  source: ProceduralFoliageRuleSource;
  bounds: FoliageRingBounds;
  built: Map<string, { keep: number; count: number }>;
  pending: Map<string, PendingCell>;
  warnedCap: boolean;
}

export class ProceduralFoliageRing {
  private readonly rules: RuleState[];
  private readonly terrains = new Map<string, ProceduralFoliageTerrain>();
  /** Per terrain: the tile objects the generator holds a copy of. */
  private readonly synced = new Map<string, Map<string, TerrainTileData>>();
  private readonly ready: ReadyCell[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private nextToken = 1;
  private disposed = false;

  constructor(private readonly options: ProceduralFoliageRingOptions) {
    this.rules = options.rules.map((source) => ({
      source,
      bounds: terrainBounds(source.terrain.def),
      built: new Map(),
      pending: new Map(),
      warnedCap: false,
    }));
    for (const { terrain } of options.rules) {
      if (this.terrains.has(terrain.id)) continue;
      this.terrains.set(terrain.id, terrain);
      this.synced.set(terrain.id, new Map());
      options.generator.setTerrain(terrain.id, terrain.def);
    }
  }

  /** Per frame: plans every ring, requests new cells and builds at most `budget` finished ones. */
  update(center: readonly [number, number], cullScale: number, density: number, budget = 1): void {
    if (this.disposed) return;
    this.syncTiles();
    this.plan(center, cullScale, density, this.options.maxInFlight ?? 8);
    this.apply(budget);
  }

  /** Behind the loading overlay: generates and builds every cell in range at once. */
  async prepare(center: readonly [number, number], cullScale: number, density: number): Promise<void> {
    if (this.disposed) return;
    this.syncTiles();
    this.plan(center, cullScale, density, Infinity);
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
    this.apply(Infinity);
    if (this.options.debug) {
      const { cells, instances } = this.snapshot();
      console.info(`[foliage-ring] ready: ${cells} cells, ${instances} instances`);
    }
  }

  snapshot(): ProceduralFoliageRingSnapshot {
    let cells = 0;
    let instances = 0;
    let pending = 0;
    for (const state of this.rules) {
      cells += state.built.size;
      pending += state.pending.size;
      for (const { count } of state.built.values()) instances += count;
    }
    return { cells, instances, pending };
  }

  dispose(): void {
    this.disposed = true;
    for (const [index, state] of this.rules.entries()) {
      for (const key of state.built.keys()) this.options.binding.removePackedGroup(objectKey(this.rules[index]!, key));
      state.built.clear();
      state.pending.clear();
    }
    this.ready.length = 0;
    for (const id of this.terrains.keys()) this.options.generator.removeTerrain(id);
  }

  private plan(center: readonly [number, number], cullScale: number, density: number, maxInFlight: number): void {
    for (const [index, state] of this.rules.entries()) {
      const { rule, type, terrain } = state.source;
      const { radius, capped } = foliageRingRadius(type.cullEnd, cullScale, state.bounds);
      if (capped && !state.warnedCap) {
        state.warnedCap = true;
        console.warn(`[foliage] rule ${rule.id}: "${type.name}" never culls; its ring is capped at ${radius} m on this terrain. Set a cull distance.`);
      }
      const known = new Map<string, number>();
      for (const [key, { keep }] of state.built) known.set(key, keep);
      for (const [key, { keep }] of state.pending) known.set(key, keep);
      const plan = planFoliageRing({ center, radius, density, bounds: state.bounds, built: known });
      for (const key of plan.unload) {
        state.pending.delete(key);
        if (state.built.delete(key)) this.options.binding.removePackedGroup(objectKey(state, key));
      }
      for (const cell of plan.build) {
        if (this.inFlight.size >= maxInFlight) return;
        if (!this.cellTilesReady(terrain, cell.cellX, cell.cellZ)) continue;
        const token = this.nextToken++;
        state.pending.set(cell.key, { keep: cell.keepFraction, token });
        const job = this.options.generator.generate({
          terrainId: terrain.id,
          rule,
          type,
          request: { cellX: cell.cellX, cellZ: cell.cellZ, cellSize: FOLIAGE_RING_CELL_SIZE, keepFraction: cell.keepFraction },
        }).then(
          ({ count, matrices }) => {
            this.ready.push({ rule: index, key: cell.key, keep: cell.keepFraction, token, matrices, count });
          },
          (error: unknown) => {
            if (this.disposed) return;
            console.warn(`[foliage] rule ${rule.id} cell ${cell.key}: ${error instanceof Error ? error.message : String(error)}`);
            // Built empty, so a failing cell is not retried every frame.
            this.ready.push({ rule: index, key: cell.key, keep: cell.keepFraction, token, matrices: new Float32Array(0), count: 0 });
          },
        ).finally(() => this.inFlight.delete(job));
        this.inFlight.add(job);
      }
    }
  }

  private apply(budget: number): void {
    let applied = 0;
    while (applied < budget && this.ready.length > 0) {
      const result = this.ready.shift()!;
      const state = this.rules[result.rule]!;
      // Unloaded or re-requested since: drop this answer.
      if (state.pending.get(result.key)?.token !== result.token) continue;
      state.pending.delete(result.key);
      const count = this.options.binding.setPackedGroup(
        objectKey(state, result.key), state.source.rule.foliageTypeId, result.matrices, result.count, this.options.resolver);
      state.built.set(result.key, { keep: result.keep, count });
      applied += 1;
    }
  }

  /** Mirrors resident tiles into the generator and forgets the ones streamed out. */
  private syncTiles(): void {
    for (const [id, synced] of this.synced) {
      const terrain = this.terrains.get(id)!;
      for (const [key, tile] of synced) {
        if (terrain.tiles.tile(tile.x, tile.z) === tile) continue;
        synced.delete(key);
        this.options.generator.removeTile(id, tile.x, tile.z);
      }
    }
  }

  /** True once every existing tile under the cell (plus a two-vertex margin for normals) is mirrored. */
  private cellTilesReady(terrain: ProceduralFoliageTerrain, cellX: number, cellZ: number): boolean {
    const { def } = terrain;
    const tileSize = def.tileQuads * def.spacing;
    const margin = 2 * def.spacing;
    const range = (min: number, max: number, origin: number, tiles: number) => [
      Math.max(0, Math.floor((min - margin - origin) / tileSize)),
      Math.min(tiles - 1, Math.floor((max + margin - origin) / tileSize)),
    ] as const;
    const [x0, x1] = range(cellX * FOLIAGE_RING_CELL_SIZE, (cellX + 1) * FOLIAGE_RING_CELL_SIZE, def.origin[0], def.tilesX);
    const [z0, z1] = range(cellZ * FOLIAGE_RING_CELL_SIZE, (cellZ + 1) * FOLIAGE_RING_CELL_SIZE, def.origin[2], def.tilesZ);
    const synced = this.synced.get(terrain.id)!;
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const key = tileKey(x, z);
        if (terrain.existingTiles && !terrain.existingTiles.has(key)) continue;
        const tile = terrain.tiles.tile(x, z);
        if (!tile) return false;
        if (synced.get(key) !== tile) {
          this.options.generator.setTile(terrain.id, tile);
          synced.set(key, tile);
        }
      }
    }
    return true;
  }
}

function objectKey(state: RuleState, cellKey: string): string {
  return `grass:${state.source.rule.id}:${cellKey}`;
}

function terrainBounds(def: FoliageGeneratorTerrainDef): FoliageRingBounds {
  return {
    minX: def.origin[0],
    maxX: def.origin[0] + def.tilesX * def.tileQuads * def.spacing,
    minZ: def.origin[2],
    maxZ: def.origin[2] + def.tilesZ * def.tileQuads * def.spacing,
  };
}
