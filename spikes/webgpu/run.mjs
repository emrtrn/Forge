// Runner for the WebGPU spike pages (Forge-WebGPU plan, Faz 1).
// Starts Forge's own Vite on 127.0.0.1:4174 (never 5173 / 5273) with
// FORGE_PROJECT_ROOT pointing at the local reference project, opens headed
// Chrome on the real GPU, waits for window.__spikeReport and saves it.
//
// Usage: node spikes/webgpu/run.mjs <page> [--uncapped] [--dpr N] [--query "a=1&b=2"] [--out <dir>] [--project <root>]
//   <page>: s1-boot | s2-terrain | ...
// The reference project and the Phase 0 harness live outside the repos:
// C:\Users\emret\Desktop\Games\ForgeReference (see its README).
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const page = args[0];
if (!page || page.startsWith("--")) throw new Error("usage: node spikes/webgpu/run.mjs <page> [--uncapped] [--dpr N] [--query q] [--out dir] [--project root]");
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const PORT = 4174;
const project = option("project", "C:/Users/emret/Desktop/Games/ForgeReference/forge-scenes");
const outDir = option("out", "C:/Users/emret/Desktop/Games/ForgeReference/baseline/spike");
const dpr = Number(option("dpr", "1"));
const query = option("query", "");
const uncapped = flag("uncapped");

async function waitForHttp(url, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
}

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: forgeRoot, env: { ...process.env, FORGE_PROJECT_ROOT: project }, stdio: ["ignore", "ignore", "pipe"],
});
vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
const chromeArgs = ["--window-size=1940,1150", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"];
if (uncapped) chromeArgs.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
let exitCode = 0;
try {
  await waitForHttp(`http://127.0.0.1:${PORT}/`);
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: chromeArgs });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (e) => errors.push(e.message));
    tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
    await tab.goto(`http://127.0.0.1:${PORT}/spikes/webgpu/${page}/index.html${query ? `?${query}` : ""}`);
    await tab.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 600_000 });
    const result = await tab.evaluate(() => window.__spikeReport);
    const tag = `${page}${uncapped ? "-uncapped" : ""}${dpr !== 1 ? `-dpr${dpr}` : ""}${query ? `-${query.replace(/[^a-z0-9]+/gi, "_")}` : ""}`;
    mkdirSync(outDir, { recursive: true });
    await tab.screenshot({ path: join(outDir, `${tag}.png`) });
    const record = { page, tag, at: new Date().toISOString(), browser: `Chrome ${browser.version()}`, uncapped, dpr, query, chromeArgs, errors: [...new Set(errors)].slice(0, 20), result };
    writeFileSync(join(outDir, `${tag}.json`), `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify(record, null, 2));
    if (result.status !== "complete") exitCode = 1;
  } finally {
    await browser.close();
  }
} finally {
  try { execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: "ignore" }); } catch {}
}
process.exitCode = exitCode;
