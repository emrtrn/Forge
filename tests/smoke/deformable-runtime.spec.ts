import { expect, test, type Page } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 7: in Play, driving the Reference Car into
 * a deformable panel dents that panel's own geometry; the panel beside it keeps
 * the shared model and the collider stays. Reads the `deform:` line of `?debug`.
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

/** The two panel clones: how far their vertices differ, and which one got its own geometry. */
async function panelState(page: Page): Promise<{ count: number; delta: number; owned: string[] }> {
  return page.evaluate(() => {
    interface Node {
      name?: string; isMesh?: boolean; parent?: { name?: string };
      geometry?: { userData: Record<string, unknown>; getAttribute(name: string): { count: number; array: ArrayLike<number> } };
    }
    const w = window as unknown as { __deformScenes: { traverse(visit: (object: unknown) => void): void }[] };
    const panels: Node[] = [];
    for (const scene of w.__deformScenes) {
      scene.traverse((node) => {
        const object = node as Node;
        if (object.isMesh && (object.parent?.name ?? "").startsWith("sm-dent-panel-clone-")) panels.push(object);
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
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatchObject({ objects: 2, dented: 0, dents: 0 });
  expect(await panelState(page)).toEqual({ count: 2, delta: 0, owned: [] });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readDeform(page))?.dents ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);
  const speedAtHit = await readVehicleKmh(page);
  await page.keyboard.up("KeyW");

  const line = (await readDeform(page))!;
  console.log(`[deform smoke] ${JSON.stringify(line)} at ${speedAtHit} km/h`);
  expect(line.dented).toBe(1);
  expect(line.missed).toBe(0);

  const state = await panelState(page);
  console.log(`[deform smoke] ${JSON.stringify(state)}`);
  // Only the panel that was hit left the shared model; panel 0 is the one on the car's line.
  expect(state.owned).toEqual(["sm-dent-panel-clone-0"]);
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
