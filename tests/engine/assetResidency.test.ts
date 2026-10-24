import assert from "node:assert/strict";
import { AssetResidency } from "../../engine/world/assetResidency";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fixture(evictDelayMs = 30_000) {
  let t = 0;
  const calls: string[] = [];
  const evicted: string[] = [];
  const throws = new Set<string>();
  const loads = new Map<string, ReturnType<typeof deferred>[]>();
  const residency = new AssetResidency({
    load(id) {
      calls.push(id);
      if (throws.has(id)) throw new Error("sync load failure");
      const load = deferred();
      loads.set(id, [...(loads.get(id) ?? []), load]);
      return load.promise;
    },
    evict: (id) => { evicted.push(id); },
  }, { evictDelayMs, now: () => t });
  return { residency, calls, evicted, throws, load: (id: string, attempt = 0) => loads.get(id)![attempt]!,
    time: (value: number) => { t = value; } };
}

export async function registerAssetResidencyTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("asset residency: eviction delay rejects negative and nonfinite values", async () => {
    for (const delay of [-1, NaN, Infinity, -Infinity]) assert.throws(() => fixture(delay), RangeError);
    assert.deepEqual(fixture(0).residency.snapshot(), { owners: 0, loading: 0, resident: 0, pendingEvict: 0, failed: 0 });
  });

  await checkAsync("asset residency: loading and resident ids share one load across owners", async () => {
    const { residency, calls, load, time, evicted } = fixture();
    residency.setOwner("a", ["mesh", "mesh"]);
    residency.setOwner("b", ["mesh"]);
    assert.equal(residency.state("mesh"), "loading");
    assert.equal(residency.isOwnerReady("a"), false);
    assert.deepEqual(calls, ["mesh"]);
    load("mesh").resolve();
    await flush();
    residency.setOwner("c", ["mesh"]);
    residency.releaseOwner("a");
    residency.releaseOwner("b");
    time(100_000);
    residency.update();
    assert.equal(residency.state("mesh"), "resident");
    assert.equal(residency.isOwnerReady("c"), true);
    assert.deepEqual(calls, ["mesh"]);
    assert.deepEqual(evicted, []);
    assert.deepEqual(residency.snapshot(), { owners: 1, loading: 0, resident: 1, pendingEvict: 0, failed: 0 });
  });

  await checkAsync("asset residency: setOwner diffs ids and an empty iterable releases the owner", async () => {
    const { residency, calls, load } = fixture();
    residency.setOwner("cell", ["a", "b"]);
    load("a").resolve();
    load("b").resolve();
    await flush();
    residency.setOwner("cell", new Set(["b", "c"]));
    assert.deepEqual(calls, ["a", "b", "c"]);
    assert.equal(residency.state("a"), "pending-evict");
    assert.equal(residency.state("b"), "resident");
    assert.equal(residency.state("c"), "loading");
    residency.setOwner("cell", ["b", "c", "c"]);
    assert.deepEqual(calls, ["a", "b", "c"]);
    load("c").resolve();
    await flush();
    residency.setOwner("cell", []);
    residency.releaseOwner("unknown");
    assert.equal(residency.isOwnerReady("cell"), true);
    assert.deepEqual(residency.snapshot(), { owners: 0, loading: 0, resident: 0, pendingEvict: 3, failed: 0 });
  });

  await checkAsync("asset residency: only pending ids evict at the inclusive release deadline", async () => {
    const { residency, load, time, evicted } = fixture();
    residency.setOwner("cell", ["mesh"]);
    residency.update();
    assert.deepEqual(evicted, []);
    load("mesh").resolve();
    await flush();
    time(100);
    residency.releaseOwner("cell");
    time(30_099);
    residency.update();
    assert.equal(residency.state("mesh"), "pending-evict");
    assert.deepEqual(evicted, []);
    time(30_100);
    residency.update();
    residency.update();
    assert.deepEqual(evicted, ["mesh"]);
    assert.equal(residency.state("mesh"), undefined);
  });

  await checkAsync("asset residency: unowned loading ids start their delay at successful settle", async () => {
    const { residency, load, time, evicted } = fixture();
    residency.setOwner("cell", ["mesh"]);
    residency.releaseOwner("cell");
    time(100_000);
    residency.update();
    assert.equal(residency.state("mesh"), "loading");
    assert.deepEqual(evicted, []);
    load("mesh").resolve();
    await flush();
    assert.equal(residency.state("mesh"), "pending-evict");
    time(129_999);
    residency.update();
    assert.deepEqual(evicted, []);
    time(130_000);
    residency.update();
    assert.deepEqual(evicted, ["mesh"]);
  });

  await checkAsync("asset residency: reacquiring an unowned loading id shares the pending load", async () => {
    const { residency, calls, load } = fixture();
    residency.setOwner("old", ["mesh"]);
    residency.releaseOwner("old");
    residency.setOwner("next", ["mesh"]);
    load("mesh").resolve();
    await flush();
    assert.deepEqual(calls, ["mesh"]);
    assert.equal(residency.state("mesh"), "resident");
    assert.equal(residency.isOwnerReady("next"), true);
  });

  await checkAsync("asset residency: reacquiring pending eviction cancels its deadline without loading", async () => {
    const { residency, calls, load, time, evicted } = fixture();
    residency.setOwner("old", ["mesh"]);
    load("mesh").resolve();
    await flush();
    residency.releaseOwner("old");
    time(29_999);
    residency.setOwner("next", ["mesh"]);
    time(30_000);
    residency.update();
    assert.equal(residency.state("mesh"), "resident");
    assert.deepEqual(calls, ["mesh"]);
    assert.deepEqual(evicted, []);
    residency.releaseOwner("next");
    time(59_999);
    residency.update();
    assert.deepEqual(evicted, []);
    time(60_000);
    residency.update();
    assert.deepEqual(evicted, ["mesh"]);
  });

  await checkAsync("asset residency: rejected loads stay failed until the last owner releases then retry", async () => {
    const { residency, calls, load, evicted, time } = fixture();
    residency.setOwner("a", ["mesh"]);
    load("mesh").reject(new Error("load failure"));
    await flush();
    assert.equal(residency.state("mesh"), "failed");
    assert.equal(residency.isOwnerReady("a"), true);
    residency.setOwner("a", ["mesh"]);
    residency.setOwner("b", ["mesh"]);
    residency.releaseOwner("a");
    time(100_000);
    residency.update();
    assert.equal(residency.state("mesh"), "failed");
    assert.deepEqual(calls, ["mesh"]);
    assert.deepEqual(evicted, []);
    residency.releaseOwner("b");
    assert.equal(residency.state("mesh"), undefined);
    residency.setOwner("c", ["mesh"]);
    assert.deepEqual(calls, ["mesh", "mesh"]);
    load("mesh", 1).resolve();
    await flush();
    assert.equal(residency.state("mesh"), "resident");
  });

  await checkAsync("asset residency: synchronous load throws settle as failed without eviction", async () => {
    const { residency, calls, throws, load, evicted } = fixture(0);
    throws.add("mesh");
    assert.doesNotThrow(() => residency.setOwner("cell", ["mesh"]));
    assert.equal(residency.state("mesh"), "failed");
    await residency.whenReady(["cell"]);
    residency.setOwner("cell", ["mesh"]);
    residency.releaseAll();
    residency.update();
    assert.equal(residency.state("mesh"), undefined);
    assert.deepEqual(evicted, []);
    throws.delete("mesh");
    residency.setOwner("next", ["mesh"]);
    assert.deepEqual(calls, ["mesh", "mesh"]);
    load("mesh").resolve();
    await flush();
  });

  await checkAsync("asset residency: an unowned rejected load is deleted without eviction", async () => {
    const { residency, load, time, evicted } = fixture(0);
    residency.setOwner("cell", ["mesh"]);
    residency.releaseOwner("cell");
    load("mesh").reject(new Error("load failure"));
    await flush();
    time(100_000);
    residency.update();
    assert.equal(residency.state("mesh"), undefined);
    assert.deepEqual(evicted, []);
  });

  await checkAsync("asset residency: whenReady resolves for empty unknown and already-ready owners", async () => {
    const { residency, load } = fixture();
    await residency.whenReady([]);
    await residency.whenReady(["unknown"]);
    residency.setOwner("empty", []);
    residency.setOwner("cell", ["mesh"]);
    load("mesh").resolve();
    await flush();
    await residency.whenReady(["empty", "cell", "unknown"]);
  });

  await checkAsync("asset residency: waiters track every listed owner's current ids until ready", async () => {
    const { residency, load } = fixture();
    residency.setOwner("a", ["first", "second"]);
    residency.setOwner("b", ["third"]);
    let done = 0;
    const ready = residency.whenReady(["a", "b"]).then(() => { done += 1; });
    const alsoReady = residency.whenReady(["a"]).then(() => { done += 1; });
    load("first").resolve();
    load("third").resolve();
    await flush();
    assert.equal(done, 0);
    residency.setOwner("a", ["second", "fourth"]);
    load("second").resolve();
    await flush();
    assert.equal(done, 0);
    load("fourth").resolve();
    await Promise.all([ready, alsoReady]);
    assert.equal(done, 2);
  });

  await checkAsync("asset residency: releasing or dropping loading ids rechecks waiters", async () => {
    const { residency, load } = fixture();
    residency.setOwner("released", ["first"]);
    residency.setOwner("changed", ["second", "settled"]);
    load("settled").resolve();
    await flush();
    let done = false;
    const ready = residency.whenReady(["released", "changed"]).then(() => { done = true; });
    residency.releaseOwner("released");
    await flush();
    assert.equal(done, false);
    residency.setOwner("changed", ["settled"]);
    await ready;
    assert.equal(done, true);
    load("first").resolve();
    load("second").resolve();
    await flush();
  });

  await checkAsync("asset residency: waiting owners settle on rejection and when released", async () => {
    const { residency, load } = fixture();
    residency.setOwner("failed", ["bad"]);
    residency.setOwner("released", ["late"]);
    const failed = residency.whenReady(["failed"]);
    const released = residency.whenReady(["released"]);
    load("bad").reject(new Error("load failure"));
    residency.setOwner("released", []);
    await Promise.all([failed, released]);
    assert.equal(residency.state("bad"), "failed");
    load("late").resolve();
    await flush();
  });

  await checkAsync("asset residency: snapshot counts ids by state and owners with nonempty sets", async () => {
    const { residency, load } = fixture();
    residency.setOwner("a", ["loading", "resident", "failed"]);
    residency.setOwner("b", ["resident"]);
    residency.setOwner("leaving", ["pending"]);
    residency.setOwner("empty", []);
    load("resident").resolve();
    load("pending").resolve();
    load("failed").reject(new Error("load failure"));
    await flush();
    residency.releaseOwner("leaving");
    assert.deepEqual(residency.snapshot(), { owners: 2, loading: 1, resident: 1, pendingEvict: 1, failed: 1 });
    load("loading").resolve();
    await flush();
  });

  await checkAsync("asset residency: releaseAll releases every owner while allowing cross-level reuse", async () => {
    const { residency, calls, load, evicted, time } = fixture();
    residency.setOwner("a", ["shared", "failed"]);
    residency.setOwner("b", ["shared", "loading"]);
    load("shared").resolve();
    load("failed").reject(new Error("load failure"));
    await flush();
    const ready = residency.whenReady(["a", "b"]);
    residency.releaseAll();
    await ready;
    assert.deepEqual(residency.snapshot(), { owners: 0, loading: 1, resident: 0, pendingEvict: 1, failed: 0 });
    assert.equal(residency.state("failed"), undefined);
    assert.deepEqual(evicted, []);
    time(100);
    residency.setOwner("next-level", ["shared"]);
    load("loading").resolve();
    await flush();
    assert.deepEqual(calls, ["shared", "failed", "loading"]);
    residency.releaseAll();
    residency.releaseAll();
    time(30_100);
    residency.update();
    assert.deepEqual([...evicted].sort(), ["loading", "shared"]);
    assert.deepEqual(residency.snapshot(), { owners: 0, loading: 0, resident: 0, pendingEvict: 0, failed: 0 });
  });

  await checkAsync("asset residency: zero delay evicts settled unowned assets only during update", async () => {
    const { residency, load, evicted } = fixture(0);
    residency.setOwner("cell", ["mesh"]);
    load("mesh").resolve();
    await flush();
    residency.releaseOwner("cell");
    assert.deepEqual(evicted, []);
    residency.update();
    assert.deepEqual(evicted, ["mesh"]);
  });

  await checkAsync("asset residency: stale success and failure cannot settle a recreated entry", async () => {
    for (const succeeds of [true, false]) {
      const { residency, load, calls, evicted } = fixture();
      residency.setOwner("old", ["mesh"]);
      // Simulate the otherwise unreachable deletion of an entry before its load settles.
      const entries = (residency as unknown as { entries: Map<string, unknown> }).entries;
      entries.delete("mesh");
      residency.releaseOwner("old");
      residency.setOwner("next", ["mesh"]);
      const ready = residency.whenReady(["next"]);
      if (succeeds) load("mesh").resolve();
      else load("mesh").reject(new Error("stale failure"));
      await flush();
      assert.equal(residency.state("mesh"), "loading");
      assert.equal(residency.isOwnerReady("next"), false);
      load("mesh", 1).resolve();
      await ready;
      assert.equal(residency.state("mesh"), "resident");
      assert.deepEqual(calls, ["mesh", "mesh"]);
      assert.deepEqual(evicted, []);
    }
  });
}
