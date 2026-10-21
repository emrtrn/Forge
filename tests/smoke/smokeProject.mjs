import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACE = resolve(REPO_ROOT, ".playwright-smoke");
const FIXTURES = resolve(REPO_ROOT, "tests/smoke/fixtures");
export const SMOKE_PORT = 5273;
export const SMOKE_SCENE = "layouts/__playwright-smoke.level.json";
export const SMOKE_TARGET_SCENE = "layouts/__playwright-smoke-target.level.json";
export const SMOKE_PATROL_SCENE = "layouts/__playwright-smoke-patrol.level.json";
export const SMOKE_SPLINE_SCENE = "layouts/__playwright-smoke-spline.level.json";
export const SMOKE_ROAD_SIDECAR = "landscapes/smoke-road.landscape.json";
const RUNTIME_PARITY_SCENE = "layouts/RuntimeParity.level.json";
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


function roadData(fixture) {
  const vertexCount = fixture.vertices ** 2;
  const points = fixture.points.map((position, index) => ({
    id: "point-" + (index + 1), position, width: 2, falloff: 1,
  }));
  return {
    schema: 1, type: "landscape",
    size: { verticesX: fixture.vertices, verticesZ: fixture.vertices, spacing: 1, heightScale: 1 },
    chunks: { quadsPerChunk: 32 },
    heights: new Array(vertexCount).fill(0),
    layers: [
      { id: "grass", name: "Grass", material: "starter-mat-grass", weights: new Array(vertexCount).fill(1) },
      { id: "dirt", name: "Dirt", weights: new Array(vertexCount).fill(0) },
      { id: "rock", name: "Rock", weights: new Array(vertexCount).fill(0) },
      { id: "snow", name: "Snow", weights: new Array(vertexCount).fill(0) },
    ],
    splines: [{
      id: "smoke-road", points,
      segments: points.slice(1).map((point, index) => ({
        id: "segment-" + (index + 1), startPointId: points[index].id, endPointId: point.id,
        mesh: structuredClone(fixture.mesh),
      })),
    }],
  };
}

/** Copy assets once; every test resets only the mutable fixture documents. */
export async function prepareSmokeProject(root = smokeRunRoot(), sourceRoot = REPO_ROOT) {
  root = assertSmokeRoot(root);
  await mkdir(root, { recursive: true });
  // A real copy, never a link: save/delete/rename endpoints cannot touch authoring files.
  await cp(resolve(sourceRoot, "public"), smokePublicPath("", root), { recursive: true, dereference: true });
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
  const road = roadData(await readJson(resolve(FIXTURES, "road.json")));
  const spline = structuredClone(source);
  spline.name = "__playwright-smoke-spline";
  spline.instances = spline.instances.filter((group) => group.assetId !== "shape:cube");
  spline.landscapes = [{ id: "smoke-road", name: "Landscape", position: [0, -0.1, 0], dataRef: SMOKE_ROAD_SIDECAR }];
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
    [SMOKE_ROAD_SIDECAR]: road,
    "landscapes/landscape-1.landscape.json": { ...road, splines: [] },
    [SMOKE_MENU]: menu,
    "assets/__playwright-ai-character.actor.json": await readJson(resolve(FIXTURES, "ai-character.actor.json")),
    "assets/__playwright-patrol.behavior.json": patrolBehavior,
    "layouts/main.level.json": await readJson(resolve(REPO_ROOT, "templates/game-starter/main.level.json")),
    "layouts/rts.level.json": await readJson(resolve(REPO_ROOT, "templates/rts-starter/main.level.json")),
  };
  const baseline = Object.fromEntries(Object.entries(documents).map(([path, data]) => [path, JSON.stringify(data, null, 2) + "\n"]));
  await writeFile(resolve(root, "baseline.json"), JSON.stringify(baseline), "utf8");
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
}

/** Only ever removes the validated per-run project, including failed test writes. */
export async function cleanupSmokeProject(root = smokeRunRoot()) {
  root = assertSmokeRoot(root);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
