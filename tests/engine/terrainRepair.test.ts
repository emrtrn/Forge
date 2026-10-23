import assert from "node:assert/strict";
import { repairTerrainSummaries } from "../../engine/terrain/terrainRepair";
import { validateTerrainTile } from "../../engine/terrain/terrainLoader";
import { decodeTerrainTile, type DecodedTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { generateTestWorld } from "../../tools/world/testWorld";

type Check = (label: string, fn: () => void) => void;

export function registerTerrainRepairTests(check: Check): void {
  const world = () => generateTestWorld({ tiles: 2, tileQuads: 32, spacing: 16 });
  const decodeAll = (source: ReturnType<typeof world>): Map<string, DecodedTerrainTile> =>
    new Map([...source.tileBytes].map(([key, bytes]) => [key, decodeTerrainTile(bytes)]));

  check("terrain repair: a consistent definition is left alone", () => {
    const source = world();
    const result = repairTerrainSummaries(source.def, decodeAll(source));
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.def, source.def);
  });

  check("terrain repair: a stale summary fails validation with a fix hint, repair makes it pass without touching tiles", () => {
    const source = world();
    const tiles = decodeAll(source);
    const key = [...tiles.keys()].sort()[1]!;
    const real = source.def.tiles.find((entry) => entry.key === key)!;
    assert.ok(real.maxHeight - real.minHeight > 1, "fixture tile needs relief to shrink the summary");
    const stale = structuredClone(source.def);
    const summary = stale.tiles.find((entry) => entry.key === key)!;
    summary.maxHeight = real.maxHeight - 1;

    assert.throws(() => validateTerrainTile(stale, key, source.tileBytes.get(key)!), /exceed declared bounds.*npm run terrain:repair/s);

    const before = structuredClone(stale);
    const result = repairTerrainSummaries(stale, tiles);
    assert.deepEqual(stale, before, "the input definition is not mutated");
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0]!.key, key);
    assert.equal(result.changes[0]!.before.max, real.maxHeight - 1);
    assert.ok(Math.abs(result.changes[0]!.after.max - real.maxHeight) < 1e-3);
    for (const [tileKey, bytes] of source.tileBytes) validateTerrainTile(result.def, tileKey, bytes);
    assert.deepEqual(
      result.def.tiles.filter((entry) => entry.key !== key),
      stale.tiles.filter((entry) => entry.key !== key),
      "only the drifted tile's summary changes",
    );
  });

  check("terrain repair: a summary wider than the samples is not drift and is kept", () => {
    const source = world();
    const wide = structuredClone(source.def);
    for (const entry of wide.tiles) {
      entry.minHeight -= 5;
      entry.maxHeight += 5;
    }
    assert.deepEqual(repairTerrainSummaries(wide, decodeAll(source)).changes, []);
  });

  check("terrain repair: samples outside the encoding range stay an error, not a summary fix", () => {
    const source = world();
    const narrow = structuredClone(source.def);
    const key = narrow.tiles[0]!.key;
    const tile = decodeAll(source).get(key)!;
    narrow.heightMin = tile.heightMin;
    narrow.heightMax = tile.heightMin + 0.5;
    assert.throws(() => validateTerrainTile(narrow, key, source.tileBytes.get(key)!), /header does not match|encoding range/);
  });
}
