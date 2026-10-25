import { expect, test, type Page } from "./test";

/**
 * TERRAIN_DEFORMATION Faz 1b: a World Terrain paint layer's physical material
 * reaches the car in the real runtime — the level loads the terrain, the
 * runtime builds a surface sampler from its layers, and the wheel provider
 * resolves the heightfield collider to it.
 *
 * Opens the committed `OffroadTest` level (the car starts on the dirt road) by
 * rewriting the project's `defaultScene` in flight. Each run rewrites the
 * terrain definition in flight too: neutral, mud and snow on the road layers.
 * The `?debug` `vehicle surface:` line shows
 * what every wheel stands on; headless frame rates make wall-clock speed
 * comparisons meaningless, so the dynamics stay with the Rapier engine tests
 * and neutral ground must still drive. Soft ground may bog down: powered slip,
 * live wheel particles and tracks must remain present at standstill. Faz 3: the `vehicle sink:`
 * line right after it shows each wheel's virtual sink into its own ruts, and
 * `terrain detail:` the CDLOD nodes refined inside the track window (a custom
 * quality profile keeps the detail levels on; headless calibration picks low).
 */
const LEVEL = "assets/starter-content/Levels/OffroadTest.level.json";
const TERRAIN = "assets/starter-content/Levels/OffroadTest.landscapes/offroad.terrain.json";

test.setTimeout(240_000);

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
  surfaces: string; sinks: number[]; kmh: number; tracks: number; detail: { nodes: number; levels: number } | null; errors: string[];
}> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Headless calibration would pick low, which turns the Faz 3 track detail off: hold a custom
  // profile with low's cost (software GL renders on the CPU; a slow frame stretches physics time
  // and the car may not reach speed in time) and two detail levels.
  await page.context().addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: {
        selectedQualityLevel: "custom",
        customSettings: {
          renderScale: 0.7, maxPixelRatio: 1, aoAllowed: false, dofAllowed: false, bloomAllowed: false, smaaAllowed: false,
          shadowsEnabled: false, particleDensity: 0.3, foliageCullDistanceScale: 0.45, grassDensity: 0.3,
          terrainTrackDetailLevels: 2,
        },
        manuallySelected: true, adaptiveOptimizationEnabled: false,
      } },
    }));
  });
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
  if (roadMaterial === null) {
    await expect.poll(async () => readKmh(page), { timeout: 30_000 }).toBeGreaterThan(5);
  }
  const kmh = await readKmh(page);
  if (roadMaterial === "mud" || roadMaterial === "snow") {
    // The actual preset, manifest, loader and GPU renderer must all connect.
    const effect = roadMaterial === "mud" ? "starter-fx-mud-splash" : "starter-fx-snow-dust";
    await expect(stats).toContainText(new RegExp(`${effect} [1-9]\\d*`), { timeout: 20_000 });
    const sinkLine = ((await stats.textContent()) ?? "").match(/vehicle sink: actor:0 \| (.*)/)?.[1] ?? "";
    const slips = [...sinkLine.matchAll(/slip (\d+\.\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(...slips)).toBeGreaterThan(0.15);
    await page.screenshot({ path: `test-results/terrain-${roadMaterial}-splash.png`, scale: "css" });
  } else if (roadMaterial === null) {
    await expect(stats).not.toContainText("starter-fx-mud-splash");
  }
  // Read while still rolling over the road the car has been rutting since it spawned.
  const sinks = parseSinks((await stats.textContent()) ?? "");
  await page.keyboard.up("KeyW");
  // Faz 2: soft paint layers get a track field; its overlay line counts the stamped cells.
  const text = (await stats.textContent()) ?? "";
  const tracks = Number(text.match(/terrain deformation: cells (\d+)/)?.[1] ?? -1);
  // Faz 3: CDLOD nodes refined inside the track window around the car.
  const detailMatch = text.match(/terrain detail: nodes (\d+) levels (\d+)/);
  const detail = detailMatch ? { nodes: Number(detailMatch[1]), levels: Number(detailMatch[2]) } : null;
  return { surfaces, sinks, kmh, tracks, detail, errors };
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
  expect(mud.surfaces).toBe("vehicle surface: actor:0 | " + Array(4).fill("mud fs:0.55 rr:0.12").join(" | "));
  // Faz 3: every wheel reports a sink, and the car sits in its mud ruts.
  expect(mud.sinks).toHaveLength(4);
  expect(Math.max(...mud.sinks)).toBeGreaterThan(0.01);
  // The mud run's wheels pressed tracks; the terrain shader compiled with the track block (no console errors above).
  expect(mud.tracks).toBeGreaterThan(0);
  // With no physical material anywhere the module never builds a field.
  expect(neutral.tracks).toBe(-1);
  // Faz 3: the mud run's track window refines the CDLOD mesh around the car (the displaced
  // shaders compiled: no console errors); without a field there is no detail line at all.
  expect(mud.detail?.levels).toBe(2);
  expect(mud.detail?.nodes).toBeGreaterThan(0);
  expect(neutral.detail).toBeNull();
  const snow = await run("snow");
  expect(snow.errors).toEqual([]);
  expect(snow.surfaces).toBe("vehicle surface: actor:0 | " + Array(4).fill("snow fs:0.60 rr:0.06").join(" | "));
  expect(Math.max(...snow.sinks)).toBeGreaterThan(0.01);
  expect(snow.tracks).toBeGreaterThan(0);
});
