/**
 * `npm run world:brief` (docs/world-builder/WORLD_BRIEF.md): builds a level from
 * a `*.worldbrief.json` without the editor, and writes it the way the editor's
 * Save Layout does, so opening and saving it in the editor changes no file.
 *
 * Order: brief → recipe plan → valley ground and water beds
 * (`engine/worldbuilder/briefTerrain.ts`) → temporary paint
 * (`worldBriefTemporarySteps.ts`) → level ground → World Builder stages via
 * `planStage` (roads, then the settlement chain: sites, streets, parcels, land
 * use, buildings) → road and street splines, then building pads, baked into the
 * terrain → stages that follow the finished ground (street furniture, fences)
 * → placements → save-canonical files. The level, its World Partition cells, the recipe and
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
import { createTerrainPadPatches, padWeight, type TerrainPad } from "../../engine/terrain/terrainPads";
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
import { PAD_FALLOFF } from "../../engine/worldbuilder/buildings";
import { applyPlacementGroupChanges, planStage, type StagePlan, type StageTerrain, type WorldStage } from "../../engine/worldbuilder/stage";
import { buildingsStage } from "../../engine/worldbuilder/stages/buildings";
import { fencesStage } from "../../engine/worldbuilder/stages/fences";
import { furnitureStage } from "../../engine/worldbuilder/stages/furniture";
import { landUseStage } from "../../engine/worldbuilder/stages/landUse";
import { parcelsStage } from "../../engine/worldbuilder/stages/parcels";
import { roadsStage } from "../../engine/worldbuilder/stages/roads";
import { settlementSitesStage } from "../../engine/worldbuilder/stages/settlementSites";
import { streetsStage } from "../../engine/worldbuilder/stages/streets";
import {
  briefElevationToWorld,
  briefToWorld,
  briefWorldBounds,
  worldBriefRecipe,
  type BriefModel,
  type WorldBrief,
  type WorldBuildStep,
} from "../../engine/worldbuilder/worldBrief";
import {
  validateFoliageData,
  validateSavePayload,
  validateSaveWorldCellsPayload,
  validateSaveWorldRecipePayload,
} from "../saveValidator";
import { createBriefTerrain, type BriefTerrain, type WaterLake } from "../../engine/worldbuilder/briefTerrain";
import {
  coverDensity,
  coverPaint,
  coverPlantRules,
  coverRockCounts,
  coverSnowLine,
  type CoverDensities,
  type GroundCover,
} from "../../engine/worldbuilder/groundCover";
import { lakeBedDistance } from "../../engine/scene/lakeBed";
import { createLakeAppearance, LAKE_LIMITS } from "../../engine/scene/waterBody";
import { OCEAN_LIMITS, validateOceanWater } from "../../engine/scene/oceanWater";
import {
  paintWeights,
  plantRules,
  PILOT_TUNING,
  briefClearings,
  scatterOutcrops,
  scatterRocks,
  waterSpline,
  yardFences,
  type ScatterPlacement,
} from "./worldBriefTemporarySteps";

/**
 * World Builder stages the runner applies before the ground is finished, in
 * order. Terrain and water are built before them (`briefTerrain.ts`); their
 * road and street splines and building pads are baked after them.
 */
export const WORLD_BRIEF_STAGES: readonly WorldStage[] = [
  roadsStage, settlementSitesStage, streetsStage, parcelsStage, landUseStage, buildingsStage,
];
/** Role of the parcels stage's ground plates (`stages/parcels.ts`). */
const PARCEL_MARKER_ROLE = "marker.parcel";

/** Stages that stand their objects on the finished ground, run after the bake. */
export const WORLD_BRIEF_GROUND_STAGES: readonly WorldStage[] = [furnitureStage, fencesStage];

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
  /** The brief's ground cover, loaded; null (or absent) when it names none: the pilot's paint and plants. */
  cover?: GroundCover | null;
  /** `worldSettings.partition` of the level being replaced, kept as it is; undefined for a new level. */
  partition?: unknown;
  /** Told as each build step starts (`WORLD_BUILD_STEPS` in worldBrief.ts); it only reports, the build does not wait. */
  onProgress?: ((step: WorldBuildStep) => void) | undefined;
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
  /** Valley ground and water courses (`engine/worldbuilder/briefTerrain.ts`). */
  ground: BriefTerrain;
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

/**
 * Paints the settlement ground under every pad with `PILOT_TUNING.padPaint`
 * (inside the pad, easing out beyond it), blended over the paint already there.
 * Plants grow from the paint, so none stands in a building or its yard.
 */
