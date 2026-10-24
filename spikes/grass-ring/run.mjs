// Start a Vite dev server separately (e.g. `npx vite --port 5274 --strictPort`);
// this runner only connects to it. Usage: node spikes/grass-ring/run.mjs [port] [query]
import { chromium } from "@playwright/test";

const port = process.argv[2] ?? "5274";
const query = process.argv[3] ?? "";
const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on("pageerror", (error) => { failures.push(error.message); console.error(error.stack ?? error.message); });
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/spikes/grass-ring/index.html${query ? `?${query}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 300_000 });
  console.log(await page.locator("#out").textContent());
  const report = await page.evaluate(() => window.__spikeReport);
  if (report.status !== "complete" || failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
