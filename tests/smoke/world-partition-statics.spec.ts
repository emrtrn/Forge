import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-world-partition-statics.level.json";
const PLAYER = "assets/__playwright-statics-player.actor.json";
const MODE = "assets/__playwright-statics-mode.actor.json";
// Spawn mid-corridor; each blocker starts ~95 m away, far outside the 36 m prefetch ring.
const SPAWN_Z = 72;
const VOLUME_Z = -20;
const WALL_Z = 170;

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), JSON.stringify(value));
}

async function writeFixture() {
  const player = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_PlayerCharacter.actor.json"), "utf8"));
  player.components.find((component: { component: string }) => component.component === "CharacterMovement").props.maxWalkSpeed = 60;
  await writeJson(PLAYER, player);
  const mode = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_GameMode.actor.json"), "utf8"));
  mode.variables.find((variable: { key: string }) => variable.key === "defaultPawnClassRef").default = PLAYER;
  await writeJson(MODE, mode);
  const layout: RoomLayout = {
    schema: 1, name: "World Partition Statics", loadGroups: [], characters: [],
    worldSettings: {
      gameMode: MODE,
      partition: { enabled: true, grids: { main: { cellSize: 16, loadRange: 24 }, foliage: { cellSize: 64, loadRange: 256 } } },
    },
    instances: [
      // Every floor tile streams with its cell. floor-400x400 is a 4 m mesh with
      // its origin at a corner: at scale 4 a tile covers x 0..16 and 16 m of z.
      { assetId: "floor-400x400", placements: Array.from({ length: 16 }, (_, index) => ({
        name: `Floor ${index}`,
        position: [0, 0, -56 + index * 16] as [number, number, number], rotationYDeg: 0, scale: 4, scaleLocked: true,
      })) },
      // A streamed wall across the corridor behind the spawn (+Z).
      { assetId: "shape-cube", placements: [{
        name: "Streamed wall", position: [8, 0, WALL_Z], rotationYDeg: 0, scale: [16, 4, 1],
      }] },
      { assetId: "marker:playerStart", placements: [{ name: "Player Start", position: [8, 2, SPAWN_Z] }] },
    ],
    lights: [
      { id: "sun", type: "directional", position: [4, 8, 4], intensity: 3, castShadow: false },
      // Streamed lights in cell 0_7, one per pooled kind, met on the way back.
      { id: "lamp", name: "Streamed lamp", type: "point", position: [8, 3, 116], intensity: 2 },
      { id: "shadow-lamp", name: "Streamed shadow lamp", type: "point", position: [8, 3, 120], intensity: 2, castShadow: true },
      { id: "spot", name: "Streamed spot", type: "spot", position: [8, 4, 124], rotation: [-90, 0, 0], intensity: 3 },
    ],
    // A streamed blocking volume across the corridor ahead of the spawn (-Z).
    blockingVolumes: [{ id: "streamed-volume", name: "Streamed volume", position: [8, 2, VOLUME_Z], size: [16, 4, 1], renderInGame: true }],
  };
  await writeJson(LEVEL, layout);
}

function readStats(text: string) {
  const statics = text.match(/statics (\d+) pending (\d+)/);
  const lights = text.match(/lights (\d+)\/(\d+)/);
  const programs = text.match(/prog (\d+)/);
  const cells = text.match(/world partition: cells (\d+)\/(\d+)/);
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!statics || !cells || !position || !lights || !programs) throw new Error(`Missing partition/pawn stats:\n${text}`);
  return {
    staticCells: Number(statics[1]), pending: Number(statics[2]),
    lightsUsed: Number(lights[1]), lightCapacity: Number(lights[2]), programs: Number(programs[1]),
    active: Number(cells[1]), total: Number(cells[2]),
    y: Number(position[2]), z: Number(position[3]),
  };
}

test("static placements and volumes stream by cell: the floor ahead is there in time and streamed blockers block", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const events: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "info" && message.text().startsWith("[world-partition]")) events.push(message.text());
  });
  await writeFixture();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?debug");
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  const overlay = page.locator("#debug-stats");
  await expect(overlay).toContainText("movement: walking (grounded)", { timeout: 30_000 });
  const stats = async () => readStats((await overlay.textContent())!);
  const start = await stats();
  // Only the spawn-range cells are built, and boot built them completely.
  expect(start.staticCells).toBeGreaterThan(0);
  expect(start.staticCells).toBeLessThan(start.total);
  expect(start.pending).toBe(0);
  // One pooled light per kind, all parked while their cell is far away.
  expect(start.lightCapacity).toBe(3);
  expect(start.lightsUsed).toBe(0);

  let lowest = start.y;
  let maxCells = start.staticCells;
  /** Shader programs at the first sample with every pooled light lit. */
  let programsWhenLit: number | null = null;
  /** Holds a key until the pawn has stood still for a second beyond `beyond(z)`. */
  const runUntilStopped = async (key: "w" | "s", beyond: (z: number) => boolean) => {
    let previousZ = Number.NaN;
    let stillFrames = 0;
    await page.keyboard.down(key);
    try {
      await expect.poll(async () => {
        const current = await stats();
        lowest = Math.min(lowest, current.y);
        maxCells = Math.max(maxCells, current.staticCells);
        if (programsWhenLit === null && current.lightsUsed === 3) programsWhenLit = current.programs;
        stillFrames = Math.abs(current.z - previousZ) < 0.01 ? stillFrames + 1 : 0;
        previousZ = current.z;
        return beyond(current.z) && stillFrames >= 10;
      }, { timeout: 90_000, intervals: [100] }).toBe(true);
    } finally {
      await page.keyboard.up(key);
    }
    return stats();
  };

  // The starter TPS control yaw faces -Z. Run at the volume: the floor ahead keeps
  // streaming in (the pawn never falls) and the streamed volume's collider stops it.
  const atVolume = await runUntilStopped("w", (z) => z < SPAWN_Z - 40);
  expect(atVolume.z, "the streamed volume stopped the pawn").toBeGreaterThan(VOLUME_Z);
  expect(atVolume.z).toBeLessThan(VOLUME_Z + 3);

  // Running back past the spawn: the streamed lights borrow pooled lights without
  // compiling a single program, the streamed wall stops the pawn, and the volume's cell is gone.
  const programsBefore = (await stats()).programs;
  const atWall = await runUntilStopped("s", (z) => z > SPAWN_Z + 40);
  expect(programsWhenLit, "all three streamed lights were lit").not.toBeNull();
  // Not equal: three releases programs whose materials left with an unloaded cell.
  expect(programsWhenLit, "lighting streamed lights compiled no program").toBeLessThanOrEqual(programsBefore);
  expect(atWall.z, "the streamed wall stopped the pawn").toBeLessThan(WALL_Z);
  expect(atWall.z).toBeGreaterThan(WALL_Z - 3);
  expect(events).toContain("[world-partition] unloaded 0_-2");
  expect(lowest, "the pawn never fell through a missing floor").toBeGreaterThan(-0.5);
  expect(maxCells).toBeLessThanOrEqual(5);
  await expect(overlay).toContainText("movement: walking (grounded)");
  expect(errors).toEqual([]);
});
