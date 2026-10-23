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
 *   - src/scene/RuntimeSceneApp.ts   must not import  editor · game
 *                          (the runtime shell stays editor-free and generic:
 *                           game rules, Game Modes, behaviors and AI tasks reach
 *                           it through the Layer 3 game module's services, which
 *                           src/main.ts injects — the shell never imports @/game)
 *   - src/scene/capabilities/**      must not import  editor · game
 *                          (Layer 2 capability modules stay generic: game rules
 *                           belong to Layer 3, authoring to the editor shell)
 *
 * Uses the project's TypeScript parser for imports, re-exports, import types,
 * import-equals declarations and literal dynamic imports, regardless of line
 * breaks. Comments and ordinary strings are not dependencies. Computed module
 * paths and transitive dependencies are outside this direct-edge guard.
 * Standalone build tooling; TypeScript is not added to the app bundle.
 *
 * Usage:   node builder/web/verify-imports.mjs
 * Exit:    0 = clean, 1 = a forbidden import (or a scan error).
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");

// Source roots to scan (top-level extracted boundaries + the active src tree).
const SCAN_ROOTS = ["engine", "editor", "builder", "game", "project", "src"];

// Which target layers each source layer may NOT import.
const FORBIDDEN = {
  engine: new Set(["editor", "game", "builder", "src", "project"]),
  editor: new Set(["game"]),
  game: new Set(["editor"]),
  runtime: new Set(["editor", "game"]),
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
  "runtime->game":
    "the runtime shell stays generic — a game plugs in through a ForgeGameModule (see src/game/gameModule.ts), injected by src/main.ts",
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
function targetLayer(spec, fileDir, root = projectRoot) {
  const aliases = {
    "@engine/": "engine",
    "@editor/": "editor",
    "@builder/": "builder",
    "@game/": "game",
    "@project/": "project",
    "@/": "src",
  };
  for (const [prefix, directory] of Object.entries(aliases)) {
    if (spec.startsWith(prefix)) {
      return classifyPath(toPosix(relative(root, resolve(root, directory, spec.slice(prefix.length)))));
    }
  }
  if (spec.startsWith(".")) {
    const resolved = toPosix(relative(root, resolve(fileDir, spec)));
    return classifyPath(resolved);
  }
  return "external"; // bare module: three, @dimforge/*, node:*, etc.
}

export function extractSpecifiers(source, fileName = "source.ts") {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length > 0) {
    const diagnostic = parsed.parseDiagnostics[0];
    const { line, character } = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new Error(`${fileName}:${line + 1}:${character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  const specs = [];
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specs.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addLiteral(node.argument.literal);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specs;
}

export function findImportViolations(relPath, source, root = projectRoot) {
  const normalizedPath = toPosix(relPath);
  const layer = fileLayer(normalizedPath);
  const forbidden = FORBIDDEN[layer];
  if (!forbidden) return [];
  const fileDir = dirname(resolve(root, normalizedPath));
  const violations = [];
  for (const spec of extractSpecifiers(source, normalizedPath)) {
    const target = targetLayer(spec, fileDir, root);
    if (forbidden.has(target)) {
      violations.push({ file: normalizedPath, spec, rule: `${layer}->${target}` });
    }
  }
  return violations;
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
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

export async function scanImportBoundaries(root = projectRoot) {
  const files = [];
  for (const sourceRoot of SCAN_ROOTS) files.push(...(await walk(join(root, sourceRoot))));

  const violations = [];
  for (const file of files) {
    const relPath = toPosix(relative(root, file));
    if (!FORBIDDEN[fileLayer(relPath)]) continue;
    const source = await readFile(file, "utf8");
    violations.push(...findImportViolations(relPath, source, root));
  }
  return { fileCount: files.length, violations };
}

export async function main(root = projectRoot) {
  const { fileCount, violations } = await scanImportBoundaries(root);

  console.log(
    `[verify-imports] scanned ${fileCount} source file(s) across ${SCAN_ROOTS.join(", ")}/`,
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[verify-imports] scan error:", error);
    process.exitCode = 1;
  });
}
