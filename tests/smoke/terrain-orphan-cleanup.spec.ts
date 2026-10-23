import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { levelTerrainDir, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { expect, test, type Page } from "./test";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";

async function save(page: Page): Promise<void> {
  const saved = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByTestId("editor-status")).toContainText("Saved");
}

test("saving a level removes a deleted landscape's terrain files unless another document still references them", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape" }).click();
  await save(page);

  const dataRef = (await (await request.get(`/${SMOKE_SCENE}`)).json()).landscapes[0].dataRef as string;
  const definition = smokePublicPath(dataRef);
  const tile = smokePublicPath(terrainTilePath(dataRef, "0_0"));
  const folder = smokePublicPath(levelTerrainDir(SMOKE_SCENE));
  expect(existsSync(definition) && existsSync(tile)).toBeTruthy();

  const landscapeRow = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  await landscapeRow.first().click();
  await page.keyboard.press("Delete");
  await expect(landscapeRow).toHaveCount(0);
  await save(page);
  expect(existsSync(definition) || existsSync(tile) || existsSync(folder)).toBeFalsy();

  // Undo after the cleanup brings the actor back; the next save rewrites its terrain.
  await page.getByTestId("editor-undo").click();
  await expect(landscapeRow).toHaveCount(1);
  await save(page);
  expect(existsSync(definition) && existsSync(tile)).toBeTruthy();

  // A copied level still points at this terrain until its own first save: keep it.
  const copy = smokePublicPath("layouts/__playwright-orphan-copy.level.json");
  await writeFile(copy, JSON.stringify({ landscapes: [{ dataRef }] }), "utf8");
  try {
    await landscapeRow.first().click();
    await page.keyboard.press("Delete");
    await expect(landscapeRow).toHaveCount(0);
    await save(page);
    expect(existsSync(definition) && existsSync(tile)).toBeTruthy();
  } finally {
    await rm(copy, { force: true });
  }
  expect(errors).toEqual([]);
});
