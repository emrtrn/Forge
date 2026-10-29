/** Real hardware acceptance, isolated public data, production runtime loop.
 * node tools/lake-performance-report.mjs
 * LAKE_PERF_CASES=small-caustics,world-wide,world-planarwide
 * LAKE_PERF_MODES=surface,caustics,lake (lake toggles all Lake effects together)
 * wide / planarwide use explicit 2 m foam + wet-shore bands for 360 m bounds.
 * LAKE_PERF_REBUILDS=35 (5 warmup + 30 measured), LAKE_PERF_COLD=10
 * LAKE_PERF_PORT=5379, LAKE_PERF_OUTPUT=..., LAKE_PERF_GATE=1
 * LAKE_PERF_CPU_PROFILE=1 records sampled stacks for rebuild task attribution
 * (diagnostic only; use an unprofiled run for performance acceptance).
 * Reduced sample runs are diagnostic and never close acceptance.
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { cpus, platform, release } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { prepareSmokeProject, cleanupSmokeProject, REPO_ROOT } from "../tests/smoke/smokeProject.mjs";
import { waitForHttp, stopProcess, percentile, metricMap, browserMetricDelta, wait } from "./perf/browserPerfHarness.mjs";
import { analyzeLakeTasks, lakeRebuildTasks } from "./perf/lakeTaskAnalysis.mjs";

const port = Number(process.env.LAKE_PERF_PORT ?? 5379);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5173, 5273].includes(port)) throw new Error("Choose a separate measurement port");
const pairs = Number(process.env.LAKE_PERF_PAIRS ?? 300), rebuilds = Number(process.env.LAKE_PERF_REBUILDS ?? 35), coldCount = Number(process.env.LAKE_PERF_COLD ?? 10);
if (![pairs, rebuilds, coldCount].every(n => Number.isInteger(n) && n >= 0) || pairs < 1) throw new Error("Invalid sample counts");
const cases = (process.env.LAKE_PERF_CASES ?? "small-none,small-caustics,maximum-caustics,world-none,world-caustics,world-all,world-planar,world-wide,world-planarwide").split(",");
const modes = (process.env.LAKE_PERF_MODES ?? "surface,caustics,lake").split(",");
const cpuProfile = process.env.LAKE_PERF_CPU_PROFILE === "1";
if (modes.some(m => !["surface", "caustics", "lake"].includes(m))) throw new Error("Invalid GPU mode selection");
if (cases.some(c => !/^(small|maximum|world)-(none|surface|caustics|all|planar|wide|planarwide)$/.test(c))) throw new Error("Invalid case selection");
const output = resolve(process.env.LAKE_PERF_OUTPUT ?? `.dev-server/lake-perf-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const root = resolve(REPO_ROOT, ".playwright-smoke", `run-lake-perf-${randomUUID()}`);
const report = { schema: 2, capturedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(["tools/lake-performance-report.mjs", "tools/perf/lakePerformanceProject.ts",
    "tests/engine/fixtures/lakePerformanceFixture.ts", "tests/smoke/pages/lake-performance.ts", "src/scene/lakeWaterController.ts",
    "engine/terrain/terrainLakeWater.ts", "engine/render-three/lakeWater.ts", "engine/render-three/waterFoam.ts",
    "engine/core/cooperativeWork.ts", "engine/render-three/lakePreparation.ts", "engine/render-three/lakeRenderGeometry.ts", "engine/terrain/lakeInteraction.ts",
    "engine/render-three/terrain/terrainShoreWetness.ts", "engine/render-three/terrain/terrainCaustics.ts"].map(async path =>
      [path, createHash("sha256").update(await readFile(resolve(REPO_ROOT, path))).digest("hex")]))),
  cpu: cpus()[0]?.model, os: `${platform()} ${release()}`,
  runtime: "Vite development server; real ForgeRuntime frame loop; Ultra, adaptive off; DOM fullscreen, DPR 1",
  methodology: { pairs, rebuilds, coldCount, cpuProfile, order: "alternating AB/BA, one sample per displayed frame",
    gpu: "full production render submission including post-process, shadows and nested captures; gl.flush after query end; no readPixels in timing",
    heap: "CDP Runtime.getHeapUsage sampled every 100 ms; includes backingStorageSize separately when exposed",
    processMemory: "Windows private bytes and working set at 250 ms; owned Chromium PIDs only; shared working sets can be counted twice",
    mainThread: "DevTools RunTask events; during rebuild all browser tasks are a conservative upper bound, not Lake-exclusive CPU slices",
    cold: "new context, network cache disabled; module/runtime boot separately from level load; terrain-only and Lake profiles compared",
    limitations: ["sampled memory peaks are lower bounds on instantaneous peaks", "GPU allocator/VRAM peak is not browser private bytes",
      "Eight synthetic Lakes do not certify every authored world or geometry-foam bake"] }, cases: [] };
let server, browser, context;
await mkdir(output, { recursive: true });
const save = () => writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
const distribution = values => ({ count: values.length, p50: values.length ? percentile(values, .5) : null,
  p95: values.length ? percentile(values, .95) : null, max: values.length ? Math.max(...values) : null });

async function stopTrace(client, file, profile) {
  const completed = new Promise(resolveDone => client.once("Tracing.tracingComplete", resolveDone));
  await client.send("Tracing.end");
  const { stream } = await completed;
  let raw = "";
  for (;;) { const part = await client.send("IO.read", { handle: stream }); raw += part.data; if (part.eof) break; }
  await client.send("IO.close", { handle: stream }); await writeFile(file, raw);
  const events = JSON.parse(raw).traceEvents;
  const candidates = events.filter(e => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const runTasks = events.filter(e => e.ph === "X" && e.dur > 0 && /RunTask$/.test(e.name));
  // A trace can contain an idle spare renderer as well as the actual page.
  const main = candidates.map(thread => ({ thread, tasks: runTasks.filter(e => e.pid === thread.pid && e.tid === thread.tid) }))
    .sort((a, b) => b.tasks.reduce((n, e) => n + e.dur, 0) - a.tasks.reduce((n, e) => n + e.dur, 0))[0];
  const tasks = lakeRebuildTasks(main?.tasks ?? [], events);
  return { mainThreadTasksMs: distribution(tasks.map(e => e.dur / 1000)),
    over4ms: tasks.filter(e => e.dur > 4000).length, over50ms: tasks.filter(e => e.dur > 50000).length,
    longTasks: tasks.filter(e => e.dur > 50000).map(e => ({ startUs: e.ts, ms: e.dur / 1000 })),
    ...(profile ? { attribution: analyzeLakeTasks(tasks, profile) } : {}), trace: file };
}

async function measure(page, browserClient, label, fn) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const heaps = [], processSamples = [];
  const processes = (await browserClient.send("SystemInfo.getProcessInfo")).processInfo;
  let memoryChild, pendingLine = "", busy = false, memoryError = null;
  if (platform() === "win32") {
    const ids = processes.map(p => Number(p.id)).filter(Number.isSafeInteger).join(",");
    const script = `$ErrorActionPreference='Stop'; while($true){$rows=@(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { @{id=$_.Id; privateBytes=$_.PrivateMemorySize64; workingSetBytes=$_.WorkingSet64} }); ConvertTo-Json -InputObject $rows -Compress; Start-Sleep -Milliseconds 250}`;
    memoryChild = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    memoryChild.on("error", e => { memoryError = e.message; });
    memoryChild.stderr.on("data", chunk => { memoryError = String(chunk); });
    memoryChild.stdout.on("data", chunk => {
      pendingLine += String(chunk);
      for (;;) { const end = pendingLine.indexOf("\n"); if (end < 0) break;
        const line = pendingLine.slice(0, end).trim(); pendingLine = pendingLine.slice(end + 1);
        if (line) processSamples.push({ at: Date.now(), processes: JSON.parse(line) }); }
    });
  }
  const sampleHeap = async () => {
    if (busy) return; busy = true;
    try { heaps.push({ at: Date.now(), ...await client.send("Runtime.getHeapUsage") }); }
    finally { busy = false; }
  };
  await sampleHeap();
  const interval = setInterval(() => { sampleHeap().catch(e => { memoryError = e.message; }); }, 100);
  const start = metricMap((await client.send("Performance.getMetrics")).metrics), started = performance.now();
  await client.send("Tracing.start", { transferMode: "ReturnAsStream", categories: "toplevel,devtools.timeline,blink.user_timing,v8.execute" });
  const profiling = cpuProfile && label.endsWith("-rebuild");
  if (profiling) {
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval: 100 });
    await client.send("Profiler.start");
  }
  let value, trace;
  try { value = await fn(); }
  finally {
    clearInterval(interval); await sampleHeap();
    let profile;
    if (profiling) {
      ({ profile } = await client.send("Profiler.stop"));
      await writeFile(resolve(output, `${label}.cpuprofile`), JSON.stringify(profile));
    }
    trace = await stopTrace(client, resolve(output, `${label}.trace.json`), profile); await stopProcess(memoryChild);
  }
  const duration = performance.now() - started, end = metricMap((await client.send("Performance.getMetrics")).metrics);
  await writeFile(resolve(output, `${label}.memory.json`), JSON.stringify({ heaps, processSamples, processes, memoryError }));
  await client.detach();
  const peaks = key => heaps.some(s => typeof s[key] === "number") ? Math.max(...heaps.map(s => s[key] ?? 0)) : null;
  return { value, trace, browserThread: browserMetricDelta(start, end, duration), durationMs: duration,
    memory: { heapSamples: heaps.length, processSamples: processSamples.length, heapUsedPeakBytes: peaks("usedSize"),
      backingStoragePeakBytes: peaks("backingStorageSize"), embedderHeapPeakBytes: peaks("embedderHeapUsedSize"),
      processPrivatePeakBytes: processSamples.length ? Math.max(...processSamples.map(s => s.processes.reduce((n, p) => n + p.privateBytes, 0))) : null,
      processWorkingSetPeakBytes: processSamples.length ? Math.max(...processSamples.map(s => s.processes.reduce((n, p) => n + p.workingSetBytes, 0))) : null,
      memoryError } };
}

try {
  console.log(`[lake-perf] preparing isolated project ${root}`);
  await prepareSmokeProject(root);
  const bundle = resolve(output, "prepare-project.mjs");
  await build({ entryPoints: ["tools/perf/lakePerformanceProject.ts"], outfile: bundle, bundle: true, platform: "node", format: "esm", logLevel: "warning" });
  report.fixtures = await (await import(pathToFileURL(bundle).href)).prepareLakePerformanceLevels(root);
  server = spawn(process.execPath, ["tests/smoke/start-server.mjs"], {
    cwd: REPO_ROOT, windowsHide: true, env: { ...process.env, FORGE_SMOKE_PORT: String(port), FORGE_SMOKE_PROJECT_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] });
  // Already prepared; start-server's idempotent preparation keeps endpoint writes isolated.
  server.stdout.on("data", c => process.stdout.write(c)); server.stderr.on("data", c => process.stderr.write(c));
  await waitForHttp(`http://127.0.0.1:${port}`);
  browser = await chromium.launch({ channel: process.env.LAKE_PERF_CHANNEL ?? "chrome", headless: false,
    args: ["--start-maximized", "--force-device-scale-factor=1", "--js-flags=--expose-gc", "--disable-background-timer-throttling"] });
  report.browser = browser.version();
  const browserClient = await browser.newBrowserCDPSession();
  report.systemInfo = (await browserClient.send("SystemInfo.getInfo")).gpu;
  for (const name of cases) {
    const [kind, profile] = name.split("-");
    console.log(`[lake-perf] ${name}: fullscreen GPU / memory / main thread`);
    context = await browser.newContext({ viewport: null });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(120000);
    page.on("pageerror", e => { errors.push(e.message); console.error(`[lake-perf] page error: ${e.message}`); });
    page.on("console", m => { if (m.type() === "error") { errors.push(m.text()); console.error(`[lake-perf] console: ${m.text()}`); } });
    await page.goto(`http://127.0.0.1:${port}/tests/smoke/pages/lake-performance.html?kind=${kind}&profile=${profile}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    console.log(`[lake-perf] ${name}: document loaded`);
    await page.waitForFunction(() => window.__lakePerf);
    console.log(`[lake-perf] ${name}: runtime ready`);
    await page.evaluate(async () => { await document.documentElement.requestFullscreen(); document.querySelector("#fullscreen").hidden = true; });
    const windowClient = await context.newCDPSession(page);
    const { windowId } = await windowClient.send("Browser.getWindowForTarget");
    await windowClient.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
    await windowClient.detach();
    console.log(`[lake-perf] ${name}: fullscreen activation sent`);
    await page.waitForFunction(() => !!document.fullscreenElement && innerWidth === screen.width && innerHeight === screen.height, null, { timeout: 15000 });
    await wait(2000);
    const entry = { name, errors, witness: await page.evaluate(() => window.__lakePerf.witness()) };
    report.cases.push(entry); await save();
    if (entry.witness.lakes.some(l => l.status !== "ready")) {
      entry.failure = "Lake not ready";
      console.error(`[lake-perf] ${name}: ${JSON.stringify(entry.witness.lakes)}`);
      await page.screenshot({ path: resolve(output, `${name}-not-ready.png`), scale: "css" });
      await context.close(); context = null; await save(); continue;
    }
    if (/swiftshader|llvmpipe|software/i.test(entry.witness.device) || !entry.witness.timer) throw new Error("Hardware GPU timer unavailable");
    for (const mode of modes) {
      if (mode === "caustics" && ["surface", "none"].includes(profile)) continue;
      entry[mode] = await measure(page, browserClient, `${name}-${mode}`, () => page.evaluate(
        ({ mode, pairs, moving }) => window.__lakePerf.gpu(mode, pairs, moving), { mode, pairs, moving: kind === "world" }));
      console.log(`[lake-perf] ${name} ${mode}: delta p95 ${entry[mode].value.pairedDelta?.p95} ms`); await save();
    }
    await page.screenshot({ path: resolve(output, `${name}.png`), scale: "css" });
    if (rebuilds > 0 && ["caustics", "wide", "planarwide"].includes(profile)) {
      console.log(`[lake-perf] ${name}: ${rebuilds} rebuilds (first 5 warm-up)`);
      entry.rebuild = await measure(page, browserClient, `${name}-rebuild`, () => page.evaluate(count => window.__lakePerf.rebuild(count), rebuilds));
      console.log(`[lake-perf] ${name}: rebuild p95 ${entry.rebuild.value.measured.p95} ms`); await save();
    }
    await context.close(); context = null;
    if (coldCount > 0 && profile === "caustics") {
      entry.cold = [];
      for (const coldProfile of ["none", "caustics"]) {
        const times = [];
        console.log(`[lake-perf] ${name}: ${coldCount} cache-disabled ${coldProfile} boots`);
        for (let i = 0; i < coldCount; i++) {
          const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          const p = await c.newPage(), client = await c.newCDPSession(p);
          await client.send("Network.enable"); await client.send("Network.setCacheDisabled", { cacheDisabled: true });
          await p.goto(`http://127.0.0.1:${port}/tests/smoke/pages/lake-performance.html?kind=${kind}&profile=${coldProfile}`, { waitUntil: "domcontentloaded", timeout: 180000 });
          await p.waitForFunction(() => window.__lakePerf, null, { timeout: 180000 });
          times.push(await p.evaluate(() => window.__lakePerf.witness())); await c.close();
        }
        entry.cold.push({ profile: coldProfile, bootMs: distribution(times.map(w => w.bootMs)), raw: times }); await save();
      }
    }
  }
  report.acceptance = {
    allBodiesReady: report.cases.every(c => !c.failure),
    sufficientSamples: !cpuProfile && pairs >= 300 && rebuilds >= 35 && coldCount >= 10 &&
      ["small-caustics", "maximum-caustics", "world-caustics"].every(name => report.cases.some(c => c.name === name && c.rebuild && c.cold?.length === 2)),
    noBrowserErrors: report.cases.every(c => !c.errors.length && c.witness.glError === 0),
    nullControl: ["small-none", "world-none"].every(name => report.cases.some(c => {
      const value = (c.lake ?? c.surface)?.value;
      return c.name === name && value?.available && value.pairedDelta.p95 <= .25;
    })),
    gpu: report.cases.some(c => c.name === "small-caustics" && c.lake?.value.available && c.lake.value.pairedDelta.p95 <= 1),
    mainThread: report.cases.every(c => !c.rebuild || c.rebuild.trace.mainThreadTasksMs.count > 0 && c.rebuild.trace.mainThreadTasksMs.max <= 4),
    closed: false,
    note: "GPU 1 ms applies to reflection-off single fixture; multi-body values reported separately. No aggregate acceptance inferred from partial runs or memory sampling alone.",
  };
  if (process.env.LAKE_PERF_GATE === "1" && (!report.acceptance.noBrowserErrors || !report.acceptance.nullControl || !report.acceptance.allBodiesReady || !report.acceptance.sufficientSamples || !report.acceptance.gpu || !report.acceptance.mainThread)) process.exitCode = 1;
} catch (error) {
  if (context?.pages()[0]) {
    const p = context.pages()[0];
    await p.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
    report.failurePage = await p.evaluate(() => ({ text: document.body.innerText, fullscreen: !!document.fullscreenElement,
      screen: [screen.width, screen.height], inner: [innerWidth, innerHeight] })).catch(() => null);
  }
  report.failure = error.stack ?? String(error); console.error(report.failure); process.exitCode = 1;
} finally {
  await save(); await context?.close(); await browser?.close(); await stopProcess(server);
  await cleanupSmokeProject(root);
  console.log(`[lake-perf] report: ${resolve(output, "report.json")}`);
}
