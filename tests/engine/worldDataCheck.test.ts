/** Headless world-data reference checks against a small in-memory file tree. */
import assert from "node:assert/strict";

import { foliageDataPath } from "../../engine/scene/foliage";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { foliageCellPath } from "../../engine/world/foliageCells";
import { hlodCellPath, hlodIndexPath } from "../../engine/world/hlod";
import { worldCellPath } from "../../engine/world/worldPartition";
import {
  checkWorldData,
  isLevelDocument,
  isSidecarJsonPath,
  type WorldDataSource,
} from "../../tools/worldDataCheck";

type Check = (label: string, fn: () => void) => void;

const LEVEL = "layouts/World.level.json";
const TERRAIN = "layouts/World.landscapes/ground.terrain.json";

function fixture(layout: Record<string, unknown> = {}) {
  const json = new Map<string, unknown>([
    [LEVEL, { instances: [], loadGroups: [], ...layout }],
  ]);
  const sizes = new Map<string, number>();
  const source: WorldDataSource = {
    size: (path) => sizes.get(path) ?? null,
    readJson(path) {
      const value = json.get(path);
      if (value instanceof Error) throw value;
      return value ?? null;
    },
  };
  const addJson = (path: string, value: unknown, bytes = 10): void => {
    json.set(path, value);
    sizes.set(path, bytes);
  };
  return { json, sizes, source, addJson, report: () => checkWorldData([LEVEL], source) };
}

function terrainFixture(tilesX = 2) {
  const tree = fixture({ landscapes: [{ dataRef: TERRAIN }] });
  const keys = tilesX === 1 ? ["0_0"] : ["0_0", "1_0"];
  tree.addJson(TERRAIN, { tilesX, tilesZ: 1, tiles: keys.map((key) => ({ key })) });
  keys.forEach((key, index) => tree.sizes.set(terrainTilePath(TERRAIN, key), (index + 1) * 100));
  return tree;
}

