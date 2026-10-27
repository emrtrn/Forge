import assert from "node:assert/strict";
import { KeptTerrainTilesStore, parseKeptTerrainTiles } from "../../editor/scene/keptTerrainTiles";

type Check = (label: string, fn: () => void) => void;

/** OPEN_WORLD_PLAN Faz 8: World Partition kept regions survive a reload, per terrain, outside level data. */
export function registerKeptTerrainTilesTests(check: Check): void {
  check("kept terrain tiles: stored keys round-trip per terrain, sorted, and an empty set removes the entry", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = new KeptTerrainTilesStore(storage);
    store.write("worlds/a.terrain.json", ["7_7", "6_7"]);
    store.write("worlds/b.terrain.json", ["0_0"]);
    assert.deepEqual(store.read("worlds/a.terrain.json"), ["6_7", "7_7"]);
    assert.deepEqual(store.read("worlds/b.terrain.json"), ["0_0"]);
    assert.deepEqual(store.read("worlds/missing.terrain.json"), []);
    store.write("worlds/a.terrain.json", []);
    assert.equal(data.size, 1, "nothing kept, nothing stored");
  });

  check("kept terrain tiles: malformed storage, blocked storage and no storage read as none", () => {
    assert.deepEqual(parseKeptTerrainTiles("not json"), []);
    assert.deepEqual(parseKeptTerrainTiles('{"0_0":true}'), []);
    assert.deepEqual(parseKeptTerrainTiles('["0_0", 3, "x", "-1_2", "0_0", "4_5"]'), ["0_0", "4_5"], "only tile keys, once");
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    const store = new KeptTerrainTilesStore(blocked);
    assert.deepEqual(store.read("t.terrain.json"), []);
    assert.doesNotThrow(() => store.write("t.terrain.json", ["0_0"]));
    assert.deepEqual(new KeptTerrainTilesStore(null).read("t.terrain.json"), []);
  });
}
