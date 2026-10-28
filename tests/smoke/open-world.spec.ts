import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { generateTestWorld, testWorldLevel } from "../../tools/world/testWorld";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

// OPEN_WORLD_PLAN Faz 4 acceptance: the 4x4 km test world, generated into the
// smoke copy (128 quads x 2 m: the same extent, a quarter of the samples).
const LEVEL = "layouts/__playwright-open-world.level.json";
const TERRAIN = "landscapes/__playwright-open-world.terrain.json";
const world = generateTestWorld({ tileQuads: 128, spacing: 2 });
const TOTAL_TILES = world.def.tilesX * world.def.tilesZ;

async function writeWorld(
  levelFile: string = LEVEL,
  configure?: (level: Record<string, unknown>) => void,
  terrainFile: string = TERRAIN,
  def: object = world.def,
) {
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, bytes] of world.tileBytes) await write(terrainTilePath(terrainFile, key), bytes);
  await write(terrainGlobalMapPath(terrainFile), world.globalBytes);
  await write(terrainFile, JSON.stringify(def));
  const playerPath = "assets/__playwright-open-world-player.actor.json";
  const modePath = "assets/__playwright-open-world-mode.actor.json";
  const player = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_PlayerCharacter.actor.json"), "utf8"));
  // 1 km in under 20 s of normal input: fast enough to stress streaming.
  player.components.find((c: { component: string }) => c.component === "CharacterMovement").props.maxWalkSpeed = 60;
  await write(playerPath, JSON.stringify(player));
  const mode = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_GameMode.actor.json"), "utf8"));
  mode.variables.find((v: { key: string }) => v.key === "defaultPawnClassRef").default = playerPath;
  await write(modePath, JSON.stringify(mode));
  const level = testWorldLevel(world, terrainFile, "__playwright-open-world") as Record<string, unknown> & { worldSettings: Record<string, unknown> };
  level.worldSettings.gameMode = modePath;
  configure?.(level);
  await write(levelFile, JSON.stringify(level));
}

function readStats(text: string) {
  const counts = text.match(/terrain streaming: loaded:(\d+) active:(\d+) queued:(\d+) physics:(\d+)/);
  const resident = text.match(/streaming: [\d.]+ ms\/frame ([\d.]+) (B|kB|MB|GB)/);
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!counts || !resident || !position) throw new Error(`Missing streaming/pawn stats:\n${text}`);
  const scale = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 }[resident[2] as "B" | "kB" | "MB" | "GB"];
  return { loaded: Number(counts[1]), active: Number(counts[2]), queued: Number(counts[3]), physics: Number(counts[4]),
    residentBytes: Number(resident[1]) * scale, x: Number(position[1]), y: Number(position[2]), z: Number(position[3]) };
}

test("open world: a 4x4 km generated world streams a bounded set of tiles while the pawn runs 1 km without falling", async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await writeWorld();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`/?debug&openworld=${Date.now()}`);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 90_000 });
  const overlay = page.locator("#debug-stats");
  await expect(overlay).toContainText("movement: walking (grounded)", { timeout: 30_000 });
  await expect(overlay).toContainText(/queued:0 physics:/, { timeout: 30_000 });
  const start = readStats((await overlay.textContent())!);
  expect(Math.abs(start.z - world.spawn[2])).toBeLessThan(1);

  // A tile's decoded payload: u16 heights as f32 plus one RGBA weight block.
  const tileBytes = (world.def.tileQuads + 1) ** 2 * 8;
  const peak = { loaded: 0, active: 0, physics: 0, residentBytes: 0 };
  const trail: string[] = [];
  // Initial TPS control yaw faces -Z: W runs north along the valley.
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => {
      const current = readStats((await overlay.textContent())!);
      trail.push(`${current.x.toFixed(0)},${current.y.toFixed(1)},${current.z.toFixed(0)} l${current.loaded} p${current.physics}`);
      for (const key of Object.keys(peak) as (keyof typeof peak)[]) peak[key] = Math.max(peak[key], current[key]);
      const ground = world.heightAt(current.x, current.z);
      expect(ground).not.toBeNull();
      expect(current.y).toBeGreaterThan(ground! - 0.3);
      return world.spawn[2] - current.z > 1000;
    }, { timeout: 150_000, intervals: [250] }).toBeTruthy();
  } finally {
    console.log(`[open-world] trail ${trail.filter((_, index) => index % 20 === 0).concat(trail.slice(-2)).join(" | ")}`);
    await page.keyboard.up("w");
  }
  await expect(overlay).toContainText("movement: walking (grounded)");
  const end = readStats((await overlay.textContent())!);
  expect(Math.abs(end.y - world.heightAt(end.x, end.z)!)).toBeLessThan(0.3);
  console.log(`[open-world] ${TOTAL_TILES} tiles; peak ${JSON.stringify(peak)}; end ${JSON.stringify(end)}`);
  // Render range is two tiles (512 m): about a 5x5 block, never the world.
  expect(peak.active).toBeLessThanOrEqual(36);
  expect(peak.loaded).toBeLessThanOrEqual(40);
  expect(peak.physics).toBeLessThanOrEqual(9);
  // Active data plus the four-tile passive LRU budget (the readout rounds to 0.1 MB).
  expect(peak.residentBytes).toBeLessThanOrEqual((peak.active + 4) * tileBytes + 50_000);
  expect(errors).toEqual([]);
});

