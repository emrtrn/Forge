import { expect, test } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 7: the Static Mesh Editor's Deformable
 * section adds a sidecar, tries it with Test Hit on the real dent code, saves the
 * parameters through `/__save-deformable` and reads them back on reopen. The
 * sidecar is served and the save answered in flight, so nothing under `public/`
 * is written; the server half is covered by `tests/engine/deformableAsset.test.ts`.
 */

const SIDECAR = "assets/starter-content/StaticMeshes/Destructible/SM_DentPanel.deformable.json";

test("deformable editor: add, tune, test hit and save a sidecar, then read it back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let stored: Record<string, unknown> | null = null;
  const saves: { path: string; deformable: Record<string, unknown> }[] = [];
  await page.route(`**/${SIDECAR}`, (route) =>
    stored ? route.fulfill({ json: stored }) : route.fulfill({ status: 404, body: "not found" }));
  await page.route("**/__save-deformable", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
    stored = payload.deformable;
    await route.fulfill({ json: { ok: true, path: payload.path, changed: true, dropped: [] } });
  });
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
    await drawer.locator('button.folder-row[title="assets/starter-content/StaticMeshes/Destructible"]').click();
    await drawer.getByRole("button", { name: /^Dent[ _]Panel/ }).first().dblclick();
    const editor = page.locator(".sm-editor-overlay");
    await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 20_000 });
    return editor;
  };

  let editor = await openEditor();
  const section = editor.locator("[data-sm-deformable]");
  await section.locator("[data-sm-deformable-add]").click();

  // The bounded fields get paramFields' slider; a value past the limit is pulled back.
  await expect(section.locator(".param-slider").first()).toBeVisible();
  const radius = section.locator('[data-sm-deformable-num="radius"]');
  await radius.fill("0.3");
  await radius.press("Tab");
  await expect(section.locator('[data-sm-deformable-num="radius"]')).toHaveValue("0.3");

  // Test Hit: a click on the model dents a preview through the runtime's own code.
  await expect(section.locator("[data-sm-deformable-stats]")).toHaveCount(0);
  await section.locator("[data-sm-deformable-hit]").click();
  await section.locator("[data-sm-deformable-hit]").scrollIntoViewIfNeeded();
  const viewport = await editor.locator("canvas").first().boundingBox();
  expect(viewport).toBeTruthy();
  await page.mouse.click(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
  await expect(section.locator("[data-sm-deformable-stats]")).toContainText(/1 göçük, son darbe \d+ vertex/);
  await expect(section.locator("[data-sm-deformable-reset]")).toBeEnabled();

  // The same spot deepens that dent instead of adding one.
  await page.mouse.click(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
  await expect(section.locator("[data-sm-deformable-stats]")).toContainText(/1 göçük/);

  await section.locator("[data-sm-deformable-reset]").click();
  await expect(section.locator("[data-sm-deformable-stats]")).toHaveCount(0);
  await expect(section.locator("[data-sm-deformable-reset]")).toBeDisabled();

  await editor.locator("[data-sm-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe(SIDECAR);
  expect(saves[0]!.deformable).toMatchObject({ version: 1, mode: "impact", enabled: true, radius: 0.3, collisionPolicy: "visual_only" });

  // A second Save with no change writes nothing more.
  await editor.locator("[data-sm-save]").click();
  await page.waitForTimeout(1000);
  expect(saves.length).toBe(1);

  await editor.locator("[data-sm-close]").click();
  await expect(editor).toHaveCount(0);
  editor = await openEditor();
  await expect(editor.locator('[data-sm-deformable-num="radius"]')).toHaveValue("0.3");
  expect(errors).toEqual([]);
});

test("deformable editor: the Actor Script Deformable form switches the car's dents", async ({ page }) => {
  // The save is answered in flight; its payload is checked.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saves: Array<{ path: string; actor: { components: Array<{ id: string; component: string; props: Record<string, unknown> }> } }> = [];
  await page.route("**/__save-actor", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
    await route.fulfill({ json: { ok: true, path: payload.path, changed: true } });
  });
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.locator('button.folder-row[title="assets/starter-content/Gameplay"]').click();
  await drawer.getByRole("button", { name: /Script Reference Car.Actor/ }).first().dblclick();
  const editor = page.locator(".as-editor-overlay");
  await expect(editor).toBeVisible({ timeout: 20_000 });

  await editor.locator('[data-as-node="dents"]').click();
  const details = editor.locator("[data-as-details]");
  await expect(details.locator("[data-as-deformable-enabled]")).toBeChecked();
  await details.locator("[data-as-deformable-enabled]").uncheck();
  await expect(details.locator("[data-as-deformable-enabled]")).not.toBeChecked();

  await editor.locator("[data-as-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe("assets/starter-content/Gameplay/Script_ReferenceCar.actor.json");
  const node = saves[0]!.actor.components.find((entry) => entry.id === "dents")!;
  expect(node.component).toBe("Deformable");
  expect(node.props).toEqual({ enabled: false });
  expect(errors).toEqual([]);
});
