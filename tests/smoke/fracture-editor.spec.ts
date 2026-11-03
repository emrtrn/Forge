import { expect, test } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 3: the Static Mesh Editor's Fracture
 * section adds a fracture to a model, bakes and previews the chunks (Explode,
 * hull wires), saves the parameters through `/__save-fracture` and reads them
 * back on reopen. The sidecar is served and the save answered in flight, so
 * nothing under `public/` is written; the server half of the endpoint is
 * covered by `tests/engine/fractureAsset.test.ts`.
 */

const SIDECAR = "assets/starter-content/StaticMeshes/Shapes/Shape_Cube.fracture.json";

test("fracture editor: add, bake, preview and save a fracture, then read it back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let stored: Record<string, unknown> | null = null;
  const saves: { path: string; fracture: Record<string, unknown> }[] = [];
  await page.route(`**/${SIDECAR}`, (route) =>
    stored ? route.fulfill({ json: stored }) : route.fulfill({ status: 404, body: "not found" }));
  await page.route("**/__save-fracture", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
    stored = payload.fracture;
    await route.fulfill({ json: { ok: true, path: payload.path, changed: true, dropped: [] } });
  });
  // The other sidecars the editor writes on Save: answer them without touching disk.
  for (const endpoint of ["__save-collision", "__save-material-slots", "__save-uvw", "__save-vertex-colors", "__save-layout"]) {
    await page.route(`**/${endpoint}**`, async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ json: { ok: true, path: payload.path ?? "x", changed: false, dropped: [] } });
    });
  }
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const openEditor = async () => {
    await page.locator("[data-content-toggle]").click();
    const drawer = page.locator("[data-content-drawer]");
    await drawer.locator('button.folder-row[title="assets/starter-content/StaticMeshes/Shapes"]').click();
    await drawer.getByRole("button", { name: /^Shape[ _]Cube/ }).first().dblclick();
    const editor = page.locator(".sm-editor-overlay");
    await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 20_000 });
    return editor;
  };

  let editor = await openEditor();
  const section = editor.locator("[data-sm-fracture]");
  await expect(section.locator("[data-sm-fracture-add]")).toBeVisible();

  // Add → a default fracture is baked straight away and previewed.
  await section.locator("[data-sm-fracture-add]").click();
  await expect(section.locator("[data-sm-fracture-stats]")).toContainText("12 parça");
  await expect(section.locator('[data-sm-fracture-warning="not-baked"]')).toHaveCount(0);
  await expect(section.locator('[data-sm-fracture-warning="not-convex"]')).toHaveCount(0);

  // Cell Count re-bakes; the slider row from paramFields exists for the bounded field.
  const cells = section.locator('[data-sm-fracture-num="cellCount"]');
  await expect(section.locator(".param-slider").first()).toBeVisible();
  await cells.fill("6");
  await cells.press("Tab");
  await expect(section.locator("[data-sm-fracture-stats]")).toContainText("6 parça");

  // Explode and hull wires only change the preview.
  const explode = section.locator("[data-sm-fracture-explode]");
  await explode.fill("0.8");
  await explode.press("Tab");
  await section.locator("[data-sm-fracture-hulls]").check();
  await expect(section.locator("[data-sm-fracture-hulls]")).toBeChecked();

  // Save writes the parameters plus the hash of the mesh that was baked.
  await editor.locator("[data-sm-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe(SIDECAR);
  expect(saves[0]!.fracture).toMatchObject({ version: 1, source: "voronoi", enabled: true, cellCount: 6 });
  expect(String(saves[0]!.fracture.sourceHash)).toMatch(/^fnv1a:[0-9a-f]{8}$/);

  // A second Save with no change writes nothing more.
  await editor.locator("[data-sm-save]").click();
  await page.waitForTimeout(1000);
  expect(saves.length).toBe(1);

  // Reopen: the sidecar reads back and the bake is current (no stale warning).
  await editor.locator("[data-sm-close]").click();
  await expect(editor).toHaveCount(0);
  editor = await openEditor();
  const reopened = editor.locator("[data-sm-fracture]");
  await expect(reopened.locator('[data-sm-fracture-num="cellCount"]')).toHaveValue("6");
  await expect(reopened.locator('[data-sm-fracture-warning="stale-bake"]')).toHaveCount(0);
  await expect(reopened.locator('[data-sm-fracture-warning="not-baked"]')).toHaveCount(0);

  expect(errors).toEqual([]);
});
