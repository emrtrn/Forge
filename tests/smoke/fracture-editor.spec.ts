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

test("fracture editor: the Actor Script Fracturable form writes its override", async ({ page }) => {
  // Faz 4b-2: the Fracturable component carries the actor's override on its
  // mesh's sidecar. The save is answered in flight; its payload is checked.
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
  await drawer.getByRole("button", { name: /Script Breakable Crate.Actor/ }).first().dblclick();
  const editor = page.locator(".as-editor-overlay");
  await expect(editor).toBeVisible({ timeout: 20_000 });

  await editor.locator('[data-as-node="fracturable"]').click();
  const details = editor.locator("[data-as-details]");
  const breakable = details.locator("[data-as-fracturable-enabled]");
  const impulse = details.locator("[data-as-fracturable-impulse]");
  await expect(breakable).toBeChecked();
  await expect(impulse).toHaveValue("300");
  await breakable.uncheck();
  await details.locator("[data-as-fracturable-impulse]").fill("");
  await details.locator("[data-as-fracturable-impulse]").press("Tab");
  await expect(details.locator("[data-as-fracturable-impulse]")).toHaveValue("");

  await editor.locator("[data-as-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe("assets/starter-content/Gameplay/Script_BreakableCrate.actor.json");
  const node = saves[0]!.actor.components.find((entry) => entry.id === "fracturable")!;
  expect(node.component).toBe("Fracturable");
  expect(node.props).toEqual({ enabled: false });
  expect(errors).toEqual([]);
});

test("fracture editor: the splinter pattern shows grain fields, re-bakes and saves", async ({ page }) => {
  // Wood splinters: the breakable crate's sidecar uses `pattern: "splinter"`.
  // Switching pattern / axis / stretch re-bakes the preview; Save carries them.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saves: { path: string; fracture: Record<string, unknown> }[] = [];
  await page.route("**/__save-fracture", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
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
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.locator('button.folder-row[title="assets/starter-content/StaticMeshes/Destructible"]').click();
  await drawer.getByRole("button", { name: /^Breakable Crate Static Mesh/ }).first().dblclick();
  const editor = page.locator(".sm-editor-overlay");
  await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 20_000 });
  const section = editor.locator("[data-sm-fracture]");

  await expect(section.locator("[data-sm-fracture-pattern]")).toHaveValue("splinter");
  await expect(section.locator("[data-sm-fracture-grain-axis]")).toHaveValue("y");
  await expect(section.locator('[data-sm-fracture-num="grainStretch"]')).toHaveValue("6");
  await section.locator("[data-sm-fracture-bake]").click();
  await expect(section.locator("[data-sm-fracture-stats]")).toContainText("parça");

  // Uniform hides the grain fields; Splinter brings them back.
  await section.locator("[data-sm-fracture-pattern]").selectOption("uniform");
  await expect(section.locator("[data-sm-fracture-grain-axis]")).toHaveCount(0);
  await expect(section.locator('[data-sm-fracture-num="grainStretch"]')).toHaveCount(0);
  await section.locator("[data-sm-fracture-pattern]").selectOption("splinter");
  await section.locator("[data-sm-fracture-grain-axis]").selectOption("x");
  const stretch = section.locator('[data-sm-fracture-num="grainStretch"]');
  await stretch.fill("10");
  await stretch.press("Tab");
  await expect(section.locator('[data-sm-fracture-num="grainStretch"]')).toHaveValue("10");
  await expect(section.locator("[data-sm-fracture-stats]")).toContainText("parça");

  // Faz 4b-3: break presentation pickers read the sidecar and write manifest ids.
  await expect(section.locator('[data-sm-fracture-asset="breakEffect"]')).toHaveValue("starter-fx-dust-hit");
  await expect(section.locator('[data-sm-fracture-asset="breakSound"]')).toHaveValue("starter-snd-impact-light");
  await section.locator('[data-sm-fracture-asset="breakEffect"]').selectOption("starter-fx-smoke-puff");
  await section.locator('[data-sm-fracture-asset="crumbleEffect"]').selectOption("");
  const separation = section.locator('[data-sm-fracture-num="maxSeparation"]');
  await separation.fill("12");
  await separation.press("Tab");

  await editor.locator("[data-sm-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe("assets/starter-content/StaticMeshes/Destructible/SM_BreakableCrate.fracture.json");
  expect(saves[0]!.fracture).toMatchObject({
    pattern: "splinter", grainAxis: "x", grainStretch: 10,
    breakEffect: "starter-fx-smoke-puff", breakSound: "starter-snd-impact-light", crumbleEffect: null, maxSeparation: 12,
  });
  expect(errors).toEqual([]);
});

test("fracture editor: the Support section anchors the bottom, simulates a hit and saves the support block", async ({ page }) => {
  // Faz 4c-4: the breakable wall is `anchored` with World Support only. The
  // editor cannot evaluate World Support (no ground here), so a box anchor is
  // what holds in the preview; Simulate Hit marks what a hit would drop.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saves: { path: string; fracture: Record<string, unknown> }[] = [];
  await page.route("**/__save-fracture", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    saves.push(payload);
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
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.locator('button.folder-row[title="assets/starter-content/StaticMeshes/Destructible"]').click();
  await drawer.getByRole("button", { name: /^Breakable Wall Static Mesh/ }).first().dblclick();
  const editor = page.locator(".sm-editor-overlay");
  await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 20_000 });
  const support = editor.locator("[data-sm-fracture-support]");

  // None hides every other support field; Anchored brings them back.
  await expect(support.locator("[data-sm-fracture-support-mode]")).toHaveValue("anchored");
  await support.locator("[data-sm-fracture-support-mode]").selectOption("none");
  await expect(support.locator("[data-sm-fracture-world-support]")).toHaveCount(0);
  await support.locator("[data-sm-fracture-support-mode]").selectOption("anchored");
  await expect(support.locator("[data-sm-fracture-world-support]")).toBeChecked();
  await expect(support.locator(".param-slider").first()).toBeVisible();

  await editor.locator("[data-sm-fracture-bake]").click();
  const stats = support.locator("[data-sm-fracture-support-stats]");
  await expect(stats).toHaveAttribute("data-anchored", "0");
  await support.locator("[data-sm-fracture-anchor-bottom]").click();
  await expect(support.locator("[data-sm-fracture-anchor-row]")).toHaveCount(1);
  const anchoredCount = Number(await stats.getAttribute("data-anchored"));
  expect(anchoredCount).toBeGreaterThan(0);
  await support.locator("[data-sm-fracture-links]").check();

  // A hit in the middle drops the radius plus whatever lost its path to the bottom.
  // The wall mesh is a unit block scaled by its placement: keep the radius small.
  const smallRadius = support.locator('[data-sm-fracture-support-num="damageRadius"]');
  await smallRadius.fill("0.2");
  await smallRadius.press("Tab");
  const hitImpulse = support.locator("[data-sm-fracture-hit-impulse]");
  await hitImpulse.fill("0");
  await hitImpulse.press("Tab");
  await support.locator("[data-sm-fracture-hit-center]").click();
  const sim = support.locator("[data-sm-fracture-sim]");
  await expect(sim).toContainText("1 vuruş");
  const released = Number(await sim.getAttribute("data-released"));
  const collapsed = Number(await sim.getAttribute("data-collapsed"));
  const standing = Number(await sim.getAttribute("data-standing"));
  expect(released).toBeGreaterThan(0);
  expect(standing).toBeGreaterThanOrEqual(anchoredCount);
  expect(released + collapsed + standing).toBe(24);
  await support.locator("[data-sm-fracture-sim-reset]").click();
  await expect(support.locator("[data-sm-fracture-sim]")).toHaveAttribute("data-standing", "24");

  // Armed, a viewport click on a chunk hits there.
  await support.locator("[data-sm-fracture-simulate]").click();
  await expect(support.locator("[data-sm-fracture-simulate]")).toHaveAttribute("aria-pressed", "true");
  const box = (await editor.locator("canvas").first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(support.locator("[data-sm-fracture-sim]")).toContainText("1 vuruş");
  expect(Number(await support.locator("[data-sm-fracture-sim]").getAttribute("data-released"))).toBeGreaterThan(0);
  await support.locator("[data-sm-fracture-simulate]").click();

  // Simulate Hit is preview only; the edited support block is what Save writes.
  const radius = support.locator('[data-sm-fracture-support-num="damageRadius"]');
  await radius.fill("1.2");
  await radius.press("Tab");
  await editor.locator("[data-sm-save]").click();
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1);
  expect(saves[0]!.path).toBe("assets/starter-content/StaticMeshes/Destructible/SM_BreakableWall.fracture.json");
  const saved = saves[0]!.fracture.support as { mode: string; worldSupport: boolean; damageRadius: number; anchors: { min: number[]; max: number[] }[] };
  expect(saved).toMatchObject({ mode: "anchored", worldSupport: true, damageRadius: 1.2 });
  expect(saved.anchors).toHaveLength(1);
  expect(saved.anchors[0]!.max[1]!).toBeGreaterThan(saved.anchors[0]!.min[1]!);
  expect(errors).toEqual([]);
});
