/**
 * Play-side procedural foliage ring (OPEN_WORLD_PLAN Faz 6 F3).
 *
 * Every Landscape foliage rule grows in cells around the camera (32 m for grass,
 * larger for a type seen from far: `foliageRingCellSize`), out to
 * its type's cull distance (× the quality cull scale), thinning in distance
 * bands (`engine/world/foliageRing.ts`). Cells are generated off the main
 * thread (`FoliageCellGenerator`) over terrain tiles mirrored into it, then
 * built as packed batches within a per-frame budget. Nothing is saved: the same
 * rule over the same terrain gives the same instances on every machine.
 *
 * Far billboards: a rule whose type has a `farDistance` past its cull distance
 * also grows, from the cull distance out, in 512 m blocks of the same ring cells
 * at the ring's outermost density, drawn as impostors (`foliageImpostor.ts`).
 * Blocks are generated on this thread over the terrain's always-resident global
 * map, or its exact tiles where resident; a block first built from the global
 * map is rebuilt from tiles once it nears the hand-off and its tiles are in, so
 * the billboard that replaces a model stands where the model stood.
 *
 * Far tint: rules whose type has a `farTint` also darken their terrain toward
 * the plants' colour with distance (`foliageFarTintMap` over the global map,
 * handed to the app through `farTint`), from the models' cull distance out.
 */
import { Group, Vector4, type InstancedMesh, type MeshStandardMaterial } from "three";
import type { FoliageRenderBinding, FoliageRenderResolver } from "@engine/render-three/foliage";
import { foliageFadeWindow } from "@engine/render-three/foliageFade";
import {
  createFoliageImpostorBatch, createFoliageImpostorMaterial, IMPOSTOR_FAR_FADE,
  type FoliageImpostorAtlas, type FoliageImpostorUniforms,
} from "@engine/render-three/foliageImpostor";
import { foliageTypeHasFarBillboards, type ForgeFoliageTypeDef, type LandscapeFoliageRule } from "@engine/scene/foliage";
import {
  foliageFarTintMap, generateFoliageBlock, globalFoliageSurface,
  type FoliageFarTintMap, type FoliageFarTintSource, type FoliageGlobalMap,
} from "@engine/scene/proceduralFoliage";
import type { TerrainTileLookup } from "@engine/terrain/terrainHeightQuery";
import { tileKey, type TerrainTileData } from "@engine/terrain/terrainTypes";
import {
  FOLIAGE_FAR_BLOCK_SIZE, FOLIAGE_RING_BANDS, foliageRingCellSize, foliageRingRadius, planFarFoliage, planFoliageRing,
  type FoliageRingBounds,
} from "@engine/world/foliageRing";
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
  /** Always-resident global map (heights, normals, weights); absent: no far billboards. */
  global?: FoliageGlobalMap | null;
}

/** A terrain's far foliage tint (`TerrainRenderer.setFarTint`). */
export interface ProceduralFoliageTint extends FoliageFarTintMap {
  start: number;
  end: number;
}

/** Impostor atlases by mesh asset id (baked once, outlives the ring). */
export interface FoliageImpostorSource {
  atlas(meshAssetId: string): FoliageImpostorAtlas | null;
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
  /** Far billboard atlases; absent: no far billboards, and the far tint uses a plain green. */
  impostors?: FoliageImpostorSource;
  /** Receives a terrain's far tint when it changes (null clears it). */
  farTint?: (terrainId: string, tint: ProceduralFoliageTint | null) => void;
  /** Jobs in flight at once (default 8). */
  maxInFlight?: number;
  debug?: boolean;
}

export interface ProceduralFoliageRingSnapshot {
  cells: number;
  instances: number;
  pending: number;
  /** Far billboard blocks and the billboards they hold. */
  farBlocks: number;
  farInstances: number;
}

interface FarBlock {
  mesh: InstancedMesh | null;
  count: number;
  keep: number;
  /** Built from resident tiles (or every tile under it was resident): not rebuilt for exactness. */
  exact: boolean;
}

interface FarState {
  atlas: FoliageImpostorAtlas;
  material: MeshStandardMaterial;
  uniforms: FoliageImpostorUniforms;
  blocks: Map<string, FarBlock>;
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
  /** Ring cell size, metres; fixed per rule for the ring's life. */
  cellSize: number;
  bounds: FoliageRingBounds;
  built: Map<string, { keep: number; count: number }>;
  pending: Map<string, PendingCell>;
  warnedCap: boolean;
  far: FarState | null;
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
  /** Far billboard batches, under the binding's root. */
  private readonly farRoot = new Group();
  /** Far tint map per terrain (null: none), and what was last sent for it. */
  private readonly tints = new Map<string, FoliageFarTintMap | null>();
  private readonly tintSent = new Map<string, string>();
  private tintVersion = 0;

