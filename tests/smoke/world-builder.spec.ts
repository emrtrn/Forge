import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { createWorldRecipe, worldRecipePath, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { expect, test } from "./test";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";

/**
 * World Builder F1 step 5b: the left panel's World Builder tab reads the open
 * level's recipe, a Dry Run reports without changing the level, Apply adds the
 * plan blockout as one undo step, Save Layout writes the recipe beside the
 * level, and after a reload the stage is up to date.
 */
const LEVEL = "layouts/__playwright-world-builder.level.json";
const MARKERS = ["wb-blockout-settlement-village", "wb-blockout-settlement-hamlet", "wb-blockout-landmark-depot"];

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), `${JSON.stringify(value, null, 2)}\n`);
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(smokePublicPath(path), "utf8")) as T;

function cubeIds(level: RoomLayout): string[] {
  return (level.instances.find((group) => group.assetId === "shape:cube")?.placements ?? [])
    .flatMap((placement) => (placement.id ? [placement.id] : []))
    .sort();
}

test("World Builder tab: dry run, apply as one undo step, save the recipe, up to date after reload", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await writeJson(LEVEL, { ...base, name: "__playwright-world-builder" });
  const recipe = createWorldRecipe("playwright_world_builder", 4);
  recipe.plan.settlements.push(
    { id: "village", source: "reference", observed: true, confidence: 0.8, center: [6, 4], type: "village" },
    { id: "hamlet", source: "manual", center: [-8, -6], type: "hamlet" },
  );
  recipe.plan.landmarks.push({ id: "depot", source: "manual", kind: "logistics.depot", position: [0, 10] });
  await writeJson(worldRecipePath(LEVEL), recipe);
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });

  const bootEditor = async () => {
    await page.goto(`/?editor&worldBuilder=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("world-builder-tab").click();
    await expect(page.getByTestId("world-builder-recipe")).toContainText("playwright_world_builder", { timeout: 30_000 });
  };
  const markerRows = () => page.getByTestId("outliner-row")
    .filter({ has: page.locator("strong", { hasText: /^(village|hamlet|depot)$/ }) });

  await bootEditor();
  await expect(page.getByTestId("world-builder-panel")).toContainText("Plan: 2 settlements, 1 landmarks");

  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+3 added · ~0 updated · −0 removed · 0 unchanged");
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");

  await page.getByTestId("world-builder-apply-planBlockout").click();
  await expect(page.getByTestId("world-builder-recipe")).toContainText("unsaved");
  await expect(page.getByTestId("world-builder-panel")).toContainText("3 generated objects");
  await page.locator('[data-outliner-tab="scene"]').click();
  await expect(markerRows()).toHaveCount(3);

  await page.getByTestId("editor-undo").click();
  await expect(markerRows()).toHaveCount(0);
  await page.getByTestId("editor-redo").click();
  await expect(markerRows()).toHaveCount(3);

  const recipeSaved = page.waitForResponse((res) => res.url().endsWith("/__save-worldrecipe") && res.request().method() === "POST");
  const layoutSaved = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await recipeSaved).ok()).toBeTruthy();
  expect((await layoutSaved).ok()).toBeTruthy();

  const savedRecipe = await readJson<WorldRecipe>(worldRecipePath(LEVEL));
  expect(Object.keys(savedRecipe.ownership.placements).sort()).toEqual([...MARKERS].sort());
  expect(savedRecipe.generators).toEqual({ planBlockout: 1 });
  expect(cubeIds(await readJson<RoomLayout>(LEVEL))).toEqual([...MARKERS].sort());

  await bootEditor();
  await expect(page.getByTestId("world-builder-recipe")).not.toContainText("unsaved");
  await page.getByTestId("world-builder-dry-run-planBlockout").click();
  await expect(page.getByTestId("world-builder-report")).toContainText("Up to date");
  await expect(page.getByTestId("world-builder-counts")).toHaveText("+0 added · ~0 updated · −0 removed · 3 unchanged");
  expect(errors).toEqual([]);
});