export function registerWorldDataCheckTests(check: Check): void {
  check("world data: HLOD proxies listed by the index must ship", () => {
    const tree = fixture({ worldCells: ["0_0"] });
    tree.sizes.set(worldCellPath(LEVEL, "main", "0_0"), 50);
    tree.addJson(hlodIndexPath(LEVEL), {
      schema: 1, type: "hlod", cellSize: 128,
      cells: [{ key: "0_0", triangles: 12, sourceHash: "a" }, { key: "3_0", triangles: 12, sourceHash: "b" }],
    });
    tree.sizes.set(hlodCellPath(LEVEL, "0_0"), 900);
    const report = tree.report();
    assert.deepEqual(report.levels[0]!.hlod, { count: 1, bytes: 900, largest: { path: hlodCellPath(LEVEL, "0_0"), bytes: 900 } });
    assert.deepEqual(report.issues, [{
      severity: "fail", level: LEVEL, path: hlodCellPath(LEVEL, "3_0"), reason: "missing HLOD proxy",
    }]);

    tree.addJson(hlodIndexPath(LEVEL), { schema: 2, type: "hlod", cellSize: 128, cells: [] });
    const invalid = tree.report().issues;
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]!.path, hlodIndexPath(LEVEL));
    assert.match(invalid[0]!.reason, /invalid HLOD index/);
  });

  check("world data: existing world and foliage cells have counts, bytes and largest files", () => {
    const tree = fixture({ worldCells: ["0_0", "-1_0"] });
    const cell = worldCellPath(LEVEL, "main", "0_0");
    const otherCell = worldCellPath(LEVEL, "main", "-1_0");
    const foliage = foliageCellPath(LEVEL, "0_0");
    const otherFoliage = foliageCellPath(LEVEL, "1_0");
    tree.sizes.set(cell, 100);
    tree.sizes.set(otherCell, 200);
    tree.addJson(foliageDataPath(LEVEL), { foliageCells: ["0_0", "1_0"] });
    tree.sizes.set(foliage, 300);
    tree.sizes.set(otherFoliage, 50);
    const report = tree.report();
    assert.deepEqual(report.issues, []);
    assert.deepEqual(report.levels, [{
      level: LEVEL,
      cells: { count: 2, bytes: 300, largest: { path: otherCell, bytes: 200 } },
      foliageCells: { count: 2, bytes: 350, largest: { path: foliage, bytes: 300 } },
      hlod: { count: 0, bytes: 0, largest: null },
      terrains: [],
    }]);
  });

  check("world data: missing cell and foliage cell each report their reference path", () => {
    const tree = fixture({ worldCells: ["0_0"] });
    tree.addJson(foliageDataPath(LEVEL), { foliageCells: ["1_0"] });
    const report = tree.report();
    assert.deepEqual(report.issues, [
      { severity: "fail", level: LEVEL, path: foliageCellPath(LEVEL, "1_0"), reason: "missing foliage cell file" },
      { severity: "fail", level: LEVEL, path: worldCellPath(LEVEL, "main", "0_0"), reason: "missing world cell file" },
    ]);
    assert.equal(report.levels.length, 1);
    assert.deepEqual(report.levels[0]!.cells, { count: 0, bytes: 0, largest: null });
    assert.deepEqual(report.levels[0]!.foliageCells, { count: 0, bytes: 0, largest: null });
  });

  check("world data: invalid world cell keys become failures without aborting valid cells", () => {
    const tree = fixture({ worldCells: ["../bad", "0_0"] });
    tree.sizes.set(worldCellPath(LEVEL, "main", "0_0"), 50);
    const report = tree.report();
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0]!.severity, "fail");
    assert.equal(report.issues[0]!.reason, "invalid world cell key");
    assert.equal(report.levels[0]!.cells.count, 1);
  });

  check("world data: 2 by 1 terrain records tile sizes and its global map", () => {
    const tree = terrainFixture();
    tree.sizes.set(terrainGlobalMapPath(TERRAIN), 40);
    const report = tree.report();
    assert.deepEqual(report.issues, []);
    assert.deepEqual(report.levels[0]!.terrains, [{
      definition: TERRAIN,
      tiles: { count: 2, bytes: 300, largest: { path: terrainTilePath(TERRAIN, "1_0"), bytes: 200 } },
      globalBytes: 40,
    }]);
  });

  check("world data: a missing terrain tile fails and is excluded from the totals", () => {
    const tree = terrainFixture();
    tree.sizes.set(terrainGlobalMapPath(TERRAIN), 40);
    tree.sizes.delete(terrainTilePath(TERRAIN, "1_0"));
    const report = tree.report();
    assert.deepEqual(report.issues, [{
      severity: "fail", level: LEVEL, path: terrainTilePath(TERRAIN, "1_0"), reason: "missing terrain tile",
    }]);
    assert.equal(report.levels[0]!.terrains[0]!.tiles.bytes, 100);
    assert.equal(report.levels[0]!.terrains[0]!.tiles.count, 1);
  });

  check("world data: a multi-tile terrain without a global map only warns", () => {
    const report = terrainFixture().report();
    assert.deepEqual(report.issues, [{
      severity: "warn", level: LEVEL, path: terrainGlobalMapPath(TERRAIN),
      reason: "missing terrain global map (computed from tiles at load)",
    }]);
    assert.equal(report.levels[0]!.terrains[0]!.globalBytes, null);
  });

  check("world data: a 1 by 1 terrain needs no global map", () => {
    const report = terrainFixture(1).report();
    assert.deepEqual(report.issues, []);
    assert.equal(report.levels[0]!.terrains[0]!.tiles.count, 1);
    assert.equal(report.levels[0]!.terrains[0]!.globalBytes, null);
  });

  check("world data: a legacy .landscape.json reference fails as unsupported, existing or not, without parsing", () => {
    const path = "layouts/ground.landscape.json";
    const tree = fixture({ landscapes: [{ dataRef: path }] });
    const unsupported = [{
      severity: "fail", level: LEVEL, path,
      reason: "unsupported legacy .landscape.json terrain; a Landscape needs a World Terrain (.terrain.json)",
    }];
    assert.deepEqual(tree.report().issues, unsupported);
    tree.addJson(path, new Error("legacy data must not be parsed"));
    assert.deepEqual(tree.report().issues, unsupported);
  });

  check("world data: missing World Terrain definition fails but retains its level report", () => {
    const tree = fixture({ landscapes: [{ dataRef: TERRAIN }] });
    assert.deepEqual(tree.report().issues, [{
      severity: "fail", level: LEVEL, path: TERRAIN, reason: "missing terrain data",
    }]);
    assert.equal(tree.report().levels.length, 1);
  });

  check("world data: levels without world data and missing foliage indices are fine", () => {
    assert.deepEqual(fixture().report(), { levels: [], issues: [] });
    const tree = fixture({ worldCells: ["0_0"] });
    tree.sizes.set(worldCellPath(LEVEL, "main", "0_0"), 0);
    assert.deepEqual(tree.report().issues, []);
    assert.equal(tree.report().levels[0]!.cells.count, 1);
  });

  check("world data: missing and unparsable levels each yield exactly one failure", () => {
    const tree = fixture();
    tree.json.delete(LEVEL);
    assert.deepEqual(tree.report(), { levels: [], issues: [{
      severity: "fail", level: LEVEL, path: LEVEL, reason: "missing level file",
    }] });
    tree.json.set(LEVEL, new SyntaxError("broken level"));
    const report = tree.report();
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0]!.severity, "fail");
    assert.equal(report.issues[0]!.path, LEVEL);
    assert.match(report.issues[0]!.reason, /broken level/);
  });

  check("world data: unparsable foliage indices and terrain definitions fail at their paths", () => {
    const tree = terrainFixture();
    const index = foliageDataPath(LEVEL);
    tree.addJson(index, new SyntaxError("broken foliage"));
    tree.addJson(TERRAIN, new SyntaxError("broken terrain"));
    const issues = tree.report().issues;
    assert.equal(issues.length, 2);
    assert.ok(issues.every((issue) => issue.severity === "fail"));
    assert.deepEqual(issues.map((issue) => issue.path).sort(), [index, TERRAIN].sort());
  });

  check("world data: invalid foliage and terrain tile keys become failures", () => {
    const tree = terrainFixture(1);
    tree.addJson(foliageDataPath(LEVEL), { foliageCells: ["bad"] });
    tree.addJson(TERRAIN, { tilesX: 1, tilesZ: 1, tiles: [{ key: "-1_0" }] });
    assert.deepEqual(tree.report().issues.map((issue) => issue.reason), [
      "invalid terrain tile key", "invalid foliage cell key",
    ]);
    assert.ok(tree.report().issues.every((issue) => issue.severity === "fail"));
  });

  check("world data: levels, terrain definitions and issues are sorted by reference path", () => {
    const tree = fixture({ worldCells: ["1_0", "0_0"] });
    const first = "layouts/A.level.json";
    tree.addJson(first, { instances: [], loadGroups: [], landscapes: [{ dataRef: "z.terrain.json" }, { dataRef: "a.terrain.json" }] });
    const report = checkWorldData([LEVEL, first], tree.source);
    assert.deepEqual(report.levels.map((level) => level.level), [first, LEVEL]);
    assert.deepEqual(report.levels[0]!.terrains.map((terrain) => terrain.definition), ["a.terrain.json", "z.terrain.json"]);
    assert.deepEqual(report.issues.map((issue) => [issue.level, issue.path]), [
      [first, "a.terrain.json"], [first, "z.terrain.json"],
      [LEVEL, worldCellPath(LEVEL, "main", "0_0")], [LEVEL, worldCellPath(LEVEL, "main", "1_0")],
    ]);
  });

  check("world data: level documents require both arrays on an object", () => {
    assert.equal(isLevelDocument({ instances: [], loadGroups: [] }), true);
    assert.equal(isLevelDocument({ instances: [1], loadGroups: [], name: "Level" }), true);
    for (const value of [null, [], 1, "level", {}, { instances: [] }, { loadGroups: [] },
      { instances: {}, loadGroups: [] }, { instances: [], loadGroups: null }]) {
      assert.equal(isLevelDocument(value), false);
    }
  });

  check("world data: sidecars and manifest basenames are skipped before parsing", () => {
    for (const suffix of ["cell", "foliage", "terrain", "effect", "vehicle", "skeleton", "foliagetype", "landscape"]) {
      assert.equal(isSidecarJsonPath(`layouts/World.${suffix}.json`), true);
    }
    for (const path of ["manifest.json", "assets/manifest.json", "project.3dgame.json", "copy/project.3dgame.json"]) {
      assert.equal(isSidecarJsonPath(path), true);
    }
    for (const path of ["layouts/World.level.json", "layouts/World.layout.json", "plain.json", "my-manifest.json"]) {
      assert.equal(isSidecarJsonPath(path), false);
    }
  });
}
