import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildLevelHlod } from "../../tools/world/hlodBuild";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7f: `world:build`'s HLOD pipeline bakes a partitioned
 * level's cells into proxies, and Play shows the proxy of a cell that is within
 * the view distance but not active, while an active cell keeps its real meshes.
 * Moving the camera (the streaming source of a pawn-less level) next to the far
 * cell swaps its proxy for the real meshes — including shape-cube, a centimetre
 * model under a 0.01 node, which small-object culling must not mistake for a
 * tiny one. The level and its HLOD files are written into the isolated smoke project.
 */

const LEVEL = "layouts/__playwright-hlod.level.json";

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), bytes);
}

test("HLOD: far inactive cells show their baked proxy, active cells their real meshes", async ({ page }) => {
  test.setTimeout(120_000);
  const level = {
    schema: 1,
    name: "__playwright-hlod",
    loadGroups: [],
    characters: [],
    actors: [],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], rotation: [-45, 30, 0], intensity: 3, castShadow: true }],
    worldSettings: {
      backgroundColor: "#c9d8e8",
      killZ: -10,
      viewDistance: 3000,
      staticObjectsCastShadow: true,
      // Cells activate within 96 m (released past 120 m): the tower 400 m away stays inactive.
      partition: { enabled: true, grids: { main: { cellSize: 64, loadRange: 96 }, foliage: { cellSize: 64, loadRange: 256 } } },
    },
    instances: [
      { assetId: "floor-400x400", placements: [
        { name: "near floor", position: [0, 0, 0], rotationYDeg: 0, scale: 4, scaleLocked: true },
        { name: "far floor", position: [400, 0, 16], rotationYDeg: 0, scale: 4, scaleLocked: true },
      ] },
      { assetId: "shape-cube", placements: [
        { name: "far tower", position: [400, 0, 0], rotationYDeg: 0, scale: 10, scaleLocked: true },
      ] },
    ],
  };
  await writeBytes(LEVEL, new TextEncoder().encode(JSON.stringify(level)));
  const built = await buildLevelHlod(LEVEL, {
    read: async (path) => {
      try {
        return new Uint8Array(await readFile(smokePublicPath(path)));
      } catch {
        return null;
      }
    },
  });
  expect(built.index.cells.map((cell) => cell.key)).toEqual(["0_0", "6_0"]);
  for (const [path, bytes] of built.files) await writeBytes(path, bytes);

  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __hlodScenes: any[]; __hlodCamera?: [number, number, number] };
    w.__hlodScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__hlodScenes.push(object);
      // Once set, park the view camera there before each scene render (it then stays put).
      if (object?.isWebGLRenderer) {
        const render = object.render;
        object.render = function (scene: any, view: any) {
          if (w.__hlodCamera && view?.isPerspectiveCamera && scene?.isScene && !scene.overrideMaterial) {
            view.position.set(...w.__hlodCamera);
            view.lookAt(400, 8, 8);
            view.updateMatrixWorld();
          }
          return render.call(this, scene, view);
        };
      }
    });
  });

  await page.goto(`/?hlod=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const proxies = () => page.evaluate(() => {
    const w = window as unknown as { __hlodScenes: any[] };
    const found: Record<string, { visible: boolean; triangles: number; colored: boolean }> = {};
    for (const scene of w.__hlodScenes) scene.traverse((node: any) => {
      if (!node.isMesh || !String(node.name).startsWith("hlod-")) return;
      const geometry = node.geometry;
      found[node.name] = {
        visible: node.visible,
        triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3,
        colored: Boolean(geometry.attributes.color) && node.material.vertexColors === true,
      };
    });
    return found;
  });
  await expect.poll(async () => (await proxies())["hlod-6_0"]?.visible ?? false, { timeout: 30_000 }).toBe(true);
  const result = await proxies();
  expect(result["hlod-6_0"]!.colored).toBe(true);
  expect(result["hlod-6_0"]!.triangles).toBeGreaterThan(0);
  // The spawn cell is active: its real floor draws, so its proxy is never shown.
  expect(result["hlod-0_0"]?.visible ?? false).toBe(false);
  expect(messages.filter((message) => message.includes("[hlod]"))).toEqual([]);

  await page.evaluate(() => { (window as unknown as { __hlodCamera: number[] }).__hlodCamera = [330, 40, 90]; });
  const farCell = () => page.evaluate(() => {
    const w = window as unknown as { __hlodScenes: any[] };
    let proxy: boolean | null = null;
    let tower = false;
    for (const scene of w.__hlodScenes) scene.traverse((node: any) => {
      if (node.name === "hlod-6_0") proxy = node.visible;
      if (node.isInstancedMesh && node.count > 0 && String(node.name).startsWith("shape-cube")) {
        let visible = true;
        for (let parent = node; parent; parent = parent.parent) if (!parent.visible) visible = false;
        if (Math.round(node.instanceMatrix.array[12]) === 400) tower = visible;
      }
    });
    return { proxy, tower };
  });
  await expect.poll(farCell, { timeout: 30_000 }).toEqual({ proxy: false, tower: true });
  expect(errors).toEqual([]);
});
