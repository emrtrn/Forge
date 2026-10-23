import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { extractSpecifiers, findImportViolations, scanImportBoundaries } from "../../builder/web/verify-imports.mjs";

test("import guard parses multiline imports, re-exports, import types and literal dynamic imports", () => {
  const source = [
    'import {\n type T,\n X,\n} from "@/editor/EditorUi";',
    'import Default, { Named } from "@engine/core/example";',
    'import "./side-effect";',
    'export {\n X as Y,\n} from "./re-export";',
    'export * as tools from "@builder/tools";',
    'export * from "./wildcard";',
    'export type {\n T,\n} from "@project/types";',
    'type Imported = import("@/scene/types").T;',
    'type Query = typeof import("@game/query");',
    'import Legacy = require("./legacy");',
    'const load = () => import(\n "@editor/lazy",\n { with: { type: "json" } }\n);',
    'const template = () => import(`./literal`);',
  ].join("\n");
  assert.deepEqual(extractSpecifiers(source), [
    "@/editor/EditorUi", "@engine/core/example", "./side-effect", "./re-export",
    "@builder/tools", "./wildcard", "@project/types", "@/scene/types", "@game/query", "./legacy",
    "@editor/lazy", "./literal",
  ]);
});

test("import guard ignores comments, ordinary strings, regexes and computed module paths", () => {
  const source = [
    '// import X from "@/editor/comment";',
    '/* export * from "@/editor/comment"; import("@/editor/comment"); */',
    'const text = \'import("@/editor/string")\';',
    'const template = `import X from "@/editor/template"`;',
    'const pattern = /import\\("@editor\\/regex"\\)/;',
    'const meta = import.meta.url;',
    'const computed = import(moduleName);',
    'const interpolated = import(`./${moduleName}`);',
  ].join("\n");
  assert.deepEqual(extractSpecifiers(source), []);
});

test("import guard treats TypeScript type-only imports as architectural edges", () => {
  const file = "engine/movement/example.ts";
  for (const source of [
    'import { X } from "@/scene/loader";',
    'import {\n X,\n} from "@/scene/loader";',
    'import type {\n X,\n} from "@/scene/loader";',
    'type X = import("@/scene/loader").X;',
    'export type { X } from "@/scene/loader";',
    'const load = () => import("@/scene/loader");',
    'import X = require("@/scene/loader");',
  ]) {
    assert.deepEqual(findImportViolations(file, source), [{ file, spec: "@/scene/loader", rule: "engine->src" }]);
  }
});

test("import guard resolves every project alias and relative imports with normalized paths", () => {
  const file = "engine/movement/example.ts";
  for (const [spec, layer] of [
    ["@editor/panel", "editor"], ["@/editor/panel", "editor"],
    ["@game/rules", "game"], ["@/game/rules", "game"],
    ["@builder/tool", "builder"], ["@project/manifest", "project"],
    ["@/project/ProjectSystem", "project"], ["../../src/scene/loader", "src"],
    ["../../editor/panel", "editor"], ["@engine/../src/editor/panel", "editor"],
    ["@/editor/../game/rules", "game"],
  ]) {
    assert.equal(findImportViolations(file, `import { X } from ${JSON.stringify(spec)};`)[0]?.rule, `engine->${layer}`, spec);
  }
  assert.equal(findImportViolations("engine\\movement\\example.ts", 'import "../../src/scene/loader";')[0]?.rule, "engine->src");
});

test("import guard preserves the editor, game, runtime shell and capability boundary rules", () => {
  for (const [file, spec, rule] of [
    ["editor/panel.ts", "@/game/rules", "editor->game"],
    ["src/editor/panel.ts", "@game/rules", "editor->game"],
    ["game/rules.ts", "@editor/panel", "game->editor"],
    ["src/game/rules.ts", "@/editor/panel", "game->editor"],
    ["src/scene/RuntimeSceneApp.ts", "@/editor/panel", "runtime->editor"],
    ["src/scene/RuntimeSceneApp.ts", "@/game/rules", "runtime->game"],
    ["src/scene/capabilities/example.ts", "@/editor/panel", "capability->editor"],
    ["src/scene/capabilities/example.ts", "@/game/rules", "capability->game"],
  ]) {
    assert.equal(findImportViolations(file, `export {\n X,\n} from ${JSON.stringify(spec)};`)[0]?.rule, rule);
  }
});

test("import guard allows engine internals, external packages and host composition", () => {
  for (const [file, spec] of [
    ["engine/movement/example.ts", "../animation/blendSpace"],
    ["engine/movement/example.ts", "@engine/scene/layout"],
    ["engine/movement/example.ts", "three"],
    ["engine/movement/example.ts", "@dimforge/rapier3d-compat"],
    ["src/editor/panel.ts", "@/scene/assetSkeletonLoader"],
    ["src/main.ts", "@/game/gameModule"],
    ["src/main.ts", "@/editor/EditorUi"],
    ["src/scene/capabilities/example.ts", "@engine/core/EngineApp"],
  ]) {
    assert.deepEqual(findImportViolations(file, `import { X } from ${JSON.stringify(spec)};`), []);
  }
});

test("import guard parses TSX without mistaking JSX text for an import", () => {
  const source = 'import type {\n X,\n} from "@/game/rules"; const view = <div>import</div>;';
  assert.equal(findImportViolations("src/editor/view.tsx", source)[0]?.rule, "editor->game");
});

test("import guard reports malformed source as a scan error", () => {
  assert.throws(() => extractSpecifiers('import { X from "@/editor/panel";', "engine/broken.ts"), /engine\/broken\.ts:1:/);
});

function temporaryProject(t) {
  const root = mkdtempSync(join(tmpdir(), "forge-import-guard-"));
  t.after(() => {
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("forge-import-guard-")) {
      throw new Error(`Unexpected fixture cleanup path: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "engine"));
  return root;
}

test("import guard scanner rejects a real multiline fixture and ignores excluded files", async (t) => {
  const root = temporaryProject(t);
  writeFileSync(join(root, "engine/example.mts"), 'import {\n X,\n} from "@/scene/loader";');
  writeFileSync(join(root, "engine/allowed.cts"), 'import X = require("three");');
  mkdirSync(join(root, "engine/node_modules"));
  writeFileSync(join(root, "engine/node_modules/ignored.ts"), 'import "@/editor/panel";');
  const result = await scanImportBoundaries(root);
  assert.equal(result.fileCount, 2);
  assert.deepEqual(result.violations, [{ file: "engine/example.mts", spec: "@/scene/loader", rule: "engine->src" }]);
});

test("import guard command sets a failing exit code for violations and succeeds after correction", (t) => {
  const root = temporaryProject(t);
  const file = join(root, "engine/example.ts");
  const scriptUrl = new URL("../../builder/web/verify-imports.mjs", import.meta.url).href;
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", `import { main } from ${JSON.stringify(scriptUrl)}; await main(${JSON.stringify(root)});`], { encoding: "utf8" });
  writeFileSync(file, 'import {\n X,\n} from "@/scene/loader";');
  const forbidden = run();
  assert.equal(forbidden.error, undefined);
  assert.equal(forbidden.status, 1);
  assert.match(forbidden.stderr, /engine->src/);
  writeFileSync(file, 'import {\n X,\n} from "@engine/animation/blendSpace";');
  const allowed = run();
  assert.equal(allowed.error, undefined);
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /\[PASS\]/);
});
