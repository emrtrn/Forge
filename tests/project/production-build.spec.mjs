import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve, relative, sep } from "node:path";
import { outputInventory } from "../../builder/web/game-project-build.mjs";

for (const base of ["/", "/ridgebound/"]) {
  test(`standalone production artifact at ${base} runs without source or authoring endpoints`, async ({ page }, info) => {
    test.skip(!process.env.FORGE_GAME_BUILD_ROOT, "Set FORGE_GAME_BUILD_ROOT to a built independent game");
    const buildsRoot = resolve(process.env.FORGE_GAME_BUILD_ROOT, "builds");
    const records = [];
    for (const name of await readdir(buildsRoot)) {
      try {
        const record = JSON.parse(await readFile(resolve(buildsRoot, name, "build-record.json"), "utf8"));
        if (record.base === base && record.status === "verified-build") records.push({ directory: resolve(buildsRoot, name), record });
      } catch { /* Incomplete attempts are not accepted artifacts. */ }
    }
    records.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
    expect(records.length).toBeGreaterThan(0);
    const { directory, record } = records[0];
    const workspace = await mkdtemp(resolve(tmpdir(), "forge-standalone-browser-"));
    const dist = resolve(workspace, "site");
    let server;
    try {
      await cp(resolve(directory, "dist"), dist, { recursive: true });
      const before = await outputInventory(dist);
      expect(createHash("sha256").update(JSON.stringify(before)).digest("hex")).toBe(record.outputDigest);
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
      server = createServer(async (req, res) => {
        try {
          if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
          const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
          if (pathname.endsWith("/favicon.ico")) { res.writeHead(204).end(); return; }
          if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
          const path = pathname.slice(base.length) || "index.html";
          const target = resolve(dist, path);
          const rel = relative(dist, target);
          if (rel === ".." || rel.startsWith(`..${sep}`)) { res.writeHead(403).end(); return; }
          const bytes = await readFile(target);
          res.writeHead(200, { "content-type": mime[extname(target)] ?? "application/octet-stream" });
          res.end(req.method === "HEAD" ? undefined : bytes);
        } catch { res.writeHead(404).end(); }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const errors = [], requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("request", (request) => requests.push(new URL(request.url()).pathname));
      await page.goto(`${origin}${base}`);
      await expect(page).toHaveTitle("Ridgebound");
      await expect(page.locator("#ridgebound-status")).toHaveAttribute("data-game-module", "ridgebound.prototype");
      await expect(page.locator("#game-canvas")).toBeVisible();
      await expect(page.locator(".forge-loading")).toBeHidden();
      // The game module mounts before the render loop's first frame. Wait for
      // that loop instead of capturing the still-white compositor surface.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      // Shader compilation can continue beyond two animation callbacks on a
      // cold browser. Observe the actual compositor pixels away from the HUD.
      await expect.poll(async () => {
        const screenshot = (await page.screenshot()).toString("base64");
        return page.evaluate(async (png) => {
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixel = context.getImageData(720, 450, 1, 1).data;
          return pixel[0] < 240 && pixel[1] < 240 && pixel[2] < 240;
        }, screenshot);
      }, { timeout: 30_000, message: "3D scene must replace the white startup surface" }).toBe(true);
      await page.screenshot({ path: info.outputPath(`production-${base === "/" ? "root" : "subpath"}.png`) });
      await page.goto(`${origin}${base}?editor`);
      await expect(page.locator("#ridgebound-status")).toBeVisible();
      await expect(page.getByTestId("forge-editor")).toHaveCount(0);
      const manifest = await (await page.request.get(`${origin}${base}project.3dgame.json`)).json();
      expect(manifest.game).toBeUndefined();
      expect(manifest.entry).toBe("index.html");
      expect(manifest.editor.previewUrl).toBeUndefined();
      expect((await page.request.post(`${origin}${base}__save-layout`, { data: {} })).status()).toBe(405);
      expect((await page.request.get(`${origin}${base}src/main.ts`)).status()).toBe(404);
      expect(requests.every((path) => path.startsWith(base) && !path.includes("/@fs/") && !path.endsWith(".ts"))).toBe(true);
      expect(errors).toEqual([]);
      expect(await outputInventory(dist)).toEqual(before);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      // Exact mkdtemp-owned standalone copy, never a user's live build directory.
      await rm(workspace, { recursive: true, force: true });
    }
  });
}
