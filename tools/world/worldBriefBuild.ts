/**
 * `npm run world:brief` (docs/world-builder/WORLD_BRIEF.md): builds a level from
 * a `*.worldbrief.json` without the editor, and writes it the way the editor's
 * Save Layout does, so opening and saving it in the editor changes no file.
 *
 * Order: brief → recipe plan → temporary terrain steps (heights, paint, level
 * ground, river line; `worldBriefTemporarySteps.ts`) → World Builder stages via
 * `planStage` (today `roads`) → road splines baked into the terrain → placements
 * → save-canonical files. The level, its World Partition cells, the recipe and
 * the foliage sidecar go through the same validators as the dev save endpoints
 * (`tools/saveValidator.ts`), the terrain definition through
 * `normalizeWorldTerrain`.
 *
 * Pure and deterministic: it returns file contents; the CLI
 * (`tools/world/build-world-brief.mjs`) writes them and removes stale cells.
 */
import { foliageDataPath, normalizeFoliageData } from "../../engine/scene/foliage";
import type { LayoutPlacement, RoomLayout } from "../../engine/scene/layout";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { applyTerrainUndoPatches, createTerrainEditWorld, quantizeTerrainWeights } from "../../engine/terrain/terrainEdit";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { createTerrainPadPatches, type TerrainPad } from "../../engine/terrain/terrainPads";
import { createTerrainSplinePatches } from "../../engine/terrain/terrainSplines";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile,
  levelTerrainDir,
  terrainGlobalMapPath,
  terrainTileHeightRange,
  terrainTilePath,
  type TerrainTileData,
  type WorldTerrainDef,
  type WorldTerrainSpline,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import { foliageCellPath, partitionFoliageData } from "../../engine/world/foliageCells";
