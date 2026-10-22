import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { collectReleaseContent, measureRelease, publicPath, readJson, stageReleaseContent } from "../../builder/web/release-content.mjs";
import { createStarterContent } from "../../builder/web/starter-content.mjs";

const workspace = resolve("builds/release-tests");
const profile = await readJson(resolve("builder/web/profiles/starter.json"));
async function fixture(run) {
  await mkdir(workspace, { recursive: true });
  const root = await mkdtemp(resolve(workspace, "case-"));
  const publicDir = resolve(root, "public");
  try {
    const provenance = await createStarterContent(publicDir);
    const collect = (overrides = {}) => collectReleaseContent({ publicDir, profile: structuredClone(profile), provenance, ...overrides });
    await run({ root, publicDir, provenance, collect });
  } finally {
    if (dirname(root) !== workspace) throw new Error("Invalid test cleanup target");
    await rm(root, { recursive: true, force: true });
  }
}

test("closure includes level travel, model resources, material texture, landscape and sidecars", () => fixture(async ({ publicDir, root, collect }) => {
  const selection = await collect();
  const paths = new Set(selection.files.map((file) => file.path));
  for (const path of ["layouts/destination.level.json", "assets/release/cube.bin", "assets/release/checker.png", "assets/release/cube.materials.json", "assets/release/checker.material.json", "landscapes/starter.landscape.json", "layouts/starter.foliage.json", "layouts/starter.meshpaint.json"]) assert.ok(paths.has(path), path);
  assert.equal(selection.manifest.assets.length, 5);
  const output = resolve(root, "staged");
  const before = await readFile(resolve(publicDir, "project.3dgame.json"));
  await stageReleaseContent(selection, publicDir, output);
  assert.equal((await readJson(resolve(output, "project.3dgame.json"))).editor.defaultScene, profile.defaultScene);
  assert.deepEqual(await readFile(resolve(publicDir, "project.3dgame.json")), before);
  for (const file of selection.files) assert.equal((await readFile(resolve(output, file.path))).length > 0, true);
}));

test("unused Unknown assets are excluded; explicit dynamic includes are checked", () => fixture(async ({ publicDir, collect, provenance }) => {
  const path = resolve(publicDir, "assets/manifest.json");
  const manifest = await readJson(path);
  const extra = { ...structuredClone(manifest.assets[0]), id: "unused", path: "assets/release/unused.gltf", license: "Unknown" };
  manifest.assets.push(extra);
  await writeFile(path, JSON.stringify(manifest));
  assert.equal((await collect()).manifest.assets.length, 5);
  await assert.rejects(collect({ profile: { ...profile, includeAssets: ["unused"] } }), /Unresolved asset license/);
  await assert.rejects(collect({ profile: { ...profile, includeAssets: ["missing"] } }), /Unresolved asset/);
  extra.license = manifest.assets[0].license;
  await writeFile(path, JSON.stringify(manifest));
  await writeFile(resolve(publicDir, extra.path), JSON.stringify({ asset: { version: "2.0" }, buffers: [], images: [] }));
  provenance[extra.path] = provenance["assets/release/cube.gltf"];
  assert.equal((await collect({ profile: { ...profile, includeAssets: ["unused"] } })).manifest.assets.length, 6);
}));

test("terrain definitions close over implicit tile files and enforce their provenance", () => fixture(async ({ publicDir, collect, provenance }) => {
  const path = "landscapes/starter.terrain.json";
  const binary = "landscapes/starter.tiles/0_0.tile.bin";
  const level = await readJson(resolve(publicDir, profile.defaultScene));
  level.landscapes[0].dataRef = path;
  await writeFile(resolve(publicDir, profile.defaultScene), JSON.stringify(level));
  await writeFile(resolve(publicDir, path), JSON.stringify({ schema: 1, type: "worldTerrain", tiles: [{ key: "0_0" }] }));
  provenance[path] = provenance["landscapes/starter.landscape.json"];
  await mkdir(resolve(publicDir, "landscapes/starter.tiles"));
  await writeFile(resolve(publicDir, binary), new Uint8Array([1, 2, 3]));
  await assert.rejects(collect(), /Missing or unresolved provenance/);
  provenance[binary] = provenance[path];
  assert.ok((await collect()).files.some((entry) => entry.path === binary));
  await writeFile(resolve(publicDir, path), JSON.stringify({ type: "worldTerrain", tiles: [{ key: "../0_0" }] }));
  await assert.rejects(collect(), /Invalid terrain tile key/);
}));

test("missing provenance and placeholder status block a selected package", () => fixture(async ({ collect, provenance }) => {
  const path = "assets/release/checker.png";
  const original = provenance[path];
  delete provenance[path];
  await assert.rejects(collect(), /Missing or unresolved provenance/);
  provenance[path] = { ...original, license: "Project-local placeholder" };
  await assert.rejects(collect(), /Missing or unresolved provenance/);
}));

test("third-party resources need source URL, packaged license and attribution", () => fixture(async ({ collect, provenance, publicDir }) => {
  const path = "assets/release/checker.png";
  const original = provenance[path];
  provenance[path] = { kind: "third-party", license: "Example-license", evidence: "example" };
  await assert.rejects(collect(), /Incomplete third-party provenance/);
  provenance[path] = { ...provenance[path], sourceUrl: "https://example.test/asset", licenseFile: "licenses/example.txt", attribution: "Example author" };
  await mkdir(resolve(publicDir, "licenses"));
  await writeFile(resolve(publicDir, "licenses/example.txt"), "Example test license");
  provenance["licenses/example.txt"] = original;
  assert.ok((await collect()).files.some((file) => file.path === "licenses/example.txt"));
}));

test("missing references, invalid JSON and external model resources fail visibly", () => fixture(async ({ collect, publicDir }) => {
  const model = resolve(publicDir, "assets/release/cube.gltf");
  const original = await readFile(model, "utf8");
  const gltf = JSON.parse(original);
  gltf.buffers[0].uri = "missing.bin";
  await writeFile(model, JSON.stringify(gltf));
  await assert.rejects(collect(), /ENOENT/);
  gltf.buffers[0].uri = "https://example.test/untracked.bin";
  await writeFile(model, JSON.stringify(gltf));
  await assert.rejects(collect(), /External glTF resource/);
  await writeFile(model, "{broken");
  await assert.rejects(collect(), SyntaxError);
}));

test("public paths cannot escape staging or use ambiguous query strings", () => {
  for (const path of ["../secret.json", "assets/../../secret.json", "assets/./x.json", "assets//x.json", "https://example.test/a.glb", "a.json?query", "a.json#fragment", "C:\\secret.json"]) assert.throws(() => publicPath(path));
  assert.equal(publicPath("/assets\\model.glb"), "assets/model.glb");
});

test("class-specific package budgets fail on growth and reject incomplete configuration", () => fixture(async ({ root }) => {
  const dist = resolve(root, "dist");
  await mkdir(resolve(dist, "assets"), { recursive: true });
  await writeFile(resolve(dist, "assets/index-test.js"), "x".repeat(100));
  await writeFile(resolve(dist, "assets/model.glb"), "x".repeat(40));
  const budgets = { totalBytes: 130, fileBytes: 200, assetBytes: 200, entryJsBytes: 90, jsBytes: 200, fileCount: 5 };
  const result = await measureRelease(dist, budgets);
  assert.deepEqual(result.failures, ["totalBytes: 140 > 130", "entryJsBytes: 100 > 90"]);
  assert.equal(result.totals.assetBytes, 40);
  await assert.rejects(measureRelease(dist, {}), /All release budget/);
}));
