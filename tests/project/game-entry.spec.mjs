import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { projectConfig } from "../../tools/run-game-project.mjs";

const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let root, server, url, originalForgeManifest;
test.beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), "forge-game-browser-"));
  originalForgeManifest = await readFile(resolve(forgeRoot, "public/project.3dgame.json"), "utf8");
  for (const dir of ["src/game", "public/layouts", "public/assets"]) await mkdir(resolve(root, dir), { recursive: true });
  await writeFile(resolve(root, "public/project.3dgame.json"), JSON.stringify({
    schema: 1, name: "Independent fixture", type: "three-game", version: "0.0.0", entry: "forge:default", publicDir: "public",
    game: { module: "src/game/gameModule.ts", editorCatalog: "src/game/editorCatalog.ts" },
    editor: { defaultScene: "layouts/Prototype.level.json", assetManifest: "assets/manifest.json" }, scripts: {}, output: { distDir: "dist" },
  }));
  await writeFile(resolve(root, "public/assets/manifest.json"), JSON.stringify({ version: 1, generated: "2026-10-31", ktx2: false, assets: [] }));
  await writeFile(resolve(root, "public/layouts/Prototype.level.json"), JSON.stringify({
    schema: 1, name: "Independent scene", loadGroups: [], characters: [], actors: [],
    instances: [{ assetId: "shape:cube", placements: [{ id: "fixture-cube", name: "Fixture cube", position: [0, 0, 0], rotationYDeg: 0, scale: 2 }] }],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], rotation: [-45, 30, 0], color: "#ffffff", intensity: 3, castShadow: false }],
    worldSettings: { backgroundColor: "#b8cccb" },
  }));
  await writeFile(resolve(root, "src/game/gameModule.ts"), `
    import { Vector3 } from "three";
    import { createGameModule as commonModule } from "@/game/gameModule";
    export function createGameModule() {
      const common = commonModule(); let badge;
      return { ...common, id: "fixture.independent",
        async onLevelLoaded(context) {
          await common.onLevelLoaded?.(context);
          badge = document.createElement("div"); badge.id = "independent-status";
          badge.textContent = "Independent game"; badge.dataset.vector = new Vector3(1,2,3).toArray().join(",");
          badge.style.cssText = "position:absolute;top:20px;left:20px;color:white;background:#123;padding:12px";
          document.getElementById("ui-overlay").append(badge);
        },
        dispose() { badge?.remove(); common.dispose?.(); }
      };
    }
  `);
  await writeFile(resolve(root, "src/game/editorCatalog.ts"), `
    import { GAME_EDITOR_CATALOG as common } from "@/game/editorCatalog";
    export const GAME_EDITOR_CATALOG = { ...common, gameModeOptions: common.gameModeOptions.map(mode =>
      mode.id === "forge.defaultCamera" ? { ...mode, displayName: "Independent camera" } : mode) };
  `);
  const config = await projectConfig(root);
  server = await createServer({ ...config, configFile: false, cacheDir: resolve(root, "cache"), logLevel: "error",
    server: { ...config.server, host: "127.0.0.1", port: 0, hmr: false } });
  await server.listen();
  url = server.resolvedUrls.local[0];
});
test.afterAll(async () => {
  await server?.close();
  if (originalForgeManifest !== undefined) expect(await readFile(resolve(forgeRoot, "public/project.3dgame.json"), "utf8")).toBe(originalForgeManifest);
  // root is the exact mkdtemp-owned directory, never an authored scene root.
  if (root) await rm(root, { recursive: true, force: true });
});

test("independent runtime uses selected game module and shared dependencies", async ({ page }, info) => {
  const errors = [], threeModules = new Set();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (/\/three\.js$/.test(new URL(response.url()).pathname)) threeModules.add(response.url());
  });
  await page.goto(url);
  await expect(page).toHaveTitle("Independent fixture");
  await expect(page.locator("#independent-status")).toHaveText("Independent game");
  await expect(page.locator("#independent-status")).toHaveAttribute("data-vector", "1,2,3");
  await expect(page.locator("#game-canvas")).toBeVisible();
  expect(threeModules.size).toBe(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("independent-runtime.png") });
});

test("independent editor catalog and save/reload preserve the selected game's files", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}?editor`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 45_000 });
  await page.locator("[data-main-menu-button]").click();
  await page.getByRole("button", { name: /^World Settings/ }).click();
  await expect(page.locator('[data-world-game-mode] option[value="forge.defaultCamera"]')).toHaveText("Independent camera");
  await page.locator("[data-world-settings-close]").click();
  await page.getByTestId("outliner-row").filter({ hasText: "Fixture cube" }).click();
  const px = page.locator('[data-testid="detail-px"]:visible');
  await px.fill("2");
  await px.press("Enter");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => JSON.parse(await readFile(resolve(root, "public/layouts/Prototype.level.json"), "utf8")).instances[0].placements[0].position[0]).toBe(2);
  const manifest = JSON.parse(await readFile(resolve(root, "public/project.3dgame.json"), "utf8"));
  expect(manifest.game.module).toBe("src/game/gameModule.ts");
  await page.reload();
  await expect(page.getByTestId("forge-editor")).toBeVisible();
  await page.getByTestId("outliner-row").filter({ hasText: "Fixture cube" }).click();
  await expect(page.locator('[data-testid="detail-px"]:visible')).toHaveValue("2");
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("independent-editor.png") });
});

test("actual Ridgebound prototype opens its runtime and editor without changing authored data", async ({ page }, info) => {
  test.skip(!process.env.FORGE_GAME_TEST_URL, "Set FORGE_GAME_TEST_URL to include the live game check");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const gameUrl = process.env.FORGE_GAME_TEST_URL;
  await page.goto(gameUrl);
  await expect(page).toHaveTitle("Ridgebound");
  await expect(page.locator("#ridgebound-status")).toContainText("Ridgebound");
  await expect(page.locator("#ridgebound-status")).toHaveAttribute("data-game-module", "ridgebound.prototype");
  const bounds = await page.locator("#ridgebound-status").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: info.outputPath("ridgebound-runtime.png") });
  await page.goto(`${gameUrl}?editor`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Prototip Blok A" })).toHaveCount(1);
  await page.locator("[data-main-menu-button]").click();
  await page.getByRole("button", { name: /^World Settings/ }).click();
  await expect(page.locator('[data-world-game-mode] option[value="forge.defaultCamera"]')).toHaveText("Ridgebound — Prototip Kamera");
  await page.locator("[data-world-settings-close]").click();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("ridgebound-editor.png") });
});
