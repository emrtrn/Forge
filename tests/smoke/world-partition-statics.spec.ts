import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-world-partition-statics.level.json";
const PLAYER = "assets/__playwright-statics-player.actor.json";
const MODE = "assets/__playwright-statics-mode.actor.json";
const WALL_Z = 40;

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
      partition: { enabled: true, grids: { main: { cellSize: 16, loadRange: 24 } } },
    },
    instances: [
      // Every floor tile streams with its cell. floor-400x400 is a 4 m mesh with
      // its origin at a corner: at scale 4 a tile covers x 0..16 and 16 m of z.
      { assetId: "floor-400x400", placements: Array.from({ length: 16 }, (_, index) => ({
        name: `Floor ${index}`,
        position: [0, 0, -56 + index * 16] as [number, number, number], rotationYDeg: 0, scale: 4, scaleLocked: true,
      })) },
      // A streamed wall across the corridor, about 140 m ahead of the spawn.
      { assetId: "shape-cube", placements: [{
        name: "Streamed wall", position: [8, 0, WALL_Z], rotationYDeg: 0, scale: [16, 4, 1],
      }] },
      { assetId: "marker:playerStart", placements: [{ name: "Player Start", position: [8, 2, 184] }] },
    ],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], intensity: 3, castShadow: false }],
  };
  await writeJson(LEVEL, layout);
}

function readStats(text: string) {
  const statics = text.match(/statics (\d+) pending (\d+)/);
  const cells = text.match(/world partition: cells (\d+)\/(\d+)/);
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!statics || !cells || !position) throw new Error(`Missing partition/pawn stats:\n${text}`);
  return {
    staticCells: Number(statics[1]), pending: Number(statics[2]),
    active: Number(cells[1]), total: Number(cells[2]),
    y: Number(position[2]), z: Number(position[3]),
  };
}

test("static placements stream by cell: the floor ahead is there in time and a streamed wall blocks", async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
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

  // The starter TPS control yaw faces -Z. Run at the wall: the floor ahead keeps
  // streaming in (the pawn never falls) and the streamed wall's collider stops it.
  let lowest = start.y;
  let maxCells = start.staticCells;
  let previousZ = start.z;
  let stillFrames = 0;
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => {
      const current = await stats();
      lowest = Math.min(lowest, current.y);
      maxCells = Math.max(maxCells, current.staticCells);
      stillFrames = Math.abs(current.z - previousZ) < 0.01 ? stillFrames + 1 : 0;
      previousZ = current.z;
      return current.z < 70 && stillFrames >= 10;
    }, { timeout: 90_000, intervals: [100] }).toBe(true);
  } finally {
    await page.keyboard.up("w");
  }
  const blocked = await stats();
  expect(blocked.z, "the streamed wall stopped the pawn").toBeGreaterThan(WALL_Z);
  expect(blocked.z).toBeLessThan(WALL_Z + 3);
  expect(lowest, "the pawn never fell through a missing floor").toBeGreaterThan(-0.5);
  expect(maxCells).toBeLessThanOrEqual(5);

  // Back at the start the far cells are unloaded again.
  await page.keyboard.down("s");
  try {
    await expect.poll(async () => (await stats()).z > 170, { timeout: 90_000, intervals: [100] }).toBe(true);
  } finally {
    await page.keyboard.up("s");
  }
  await expect.poll(async () => (await stats()).staticCells).toBeLessThanOrEqual(start.staticCells);
  await expect(overlay).toContainText("movement: walking (grounded)");
  expect(errors).toEqual([]);
});
