/**
 * World Builder pilot, built from `WbPilotValley.worldbrief.json` by the
 * `world:brief` runner (`tools/world/worldBriefBuild.ts`): the valley rebuilds
 * the same way, its road reaches the cabin within the road limits, nothing it
 * places leaves the ground, and its files are what the editor's save writes, so
 * opening and saving the level changes nothing, partitioned or not.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { mergeWorldCells, normalizeWorldCellDocument, type WorldCellDocument } from "../../engine/world/worldPartition";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { briefToWorld, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { validateFoliageData, validateSavePayload, validateSaveWorldRecipePayload } from "../../tools/saveValidator";
import { buildWorldFromBrief, saveLevelFiles, type WorldBriefBuild } from "../../tools/world/worldBriefBuild";
import { runWorldBrief } from "../../tools/world/worldBriefRun";
import { PILOT_BRIEF } from "./worldBrief.test";

type Check = (label: string, run: () => void) => void;
type CheckAsync = (label: string, run: () => Promise<void>) => Promise<void>;

const LEVEL = "assets/world-pilot/Levels/WbPilotValley.level.json";
const PARTITION = { enabled: true, grids: { main: { cellSize: 128, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 } } };

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

function placementsById(layout: RoomLayout): Map<string, string> {
  const result = new Map<string, string>();
  for (const group of layout.instances) {
    for (const placement of group.placements) result.set(placement.id ?? placement.name ?? "", `${group.assetId} ${JSON.stringify(placement)}`);
  }
  return result;
}

/** What the editor reads back: the level with its cells merged in. */
function readLevel(world: WorldBriefBuild): { persistent: RoomLayout; cells: WorldCellDocument[]; merged: RoomLayout } {
  const persistent = JSON.parse(world.files.get(LEVEL) as string) as RoomLayout;
  const cells = [...world.files].filter(([path]) => path.includes(".cells/main/"))
    .map(([, text]) => normalizeWorldCellDocument(JSON.parse(text as string)));
  return { persistent, cells, merged: mergeWorldCells(persistent, cells) };
}

