import assert from "node:assert/strict";
import { buildSceneObjects } from "../../editor/core/sceneObjects";
import {
  matchesOutlinerPartitionFilter,
  outlinerPartitionState,
  worldPartitionCellsInRange,
  worldPartitionObjectCells,
  type OutlinerPartitionView,
} from "../../editor/core/worldPartitionOutliner";
import type { RoomLayout } from "../../engine/scene/layout";
import { normalizeWorldPartitionSettings, worldPartitionCellContents } from "../../engine/world/worldPartition";

type Check = (label: string, fn: () => void) => void;

// 128 m cells, 384 m load range (the defaults), spelled out so the distances below read plainly.
const ENABLED = normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 128, loadRange: 384 } } });

function fixture(): RoomLayout {
  return {
    schema: 1, name: "Outliner partition", loadGroups: [],
    skyAtmosphere: { exposure: 1 },
    splines: [{ id: "path", position: [0, 0, 0], spline: {
      schema: 1, closed: false, defaultUp: [0, 1, 0], reparamStepsPerSegment: 8, points: [],
    } }],
    instances: [
      { assetId: "mesh:rock", placements: [
        { name: "rock-near", position: [10, 0, 10] },
        { name: "rock-far", position: [2000, 0, 10] },
        { name: "rock-always", position: [2000, 0, 10], spatiallyLoaded: false },
      ] },
      { assetId: "mesh:tree", placements: [{ name: "tree", position: [-200, 0, 0] }] },
      // A repeated asset group: editor ids resolve to the first group, so this one is not mapped.
      { assetId: "mesh:rock", placements: [{ name: "rock-second-group", position: [600, 0, 0] }] },
      { assetId: "marker:playerStart:default", placements: [{ name: "spawn", position: [2000, 0, 0] }] },
    ],
    characters: [],
    actors: [{ name: "actor", classRef: "Actor_Test", position: [2000, 0, 2000] }],
    lights: [
      { id: "sun", type: "directional", position: [2000, 0, 0] },
      { id: "lamp", type: "point", position: [130, 0, 0] },
    ],
    targetPoints: [{ id: "target", position: [0, 0, -500] }],
    blockingVolumes: [{ id: "huge", position: [0, 0, 0], size: [2, 2, 2], scale: 200 }],
  };
}

/** OPEN_WORLD_PLAN Faz 8: Outliner World Partition cell badges and filter. */
export function registerWorldPartitionOutlinerTests(check: Check): void {
  check("world partition outliner: object ids map to the save's cells; persistent kinds are absent", () => {
    const layout = fixture();
    const before = structuredClone(layout);
    const cells = worldPartitionObjectCells(layout, ENABLED);
    assert.deepEqual(Object.fromEntries(cells), {
      "instance:mesh%3Arock:0": "0_0",
      "instance:mesh%3Arock:1": "15_0",
      "instance:mesh%3Atree:0": "-2_0",
      "actor:0": "15_15",
      "light:1": "1_0",
      "targetPoint:0": "0_-4",
    });
    assert.deepEqual(layout, before, "never mutates the layout");
    // Same element count per cell as the save routing, minus the repeated group's placement.
    const routed = [...worldPartitionCellContents(layout, ENABLED).values()]
      .reduce((sum, contents) => sum + Object.values(contents).reduce((n, items) => n + items.length, 0), 0);
    assert.equal(cells.size, routed - 1);
    assert.equal(worldPartitionObjectCells(layout, normalizeWorldPartitionSettings({ enabled: false })).size, 0);
  });

  check("world partition outliner: every mapped id is a real Outliner row", () => {
    const layout = fixture();
    const ids = new Set(buildSceneObjects(layout, {
      assetCategory: () => "",
      isSelected: () => false,
      staticObjectsCastShadow: true,
    }).map((object) => object.id));
    for (const id of worldPartitionObjectCells(layout, ENABLED).keys()) assert.ok(ids.has(id), id);
  });

  check("world partition outliner: loaded cells use the runtime's nearest-point load range", () => {
    const keys = ["0_0", "3_0", "4_0", "-4_0", "3_3", "15_0"];
    // Camera at (0, 0): cell 3_0 starts at 384 m (closed edge, loaded); 4_0 at 512 m;
    // -4_0 ends at -384 m; 3_3's nearest corner is (384, 384), 543 m away.
    assert.deepEqual([...worldPartitionCellsInRange(ENABLED, keys, 0, 0)].sort(), ["-4_0", "0_0", "3_0"]);
    assert.deepEqual([...worldPartitionCellsInRange(ENABLED, keys, 1900, 64)], ["15_0"]);
    assert.deepEqual([...worldPartitionCellsInRange(ENABLED, ["bad", "1_x"], 0, 0)], []);
  });

  check("world partition outliner: states and filters (loaded includes persistent)", () => {
    const view: OutlinerPartitionView = {
      cells: new Map([["near", "0_0"], ["far", "15_0"]]),
      loadedCells: new Set(["0_0"]),
    };
    assert.equal(outlinerPartitionState(view, "near"), "loaded");
    assert.equal(outlinerPartitionState(view, "far"), "unloaded");
    assert.equal(outlinerPartitionState(view, "sky"), "persistent");
    const shown = (filter: Parameters<typeof matchesOutlinerPartitionFilter>[2]) =>
      ["near", "far", "sky"].filter((id) => matchesOutlinerPartitionFilter(view, id, filter));
    assert.deepEqual(shown("all"), ["near", "far", "sky"]);
    assert.deepEqual(shown("loaded"), ["near", "sky"]);
    assert.deepEqual(shown("unloaded"), ["far"]);
    assert.deepEqual(shown("persistent"), ["sky"]);
  });
}