function paintPads(def: WorldTerrainDef, tiles: ReadonlyMap<string, TerrainTileData>, pads: readonly TerrainPad[], layerId: string): void {
  const { fade } = PILOT_TUNING.padPaint;
  const layer = def.layers.findIndex((entry) => entry.id === layerId);
  if (layer < 0) return;
  const quads = def.tileQuads;
  for (const pad of pads) {
    const shape: TerrainPad = { polygon: pad.polygon, height: pad.height, falloff: fade };
    const xs = pad.polygon.map(([x]) => x);
    const zs = pad.polygon.map(([, z]) => z);
    const [minI, maxI] = [Math.floor((Math.min(...xs) - fade - def.origin[0]) / def.spacing), Math.ceil((Math.max(...xs) + fade - def.origin[0]) / def.spacing)];
    const [minJ, maxJ] = [Math.floor((Math.min(...zs) - fade - def.origin[2]) / def.spacing), Math.ceil((Math.max(...zs) + fade - def.origin[2]) / def.spacing)];
    for (const tile of tiles.values()) {
      const [baseI, baseJ] = [tile.x * quads, tile.z * quads];
      for (let j = Math.max(minJ, baseJ); j <= Math.min(maxJ, baseJ + quads); j += 1) {
        for (let i = Math.max(minI, baseI); i <= Math.min(maxI, baseI + quads); i += 1) {
          const weight = padWeight(shape, def.origin[0] + i * def.spacing, def.origin[2] + j * def.spacing);
          if (weight <= 0) continue;
          const index = (j - baseJ) * tile.size + (i - baseI);
          const current = Array.from({ length: tile.layerCount }, (_, k) =>
            tile.weights[Math.floor(k / 4) * tile.size * tile.size * 4 + index * 4 + k % 4]! / 255);
          writeWeights(tile, index, current.map((value, k) => value * (1 - weight) + (k === layer ? weight : 0)));
        }
      }
    }
  }
}

/** Texels per axis the shore foam mask may use, with a margin under its 1024 limit. */
const FOAM_TEXELS = 1000;
/** Paint layer under a lake and along its shore without a ground cover. */
const LAKE_SHORE_LAYER = "riverbed";

/**
 * A lake as the editor's Lake actor: fills the carved bed below its surface,
 * with the bed recipe the editor's Lake bed tool would carve, so the user can
 * reshape it there. Null (with a reason) when it is too big for one Lake.
 */
