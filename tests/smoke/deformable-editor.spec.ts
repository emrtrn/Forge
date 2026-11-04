import { expect, test } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 7: the Static Mesh Editor's Deformable
 * section adds a sidecar, tries it with Test Hit on the real dent code, saves the
 * parameters through `/__save-deformable` and reads them back on reopen. The
 * sidecar is served and the save answered in flight, so nothing under `public/`
 * is written; the server half is covered by `tests/engine/deformableAsset.test.ts`.
 */

const SIDECAR = "assets/starter-content/StaticMeshes/Destructible/SM_DentPanel.deformable.json";
const GAZ_ASSET = /^gaz[ _-]52/i;

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

test("deformable editor: parts are added from the model, tuned, saved and read back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sidecar = "assets/vehicles/gaz52/gaz-52_base.deformable.json";
  let stored: Record<string, unknown> = { version: 1, enabled: true, mode: "impact", dentImpulse: 200, fullImpulse: 1500, radius: 0.5, maxDepth: 0.3, plasticity: 0.5, maxDents: 32, collisionPolicy: "visual_only" };
  const saves: { deformable: Record<string, unknown> }[] = [];
  await page.route(`**/${sidecar}*`, (route) => route.fulfill({ json: stored }));
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
    await drawer.locator('button.folder-row[title="assets/vehicles/gaz52"]').click();
    await drawer.getByRole("button", { name: GAZ_ASSET }).first().dblclick();
    const editor = page.locator(".sm-editor-overlay");
    await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 30_000 });
    return editor;
  };

  let editor = await openEditor();
  const section = editor.locator("[data-sm-deformable]");
  const parts = section.locator("[data-sm-deformable-parts]");
  await expect(parts).toHaveAttribute("data-zones", "0");

  // A node from the list: the zone comes from the node, out to the model's side.
  await section.locator("[data-sm-deformable-part-node]").selectOption("Door_L");
  await section.locator("[data-sm-deformable-part-add]").click();
  await expect(parts).toHaveAttribute("data-zones", "1");
  const zone = async (corner: "min" | "max", axis: number): Promise<number> =>
    Number(await section.locator(`[data-sm-part-zone="door_left"][data-corner="${corner}"][data-axis="${axis}"]`).inputValue());
  await section.locator('[data-sm-part-id="door_l"]').fill("door_left");
  await section.locator('[data-sm-part-id="door_l"]').press("Tab");
  await expect(section.locator('[data-sm-part="door_left"]')).toBeVisible();
  expect(await zone("min", 0)).toBeCloseTo(0.72, 1);
  expect(await zone("max", 0)).toBeGreaterThan(1.19);
  expect(await zone("min", 2)).toBeCloseTo(-0.62, 1);

  // The list stops offering a node that is taken.
  await expect(section.locator('[data-sm-deformable-part-node] option[value="Door_L"]')).toHaveCount(0);

  // A taken or empty id is refused, the part keeps its name.
  await section.locator("[data-sm-deformable-part-node]").selectOption("Mirror_L");
  await section.locator("[data-sm-deformable-part-add]").click();
  await expect(parts).toHaveAttribute("data-zones", "2");
  await section.locator('[data-sm-part-id="mirror_l"]').fill("door_left");
  await section.locator('[data-sm-part-id="mirror_l"]').press("Tab");
  await expect(editor.locator("[data-sm-status]")).toContainText("zaten var");
  await expect(section.locator('[data-sm-part="mirror_l"]')).toBeVisible();

  // A corner cannot cross the other one, or the normalizer would drop the part.
  const low = section.locator('[data-sm-part-zone="mirror_l"][data-corner="min"][data-axis="1"]');
  await low.fill("9");
  await low.press("Tab");
  await expect(parts).toHaveAttribute("data-zones", "2");
  await section.locator('[data-sm-part-fit="mirror_l"]').click();
  await section.locator('[data-sm-part-remove="mirror_l"]').click();
  await expect(parts).toHaveAttribute("data-zones", "1");

  // One part is open at a time: its row opens it, the others stay a single line.
  await expect(section.locator('[data-sm-part-detach-on="door_left"]')).toHaveCount(0);
  await section.locator('[data-sm-part-open="door_left"]').click();
  await section.locator('[data-sm-part-detach-on="door_left"]').check();
  const impulse = section.locator('[data-sm-part-detach="door_left"][data-key="impulse"]');
  await impulse.fill("4000");
  await impulse.press("Tab");
  await expect(section.locator('[data-sm-part-detach="door_left"][data-key="impulse"]')).toHaveValue("4000");

  // A click on the model adds what is under it, and the mode ends with that click.
  const viewport = await editor.locator("canvas").first().boundingBox();
  await section.locator("[data-sm-deformable-part-pick]").click();
  await expect(section.locator("[data-sm-deformable-part-pick]")).toHaveClass(/is-active/);
  await page.mouse.click(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
  await expect(parts).toHaveAttribute("data-zones", "2");
  await expect(section.locator("[data-sm-deformable-part-pick]")).not.toHaveClass(/is-active/);
  await section.locator("[data-sm-part-remove]").click();

  await editor.locator("[data-sm-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  const saved = saves[0]!.deformable.parts as { id: string; nodes: string[]; detach: Record<string, number> }[];
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: "door_left", nodes: ["Door_L"], detach: { impulse: 4000, massKg: 20, kick: 1 } });

  await editor.locator("[data-sm-close]").click();
  await expect(editor).toHaveCount(0);
  editor = await openEditor();
  await editor.locator('[data-sm-part-open="door_left"]').click();
  await expect(editor.locator('[data-sm-part-detach="door_left"][data-key="impulse"]')).toHaveValue("4000");
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
