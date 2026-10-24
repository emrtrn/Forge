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
    assert.deepEqual(stream.snapshot(), { activeCells: 5, totalCells: 7, liveActors: 6, prefetchedCells: 0, waitingCells: 0 });
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
    assert.deepEqual(stream.snapshot(), { activeCells: 5, totalCells: 6, liveActors: 5, prefetchedCells: 0, waitingCells: 0 });
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
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 3, liveActors: 0, prefetchedCells: 0, waitingCells: 0 });
  });

  check("world partition streaming: prepare after restore loads the destination immediately", () => {
    const { stream, activated } = fixture({ cellSize: 16, loadRange: 24 }, [
      ["0_0", [0]], ["10_0", [1]], ["11_0", [2]], ["12_0", [3]],
    ]);
    stream.prepare([8, 8]);
    stream.prepare([184, 8]);
    assert.deepEqual(activated, [0, 2, 1, 3]);
    assert.deepEqual(stream.snapshot(), { activeCells: 3, totalCells: 4, liveActors: 3, prefetchedCells: 0, waitingCells: 0 });
  });

  check("world partition streaming: snapshot reflects retained pawns, destroyed actors and stable-id reactivation", () => {
    const { stream, live, retained, destroyed, activated } = fixture({ cellSize: 16, loadRange: 24 }, [["0_0", [0, 1, 2]]]);
    destroyed.add(2);
    retained.add(0);
    stream.prepare([8, 8]);
    stream.update([{ position: [100, 8] }]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 1, liveActors: 1, prefetchedCells: 0, waitingCells: 0 });
    stream.prepare([8, 8]);
    assert.deepEqual(activated, [0, 1, 1]);
    live.delete(1); // A script may destroy an actor in an active cell.
    assert.deepEqual(stream.snapshot(), { activeCells: 1, totalCells: 1, liveActors: 1, prefetchedCells: 0, waitingCells: 0 });
  });

  check("world partition streaming: clear discards the level and an empty level remains inert", () => {
    const { stream, activated } = fixture({ cellSize: 16, loadRange: 24 }, [["0_0", [0]]]);
    stream.prepare([8, 8]);
    stream.clear();
    stream.update([{ position: [8, 8] }]);
    stream.prepare([8, 8]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 0, liveActors: 0, prefetchedCells: 0, waitingCells: 0 });
    assert.deepEqual(activated, [0]);
    assert.deepEqual(fixture({ cellSize: 16, loadRange: 24 }, []).stream.snapshot(), stream.snapshot());
  });

  check("world partition streaming: prefetch covers occupied ring cells before activation with independent hysteresis", () => {
    const events: string[] = [];
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map([
      ["0_0", [0]], ["1_0", []], ["2_0", [2]], ["3_0", [3]], ["4_0", [4]],
    ]), {
      activate: (index) => { events.push(`activate ${index}`); },
      deactivate: (index) => { events.push(`deactivate ${index}`); },
      isLive: () => false,
      prefetch: (key, wanted) => { events.push(`prefetch ${key} ${wanted}`); },
    });
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(events, ["prefetch 0_0 true", "prefetch 2_0 true", "prefetch 3_0 true", "activate 0", "activate 2"]);
    assert.equal(stream.snapshot().prefetchedCells, 3);
    assert.equal(stream.snapshot().activeCells, 2);
    stream.update([{ position: [-7.5, 5] }]);
    assert.deepEqual(events.slice(5), ["deactivate 2"]);
    stream.update([{ position: [-7.51, 5] }]);
    assert.deepEqual(events.slice(5), ["deactivate 2", "prefetch 3_0 false"]);
    assert.equal(stream.snapshot().prefetchedCells, 2);
    stream.update([{ position: [-100, 5] }]);
    assert.deepEqual(events.slice(7), ["deactivate 0", "prefetch 0_0 false", "prefetch 2_0 false"]);
  });

  check("world partition streaming: the prefetch-only step never releases currently active cells", () => {
    const released: string[] = [];
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map([
      ["0_0", [0]], ["2_0", [2]], ["3_0", [3]],
    ]), {
      activate: () => {}, deactivate: () => {}, isLive: () => false,
      prefetch: (key, wanted) => { if (!wanted) released.push(key); },
    });
    stream.prepare([5, 5]);
    assert.deepEqual(stream.prefetchAround([500, 5]), []);
    assert.deepEqual(released, ["3_0"]);
    assert.equal(stream.snapshot().activeCells, 2);
    assert.equal(stream.snapshot().prefetchedCells, 2);
  });

  check("world partition streaming: readiness is filtered before the activation budget and retried next update", () => {
    const activated: number[] = [];
    let ready = false;
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map([
      ["0_0", [0]], ["1_0", [1]], ["2_0", [2]],
    ]), {
      activate: (index) => { activated.push(index); }, deactivate: () => {}, isLive: () => false,
      isReady: (key) => key !== "0_0" || ready,
    });
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(activated, [1, 2]);
    assert.equal(stream.snapshot().waitingCells, 1);
    assert.equal(stream.snapshot().prefetchedCells, 0);
    ready = true;
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(activated, [1, 2, 0]);
    assert.equal(stream.snapshot().waitingCells, 0);
  });

  check("world partition streaming: waiting counts all occupied unready candidates beyond the budget", () => {
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 40 }, new Map([
      ["0_0", [0]], ["1_0", [1]], ["2_0", [2]], ["4_0", [4]], ["5_0", [5]],
    ]), {
      activate: () => {}, deactivate: () => {}, isLive: () => false,
      isReady: (key) => key !== "0_0" && key !== "4_0" && key !== "5_0",
    });
    stream.update([{ position: [5, 5] }]);
    assert.equal(stream.snapshot().activeCells, 2);
    assert.equal(stream.snapshot().waitingCells, 2);
    stream.update([{ position: [500, 5] }]);
    assert.equal(stream.snapshot().waitingCells, 0);
  });

  check("world partition streaming: prefetchAround returns prepare's ordered candidates regardless of readiness", () => {
    const entries: [string, number[]][] = [
      ["0_0", [0]], ["1_0", [1]], ["2_0", [2]], ["3_0", [3]], ["4_0", [4]],
    ];
    const expected: string[] = [];
    const reference = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map(entries), {
      activate: () => {}, deactivate: () => {}, isLive: () => false,
      cellChanged: (key, active) => { if (active) expected.push(key); },
    });
    reference.prepare([5, 5]);
    const prefetched: string[] = [];
    const activated: number[] = [];
    const ready = new Set(["0_0", "2_0"]);
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map(entries), {
      activate: (index) => { activated.push(index); }, deactivate: () => {}, isLive: () => false,
      prefetch: (key, wanted) => { if (wanted) prefetched.push(key); },
      isReady: (key) => ready.has(key),
    });
    assert.deepEqual(stream.prefetchAround([5, 5]), expected);
    assert.deepEqual(expected, ["0_0", "1_0", "2_0"]);
    assert.deepEqual(prefetched, ["0_0", "1_0", "2_0", "3_0"]);
    assert.deepEqual(activated, []);
    assert.equal(stream.snapshot().waitingCells, 0);
    assert.deepEqual(stream.prefetchAround([5, 5]), expected);
    assert.equal(prefetched.length, 4);
    stream.prepare([5, 5]);
    assert.deepEqual(activated, [0, 2]);
    assert.equal(stream.snapshot().waitingCells, 1);
    assert.deepEqual(stream.prefetchAround([5, 5]), ["1_0"]);
    ready.add("1_0");
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(activated, [0, 2, 1]);
  });

  check("world partition streaming: prepare remains unbudgeted when prefetched cells are ready", () => {
    const activated: number[] = [];
    const prefetched: string[] = [];
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 35 }, new Map(
      Array.from({ length: 7 }, (_, index) => [`${index}_0`, [index]]),
    ), {
      activate: (index) => { activated.push(index); }, deactivate: () => {}, isLive: () => false,
      prefetch: (key, wanted) => { if (wanted) prefetched.push(key); }, isReady: () => true,
    });
    stream.prepare([5, 5]);
    assert.deepEqual(activated, [0, 1, 2, 3, 4]);
    assert.deepEqual(prefetched, ["0_0", "1_0", "2_0", "3_0", "4_0", "5_0"]);
  });

  check("world partition streaming: prefetch factor rejects values below one and nonfinite values", () => {
    const hooks = { activate: () => {}, deactivate: () => {}, isLive: () => false };
    for (const prefetchRangeFactor of [0.5, NaN, Infinity, -Infinity]) {
      assert.throws(() => new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map(), hooks,
        { prefetchRangeFactor }), RangeError);
    }
  });

  check("world partition streaming: custom prefetch factor changes the ring without changing activation", () => {
    const prefetched: string[] = [];
    const activated: number[] = [];
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map([
      ["0_0", [0]], ["2_0", [2]], ["3_0", [3]], ["4_0", [4]],
    ]), {
      activate: (index) => { activated.push(index); }, deactivate: () => {}, isLive: () => false,
      prefetch: (key, wanted) => { if (wanted) prefetched.push(key); },
    }, { prefetchRangeFactor: 2 });
    stream.prepare([5, 5]);
    assert.deepEqual(prefetched, ["0_0", "2_0", "3_0", "4_0"]);
    assert.deepEqual(activated, [0, 2]);
  });

  check("world partition streaming: absent optional hooks keep prefetch bookkeeping empty and activation unchanged", () => {
    const { stream, activated } = fixture({ cellSize: 10, loadRange: 20 }, [
      ["0_0", [0]], ["1_0", [1]], ["2_0", [2]], ["3_0", [3]],
    ]);
    assert.deepEqual(stream.prefetchAround([5, 5]), ["0_0", "1_0", "2_0"]);
    assert.deepEqual(activated, []);
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(activated, [0, 1]);
    assert.equal(stream.snapshot().prefetchedCells, 0);
    assert.equal(stream.snapshot().waitingCells, 0);
    stream.prepare([5, 5]);
    assert.deepEqual(activated, [0, 1, 2]);
  });

  check("world partition streaming: clear resets prefetch and waiting bookkeeping without host hooks", () => {
    const events: string[] = [];
    const stream = new WorldPartitionStreaming({ cellSize: 10, loadRange: 20 }, new Map([["0_0", [0]]]), {
      activate: () => { events.push("activate"); }, deactivate: () => { events.push("deactivate"); }, isLive: () => false,
      prefetch: (key, wanted) => { events.push(`${key} ${wanted}`); }, isReady: () => false,
    });
    stream.prepare([5, 5]);
    assert.equal(stream.snapshot().prefetchedCells, 1);
    assert.equal(stream.snapshot().waitingCells, 1);
    stream.clear();
    assert.deepEqual(events, ["0_0 true"]);
    assert.deepEqual(stream.prefetchAround([5, 5]), []);
    stream.prepare([5, 5]);
    stream.update([{ position: [5, 5] }]);
    assert.deepEqual(stream.snapshot(), { activeCells: 0, totalCells: 0, liveActors: 0, prefetchedCells: 0, waitingCells: 0 });
    assert.deepEqual(events, ["0_0 true"]);
  });
}
