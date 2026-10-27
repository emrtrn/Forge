import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateTestWorld, testWorldLevel } from "../../tools/world/testWorld";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

test("wet mud fifth layer renders reflective water on track floors", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tests/smoke/pages/wet-mud.html");
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__wetMudQa?.ready)), { timeout: 60_000 }).toBe(true);
  const uniformSurface = await page.evaluate(() => (window as any).__wetMudQa.roughness(false) as number[]);
  const texturedSurface = await page.evaluate(() => (window as any).__wetMudQa.roughness(true) as number[]);
  expect(texturedSurface.filter((value, i) => Math.abs(value - uniformSurface[i]!) > 3).length).toBeGreaterThan(30);
  await page.screenshot({ path: info.outputPath("wet-mud-roughness.png") });
  const dry = await page.evaluate(() => (window as any).__wetMudQa.water(false) as number[]);
  const dryCentre = await page.evaluate(() => (window as any).__wetMudQa.sample() as number[]);
  await page.screenshot({ path: info.outputPath("mud-track-without-water.png") });
  const wet = await page.evaluate(() => (window as any).__wetMudQa.water(true) as number[]);
  const wetCentre = await page.evaluate(() => (window as any).__wetMudQa.sample() as number[]);
  await page.screenshot({ path: info.outputPath("wet-mud-puddles.png") });
  expect(Math.max(...wet.map((value, i) => value - dry[i]!))).toBeGreaterThan(10); // blue sky on visible flat parts of the floor
  expect(wetCentre[2]! - dryCentre[2]!).toBeGreaterThan(10); // the rut centre must fill, not only one narrow edge
  const profile = await page.evaluate(() => (window as any).__wetMudQa.profile() as { offset: number; puddle: number; roughness: number; normalY: number }[]);
  await writeFile(info.outputPath("wet-mud-profile.json"), JSON.stringify(profile, null, 2));
  const floor = profile.find((point) => point.offset === 0)!;
  expect(floor.puddle).toBeGreaterThan(0.8);
  expect(floor.roughness).toBeGreaterThan(0.12);
  const walls = profile.filter((point) => Math.abs(point.offset) === 0.22);
  for (const wall of walls) {
    expect(wall.normalY).toBeLessThan(0.94);
    expect(wall.puddle).toBeLessThan(0.05);
    expect(wall.roughness).toBeGreaterThan(0.28);
  }
  for (const rim of profile.filter((point) => Math.abs(point.offset) >= 0.38)) expect(rim.puddle).toBeLessThan(0.01);
  await page.evaluate(() => (window as any).__wetMudQa.water(false));
  const dryProfile = await page.evaluate(() => (window as any).__wetMudQa.profile() as { puddle: number }[]);
  expect(dryProfile.every((point) => point.puddle < 0.01)).toBe(true);
  await page.evaluate(() => (window as any).__wetMudQa.water(true));
  await page.evaluate(() => (window as any).__wetMudQa.side());
  await page.screenshot({ path: info.outputPath("wet-mud-puddles-side.png") });
  // 0.5 m authored spacing + one detail level = 25 cm vertices, matching
  // LandscapeTest at its existing 1 m spacing / two detail levels.
  await page.evaluate(() => (window as any).__wetMudQa.tracks(Math.PI / 7, 0.55, 1));
  await page.screenshot({ path: info.outputPath("wet-mud-diagonal-25cm.png") });
  await page.evaluate(() => (window as any).__wetMudQa.tracks(0, 0.25, 1));
  await page.screenshot({ path: info.outputPath("wet-mud-narrow-25cm.png") });
  const viewport = await page.locator("canvas").boundingBox();
  expect(viewport).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
  expect(errors).toEqual([]);
});

