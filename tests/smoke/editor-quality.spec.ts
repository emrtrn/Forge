import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * The editor's Quality menu (Unreal's Scalability) picks one graphics profile
 * for the viewport and for Play: it is stored as the player's manual choice in
 * the shared `forge.userSettings`, so Play boots with it and an already open
 * Play tab switches live. The level is served in flight.
 */

const LEVEL = "layouts/__playwright-editor-quality.level.json";

interface RenderProbe {
  shadows: boolean;
  cascades: number;
}

async function serveLevel(page: import("@playwright/test").Page): Promise<void> {
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-editor-quality";
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional"
    ? { ...light, name: "Sun", castShadow: true, cascadedShadows: true }
    : light);
  await page.context().route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.context().route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
}

function probe(page: import("@playwright/test").Page): Promise<RenderProbe> {
  return page.evaluate(() => {
    const w = window as unknown as { __qualityScenes: any[]; __qualityRenderer?: any };
    let cascades = 0;
    for (const scene of w.__qualityScenes) scene.traverse((node: any) => {
      if (node.isDirectionalLight && String(node.name).startsWith("forge-sun-cascade-")) cascades += 1;
    });
    return { shadows: Boolean(w.__qualityRenderer?.shadowMap.enabled), cascades };
  });
}

async function pickQuality(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.getByTestId("quality-button").hover();
  await page.locator("[data-quality-popover] button", { hasText: label }).click();
  await expect(page.locator("[data-quality-label]")).toHaveText(label);
}

test("editor Quality menu drives the viewport and Play, live in an open Play tab", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await serveLevel(page);
  await page.context().addInitScript(() => {
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __qualityScenes: any[]; __qualityRenderer?: any };
    w.__qualityScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__qualityScenes.push(object);
      // The first renderer draws the scene; later ones are asset previews.
      if (object?.isWebGLRenderer) w.__qualityRenderer ??= object;
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?editor");
  await page.evaluate(() => localStorage.removeItem("forge.userSettings"));
  await page.reload();
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  // Untouched: Auto, and the viewport renders at Ultra (four cascades).
  await expect(page.locator("[data-quality-label]")).toHaveText("Auto");
  await expect.poll(() => probe(page), { timeout: 30_000 }).toEqual({ shadows: true, cascades: 4 });

  await pickQuality(page, "Low");
  await expect.poll(() => probe(page)).toEqual({ shadows: false, cascades: 0 });
  await pickQuality(page, "High");
  await expect.poll(() => probe(page)).toEqual({ shadows: true, cascades: 3 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("forge.userSettings") ?? "{}").payload?.graphics);
  expect(stored).toMatchObject({ selectedQualityLevel: "high", manuallySelected: true });

  // Play boots with the editor's pick…
  const play = await page.context().newPage();
  const messages: string[] = [];
  play.on("console", (message) => messages.push(message.text()));
  play.on("pageerror", (error) => errors.push(error.message));
  await play.goto(`/?quality=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect.poll(() => probe(play), { timeout: 30_000 }).toEqual({ shadows: true, cascades: 3 });

  // …and follows a new pick while it stays open.
  await page.bringToFront();
  await pickQuality(page, "Medium");
  await expect.poll(() => probe(play), { timeout: 10_000 }).toEqual({ shadows: true, cascades: 2 });
  await pickQuality(page, "Low");
  await expect.poll(() => probe(play), { timeout: 10_000 }).toEqual({ shadows: false, cascades: 0 });

  // Auto hands the choice back to Play's calibration; the editor renders at Ultra.
  await pickQuality(page, "Auto");
  await expect.poll(() => probe(page)).toEqual({ shadows: true, cascades: 4 });
  const auto = await page.evaluate(() => JSON.parse(localStorage.getItem("forge.userSettings") ?? "{}").payload?.graphics);
  expect(auto.manuallySelected).toBe(false);
  expect(errors).toEqual([]);
});
