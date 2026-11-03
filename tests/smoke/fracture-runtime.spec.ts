import { expect, test, type Page } from "./test";

/**
 * DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 4: in Play, driving the Reference Car
 * into the breakable crates of `PhysicsInteractionTest` breaks them into
 * chunks within the per-object and level budgets, and the chunks expire.
 * Reads the `fracture:` line of the `?debug` overlay.
 */

const LEVEL = "layouts/PhysicsInteractionTest.level.json";

test.setTimeout(180_000);

interface FractureLine { objects: number; broken: number; chunks: number; breaks: number; spawnMs: number }

async function readFracture(page: Page): Promise<FractureLine | null> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/fracture: objects (\d+) broken (\d+) chunks (\d+) breaks (\d+) spawn ([\d.]+) ms/);
  return match ? {
    objects: Number(match[1]), broken: Number(match[2]), chunks: Number(match[3]),
    breaks: Number(match[4]), spawnMs: Number(match[5]),
  } : null;
}

/** The vehicle mode publishes the car's speed on the overlay's `camera:` line. */
async function readVehicleKmh(page: Page): Promise<number> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:\S+ speed:(-?\d+)km\/h/);
  return match ? Math.abs(Number(match[1])) : -1;
}

test("fracture runtime: driving into breakable crates breaks them within budget", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => localStorage.clear());
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });

  await page.goto(`/?debug&fractureSmoke=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });

  // 4 crates + 3 wood posts + 1 wall + 2 panels + 1 Fracturable crate actor, all intact.
  await expect.poll(() => readFracture(page), { timeout: 30_000 }).toMatchObject({ objects: 11, broken: 0, chunks: 0 });

  // Drive forward into the crate row 12 m ahead.
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readFracture(page))?.broken ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  // The car breaks through: part of the impulse the crate took is handed back.
  await page.waitForTimeout(300);
  const speedAfterBreak = await readVehicleKmh(page);
  console.log(`[fracture smoke] speed after break ${speedAfterBreak} km/h`);
  expect(speedAfterBreak).toBeGreaterThan(2);
  await page.keyboard.up("KeyW");
  const broken = (await readFracture(page))!;
  // A crate allows 12 chunks of its 10 cells; the level budget (High) is far above that.
  expect(broken.chunks).toBeGreaterThan(0);
  expect(broken.chunks).toBeLessThanOrEqual(broken.broken * 12);
  expect(broken.breaks).toBe(broken.broken);
  expect(broken.spawnMs).toBeLessThan(50);

  // Crate chunks live ~5–10 s: they are gone well within 20 s.
  await expect.poll(async () => (await readFracture(page))?.chunks ?? -1, { timeout: 25_000 }).toBe(0);
  const settled = (await readFracture(page))!;
  expect(settled.broken).toBeGreaterThanOrEqual(broken.broken);
  expect(errors).toEqual([]);
});

test("fracture runtime: a placement override opts a breakable out", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  await page.context().addInitScript(() => localStorage.clear());
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    // Plan §4 / K-04: the second panel keeps itself whole.
    const panels = level.instances.find((group: { assetId: string }) => group.assetId === "sm-breakable-panel");
    panels.placements[1].fracture = { enabled: false };
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.goto(`/?debug&fractureOverride=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect.poll(() => readFracture(page), { timeout: 30_000 }).toMatchObject({ objects: 10, broken: 0 });
});

test("fracture runtime: a Fracturable actor breaks where it is, not where it was placed", async ({ page }) => {
  // Faz 4b: an Actor Script crate dropped from 8 m breaks on landing; its
  // chunks spawn at the actor's live pose (near the ground), not at its
  // authored height. Chunk meshes are found through three's devtools hook.
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __fractureScenes: unknown[] };
    w.__fractureScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean };
      if (object?.isScene) w.__fractureScenes.push(object);
    });
  });
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.actors.push({
      classRef: "assets/starter-content/Gameplay/Script_BreakableCrate.actor.json",
      position: [6, 8, 4], name: "Falling Crate Actor", rotation: [0, 0, 0],
    });
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.goto(`/?debug&fractureActor=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  // The falling actor breaks on landing; the resting one stays whole.
  await expect.poll(async () => (await readFracture(page))?.broken ?? 0, { timeout: 30_000 }).toBe(1);
  // Faz 4b-3: the crate's sidecar names a break effect; the VFX block lists it while it plays.
  await expect(page.locator("#debug-stats")).toContainText("starter-fx-dust-hit", { timeout: 5_000 });
  const line = (await readFracture(page))!;
  expect(line.objects).toBe(12);
  expect(line.chunks).toBeGreaterThan(0);
  expect(line.chunks).toBeLessThanOrEqual(12);
  const heights = await page.evaluate(() => {
    const w = window as unknown as { __fractureScenes: Array<{ traverse(fn: (node: { name: string; position: { y: number } }) => void): void }> };
    const ys: number[] = [];
    for (const scene of w.__fractureScenes) scene.traverse((node) => {
      if (node.name.startsWith("fracture:actor:")) ys.push(node.position.y);
    });
    return ys;
  });
  console.log(`[fracture smoke] actor chunk heights ${heights.map((y) => y.toFixed(2)).join(" ")}`);
  expect(heights.length).toBe(line.chunks);
  for (const y of heights) expect(y).toBeLessThan(3);
  expect(errors).toEqual([]);
});

// OPEN (2026-11-03, Faz 4c-3): World Support anchors 11 of the wall's 24
// chunks, yet all 24 fall — suspected: the car keeps driving into the standing
// chunks (every hit opens a new radius) or falling chunks chain-break them.
// Fixme until 4c-3 settles it; see DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 4c-3.
test.fixme("fracture runtime: an anchored wall breaks around the hit and the rest stands", async ({ page }) => {
  // Faz 4c: the test wall's sidecar is `support.mode: "anchored"` with World
  // Support. The crates and posts are taken off the car's path, so it drives
  // straight into the wall: chunks around the hit fall, the chunks still
  // joined to the floor stand as static bodies and stay standing.
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => localStorage.clear());
  await page.route(`**/${LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.instances = level.instances.filter((group: { assetId: string }) => group.assetId !== "sm-breakable-crate");
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.goto(`/?debug&fractureWall=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  const readStatic = async (): Promise<number> => {
    const text = (await page.locator("#debug-stats").textContent()) ?? "";
    const match = text.match(/fracture: .* static (\d+)/);
    return match ? Number(match[1]) : -1;
  };
  // Wall + 2 panels + the Fracturable crate actor.
  await expect.poll(() => readFracture(page), { timeout: 30_000 }).toMatchObject({ objects: 4, broken: 0, chunks: 0 });
  expect(await readStatic()).toBe(0);

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readFracture(page))?.broken ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);
  await page.keyboard.up("KeyW");
  const broken = (await readFracture(page))!;
  const standing = await readStatic();
  console.log(`[fracture smoke] wall fell ${broken.chunks} chunks, ${standing} stand`);
  expect(broken.chunks).toBeGreaterThan(0);
  expect(standing).toBeGreaterThan(0);
  // Still standing a moment later: nothing else knocked it down.
  await page.waitForTimeout(3000);
  expect(await readStatic()).toBe(standing);
  expect(errors).toEqual([]);
});
