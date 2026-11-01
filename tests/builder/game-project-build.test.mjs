import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { buildPath, captureInputs, latestBuild, outputInventory, runtimeProjectManifest, validateBase } from "../../builder/web/game-project-build.mjs";
import { installReproductionDependencies } from "../../builder/web/game-project-reproduce.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "forge-build-unit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("clean installation retries only missing offline cache entries with the same locked npm ci", () => {
  const calls = [];
  const command = installReproductionDependencies("fixture", "npm-cli.js", (_node, args) => {
    calls.push(args);
    if (calls.length === 1) throw Object.assign(new Error("cache missing"), { stderr: "npm error ENOTCACHED" });
    return "";
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], "--offline");
  assert.equal(calls[1][2], "--prefer-offline");
  assert.ok(calls.every((args) => args[1] === "ci" && args.includes("--ignore-scripts")));
  assert.match(command, /--prefer-offline/);
  let attempts = 0;
  assert.throws(() => installReproductionDependencies("fixture", "npm-cli.js", () => {
    attempts++; throw Object.assign(new Error("access denied"), { stderr: "EACCES" });
  }), /access denied/);
  assert.equal(attempts, 1);
});

test("build input capture includes dirty/untracked source bytes but excludes authoring projects, dependencies and local settings", async (t) => {
  const root = await fixture(t);
  for (const dir of ["src", "public", "node_modules", ".forge", "tools/raw-assets"]) await mkdir(resolve(root, dir), { recursive: true });
  for (const path of ["src/game.ts", "public/scene.json", "node_modules/private.txt", "forge.local.json", ".forge/latest-build.json", "tools/raw-assets/large.bin"]) {
    await writeFile(resolve(root, path), path);
  }
  const forge = await captureInputs(root, "forge");
  assert.deepEqual(forge.files.map((file) => file.path), ["src/game.ts"]);
  const game = await captureInputs(root, "game");
  assert.deepEqual(game.files.map((file) => file.path), ["public/scene.json", "src/game.ts"]);
  assert.equal(Buffer.from(game.files[0].content, "base64").toString(), "public/scene.json");
  await writeFile(resolve(root, "src/game.ts"), "changed");
  assert.notEqual((await captureInputs(root, "forge")).digest, forge.digest);
});

test("production manifest keeps boot data while removing source entries, dev URLs and authoring settings", () => {
  const result = runtimeProjectManifest({ schema: 1, name: "Test", type: "three-game", version: "0.0.0", publicDir: "public", entry: "forge:default",
    game: { module: "src/game/module.ts", editorCatalog: "src/game/catalog.ts" },
    editor: { defaultScene: "layouts/game.json", assetManifest: "assets/manifest.json", previewUrl: "http://127.0.0.1:5175", metadataSchema: "dev.json" },
    scripts: { build: "local tool" }, output: { distDir: "dist" } });
  assert.deepEqual(result.editor, { defaultScene: "layouts/game.json", assetManifest: "assets/manifest.json" });
  assert.equal(result.entry, "index.html");
  assert.equal(result.game, undefined);
  assert.deepEqual(result.scripts, {});
  for (const base of ["/", "/ridgebound/", "/games/ridgebound/"]) assert.equal(validateBase(base), base);
  for (const base of ["https://host/", "/../", "/ridgebound", "C:/"]) assert.throws(() => validateBase(base));
});

test("build paths and inventory reject traversal, output links and local/dev source leakage", async (t) => {
  const root = await fixture(t);
  await mkdir(resolve(root, "outside"));
  await mkdir(resolve(root, "project"));
  const project = resolve(root, "project");
  for (const path of ["../outside", "C:/outside"]) await assert.rejects(buildPath(project, path));
  await symlink(resolve(root, "outside"), resolve(project, "builds"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildPath(project, "builds/new/dist"), /links/);
  const dist = resolve(root, "dist");
  await mkdir(dist);
  await writeFile(resolve(dist, "index.html"), "<title>Game</title>");
  const clean = await outputInventory(dist);
  assert.equal(clean.length, 1);
  for (const content of ["C:\\Users\\example\\game", "/@fs/local/file", "/__save-layout", "file:///local/file"]) {
    await writeFile(resolve(dist, "index.html"), content);
    await assert.rejects(outputInventory(dist), /Local\/dev/);
  }
});

test("preview selection verifies the accepted artifact rather than silently accepting edited output", async (t) => {
  const root = await fixture(t);
  const dist = resolve(root, "builds/test/dist");
  await mkdir(dist, { recursive: true });
  await mkdir(resolve(root, ".forge"));
  await writeFile(resolve(dist, "index.html"), "original");
  const output = await outputInventory(dist);
  const digest = createHash("sha256").update(JSON.stringify(output)).digest("hex");
  await writeFile(resolve(root, "builds/test/build-record.json"), JSON.stringify({ schema: 1, status: "verified-build", outputDigest: digest }));
  await writeFile(resolve(root, ".forge/latest-build.json"), JSON.stringify({ schema: 1, directory: "builds/test" }));
  assert.equal((await latestBuild(root)).dist, dist);
  await writeFile(resolve(dist, "index.html"), "modified");
  await assert.rejects(latestBuild(root), /changed after verification/);
  assert.equal(await readFile(resolve(dist, "index.html"), "utf8"), "modified");
});
