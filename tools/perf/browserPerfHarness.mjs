/**
 * The parts of a browser performance capture that are not about *what* is being
 * measured: bringing a local Vite server up, sampling rAF pacing alongside the
 * runtime's own witness, and turning a pile of frame deltas into percentiles.
 *
 * Shared rather than copied because two runners with two copies of "how do I
 * start Vite and what counts as a valid frame sample" would eventually disagree
 * about the second one, and a disagreement there is invisible: both reports keep
 * printing numbers. A fork adding its own scenario sweep builds it on this.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

export function readPositiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number; received ${JSON.stringify(raw)}`);
  }
  return value;
}

export async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown error";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(250);
  }
  throw new Error(`Local Vite server did not become ready: ${lastError}`);
}

export function startVite(port, label) {
  const viteEntry = resolve("node_modules/vite/bin/vite.js");
  const child = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  child.once("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[${label}] local Vite exited early (${code}):\n${output}`);
  });
  return child;
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), wait(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

/**
 * Frame deltas → the distribution. Samples outside `(0, 5000)` ms are discarded
 * and counted rather than silently dropped: a backgrounded tab or a paused
 * debugger produces them, and an average that quietly swallowed one would be the
 * kind of wrong number a report exists to prevent.
 */
export function summarizeFrames(samples) {
  const valid = samples.filter((sample) => Number.isFinite(sample) && sample > 0 && sample < 5_000);
  const averageMs = valid.reduce((sum, sample) => sum + sample, 0) / Math.max(1, valid.length);
  const over = (threshold) => valid.filter((sample) => sample > threshold).length;
  return {
    sampleCount: valid.length,
    averageMs,
    p50Ms: percentile(valid, 0.5),
    p95Ms: percentile(valid, 0.95),
    p99Ms: percentile(valid, 0.99),
    maxMs: valid.length === 0 ? 0 : Math.max(...valid),
    estimatedFps: averageMs > 0 ? 1000 / averageMs : 0,
    over33ms: over(33.3),
    over50ms: over(50),
    over100ms: over(100),
    discardedSamples: samples.length - valid.length,
  };
}

export function metricMap(metrics) {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

export function browserMetricDelta(start, end, durationMs) {
  const seconds = durationMs / 1000;
  const perSecond = (name) => ((end[name] ?? 0) - (start[name] ?? 0)) / seconds;
  return {
    taskMsPerSecond: perSecond("TaskDuration") * 1000,
    scriptMsPerSecond: perSecond("ScriptDuration") * 1000,
    layoutMsPerSecond: perSecond("LayoutDuration") * 1000,
    styleMsPerSecond: perSecond("RecalcStyleDuration") * 1000,
    jsHeapUsedBytes: end.JSHeapUsedSize ?? null,
    jsHeapTotalBytes: end.JSHeapTotalSize ?? null,
    documents: end.Documents ?? null,
    nodes: end.Nodes ?? null,
    jsEventListeners: end.JSEventListeners ?? null,
  };
}

/**
 * Sample rAF pacing for `durationMs`, snapshotting the runtime's own performance
 * witness twice a second alongside it.
 *
 * The witness is a JSON blob a fork's runtime writes to a canvas data attribute
 * (`witnessAttribute`, default `forgePerf`) — the template writes none, so a
 * capture with nothing publishing one simply returns no snapshots and still
 * reports the frame distribution. A malformed one is skipped rather than
 * thrown: a partial DOM update can never invalidate a performance run.
 */
export async function collectFrameSamples(
  page,
  durationMs,
  snapshotIntervalMs = 500,
  witnessAttribute = "forgePerf",
) {
  return page.evaluate(async ([duration, snapshotInterval, witness]) => {
    const canvas = document.querySelector("#game-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#game-canvas not found");
    const frames = [];
    const snapshots = [];
    const startedAt = performance.now();
    let previous = startedAt;
    let nextSnapshotAt = startedAt;
    await new Promise((resolveFrame) => {
      const tick = (now) => {
        frames.push(now - previous);
        previous = now;
        if (now >= nextSnapshotAt) {
          nextSnapshotAt = now + snapshotInterval;
          try {
            const snapshot = JSON.parse(canvas.dataset[witness] ?? "null");
            if (snapshot) snapshots.push({ atMs: now - startedAt, ...snapshot });
          } catch {
            // A partial DOM update can never invalidate a performance run.
          }
        }
        if (now - startedAt >= duration) resolveFrame();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { frames, snapshots };
  }, [durationMs, snapshotIntervalMs, witnessAttribute]);
}

export function numeric(value, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function formatBytes(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value / 1024 / 1024).toFixed(1)} MB` : "-";
}
