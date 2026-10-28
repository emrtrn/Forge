import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assertSmokeRoot, cleanupSmokeProject, prepareSmokeProject, resetSmokeDocuments,
  smokePublicPath, REPO_ROOT, SMOKE_SCENE, SMOKE_PATROL_SCENE, SMOKE_ROAD_TERRAIN,
} from "../smoke/smokeProject.mjs";

async function sourceFixture(t, defaultScene = "Terrain.level.json") {
  const root = resolve(REPO_ROOT, ".playwright-smoke", `run-fixture-${randomUUID()}`);
  t.after(() => cleanupSmokeProject(root));
  await mkdir(smokePublicPath("assets", root), { recursive: true });
  await mkdir(smokePublicPath("landscapes", root), { recursive: true });
  await writeFile(smokePublicPath("project.3dgame.json", root), JSON.stringify({ name: "original", editor: { defaultScene, assetManifest: "assets/manifest.json" } }));
  await writeFile(smokePublicPath("assets/manifest.json", root), JSON.stringify({ assets: [{ id: "menu", path: "original-menu.json" }] }));
  await writeFile(smokePublicPath("assets/model.glb", root), "original asset bytes");
  await writeFile(smokePublicPath("landscapes/landscape-1.terrain.json", root), "user-authored road with 28 segments");
  return root;
}

function runFixture(t) {
  const root = resolve(REPO_ROOT, ".playwright-smoke", `run-unit-${randomUUID()}`);
  t.after(() => cleanupSmokeProject(root));
  return root;
}

test("smoke scenes do not depend on defaultScene or the editable demo landscape", async (t) => {
  const terrainSource = await sourceFixture(t);
  const playgroundSource = await sourceFixture(t, "Playground.level.json");
  await writeFile(smokePublicPath("landscapes/landscape-1.terrain.json", playgroundSource), "different user landscape");
  const a = runFixture(t);
  const b = runFixture(t);
  await prepareSmokeProject(a, terrainSource);
  await prepareSmokeProject(b, playgroundSource);
  for (const path of [SMOKE_SCENE, SMOKE_PATROL_SCENE, SMOKE_ROAD_TERRAIN, "project.3dgame.json"]) {
    assert.equal(await readFile(smokePublicPath(path, a), "utf8"), await readFile(smokePublicPath(path, b), "utf8"));
  }
  const patrol = JSON.parse(await readFile(smokePublicPath(SMOKE_PATROL_SCENE, a), "utf8"));
  assert.equal(patrol.actors[0].patrolRoute.splineId, patrol.splines[0].id);
  assert.equal(patrol.splines[0].spline.closed, true);
  assert.ok(patrol.aiNavigationVolumes.length > 0);
  const actor = JSON.parse(await readFile(smokePublicPath(patrol.actors[0].classRef, a), "utf8"));
  const ai = actor.components.find((component) => component.component === "AIController");
  const behavior = JSON.parse(await readFile(smokePublicPath(ai.props.behaviorTree, a), "utf8"));
  assert.equal(behavior.root.task, "forge.moveAlongPatrolRoute");
  const manifest = JSON.parse(await readFile(smokePublicPath("assets/manifest.json", a), "utf8"));
  assert.equal(manifest.assets.find((asset) => asset.path === ai.props.behaviorTree)?.assetType, "behaviorTree");
  const road = JSON.parse(await readFile(smokePublicPath(SMOKE_ROAD_TERRAIN, a), "utf8"));
  assert.equal(road.splines[0].segments.length, 3);
  assert.equal(road.type, "worldTerrain");
  const tile = await readFile(smokePublicPath("landscapes/smoke-road.tiles/0_0.tile.bin", a));
  assert.equal(tile.subarray(0, 4).toString("latin1"), "FTIL");
  assert.equal(tile.readUInt16LE(8), road.tileQuads + 1);
});

test("isolated save, delete and cleanup cannot change authoring files", async (t) => {
  const source = await sourceFixture(t);
  const root = runFixture(t);
  const originalManifest = await readFile(smokePublicPath("project.3dgame.json", source), "utf8");
  await prepareSmokeProject(root, source);
  await writeFile(smokePublicPath("project.3dgame.json", root), "failed save");
  await rm(smokePublicPath("assets/model.glb", root));
  await cleanupSmokeProject(root);
  assert.equal(await readFile(smokePublicPath("project.3dgame.json", source), "utf8"), originalManifest);
  assert.equal(await readFile(smokePublicPath("assets/model.glb", source), "utf8"), "original asset bytes");
  assert.equal(await readFile(smokePublicPath("landscapes/landscape-1.terrain.json", source), "utf8"), "user-authored road with 28 segments");
});

test("each test resets saved scenes and manifests after a previous failed case", async (t) => {
  const source = await sourceFixture(t);
  const root = runFixture(t);
  await prepareSmokeProject(root, source);
  const before = await readFile(smokePublicPath(SMOKE_SCENE, root), "utf8");
  await writeFile(smokePublicPath(SMOKE_SCENE, root), "partial save");
  await writeFile(smokePublicPath("assets/manifest.json", root), "bad manifest");
  await resetSmokeDocuments(root);
  assert.equal(await readFile(smokePublicPath(SMOKE_SCENE, root), "utf8"), before);
  assert.equal(JSON.parse(await readFile(smokePublicPath("assets/manifest.json", root), "utf8")).assets[0].id, "menu");
});

test("failed fixture setup leaves the source project intact", async (t) => {
  const source = await sourceFixture(t);
  const root = runFixture(t);
  await writeFile(smokePublicPath("assets/manifest.json", source), '{"assets":[]}');
  const before = await readFile(smokePublicPath("project.3dgame.json", source), "utf8");
  await assert.rejects(prepareSmokeProject(root, source), /missing menu/);
  assert.equal(await readFile(smokePublicPath("project.3dgame.json", source), "utf8"), before);
});

test("smoke path and cleanup guards refuse paths outside a per-run project", async () => {
  assert.throws(() => assertSmokeRoot(REPO_ROOT), /run-\*/);
  assert.throws(() => smokePublicPath("../outside.json", resolve(REPO_ROOT, ".playwright-smoke/run-guard")), /escapes/);
  await assert.rejects(cleanupSmokeProject(resolve(REPO_ROOT, "public")), /run-\*/);
});
