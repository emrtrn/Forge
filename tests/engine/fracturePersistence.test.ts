import assert from "node:assert/strict";
import { chunkMaskLength, decodeChunkMask, encodeChunkMask } from "../../engine/physics/fracture/fractureMask";
import { applySaveState, collectSaveState } from "../../engine/persistence/saveGameState";

/** DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 5: chunk masks and the save's `destructibles` section. */
export function registerFracturePersistenceTests(check: (label: string, fn: () => void) => void): void {
  check("fracture persistence: chunk masks round-trip every count up to 64 chunks", () => {
    for (const count of [1, 3, 4, 5, 24, 63, 64]) {
      const flags = Array.from({ length: count }, (_, index) => (index * 7 + 3) % 5 < 2);
      const mask = encodeChunkMask(flags);
      assert.equal(mask.length, chunkMaskLength(count));
      assert.match(mask, /^[0-9a-f]+$/);
      assert.deepEqual(decodeChunkMask(mask, count), flags);
      assert.deepEqual(decodeChunkMask(mask.toUpperCase(), count), flags);
    }
    // Chunk 0 is the lowest bit of the last digit.
    assert.equal(encodeChunkMask([true, false, false, false, true]), "11");
    assert.equal(encodeChunkMask(Array(64).fill(true)), "f".repeat(16));
  });

  check("deformable persistence: dents round-trip, damaged ones cost only themselves, old saves load", () => {
    const dent = { point: [1, 2, 3] as [number, number, number], direction: [0, 0, -1] as [number, number, number], depth: 0.1 };
    const saved = collectSaveState({
      activeLevelPath: "layouts/a.level.json",
      deformables: [
        { entityId: "z", dents: [dent] },
        { entityId: "a", dents: [dent, dent] },
        { entityId: "a", dents: [dent] },
        { entityId: "empty", dents: [] },
      ],
    });
    assert.deepEqual(saved.deformables!.map((entry) => [entry.entityId, entry.dents.length]), [["a", 2], ["z", 1]]);
    assert.deepEqual(applySaveState(JSON.parse(JSON.stringify(saved)))!.deformables, saved.deformables);

    const damaged = applySaveState({
      activeLevelPath: "layouts/a.level.json",
      deformables: [
        { entityId: "a", dents: [dent, { ...dent, depth: 0 }, { ...dent, depth: "deep" }, { ...dent, point: [1, 2] }, { ...dent, direction: [0, 0, 0] }, null] },
        { entityId: "b", dents: [{ ...dent, depth: -1 }] },
        { entityId: "c", dents: "many" },
        { dents: [dent] },
        null,
      ],
    })!;
    assert.deepEqual(damaged.deformables, [{ entityId: "a", dents: [dent] }]);

    assert.deepEqual(applySaveState({ activeLevelPath: "layouts/a.level.json" })!.deformables, []);
    const long = applySaveState({ activeLevelPath: "a", deformables: [{ entityId: "a", dents: Array(90).fill({ ...dent, direction: [0, 0, -2] }) }] })!;
    assert.equal(long.deformables[0]!.dents.length, 64);
    assert.deepEqual(long.deformables[0]!.dents[0]!.direction, [0, 0, -1], "directions stay unit");

    const parted = applySaveState({
      activeLevelPath: "a",
      deformables: [{ entityId: "car", dents: [{ ...dent, part: "door_left" }, { ...dent, part: "" }, { ...dent, part: 7 }, dent] }],
    })!;
    assert.deepEqual(parted.deformables[0]!.dents, [{ ...dent, part: "door_left" }, dent, dent, dent], "a dent keeps its part, a bad one lands on the body");
  });

  check("fracture persistence: malformed masks decode to null", () => {
    assert.equal(decodeChunkMask("1", 5), null, "too short");
    assert.equal(decodeChunkMask("011", 5), null, "too long");
    assert.equal(decodeChunkMask("21", 5), null, "a bit past the last chunk");
    assert.equal(decodeChunkMask("1g", 5), null);
    assert.equal(decodeChunkMask(17, 5), null);
    assert.equal(decodeChunkMask("f", 0), null);
    assert.equal(decodeChunkMask("f".repeat(17), 65), null);
    assert.equal(decodeChunkMask("f", 2.5), null);
  });

  check("fracture persistence: destructibles round-trip through collect and apply, sorted by id", () => {
    const wall = { entityId: "sm-wall:0", state: "damaged", damage: 0, chunkCount: 24, standing: "0f00ff", anchored: "000f0f" } as const;
    const crate = { entityId: "actor:3", state: "fractured", damage: 40 } as const;
    const post = { entityId: "sm-post:2", state: "intact", damage: 12.5 } as const;
    const state = collectSaveState({ activeLevelPath: "Levels/A.level.json", destructibles: [wall, crate, post] });
    assert.deepEqual(state.destructibles, [crate, post, wall]);
    assert.deepEqual(applySaveState(JSON.parse(JSON.stringify(state)))?.destructibles, [crate, post, wall]);
  });

  check("fracture persistence: bad destructible entries are dropped one by one, never the load", () => {
    const valid = { entityId: "sm-wall:0", state: "damaged", damage: 0, chunkCount: 5, standing: "11", anchored: "01" };
    const restore = applySaveState({
      activeLevelPath: "Levels/A.level.json",
      player: null,
      flags: [],
      destructibles: [
        { ...valid, entityId: "" },
        { ...valid, entityId: "bad-state", state: "broken" },
        { ...valid, entityId: "bad-count", chunkCount: 65 },
        { ...valid, entityId: "fraction-count", chunkCount: 4.5 },
        { ...valid, entityId: "bad-mask", standing: "21" },
        { ...valid, entityId: "no-anchored", anchored: undefined },
        { ...valid, entityId: "bad-damage", damage: -1 },
        { ...valid, entityId: "nan-damage", damage: Number.NaN },
        { entityId: "untouched", state: "intact", damage: 0 },
        { entityId: "missing-damage", state: "intact" },
        "sm-wall:0",
        { ...valid, standing: "1F", anchored: "0A" },
        { ...valid, standing: "01" },
        { ...valid, entityId: "all-fell", standing: "00" },
        { entityId: "old-fractured", state: "fractured" },
      ],
    });
    assert.deepEqual(restore?.destructibles, [
      { entityId: "all-fell", state: "fractured", damage: 0 },
      { entityId: "old-fractured", state: "fractured", damage: 0 },
      { ...valid, standing: "1f", anchored: "0a" },
    ]);
  });

  check("fracture persistence: a save written before Faz 5 loads with nothing broken", () => {
    const legacy = applySaveState({ activeLevelPath: "Levels/A.level.json", player: null, flags: [] });
    assert.deepEqual(legacy?.destructibles, []);
    assert.deepEqual(applySaveState({ activeLevelPath: "Levels/A.level.json", player: null, flags: [], destructibles: "x" })?.destructibles, []);
  });
}
