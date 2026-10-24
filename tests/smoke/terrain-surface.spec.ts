import { expect, test, type Page } from "./test";

/**
 * TERRAIN_DEFORMATION Faz 1b: a World Terrain paint layer's physical material
 * reaches the car in the real runtime — the level loads the terrain, the
 * runtime builds a surface sampler from its layers, and the wheel provider
 * resolves the heightfield collider to it.
 *
 * Opens the committed `OffroadTest` level (the car starts on the dirt road) by
 * rewriting the project's `defaultScene` in flight. Each run rewrites the
 * terrain definition in flight too: once with no physical materials, once with
 * mud on the grass and dirt layers. The `?debug` `vehicle surface:` line shows
 * what every wheel stands on; headless frame rates make wall-clock speed
 * comparisons meaningless, so the dynamics stay with the Rapier engine tests
 * and this only checks that the car still drives. Faz 3: the `vehicle sink:`
 * line right after it shows each wheel's virtual sink into its own ruts.
 */
const LEVEL = "assets/starter-content/Levels/OffroadTest.level.json";
const TERRAIN = "assets/starter-content/Levels/OffroadTest.landscapes/offroad.terrain.json";

test.setTimeout(180_000);

async function readKmh(page: Page): Promise<number> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:\S+ speed:(-?\d+)km\/h/);
  if (!match) throw new Error(`no vehicle camera readout in the overlay:\n${text}`);
  return Number(match[1]);
}

/** Per-wheel sink depths (m) from the `vehicle sink: actor:0 | 0.031 m slip 0.00 | …` line; [] without one. */
function parseSinks(text: string): number[] {
  const line = text.match(/vehicle sink: actor:0 \| (.*)/)?.[1];
  if (!line) return [];
  return line.split(" | ").map((entry) => {
    const match = entry.match(/^(\d+\.\d{3}) m slip \d+\.\d{2}$/);
    if (!match) throw new Error(`unexpected vehicle sink entry "${entry}" in:\n${text}`);
    return Number(match[1]);
  });
}

/** The possessed car settled on the start road: its wheels' surfaces, then a short drive. */
async function driveOffroad(page: Page, roadMaterial: string | null): Promise<{
  surfaces: string; sinks: number[]; kmh: number; tracks: number; errors: string[];
}> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => localStorage.clear());
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as { editor: { defaultScene: string } };
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.route(`**/${TERRAIN}`, async (route) => {
    const response = await route.fetch();
    const terrain = (await response.json()) as { layers: { id: string; physicalMaterial?: string | null }[] };
    for (const layer of terrain.layers) {
      if (roadMaterial && (layer.id === "grass" || layer.id === "dirt")) layer.physicalMaterial = roadMaterial;
      else if (!roadMaterial) delete layer.physicalMaterial;
    }
    await route.fulfill({ response, json: terrain });
  });
  await page.goto(`/?debug&terrainSurfaceSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText("mode: Vehicle", { timeout: 30_000 });
  await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  await expect.poll(async () => Math.abs(await readKmh(page)), { timeout: 20_000 }).toBeLessThan(2);
  const surfaces = ((await stats.textContent()) ?? "").match(/vehicle surface: .*/)?.[0] ?? "";
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => readKmh(page), { timeout: 30_000 }).toBeGreaterThan(5);
  const kmh = await readKmh(page);
  // Read while still rolling over the road the car has been rutting since it spawned.
  const sinks = parseSinks((await stats.textContent()) ?? "");
  await page.keyboard.up("KeyW");
  // Faz 2: soft paint layers get a track field; its overlay line counts the stamped cells.
  const tracks = Number(((await stats.textContent()) ?? "").match(/terrain deformation: cells (\d+)/)?.[1] ?? -1);
  return { surfaces, sinks, kmh, tracks, errors };
}

test("terrain surface smoke: OffroadTest paint layers reach the car's wheels on the World Terrain", async ({ browser }) => {
  const run = async (material: string | null) => {
    const context = await browser.newContext();
    try {
      return await driveOffroad(await context.newPage(), material);
    } finally {
      await context.close();
    }
  };
  const neutral = await run(null);
  expect(neutral.errors).toEqual([]);
  expect(neutral.surfaces).toBe("vehicle surface: actor:0 | " + Array(4).fill("neutral fs:1.00 rr:0.00").join(" | "));
  // Hard ground keeps the authored suspension rest on every wheel.
  expect(neutral.sinks).toEqual([0, 0, 0, 0]);
  const mud = await run("mud");
  expect(mud.errors).toEqual([]);
  expect(mud.surfaces).toBe("vehicle surface: actor:0 | " + Array(4).fill("mud fs:0.55 rr:0.35").join(" | "));
  expect(mud.kmh).toBeGreaterThan(5);
  // Faz 3: every wheel reports a sink, and the car sits in its mud ruts.
  expect(mud.sinks).toHaveLength(4);
  expect(Math.max(...mud.sinks)).toBeGreaterThan(0.01);
  // The mud run's wheels pressed tracks; the terrain shader compiled with the track block (no console errors above).
  expect(mud.tracks).toBeGreaterThan(100);
  // With no physical material anywhere the module never builds a field.
  expect(neutral.tracks).toBe(-1);
});