function lakeActor(lake: WaterLake, def: WorldTerrainDef, terrainId: string, shoreLayer: string): { actor: Record<string, unknown> } | { problem: string } {
  const { spacing, origin } = def;
  const pad = lake.transition + 2 * spacing;
  const snap = (value: number, axis: 0 | 2, up: boolean): number => {
    const steps = (value - origin[axis]) / spacing;
    const limit = (axis === 0 ? def.tilesX : def.tilesZ) * def.tileQuads;
    return origin[axis] + Math.min(limit, Math.max(0, up ? Math.ceil(steps) : Math.floor(steps))) * spacing;
  };
  const min: [number, number] = [snap(lake.min[0] - pad, 0, false), snap(lake.min[1] - pad, 2, false)];
  const max: [number, number] = [snap(lake.max[0] + pad, 0, true), snap(lake.max[1] + pad, 2, true)];
  const cells = Math.round((max[0] - min[0]) / spacing) * Math.round((max[1] - min[1]) / spacing);
  if (cells > LAKE_LIMITS.cells) return { problem: `lake ${lake.id} is too big for one Lake (${cells} terrain cells, limit ${LAKE_LIMITS.cells}); no water placed` };
  // The shore foam and wet-shore masks have four texels across their band and at
  // most 1024 per axis (`waterFoam.ts`; the wet shore pads the bounds by its band):
  // past about 250 m the 1 m default bands are widened to fit.
  const extent = Math.max(max[0] - min[0], max[1] - min[1]) + 8;
  const band = Math.min(4, Math.ceil((extent * 4) / FOAM_TEXELS * 10) / 10);
  // The seed is the point furthest from the shore, where the bed is deepest.
  let seed: [number, number] = [(lake.min[0] + lake.max[0]) / 2, (lake.min[1] + lake.max[1]) / 2];
  let best = -Infinity;
  for (let z = lake.min[1]; z <= lake.max[1]; z += 2) {
    for (let x = lake.min[0]; x <= lake.max[0]; x += 2) {
      const inside = lakeBedDistance(lake.polygon, x, z);
      if (inside > best) [best, seed] = [inside, [x, z]];
    }
  }
  return {
    actor: {
      schema: 1, kind: "lake", mode: "fillExisting", coordinateSpace: "world",
      id: `${lake.id}-water`, name: title(lake.id), terrainRef: terrainId,
      seed: [savedCoordinate(seed[0]), savedCoordinate(seed[1])], bounds: { min, max },
      surfaceLevel: Number(lake.surface.toFixed(3)),
      bed: {
        points: lake.polygon.map(([x, z]) => [savedCoordinate(x), savedCoordinate(z)]),
        smooth: false, smoothness: 0, maxDepth: lake.depth, shoreSlopeDegrees: lake.shoreSlopeDeg, transitionWidth: lake.transition,
        ...(def.layers.some((layer) => layer.id === shoreLayer) ? { shorePaint: { layerId: shoreLayer, strength: 1 } } : {}),
      },
      appearance: { ...createLakeAppearance(), ...(band > 1 ? { foamWidth: band, shoreWetnessWidth: band } : {}) },
    },
  };
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
  const progress = input.onProgress ?? (() => undefined);
  progress("terrain");
  const warnings: string[] = [];
  const deferred: string[] = [];
  const models = modelResolver(brief.models, input.assetIdForFile);
  const bounds = briefWorldBounds(brief);
  const ground = createBriefTerrain(brief);
  const cover = input.cover ?? null;
  if (brief.cover && !cover) throw new Error(`the brief names ground cover ${brief.cover.file}; load it into the build input`);
  const densities: CoverDensities = {
    forest: coverDensity(brief.cover?.forest), rocks: coverDensity(brief.cover?.rocks), fields: coverDensity(brief.cover?.fields),
  };
  const waterIds = new Set(ground.courses.map((course) => course.id));

  // Terrain: tiles cover the area, centred on it.
  const { terrain } = brief;
  const tileSpan = terrain.tileQuads * terrain.spacing;
  const tilesX = Math.ceil((bounds.max[0] - bounds.min[0]) / tileSpan - 1e-9);
  const tilesZ = Math.ceil((bounds.max[1] - bounds.min[1]) / tileSpan - 1e-9);
  if (brief.ocean && (tilesX * tilesZ * terrain.tileQuads ** 2 > OCEAN_LIMITS.cells
    || Math.max(tilesX, tilesZ) * terrain.tileQuads > OCEAN_LIMITS.axisCells)) throw new Error("Ocean terrain exceeds the preparation grid limit");
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
  def.layers = cover ? structuredClone(cover.layers) : structuredClone(PILOT_TUNING.layers);
  const size = terrain.tileQuads + 1;
  const tiles = def.tiles.map(({ key }) => {
    const { x, z } = created.tiles.get(key)!;
    const tile = createFlatTerrainTile(def, x, z);
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const worldX = def.origin[0] + (tile.x * terrain.tileQuads + i) * terrain.spacing;
        const worldZ = def.origin[2] + (tile.z * terrain.tileQuads + j) * terrain.spacing;
        tile.heights[j * size + i] = ground.height(worldX, worldZ);
      }
    }
    return tile;
  });
  // Paint once every height is known: the slope reads the neighbours, across tile edges too.
  progress("paint");
  const weights = cover
    ? coverPaint(cover, brief, ground, densities, {
      clearings: briefClearings(brief).map(([x, z]) => [x, z, PILOT_TUNING.clearingRadius] as const),
      snowLine: coverSnowLine(cover, tiles.flatMap((tile) => Array.from(tile.heights.filter((_, k) => k % 7 === 0)))),
    })
    : paintWeights(brief, ground);
  const byKey = new Map(tiles.map((tile) => [`${tile.x}_${tile.z}`, tile]));
  const [lastI, lastJ] = [tilesX * terrain.tileQuads, tilesZ * terrain.tileQuads];
  const gridHeight = (gi: number, gj: number): number => {
    const [ci, cj] = [Math.min(lastI, Math.max(0, gi)), Math.min(lastJ, Math.max(0, gj))];
    const [tx, tz] = [Math.min(tilesX - 1, Math.floor(ci / terrain.tileQuads)), Math.min(tilesZ - 1, Math.floor(cj / terrain.tileQuads))];
    const tile = byKey.get(`${tx}_${tz}`)!;
    return tile.heights[(cj - tz * terrain.tileQuads) * size + (ci - tx * terrain.tileQuads)]!;
  };
  for (const tile of tiles) {
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const [gi, gj] = [tile.x * terrain.tileQuads + i, tile.z * terrain.tileQuads + j];
        const slope = Math.atan(Math.hypot(gridHeight(gi + 1, gj) - gridHeight(gi - 1, gj), gridHeight(gi, gj + 1) - gridHeight(gi, gj - 1))
          / (2 * terrain.spacing)) * 180 / Math.PI;
        writeWeights(tile, j * size + i, weights(def.origin[0] + gi * terrain.spacing, def.origin[2] + gj * terrain.spacing, slope, tile.heights[j * size + i]!));
      }
    }
  }
  const world = createTerrainEditWorld(def, tiles);
  const sampleHeight = (x: number, z: number): number | null => terrainHeightAt(def, world, x, z);

  // Level ground first, so a road ends on what it will meet.
  const padHeights: Record<string, number> = {};
  const pads: TerrainPad[] = [];
  for (const landmark of brief.landmarks) {
    if (!landmark.pad) continue;
    const [cx, cz] = briefToWorld(brief, landmark.at);
    const height = Number(ground.height(cx, cz).toFixed(2));
    const [halfX, halfZ] = [landmark.pad.size[0] / 2, landmark.pad.size[1] / 2];
    padHeights[landmark.id] = height;
    pads.push({
      polygon: [[cx - halfX, cz - halfZ], [cx + halfX, cz - halfZ], [cx + halfX, cz + halfZ], [cx - halfX, cz + halfZ]],
      height,
      falloff: landmark.pad.falloff,
    });
  }
  // Bakes over a large world can be more than one editor transaction allows: `split` prepares them in pieces, with the same result.
  if (pads.length) applyTerrainUndoPatches(world, createTerrainPadPatches(world, pads, { split: true }));

  // Stages: each sees the recipe, the placements and the splines the previous one left.
  def.splines = ground.courses.map(waterSpline);
  let recipe = worldBriefRecipe(brief);
  const layoutForStages = { schema: 1, name: levelName(levelPath), loadGroups: [], instances: [], characters: [] } as unknown as RoomLayout;
  const stages: StagePlan[] = [];
  const runStages = (list: readonly WorldStage[]): void => {
    for (const stage of list) {
      const stageTerrain: StageTerrain = {
        id: terrain.id,
        min: [def.origin[0], def.origin[2]],
        max: [def.origin[0] + tilesX * tileSpan, def.origin[2] + tilesZ * tileSpan],
        layers: def.layers.map(({ id, name }) => ({ id, name })),
        splines: def.splines ?? [],
        locked: false,
      };
      const plan = planStage(stage, { recipe, layout: layoutForStages, profile, sampleHeight, terrains: [stageTerrain], ...(ground.ocean ? { ocean: ground.ocean } : {}) });
      if (plan.errors.length > 0) throw new Error(`stage ${stage.id}: ${plan.errors.join("; ")}`);
      // The runner bakes the pads itself, before the stages that follow the ground.
      warnings.push(...plan.warnings.filter((warning) => !warning.includes("run this stage after Apply Pads")).map((warning) => `${stage.id}: ${warning}`));
      applyPlacementGroupChanges(layoutForStages, plan.groupChanges, "after");
      for (const change of plan.splineChanges) if (change.landscapeId === terrain.id) def.splines = structuredClone(change.after);
      recipe = plan.recipeAfter;
      stages.push(plan);
    }
  };
  progress("settlements");
  runStages(WORLD_BRIEF_STAGES);
  progress("roads");
  // Roads and streets, then the building pads over them (a road ends at its pad's edge).
  for (const spline of def.splines) {
    if (waterIds.has(spline.id) || spline.coordinateSpace !== "world") continue;
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, spline as WorldTerrainSpline, "both", { split: true }));
  }
  const buildingPads: TerrainPad[] = recipe.generated.pads.map((pad) => ({
    polygon: pad.polygon, height: pad.height, falloff: pad.falloff ?? PAD_FALLOFF,
  }));
  if (buildingPads.length) {
    applyTerrainUndoPatches(world, createTerrainPadPatches(world, buildingPads, { split: true }));
    paintPads(def, world.tiles, buildingPads, cover ? cover.roles.pad : PILOT_TUNING.padPaint.layerId);
  }
  progress("ground");
  runStages(WORLD_BRIEF_GROUND_STAGES);

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
  progress("placements");
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
  // Stage placements carry their own height (pads, walls and steps are not on the bare ground).
  // Parcel plates are an editor aid drawn on the unlevelled ground; a built scene leaves them out.
  for (const group of layoutForStages.instances) {
    const kept = group.placements.filter((placement) => placement.role !== PARCEL_MARKER_ROLE);
    if (kept.length) groups.set(group.assetId, [...(groups.get(group.assetId) ?? []), ...structuredClone(kept)]);
  }
  const rockCounts = cover ? coverRockCounts(cover, densities) : null;
  const scatter: ScatterPlacement[] = [
    ...yardFences(brief),
    ...scatterRocks(brief, ground, bounds, rockCounts ?? undefined),
    ...(cover && rockCounts && rockCounts.outcrops > 0 ? scatterOutcrops(brief, ground, bounds, rockCounts.outcrops, cover.rock.slope[0]) : []),
  ];
  for (const entry of scatter) {
    const assetId = models.assetId(entry.role, entry.variant, entry.pick);
    if (!assetId) throw new Error(`temporary scatter: no model row for ${entry.role}${entry.variant ? ` (${entry.variant})` : ""}`);
    place(assetId, entry);
  }

  const waterBodies: Record<string, unknown>[] = [];
  for (const lake of ground.lakes) {
    const result = lakeActor(lake, def, terrain.id, cover ? cover.roles.bed : LAKE_SHORE_LAYER);
    if ("problem" in result) warnings.push(result.problem);
    else waterBodies.push(result.actor);
  }
  if (waterBodies.length > LAKE_LIMITS.bodies) throw new Error(`${waterBodies.length} lakes; a level holds at most ${LAKE_LIMITS.bodies}`);

  const start = brief.playerStart ? briefToWorld(brief, brief.playerStart) : null;
  const startHeight = start ? sampleHeight(start[0], start[1]) : null;
  if (start && startHeight === null) throw new Error("playerStart is off the terrain");
  const terrainPath = `${levelTerrainDir(levelPath)}/${terrain.id}.terrain.json`;
  const worldSettings: Record<string, unknown> = { ...GREYBOX_LOOK.worldSettings };
  if (input.partition !== undefined) worldSettings.partition = structuredClone(input.partition);
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
    riverWaters: ground.courses.map((course) => ({
      id: `${course.id}-water-1`, name: title(course.id), landscapeRef: terrain.id, splineRef: course.id, coordinateSpace: "world",
      surfaceLevel: Number(course.surface[0]!.toFixed(3)), reflectionQuality: "medium",
    })),
    ...(waterBodies.length ? { waterBodies } : {}),
    ...(brief.ocean ? { oceanWaters: [validateOceanWater({
      schema: 1, kind: "ocean", coordinateSpace: "world", id: brief.ocean.id, name: "Ocean", terrainRef: terrain.id,
      bounds: { min: [def.origin[0], def.origin[2]], max: [def.origin[0] + tilesX * tileSpan, def.origin[2] + tilesZ * tileSpan] },
      openEdges: ["west", "east", "north", "south"], surfaceLevel: briefElevationToWorld(brief, brief.ocean.surfaceElevation),
      offshoreDepth: brief.ocean.offshoreDepth, waves: { seed: brief.seed },
    })] } : {}),
  } as unknown as RoomLayout;

  // Save-canonical files.
  progress("files");
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
  const landscapeRules = cover ? coverPlantRules(cover, terrain.id, densities, input.assetIdForFile) : plantRules(terrain.id);
  const foliageData = normalizeFoliageData({ schema: 1, type: "foliage", groups: [], landscapeRules });
  const partition = normalizeWorldPartitionSettings(input.partition);
  const foliageIndex = partition.enabled ? partitionFoliageData(foliageData, partition.grids.foliage) : null;
  if (foliageIndex && foliageIndex.cells.length) throw new Error("painted foliage cells are not built by world:brief");
  const foliage = validateFoliageData(foliageIndex ? foliageIndex.index : foliageData);
  files.set(foliageDataPath(levelPath), json(foliage));

  if (models.missing.length) warnings.push(`model rows not in the asset manifest yet: ${models.missing.join("; ")}`);
  if (brief.environment) deferred.push("environment: season/weather/hour are read, not written to the level yet (WES link, plan §12)");
  if (brief.regions.length) deferred.push("regions: in the recipe plan only");
  deferred.push(...ground.deferred);
  for (const valley of brief.valleys) if (valley.ridgeElevation) deferred.push(`valleys.${valley.id}.ridgeElevation: not used by the terrain step yet`);

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
    ground,
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
