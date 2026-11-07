import { build } from "esbuild";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm run world:random -- --out <*.level.json under public/> [--size small|medium|large]
//   [--landform plain|hills|mountains|valley] [--mountains low|medium|high]
//   [--settlements village,hamlet,...] [--roads between|exits] [--seed N] [--force]
// Builds a whole greybox world from a few choices (docs/world-builder/RANDOM_WORLD_PLAN.md).
// The brief it wrote stays beside the level; `npm run world:brief` rebuilds from it.
const usage = "Usage: npm run world:random -- --out <*.level.json under public/> [--size small|medium|large] "
  + "[--landform plain|hills|mountains|valley] [--mountains low|medium|high] [--settlements village,hamlet] [--roads between|exits] [--seed N] [--force]";
const CHOICES = {
  size: ["small", "medium", "large"],
  landform: ["plain", "hills", "mountains", "valley"],
  mountains: ["low", "medium", "high"],
  roads: ["between", "exits"],
};

async function main() {
  const args = process.argv.slice(2);
  const values = { size: "medium", landform: "hills", mountains: "medium", settlements: "village,hamlet", roads: "exits", seed: String(Date.now() % 100000) };
  let out = null;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    const key = arg.startsWith("--") ? arg.slice(2) : null;
    const value = args[index + 1];
    if (!key || value === undefined || value.startsWith("--")) throw new Error(usage);
    index += 1;
    if (key === "out") out = value;
    else if (key in values) values[key] = value;
    else throw new Error(usage);
  }
  if (!out) throw new Error(usage);
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (!allowed.includes(values[key])) throw new Error(`--${key} must be one of ${allowed.join(", ")}`);
  }
  const settlements = values.settlements.split(",").filter(Boolean).map((type) => {
    if (!["hamlet", "village", "town"].includes(type)) throw new Error(`--settlements: ${type} is not hamlet, village or town`);
    return { type };
  });
  const seed = Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a whole number");

  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const root = await realpath(resolve(repo, "public"));
  const bundled = await build({
    absWorkingDir: repo, tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false, logLevel: "error",
    stdin: { contents: 'export { runRandomWorld } from "./tools/world/randomWorldRun";', resolveDir: repo, loader: "ts" },
  });
  const { runRandomWorld } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const started = Date.now();
  const result = await runRandomWorld({
    root, out, force,
    world: { seed, size: values.size, landform: values.landform, mountainHeight: values.mountains, settlements, roads: values.roads },
  });
  for (const note of result.notes) console.warn(`[world:random] ${note}`);
  for (const warning of result.build.warnings) if (!warning.includes("meshAsset")) console.warn(`[world:random] ${warning}`);
  const buildings = result.build.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role?.startsWith("building.")).length;
  const cells = result.build.cellKeys.length ? `, ${result.build.cellKeys.length} World Partition cells` : "";
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[world:random] ${result.level} (seed ${seed}): ${buildings} buildings, ${result.written} files${cells}, ${seconds} s. Brief: ${result.brief}. Open it from the Content Browser.`);
}

main().catch((error) => {
  console.error(`[world:random] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
