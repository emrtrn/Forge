import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACE = resolve(REPO_ROOT, ".playwright-smoke");
const FIXTURES = resolve(REPO_ROOT, "tests/smoke/fixtures");
// Keep the default stable; an explicitly chosen free port lets a user's dev:smoke stay open.
export const SMOKE_PORT = Number(process.env.FORGE_SMOKE_PORT ?? 5273);
if (!Number.isInteger(SMOKE_PORT) || SMOKE_PORT < 1024 || SMOKE_PORT > 65535 || SMOKE_PORT === 5173) {
  throw new Error("FORGE_SMOKE_PORT must be an unprivileged port other than the authoring port 5173");
}
export const SMOKE_SCENE = "layouts/__playwright-smoke.level.json";
export const SMOKE_TARGET_SCENE = "layouts/__playwright-smoke-target.level.json";
export const SMOKE_PATROL_SCENE = "layouts/__playwright-smoke-patrol.level.json";
export const SMOKE_SPLINE_SCENE = "layouts/__playwright-smoke-spline.level.json";
/** The spline scene's one-tile World Terrain; its tile binary sits beside it (`smoke-road.tiles/0_0.tile.bin`). */
export const SMOKE_ROAD_TERRAIN = "landscapes/smoke-road.terrain.json";
const SMOKE_ROAD_TILE = "landscapes/smoke-road.tiles/0_0.tile.bin";
const RUNTIME_PARITY_SCENE = "layouts/RuntimeParity.level.json";
/**
 * Test-only levels (`fixtures/levels/`, e.g. LandscapeTest, OffroadTest) are
 * copied here in the isolated public directory; `public/` never ships them, so
 * the project's own Levels folder stays the user's to create and delete in.
 */
export const SMOKE_TEST_LEVELS = "test-levels";
const SMOKE_MENU = "assets/__playwright-smoke-menu.ui.json";

export function assertSmokeRoot(root) {
  const absolute = resolve(root);
  if (dirname(absolute) !== WORKSPACE || !absolute.startsWith(WORKSPACE + sep + "run-")) {
    throw new Error("Smoke project must be a run-* directory directly inside .playwright-smoke");
  }
  return absolute;
}

export function smokeRunRoot() {
  const root = process.env.FORGE_SMOKE_PROJECT_ROOT;
  if (!root) throw new Error("Smoke project root was not assigned by playwright.config.ts");
  return assertSmokeRoot(root);
}

export function smokePublicPath(path, root = smokeRunRoot()) {
  const publicRoot = resolve(assertSmokeRoot(root), "public");
  const absolute = resolve(publicRoot, path);
  if (absolute !== publicRoot && !absolute.startsWith(publicRoot + sep)) {
    throw new Error("Smoke path escapes its isolated public directory");
  }
  return absolute;
}

async function readJson(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}

const WALK_CORRIDOR_X = 4;

function ensureInstanceGroup(scene, assetId) {
  if (!Array.isArray(scene.instances)) scene.instances = [];
  let group = scene.instances.find((entry) => entry?.assetId === assetId);
  if (!group) {
    group = { assetId, placements: [] };
    scene.instances.push(group);
  }
  if (!Array.isArray(group.placements)) group.placements = [];
  return group;
}

