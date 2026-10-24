import assert from "node:assert/strict";
import { normalizeFoliageData, type LayoutFoliageData, type LayoutFoliageInstance } from "../../engine/scene/foliage";
import {
  countFoliageCellInstances, foliageCellPath, mergeFoliageCells, normalizeFoliageCellDocument, partitionFoliageData,
  type FoliageCellDocument,
} from "../../engine/world/foliageCells";
import { worldCellAt, worldCellKey } from "../../engine/world/worldGrid";
import { worldCellPath } from "../../engine/world/worldPartition";
import { validateSaveFoliageCellsPayload } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;
const GRID = { cellSize: 64, loadRange: 256 };

function instance(x: number, z: number, seed = 1): LayoutFoliageInstance {
  return { position: [x, 3, z], rotation: [1, 2, 3], scale: [1, 1, 1], normal: [0, 1, 0], seed };
}

function fixture(): LayoutFoliageData {
  return {
    schema: 1, type: "foliage",
    groups: [
      { id: "trees", foliageTypeId: "tree", target: { kind: "landscape", id: "ground" },
        instances: [instance(-1, -1), instance(0, 0), instance(3, 2, 2), instance(64, 0), instance(0, 64)] },
      { id: "empty", foliageTypeId: "unused", target: { kind: "staticMesh", id: "rock" }, instances: [] },
      { id: "grass", foliageTypeId: "grass", target: { kind: "landscape", id: "ground" },
        instances: [instance(-64, -64), instance(65, 0)] },
    ],
    landscapeRules: [{ id: "rule", landscapeId: "ground", layerId: "grass", foliageTypeId: "grass",
      density: 1, minWeight: 0.5, seed: 1 }],
  };
}

function cell(key = "0_0"): FoliageCellDocument {
  return { schema: 1, type: "foliageCell", key, groups: [{ id: "trees", instances: [instance(1, 2)] }] };
}

