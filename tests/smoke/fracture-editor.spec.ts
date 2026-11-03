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

test("fracture editor: a placement's Details override opts out and moves the break impulse", async ({ page }) => {
  // Plan §4 / K-04: the asset sidecar decides, a placement may opt out or set
  // its own threshold. The test level is served in flight and the layout save
  // answered in flight, so the request payload is what is checked.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const LEVEL = "layouts/__playwright-fracture-override.level.json";
  const level = await (await page.request.get("/layouts/PhysicsInteractionTest.level.json")).json();
  level.name = "__playwright-fracture-override";
  for (const group of level.instances) {
    group.placements.forEach((placement: { name?: string }, index: number) => {
      placement.name = `${group.assetId} ${index}`;
    });
  }
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  const layoutSaves: Array<{ layout?: { instances?: Array<{ assetId: string; placements: Array<Record<string, unknown>> }> } }> = [];
  await page.route("**/__save-layout**", async (route) => {
    layoutSaves.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ json: { ok: true, changed: true, dropped: [] } });
  });
  await page.route("**/__save-world-cells**", (route) => route.fulfill({ json: { ok: true, dropped: [] } }));
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const details = page.locator('[data-inspector-pane="details"]');
  // A non-fracturable mesh shows no Fracture section.
  await page.getByTestId("outliner-row").filter({ hasText: "marker:playerStart 0" }).first().click();
  await expect(details.locator("[data-detail-section=\"transform\"]")).toBeVisible();
  await expect(details.locator("[data-detail-section=\"fracture\"]")).toHaveCount(0);

  await page.getByTestId("outliner-row").filter({ hasText: "sm-breakable-panel 1" }).first().click();
  const section = details.locator("[data-detail-section=\"fracture\"]");
  await expect(section).toBeVisible({ timeout: 15_000 });
  const breakable = section.locator("[data-fracture-enabled]");
  const impulse = section.locator("[data-fracture-break-impulse]");
  await expect(breakable).toBeChecked();
  await expect(impulse).toHaveValue("");
  await expect(impulse).toHaveAttribute("placeholder", /^Asset \(\d+(\.\d+)?\)$/);

  await breakable.uncheck();
  await expect(section.locator("[data-fracture-enabled]")).not.toBeChecked();
  await section.locator("[data-fracture-break-impulse]").fill("250");
  await section.locator("[data-fracture-break-impulse]").press("Tab");
  await expect(section.locator("[data-fracture-break-impulse]")).toHaveValue("250");

  // Undo restores the impulse, redo brings it back.
  await page.keyboard.press("Control+z");
  await expect(section.locator("[data-fracture-break-impulse]")).toHaveValue("");
  await page.keyboard.press("Control+y");
  await expect(section.locator("[data-fracture-break-impulse]")).toHaveValue("250");

  await page.getByTestId("editor-save").click();
  await expect.poll(() => layoutSaves.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const saved = layoutSaves.at(-1)!.layout!.instances!.find((group) => group.assetId === "sm-breakable-panel")!;
  expect(saved.placements[1]!.fracture).toEqual({ enabled: false, breakImpulse: 250 });
  expect(saved.placements[0]!.fracture).toBeUndefined();
  expect(errors).toEqual([]);
});
