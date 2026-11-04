import { expect, test, type Page, type Route } from "./test";

/**
 * Faz 8 / vehicle damage contract VM-1 to VM-3, on the Gaz-52. A car T-bones the
 * parked truck on its left door, the truck drives on after losing a door, and a
 * save keeps the loss while a load from before the crash undoes it.
 * Reads `?debug` for the counts and the scene for what happened to the meshes.
 */

const LEVEL = "layouts/PhysicsInteractionTest.level.json";
const TRUCK = "assets/vehicles/gaz52/Script_Gaz52.actor.json";
const SIDECAR = "**/gaz-52_base.deformable.json*";

test.setTimeout(180_000);

interface DeformablePart { id: string; detach?: unknown; zone: unknown }

/** Scene state of the truck's meshes. */
async function truckState(page: Page): Promise<{
  dented: string[];
  /** Meshes under a torn-off piece, by the piece's name. */
  loose: Record<string, string[]>;
  /** World position of each torn-off piece. */
  pieces: Record<string, number[]>;
  /** Left doors in the scene that sit on the truck, not on a piece. */
  doorsOnTruck: number;
  /** World x of each of them: which truck still has its door. */
  doorX: number[];
}> {
  return page.evaluate(() => {
    interface Node {
      name?: string; isMesh?: boolean; parent?: Node | null;
      geometry?: { userData: Record<string, unknown> };
      matrixWorld: { elements: number[] };
    }
    const w = window as unknown as { __partScenes: { traverse(visit: (object: unknown) => void): void }[] };
    const dented = new Set<string>();
    const loose: Record<string, string[]> = {};
    const pieces: Record<string, number[]> = {};
    const onTruck = new Set<Node>();
    for (const scene of w.__partScenes) {
      scene.traverse((item) => {
        const node = item as Node;
        if (node.name?.startsWith("detached-")) {
          const { elements } = node.matrixWorld;
          pieces[node.name] = [elements[12]!, elements[13]!, elements[14]!];
        }
        if (!node.isMesh || !/Gaz-52_0$/.test(node.name ?? "")) return;
        if (node.geometry?.userData.forgeDeformClone === true) dented.add(node.name!);
        let isLoose = false;
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (!parent.name?.startsWith("detached-")) continue;
          (loose[parent.name] ??= []).push(node.name!);
          isLoose = true;
        }
        if (!isLoose && node.name === "Door_L_Gaz-52_0") onTruck.add(node);
      });
    }
    return {
      dented: [...dented].sort(), loose, pieces, doorsOnTruck: onTruck.size,
      doorX: [...onTruck].map((node) => node.matrixWorld.elements[12]!),
    };
  });
}

async function readDeform(page: Page): Promise<string> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  return text.match(/deform: .*?ms(?: detached \d+)?/)?.[0] ?? "";
}

async function readVehicleKmh(page: Page): Promise<number> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:\S+ speed:(-?\d+)km\/h/);
  return match ? Math.abs(Number(match[1])) : -1;
}

/** Routes the level and the project, then opens Play; returns the errors seen so far and later, and how to open it again. */
async function play(page: Page, editLevel: (level: Record<string, unknown[]>) => void): Promise<{
  errors: string[]; messages: string[]; open: () => Promise<void>;
}> {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    // Once per test: a page opened again must still find the save.
    if (!sessionStorage.getItem("partSmoke")) localStorage.clear();
    sessionStorage.setItem("partSmoke", "1");
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
    editLevel(level);
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  const open = async (): Promise<void> => {
    messages.length = 0;
    await page.goto(`/?debug&partSmoke=${Date.now()}`);
    await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  };
  await open();
  return { errors, messages, open };
}

/** The car stays pawn; the truck stands a quarter turned, so its left side (+X) faces the car driving +Z. */
const parkTruckBroadside = (level: Record<string, unknown[]>): void => {
  level.actors = [level.actors![0], { classRef: TRUCK, name: "Parked Gaz-52", position: [0.06, 0, 14], rotation: [0, 90, 0] }];
};

async function editSidecar(route: Route, edit: (parts: DeformablePart[]) => DeformablePart[]): Promise<void> {
  const response = await route.fetch();
  const sidecar = await response.json();
  sidecar.parts = edit(sidecar.parts);
  await route.fulfill({ response, json: sidecar });
}