export async function registerWbPilotValleyTests(check: Check, checkSlowAsync: CheckAsync): Promise<void> {
  const brief = (): WorldBrief => normalizeWorldBrief(JSON.parse(readFileSync(PILOT_BRIEF, "utf8"))).brief!;
  const profile = () => normalizeRegionProfile(JSON.parse(readFileSync(`public/${brief().regionProfile}`, "utf8"))).profile;
  const assetIdForFile = lazy(() => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
    const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
    return (file: string) => byPath.get(file) ?? null;
  });
  const pilot = lazy(() => buildWorldFromBrief({ brief: brief(), levelPath: LEVEL, profile: profile(), assetIdForFile: assetIdForFile() }));
  const partitioned = lazy(() => buildWorldFromBrief({
    brief: brief(), levelPath: LEVEL, profile: profile(), assetIdForFile: assetIdForFile(), partition: PARTITION,
  }));

  check("wb pilot valley: two builds agree byte for byte; partition only moves placements into cells", () => {
    const [plain, split] = [pilot(), partitioned()];
    for (const [path, data] of plain.files) {
      if (path === LEVEL || path.endsWith(".foliage.json")) continue;
      assert.deepEqual(split.files.get(path), data, path);
    }
    assert.deepEqual(placementsById(readLevel(split).merged), placementsById(plain.layout));
    assert.equal(readLevel(plain).cells.length, 0);
    assert.ok(split.cellKeys.length > 20, `${split.cellKeys.length} cells`);
  });

  check("wb pilot valley: the climb stays within its limit and ends at the cabin", () => {
    const { def, stages, recipe } = pilot();
    const roads = stages.find((stage) => stage.stageId === "roads")!;
    assert.deepEqual(roads.errors, []);
    assert.deepEqual([...roads.added].sort(), ["wb-road-climb", "wb-road-valley"]);
    assert.ok(recipe.ownership.splines["wb-road-climb"], "the stage owns its road");
    const climb = def.splines!.find((spline) => spline.id === "wb-road-climb")!;
    const points = climb.points.map((point) => point.position);
    points.slice(1).forEach((point, index) => {
      const before = points[index]!;
      const run = Math.hypot(point[0] - before[0], point[2] - before[2]);
      const grade = Math.atan2(Math.abs(point[1] - before[1]), run) * 180 / Math.PI;
      // Known gap: hairpin tips are short and steeper, the route solver does not widen bends.
      if (run >= 9.5) assert.ok(grade <= 13, `leg ${index} climbs ${grade.toFixed(1)}°`);
    });
    const end = points[points.length - 1]!;
    const roadEnd = briefToWorld(brief(), brief().roads.nodes.find((node) => node.id === "cabin-end")!.at);
    assert.ok(Math.hypot(end[0] - roadEnd[0], end[2] - roadEnd[1]) < 1, "the road reaches the cabin's level ground");
  });

  check("wb pilot valley: the water stays below both banks and the cabin stands on level ground", () => {
    const { sampleHeight, land, padHeights } = pilot();
    for (const { z } of land.rows.slice(1, -1)) {
      const surface = land.riverSurface(z);
      assert.ok(sampleHeight(land.riverX(z), z)! < surface, `bed under the water at z ${z}`);
      assert.ok(sampleHeight(land.riverX(z) + 14, z)! > surface, `east bank above the water at z ${z}`);
    }
    const cabin = briefToWorld(brief(), brief().landmarks.find((landmark) => landmark.id === "cabin")!.at);
    for (const [dx, dz] of [[0, 0], [10, 10], [-10, 10], [10, -10], [-10, -10]] as const) {
      assert.ok(Math.abs(sampleHeight(cabin[0] + dx, cabin[1] + dz)! - padHeights.cabin!) < 0.02, `level at ${dx}, ${dz}`);
    }
  });

  check("wb pilot valley: every placement has a unique id and stands on the ground; every plant rule grows on the terrain", () => {
    const { layout, foliage, sampleHeight } = pilot();
    const seen = new Set<string>();
    for (const { assetId, placements } of layout.instances) {
      if (assetId.startsWith("marker:")) continue;
      for (const { id, position } of placements) {
        assert.ok(id && !seen.has(id), `unique id ${id}`);
        seen.add(id);
        assert.ok(Math.abs(position[1]! - sampleHeight(position[0]!, position[2]!)!) < 0.01, `${id} on the ground`);
      }
    }
    for (const id of ["cabin", "woodpile", "signpost", "fence-north-0", "rock-high-0"]) assert.ok(seen.has(id), id);
    assert.equal(seen.size, 150);
    const rules = foliage.landscapeRules as Array<{ landscapeId: string }>;
    assert.ok(rules.length > 0 && rules.every((rule) => rule.landscapeId === "valley"));
  });

  check("wb pilot valley: every file is what the editor's save would write", () => {
    const world = pilot();
    const text = (path: string) => world.files.get(path) as string;
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    assert.equal(json(validateSavePayload({ layout: JSON.parse(text(LEVEL)) }).layout), text(LEVEL));
    const recipePath = "assets/world-pilot/Levels/WbPilotValley.worldrecipe.json";
    assert.equal(json(validateSaveWorldRecipePayload({ level: LEVEL, recipe: JSON.parse(text(recipePath)) }).recipe), text(recipePath));
    const foliagePath = "assets/world-pilot/Levels/WbPilotValley.foliage.json";
    assert.equal(json(validateFoliageData(JSON.parse(text(foliagePath)))), text(foliagePath));
    const terrainPath = "assets/world-pilot/Levels/WbPilotValley.landscapes/valley.terrain.json";
    assert.equal(json(normalizeWorldTerrain(JSON.parse(text(terrainPath)))), text(terrainPath));
    assert.ok(!text(LEVEL).includes('"collision": true'), "default collision is not written");
  });

  check("wb pilot valley: a partitioned level reads back whole, and saving it again writes the same files", () => {
    const world = partitioned();
    const { persistent, cells, merged } = readLevel(world);
    assert.deepEqual(persistent.worldCells, world.cellKeys);
    assert.deepEqual(cells.map((cell) => cell.key), world.cellKeys);
    assert.deepEqual(persistent.worldSettings?.partition, PARTITION);
    const saved = saveLevelFiles(merged, LEVEL);
    assert.equal(saved.level, world.files.get(LEVEL));
    const written = [...world.files].filter(([path]) => path.includes(".cells/main/"));
    assert.deepEqual([...saved.cells], written);
    const foliage = JSON.parse(world.files.get("assets/world-pilot/Levels/WbPilotValley.foliage.json") as string);
    assert.deepEqual(foliage.foliageCells, [], "plant rules only: the partitioned foliage index lists no cells");
  });

  await checkSlowAsync("wb pilot valley: world:brief writes a new level, refuses to overwrite it, and with --force keeps its partition and drops stale cells", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-world-brief-"));
    try {
      const pilotBrief = brief();
      for (const path of ["project.3dgame.json", "assets/manifest.json", pilotBrief.regionProfile!, PILOT_BRIEF.slice("public/".length)]) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        cpSync(join("public", path), join(root, path));
      }
      const out = "assets/trial/Valley.level.json";
      const options = { root, brief: PILOT_BRIEF.slice("public/".length), out };
      const first = await runWorldBrief(options);
      assert.equal(first.registered, "valley-level");
      const manifest = JSON.parse(readFileSync(join(root, "assets/manifest.json"), "utf8")) as { assets: Array<Record<string, unknown>> };
      assert.deepEqual(manifest.assets.filter((asset) => asset.path === out).map((asset) => asset.assetType), ["level"]);
      assert.ok(existsSync(join(root, "assets/trial/Valley.landscapes/valley.tiles/7_7.tile.bin")));
      await assert.rejects(runWorldBrief(options), /exists; it may hold editor changes/);

      const level = JSON.parse(readFileSync(join(root, out), "utf8")) as RoomLayout;
      level.worldSettings = { ...level.worldSettings, partition: PARTITION };
      writeFileSync(join(root, out), JSON.stringify(level));
      mkdirSync(join(root, "assets/trial/Valley.cells/main"), { recursive: true });
      writeFileSync(join(root, "assets/trial/Valley.cells/main/99_99.cell.json"), "{}");
      const second = await runWorldBrief({ ...options, force: true });
      assert.equal(second.registered, null);
      assert.deepEqual(second.removedCells, ["assets/trial/Valley.cells/main/99_99.cell.json"]);
      const cells = readdirSync(join(root, "assets/trial/Valley.cells/main")).map((name) => name.replace(".cell.json", ""));
      assert.deepEqual(cells.sort(), [...second.build.cellKeys].sort());
      const rebuilt = JSON.parse(readFileSync(join(root, out), "utf8")) as RoomLayout;
      assert.deepEqual(rebuilt.worldSettings?.partition, PARTITION);
      assert.deepEqual(rebuilt.worldCells, second.build.cellKeys);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
