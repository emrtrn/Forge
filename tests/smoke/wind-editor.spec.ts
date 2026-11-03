import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * Faz 6 wind authoring: World Settings' Wind rows write `worldSettings.wind`
 * (one undo step), and the World Environment's Wind rows show World Settings
 * as the fallback and write their own `worldEnvironment.wind` group. The level
 * is served from memory and `/__save-layout` is answered here, so nothing
 * under `public/` is written.
 */

const LEVEL = "layouts/__playwright-wind-editor.level.json";

test.setTimeout(120_000);

interface SavedLayout {
  worldSettings?: { wind?: { directionDeg?: number; strength?: number; gust?: number } };
  worldEnvironment?: { wind?: { directionDeg?: number; strength?: number; gust?: number } };
}

test("wind editor: World Settings and World Environment wind rows save with undo", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-wind-editor";
  let served: unknown = level;
  const saves: SavedLayout[] = [];

  await context.route(`**/${LEVEL}`, (route) => route.fulfill({ json: served }));
  await context.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await context.route("**/__save-layout", async (route) => {
    const layout = JSON.parse(route.request().postData() ?? "{}").layout as SavedLayout;
    saves.push(layout);
    served = layout;
    await route.fulfill({ json: { ok: true, path: LEVEL, changed: true, dropped: [], removedTerrain: [] } });
  });
  await context.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  // 1. World Settings: defaults shown, an edit saves only the authored field, undo removes it.
  await page.locator("[data-main-menu-button]").click();
  await page.getByRole("button", { name: /^World Settings/ }).click();
  const settings = page.locator("[data-world-settings-popover]");
  await expect(settings).toBeVisible();
  const strength = settings.locator('[data-world-wind="strength"]');
  await expect(strength).toHaveValue("0.3");
  await expect(settings.locator('[data-world-wind="directionDeg"]')).toHaveValue("45");
  await strength.fill("0.8");
  await strength.press("Tab");
  await expect.poll(() => saves.at(-1)?.worldSettings?.wind, { timeout: 15_000 }).toEqual({ strength: 0.8 });
  await page.locator("[data-world-settings-close]").click();
  await page.getByTestId("editor-undo").click();
  await expect.poll(() => saves.at(-1)?.worldSettings?.wind, { timeout: 15_000 }).toBeUndefined();
  await page.getByTestId("editor-redo").click();
  await expect.poll(() => saves.at(-1)?.worldSettings?.wind, { timeout: 15_000 }).toEqual({ strength: 0.8 });

  // 2. World Environment: unset fields read World Settings; its own group saves separately.
  const popover = page.locator("[data-add-actor-popover]");
  await page.getByTestId("add-actor-button").hover();
  await popover.getByRole("button", { name: /^Visual Effects/ }).hover();
  await popover.locator('[data-add-categories] [data-add-key="worldEnvironment"]').click();
  await expect(page.getByTestId("outliner-row").filter({ hasText: "World Environment" })).toHaveCount(1);
  const details = page.locator('[data-inspector-pane="details"]');
  await expect(details.locator('[data-wes-wind="strength"]')).toHaveValue("0.8");
  const direction = details.locator('[data-wes-wind="directionDeg"]');
  await direction.fill("270");
  await direction.press("Tab");
  await expect.poll(() => saves.at(-1)?.worldEnvironment?.wind, { timeout: 15_000 }).toEqual({ directionDeg: 270 });
  expect(saves.at(-1)?.worldSettings?.wind).toEqual({ strength: 0.8 });

  expect(errors).toEqual([]);
});