test("deformable parts: a side hit dents the door and leaves the rest of the truck alone", async ({ page }) => {
  await page.route(SIDECAR, (route) => editSidecar(route, (parts) => parts.map(({ detach: _detach, ...part }) => part)));
  const { errors, messages } = await play(page, parkTruckBroadside);
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatch(/objects 2 dented 0 dents 0/);

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await truckState(page)).dented, { timeout: 40_000 }).not.toEqual([]);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(1000);

  const { dented, loose } = await truckState(page);
  console.log(`[parts smoke] ${JSON.stringify(dented)}`);
  expect(dented).toContain("Door_L_Gaz-52_0");
  // What sits behind the door inside the dent's radius. The grinding car may slide
  // along the truck and dent the body further back, so the body is not asserted.
  for (const untouched of ["Door_R_Gaz-52_0", "steering_wheel_Gaz-52_0", "Stop_Gaz-52_0", "Mirror_R_Gaz-52_0"]) {
    expect(dented).not.toContain(untouched);
  }
  expect(loose).toEqual({});
  expect(messages.filter((message) => message.includes("parts with no matching mesh"))).toEqual([]);
  expect(errors).toEqual([]);
});

test("deformable parts: a hard side hit tears the dented door off, once, and it comes to rest", async ({ page }) => {
  const { errors } = await play(page, parkTruckBroadside);
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatch(/objects 2 dented 0 dents 0/);

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(() => readDeform(page), { timeout: 40_000 }).toMatch(/detached 1/);
  await page.keyboard.up("KeyW");

  const torn = await truckState(page);
  console.log(`[parts smoke] torn ${JSON.stringify(torn.pieces)}`);
  expect(torn.loose).toEqual({ "detached-door_left": ["Door_L_Gaz-52_0"] });
  expect(torn.dented, "the door left with its dent, not as a clean copy").toContain("Door_L_Gaz-52_0");

  await page.waitForTimeout(4000);
  const settled = await truckState(page);
  console.log(`[parts smoke] settled ${JSON.stringify(settled.pieces)}`);
  expect(Object.keys(settled.pieces)).toEqual(["detached-door_left"]);
  const [x, y, z] = settled.pieces["detached-door_left"]!;
  // A door 1.5 m tall rests below its 1.7 m starting height, and nothing flung it away.
  expect(y!).toBeLessThan(1.2);
  expect(y!).toBeGreaterThan(-0.2);
  expect(Math.hypot(x! - 0, z! - 14)).toBeLessThan(12);
  expect(await readDeform(page)).toMatch(/detached 1/);
  expect(errors).toEqual([]);
});

test("deformable parts: a truck that lost a door still drives", async ({ page }) => {
  // Any front hit counts for the door here: straight driving cannot reach its side.
  await page.route(SIDECAR, (route) => editSidecar(route, (parts) => parts.map((part) => (
    part.id === "door_left" ? { ...part, zone: { min: [-2, 0, -6], max: [2, 3, 3] } } : part
  ))));
  const { errors } = await play(page, (level) => {
    const floor = level.blockingVolumes![0] as Record<string, unknown>;
    level.actors = [{ classRef: TRUCK, name: "Driven Gaz-52", position: [0, 0, 0], rotation: [0, 0, 0] }];
    level.blockingVolumes!.push({ ...floor, id: "smoke-wall", name: "Smoke Wall", position: [0, 2, 12], size: [8, 4, 1] });
  });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(() => readDeform(page), { timeout: 40_000 }).toMatch(/detached 1/);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);

  await page.keyboard.down("KeyS");
  await expect.poll(() => readVehicleKmh(page), { timeout: 20_000 }).toBeGreaterThan(3);
  await page.keyboard.up("KeyS");
  expect(await readDeform(page)).toMatch(/detached 1/);
  expect(errors).toEqual([]);
});