function prepareSmokeSourceScene(scene) {
  const copy = structuredClone(scene);
  copy.name = "__playwright-smoke";
  copy.characters = [];
  copy.actors = [];
  // Authoring cases start without actors/volumes that could collide with their
  // count/name assertions. The source is the committed test base, not a demo.
  copy.targetPoints = [];
  copy.aiNavigationVolumes = [];
  copy.blockingVolumes = [];
  copy.reflectiveSurfaces = [];
  copy.reflectionPlanes = [];
  copy.reflectionCaptures = [];
  copy.worldSettings = {
    ...(copy.worldSettings ?? {}),
    gameMode: "assets/starter-content/Gameplay/Script_GameMode.actor.json",
    hudWidget: "hud",
    pauseMenuWidget: "menu",
    locale: "en",
  };

  const starts = ensureInstanceGroup(copy, "marker:playerStart");
  starts.placements = [
    {
      position: [WALK_CORRIDOR_X, 0, 0],
      name: "Player Start",
      collision: false,
      rotationYDeg: 0,
      scale: 1,
    },
  ];

  // Ground for the whole walk line. `Floor_400x400.glb`'s origin sits at a
  // *corner* (local x/z run 0..4), so the placement position is the floor's
  // near corner, not its centre: a 4 m mesh at scale 4 covers
  // x ∈ [-8, 8], z ∈ [-14, 2], covering the whole walk corridor from the Player
  // Start down to the portal at z = -10. Getting this wrong is silent and looks
  // like a movement bug: the pawn simply walks off the edge, falls past killZ
  // and respawns at the start, forever.
  const floor = ensureInstanceGroup(copy, "floor-400x400");
  floor.placements = [
    {
      position: [-8, 0, -14],
      rotationYDeg: 0,
      scale: 4,
      scaleLocked: true,
    },
  ];

  // Two runtime gameplay sensors on the pawn's forward (-Z) walk line, both off
  // the origin so the non-moving smokes (runtime-playflow, ai-patrol, editor) never
  // trip them at boot. The locomotion smoke only nudges the pawn ~1m, so it never
  // reaches the checkpoint at z=-4; the checkpoint/portal smokes walk into them.
  const triggers = ensureInstanceGroup(copy, "shape:cube");
  triggers.placements = [
    {
      position: [WALK_CORRIDOR_X, 1, -4],
      name: "Smoke Checkpoint",
      scale: [12, 4, 3],
      sensor: true,
      collisionPreset: "trigger",
      behavior: { script: "checkpoint", params: { slot: "quick" } },
    },
    {
      // Interaction sensor between the checkpoint and the portal: walking into it
      // emits an "Interaction.Activated" script message, giving the Actor Runtime
      // API (A6 messaging) smoke an observable script-message flow in the ?debug
      // "script messages" block — no key press needed (no authored inputAction).
      position: [WALK_CORRIDOR_X, 1, -6],
      name: "Smoke Interact",
      scale: [12, 4, 2],
      sensor: true,
      collisionPreset: "trigger",
      behavior: { script: "interact" },
      interaction: { action: "activate", prompt: "Activate" },
    },
    {
      position: [WALK_CORRIDOR_X, 1, -10],
      name: "Smoke Portal",
      scale: [12, 4, 3],
      sensor: true,
      collisionPreset: "trigger",
      behavior: {
        script: "level-travel",
        params: {
          targetLevel: "layouts/__playwright-smoke-target.level.json",
          targetSpawn: "arrival",
        },
      },
    },
  ];

  return copy;
}

function prepareSmokeTargetScene(scene) {
  const copy = structuredClone(scene);
  copy.name = "__playwright-smoke-target";
  copy.characters = [];
  copy.actors = [];
  copy.worldSettings = {
    ...(copy.worldSettings ?? {}),
    gameMode: "assets/starter-content/Gameplay/Script_GameMode.actor.json",
    hudWidget: "hud",
    pauseMenuWidget: "menu",
    locale: "en",
  };

  const starts = ensureInstanceGroup(copy, "marker:playerStart");
  starts.placements = [
    {
      position: [WALK_CORRIDOR_X, 0, 0],
      name: "Player Start",
      collision: false,
      rotationYDeg: 0,
      scale: 1,
      metadata: { spawnTag: "arrival" },
    },
  ];

  // Same corner-origin arithmetic as the source scene: cover the arrival point
  // at the origin and the return portal at z = -6.
  const floor = ensureInstanceGroup(copy, "floor-400x400");
  floor.placements = [
    {
      position: [-8, 0, -14],
      rotationYDeg: 0,
      scale: 4,
      scaleLocked: true,
    },
  ];

  // Return portal on the arrival scene's forward (-Z) walk line: travelling into it
  // sends the pawn back to the source smoke level, letting the portal round-trip
  // smoke prove a second `level-travel` sensor fires in the same session (behavior
  // registry freshness — the same trigger id can fire again in a new scene visit).
  const returnPortal = ensureInstanceGroup(copy, "shape:cube");
  returnPortal.placements = [
    {
      position: [WALK_CORRIDOR_X, 1, -6],
      name: "Smoke Return Portal",
      scale: [12, 4, 3],
      sensor: true,
      collisionPreset: "trigger",
      behavior: {
        script: "level-travel",
        params: { targetLevel: "layouts/__playwright-smoke.level.json" },
      },
    },
  ];

  return copy;
}

function prepareSmokePatrolScene(scene) {
  const copy = structuredClone(scene);
  copy.name = "__playwright-smoke-patrol";
  copy.worldSettings = {
    ...(copy.worldSettings ?? {}),
    hudWidget: "hud",
    pauseMenuWidget: "menu",
    locale: "en",
  };
  return copy;
}

