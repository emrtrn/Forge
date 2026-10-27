import { chromium } from "playwright";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Run against the isolated server documented in WATER_LANDSCAPE_REVIEW.md.
// This driver never calls a save endpoint or touches authored scene data.
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = argument("url") ?? process.env.FORGE_WATER_REVIEW_URL ?? "http://127.0.0.1:5488";
const output = resolve(argument("output") ?? process.env.FORGE_WATER_REVIEW_OUTPUT ?? "docs/planned/Forge_Water_System/evidence/landscape-review");
const lakesOnly = process.argv.includes("--lakes-only");
await mkdir(output, { recursive: true });
// HMR is disabled, but another editor session may still change files while a
// page is loading. Keep the complete engine/app source boundary reviewable.
async function sourceSnapshot() {
  const files = [];
  for (const root of ["engine", "src"]) for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|js|glsl)$/.test(entry.name)) files.push(join(entry.parentPath, entry.name));
  }
  files.push("tests/smoke/pages/water-landscape-review.ts", "tests/smoke/pages/water-surface-v4-shaders.json");
  const result = {};
  for (const file of files.sort()) result[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  return result;
}
const sourceStart = await sourceSnapshot();
const refine = process.argv.includes("--refine");
const baseline = process.argv.includes("--baseline");
const captureOnly = process.argv.includes("--capture-only");
const previousReport = refine ? JSON.parse(await readFile(resolve(output, "review.json"), "utf8")) : null;
if (refine) await writeFile(resolve(output, "review-first-pass.json"), JSON.stringify(previousReport, null, 2));
const browser = await chromium.launch({ channel: "chrome", headless: false,
  args: ["--use-angle=d3d11"], timeout: 30_000 });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], warnings = new Map(), failedRequests = [], writes = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); if (message.type() === "warning") warnings.set(message.text(), (warnings.get(message.text()) ?? 0) + 1); });
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
await page.route("**/*", async (route) => {
  if (!["GET", "HEAD"].includes(route.request().method())) {
    writes.push({ method: route.request().method(), url: route.request().url() });
    await route.abort(); return;
  }
  await route.continue();
});
const captures = [], benchmarks = [];
try {
  await page.goto(`${base}/tests/smoke/pages/water-landscape-review.html?editor`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => window.__waterLandscape?.ready, null, { timeout: 180_000 });
  const initial = await page.evaluate(() => window.__waterLandscape.metadata());
  if (!initial.renderer.includes("NVIDIA") || !initial.gpuTimer) throw new Error(`Expected hardware GPU: ${JSON.stringify(initial)}`);
  if (initial.terrain.some((t) => t.tiles !== t.expected) || initial.lakes.some((l) => l.status !== "ready")
    || initial.waters.some((w) => !w.vertices || !w.triangles)) throw new Error("Incomplete scene/water geometry");
  await page.waitForTimeout(2000);
  const views = lakesOnly ? ["lake-overview", "lake-shore", "lake-top", "lake-low", "lake-1", "lake-1-low"] : refine ? ["river-flat", "lake-shore"] : process.argv.includes("--pilot") ? ["river-upper", "river-bank", "lake-overview"] :
    ["river-upper", "river-bank", "river-flat", "river-top", "lake-overview", "lake-shore", "lake-top", "lake-low", "lake-1", "lake-1-low"];
  for (const view of views) {
    await page.selectOption("#review-view", view);
    await page.waitForTimeout(1800);
    for (const variant of baseline ? ["off", "before"] : ["off", "before", "after"]) {
      await page.selectOption("#review-variant", variant);
      await page.waitForTimeout(250);
      const png = await page.locator("canvas").screenshot({ path: resolve(output, `${view}-${variant}.png`) });
      const stats = await sharp(png).stats();
      const imageStats = { mean: stats.channels.slice(0, 3).map((c) => c.mean), stdev: stats.channels.slice(0, 3).map((c) => c.stdev) };
      if (Math.max(...imageStats.mean) < 8 || Math.max(...imageStats.stdev) < 4) throw new Error(`Blank/black frame: ${view}/${variant}`);
      captures.push({ ...await page.evaluate(() => window.__waterLandscape.metadata()), imageStats });
    }
  }
  if (!baseline) for (const view of lakesOnly ? ["lake-1-low", "lake-low"] : ["river-bank", "lake-low"]) {
    await page.selectOption("#review-view", view);
    await page.selectOption("#review-variant", "after");
    await page.evaluate(() => window.__waterLandscape.setTime(14));
    await page.waitForTimeout(400);
    await page.locator("canvas").screenshot({ path: resolve(output, `${view}-time14.png`) });
    await page.evaluate(() => window.__waterLandscape.setTime(12));
  }
  if (!process.argv.includes("--pilot") && !captureOnly) {
    for (const view of lakesOnly ? ["lake-overview", "lake-1"] : refine ? ["river-flat"] : ["river-bank", "river-flat", "lake-overview", "lake-1"]) {
      await page.selectOption("#review-view", view);
      await page.waitForTimeout(1800);
      const result = await page.evaluate(() => window.__waterLandscape.benchmark(120));
      benchmarks.push({ view, result });
      console.log(`GPU sweep complete: ${view}`);
    }
    // A short real-input camera/variant/motion exploration also checks the
    // page stays responsive with live water and no source writes.
    await page.check("#review-motion");
    const explorationStart = Date.now();
    let step = 0;
    while (Date.now() - explorationStart < (refine ? 0 : 30_000)) {
      await page.selectOption("#review-view", views[step % views.length]);
      await page.selectOption("#review-variant", step % 2 ? "low" : "after");
      await page.waitForTimeout(1000); step++;
    }
    await page.uncheck("#review-motion");
    await page.selectOption("#review-view", "river-bank");
    await page.selectOption("#review-variant", "after");
  }
  const sourceEnd = await sourceSnapshot();
  const changedSources = [...new Set([...Object.keys(sourceStart), ...Object.keys(sourceEnd)])].filter(file => sourceStart[file] !== sourceEnd[file]);
  const report = { date: new Date().toISOString(), pilot: process.argv.includes("--pilot"), sourceStart, sourceEnd, changedSources,
    baselineCommit: "35ac2ade", baseline, initial, captures, benchmarks, errors, warnings: Object.fromEntries(warnings), failedRequests, writes };
  if (refine) {
    report.initial = previousReport.initial;
    report.captures = [...previousReport.captures.filter((c) => !views.includes(c.view)), ...captures];
    report.benchmarks = [...previousReport.benchmarks.filter((b) => b.view !== "river-flat"), ...benchmarks];
    report.errors = [...previousReport.errors, ...errors];
    report.warnings = Object.fromEntries(new Set([...Object.keys(previousReport.warnings), ...warnings.keys()]).values().map((key) => [key, (previousReport.warnings[key] ?? 0) + (warnings.get(key) ?? 0)]));
    report.firstPassDate = previousReport.date;
    report.refinement = "river-flat and lake-shore cameras moved to remove terrain occlusion; river-flat GPU sweep repeated";
  }
  await writeFile(resolve(output, baseline ? "before.json" : process.argv.includes("--pilot") ? "pilot.json" : "review.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, renderer: initial.renderer, views: captures.length, benchmarks: benchmarks.length, errors, warningTypes: warnings.size, failedRequests, writes }, null, 2));
  if (errors.length || writes.length || failedRequests.length || changedSources.length) process.exitCode = 1;
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: String(error), errors, warnings: Object.fromEntries(warnings), failedRequests, writes }, null, 2));
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); }
