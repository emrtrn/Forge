import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_BYTES = 2 * 1024 * 1024;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run world:ridgebound -- --source <master.json> [--expect-sha256 <hash>] [--out output/ridgebound/<new-run>]\nWithout --out: validate and report only. Existing output directories are never overwritten.");
    return;
  }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!["--source", "--out", "--expect-sha256"].includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error(`Invalid or repeated option ${key}`);
    options.set(key, value);
  }
  if (!options.has("--source")) throw new Error("--source is required; use --help");
  const input = resolve(options.get("--source"));
  if ((await stat(input)).size > MAX_BYTES) throw new Error("Source JSON exceeds 2 MiB");
  const bytes = await readFile(input);
  if (bytes.length > MAX_BYTES) throw new Error("Source JSON exceeds 2 MiB");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (options.has("--expect-sha256") && options.get("--expect-sha256") !== sha256) throw new Error("Source SHA-256 does not match --expect-sha256; nothing written");
  const bundle = await build({
    absWorkingDir: root, tsconfig: join(root, "tsconfig.json"), bundle: true, format: "esm", platform: "node", write: false,
    stdin: { contents: 'export * from "./tools/world/ridgeboundSpatial";', resolveDir: root, loader: "ts" },
  });
  const { buildRidgeboundPreview, RIDGEBOUND_LEVEL, RIDGEBOUND_RECIPE } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const preview = buildRidgeboundPreview(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")), sha256);
  if (!options.has("--out")) {
    console.log(JSON.stringify({ mode: "dry-run", ...preview.report }, null, 2));
    return;
  }
  const out = resolve(options.get("--out"));
  const parent = join(root, "output", "ridgebound");
  // All output is isolated from public/, authored levels, project manifests and source files.
  if (dirname(out) !== parent || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(out.slice(parent.length + 1))) throw new Error("--out must be a new directory directly inside output/ridgebound");
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new Error("Output parent must not be a symbolic link");
  await mkdir(out); // EEXIST deliberately preserves all earlier output and manual edits.
  const json = value => `${JSON.stringify(value, null, 2)}\n`;
  const files = new Map([
    [RIDGEBOUND_LEVEL, json(preview.level)], [RIDGEBOUND_RECIPE, json(preview.recipe)],
    ["import-report.json", json(preview.report)], ["preview.svg", preview.svg],
    ["README.md", `# Ridgebound P0 — schematic review\n\nSource SHA-256: ${sha256}\n\nOpen preview.svg for the metric plan. The level starts without generated markers: load it with its adjacent worldrecipe in an isolated Forge project, then use World Builder → Plan blockout → Dry Run / Apply.\n\nThis is not terrain, road mesh, bridge collision or driving acceptance. Roads/settlement generation can change the authored layout; do not run those stages for this coordinate check. No re-import into an edited recipe is implemented. Keep earlier output; use a new --out directory.\n\nSee import-report.json for deferred fields and missing POI-07. No project default scene was changed.\n`],
  ]);
  for (const [path, body] of files) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), body, { encoding: "utf8", flag: "wx" });
  }
  console.log(JSON.stringify({ mode: "new-review-package", output: out, sha256, files: [...files.keys()], warnings: preview.report.warnings }, null, 2));
}

main().catch(error => { console.error(`[world:ridgebound] ${error.message}`); process.exitCode = 1; });
