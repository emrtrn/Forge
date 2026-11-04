import { expect, test, type Page } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 8 / vehicle damage contract VM-1: a car
 * T-bones a parked Gaz-52 on its left door. The door takes the dent; what sits
 * behind the door inside its radius (steering wheel, pedal) and the far door keep
 * the shared model. The grinding car may then slide along the truck and dent the
 * body behind the door, so the body is not asserted either way. Reads `?debug`
 * for the count and the scene for which meshes got their own geometry.
 */

const LEVEL = "layouts/PhysicsInteractionTest.level.json";

test.setTimeout(180_000);

/** Meshes of the Gaz-52 that left the shared model. */
async function dentedTruckMeshes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    interface Node { name?: string; isMesh?: boolean; geometry?: { userData: Record<string, unknown> } }
    const w = window as unknown as { __partScenes: { traverse(visit: (object: unknown) => void): void }[] };
    const names = new Set<string>();
    for (const scene of w.__partScenes) {
      scene.traverse((node) => {
        const object = node as Node;
        if (object.isMesh && /Gaz-52_0$/.test(object.name ?? "") && object.geometry?.userData.forgeDeformClone === true) names.add(object.name!);
      });
    }
    return [...names].sort();
  });
}

test("deformable parts: a side hit dents the door and leaves the rest of the truck alone", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __partScenes: unknown[] };
    w.__partScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean };
      if (object?.isScene) w.__partScenes.push(object);
    });
  });
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.instances = level.instances.filter((group: { assetId: string }) => !["sm-breakable-crate", "sm-dent-panel"].includes(group.assetId));
    const car = level.actors[0];
    // Turned a quarter: the truck's left side (+X) faces the car, which drives +Z.
    level.actors = [car, {
      classRef: "assets/vehicles/gaz52/Script_Gaz52.actor.json",
      name: "Parked Gaz-52",
      position: [0.06, 0, 14],
      rotation: [0, 90, 0],
    }];
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });

  await page.goto(`/?debug&partSmoke=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText(/deform: objects 2 dented 0 dents 0/, { timeout: 30_000 });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(() => dentedTruckMeshes(page), { timeout: 40_000 }).not.toEqual([]);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(1000);

  const dented = await dentedTruckMeshes(page);
  console.log(`[parts smoke] ${JSON.stringify(dented)}`);
  expect(dented).toContain("Door_L_Gaz-52_0");
  for (const untouched of ["Door_R_Gaz-52_0", "steering_wheel_Gaz-52_0", "Stop_Gaz-52_0", "Mirror_R_Gaz-52_0"]) {
    expect(dented).not.toContain(untouched);
  }
  expect(messages.filter((message) => message.includes("parts with no matching mesh"))).toEqual([]);
  expect(errors).toEqual([]);
});
