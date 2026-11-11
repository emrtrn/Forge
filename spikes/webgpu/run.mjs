// Runner for the WebGPU spike pages (Forge-WebGPU plan, Faz 1).
// Starts Forge's own Vite on 127.0.0.1:4174 (never 5173 / 5273) with
// FORGE_PROJECT_ROOT pointing at the local reference project, opens headed
// Chrome on the real GPU, waits for window.__spikeReport and saves it.
//
// Usage: node spikes/webgpu/run.mjs <page> [--scene <id> --pose <P1|P2|P3>] [--uncapped] [--dpr N] [--query "a=1&b=2"] [--out <dir>] [--project <root>]
//   <page>: s1-boot | s2-terrain | ...
//   --scene / --pose read ForgeReference/baseline/poses.json: the level goes into ?level=, the
//   project root follows the scene, and the pose is handed over in localStorage like Forge's Play.
// The reference project and the Phase 0 harness live outside the repos:
// C:\Users\emret\Desktop\Games\ForgeReference (see its README).
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const REF = "C:/Users/emret/Desktop/Games/ForgeReference";
const sceneId = option("scene", null);
const poseId = option("pose", "P1");
const scene = sceneId ? JSON.parse(readFileSync(`${REF}/baseline/poses.json`, "utf8")).find((s) => s.id === sceneId) : null;
if (sceneId && !scene) throw new Error(`unknown scene ${sceneId}`);
const pose = scene ? scene.poses.find((p) => p.id === poseId) : null;
if (scene && !pose) throw new Error(`unknown pose ${poseId}`);
const project = option("project", scene ? `${REF}/${scene.project}` : `${REF}/forge-scenes`);
const outDir = option("out", "C:/Users/emret/Desktop/Games/ForgeReference/baseline/spike");
const dpr = Number(option("dpr", "1"));
const extraQuery = option("query", "");
const query = [scene ? `level=${encodeURIComponent(scene.level)}` : "", extraQuery].filter(Boolean).join("&");
const uncapped = flag("uncapped");
const measure = flag("measure");
const reps = Number(option("reps", "3"));

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
    const tag = `${page}${scene ? `-${scene.id}-${pose.id}` : ""}${uncapped ? "-uncapped" : ""}${dpr !== 1 ? `-dpr${dpr}` : ""}${extraQuery ? `-${extraQuery.replace(/[^a-z0-9]+/gi, "_")}` : ""}`;
    mkdirSync(outDir, { recursive: true });
    const runs = [];
    let result = null;
    const errors = [];
    for (let rep = 1; rep <= (measure ? reps : 1); rep += 1) {
      // A fresh context per repetition, like the Phase 0 baseline harness.
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
      if (pose) {
        await context.addInitScript((p) => localStorage.setItem("forge.play.cameraPose", JSON.stringify(p)), { position: pose.position, quaternion: pose.quaternion });
      }
      const tab = await context.newPage();
      tab.on("pageerror", (e) => errors.push(e.message));
      tab.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
      const started = Date.now();
      await tab.goto(`http://127.0.0.1:${PORT}/spikes/webgpu/${page}/index.html${query ? `?${query}` : ""}`);
      await tab.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 600_000 });
      const loadMs = Date.now() - started;
      result = await tab.evaluate(() => window.__spikeReport);
      if (rep === 1) await tab.screenshot({ path: join(outDir, `${tag}.png`) });
      if (measure && result.status === "complete") {
        // Same window as the Phase 0 baseline: 10 s warm-up, 15 s of frames.
        await tab.waitForTimeout(10_000);
        const sample = await tab.evaluate((ms) => new Promise((done) => {
          const canvas = document.querySelector("#game-canvas");
          const intervals = [];
          const witness = [];
          let last = null;
          const end = performance.now() + ms;
          const poll = setInterval(() => { try { witness.push(JSON.parse(canvas.dataset.forgePerf ?? "null")); } catch {} }, 500);
          const frame = (t) => {
            if (last !== null) intervals.push(t - last);
            last = t;
            if (t < end) requestAnimationFrame(frame);
            else { clearInterval(poll); done({ intervals, witness: witness.filter(Boolean), canvas: [canvas.width, canvas.height] }); }
          };
          requestAnimationFrame(frame);
        }), 15_000);
        const q = (values, p) => {
          if (!values.length) return null;
          const s = [...values].sort((a, b) => a - b);
          const i = (s.length - 1) * p;
          return Number((s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))).toFixed(2));
        };
        const pick = (k) => sample.witness.map((w) => w[k]).filter((v) => typeof v === "number");
        const last = sample.witness.at(-1) ?? {};
        const run = {
          rep, loadMs, canvas: sample.canvas, frames: sample.intervals.length,
          frameMeanMs: Number((15_000 / Math.max(1, sample.intervals.length)).toFixed(2)),
          frameP95Ms: q(sample.intervals, 0.95), gpuMedianMs: q(pick("gpuMs"), 0.5), gpuP95Ms: q(pick("gpuMs"), 0.95),
          drawCalls: q(pick("drawCalls"), 0.5), triangles: q(pick("triangles"), 0.5),
          backend: last.backend ?? null, isWebGPUBackend: last.isWebGPUBackend ?? null,
        };
        if (run.isWebGPUBackend !== true) exitCode = 1;
        runs.push(run);
        console.log(`${tag} #${rep}: frame ${run.frameMeanMs} / p95 ${run.frameP95Ms} ms, gpu ${run.gpuMedianMs} ms, draws ${run.drawCalls}, tris ${run.triangles}, ${run.backend}`);
      }
      await context.close();
    }
    const record = { page, tag, scene: scene?.id ?? null, pose: pose?.id ?? null, at: new Date().toISOString(), browser: `Chrome ${browser.version()}`, uncapped, dpr, query, chromeArgs, errors: [...new Set(errors)].slice(0, 20), result, runs };
    writeFileSync(join(outDir, `${tag}.json`), `${JSON.stringify(record, null, 2)}\n`);
    if (!measure) console.log(JSON.stringify(record, null, 2));
    if (result?.status !== "complete") exitCode = 1;
  } finally {
    await browser.close();
  }
} finally {
  try { execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: "ignore" }); } catch {}
}
process.exitCode = exitCode;
