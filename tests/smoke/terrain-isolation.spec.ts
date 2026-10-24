import { levelTerrainPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { expect, test, type Page } from "./test";
import { SMOKE_SCENE, SMOKE_TARGET_SCENE } from "./smokeProject.mjs";
import { addLandscapeFromMenu, readSavedTerrain } from "./terrain";

async function addLandscape(page: Page): Promise<void> {
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  const saved = page.waitForResponse((response) => response.url().endsWith("/__save-terrain") && response.request().method() === "POST");
  await addLandscapeFromMenu(page);
  expect((await saved).ok()).toBeTruthy();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved");
}

test("terrain edits in a second level preserve the first level's definition and tile bytes", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?editor");
  await addLandscape(page);
  const first = await (await request.get(`/${SMOKE_SCENE}`)).json();
  const actor = first.landscapes[0];
  expect(actor.dataRef).toBe(levelTerrainPath(SMOKE_SCENE, actor.id));
  const firstDefinition = await (await request.get(`/${actor.dataRef}`)).body();
  const firstTilePath = terrainTilePath(actor.dataRef, "0_0");
  const firstTile = await (await request.get(`/${firstTilePath}`)).body();

  expect((await request.post("/__open-level", { data: { path: SMOKE_TARGET_SCENE } })).ok()).toBeTruthy();
  await page.goto("/?editor&terrainIsolation=second");
  await addLandscape(page);
  const second = await (await request.get(`/${SMOKE_TARGET_SCENE}`)).json();
  expect(second.landscapes[0].id).toBe(actor.id);
  expect(second.landscapes[0].dataRef).toBe(levelTerrainPath(SMOKE_TARGET_SCENE, actor.id));
  expect(second.landscapes[0].dataRef).not.toBe(actor.dataRef);
  await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  await expect(page.locator('[data-landscape-tool="raise"]')).toBeVisible();
  await page.locator('[data-landscape-number="brushSize"]').fill("10");
  await page.locator('[data-landscape-number="brushSize"]').press("Tab");
  await page.locator('[data-landscape-number="strength"]').fill("1");
  await page.locator('[data-landscape-number="strength"]').press("Tab");
  const box = await page.locator("#game-canvas").boundingBox();
  if (!box) throw new Error("Missing canvas bounds");
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4);
  await page.mouse.up();
  await page.getByTestId("editor-save").click();
  await expect.poll(async () => (await readSavedTerrain(page, second.landscapes[0].dataRef)).heights.some((height) => Math.abs(height) > 0.001)).toBeTruthy();
  expect(await (await request.get(`/${actor.dataRef}`)).body()).toEqual(firstDefinition);
  expect(await (await request.get(`/${firstTilePath}`)).body()).toEqual(firstTile);

  expect((await request.post("/__open-level", { data: { path: SMOKE_SCENE } })).ok()).toBeTruthy();
  await page.goto("/?editor&terrainIsolation=first");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first()).toBeVisible();
  expect((await readSavedTerrain(page, actor.dataRef)).heights.every((height) => height === 0)).toBeTruthy();
  expect(errors).toEqual([]);
});
