import assert from "node:assert/strict";
import { WorldPartitionStreaming } from "../../engine/world/worldPartitionStreaming";
import type { WorldPartitionGridSettings } from "../../engine/world/worldPartition";

type Check = (label: string, fn: () => void) => void;

function fixture(settings: WorldPartitionGridSettings, entries: [string, number[]][]) {
  const live = new Set<number>();
  const activated: number[] = [];
  const activationCalls: number[] = [];
  const unloaded: number[] = [];
  const retained = new Set<number>();
  const destroyed = new Set<number>();
  const stream = new WorldPartitionStreaming(settings, new Map(entries), {
    activate(index) {
      activationCalls.push(index);
      if (live.has(index) || destroyed.has(index)) return;
      activated.push(index);
      live.add(index);
    },
    deactivate(index) {
      if (retained.has(index)) return;
      unloaded.push(index);
      live.delete(index);
    },
    isLive: (index) => live.has(index),
  });
  return { stream, live, activated, activationCalls, unloaded, retained, destroyed };
}

export function registerWorldPartitionStreamingTests(check: Check): void {
  check("world partition streaming: prepare activates exactly in-range occupied cells without a budget", () => {
    const { stream, activated, activationCalls } = fixture({ cellSize: 16, loadRange: 24 }, [
      ["0_0", [0, 1]], ["1_0", [2]], ["2_0", [3]], ["0_2", [4]],
      ["-2_0", [5]], ["2_2", [6]], ["7_0", [7]],
    ]);
    stream.prepare([8, 8]);
    assert.deepEqual([...activated].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(stream.snapshot(), { activeCells: 5, totalCells: 7, liveActors: 6 });
    stream.prepare([8, 8]);
    assert.equal(activated.length, 6);
    assert.equal(activationCalls.length, 6);
  });

  check("world partition streaming: update activates at most two occupied cells nearest first without repeats", () => {
    const { stream, activated, activationCalls } = fixture({ cellSize: 10, loadRange: 35 },
      Array.from({ length: 6 }, (_, index) => [`${index}_0`, [index]]));
    const sources = [{ position: [5, 5] as const }];
    stream.update(sources);
    assert.deepEqual(activated, [0, 1]);
    stream.update(sources);
    assert.deepEqual(activated, [0, 1, 2, 3]);
    stream.update(sources);
    stream.update(sources);
    assert.deepEqual(activated, [0, 1, 2, 3, 4]);
    assert.deepEqual(activationCalls, [0, 1, 2, 3, 4]);
    assert.deepEqual(stream.snapshot(), { activeCells: 5, totalCells: 6, liveActors: 5 });
  });

  check("world partition streaming: priority favors cells ahead and empty grid cells spend no budget", () => {
    const { stream, activated } = fixture({ cellSize: 10, loadRange: 40 }, [
      ["-1_0", [0]], ["1_0", [1]], ["3_0", [2]],
    ]);
    stream.update([{ position: [5, 5], velocity: [1, 0] }]);
    assert.deepEqual(activated, [1, 0]);
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(activated, [1, 0, 2]);
  });

  check("world partition streaming: gameplay ranges ignore graphics view-distance settings", () => {
    const settings = { cellSize: 16, loadRange: 24, viewDistanceMultiplier: 0 };
    const { stream, activated } = fixture(settings, [["0_0", [0]], ["2_0", [1]]]);
    stream.prepare([8, 8]);
    assert.deepEqual(activated, [0, 1]);
  });

  check("world partition streaming: unload uses 1.25 range hysteresis and releases all outgoing cells in one frame", () => {
    const { stream, unloaded } = fixture({ cellSize: 16, loadRange: 24 }, [["0_0", [0]], ["1_0", [1]], ["2_0", [2]]]);
    stream.prepare([8, 8]);
    stream.update([{ position: [46, 8] }]);
    assert.deepEqual(unloaded, []); // Cell 0's edge is exactly 30 m away.
    stream.update([{ position: [46.01, 8] }]);
    assert.deepEqual(unloaded, [0]);
    stream.update([{ position: [100, 8] }]);
    assert.deepEqual(unloaded, [0, 1, 2]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 3, liveActors: 0 });
  });

  check("world partition streaming: prepare after restore loads the destination immediately", () => {
    const { stream, activated } = fixture({ cellSize: 16, loadRange: 24 }, [
      ["0_0", [0]], ["10_0", [1]], ["11_0", [2]], ["12_0", [3]],
    ]);
    stream.prepare([8, 8]);
    stream.prepare([184, 8]);
    assert.deepEqual(activated, [0, 2, 1, 3]);
    assert.deepEqual(stream.snapshot(), { activeCells: 3, totalCells: 4, liveActors: 3 });
  });

  check("world partition streaming: snapshot reflects retained pawns, destroyed actors and stable-id reactivation", () => {
    const { stream, live, retained, destroyed, activated } = fixture({ cellSize: 16, loadRange: 24 }, [["0_0", [0, 1, 2]]]);
    destroyed.add(2);
    retained.add(0);
    stream.prepare([8, 8]);
    stream.update([{ position: [100, 8] }]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 1, liveActors: 1 });
    stream.prepare([8, 8]);
    assert.deepEqual(activated, [0, 1, 1]);
    live.delete(1); // A script may destroy an actor in an active cell.
    assert.deepEqual(stream.snapshot(), { activeCells: 1, totalCells: 1, liveActors: 1 });
  });

  check("world partition streaming: clear discards the level and an empty level remains inert", () => {
    const { stream, activated } = fixture({ cellSize: 16, loadRange: 24 }, [["0_0", [0]]]);
    stream.prepare([8, 8]);
    stream.clear();
    stream.update([{ position: [8, 8] }]);
    stream.prepare([8, 8]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 0, liveActors: 0 });
    assert.deepEqual(activated, [0]);
    assert.deepEqual(fixture({ cellSize: 16, loadRange: 24 }, []).stream.snapshot(), stream.snapshot());
  });
}
