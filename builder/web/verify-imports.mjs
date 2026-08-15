#!/usr/bin/env node
/**
 * builder/web/verify-imports.mjs
 *
 * Source-level import-graph guard for the module boundaries in
 * docs/architecture/ARCHITECTURE.md (Dependency Rules). Where verify-dist.mjs
 * scans the built `dist/` output, this scans the *source tree* so a forbidden
 * cross-layer import (which still type-checks and passes the tests) is caught at
 * the gate instead of silently rotting the architecture — the risk that matters
 * most in downstream game forks, where a quiet layering break survives merges.
 *
 * Enforced rules (precise / high-signal, mirroring the documented contract):
 *   - engine/**            must not import  editor · game · builder · src · project
 *                          (the engine layer is self-contained: engine + externals only)
 *   - editor/**, src/editor/**   must not import  game
 *                          (editor core stays generic; the game registers with the
 *                           editor via @/editor/gameEditorRegistry, injected by
 *                           src/main.ts — the editor never imports @/game)
 *   - game/**, src/game/**       must not import  editor
 *   - src/scene/RuntimeSceneApp.ts   must not import  editor
 *                          (the Game Mode shell must stay editor-free)
 *   - src/scene/capabilities/**      must not import  editor · game
 *                          (Layer 2 capability modules stay generic: game rules
 *                           belong to Layer 3, authoring to the editor shell)
 *
 * Heuristic like verify-dist: it matches import/export/dynamic-import specifiers
 * with line-anchored patterns (so JSDoc `* import ...` and `// import ...` lines
 * do not false-positive), not a full TS parse. Zero dependencies (Node built-ins
 * only); standalone, not part of the tsc graph or the app bundle.
 *
 * Usage:   node builder/web/verify-imports.mjs
 * Exit:    0 = clean, 1 = a forbidden import (or a scan error).
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");

// Source roots to scan (top-level extracted boundaries + the active src tree).
const SCAN_ROOTS = ["engine", "editor", "builder", "game", "project", "src"];

// Which target layers each source layer may NOT import.
const FORBIDDEN = {
  engine: new Set(["editor", "game", "builder", "src", "project"]),
  editor: new Set(["game"]),
  game: new Set(["editor"]),
  runtime: new Set(["editor"]),
  capability: new Set(["editor", "game"]),
};

const RULE_REASON = {
  "engine->editor": "engine must not import editor",
  "engine->game": "engine must not import game",
  "engine->builder": "engine must not import builder",
  "engine->src": "engine must stay self-contained (no src import)",
  "engine->project": "engine must not import project",
  "editor->game": "editor core stays generic — inject via @/editor/gameEditorRegistry, do not import @/game",
  "game->editor": "game must not import editor",
  "runtime->editor": "the Game Mode shell (RuntimeSceneApp) must stay editor-free",
  "capability->editor": "capability modules (Layer 2) must stay editor-free",
  "capability->game": "capability modules (Layer 2) stay generic — game rules belong to the game module (Layer 3)",
};

const TEXT_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

/** The boundary a source file belongs to, from its repo-relative path. */
function fileLayer(relPath) {
  if (relPath === "src/scene/RuntimeSceneApp.ts") return "runtime";
  if (relPath.startsWith("src/scene/capabilities/")) return "capability";
  if (relPath.startsWith("engine/")) return "engine";
  if (relPath.startsWith("editor/") || relPath.startsWith("src/editor/")) return "editor";
  if (relPath.startsWith("game/") || relPath.startsWith("src/game/")) return "game";
  if (relPath.startsWith("builder/")) return "builder";
  return "other"; // src/scene, src/core, src/main.ts, project — not governed as a source layer
}

/** The boundary a resolved repo-relative path belongs to. */
function classifyPath(relPath) {
  if (relPath.startsWith("engine/")) return "engine";
  if (relPath.startsWith("editor/") || relPath.startsWith("src/editor/")) return "editor";
  if (relPath.startsWith("game/") || relPath.startsWith("src/game/")) return "game";
  if (relPath.startsWith("builder/")) return "builder";
  if (relPath.startsWith("project/") || relPath.startsWith("src/project/")) return "project";
  if (relPath.startsWith("src/")) return "src";
  return "external";
}

/** The boundary an import specifier targets (alias, @/ subtree, or relative). */
function targetLayer(spec, fileDir) {
  if (spec.startsWith("@engine/")) return "engine";
  if (spec.startsWith("@editor/")) return "editor";
  if (spec.startsWith("@builder/")) return "builder";
  if (spec.startsWith("@game/")) return "game";
  if (spec.startsWith("@project/")) return "project";
  if (spec.startsWith("@/")) {
    const rest = spec.slice(2);
    if (rest.startsWith("editor/")) return "editor";
    if (rest.startsWith("game/")) return "game";
    if (rest.startsWith("project/")) return "project";
    return "src";
  }
  if (spec.startsWith(".")) {
    const resolved = toPosix(relative(projectRoot, resolve(fileDir, spec)));
    return classifyPath(resolved);
  }
  return "external"; // bare module: three, @dimforge/*, node:*, etc.
}

const SPEC_PATTERNS = [
  /^\s*import\s[^\n]*?\sfrom\s*["']([^"']+)["']/gm, // import ... from "X"
  /^\s*export\s[^\n]*?\sfrom\s*["']([^"']+)["']/gm, // export ... from "X"
  /^\s*import\s*["']([^"']+)["']/gm, //                 import "X" (side effect)
  /import\s*\(\s*["']([^"']+)["']\s*\)/g, //            import("X") (dynamic)
];

function extractSpecifiers(source) {
  const specs = [];
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && TEXT_EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = [];
  for (const root of SCAN_ROOTS) files.push(...(await walk(join(projectRoot, root))));

  const violations = [];
  for (const file of files) {
    const relPath = toPosix(relative(projectRoot, file));
    const layer = fileLayer(relPath);
    const forbidden = FORBIDDEN[layer];
    if (!forbidden) continue;

    const source = await readFile(file, "utf8");
    const fileDir = dirname(file);
    for (const spec of extractSpecifiers(source)) {
      const target = targetLayer(spec, fileDir);
      if (forbidden.has(target)) {
        violations.push({ file: relPath, spec, rule: `${layer}->${target}` });
      }
    }
  }

  console.log(
    `[verify-imports] scanned ${files.length} source file(s) across ${SCAN_ROOTS.join(", ")}/`,
  );

  if (violations.length > 0) {
    console.error(`[FAIL] ${violations.length} forbidden cross-layer import(s):`);
    for (const v of violations) {
      const reason = RULE_REASON[v.rule] ?? v.rule;
      console.error(`  ${v.file}\n    imports "${v.spec}"  (${v.rule}: ${reason})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[PASS] module boundaries hold — no forbidden cross-layer imports.");
}

main().catch((error) => {
  console.error("[verify-imports] scan error:", error);
  process.exitCode = 1;
});
