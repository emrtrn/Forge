import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WIND_SWAY_DEFAULTS } from "../../engine/environment/wind";
import { foliageDataPath, normalizeFoliageType } from "../../engine/scene/foliage";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * A Foliage Type created in the editor is registered in the manifest after the
 * editor cached it. Its later edits (here Wind Sway) must still reach
 * `/__save-foliage-type` — they used to apply in memory only, so the editor
 * swayed and Play, which reads the file, did not. Level, foliage sidecar, type
 * and manifest are served and the saves answered in flight: nothing is written.
 */

const LEVEL = "layouts/__playwright-foliage-type-save.level.json";
const TYPE_ID = "__playwright-foliage-type-save";
const TYPE_PATH = `assets/${TYPE_ID}.foliagetype.json`;
const NEW_ID = "playwright-new-foliagetype";

test("foliage type: edits of a type created this session are saved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  base.name = "__playwright-foliage-type-save";
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: base }));
  await page.route(`**/${foliageDataPath(LEVEL)}`, (route) => route.fulfill({ json: {
    schema: 1, type: "foliage", landscapeRules: [],
    groups: [{ id: "g", foliageTypeId: TYPE_ID, target: { kind: "staticMesh", id: "ground" },
      instances: [{ position: [0, 0, 3], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] }] }],
  } }));
  await page.route(`**/${TYPE_PATH}`, (route) => route.fulfill({ json: normalizeFoliageType({ name: "Existing", meshAssetId: "shape-cube" }) }));
  const saves: { path: string; foliageType: { sway?: unknown } }[] = [];
  const created: string[] = [];
  await page.route("**/__save-foliage-type", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
    // As the server: a new path is registered in the manifest.
    const fresh = payload.path !== TYPE_PATH && !created.includes(payload.path);
    if (fresh) created.push(payload.path);
    await route.fulfill({ json: { ok: true, path: payload.path, changed: true, registeredId: fresh ? NEW_ID : null } });
  });
  await page.route("**/assets/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    const cube = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
    manifest.assets.push({ ...cube, id: TYPE_ID, name: "Existing", assetType: "foliageType", path: TYPE_PATH, placeable: false });
    for (const path of created) manifest.assets.push({ ...cube, id: NEW_ID, name: "New", assetType: "foliageType", path, placeable: false });
    await route.fulfill({ response, json: manifest });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-inspector-tab="foliage"]').click();
  await expect(page.locator(".foliage-type-name").first()).toBeVisible({ timeout: 30_000 });
  // The mesh list is read when the tab renders: re-open it once the content has loaded.
  await expect.poll(async () => {
    await page.locator('[data-inspector-tab="details"]').click();
    await page.locator('[data-inspector-tab="foliage"]').click();
    return page.locator("[data-foliage-create]").isEnabled();
  }, { timeout: 30_000 }).toBe(true);

  await page.locator("[data-foliage-new-name]").fill("SessionType");
  await page.locator("[data-foliage-create]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  await page.locator(".foliage-type-name", { hasText: "SessionType" }).click();
  await page.locator("[data-foliage-type-sway-enabled]").check();

  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(2);
  expect(saves[1]!.path).toBe("assets/foliage/SessionType.foliagetype.json");
  expect(saves[1]!.foliageType.sway).toEqual(WIND_SWAY_DEFAULTS);
  expect(errors).toEqual([]);
});
