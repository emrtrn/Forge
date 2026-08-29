/**
 * Repeatable browser performance capture. Saves both DevTools timeline evidence
 * and a compact JSON summary for comparisons / CI artifacts.
 *
 * Generic on purpose: it boots whatever URL it is given, waits for the canvas
 * and the loading overlay, and measures. It knows nothing about what the page
 * is doing, so a fork's own scenario sweep is a second runner over
 * `tools/perf/browserPerfHarness.mjs` rather than a fork of this file.
 *
 * The server it starts is its own (port 4174, `--strictPort`) and never the
 * 5173 an editor session uses — a report captured against somebody's open
 * editor would be measuring a different build than the one it names.
 *
 * Env: PERF_URL (skips starting a server), PERF_DURATION_MS, PERF_HEADLESS,
 * PERF_READY_TIMEOUT_MS, PERF_MAX_P95_MS (a gate; absent means report only).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  browserMetricDelta,
  metricMap,
  percentile,
  readPositiveNumber,
  startVite,
  stopProcess,
  wait,
  waitForHttp,
} from "./perf/browserPerfHarness.mjs";

/**
 * The capture's own port. Deliberately not 5173 (an editor session) and not the
 * 5273 the browser smoke owns: three concurrent servers answering the same
 * routes is exactly how a report ends up describing somebody else's build.
 */
const PORT = 4174;
const DEFAULT_URL = `http://127.0.0.1:${PORT}/?debug`;
const DEFAULT_DURATION_MS = 15_000;
const WARMUP_MS = 5_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1920, height: 1080 };
const OUTPUT_DIR = resolve("test-results/browser-perf");

function summarizeFrames(samples) {
  // Retain severe hitches: 250–1000 ms frames are exactly what this tool must
  // report. Only discard multi-second tab/background pauses, which are not a
  // useful rendering measurement.
  const valid = samples.filter((sample) => Number.isFinite(sample) && sample > 0 && sample < 5_000);
  const averageMs = valid.reduce((sum, sample) => sum + sample, 0) / Math.max(1, valid.length);
  const countOver = (threshold) => valid.filter((sample) => sample > threshold).length;
  return {
    sampleCount: valid.length,
    averageMs,
    p50Ms: percentile(valid, 0.5),
    p95Ms: percentile(valid, 0.95),
    p99Ms: percentile(valid, 0.99),
    maxMs: valid.length === 0 ? 0 : Math.max(...valid),
    estimatedFps: averageMs > 0 ? 1000 / averageMs : 0,
    over16_7ms: countOver(16.7),
    over33_3ms: countOver(33.3),
    over50ms: countOver(50),
    over100ms: countOver(100),
    discardedSamples: samples.length - valid.length,
  };
}