export function registerFoliageCellsTests(check: Check): void {
  check("foliage cells: optional index normalization preserves absence, empty arrays and numeric key order", () => {
    const legacy = normalizeFoliageData(fixture());
    assert.equal("foliageCells" in legacy, false);
    assert.deepEqual(normalizeFoliageData({ foliageCells: ["bad", 7, null] }).foliageCells, []);
    assert.equal("foliageCells" in normalizeFoliageData({ foliageCells: "0_0" }), false);
    const keys = ["10_0", "2_0", "-1_-1", "0_2", "2_0", "oops", null];
    assert.deepEqual(normalizeFoliageData({ foliageCells: keys }).foliageCells, ["-1_-1", "2_0", "10_0", "0_2"]);
  });

  check("foliage cells: level paths mirror main cell paths and reject invalid keys", () => {
    assert.equal(worldCellPath("assets/Levels/Big.level.json", "main", "-1_2"), "assets/Levels/Big.cells/main/-1_2.cell.json");
    assert.equal(foliageCellPath("assets/Levels/Big.level.json", "-1_2"), "assets/Levels/Big.cells/foliage/-1_2.foliage.json");
    for (const level of ["layouts/legacy.layout.json", "layouts/old.json", "assets\\Levels\\Big.level.json"]) {
      assert.equal(foliageCellPath(level, "0_0"), worldCellPath(level, "main", "0_0")
        .replace("/main/", "/foliage/").replace(".cell.json", ".foliage.json"));
    }
    assert.throws(() => foliageCellPath("level.json", "../0_0"), /key/);
    assert.throws(() => foliageCellPath("", "0_0"), /level path/);
  });

  check("foliage cells: ordered data round-trips with default rules and preserves empty groups", () => {
    const data = fixture();
    delete data.landscapeRules;
    const before = structuredClone(data);
    const split = partitionFoliageData(data, GRID);
    assert.deepEqual(split.index.foliageCells, ["-1_-1", "0_0", "1_0", "0_1"]);
    assert.deepEqual(split.cells.map((entry) => entry.key), split.index.foliageCells);
    assert.deepEqual(split.index.groups.map((group) => group.id), ["trees", "empty", "grass"]);
    assert.ok(split.index.groups.every((group) => group.instances.length === 0));
    assert.ok(split.cells.every((entry) => entry.groups.every((group) => group.id !== "empty")));
    assert.deepEqual(split.cells[0]!.groups.map((group) => group.id), ["trees", "grass"]);
    assert.equal(countFoliageCellInstances(split.cells[0]!), 2);
    assert.deepEqual(mergeFoliageCells(split.index, split.cells), { ...data, landscapeRules: [] });
    assert.deepEqual(mergeFoliageCells(split.index, [...split.cells].reverse()), { ...data, landscapeRules: [] });
    const edge = worldCellAt(GRID, 64, 0);
    assert.equal(worldCellKey(edge.x, edge.z), "1_0");
    assert.deepEqual(split.cells.find((entry) => entry.key === worldCellKey(edge.x, edge.z))!.groups[0]!.instances,
      [data.groups[0]!.instances[3]]);
    assert.deepEqual(data, before);
  });

  check("foliage cells: arbitrary order preserves multisets and repartition is idempotent", () => {
    const data = fixture();
    data.foliageCells = ["obsolete"];
    for (const group of data.groups) group.instances.reverse();
    const split = partitionFoliageData(data, GRID);
    const merged = mergeFoliageCells(split.index, split.cells);
    const signatures = (values: LayoutFoliageInstance[]) => values.map((value) => JSON.stringify(value)).sort();
    merged.groups.forEach((group, i) => assert.deepEqual(signatures(group.instances), signatures(data.groups[i]!.instances)));
    assert.equal("foliageCells" in merged, false);
    assert.deepEqual(partitionFoliageData(merged, GRID), split);
    assert.deepEqual(partitionFoliageData({ schema: 1, type: "foliage", groups: [] }, GRID), {
      index: { schema: 1, type: "foliage", groups: [], landscapeRules: [], foliageCells: [] }, cells: [],
    });
  });

  check("foliage cells: partition and merge deeply detach transforms, targets and rules", () => {
    const data = fixture();
    const before = structuredClone(data);
    const split = partitionFoliageData(data, GRID);
    const merged = mergeFoliageCells(split.index, split.cells);
    const splitBefore = structuredClone(split);
    merged.groups[0]!.instances[0]!.normal![0] = 8;
    merged.groups[0]!.instances[0]!.position[0] = 900;
    merged.groups[0]!.target.id = "changed";
    merged.landscapeRules![0]!.density = 7;
    assert.deepEqual(split, splitBefore);
    split.cells[0]!.groups[0]!.instances[0]!.scale[0] = 42;
    split.index.groups[0]!.target.id = "other";
    split.index.landscapeRules![0]!.seed = 42;
    assert.deepEqual(data, before);
    const persistent = fixture();
    const persistentBefore = structuredClone(persistent);
    const own = mergeFoliageCells(persistent, [cell()]);
    assert.deepEqual(own.groups[0]!.instances, [...persistent.groups[0]!.instances, ...cell().groups[0]!.instances]);
    own.groups[0]!.instances[0]!.rotation[0] = 90;
    assert.deepEqual(persistent, persistentBefore);
  });

  check("foliage cells: cell normalization drops malformed instances and JSON round-trips without aliasing", () => {
    const input = { ...cell(), groups: [{ id: "trees", instances: [instance(1, 2), null, {}, { position: [1] }] },
      { id: "empty", instances: [null] }] };
    const before = structuredClone(input);
    const normalized = normalizeFoliageCellDocument(input);
    assert.equal(countFoliageCellInstances(normalized), 1);
    assert.deepEqual(normalized.groups[1], { id: "empty", instances: [] });
    assert.deepEqual(normalizeFoliageCellDocument(JSON.parse(JSON.stringify(normalized))), normalized);
    normalized.groups[0]!.instances[0]!.position[0] = 99;
    assert.deepEqual(input, before);
  });

  check("foliage cells: cell normalization rejects every malformed header and group", () => {
    for (const value of [null, [], 3, {}, { ...cell(), schema: 2 }, { ...cell(), type: "foliage" },
      { ...cell(), key: 4 }, { ...cell(), key: "bad" }, { ...cell(), groups: null }]) {
      assert.throws(() => normalizeFoliageCellDocument(value));
    }
    for (const group of [null, [], {}, { id: "", instances: [] }, { id: 7, instances: [] },
      { id: "trees" }, { id: "trees", instances: null }]) {
      assert.throws(() => normalizeFoliageCellDocument({ ...cell(), groups: [group] }));
    }
    assert.throws(() => normalizeFoliageCellDocument({ ...cell(), groups: [...cell().groups, ...cell().groups] }), /duplicate/);
  });

  check("foliage cells: merge rejects duplicate cells, unlisted keys and unknown groups", () => {
    const index = partitionFoliageData(fixture(), GRID).index;
    assert.throws(() => mergeFoliageCells(index, [cell(), cell()]), /duplicate cell key 0_0/);
    assert.throws(() => mergeFoliageCells(index, [cell("9_9")]), /not in foliageCells/);
    assert.throws(() => mergeFoliageCells({ ...index, foliageCells: [] }, [cell()]), /not in foliageCells/);
    assert.throws(() => mergeFoliageCells(index, [{ ...cell(), groups: [{ id: "unknown", instances: [] }] }]), /unknown foliage group/);
  });

  check("foliage cells: save payload validates keep, duplicates, level paths and malformed instances", () => {
    const payload = { level: "assets/Levels/Big.level.json", cells: [cell()], keep: ["1_0", "0_0"] };
    assert.deepEqual(validateSaveFoliageCellsPayload(payload), { ...payload, keep: ["0_0", "1_0"] });
    assert.equal(validateSaveFoliageCellsPayload({ level: payload.level, cells: [] }).keep, null);
    assert.throws(() => validateSaveFoliageCellsPayload({ ...payload, keep: [] }), /cell key 0_0 is not in keep/);
    assert.throws(() => validateSaveFoliageCellsPayload({ ...payload, cells: [cell(), cell()] }), /duplicate cell key 0_0/);
    for (const keep of [null, "0_0", ["bad"], ["0_0", "0_0"]]) {
      assert.throws(() => validateSaveFoliageCellsPayload({ ...payload, keep }));
    }
    for (const value of [null, [], {}, { ...payload, cells: null }, { ...payload, level: "../outside.level.json" }]) {
      assert.throws(() => validateSaveFoliageCellsPayload(value));
    }
    const result = validateSaveFoliageCellsPayload({ ...payload,
      cells: [{ ...cell(), groups: [{ id: "trees", instances: [null, instance(0, 0)] }] }] });
    assert.equal(countFoliageCellInstances(result.cells[0]!), 1);
  });
}
