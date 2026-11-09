// Diagnostic only. Source files, runtime limits, authoring projects and browser state are never modified.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => { const i = args.indexOf(flag); return i === -1 ? fallback : args[i + 1]; };
for (let i = 0; i < args.length; i += 2) assert.ok(["--out", "--samples", "--warmups"].includes(args[i]) && args[i + 1], "Unknown or incomplete study option");
const samples = Number(value("--samples", "5")), warmups = Number(value("--warmups", "2"));
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 30 && Number.isInteger(warmups) && warmups >= 0 && warmups <= 5);
assert.equal(typeof globalThis.gc, "function", "Use node --expose-gc tools/ocean-budget-report.mjs");
const output = resolve(repository, value("--out", "docs/reports/evidence/ocean-medium-large/budget-atlas-medium.json"));
assert.notEqual(output, resolve(repository, "docs/reports/evidence/ocean-medium-large/budget.json"), "The historical RGBA baseline must not be overwritten");
const scratch = await mkdtemp(join(tmpdir(), "forge-ocean-budget-"));
const sourcePaths = ["engine/scene/oceanBudget.ts", "engine/worldbuilder/randomWorld.ts"];
const sha = text => createHash("sha256").update(text).digest("hex");
const original = new Map(await Promise.all(sourcePaths.map(async file => [file, await readFile(join(repository, file), "utf8")])));
const transforms = [];
try {
  const settings = { absWorkingDir: repository, tsconfig: "tsconfig.json", bundle: true, platform: "node", format: "esm", logLevel: "warning" };
  const baselineFile = join(scratch, "baseline.mjs"), experimentFile = join(scratch, "experiment.mjs");
  await build({ ...settings, outfile: baselineFile, stdin: { resolveDir: repository, loader: "ts", contents:
    'export { OCEAN_LIMITS as limits } from "./engine/scene/oceanWater"; export { randomWorldBrief } from "./engine/worldbuilder/randomWorld"; export { prepareOceanTerrain } from "./engine/terrain/oceanPreparation";' } });
  await build({ ...settings, outfile: experimentFile, entryPoints: ["tools/perf/oceanBudgetStudy.ts"], plugins: [{ name: "diagnostic-only-ocean-budget", setup(builder) {
    builder.onLoad({ filter: /[\\/]engine[\\/]scene[\\/]oceanBudget\.ts$/ }, async ({ path }) => {
      const file = sourcePaths.find(file => resolve(repository, file) === path); assert.ok(file, path);
      const before = original.get(file);
      const needle = before.match(/cells: \d+, axisCells: 2048/)?.[0]; assert.ok(needle, "Review the diagnostic cap transform");
      assert.equal(before.split(needle).length, 2, `Source drift: review the diagnostic transform for ${file}`);
      const after = before.replace(needle, "cells: 4194304, axisCells: 2048");
      transforms.push({ file, originalSha256: sha(before), experimentalSha256: sha(after), needle });
      return { contents: after, loader: "ts", resolveDir: dirname(path) };
    });
  } }] });
  assert.equal(transforms.length, 1, "Only the in-memory cell cap may change; size policies derive from it");
  const baseline = await import(pathToFileURL(baselineFile).href), experiment = await import(pathToFileURL(experimentFile).href);
  const report = await experiment.runOceanBudgetStudy(baseline, { repository, directory: join(scratch, "fixtures"), samples, warmups });
  for (const [file, before] of original) assert.equal(await readFile(join(repository, file), "utf8"), before, `Production source changed during study: ${file}`);
  report.diagnosticTransforms = transforms;
  report.bundleSha256 = { baseline: sha(await readFile(baselineFile)), diagnostic: sha(await readFile(experimentFile)) };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`[ocean-budget] wrote ${output}`);
} finally {
  assert.equal(dirname(scratch), resolve(tmpdir())); assert.ok(scratch.startsWith(join(resolve(tmpdir()), "forge-ocean-budget-")));
  await rm(scratch, { recursive: true, force: true });
}
