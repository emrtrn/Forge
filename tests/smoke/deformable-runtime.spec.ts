import { expect, test, type Page } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 7: in Play, driving the Reference Car into
 * a deformable panel dents that panel's own geometry and the car's body; the panel
 * beside it and the wheels keep the shared model, and the collider stays. Reads the `deform:` line of `?debug`.
 */

const LEVEL = "layouts/PhysicsInteractionTest.level.json";

test.setTimeout(180_000);

interface DeformLine { objects: number; dented: number; dents: number; missed: number; skipped: number; lastMs: number }

async function readDeform(page: Page): Promise<DeformLine | null> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/deform: objects (\d+) dented (\d+) dents (\d+) missed (\d+) skipped (\d+) last ([\d.]+) ms/);
  return match ? {
    objects: Number(match[1]), dented: Number(match[2]), dents: Number(match[3]),
    missed: Number(match[4]), skipped: Number(match[5]), lastMs: Number(match[6]),
  } : null;
}

async function readVehicleKmh(page: Page): Promise<number> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:\S+ speed:(-?\d+)km\/h/);
  return match ? Math.abs(Number(match[1])) : -1;
}

/** The two panel clones: how far their vertices differ, and which got their own geometry; same for the car's meshes. */
async function panelState(page: Page): Promise<{ count: number; delta: number; owned: string[]; car: string[] }> {
  return page.evaluate(() => {
    interface Node {
      name?: string; isMesh?: boolean; parent?: { name?: string };
      geometry?: { userData: Record<string, unknown>; getAttribute(name: string): { count: number; array: ArrayLike<number> } };
    }
    const w = window as unknown as { __deformScenes: { traverse(visit: (object: unknown) => void): void }[] };
    const panels: Node[] = [];
    const car: string[] = [];
    for (const scene of w.__deformScenes) {
      scene.traverse((node) => {
        const object = node as Node;
        if (object.isMesh && (object.parent?.name ?? "").startsWith("sm-dent-panel-clone-")) panels.push(object);
        if (object.isMesh && /^(body|cabin|wheel-)/.test(object.name ?? "") && object.geometry!.userData.forgeDeformClone === true) car.push(object.name!);
      });
    }
    let delta = 0;
    if (panels.length === 2) {
      const a = panels[0]!.geometry!.getAttribute("position").array;
      const b = panels[1]!.geometry!.getAttribute("position").array;
      for (let index = 0; index < a.length; index += 1) delta = Math.max(delta, Math.abs(a[index]! - b[index]!));
    }
    return {
      count: panels.length,
      delta,
      owned: panels.filter((panel) => panel.geometry!.userData.forgeDeformClone === true).map((panel) => panel.parent!.name!),
      car: car.sort(),
    };
  });
}

test("deformable runtime: driving into a panel dents that panel, the car stays stopped by its collider", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __deformScenes: unknown[] };
    w.__deformScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean };
      if (object?.isScene) w.__deformScenes.push(object);
    });
  });
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    // The car drives +Z: clear its line and stand panel 0 on it, panel 1 beside it.
    level.instances = level.instances.filter((group: { assetId: string }) => group.assetId !== "sm-breakable-crate");
    const panels = level.instances.find((group: { assetId: string }) => group.assetId === "sm-dent-panel");
    panels.placements[0].position = [0, 0, 16];
    panels.placements[0].scale = [4, 2.5, 0.08];
    panels.placements[1].position = [6, 0, 16];
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });

  await page.goto(`/?debug&deformSmoke=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatchObject({ objects: 3, dented: 0, dents: 0 });
  expect(await panelState(page)).toEqual({ count: 2, delta: 0, owned: [], car: [] });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readDeform(page))?.dented ?? 0, { timeout: 25_000 }).toBe(2);
  const speedAtHit = await readVehicleKmh(page);
  await page.keyboard.up("KeyW");

  const line = (await readDeform(page))!;
  console.log(`[deform smoke] ${JSON.stringify(line)} at ${speedAtHit} km/h`);
  // Some collider contacts miss the visible mesh. Both struck objects must
  // actually dent; inspect their geometry below rather than comparing contact counts.
  expect(line.dents).toBeGreaterThanOrEqual(2);

  const state = await panelState(page);
  console.log(`[deform smoke] ${JSON.stringify(state)}`);
  // Only the panel that was hit left the shared model; panel 0 is the one on the car's line.
  expect(state.owned).toEqual(["sm-dent-panel-clone-0"]);
  // The car dents too; wheels spin, they never leave the shared model.
  expect(state.car).toContain("body");
  expect(state.car.filter((name) => name.startsWith("wheel-"))).toEqual([]);
  // The panel is scaled 0.08 on Z, so the 0.25 m maxDepth is 3.125 local units.
  expect(state.delta).toBeGreaterThan(0.5);
  expect(state.delta).toBeLessThanOrEqual(3.13);

  // visual_only: the panel still stops the car.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  await page.keyboard.up("KeyW");
  expect(await readVehicleKmh(page)).toBeLessThan(15);
  expect(errors).toEqual([]);
});

test("deformable runtime: a quick-save keeps the dents and a load brings the same shape back", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __deformScenes: unknown[] };
    w.__deformScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean };
      if (object?.isScene) w.__deformScenes.push(object);
    });
  });
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.instances = level.instances.filter((group: { assetId: string }) => group.assetId !== "sm-breakable-crate");
    const panels = level.instances.find((group: { assetId: string }) => group.assetId === "sm-dent-panel");
    panels.placements[0].position = [0, 0, 16];
    panels.placements[0].scale = [4, 2.5, 0.08];
    panels.placements[1].position = [6, 0, 16];
    level.worldSettings = { ...level.worldSettings, pauseMenuWidget: "menu" };
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.goto(`/?debug&deformSave=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText('save.slots.quick.status = "Empty"', { timeout: 30_000 });
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatchObject({ objects: 3, dents: 0 });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readDeform(page))?.dented ?? 0, { timeout: 25_000 }).toBe(2);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(1500);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 10_000 });
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("forge.saveGame.") && entry.endsWith(".slot.quick"));
    return key ? JSON.parse(localStorage.getItem(key)!).payload.deformables as { entityId: string; dents: unknown[] }[] : null;
  });
  console.log(`[deform smoke] saved ${JSON.stringify(saved?.map((entry) => [entry.entityId, entry.dents.length]))}`);
  expect(saved).toHaveLength(2);
  // Read here, in the pause menu: the car may touch the panel again until then.
  const dentCount = saved!.reduce((sum, entry) => sum + entry.dents.length, 0);
  const shape = (await panelState(page)).delta;

  await page.locator('[data-ui-id="quick-load"]').click();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  await expect.poll(async () => (await readDeform(page))?.dents ?? 0, { timeout: 30_000 }).toBe(dentCount);
  await expect.poll(async () => (await panelState(page)).owned, { timeout: 30_000 }).toEqual(["sm-dent-panel-clone-0"]);
  const after = await panelState(page);
  console.log(`[deform smoke] shape ${shape} -> ${after.delta}`);
  expect(Math.abs(after.delta - shape)).toBeLessThan(1e-3);
  expect(after.car).toContain("body");
  expect(errors).toEqual([]);
});
