import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoomLayout } from "../../engine/scene/layout";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-world-partition-residency.level.json";
const PLAYER = "assets/__playwright-residency-player.actor.json";
const MODE = "assets/__playwright-residency-mode.actor.json";
const TORUS = "assets/__playwright-residency-torus.actor.json";
const TORUS_MODEL = "shape-torus";

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), JSON.stringify(value));
}

async function writeFixture() {
  const player = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_PlayerCharacter.actor.json"), "utf8"));
  // Fast enough to cross the corridor quickly, slow enough that a slow frame
  // after the key is released cannot coast the pawn through a whole cell.
  player.components.find((component: { component: string }) => component.component === "CharacterMovement").props.maxWalkSpeed = 20;
  await writeJson(PLAYER, player);
  const mode = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_GameMode.actor.json"), "utf8"));
  mode.variables.find((variable: { key: string }) => variable.key === "defaultPawnClassRef").default = PLAYER;
  await writeJson(MODE, mode);
  // A plain actor whose mesh nothing else in the level uses: only its cell owns it.
  const torus = JSON.parse(await readFile(smokePublicPath("assets/starter-content/Gameplay/Script_ParityProp.actor.json"), "utf8"));
  torus.components.find((component: { component: string }) => component.component === "MeshRenderer").props.assetId = TORUS_MODEL;
  await writeJson(TORUS, torus);
  const layout: RoomLayout = {
    schema: 1, name: "World Partition Residency", loadGroups: [], characters: [],
    worldSettings: {
      gameMode: MODE,
      // Activation 24 m, prefetch ring 36 m (released beyond 45 m), cells 16 m.
      partition: { enabled: true, grids: { main: { cellSize: 16, loadRange: 24 } } },
    },
    instances: [
      // floor-400x400 is a 4 m mesh with its origin at a corner: at scale 4 each
      // tile covers x 0..16 and 16 m of z from its position.
      { assetId: "floor-400x400", placements: Array.from({ length: 16 }, (_, index) => ({
        position: [0, 0, -56 + index * 16] as [number, number, number], rotationYDeg: 0, scale: 4, scaleLocked: true,
      })) },
      { assetId: "marker:playerStart", placements: [{ name: "Player Start", position: [8, 2, 184] }] },
    ],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], intensity: 3, castShadow: false }],
    // Cell 0_4 (z 64..80), about 100 m ahead of the spawn.
    actors: [{ name: "Far torus", classRef: TORUS, position: [13, 0.5, 72] }],
  };
  await writeJson(LEVEL, layout);
}

function pawnZ(text: string): number {
  const position = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!position) throw new Error(`Missing pawn stats:\n${text}`);
  return Number(position[3]);
}

test("a cell-owned model loads in the prefetch ring before its cell and is freed after leaving it", async ({ page, request }) => {
  test.setTimeout(240_000);
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
  const loaded = `[world-partition] loaded model ${TORUS_MODEL}`;
  const activated = "[world-partition] activated 0_4";
  const evicted = `[world-partition] evicted model ${TORUS_MODEL}`;
  // Boot loads only the spawn ring: the far torus model is not fetched yet.
  expect(events).not.toContain(loaded);
  const count = (event: string) => events.filter((entry) => entry === event).length;

  const walk = async (key: "w" | "s", done: (z: number) => boolean) => {
    await page.keyboard.down(key);
    try {
      await expect.poll(async () => done(pawnZ((await overlay.textContent())!)), { timeout: 90_000, intervals: [100] }).toBe(true);
    } finally {
      await page.keyboard.up(key);
    }
  };

  // The starter TPS control yaw faces -Z. Walking past the torus streams it in.
  await walk("w", (z) => z < 70);
  await expect.poll(() => count(activated)).toBeGreaterThanOrEqual(1);
  expect(events.indexOf(loaded), "the model loads before its cell activates").toBeGreaterThanOrEqual(0);
  expect(events.indexOf(loaded)).toBeLessThan(events.indexOf(activated));

  // Far behind the release ring, the unowned model is freed after the delay.
  await walk("s", (z) => z > 150);
  await expect.poll(() => count(evicted), { timeout: 60_000, intervals: [500] }).toBe(1);
  expect(events.indexOf(evicted)).toBeGreaterThan(events.indexOf("[world-partition] unloaded 0_4"));

  // Coming back fetches it again and the cell activates with it.
  await walk("w", (z) => z < 90);
  // Count from the eviction on, so an extra unload/activate before it (a pawn
  // coasting past a cell on a slow frame) cannot change the verdict.
  const afterEviction = () => events.slice(events.indexOf(evicted) + 1);
  await expect.poll(() => afterEviction().includes(activated)).toBe(true);
  const reloaded = afterEviction();
  expect(reloaded.filter((event) => event === loaded).length, events.join(" | ")).toBe(1);
  expect(reloaded.indexOf(loaded), events.join(" | ")).toBeLessThan(reloaded.indexOf(activated));
  expect(errors).toEqual([]);
});
