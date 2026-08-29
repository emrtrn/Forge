/**
 * The quality matrix: the same level, for the same time, at each quality
 * profile, so the profiles can be compared with each other instead of with a
 * memory of last week.
 *
 * The question it answers is the one a quality preset exists to answer and
 * nothing else measures: *what does Medium actually buy over High on this
 * machine?* A single-profile capture (`npm run perf:browser`) cannot say —
 * comparing two of its runs compares two moments as much as two settings.
 *
 * How the rows are made comparable:
 *
 *  - **One server, one build, one session.** All four rows run back-to-back
 *    against the same Vite server, so a row is never a different build.
 *  - **The profile is seeded before the page loads**, into the same
 *    `localStorage` document the runtime reads its preferences from. No runtime
 *    surface exists for this and none should: a debug-only URL parameter that
 *    silently overrides a player's settings is a bug waiting to ship.
 *  - **Nothing touches the scene.** The "tour" is the level as it starts,
 *    undisturbed, for a fixed duration. Scripting a camera path would make the
 *    rows more interesting and less comparable, because the template has no
 *    camera-path concept and every fork's would differ. A fork that wants one
 *    adds it and says so in its own report.
 *
 * Its own port (4175): never the 5173 an editor session uses, never the 5273
 * the browser smoke owns, never the 4174 `perf:browser` owns. Three servers
 * answering the same routes is exactly how a report ends up describing somebody
 * else's build.
 *
 * Env: QUALITY_URL (skips starting a server), QUALITY_DURATION_MS,
 * QUALITY_WARMUP_MS, QUALITY_HEADLESS, QUALITY_READY_TIMEOUT_MS.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  collectFrameSamples,
  numeric,
  readPositiveNumber,
  startVite,
  stopProcess,
  summarizeFrames,
  wait,
  waitForHttp,
} from "./perf/browserPerfHarness.mjs";

const PORT = 4175;
const DEFAULT_URL = `http://127.0.0.1:${PORT}/?debug`;
const DEFAULT_DURATION_MS = 10_000;
const DEFAULT_WARMUP_MS = 4_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1920, height: 1080 };
const OUTPUT_DIR = resolve("test-results/quality-matrix");
/** Must match `userSettingsStore`'s DEFAULT_KEY. */
const SETTINGS_KEY = "forge.userSettings";

/**
 * The rows. Adaptive is last and deliberately paired with the highest fixed
 * profile it is allowed to start from: the point of the row is what the
 * controller does when it is left to decide, and starting it at Low would only
 * show that it has nothing to give back.
 */
const ROWS = [
  { id: "low", level: "low", adaptive: false },
  { id: "medium", level: "medium", adaptive: false },
  { id: "high", level: "high", adaptive: false },
  { id: "adaptive", level: "high", adaptive: true },
];

/** The persisted preferences document a row runs under. */
function settingsFor(row) {
  return {
    schema: 1,
    updatedAt: new Date(0).toISOString(),
    payload: {
      audio: { busVolumes: {} },
      locale: null,
      graphics: {
        selectedQualityLevel: row.level,
        // Manually selected, so the startup hardware probe does not overrule the
        // row and quietly measure a profile nobody asked for.
        manuallySelected: true,
        adaptiveOptimizationEnabled: row.adaptive,
        targetFrameRate: 60,
      },
    },
  };
}

