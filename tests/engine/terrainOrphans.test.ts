import assert from "node:assert/strict";
import { levelTerrainDir, levelTerrainPath } from "../../engine/terrain/terrainTypes";
import { collectJsonStrings, findOrphanedLevelTerrain } from "../../tools/terrainOrphans";

type Check = (label: string, fn: () => void) => void;

const LEVEL = "assets/Levels/Big.level.json";

export function registerTerrainOrphanTests(check: Check): void {
  check("terrain orphans: level terrain folder is the parent of every level-owned definition", () => {
    assert.equal(levelTerrainDir(LEVEL), "assets/Levels/Big.landscapes");
    assert.equal(levelTerrainDir("layouts/old.layout.json"), "layouts/old.landscapes");
    assert.equal(levelTerrainPath(LEVEL, "a b"), `${levelTerrainDir(LEVEL)}/a~20~b.terrain.json`);
    assert.throws(() => levelTerrainDir(".level.json"), /level path/);
  });

  check("terrain orphans: a deleted landscape's definition and tiles are found, referenced ones kept", () => {
    const kept = levelTerrainPath(LEVEL, "kept");
    const orphans = findOrphanedLevelTerrain(LEVEL, [kept], [
      "kept.terrain.json", "kept.tiles", "kept.global.bin",
      "gone.terrain.json", "gone.tiles", "gone.global.bin",
      "half~2f~.tiles",
      "lonely.global.bin",
      "notes.txt",
    ]);
    assert.deepEqual(orphans, [
      {
        definition: "assets/Levels/Big.landscapes/gone.terrain.json",
        entries: ["assets/Levels/Big.landscapes/gone.global.bin", "assets/Levels/Big.landscapes/gone.terrain.json", "assets/Levels/Big.landscapes/gone.tiles"],
      },
      // A tile folder whose definition was never committed is unreferenced too.
      { definition: "assets/Levels/Big.landscapes/half~2f~.terrain.json", entries: ["assets/Levels/Big.landscapes/half~2f~.tiles"] },
      { definition: "assets/Levels/Big.landscapes/lonely.terrain.json", entries: ["assets/Levels/Big.landscapes/lonely.global.bin"] },
    ]);
  });

  check("terrain orphans: no listing or every entry referenced means nothing to remove", () => {
    assert.deepEqual(findOrphanedLevelTerrain(LEVEL, [], []), []);
    const refs = ["a", "b"].map((id) => levelTerrainPath(LEVEL, id));
    assert.deepEqual(findOrphanedLevelTerrain(LEVEL, refs, ["a.terrain.json", "a.tiles", "b.terrain.json"]), []);
  });

  check("terrain orphans: JSON string collection reaches nested references in other documents", () => {
    const strings = collectJsonStrings({ landscapes: [{ id: "x", dataRef: "p/q.terrain.json", n: 1 }], tags: ["t"] });
    assert.ok(strings.has("p/q.terrain.json"));
    assert.ok(strings.has("t"));
    assert.ok(!strings.has("1"));
  });
}