  constructor(private readonly options: ProceduralFoliageRingOptions) {
    this.rules = options.rules.map((source) => ({
      source,
      cellSize: foliageRingCellSize(source.type.cullEnd, source.rule.density),
      bounds: terrainBounds(source.terrain.def),
      built: new Map(),
      pending: new Map(),
      warnedCap: false,
      far: this.createFarState(source),
    }));
    this.farRoot.name = "foliage-far-billboards";
    options.binding.root.add(this.farRoot);
    for (const { terrain } of options.rules) {
      if (this.terrains.has(terrain.id)) continue;
      this.terrains.set(terrain.id, terrain);
      this.synced.set(terrain.id, new Map());
      options.generator.setTerrain(terrain.id, terrain.def);
    }
    for (const id of this.terrains.keys()) this.tints.set(id, this.computeTint(id));
  }

  /** Per frame: plans every ring, requests new cells and builds at most `budget` finished ones. */
  update(center: readonly [number, number], cullScale: number, density: number, budget = 1): void {
    if (this.disposed) return;
    this.syncTiles();
    this.plan(center, cullScale, density, this.options.maxInFlight ?? 8);
    this.apply(budget);
    this.planFar(center, cullScale, density, budget);
    this.sendTints(cullScale);
  }

  /** Sends every far tint again (the app rebuilt a landscape's renderer). */
  refreshFarTint(): void {
    this.tintSent.clear();
  }

  /** Behind the loading overlay: generates and builds every cell in range at once. */
  async prepare(center: readonly [number, number], cullScale: number, density: number): Promise<void> {
    if (this.disposed) return;
    this.syncTiles();
    this.plan(center, cullScale, density, Infinity);
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
    this.apply(Infinity);
    this.planFar(center, cullScale, density, Infinity);
    this.sendTints(cullScale);
    if (this.options.debug) {
      const { cells, instances } = this.snapshot();
      console.info(`[foliage-ring] ready: ${cells} cells, ${instances} instances`);
    }
  }

  /**
   * The terrain changed (an edit, or a fresh 1×1 view): its tiles are mirrored
   * again and its cells regenerated, the old batches staying until replaced.
   */
  replaceTerrain(terrain: ProceduralFoliageTerrain): void {
    if (this.disposed || !this.terrains.has(terrain.id)) return;
    this.terrains.set(terrain.id, terrain);
    this.synced.set(terrain.id, new Map());
    this.options.generator.setTerrain(terrain.id, terrain.def);
    this.tints.set(terrain.id, this.computeTint(terrain.id));
    this.tintVersion += 1;
    for (const state of this.rules) {
      if (state.source.terrain.id !== terrain.id) continue;
      state.bounds = terrainBounds(terrain.def);
      // NaN matches no keep fraction, so the planner rebuilds every built cell.
      for (const entry of state.built.values()) entry.keep = Number.NaN;
      // In-flight answers read the old tiles; their tokens no longer match.
      state.pending.clear();
      for (const block of state.far?.blocks.values() ?? []) block.keep = Number.NaN;
    }
  }

  snapshot(): ProceduralFoliageRingSnapshot {
    let cells = 0;
    let instances = 0;
    let pending = 0;
    let farBlocks = 0;
    let farInstances = 0;
    for (const state of this.rules) {
      cells += state.built.size;
      pending += state.pending.size;
      for (const { count } of state.built.values()) instances += count;
      for (const block of state.far?.blocks.values() ?? []) { farBlocks += 1; farInstances += block.count; }
    }
    return { cells, instances, pending, farBlocks, farInstances };
  }

  dispose(): void {
    this.disposed = true;
    for (const [index, state] of this.rules.entries()) {
      for (const key of state.built.keys()) this.options.binding.removePackedGroup(objectKey(this.rules[index]!, key));
      state.built.clear();
      state.pending.clear();
      if (state.far) {
        for (const block of state.far.blocks.values()) this.disposeFarBlock(block);
        state.far.blocks.clear();
        state.far.material.dispose();
      }
    }
    this.farRoot.removeFromParent();
    for (const id of this.tintSent.keys()) this.options.farTint?.(id, null);
    this.tintSent.clear();
    this.ready.length = 0;
    for (const id of this.terrains.keys()) this.options.generator.removeTerrain(id);
  }

