/** WES K1: fixed-camera vehicle/road capture + repeatable hardware measurements. */
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { chromium } from 'playwright';
import { prepareSmokeProject, cleanupSmokeProject, REPO_ROOT } from '../tests/smoke/smokeProject.mjs';
import { waitForHttp, stopProcess, wait, readPositiveNumber } from './perf/browserPerfHarness.mjs';
import { WES_SCENARIOS, classifyGpu, distribution, measurementGate } from './perf/wesAcceptanceProtocol.mjs';

const port = Number(process.env.WES_PORT ?? 4176);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5173, 5273].includes(port)) throw new Error('WES_PORT must be a dedicated unprivileged port (not 5173/5273)');
const durationMs = readPositiveNumber('WES_DURATION_MS', 15000);
const warmupMs = readPositiveNumber('WES_WARMUP_MS', 5000);
const allowSoftware = process.env.WES_ALLOW_SOFTWARE === 'true';
const output = resolve(process.env.WES_OUTPUT ?? `builds/reports/wes-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const root = resolve(REPO_ROOT, '.playwright-smoke', `run-wes-${randomUUID()}`);
const viewport = { width: Number(process.env.WES_WIDTH ?? 1280), height: Number(process.env.WES_HEIGHT ?? 720) };
if (Object.values(viewport).some(n => !Number.isInteger(n) || n < 320 || n > 3840)) throw new Error('WES_WIDTH/HEIGHT must be integer pixels between 320 and 3840');
const sourceFiles = ['tools/wes-acceptance-report.mjs', 'tools/perf/wesAcceptanceProtocol.mjs',
  'tests/smoke/pages/world-environment-acceptance.ts', 'tests/smoke/fixtures/vehicle-test.level.json',
  'engine/environment/environmentResolve.ts', 'engine/render-three/authoredEnvironment.ts', 'engine/render-three/moonDisc.ts'];
const report = {
  schema: 1, capturedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: REPO_ROOT, windowsHide: true }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(resolve(REPO_ROOT, path))).digest('hex')]))),
  host: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model },
  settings: { viewport, dpr: 1, quality: 'high', adaptive: false, durationMs, warmupMs, allowSoftware, headless: process.env.WES_HEADLESS === 'true',
    runtime: 'Vite development server; full ForgeRuntime; stationary Reference Car + asphalt road fixture',
    camera: { position: [0, 4, 16], target: [0, 3.5, 0], fov: 65 }, cloudTime: 'frozen; physics remains active' },
  methodology: { baselineOrder: 'off-a / noon-a / noon-b / off-b (ABBA blocks)',
    frames: 'wall-clock intervals between production render completions; includes simulation/environment work between frames',
    gpuRender: 'TIME_ELAPSED around production render submission, including shadows/post-process; excludes earlier IBL rebuild',
    ibl: 'separate, non-overlapping TIME_ELAPSED around AuthoredEnvironment.applyReflection; CPU is submission time',
    clock: 'real WorldEnvironmentController advanced by the production capability with simulation delta (TimeControl semantics retained)',
    missingValues: 'null, never zero; disjoint GPU batches discarded; software GPU timers refused',
    scope: 'WES K1 atmosphere/clock/night; no K2 winter surfaces or K3 precipitation',
    acceptance: 'No automatic visual or product-budget acceptance. Hardware measurements are a prerequisite, not final sign-off.' },
  cases: [], errors: [], gate: { measurementReady: false, visualAccepted: false, budgetAccepted: false, reasons: ['Capture not completed'] },
};
let server, browser, context;
await mkdir(output, { recursive: true });
const save = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function main() {
  console.log(`[wes] isolated project ${root}`);
  await prepareSmokeProject(root);
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, 'tests/smoke/fixtures/vehicle-test.level.json'), 'utf8'));
  const parity = JSON.parse(await readFile(resolve(REPO_ROOT, 'public/layouts/RuntimeParity.level.json'), 'utf8'));
  level.name = '__wes-acceptance'; level.worldSettings.gameMode = 'forge.vehicle';
  level.worldEnvironment = { time: { hour: 12 }, sunPath: { azimuthDeg: 180, noonElevationDeg: 60 } };
  level.postProcess = parity.postProcess;
  level.cloudLayer.speed = 0;
  report.fixtureSha256 = createHash('sha256').update(JSON.stringify(level)).digest('hex');
  await writeFile(resolve(root, 'public/layouts/__wes-acceptance.level.json'), JSON.stringify(level, null, 2));
  server = spawn(process.execPath, ['tests/smoke/start-server.mjs'], { cwd: REPO_ROOT, windowsHide: true,
    env: { ...process.env, FORGE_SMOKE_PORT: String(port), FORGE_SMOKE_PROJECT_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', c => process.stdout.write(c)); server.stderr.on('data', c => process.stderr.write(c));
  await waitForHttp(`http://127.0.0.1:${port}`);
  browser = await chromium.launch({ headless: process.env.WES_HEADLESS === 'true',
    ...(process.env.WES_BROWSER_EXECUTABLE ? { executablePath: process.env.WES_BROWSER_EXECUTABLE } : { channel: process.env.WES_CHANNEL ?? 'chrome' }),
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = browser.version();
  const browserCdp = await browser.newBrowserCDPSession();
  report.gpuSystemInfo = (await browserCdp.send('SystemInfo.getInfo')).gpu;
  context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ type: 'page', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() }); });
  // Even an accidental authoring action cannot write to the user's project.
  await context.route('**/__save-**', route => route.abort('blockedbyclient'));
  await page.goto(`http://127.0.0.1:${port}/tests/smoke/pages/world-environment-acceptance.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__wesAcceptance, null, { timeout: 120000 });
  report.witness = await page.evaluate(() => window.__wesAcceptance.witness());
  report.deviceClass = classifyGpu(report.witness.device);
  console.log(`[wes] ${report.deviceClass}: ${report.witness.device}`);
  if (report.deviceClass !== 'hardware' && !allowSoftware) {
    report.gate.reasons = ['Hardware GPU not verified; use a hardware-backed browser for acceptance. WES_ALLOW_SOFTWARE=true permits explicitly labelled diagnostic captures.'];
    await save();
    throw new Error('Hardware GPU required. Diagnostic output was saved; no GPU acceptance claimed.');
  }
  const client = await context.newCDPSession(page); await client.send('Performance.enable');
  for (const scenario of WES_SCENARIOS) {
    console.log(`[wes] ${scenario.id}`);
    await page.evaluate(next => window.__wesAcceptance.select(next), scenario);
    await wait(warmupMs);
    const raw = await page.evaluate(ms => window.__wesAcceptance.measure(ms), durationMs);
    const performanceMetrics = (await client.send('Performance.getMetrics')).metrics;
    const heap = performanceMetrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    const screenshot = `${scenario.id}.png`;
    // Freeze the dynamic clock at its initial hour for a comparable labelled image.
    await page.evaluate(next => window.__wesAcceptance.select({ ...next, dayLengthMinutes: 0 }), scenario);
    await page.locator('#game-canvas').screenshot({ path: resolve(output, screenshot), timeout: 30000 });
    const result = { id: scenario.id, scenario, frames: distribution(raw.samples.map(s => s.frameMs).filter(v => v !== null)),
      gpuRender: raw.disjoint ? null : distribution(raw.samples.map(s => s.gpuMs).filter(v => v !== null)),
      renderCpuSubmit: distribution(raw.samples.map(s => s.renderSubmitMs)),
      iblDuringRun: { cpuSubmit: distribution(raw.captures.map(s => s.cpuSubmitMs)), gpu: raw.disjoint ? null : distribution(raw.captures.map(s => s.gpuMs).filter(v => v !== null)) },
      disjoint: raw.disjoint, jsHeapUsedBytes: heap, witness: raw.witness,
      elapsedMs: raw.elapsedMs, screenshot, raw };
    report.cases.push(result); await save();
  }
  await page.evaluate(() => window.__wesAcceptance.select({ id: 'ibl', enabled: true, hour: 12, weather: 'clear' }));
  await wait(warmupMs);
  const ibl = await page.evaluate(() => window.__wesAcceptance.ibl(12));
  report.ibl = { cpuSubmit: distribution(ibl.samples.map(s => s.cpuSubmitMs)),
    gpu: ibl.disjoint ? null : distribution(ibl.samples.map(s => s.gpuMs).filter(v => v !== null)), disjoint: ibl.disjoint, raw: ibl };
  report.gate = measurementGate({ device: report.witness.device, timerAvailable: report.witness.timerAvailable, cases: report.cases, ibl: report.ibl });
  if (report.errors.length) { report.gate.measurementReady = false; report.gate.reasons.push('Browser errors were recorded'); }
  const off = report.cases.filter(c => c.id.startsWith('off-')).flatMap(c => c.raw.samples.map(s => s.frameMs).filter(v => v !== null));
  const on = report.cases.filter(c => c.id.startsWith('noon-')).flatMap(c => c.raw.samples.map(s => s.frameMs).filter(v => v !== null));
  const offStats = distribution(off), onStats = distribution(on);
  report.staticDelta = { off: offStats, on: onStats, p50Ms: onStats.p50Ms - offStats.p50Ms, p95Ms: onStats.p95Ms - offStats.p95Ms,
    warning: 'ABBA block comparison; different atmosphere/shadow directions are part of WES. Not a per-frame isolated shader benchmark.' };
  await save();
  console.log(`[wes] report: ${resolve(output, 'report.json')}`);
  console.log(`[wes] hardware measurements ready: ${report.gate.measurementReady}; visual/budget acceptance remains manual`);
  if (report.errors.length) process.exitCode = 1;
}
try { await main(); }
catch (error) { report.failure = error instanceof Error ? error.message : String(error); await save(); console.error(`[wes] ${report.failure}`); process.exitCode = 1; }
finally { await context?.close(); await browser?.close(); await stopProcess(server); await cleanupSmokeProject(root); }
