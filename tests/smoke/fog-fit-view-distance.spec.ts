import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7d: the Height Fog's Details show how opaque it is at the
 * level's view distance, and "Fit to View Distance" makes it an exponential fog
 * reaching 98% there — with a density small enough that the save validator
 * must keep its 6 decimals (3 would round a 10 km fit to nothing).
 */

const LEVEL = "layouts/__playwright-fog-fit.level.json";

test("Height Fog fits to the level view distance and the fitted density survives Save", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-fog-fit";
  level.worldSettings = { ...level.worldSettings, viewDistance: 3000 };
  level.heightFog = { name: "Exponential Height Fog" };
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Exponential Height Fog" }).click();

  const details = page.locator('[data-inspector-pane="details"]');
  // The default fog (density 0.03) is already opaque long before 3 km.
  await expect(details.locator("[data-fog-view-opacity]")).toHaveText("100% fog");
  await details.locator('[data-fog-number="density"]').fill("0.0001");
  await details.locator('[data-fog-number="density"]').press("Enter");
  await expect(details.locator("[data-fog-view-opacity]")).toHaveText("9% fog");
  await expect(details.locator("[data-fog-view-warning]")).toBeVisible();

  const save = page.waitForRequest((request) => request.url().includes("/__save-layout")
    && JSON.parse(request.postData() ?? "{}").layout?.heightFog?.density === 0.000659, { timeout: 30_000 });
  await details.locator("[data-fog-fit-view]").click();
  await expect(details.locator("[data-fog-view-opacity]")).toHaveText("98% fog");
  await expect(details.locator("[data-fog-view-warning]")).toHaveCount(0);
  await expect(details.locator('[data-fog-number="density"]')).toHaveValue("0.000659");
  const request = await save;
  const response = await request.response();
  const body = await response?.json();
  expect(body?.dropped ?? []).toEqual([]);
  expect(errors).toEqual([]);
});