async function collectRafSamples(page, durationMs) {
  return page.evaluate(async (duration) => {
    const samples = [];
    const startedAt = performance.now();
    let previous = startedAt;
    await new Promise((resolveFrame) => {
      const tick = (now) => {
        samples.push(now - previous);
        previous = now;
        if (now - startedAt >= duration) resolveFrame();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return samples;
  }, durationMs);
}

async function stopTracing(client) {
  let streamHandle = null;
  const completed = new Promise((resolveCompleted) => {
    client.once("Tracing.tracingComplete", (event) => {
      streamHandle = event.stream;
      resolveCompleted();
    });
  });
  await client.send("Tracing.end");
  let timeoutId;
  try {
    await Promise.race([
      completed,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Chrome DevTools trace did not finish within 30 seconds")), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
  let trace = "";
  while (streamHandle) {
    const chunk = await client.send("IO.read", { handle: streamHandle });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  if (streamHandle) await client.send("IO.close", { handle: streamHandle });
  return trace;
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

async function main() {
  const url = process.env.PERF_URL ?? DEFAULT_URL;
  const durationMs = readPositiveNumber("PERF_DURATION_MS", DEFAULT_DURATION_MS);
  const readyTimeoutMs = readPositiveNumber("PERF_READY_TIMEOUT_MS", DEFAULT_READY_TIMEOUT_MS);
  const p95GateMs = process.env.PERF_MAX_P95_MS === undefined
    ? null
    : readPositiveNumber("PERF_MAX_P95_MS", 0);
  const headless = process.env.PERF_HEADLESS !== "false";
  const ownsServer = process.env.PERF_URL === undefined;
  let server = null;
  let browser = null;

  try {
    if (ownsServer) {
      console.log("[browser-perf] starting local Vite server (development mode)");
      server = startVite(PORT, "browser-perf");
      await waitForHttp(`http://127.0.0.1:${PORT}`);
    }
    console.log(`[browser-perf] capturing ${url} (${(durationMs / 1000).toFixed(0)} s steady state)`);
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    await client.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
        "loading",
        "v8.execute",
        "toplevel",
      ].join(","),
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("#game-canvas").waitFor({ state: "visible", timeout: 60_000 });
    console.log("[browser-perf] page booted; waiting for a stable measurement window");
    const loading = page.locator(".forge-loading");
    let readiness = "no-loading-overlay";
    if (await loading.count()) {
      readiness = await loading.waitFor({ state: "hidden", timeout: readyTimeoutMs })
        .then(() => "loading-overlay-hidden")
        .catch(() => "loading-overlay-still-visible");
    }
    console.log(`[browser-perf] readiness: ${readiness}`);
    await wait(WARMUP_MS);

    const startMetrics = metricMap((await client.send("Performance.getMetrics")).metrics);
    const rafSamples = await collectRafSamples(page, durationMs);
    const endMetrics = metricMap((await client.send("Performance.getMetrics")).metrics);
    console.log("[browser-perf] frame samples collected; finalizing DevTools trace");
    const pageData = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource")
        .filter((entry) => "transferSize" in entry)
        .map((entry) => ({
          name: entry.name,
          durationMs: entry.duration,
          transferBytes: entry.transferSize,
          decodedBytes: entry.decodedBodySize,
        }))
        .sort((a, b) => b.transferBytes - a.transferBytes)
        .slice(0, 15);
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        navigation: navigation && "domContentLoadedEventEnd" in navigation
          ? { domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd, transferBytes: navigation.transferSize }
          : null,
        resources,
        debugOverlay: document.querySelector("#debug-stats")?.textContent ?? null,
      };
    });
    const rawTrace = await stopTracing(client);
    console.log("[browser-perf] DevTools trace finalized");
    const frames = summarizeFrames(rafSamples);
    const browserMetrics = browserMetricDelta(startMetrics, endMetrics, durationMs);
    const capturedAt = new Date().toISOString().replace(/[:.]/g, "-");
    await mkdir(OUTPUT_DIR, { recursive: true });
    const base = resolve(OUTPUT_DIR, `browser-perf-${capturedAt}`);
    const report = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      scenario: { url, mode: ownsServer ? "Vite development server" : "external server", headless, viewport: VIEWPORT, deviceScaleFactor: 1, readiness, warmupMs: WARMUP_MS, measurementDurationMs: durationMs },
      frameTime: frames,
      browserThread: browserMetrics,
      page: pageData,
      errors: { consoleErrors, pageErrors },
      artifacts: { chromeDevToolsTrace: `${base}.trace.json`, report: `${base}.json` },
    };
    await writeFile(`${base}.trace.json`, rawTrace, "utf8");
    await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`[browser-perf] frame avg ${formatMs(frames.averageMs)}, p95 ${formatMs(frames.p95Ms)}, p99 ${formatMs(frames.p99Ms)}, ${frames.estimatedFps.toFixed(1)} fps`);
    console.log(`[browser-perf] hitches >33.3ms=${frames.over33_3ms}, >50ms=${frames.over50ms}, >100ms=${frames.over100ms}`);
    console.log(`[browser-perf] main thread task ${formatMs(browserMetrics.taskMsPerSecond)}/s, script ${formatMs(browserMetrics.scriptMsPerSecond)}/s, layout ${formatMs(browserMetrics.layoutMsPerSecond)}/s`);
    console.log(`[browser-perf] report: ${base}.json`);
    console.log(`[browser-perf] DevTools trace: ${base}.trace.json`);
    if (consoleErrors.length || pageErrors.length) console.warn(`[browser-perf] browser errors: console=${consoleErrors.length}, page=${pageErrors.length}`);
    if (p95GateMs !== null && frames.p95Ms > p95GateMs) {
      console.error(`[browser-perf] FAIL p95 ${formatMs(frames.p95Ms)} exceeds PERF_MAX_P95_MS=${p95GateMs}`);
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
    await stopProcess(server);
  }
}

main().catch((error) => {
  console.error("[browser-perf] FAILED");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
