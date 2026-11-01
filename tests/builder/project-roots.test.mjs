import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { createServer } from "vite";

const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compiled = await build({
  entryPoints: [resolve(forgeRoot, "tools/projectPaths.ts")],
  bundle: true, write: false, format: "esm", platform: "node",
});
const { createProjectPaths } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const workspace = await mkdtemp(resolve(tmpdir(), "forge-project-roots-"));
  // Only the exact mkdtemp-owned directory is removed; links are not traversed.
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const roots = ["a", "b"].map((name) => resolve(workspace, name));
  for (const [index, root] of roots.entries()) {
    await mkdir(resolve(root, "public/assets"), { recursive: true });
    await mkdir(resolve(root, "public/layouts"));
    await mkdir(resolve(root, "public/game-data"));
    await writeFile(resolve(root, "public/assets/manifest.json"), JSON.stringify({ schema: 1, assets: [] }));
    await writeFile(resolve(root, "public/game-data/test.json"), JSON.stringify({ owner: index }));
    await writeFile(resolve(root, "public/layouts/main.level.json"), JSON.stringify({ schema: 1, name: `project-${index}`, loadGroups: [], instances: [], characters: [] }));
    await writeFile(resolve(root, "public/project.3dgame.json"), JSON.stringify({
      schema: 1, name: `project-${index}`, type: "three-game", version: "0.1.0", entry: "src/main.ts", publicDir: "public",
      editor: { defaultScene: "layouts/main.level.json", assetManifest: "assets/manifest.json" }, scripts: {}, output: { distDir: "dist" },
    }));
  }
  return { workspace, a: roots[0], b: roots[1] };
}

async function serverFor(t, projectRoot) {
  const previous = process.env.FORGE_PROJECT_ROOT;
  process.env.FORGE_PROJECT_ROOT = projectRoot;
  let server;
  try {
    server = await createServer({
      configFile: resolve(forgeRoot, "vite.config.ts"),
      cacheDir: resolve(projectRoot, "vite-cache"),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
  } finally {
    if (previous === undefined) delete process.env.FORGE_PROJECT_ROOT;
    else process.env.FORGE_PROJECT_ROOT = previous;
  }
  t.after(() => server.close());
  await server.listen();
  const base = server.resolvedUrls.local[0];
  return async (path, payload, raw = false) => {
    const response = await fetch(new URL(path, base), payload === undefined ? {} : {
      method: "POST", headers: { "content-type": raw ? "application/octet-stream" : "application/json" }, body: raw ? payload : JSON.stringify(payload),
    });
    const text = await response.text();
    return { status: response.status, text, json: () => JSON.parse(text) };
  };
}

test("project selection fails closed and fences new public/source paths", async (t) => {
  const { a, b } = await fixture(t);
  const paths = createProjectPaths({ forgeRoot, projectRoot: a });
  assert.equal(paths.publicPath("assets/new/file.json"), resolve(a, "public/assets/new/file.json"));
  assert.equal(paths.sourcePath("src/game/scripts/new.ts"), resolve(a, "src/game/scripts/new.ts"));
  for (const path of ["../b/file", "..\\b\\file", "C:/outside.json", "//server/share", "/outside"]) {
    assert.throws(() => paths.publicPath(path));
  }
  assert.throws(() => paths.sourcePath("src/game/scripts/../../outside.ts"));
  assert.throws(() => paths.sourcePath("src/main.ts"));
  for (const root of ["", resolve(a, "missing")]) assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: root }));
  await writeFile(resolve(b, "public/project.3dgame.json"), "{}");
  assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: b }), /Invalid project manifest/);
  await writeFile(resolve(b, "public/project.3dgame.json"), "invalid json");
  assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: b }));
  assert.equal(createProjectPaths({ forgeRoot }).root.toLowerCase(), forgeRoot.toLowerCase());
});

// Compare every fixture file, not only its manifest: side effects in the other
// project's assets, scene or sidecars must also fail this acceptance check.
async function inventory(root) {
  const result = {};
  for (const path of (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())) {
    const absolute = resolve(path.parentPath, path.name);
    result[absolute.slice(root.length)] = (await readFile(absolute)).toString("base64");
  }
  return result;
}