function prepareSmokeMenu(menu) {
  const copy = structuredClone(menu);
  copy.name = "Playwright Smoke Menu";
  const panel = copy.root?.children?.find((child) => child?.id === "panel");
  const footer = panel?.children?.find((child) => child?.id === "footer");
  if (!footer || !Array.isArray(footer.children)) {
    throw new Error("SaveLoadMenu smoke fixture is missing footer children");
  }
  footer.children.unshift({
    id: "smoke-travel",
    widget: "Button",
    props: {
      text: "Travel",
      onClick: {
        type: "message",
        message: `travel:${SMOKE_TARGET_SCENE}#arrival`,
      },
    },
  });
  footer.children.unshift({
    id: "smoke-parity",
    widget: "Button",
    props: {
      text: "Parity",
      onClick: {
        type: "message",
        message: `travel:${RUNTIME_PARITY_SCENE}`,
      },
    },
  });
  footer.children.unshift({
    id: "smoke-patrol",
    widget: "Button",
    props: {
      text: "Patrol",
      onClick: {
        type: "message",
        message: `travel:${SMOKE_PATROL_SCENE}`,
      },
    },
  });
  return copy;
}


/** Where the road terrain's grid centre (its Landscape actor) sits. */
const ROAD_CENTRE = [0, -0.1, 0];

/**
 * A flat one-tile World Terrain under the road, painted fully with its first
 * layer, and the road spline in world space. Points are authored around the
 * grid centre.
 */
function roadTerrain(fixture) {
  const quads = fixture.vertices - 1;
  const points = fixture.points.map((position, index) => ({
    id: "point-" + (index + 1), width: 2, falloff: 1,
    position: position.map((value, axis) => Number((value + ROAD_CENTRE[axis]).toFixed(4))),
  }));
  const def = {
    schema: 1, type: "worldTerrain", name: "Landscape", tileQuads: quads, spacing: 1, tilesX: 1, tilesZ: 1,
    origin: [ROAD_CENTRE[0] - quads / 2, ROAD_CENTRE[1], ROAD_CENTRE[2] - quads / 2], heightMin: -256, heightMax: 256,
    layers: [
      { id: "grass", name: "Grass", color: "#5f9449", material: "starter-mat-grass" },
      { id: "dirt", name: "Dirt", color: "#8a6441" },
      { id: "rock", name: "Rock", color: "#7d7d7d" },
      { id: "snow", name: "Snow", color: "#dce7ec" },
    ],
    tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }],
    collision: true,
    splines: [{
      id: "smoke-road", coordinateSpace: "world", points,
      segments: points.slice(1).map((point, index) => ({
        id: "segment-" + (index + 1), startPointId: points[index].id, endPointId: point.id,
        mesh: structuredClone(fixture.mesh),
      })),
    }],
  };
  return { def, tile: flatTerrainTile(fixture.vertices, def.layers.length) };
}

/** A flat tile in the engine's FTIL layout: Float32 heights, layer 0 fully weighted. */
function flatTerrainTile(size, layerCount) {
  const count = size * size;
  const blocks = Math.ceil(layerCount / 4);
  const bytes = Buffer.alloc(32 + count * 4 + blocks * count * 4);
  bytes.write("FTIL", 0, "latin1");
  bytes.writeUInt16LE(1, 4); // version
  bytes.writeUInt16LE(1, 6); // f32 heights
  bytes.writeUInt16LE(size, 8);
  bytes.writeUInt8(layerCount, 10);
  bytes.writeFloatLE(-256, 12);
  bytes.writeFloatLE(256, 16);
  const weights = 32 + count * 4;
  for (let index = 0; index < count; index++) bytes[weights + index * 4] = 255;
  return bytes;
}