import {
  compareWorldCellKeys,
  normalizeWorldPartitionSettings,
  partitionLayout,
  worldCellPath,
} from "../../engine/world/worldPartition";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { worldRecipePath, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import type { RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { planStage, type StagePlan, type StageTerrain, type WorldStage } from "../../engine/worldbuilder/stage";
import { roadsStage } from "../../engine/worldbuilder/stages/roads";
import {
  briefElevationToWorld,
  briefToWorld,
  briefWorldBounds,
  worldBriefRecipe,
  type BriefModel,
  type WorldBrief,
} from "../../engine/worldbuilder/worldBrief";
import {
  validateFoliageData,
  validateSavePayload,
  validateSaveWorldCellsPayload,
  validateSaveWorldRecipePayload,
} from "../saveValidator";
import {
  briefLandscape,
  plantRules,
  PILOT_TUNING,
  riverSpline,
  scatterRocks,
  yardFences,
  type BriefLandscape,
  type ScatterPlacement,
} from "./worldBriefTemporarySteps";

/** World Builder stages the runner applies, in order. Step 3 adds terrain, water, paint, plants and pads. */
export const WORLD_BRIEF_STAGES: readonly WorldStage[] = [roadsStage];

/** Greybox look until the user sets the light and colour in the editor; never tuned here. */
const GREYBOX_LOOK = {
  worldSettings: { backgroundColor: "#a9c9df", ambientColor: "#ece6da", ambientIntensity: 1.1 },
  skyAtmosphere: { rayleigh: 1.4, turbidity: 3, mie: 0.003, mieDirectionalG: 0.8, skyLightCapture: { intensity: 0.5 } },
  lights: [{ id: "sun", type: "directional", position: [3, 9, 4], name: "Sun", rotation: [-48, 35, 0], color: "#fff4e6", intensity: 4.2, castShadow: true }],
};

export interface WorldBriefBuildInput {
  brief: WorldBrief;
  /** Public-root-relative `.level.json` the build writes. */
  levelPath: string;
  /** The brief's region profile, loaded; null when it names none. */
  profile: RegionProfile | null;
  /** Manifest asset id of a public-root-relative model file, or null when it is not registered. */
  assetIdForFile: (file: string) => string | null;
  /** `worldSettings.partition` of the level being replaced, kept as it is; undefined for a new level. */
  partition?: unknown;
}

export interface WorldBriefBuild {
  /** Public-root-relative path → file contents, exactly as a save writes them. */
  files: Map<string, string | Uint8Array>;
  /** Directory of the terrain's tiles; the CLI empties it before writing. */
  tilesDir: string;
  /** Main grid cell keys the level lists; any other cell file is stale. */
  cellKeys: string[];
  /** Foliage cell keys the foliage index lists, or null when the level is not partitioned. */
  foliageCellKeys: string[] | null;
  /** The whole level before it is split into cells, save-canonical. */
  layout: RoomLayout;
  def: WorldTerrainDef;
  tiles: ReadonlyMap<string, TerrainTileData>;
  recipe: WorldRecipe;
  foliage: Record<string, unknown>;
  stages: StagePlan[];
  land: BriefLandscape;
  /** Height of each landmark's level ground, by id. */
  padHeights: Record<string, number>;
  sampleHeight: (x: number, z: number) => number | null;
  warnings: string[];
  /** Brief fields read but not built yet. */
  deferred: string[];
}

/** Millimetres, as the editor saves positions. */
function savedCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

function levelName(levelPath: string): string {
  const file = levelPath.replace(/\\/g, "/").split("/").pop()!;
  return file.replace(/(\.level|\.layout)?\.json$/i, "");
}

function title(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Model rows by role and variant; the first row of a role without a variant is its default. */
function modelResolver(models: readonly BriefModel[], assetIdForFile: (file: string) => string | null) {
  const resolved = new Map<BriefModel, string>();
  const missing: string[] = [];
  for (const model of models) {
    const assetId = assetIdForFile(model.file);
    if (assetId) resolved.set(model, assetId);
    else missing.push(`${model.role}${model.variant ? ` (${model.variant})` : ""}: ${model.file}`);
  }
  const rows = (role: string, variant: string | null): BriefModel[] =>
    models.filter((model) => model.role === role && (variant === null || model.variant === variant));
  return {
    missing,
    /** Asset id for a role; `pick` 0..1 chooses among several rows. Throws when a row's file is not registered. */
    assetId(role: string, variant: string | null, pick = 0): string | null {
      const candidates = rows(role, variant);
      if (candidates.length === 0) return null;
      const model = variant === null
        ? candidates.find((row) => row.variant === undefined) ?? candidates[0]!
        : candidates[Math.floor(pick * candidates.length)]!;
      const assetId = resolved.get(model);
      if (!assetId) throw new Error(`model ${model.file} for ${role} is not in the asset manifest`);
      return assetId;
    },
  };
}

function writeWeights(tile: TerrainTileData, index: number, weights: number[]): void {
  const bytes = quantizeTerrainWeights(weights);
  bytes.forEach((weight, layer) => {
    tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4] = weight;
  });
}

/** The level as the editor saves it: partitioned when its settings say so, every element through the save validators. */
export function saveLevelFiles(layout: RoomLayout, levelPath: string): {
  level: string;
  cells: Map<string, string>;
  cellKeys: string[];
} {
  const settings = normalizeWorldPartitionSettings(layout.worldSettings?.partition);
  const split = partitionLayout(layout, settings);
  const persistent = split.persistent;
  delete persistent.worldCells;
  const keep = [...split.cells.keys()].sort(compareWorldCellKeys);
  if (keep.length) persistent.worldCells = keep;
  if (split.warnings.length) throw new Error(`World Partition: ${split.warnings.join("; ")}`);
  const level = validateSavePayload({ layout: persistent }).layout;
  const cells = new Map<string, string>();
  if (split.cells.size) {
    const validated = validateSaveWorldCellsPayload({ level: levelPath, cells: [...split.cells.values()], keep });
    for (const cell of validated.cells) cells.set(worldCellPath(levelPath, "main", cell.key), json(cell));
  }
  return { level: json(level), cells, cellKeys: keep };
}

export function buildWorldFromBrief(input: WorldBriefBuildInput): WorldBriefBuild {
  const { brief, levelPath, profile } = input;
  const warnings: string[] = [];
  const deferred: string[] = [];
  const models = modelResolver(brief.models, input.assetIdForFile);
  const bounds = briefWorldBounds(brief);
  const land = briefLandscape(brief);

  // Terrain: tiles cover the area, centred on it.
  const { terrain } = brief;
  const tileSpan = terrain.tileQuads * terrain.spacing;
  const tilesX = Math.ceil((bounds.max[0] - bounds.min[0]) / tileSpan - 1e-9);
  const tilesZ = Math.ceil((bounds.max[1] - bounds.min[1]) / tileSpan - 1e-9);
  const created = createFlatWorldTerrain({
    name: terrain.name, tilesX, tilesZ, tileQuads: terrain.tileQuads, spacing: terrain.spacing, baseHeight: 0,
    heightMin: briefElevationToWorld(brief, terrain.heightRange[0]), heightMax: briefElevationToWorld(brief, terrain.heightRange[1]),
  });
  const def = created.def;
  def.origin = [
    def.origin[0] + (bounds.min[0] + bounds.max[0]) / 2,
    def.origin[1],
    def.origin[2] + (bounds.min[1] + bounds.max[1]) / 2,
  ];
  def.layers = structuredClone(PILOT_TUNING.layers);
  const size = terrain.tileQuads + 1;
  const tiles = def.tiles.map(({ key }) => {
    const { x, z } = created.tiles.get(key)!;
    const tile = createFlatTerrainTile(def, x, z);
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const worldX = def.origin[0] + (tile.x * terrain.tileQuads + i) * terrain.spacing;
        const worldZ = def.origin[2] + (tile.z * terrain.tileQuads + j) * terrain.spacing;
        tile.heights[j * size + i] = land.baseHeight(worldX, worldZ);
        writeWeights(tile, j * size + i, land.weights(worldX, worldZ));
      }
    }
    return tile;
  });
  const world = createTerrainEditWorld(def, tiles);
  const sampleHeight = (x: number, z: number): number | null => terrainHeightAt(def, world, x, z);

  // Level ground first, so a road ends on what it will meet.
  const padHeights: Record<string, number> = {};
  const pads: TerrainPad[] = [];
  for (const landmark of brief.landmarks) {
    if (!landmark.pad) continue;
    const [cx, cz] = briefToWorld(brief, landmark.at);
    const height = Number(land.baseHeight(cx, cz).toFixed(2));
    const [halfX, halfZ] = [landmark.pad.size[0] / 2, landmark.pad.size[1] / 2];
    padHeights[landmark.id] = height;
    pads.push({
      polygon: [[cx - halfX, cz - halfZ], [cx + halfX, cz - halfZ], [cx + halfX, cz + halfZ], [cx - halfX, cz + halfZ]],
      height,
      falloff: landmark.pad.falloff,
    });
  }
  if (pads.length) applyTerrainUndoPatches(world, createTerrainPadPatches(world, pads));

  // Stages: each sees the recipe and splines the previous one left.
  def.splines = [riverSpline(land)];
  let recipe = worldBriefRecipe(brief);
  const layoutForStages = { schema: 1, name: levelName(levelPath), loadGroups: [], instances: [], characters: [] } as unknown as RoomLayout;
  const stages: StagePlan[] = [];
  for (const stage of WORLD_BRIEF_STAGES) {
    const stageTerrain: StageTerrain = {
      id: terrain.id,
      min: [def.origin[0], def.origin[2]],
      max: [def.origin[0] + tilesX * tileSpan, def.origin[2] + tilesZ * tileSpan],
      layers: def.layers.map(({ id, name }) => ({ id, name })),
      splines: def.splines,
      locked: false,
    };
    const plan = planStage(stage, { recipe, layout: layoutForStages, profile, sampleHeight, terrains: [stageTerrain] });
    if (plan.errors.length > 0) throw new Error(`stage ${stage.id}: ${plan.errors.join("; ")}`);
    if (plan.groupChanges.length > 0) throw new Error(`stage ${stage.id}: placement output is not wired into world:brief yet`);
    warnings.push(...plan.warnings.map((warning) => `${stage.id}: ${warning}`));
    for (const change of plan.splineChanges) if (change.landscapeId === terrain.id) def.splines = structuredClone(change.after);
    recipe = plan.recipeAfter;
    stages.push(plan);
  }
  for (const spline of def.splines) {
    if (spline.id === land.river.id || spline.coordinateSpace !== "world") continue;
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, spline as WorldTerrainSpline));
  }

  const tileBytes = new Map<string, Uint8Array>();
  for (const summary of def.tiles) {
    const tile = world.tiles.get(summary.key)!;
    const range = terrainTileHeightRange(tile);
    summary.minHeight = range.min;
    summary.maxHeight = range.max;
    tileBytes.set(summary.key, encodeTerrainTile(tile, { ...def, heightFormat: "f32" }));
  }
  const globalBytes = encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, world.tiles)));

  // Placements: landmarks and props by their model rows, then the temporary scatter.
  const groups = new Map<string, LayoutPlacement[]>();
  const place = (assetId: string, entry: { id: string; role: string; name: string; at: WorldPoint; rotationYDeg: number; scale: number; collision: boolean }): void => {
    const height = sampleHeight(entry.at[0], entry.at[1]);
    if (height === null) throw new Error(`placement ${entry.id} is off the terrain`);
    const placement = {
      id: entry.id, role: entry.role, name: entry.name, rotationYDeg: entry.rotationYDeg, scale: entry.scale,
      position: [savedCoordinate(entry.at[0]), savedCoordinate(height), savedCoordinate(entry.at[1])],
      // The editor's save drops the default `true`.
      ...(entry.collision ? {} : { collision: false }),
    } as LayoutPlacement;
    groups.set(assetId, [...(groups.get(assetId) ?? []), placement]);
  };
  for (const landmark of brief.landmarks) {
    const assetId = models.assetId(landmark.role, null);
    if (!assetId) {
      warnings.push(`landmark ${landmark.id}: no model row for ${landmark.role}; nothing placed`);
      continue;
    }
    place(assetId, { id: landmark.id, role: landmark.role, name: title(landmark.id), at: briefToWorld(brief, landmark.at), rotationYDeg: 0, scale: 1, collision: true });
  }
  for (const prop of brief.props) {
    const assetId = models.assetId(prop.role, null);
    if (!assetId) throw new Error(`prop ${prop.id}: no model row for ${prop.role}`);
    place(assetId, {
      id: prop.id, role: prop.role, name: title(prop.id), at: briefToWorld(brief, prop.at),
      rotationYDeg: prop.rotationDeg, scale: prop.scale, collision: prop.collision,
    });
  }
  const scatter: ScatterPlacement[] = [...yardFences(brief), ...scatterRocks(brief, land, bounds)];
  for (const entry of scatter) {
    const assetId = models.assetId(entry.role, entry.variant, entry.pick);
    if (!assetId) throw new Error(`temporary scatter: no model row for ${entry.role}${entry.variant ? ` (${entry.variant})` : ""}`);
    place(assetId, entry);
  }

  const start = brief.playerStart ? briefToWorld(brief, brief.playerStart) : null;
  const startHeight = start ? sampleHeight(start[0], start[1]) : null;
  if (start && startHeight === null) throw new Error("playerStart is off the terrain");
  const terrainPath = `${levelTerrainDir(levelPath)}/${terrain.id}.terrain.json`;
  const worldSettings: Record<string, unknown> = { ...GREYBOX_LOOK.worldSettings };
  if (input.partition !== undefined) worldSettings.partition = structuredClone(input.partition);
  const firstRow = land.rows[0]!;
  const layout = {
    schema: 1,
    name: levelName(levelPath),
    loadGroups: [],
    instances: [
      ...(start ? [{
        assetId: "marker:playerStart",
        placements: [{ position: [start[0], savedCoordinate(startHeight! + 2), start[1]], name: "Player Start", collision: false, rotationYDeg: 0, scale: 1 }],
      }] : []),
      ...[...groups].map(([assetId, placements]) => ({ assetId, placements })),
    ],
    characters: [],
    worldSettings,
    skyAtmosphere: structuredClone(GREYBOX_LOOK.skyAtmosphere),
    lights: structuredClone(GREYBOX_LOOK.lights),
    landscapes: [{ id: terrain.id, name: terrain.name, position: worldTerrainActorPosition(def), dataRef: terrainPath }],
    riverWaters: [{
      id: `${land.river.id}-water-1`, name: title(land.river.id), landscapeRef: terrain.id, splineRef: land.river.id, coordinateSpace: "world",
      surfaceLevel: Number(land.riverSurface(firstRow.z).toFixed(3)), reflectionQuality: "medium",
    }],
  } as unknown as RoomLayout;

  // Save-canonical files.
  const files = new Map<string, string | Uint8Array>();
  const canonicalLayout = validateSavePayload({ layout }).layout as RoomLayout;
  const saved = saveLevelFiles(canonicalLayout, levelPath);
  for (const [key, bytes] of tileBytes) files.set(terrainTilePath(terrainPath, key), bytes);
  files.set(terrainGlobalMapPath(terrainPath), globalBytes);
  const canonicalDef = normalizeWorldTerrain(structuredClone(def));
  files.set(terrainPath, json(canonicalDef));
  for (const [path, text] of saved.cells) files.set(path, text);
  files.set(levelPath, saved.level);
  const canonicalRecipe = validateSaveWorldRecipePayload({ level: levelPath, recipe }).recipe as unknown as WorldRecipe;
  files.set(worldRecipePath(levelPath), json(canonicalRecipe));
  const foliageData = normalizeFoliageData({ schema: 1, type: "foliage", groups: [], landscapeRules: plantRules(terrain.id) });
  const partition = normalizeWorldPartitionSettings(input.partition);
  const foliageIndex = partition.enabled ? partitionFoliageData(foliageData, partition.grids.foliage) : null;
  if (foliageIndex && foliageIndex.cells.length) throw new Error("painted foliage cells are not built by world:brief");
  const foliage = validateFoliageData(foliageIndex ? foliageIndex.index : foliageData);
  files.set(foliageDataPath(levelPath), json(foliage));

  if (models.missing.length) warnings.push(`model rows not in the asset manifest yet: ${models.missing.join("; ")}`);
  if (brief.environment) deferred.push("environment: season/weather/hour are read, not written to the level yet (WES link, plan §12)");
  if (brief.settlements.length) deferred.push("settlements: in the recipe plan; no settlement stage runs yet");
  if (brief.regions.length) deferred.push("regions: in the recipe plan only");
  for (const valley of brief.valleys) if (valley.ridgeElevation) deferred.push(`valleys.${valley.id}.ridgeElevation: not used by the temporary terrain step`);

  return {
    files,
    tilesDir: terrainTilePath(terrainPath, "0_0").replace(/\/[^/]+$/, ""),
    cellKeys: saved.cellKeys,
    foliageCellKeys: foliageIndex ? foliageIndex.index.foliageCells ?? [] : null,
    layout: canonicalLayout,
    def: canonicalDef,
    tiles: world.tiles,
    recipe: canonicalRecipe,
    foliage,
    stages,
    land,
    padHeights,
    sampleHeight,
    warnings,
    deferred,
  };
}

/** `<Level>.cells/main` and `<Level>.cells/foliage`, the directories stale cells are removed from. */
export function levelCellDirs(levelPath: string): { main: string; foliage: string } {
  return {
    main: worldCellPath(levelPath, "main", "0_0").replace(/\/[^/]+$/, ""),
    foliage: foliageCellPath(levelPath, "0_0").replace(/\/[^/]+$/, ""),
  };
}