test("import, reimport and model sidecars stay in the selected project through rename/copy/delete", async (t) => {
  const { a, b } = await fixture(t);
  const beforeB = await inventory(b);
  const api = await serverFor(t, a);
  const model = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }));
  assert.equal((await api("/__import-asset?dir=assets&name=Probe.gltf", model, true)).status, 200);
  assert.equal((await api("/__import-asset?dir=assets&name=Probe.gltf", model, true)).status, 409);
  const collision = { complexity: "projectDefault", preset: "blockAll", primitives: [] };
  assert.equal((await api("/__save-collision", { path: "assets/Probe.collision.json", collision })).status, 200);
  assert.equal((await api("/__reimport-asset?path=assets/Probe.gltf&name=Probe.gltf", model, true)).status, 200);
  assert.equal((await api("/__content-rename", { path: "assets/Probe.gltf", name: "Renamed" })).status, 200);
  const sidecar = await readFile(resolve(a, "public/assets/Renamed.collision.json"), "utf8");
  assert.deepEqual(JSON.parse(sidecar), collision);
  await assert.rejects(readFile(resolve(a, "public/assets/Probe.collision.json")), { code: "ENOENT" });
  assert.equal((await api("/__content-new", { kind: "folder", dir: "assets", name: "Copies" })).status, 200);
  const copied = await api("/__content-transfer", { source: "assets/Renamed.gltf", destinationDir: "assets/Copies", operation: "copy" });
  assert.equal(copied.status, 200);
  const copiedPath = copied.json().path;
  assert.equal(await readFile(resolve(a, `public/${copiedPath.replace(".gltf", ".collision.json")}`), "utf8"), sidecar);
  for (const path of ["assets/Renamed.gltf", copiedPath]) {
    assert.equal((await api("/__content-delete", { path })).status, 200);
    await assert.rejects(readFile(resolve(a, `public/${path.replace(".gltf", ".collision.json")}`)), { code: "ENOENT" });
  }
  for (const dir of ["../b/public/assets", "/outside", "C:/outside", "\\\\server\\share"]) {
    assert.equal((await api(`/__import-asset?dir=${encodeURIComponent(dir)}&name=Rejected.gltf`, model, true)).status, 400, dir);
  }
  for (const path of ["../b/public/assets/probe.collision.json", "C:/probe.collision.json"]) {
    assert.equal((await api("/__save-collision", { path, collision })).status, 400);
  }
  for (const path of ["/assets/Renamed.gltf", "C:/assets/Renamed.gltf", "\\\\server\\share\\a.gltf"]) {
    for (const [endpoint, payload] of [
      ["/__content-rename", { path, name: "Rejected" }],
      ["/__content-delete", { path }],
      ["/__content-transfer", { source: path, destinationDir: "assets", operation: "copy" }],
      ["/__content-new", { dir: path, kind: "folder", name: "Rejected" }],
      ["/__open-level", { path: `${path}.json` }],
    ]) assert.equal((await api(endpoint, payload)).status, 400, `${endpoint}: ${path}`);
    assert.equal((await api(`/__reimport-asset?path=${encodeURIComponent(path)}&name=a.gltf`, model, true)).status, 400);
  }
  assert.equal((await api("/__save-gamedata", { path: "/game-data/test.json", data: {} })).status, 400);
  assert.deepEqual(await inventory(b), beforeB);
});

test("two live servers isolate static reads, saves, content operations, behavior stubs and Git defaults", async (t) => {
  const { a, b } = await fixture(t);
  const originals = await Promise.all([b, forgeRoot].map((root) => readFile(resolve(root, "public/project.3dgame.json"), "utf8")));
  execFileSync("git", ["init", "-b", "main", a], { stdio: "pipe" });
  execFileSync("git", ["add", "public"], { cwd: a, stdio: "pipe" });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"], { cwd: a, stdio: "pipe" });
  const apiA = await serverFor(t, a);
  const apiB = await serverFor(t, b);
  assert.equal((await apiA("/project.3dgame.json")).json().name, "project-0");
  assert.equal((await apiB("/project.3dgame.json")).json().name, "project-1");
  assert.equal((await apiA("/__save-layout", {
    layout: { schema: 1, name: "saved-a", loadGroups: [], instances: [], characters: [] },
    editor: { gridSize: 0.5 },
  })).status, 200);
  assert.equal(JSON.parse(await readFile(resolve(a, "public/layouts/main.level.json"), "utf8")).name, "saved-a");
  assert.equal((await apiA("/__save-gamedata", { path: "game-data/test.json", data: { edited: true } })).status, 200);
  assert.deepEqual((await apiA("/__gamedata-defaults?path=game-data/test.json")).json().data, { owner: 0 });
  assert.equal((await apiB("/__gamedata-defaults?path=game-data/test.json")).status, 400);
  assert.equal((await apiA("/__new-behavior", { scriptId: "ridgebound.test" })).status, 200);
  assert.match(await readFile(resolve(a, "src/game/scripts/ridgebound-test.ts"), "utf8"), /ridgebound.test/);
  assert.equal((await apiA("/__content-new", { kind: "folder", dir: "assets", name: "Test" })).status, 200);
  assert.equal((await apiA("/__content-new", { kind: "material", dir: "assets/Test", name: "Example" })).status, 200);
  assert.equal((await apiA("/__content-rename", { path: "assets/Test", name: "Renamed" })).status, 200);
  assert.equal((await apiA("/assets/Renamed/Example.material.json")).status, 200);
  assert.equal((await apiA("/__content-delete", { path: "assets/Renamed" })).status, 200);
  assert.equal((await apiA("/__save-gamedata", { path: "../b/public/game-data/test.json", data: {} })).status, 400);
  assert.equal((await apiA("/__save-gamedata", { path: resolve(b, "public/game-data/test.json"), data: {} })).status, 400);
  assert.deepEqual(await Promise.all([b, forgeRoot].map((root) => readFile(resolve(root, "public/project.3dgame.json"), "utf8"))), originals);
  assert.deepEqual((await apiB("/game-data/test.json")).json(), { owner: 1 });
  await assert.rejects(readFile(resolve(b, "src/game/scripts/ridgebound-test.ts")), { code: "ENOENT" });
});