/** Copy assets once; every test resets only the mutable fixture documents. */
export async function prepareSmokeProject(root = smokeRunRoot(), sourceRoot = REPO_ROOT) {
  root = assertSmokeRoot(root);
  await mkdir(root, { recursive: true });
  // A real copy, never a link: save/delete/rename endpoints cannot touch authoring files.
  // The gitignored `npm run world:test` output (~100 MB) is local, not project content.
  await cp(resolve(sourceRoot, "public"), smokePublicPath("", root), {
    recursive: true, dereference: true,
    filter: (path) => !/[\\/]public[\\/]layouts[\\/]OpenWorldTest\.(level\.json|landscapes)$/.test(path),
  });
  await cp(resolve(FIXTURES, "levels"), smokePublicPath(SMOKE_TEST_LEVELS, root), { recursive: true });
  await mkdir(resolve(root, "src/game/scripts"), { recursive: true });
  const manifest = await readJson(smokePublicPath("project.3dgame.json", root));
  const assets = await readJson(smokePublicPath("assets/manifest.json", root));
  const base = await readJson(resolve(FIXTURES, "base.level.json"));
  const source = prepareSmokeSourceScene(base);
  const patrol = prepareSmokePatrolScene({
    ...base, ...await readJson(resolve(FIXTURES, "patrol.level.json")),
    lights: base.lights,
    instances: source.instances.filter((group) => group.assetId !== "shape:cube"),
  });
  const road = roadTerrain(await readJson(resolve(FIXTURES, "road.json")));
  const spline = structuredClone(source);
  spline.name = "__playwright-smoke-spline";
  spline.instances = spline.instances.filter((group) => group.assetId !== "shape:cube");
  spline.landscapes = [{ id: "smoke-road", name: "Landscape", position: [...ROAD_CENTRE], dataRef: SMOKE_ROAD_TERRAIN }];
  const menu = prepareSmokeMenu(await readJson(resolve(FIXTURES, "menu.ui.json")));
  const patrolBehavior = await readJson(resolve(FIXTURES, "patrol.behavior.json"));
  // AI libraries load manifest entries, rather than arbitrary class references.
  assets.assets.push({
    id: "smoke-patrol-behavior", name: "Smoke Patrol", assetType: "behaviorTree",
    category: "AI", path: "assets/__playwright-patrol.behavior.json", tags: ["smoke"], placeable: false,
    placement: { surface: "floor", snapToWall: false, allowRotation: false, allowScale: false },
    runtime: { loadGroup: "AI", castShadow: false, receiveShadow: false, collision: false, bytes: Buffer.byteLength(JSON.stringify(patrolBehavior), "utf8") },
    license: "Project-local smoke fixture",
  });
  const menuAsset = assets.assets?.find((asset) => asset.id === "menu");
  if (!menuAsset) throw new Error("Smoke asset manifest is missing menu");
  menuAsset.path = SMOKE_MENU;
  if (menuAsset.runtime) menuAsset.runtime.bytes = Buffer.byteLength(JSON.stringify(menu), "utf8");
  manifest.editor = { ...manifest.editor, defaultScene: SMOKE_SCENE };
  manifest.name = "forge-smoke";
  const documents = {
    "project.3dgame.json": manifest,
    "assets/manifest.json": assets,
    [SMOKE_SCENE]: source,
    [SMOKE_TARGET_SCENE]: prepareSmokeTargetScene(base),
    [SMOKE_PATROL_SCENE]: patrol,
    [SMOKE_SPLINE_SCENE]: spline,
    [SMOKE_ROAD_TERRAIN]: road.def,
    [SMOKE_MENU]: menu,
    "assets/__playwright-ai-character.actor.json": await readJson(resolve(FIXTURES, "ai-character.actor.json")),
    "assets/__playwright-patrol.behavior.json": patrolBehavior,
    "layouts/main.level.json": await readJson(resolve(REPO_ROOT, "templates/game-starter/main.level.json")),
    "layouts/rts.level.json": await readJson(resolve(REPO_ROOT, "templates/rts-starter/main.level.json")),
  };
  const baseline = Object.fromEntries(Object.entries(documents).map(([path, data]) => [path, JSON.stringify(data, null, 2) + "\n"]));
  await writeFile(resolve(root, "baseline.json"), JSON.stringify(baseline), "utf8");
  const binaries = { [SMOKE_ROAD_TILE]: road.tile.toString("base64") };
  await writeFile(resolve(root, "baseline-binary.json"), JSON.stringify(binaries), "utf8");
  await resetSmokeDocuments(root);
}

export async function resetSmokeDocuments(root = smokeRunRoot()) {
  root = assertSmokeRoot(root);
  const documents = await readJson(resolve(root, "baseline.json"));
  for (const [path, raw] of Object.entries(documents)) {
    const target = smokePublicPath(path, root);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, raw, "utf8");
  }
  for (const [path, base64] of Object.entries(await readJson(resolve(root, "baseline-binary.json")))) {
    const target = smokePublicPath(path, root);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(base64, "base64"));
  }
}

/** Only ever removes the validated per-run project, including failed test writes. */
export async function cleanupSmokeProject(root = smokeRunRoot()) {
  root = assertSmokeRoot(root);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