test("deformable parts: a save keeps the door off, a load from before the crash puts it back", async ({ page }) => {
  const { errors } = await play(page, (level) => {
    parkTruckBroadside(level);
    (level as unknown as { worldSettings: Record<string, unknown> }).worldSettings.pauseMenuWidget = "menu";
  });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText('save.slots.quick.status = "Empty"', { timeout: 30_000 });
  await expect.poll(() => readDeform(page), { timeout: 30_000 }).toMatch(/objects 2 dented 0 dents 0/);

  // Input is read per frame: at 10 fps a key tap needs to last a frame.
  const menu = page.locator('[data-ui-id="title"]');
  const openMenu = async (): Promise<void> => {
    await page.keyboard.press("Escape", { delay: 150 });
    await expect(menu).toContainText("Save / Load");
  };
  const closeMenu = async (): Promise<void> => {
    if (await menu.isVisible()) await page.keyboard.press("Escape", { delay: 150 });
    await expect(menu).toBeHidden();
  };
  const quickSave = async (): Promise<void> => {
    await page.locator('[data-ui-id="quick-save"]').click();
    await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 10_000 });
  };
  const quickLoad = async (): Promise<void> => {
    await page.locator('[data-ui-id="quick-load"]').click();
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  };
  const crash = async (): Promise<void> => {
    await page.locator("#game-canvas").click();
    await page.keyboard.down("KeyW");
    await expect.poll(() => readDeform(page), { timeout: 40_000 }).toMatch(/detached 1/);
    await page.keyboard.up("KeyW");
  };
  const savedEntries = (): Promise<{ entityId: string; detachedParts?: string[]; assetId?: string }[] | null> => page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("forge.saveGame.") && entry.endsWith(".slot.quick"));
    return key ? JSON.parse(localStorage.getItem(key)!).payload.deformables : null;
  });

  // Saved with the door on, then lost: the load undoes the crash.
  await openMenu();
  await quickSave();
  await closeMenu();
  await crash();
  expect((await truckState(page)).doorsOnTruck).toBe(0);
  await openMenu();
  await quickLoad();
  await expect.poll(async () => (await truckState(page)).doorsOnTruck, { timeout: 30_000 }).toBe(1);
  const undone = await truckState(page);
  expect(undone.loose).toEqual({});
  expect(undone.dented).not.toContain("Door_L_Gaz-52_0");
  expect(await readDeform(page)).not.toMatch(/detached/);

  // Lost, then saved: the load keeps it off and brings no loose piece.
  await closeMenu();
  await crash();
  await openMenu();
  await quickSave();
  const saved = await savedEntries();
  console.log(`[parts smoke] saved ${JSON.stringify(saved?.map(({ entityId, detachedParts, assetId }) => [entityId, detachedParts, assetId]))}`);
  expect(saved?.find((entry) => entry.entityId === "actor:1")).toMatchObject({ detachedParts: ["door_left"], assetId: "gaz-52-base" });
  await quickLoad();
  await expect.poll(async () => Object.keys((await truckState(page)).pieces), { timeout: 30_000 }).toEqual([]);
  expect((await truckState(page)).doorsOnTruck).toBe(0);
  expect(await readDeform(page)).not.toMatch(/detached/);
  expect(errors).toEqual([]);
});

test("deformable parts: a saved loss stays on its own truck after the level renumbers its actors", async ({ page }) => {
  // Two trucks of one asset: only the id tells them apart once the numbers move.
  const truck = (id: string, x: number): Record<string, unknown> => ({
    classRef: TRUCK, id, name: id, position: [x + 0.06, 0, 14], rotation: [0, 90, 0],
  });
  let renumbered = false;
  const { errors, open } = await play(page, (level) => {
    const extra = { classRef: TRUCK, name: "A new truck, added after the save", position: [-40, 0, -30] };
    level.actors = [{ ...(level.actors![0] as object), id: "smoke-car" }, ...(renumbered ? [extra] : []), truck("hit-truck", 0), truck("far-truck", 30)];
    (level as unknown as { worldSettings: Record<string, unknown> }).worldSettings.pauseMenuWidget = "menu";
  });
  const stats = page.locator("#debug-stats");
  const menu = page.locator('[data-ui-id="title"]');
  await expect(stats).toContainText('save.slots.quick.status = "Empty"', { timeout: 30_000 });
  await expect.poll(async () => (await truckState(page)).doorsOnTruck, { timeout: 30_000 }).toBe(2);

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(() => readDeform(page), { timeout: 40_000 }).toMatch(/detached 1/);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(menu).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 10_000 });
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("forge.saveGame.") && entry.endsWith(".slot.quick"));
    return key ? JSON.parse(localStorage.getItem(key)!).payload.deformables as { entityId: string; detachedParts?: string[] }[] : [];
  });
  console.log(`[parts smoke] saved ${JSON.stringify(saved.map((entry) => [entry.entityId, entry.detachedParts]))}`);
  expect(saved.find((entry) => entry.detachedParts)?.entityId).toBe("actor-id:hit-truck");

  // The hit truck was actor:1 when saved and is actor:2 now; actor:1 is a new truck.
  renumbered = true;
  await open();
  await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 30_000 });
  await expect.poll(async () => (await truckState(page)).doorsOnTruck, { timeout: 30_000 }).toBe(3);
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(menu).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-load"]').click();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });

  await expect.poll(async () => (await truckState(page)).doorsOnTruck, { timeout: 30_000 }).toBe(2);
  const { doorX } = await truckState(page);
  console.log(`[parts smoke] doors after load at x ${JSON.stringify(doorX)}`);
  // The new truck stands at x = -40, the far one near 30: the hit truck, near 0, lost it.
  expect(doorX.every((x) => Math.abs(x) > 15)).toBe(true);
  expect(errors).toEqual([]);
});
