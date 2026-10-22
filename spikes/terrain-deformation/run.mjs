// Start npm run dev:smoke separately; this runner only connects to that server.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on("pageerror", (error) => { failures.push(error.message); console.error(error.stack ?? error.message); });
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
  await page.goto("http://127.0.0.1:5273/spikes/terrain-deformation/index.html", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 180_000 });
  const report = await page.evaluate(() => window.__spikeReport);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "complete" || failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