// OPEN_WORLD_PLAN Faz 8 roads: a road's collision streams with World Partition
// cells, both a segmented spline actor and a World Terrain road spline. The
// road starts ~650 m north of the spawn (out of the 384 m load range at boot),
// rises 2.5 m over a ramp and stays raised, so standing above the terrain there
// proves its cell's trimesh arrived in time.
const ROAD_LEVEL = "layouts/__playwright-open-world-road.level.json";
const ROAD_TERRAIN = "landscapes/__playwright-open-world-road.terrain.json";
const ROAD_START_Z = -150;
const ROAD_END_Z = -900;
const ROAD_LIFT = 2.5;

function roadLift(z: number): number {
  return Math.min(1, Math.max(0, (-250 - z) / 100)) * ROAD_LIFT;
}

function roadPositions(): [number, number, number][] {
  const x = world.spawn[0];
  const positions: [number, number, number][] = [];
  for (let z = ROAD_START_Z; z >= ROAD_END_Z; z -= 25) positions.push([x, world.heightAt(x, z)! + 0.05 + roadLift(z), z]);
  return positions;
}

function roadActor() {
  return {
    id: "streamed-road", name: "Streamed Road", position: [0, 0, 0],
    spline: { schema: 1, closed: false, defaultUp: [0, 1, 0], reparamStepsPerSegment: 32,
      points: roadPositions().map((position, index) => ({ id: `road-${index}`, position, pointType: "linear" })) },
    generators: [{ id: "surface", type: "deformMesh", meshAsset: "sm-road-asphalt", forwardAxis: "z", upAxis: "y",
      sampleSteps: 8, geometryMode: "segments", collisionEnabled: true, uvMode: "stretch", verticalOffset: 0.025 }],
  };
}

/** The same road as a World Terrain spline: mesh + collision only, the terrain left as generated. */
function terrainRoad() {
  const points = roadPositions().map((position, index) => ({ id: `road-${index}`, position, width: 6, falloff: 0 }));
  return {
    id: "streamed-terrain-road", name: "Streamed Terrain Road", smooth: false, coordinateSpace: "world", points,
    segments: points.slice(1).map((point, index) => ({
      id: `segment-${index}`, startPointId: points[index]!.id, endPointId: point.id,
      mesh: { enabled: true, assetId: "sm-road-asphalt", deform: true, collision: true },
    })),
  };
}

for (const kind of ["spline actor", "World Terrain spline"] as const) {
  test(`open world: a road's collision streams in with its partition cells (${kind})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const activated: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
      const cell = message.text().match(/\[world-partition\] activated (\S+)/);
      if (cell) activated.push(cell[1]!);
    });
    const configure = (level: Record<string, unknown>) => {
      (level.worldSettings as Record<string, unknown>).partition = { enabled: true };
      if (kind === "spline actor") level.splines = [roadActor()];
    };
    if (kind === "spline actor") await writeWorld(ROAD_LEVEL, configure);
    else await writeWorld(ROAD_LEVEL, configure, ROAD_TERRAIN, { ...world.def, splines: [terrainRoad()] });
    expect((await request.post("/__open-level", { data: { path: ROAD_LEVEL } })).ok()).toBeTruthy();
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`/?debug&openworldroad=${Date.now()}`);
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 90_000 });
    const overlay = page.locator("#debug-stats");
    await expect(overlay).toContainText("movement: walking (grounded)", { timeout: 30_000 });
    // 128 m cells: the road's cells start at z = -256 (cell row -2), 750+ m away.
    // It is the world's only partition content: nothing near the spawn loads.
    const roadRow = (key: string) => Number(key.split("_")[1]) <= -2;
    const bootCells = [...activated];
    expect(bootCells.filter(roadRow)).toEqual([]);

    await page.keyboard.down("w");
    let lifted = 0;
    try {
      await expect.poll(async () => {
        const current = readStats((await overlay.textContent())!);
        const ground = world.heightAt(current.x, current.z)!;
        // On the raised stretch the pawn stands on the road deck, not the terrain.
        if (current.z < -400 && current.z > -850) {
          expect(current.y).toBeGreaterThan(ground + ROAD_LIFT - 0.6);
          lifted += 1;
        }
        return current.z < -700 && lifted >= 3;
      }, { timeout: 150_000, intervals: [250] }).toBeTruthy();
    } finally {
      await page.keyboard.up("w");
    }
    expect(activated.filter(roadRow).length).toBeGreaterThan(0);
    console.log(`[open-world-road] ${kind}: boot cells ${bootCells.length}; road cells activated ${activated.filter(roadRow).length}; samples on the deck ${lifted}`);
    expect(errors).toEqual([]);
  });
}
