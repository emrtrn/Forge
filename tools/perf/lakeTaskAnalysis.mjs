/** Correlate CDP CPU samples with CrRendererMain RunTask intervals.
 * Both clocks are monotonic microseconds. Sample counts identify hot stacks;
 * they are not exact function durations or proof of <=4 ms scheduling.
 */
export function lakeRebuildTasks(tasks, events) {
  const start = events.find(e => e.name === "lake-perf-rebuild-start" && e.ph === "I");
  const end = events.find(e => e.name === "lake-perf-rebuild-end" && e.ph === "I");
  if (!start || !end || end.ts < start.ts) return tasks;
  // Keep a whole overlapping RunTask: clipping it would hide a blocking task
  // that started just before the mark. Exclude profiler start/stop overhead.
  return tasks.filter(t => t.pid === start.pid && t.tid === start.tid && t.ts < end.ts && t.ts + t.dur > start.ts);
}

export function analyzeLakeTasks(tasks, profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const frame = id => {
    const f = nodes.get(id)?.callFrame;
    return f ? { name: f.functionName || "(anonymous)", url: f.url, line: f.lineNumber + 1 } : { name: "(unknown)", url: "", line: 0 };
  };
  const hottest = (counts, total) => [...counts].map(([id, samples]) => ({ ...frame(id), samples, fraction: samples / total }))
    .sort((a, b) => b.samples - a.samples).slice(0, 12);
  const ordered = tasks.filter(t => t.dur > 4000).sort((a, b) => a.ts - b.ts);
  const rows = ordered.map(t => ({ startUs: t.ts, ms: t.dur / 1000, samples: 0, self: new Map(), inclusive: new Map() }));
  let time = profile.startTime, cursor = 0;
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    time += profile.timeDeltas[i];
    while (cursor < rows.length && time >= rows[cursor].startUs + ordered[cursor].dur) cursor++;
    const row = rows[cursor];
    if (!row || time < row.startUs) continue;
    const id = profile.samples[i]; row.samples++;
    row.self.set(id, (row.self.get(id) ?? 0) + 1);
    const seen = new Set();
    for (let ancestor = id; ancestor !== undefined && !seen.has(ancestor); ancestor = parents.get(ancestor)) {
      seen.add(ancestor); row.inclusive.set(ancestor, (row.inclusive.get(ancestor) ?? 0) + 1);
    }
  }
  return {
    method: "100 us requested CDP CPU samples correlated with >4 ms RunTask intervals; sampling adds overhead; fractions are sample counts, not exact CPU durations",
    tasks: rows.map(({ self, inclusive, ...row }) => ({ ...row, self: hottest(self, row.samples), inclusive: hottest(inclusive, row.samples) }))
      .sort((a, b) => b.ms - a.ms),
  };
}