  private plan(center: readonly [number, number], cullScale: number, density: number, maxInFlight: number): void {
    for (const [index, state] of this.rules.entries()) {
      const { rule, type } = state.source;
      const terrain = this.terrains.get(state.source.terrain.id)!;
      const { radius, capped } = foliageRingRadius(type.cullEnd, cullScale, state.bounds);
      if (capped && !state.warnedCap) {
        state.warnedCap = true;
        console.warn(`[foliage] rule ${rule.id}: "${type.name}" never culls; its ring is capped at ${radius} m on this terrain. Set a cull distance.`);
      }
      const known = new Map<string, number>();
      for (const [key, { keep }] of state.built) known.set(key, keep);
      for (const [key, { keep }] of state.pending) known.set(key, keep);
      const plan = planFoliageRing({ center, radius, density, bounds: state.bounds, built: known, cellSize: state.cellSize });
      for (const key of plan.unload) {
        state.pending.delete(key);
        if (state.built.delete(key)) this.options.binding.removePackedGroup(objectKey(state, key));
      }
      for (const cell of plan.build) {
        if (this.inFlight.size >= maxInFlight) return;
        if (!this.cellTilesReady(terrain, cell.cellX, cell.cellZ, state.cellSize)) continue;
        const token = this.nextToken++;
        state.pending.set(cell.key, { keep: cell.keepFraction, token });
        const job = this.options.generator.generate({
          terrainId: terrain.id,
          rule,
          type,
          request: { cellX: cell.cellX, cellZ: cell.cellZ, cellSize: state.cellSize, keepFraction: cell.keepFraction },
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

  private createFarState(source: ProceduralFoliageRuleSource): FarState | null {
    if (!this.options.impostors || !source.terrain.global || !foliageTypeHasFarBillboards(source.type)) return null;
    const atlas = this.options.impostors.atlas(source.type.meshAssetId);
    if (!atlas) return null;
    const uniforms: FoliageImpostorUniforms = { uImpostorFade: { value: new Vector4() } };
    return { atlas, uniforms, material: createFoliageImpostorMaterial(atlas, uniforms), blocks: new Map() };
  }

  /** Plans, builds (at most `budget` blocks per rule) and unloads every rule's far billboard blocks. */
  private planFar(center: readonly [number, number], cullScale: number, density: number, budget: number): void {
    for (const state of this.rules) {
      const far = state.far;
      // The live terrain (replaceTerrain swaps it), not the one the ring started with.
      const terrain = this.terrains.get(state.source.terrain.id)!;
      const global = terrain.global;
      if (!far || !global) continue;
      const { rule, type } = state.source;
      const window = foliageFadeWindow(type.cullStart, type.cullEnd, cullScale);
      if (!window) continue;
      const scale = cullScale > 0 ? cullScale : 1;
      const farEnd = (type.farDistance ?? 0) * scale;
      far.uniforms.uImpostorFade.value.set(window[0], window[1], Math.max(window[1], farEnd * (1 - IMPOSTOR_FAR_FADE)), farEnd);
      // The ring's outermost band: a billboard shows exactly the plants the last models showed.
      const keep = FOLIAGE_RING_BANDS[FOLIAGE_RING_BANDS.length - 1]!.keep * Math.min(1, Math.max(0, density));
      const plan = planFarFoliage({
        center, nearRadius: window[0], farRadius: farEnd, bounds: state.bounds, built: new Set(far.blocks.keys()),
      });
      for (const key of plan.unload) {
        const block = far.blocks.get(key);
        if (block) this.disposeFarBlock(block);
        far.blocks.delete(key);
      }
      const size = FOLIAGE_FAR_BLOCK_SIZE;
      const handOff = window[1] * 1.25 + size;
      const stale: { key: string; blockX: number; blockZ: number }[] = [];
      for (const [key, block] of far.blocks) {
        const [blockX, blockZ] = key.split("_").map(Number) as [number, number];
        if (block.keep !== keep) { stale.push({ key, blockX, blockZ }); continue; }
        if (block.exact) continue;
        const dx = Math.max(blockX * size - center[0], 0, center[0] - (blockX + 1) * size);
        const dz = Math.max(blockZ * size - center[1], 0, center[1] - (blockZ + 1) * size);
        if (Math.hypot(dx, dz) < handOff && this.blockTilesResident(terrain, blockX, blockZ)) stale.push({ key, blockX, blockZ });
      }
      // Hand-off rebuilds first: a stale block near the models shows in the wrong place.
      let built = 0;
      for (const block of [...stale, ...plan.build]) {
        if (built >= budget) break;
        const previous = far.blocks.get(block.key);
        if (previous) this.disposeFarBlock(previous);
        const surface = globalFoliageSurface(terrain.def, global, terrain.tiles);
        const resident = this.blockTilesResident(terrain, block.blockX, block.blockZ);
        const generated = generateFoliageBlock(rule, type, surface, {
          blockX: block.blockX, blockZ: block.blockZ, cellSize: state.cellSize,
          cellsPerSide: Math.max(1, Math.round(size / state.cellSize)), keepFraction: keep,
        });
        let mesh: InstancedMesh | null = null;
        if (generated.count > 0) {
          mesh = createFoliageImpostorBatch(far.atlas, far.material, generated.matrices, generated.count);
          mesh.name = `foliage-far:${rule.id}:${block.key}`;
          this.farRoot.add(mesh);
        }
        far.blocks.set(block.key, { mesh, count: generated.count, keep, exact: surface.exact || resident });
        built += 1;
      }
    }
  }

  /** The far tint of one terrain from every rule on it whose type has a far tint. */
  private computeTint(terrainId: string): FoliageFarTintMap | null {
    const terrain = this.terrains.get(terrainId);
    if (!terrain?.global || !this.options.farTint) return null;
    const sources: FoliageFarTintSource[] = [];
    for (const { source } of this.rules) {
      if (source.terrain.id !== terrainId || !((source.type.farTint ?? 0) > 0)) continue;
      const atlas = this.options.impostors?.atlas(source.type.meshAssetId) ?? null;
      const radius = atlas ? atlas.width / 2 : 2;
      sources.push({
        rule: source.rule,
        type: source.type,
        color: atlas ? [atlas.color.r, atlas.color.g, atlas.color.b] : [0.03, 0.06, 0.03],
        footprint: Math.PI * radius * radius,
      });
    }
    return sources.length > 0 ? foliageFarTintMap(terrain.def, terrain.global, sources) : null;
  }

  /** Hands each terrain's tint to the app when it or its start distance changed. */
  private sendTints(cullScale: number): void {
    const hook = this.options.farTint;
    if (!hook) return;
    for (const [id, data] of this.tints) {
      let start = Infinity;
      for (const { source } of this.rules) {
        if (source.terrain.id !== id || !((source.type.farTint ?? 0) > 0)) continue;
        const window = foliageFadeWindow(source.type.cullStart, source.type.cullEnd, cullScale);
        start = Math.min(start, window ? window[1] : 0);
      }
      const tint = data && Number.isFinite(start) ? { ...data, start, end: Math.max(start * 2, start + 100) } : null;
      const signature = tint ? `${this.tintVersion}|${tint.start}` : "none";
      if (this.tintSent.get(id) === signature) continue;
      if (!tint && !this.tintSent.has(id)) { this.tintSent.set(id, signature); continue; }
      this.tintSent.set(id, signature);
      hook(id, tint);
    }
  }

  private disposeFarBlock(block: FarBlock): void {
    if (!block.mesh) return;
    block.mesh.removeFromParent();
    block.mesh.geometry.dispose();
    block.mesh.dispose();
    block.mesh = null;
  }

  /** True when every existing tile under a far block (plus the normal margin) is resident. */
  private blockTilesResident(terrain: ProceduralFoliageTerrain, blockX: number, blockZ: number): boolean {
    const { def } = terrain;
    const tileSize = def.tileQuads * def.spacing;
    const margin = 2 * def.spacing;
    const range = (min: number, max: number, origin: number, tiles: number) => [
      Math.max(0, Math.floor((min - margin - origin) / tileSize)),
      Math.min(tiles - 1, Math.floor((max + margin - origin) / tileSize)),
    ] as const;
    const size = FOLIAGE_FAR_BLOCK_SIZE;
    const [x0, x1] = range(blockX * size, (blockX + 1) * size, def.origin[0], def.tilesX);
    const [z0, z1] = range(blockZ * size, (blockZ + 1) * size, def.origin[2], def.tilesZ);
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (terrain.existingTiles && !terrain.existingTiles.has(tileKey(x, z))) continue;
        if (!terrain.tiles.tile(x, z)) return false;
      }
    }
    return true;
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
  private cellTilesReady(terrain: ProceduralFoliageTerrain, cellX: number, cellZ: number, cellSize: number): boolean {
    const { def } = terrain;
    const tileSize = def.tileQuads * def.spacing;
    const margin = 2 * def.spacing;
    const range = (min: number, max: number, origin: number, tiles: number) => [
      Math.max(0, Math.floor((min - margin - origin) / tileSize)),
      Math.min(tiles - 1, Math.floor((max + margin - origin) / tileSize)),
    ] as const;
    const [x0, x1] = range(cellX * cellSize, (cellX + 1) * cellSize, def.origin[0], def.tilesX);
    const [z0, z1] = range(cellZ * cellSize, (cellZ + 1) * cellSize, def.origin[2], def.tilesZ);
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