async function captureRow(browser, url, row, options) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // Seeded before any script of the page runs, so the runtime's first read
  // already sees it. Setting it after load would measure the default profile
  // for as long as it took the page to notice.
  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A context with storage disabled still runs; the row then measures the
        // default profile, and the report says which profile it actually saw.
      }
    },
    [SETTINGS_KEY, JSON.stringify(settingsFor(row))],
  );
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("#game-canvas").waitFor({ state: "visible", timeout: 60_000 });
    const loading = page.locator(".forge-loading");
    let readiness = "no-loading-overlay";
    if (await loading.count()) {
      readiness = await loading
        .waitFor({ state: "hidden", timeout: options.readyTimeoutMs })
        .then(() => "loading-overlay-hidden")
        .catch(() => "loading-overlay-still-visible");
    }
    // Shader compiles and the first texture uploads belong to nobody's steady
    // state; measuring them would make whichever row ran first look worst.
    await wait(options.warmupMs);
    const { frames, snapshots } = await collectFrameSamples(page, options.durationMs);
    const last = snapshots.at(-1) ?? null;
    return {
      ...row,
      readiness,
      frames: summarizeFrames(frames),
      // Read back rather than assumed: if the seeding did not take, the report
      // must show the profile that actually ran, not the one that was asked for.
      observedQuality: last?.quality ?? null,
      observedAdaptive: last?.adaptive ?? null,
      reductionDepth: last?.reductionDepth ?? null,
      drawCalls: last?.drawCalls ?? null,
      triangles: last?.triangles ?? null,
      gpuMs: last?.gpuMs ?? null,
      snapshotCount: snapshots.length,
      consoleErrors,
    };
  } finally {
    await context.close();
  }
}

function reportLine(row) {
  const frames = row.frames;
  const mismatch =
    row.observedQuality !== null && row.observedQuality !== row.level ? ` (ran as ${row.observedQuality})` : "";
  const depth = row.reductionDepth ? ` -${row.reductionDepth}` : "";
  return [
    row.id.padEnd(10),
    `${numeric(frames.averageMs)} ms`.padStart(11),
    `${numeric(frames.p95Ms)} ms`.padStart(11),
    `${numeric(frames.estimatedFps, 0)} fps`.padStart(9),
    String(frames.over33ms).padStart(7),
    String(row.drawCalls ?? "-").padStart(7),
    (row.gpuMs === null ? "-" : `${numeric(row.gpuMs)} ms`).padStart(10),
    `${mismatch}${depth}`,
  ].join("  ").trimEnd();
}

async function main() {
  const url = process.env.QUALITY_URL ?? DEFAULT_URL;
  const ownsServer = process.env.QUALITY_URL === undefined;
  const options = {
    durationMs: readPositiveNumber("QUALITY_DURATION_MS", DEFAULT_DURATION_MS),
    warmupMs: readPositiveNumber("QUALITY_WARMUP_MS", DEFAULT_WARMUP_MS),
    readyTimeoutMs: readPositiveNumber("QUALITY_READY_TIMEOUT_MS", DEFAULT_READY_TIMEOUT_MS),
  };
  const headless = process.env.QUALITY_HEADLESS !== "false";
  let server = null;
  let browser = null;

  try {
    if (ownsServer) {
      console.log(`[quality-matrix] starting local Vite server on ${PORT}`);
      server = startVite(PORT, "quality-matrix");
      await waitForHttp(`http://127.0.0.1:${PORT}`);
    }
    browser = await chromium.launch({ headless });
    const rows = [];
    for (const row of ROWS) {
      console.log(`[quality-matrix] ${row.id}: ${(options.durationMs / 1000).toFixed(0)} s steady state`);
      rows.push(await captureRow(browser, url, row, options));
    }

    console.log("");
    console.log("quality      avg frame      p95           fps    >33ms     draws       gpu");
    for (const row of rows) console.log(reportLine(row));
    console.log("");
    console.log("Same level, same duration, nothing touching the scene — the rows differ only by profile.");
    if (rows.every((row) => row.gpuMs === null)) {
      // Said, not omitted: an all-blank GPU column is a browser fact, not a
      // scene that costs the GPU nothing.
      console.log("No GPU column: this browser has no timer queries (EXT_disjoint_timer_query_webgl2).");
    }
    if (rows.some((row) => row.snapshotCount === 0)) {
      console.log("Some rows produced no perf witness — was the URL loaded with ?debug?");
    }

    await mkdir(OUTPUT_DIR, { recursive: true });
    const outputPath = resolve(OUTPUT_DIR, "quality-matrix.json");
    await writeFile(
      outputPath,
      JSON.stringify({ url, capturedAt: new Date().toISOString(), options, rows }, null, 2),
    );
    console.log(`[quality-matrix] wrote ${outputPath}`);
  } finally {
    if (browser) await browser.close();
    if (server) await stopProcess(server);
  }
}

main().catch((error) => {
  console.error("[quality-matrix] failed:", error);
  process.exitCode = 1;
});
