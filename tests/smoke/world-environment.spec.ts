import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * World Environment K1 (WES-005, ENV-06 / ENV-15): the editor preview is never
 * saved and never dirties the level, "Make Default" is one undo step, a
 * reopened level shows its defaults rather than the last preview, and Play
 * starts from the default.
 *
 * The level and every save stay in this test: the level is served from memory
 * and `/__save-layout` is answered here, so nothing under `public/` is written.
 */

const LEVEL = "layouts/__playwright-wes.level.json";

test.setTimeout(180_000);

interface SavedLayout {
  worldEnvironment?: { time?: { hour?: number }; season?: string; weather?: { preset?: string } };
}

test("World Environment: preview stays out of the level, Make Default is one undo step, Play starts from it", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-wes";
  level.skyAtmosphere = {};
  level.heightFog = {};
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

  // 1. Add the actor: it starts from the Sun's current aim (ENV-00b) and saves.
  const popover = page.locator("[data-add-actor-popover]");
  await page.getByTestId("add-actor-button").hover();
  await popover.getByRole("button", { name: /^Visual Effects/ }).hover();
  await popover.locator('[data-add-categories] [data-add-key="worldEnvironment"]').click();
  await expect(page.getByTestId("outliner-row").filter({ hasText: "World Environment" })).toHaveCount(1);
  await expect.poll(() => saves.at(-1)?.worldEnvironment?.time?.hour, { timeout: 15_000 }).toBeDefined();
  const derivedHour = saves.at(-1)!.worldEnvironment!.time!.hour!;
  const details = page.locator('[data-inspector-pane="details"]');
  await expect(details.locator("[data-wes-preview]")).toBeVisible();

  // 2. Scrub + weather + season preview: nothing is saved, the level is not dirty.
  const saveCount = saves.length;
  await scrubTo(page, 18);
  await expect(details.locator("[data-wes-preview-hour-label]")).toHaveText("18:00");
  await details.locator('[data-wes-preview-weather="cloudy"]').click();
  await details.locator('[data-wes-preview-season="winter"]').click();
  await page.waitForTimeout(2500);
  expect(saves.length).toBe(saveCount);
  await expect(details.locator("[data-wes-preview-default]")).toBeEnabled();

  // 3. Make Default: one undoable step written to the level.
  await details.locator("[data-wes-preview-default]").click();
  await expect.poll(() => saves.at(-1)?.worldEnvironment?.time?.hour, { timeout: 15_000 }).toBe(18);
  expect(saves.at(-1)?.worldEnvironment?.weather?.preset).toBe("cloudy");
  expect(saves.at(-1)?.worldEnvironment?.season).toBe("winter");
  await page.getByTestId("editor-undo").click();
  await expect.poll(() => saves.at(-1)?.worldEnvironment?.time?.hour, { timeout: 15_000 }).toBe(derivedHour);
  expect(saves.at(-1)?.worldEnvironment?.season).toBeUndefined();
  await page.getByTestId("editor-redo").click();
  await expect.poll(() => saves.at(-1)?.worldEnvironment?.time?.hour, { timeout: 15_000 }).toBe(18);

  // 4. A preview left behind is not saved: reopening shows the default.
  await scrubTo(page, 3);
  await expect(details.locator("[data-wes-preview-hour-label]")).toHaveText("03:00");
  await page.reload();
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "World Environment" }).click();
  await expect(details.locator("[data-wes-preview-hour-label]")).toHaveText("18:00");
  await expect(details.locator("[data-wes-preview-default]")).toBeDisabled();

  // The Sun's rotation is read-only while the World Environment drives it.
  await page.getByTestId("outliner-row").getByText("sun", { exact: true }).click();
  await expect(details.locator("[data-sun-managed-by-wes]")).toBeVisible();

  // 5. Play starts from the level default, not from any preview.
  const play = await context.newPage();
  play.on("pageerror", (error) => errors.push(error.message));
  await play.goto(`/?debug&wesSmoke=${Date.now()}`);
  await expect(play.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  await expect(play.locator("#debug-stats")).toContainText("world env: 18:00 winter cloudy 1.00", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

/** Drags the preview clock like a user: `input` while dragging, `change` on release. */
async function scrubTo(page: Page, hour: number): Promise<void> {
  await page.locator("[data-wes-preview-hour]").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    for (const step of [value - 1, value - 0.5, value]) {
      input.value = String(step);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hour);
}