test("wet soil bed glare is bounded without changing dry profiles, unpacked layers or puddle floors", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/tests/smoke/pages/wet-mud.html");
  await page.waitForFunction(() => (window as any).__wetMudQa?.ready);
  type Shot = { color: number[]; profile: { offset: number; puddle: number; roughness: number; normalY: number }[] };
  const shot = (original: boolean, wet: number, packed = true): Promise<Shot> => page.evaluate(
    ([b, w, p]) => (window as any).__wetMudQa.bedGlare(b, w, p), [original, wet, packed] as const);
  const before = await shot(true, 0.9);
  await page.screenshot({ path: info.outputPath("wet-bed-before.png") });
  const after = await shot(false, 0.9);
  await page.screenshot({ path: info.outputPath("wet-bed-after.png") });
  expect(after.color.filter((v, i) => Math.abs(v - before.color[i]!) > 2).length).toBeGreaterThan(10);
  const beforeFloor = before.profile.find(p => p.offset === 0)!;
  const afterFloor = after.profile.find(p => p.offset === 0)!;
  expect(afterFloor.puddle).toBeGreaterThan(0.8);
  expect(afterFloor).toEqual(beforeFloor);
  expect(after.profile.map(p => [p.puddle, p.normalY])).toEqual(before.profile.map(p => [p.puddle, p.normalY]));
  for (const wet of [0, 0.1]) expect(await shot(false, wet)).toEqual(await shot(true, wet));
  expect(await shot(false, 0.9, false)).toEqual(await shot(true, 0.9, false));
  expect(await shot(true, 0.9)).toEqual(before);
  await writeFile(info.outputPath("bed-glare.json"), JSON.stringify({ before, after }, null, 2));
  expect(errors).toEqual([]);
});

test("editor adds a fifth World Terrain layer with undo, paints wet mud, saves every tile and reloads", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const world = generateTestWorld({ tiles: 2, tileQuads: 32, spacing: 1 });
  const terrainPath = "landscapes/__wet-mud.terrain.json", levelPath = "layouts/__wet-mud.level.json";
  const write = async (path: string, data: string | Uint8Array) => { await mkdir(dirname(smokePublicPath(path)), { recursive: true }); await writeFile(smokePublicPath(path), data); };
  for (const [key, bytes] of world.tileBytes) await write(terrainTilePath(terrainPath, key), bytes);
  await write(terrainGlobalMapPath(terrainPath), world.globalBytes);
  await write(terrainPath, JSON.stringify(world.def));
  await write(levelPath, JSON.stringify(testWorldLevel(world, terrainPath, "__wet-mud")));
  expect((await request.post("/__open-level", { data: { path: levelPath } })).ok()).toBe(true);
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("paint");
  await expect(page.locator("[data-landscape-layer]")).toHaveCount(4);
  await page.locator("[data-landscape-add-layer]").click();
  await expect(page.locator("[data-landscape-layer]")).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-landscape-layer]")).toHaveCount(4);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("[data-landscape-layer]")).toHaveCount(5);
  await page.locator("[data-landscape-layer-material]").selectOption("lt-wet-mud");
  await page.locator("[data-landscape-layer-physical-material]").selectOption("mud");
  await expect(page.locator("[data-landscape-layer].active")).toContainText("LT Wet Mud");
  await page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first().click();
  await page.keyboard.press("KeyF");
  const box = await page.locator("#game-canvas").boundingBox();
  if (!box) throw new Error("No canvas");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 15, box.y + box.height * 0.6 + 8, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 30_000 });
  await expect.poll(async () => JSON.parse(await readFile(smokePublicPath(terrainPath), "utf8")).layers[4]?.physicalMaterial, { timeout: 30_000 }).toBe("mud");
  const def = JSON.parse(await readFile(smokePublicPath(terrainPath), "utf8"));
  expect(def.layers).toHaveLength(5);
  expect(def.layers[4].material).toBe("lt-wet-mud");
  expect(def.layers[4].physicalMaterial).toBe("mud");
  let painted = false;
  for (const [key, before] of world.tileBytes) {
    const tile = decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(terrainPath, key))));
    expect(tile.layerCount).toBe(5);
    expect(tile.heights).toEqual(decodeTerrainTile(before).heights);
    painted ||= tile.weights.slice(tile.size * tile.size * 4).some((weight) => weight > 0);
  }
  expect(painted).toBe(true);
  await page.reload();
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("paint");
  await expect(page.locator("[data-landscape-layer]")).toHaveCount(5);
  await page.locator(`[data-landscape-layer="${def.layers[4].id}"]`).click();
  await expect(page.locator("[data-landscape-layer-material]")).toHaveValue("lt-wet-mud");
  expect(errors).toEqual([]);
});