test("linked project roots and linked public/source descendants cannot grant another project access", async (t) => {
  const { a, b, workspace } = await fixture(t);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(resolve(b, "public"), resolve(a, "public/linked"), linkType);
  await mkdir(resolve(a, "src/game"), { recursive: true });
  await symlink(resolve(b, "public"), resolve(a, "src/game/scripts"), linkType);
  assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: a }), /links are not allowed/);
  await rm(resolve(a, "src/game/scripts"));
  const paths = createProjectPaths({ forgeRoot, projectRoot: a });
  assert.throws(() => paths.publicPath("linked/new.json"), /links are not allowed/);
  const api = await serverFor(t, a);
  assert.equal((await api("/linked/game-data/test.json")).status, 403);
  assert.equal((await api(`/@fs/${resolve(a, "public/linked/game-data/test.json").replaceAll("\\", "/")}`)).status, 403);
  assert.equal((await api("/__save-gamedata", { path: "game-data/../../linked/game-data/test.json", data: {} })).status, 400);
  for (const [endpoint, payload] of [
    ["/__content-new", { kind: "folder", dir: "linked", name: "Forbidden" }],
    ["/__content-rename", { path: "linked/game-data", name: "Forbidden" }],
    ["/__content-delete", { path: "linked/game-data" }],
    ["/__content-transfer", { source: "linked/game-data/test.json", destinationDir: "assets", operation: "copy" }],
  ]) assert.equal((await api(endpoint, payload)).status, 400);
  assert.equal((await api("/__project-dir/linked")).status, 404);
  assert.deepEqual(JSON.parse(await readFile(resolve(b, "public/game-data/test.json"), "utf8")), { owner: 1 });
  const c = resolve(workspace, "c");
  await mkdir(c);
  await symlink(resolve(b, "public"), resolve(c, "public"), linkType);
  assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: c }), /links are not allowed/);
});

test("declared game entries select actual source files and never silently use the template", async (t) => {
  const { a, b } = await fixture(t);
  const manifestPath = resolve(a, "public/project.3dgame.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.game = { module: "src/game/module.ts", editorCatalog: "src/game/catalog.ts" };
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: a }));
  await mkdir(resolve(a, "src/game"), { recursive: true });
  await writeFile(resolve(a, manifest.game.module), 'export function createGameModule() { return { id: "independent-game" }; }');
  await writeFile(resolve(a, manifest.game.editorCatalog), 'export const GAME_EDITOR_CATALOG = { gameModeOptions: [] };');
  const paths = createProjectPaths({ forgeRoot, projectRoot: a });
  assert.equal(paths.gameModulePath, resolve(a, manifest.game.module));
  assert.equal(paths.editorCatalogPath, resolve(a, manifest.game.editorCatalog));
  const api = await serverFor(t, a);
  const main = await api("/src/main.ts");
  assert.equal(main.status, 200);
  assert.match(main.text, /src\/game\/module.ts/);
  assert.match(main.text, /src\/game\/catalog.ts/);
  const source = await api(`/@fs/${paths.gameModulePath.replaceAll("\\", "/")}`);
  assert.equal(source.status, 200);
  assert.match(source.text, /independent-game/);
  const layout = JSON.parse(await readFile(resolve(a, "public/layouts/main.level.json"), "utf8"));
  assert.equal((await api("/__save-layout", { layout })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")).game, manifest.game);
  for (const value of ["src/game/../../../b/src/game/module.ts", "src/game/../../public/test.ts", "src/main.ts", resolve(b, "game.ts")]) {
    manifest.game.module = value;
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.throws(() => createProjectPaths({ forgeRoot, projectRoot: a }));
  }
});
