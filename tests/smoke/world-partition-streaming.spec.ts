import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-world-partition-streaming.level.json";
const PLAYER = "assets/__playwright-partition-player.actor.json";
const MODE = "assets/__playwright-partition-mode.actor.json";
const PROP = "assets/starter-content/Gameplay/Script_ParityProp.actor.json";
const TOTAL_CELLS = 12;

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
    schema: 1, name: "World Partition Streaming", loadGroups: [], characters: [],
    worldSettings: {
      gameMode: MODE,
      partition: { enabled: true, grids: { main: { cellSize: 16, loadRange: 24 } } },
    },
    // The long static floor remains eager even with partition enabled.
    instances: [
      // floor-400x400 is a 4 m mesh with its origin at a corner (see smokeProject.mjs):
      // at scale 4 each tile covers x 0..16 and 16 m of z from its position.
      { assetId: "floor-400x400", placements: Array.from({ length: 16 }, (_, index) => ({
        position: [0, 0, -56 + index * 16] as [number, number, number], rotationYDeg: 0, scale: 4, scaleLocked: true,
      })) },
      { assetId: "marker:playerStart", placements: [{ name: "Player Start", position: [8, 2, 184] }] },
    ],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], intensity: 3, castShadow: false }],
    actors: [
      ...Array.from({ length: TOTAL_CELLS }, (_, index) => ({
        name: `Streamed prop ${index}`, classRef: PROP,
        // Offset from the walking line so collidable props cannot block the pawn.
        position: [13, 0.5, 184 - index * 16] as [number, number, number],
      })),
      { name: "Persistent far prop", classRef: PROP, position: [13, 0.5, -80], spatiallyLoaded: false },
    ],
  };
  await writeJson(LEVEL, layout);
}

function readStats(text: string) {
  const match = text.match(/world partition: cells (\d+)\/(\d+) actors (\d+)/);
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!match || !position) throw new Error(`Missing partition/pawn stats:\n${text}`);
  return { active: Number(match[1]), total: Number(match[2]), live: Number(match[3]), z: Number(position[3]) };
}

test("Actor Script cells stream around the walking pawn while the eager floor remains walkable", async ({ page, request }) => {
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
  await expect(overlay).toContainText("world partition: cells", { timeout: 30_000 });
  await expect(overlay).toContainText("movement: walking (grounded)", { timeout: 30_000 });
  const start = readStats((await overlay.textContent())!);
  expect(start.total).toBe(TOTAL_CELLS);
  expect(start.active).toBeGreaterThan(0);
  expect(start.active).toBeLessThan(start.total);
  expect(start.live).toBe(start.active);
  expect(events).toContain("[world-partition] activated 0_11");
  expect(events).not.toContain("[world-partition] activated 0_3");

  // The starter TPS control yaw faces -Z; exercise normal movement/possession.
  let maxLive = start.live;
  await page.keyboard.down("w");
  try {
    await expect.poll(async () => {
      const current = readStats((await overlay.textContent())!);
      maxLive = Math.max(maxLive, current.live);
      expect(current.total).toBe(TOTAL_CELLS);
      expect(current.active).toBeLessThanOrEqual(5);
      expect(current.live).toBeLessThanOrEqual(5);
      return current.z < 60;
    }, { timeout: 90_000, intervals: [100] }).toBe(true);
  } finally {
    await page.keyboard.up("w");
  }
  await expect.poll(() => events.includes("[world-partition] activated 0_3")).toBe(true);
  await expect.poll(() => events.includes("[world-partition] unloaded 0_11")).toBe(true);
  await expect(overlay).toContainText("movement: walking (grounded)");
  expect(maxLive).toBeLessThanOrEqual(5);
  expect(errors).toEqual([]);
});
