import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLakeTasks, lakeRebuildTasks } from "../../tools/perf/lakeTaskAnalysis.mjs";

test("CPU task attribution uses monotonic timestamps, excludes gaps and preserves parent stacks", () => {
  const frame = (id, name, children = []) => ({ id, callFrame: { functionName: name, url: "lake.ts", lineNumber: 3 }, children });
  const profile = { startTime: 1000000, nodes: [frame(1, "root", [2]), frame(2, "render", [3]), frame(3, "upload")],
    samples: [3, 2, 3, 3, 3], timeDeltas: [1000, 4000, 3000, 2000, 1000] };
  const result = analyzeLakeTasks([{ ts: 1000000, dur: 5000 }, { ts: 1010000, dur: 6000 }], profile);
  assert.equal(result.tasks[0].samples, 2);
  assert.equal(result.tasks[0].self[0].name, "upload");
  assert.equal(result.tasks[0].self[0].line, 4);
  assert.equal(result.tasks[1].samples, 1, "samples at the task end and in the gap are excluded");
  assert.equal(result.tasks[1].inclusive.find(f => f.name === "render").samples, 1);
});

test("missing samples and noncontiguous node ids leave honest empty attribution", () => {
  assert.deepEqual(analyzeLakeTasks([{ ts: 10, dur: 51000 }], { nodes: [], startTime: 0 }).tasks[0].self, []);
});

test("rebuild marks exclude profiling setup and teardown but keep whole blocking tasks", () => {
  const task = (ts, dur, pid = 1) => ({ ts, dur, pid, tid: 2 });
  const tasks = [task(0, 50000), task(90000, 20000), task(120000, 30000), task(120000, 40000, 3), task(200000, 60000)];
  const events = [{ name: "lake-perf-rebuild-start", ph: "I", ts: 100000, pid: 1, tid: 2 },
    { name: "lake-perf-rebuild-end", ph: "I", ts: 200000, pid: 1, tid: 2 }];
  assert.deepEqual(lakeRebuildTasks(tasks, events), [tasks[1], tasks[2]]);
  assert.equal(lakeRebuildTasks(tasks, []), tasks, "GPU/cold traces without rebuild markers keep their full window");
});
