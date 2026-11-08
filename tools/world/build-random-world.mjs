import { build } from "esbuild";
import { writeSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm run world:random -- --out <*.level.json under public/> [--size small|medium|large]
//   [--landform plain|hills|mountains|valley] [--mountains low|medium|high]
//   [--settlements village,hamlet,...] [--roads between|exits] [--rivers 0-3] [--lakes 0-3]
//   [--cover forest|meadow|farmland|steppe|desert|alpine] [--forest|--rocks|--fields low|medium|high] [--seed N] [--force]
// Builds a whole greybox world from a few choices (docs/world-builder/RANDOM_WORLD_PLAN.md).
// The brief it wrote stays beside the level; `npm run world:brief` rebuilds from it.
//
// `--request <public root>` is the dev server's mode (`/__world-random`): it reads
// the window's request JSON from stdin (validated by tools/world/randomWorldRequest.ts)
// and prints one `@@<json>` event line per build step, then a `done` or `error` event.
const usage = "Usage: npm run world:random -- --out <*.level.json under public/> [--size small|medium|large] "
  + "[--landform plain|hills|mountains|valley] [--mountains low|medium|high] [--settlements village,hamlet] [--roads between|exits] [--rivers 0-3] [--lakes 0-3] "
  + "[--cover forest|meadow|farmland|steppe|desert|alpine] [--forest|--rocks|--fields low|medium|high] [--seed N] [--force]";
const CHOICES = {
  size: ["small", "medium", "large"],
  landform: ["plain", "hills", "mountains", "valley"],
  mountains: ["low", "medium", "high"],
  roads: ["between", "exits"],
  cover: ["forest", "meadow", "farmland", "steppe", "desert", "alpine"],
  forest: ["low", "medium", "high"],
  rocks: ["low", "medium", "high"],
  fields: ["low", "medium", "high"],
};

const repo = fileURLToPath(new URL("../../", import.meta.url));

async function loadTools() {
  const bundled = await build({
    absWorkingDir: repo, tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false, logLevel: "error",
    stdin: {
      contents: 'export { runRandomWorld } from "./tools/world/randomWorldRun"; export { validateRandomWorldRequest } from "./tools/world/randomWorldRequest";',
      resolveDir: repo, loader: "ts",
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}

function summary(result, started) {
  const placements = result.build.layout.instances.flatMap((group) => group.placements);
  return {
    level: result.level,
    brief: result.brief,
    buildings: placements.filter((placement) => placement.role?.startsWith("building.")).length,
    bridges: placements.filter((placement) => placement.role === "structure.bridge").length,
    rivers: result.build.ground.courses.length,
    lakes: result.build.ground.lakes.length,
    cells: result.build.cellKeys.length,
    files: result.written,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    notes: result.notes,
  };
}

async function request(root) {
  // Synchronous writes: the build is synchronous, and each step must reach the server as it starts.
  const event = (value) => writeSync(1, `@@${JSON.stringify(value)}\n`);
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { runRandomWorld, validateRandomWorldRequest } = await loadTools();
    const input = validateRandomWorldRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const started = Date.now();
    const result = await runRandomWorld({
      root: await realpath(root), out: input.out, force: input.force, world: input.world,
      onProgress: (step) => event({ type: "progress", step }),
    });
    event({ type: "done", ...summary(result, started) });
  } catch (error) {
    event({ type: "error", message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--request") {
    if (!args[1]) throw new Error("--request needs the public root");
    await request(args[1]);
    return;
  }
  const values = { size: "medium", landform: "hills", mountains: "medium", settlements: "village,hamlet", roads: "exits", rivers: "0", lakes: "0", cover: "forest", forest: "medium", rocks: "medium", fields: "medium", seed: String(Date.now() % 100000) };
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
  const [rivers, lakes] = ["rivers", "lakes"].map((key) => {
    const count = Number(values[key]);
    if (!Number.isInteger(count) || count < 0 || count > 3) throw new Error(`--${key} must be 0, 1, 2 or 3`);
    return count;
  });
  const seed = Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a whole number");

  const root = await realpath(resolve(repo, "public"));
  const { runRandomWorld } = await loadTools();
  const started = Date.now();
  const result = await runRandomWorld({
    root, out, force,
    world: { seed, size: values.size, landform: values.landform, mountainHeight: values.mountains, settlements, roads: values.roads, rivers, lakes,
      cover: values.cover, densities: { forest: values.forest, rocks: values.rocks, fields: values.fields } },
  });
  for (const note of result.notes) console.warn(`[world:random] ${note}`);
  for (const warning of result.build.warnings) if (!warning.includes("meshAsset")) console.warn(`[world:random] ${warning}`);
  const buildings = result.build.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role?.startsWith("building.")).length;
  const cells = result.build.cellKeys.length ? `, ${result.build.cellKeys.length} World Partition cells` : "";
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const bridges = result.build.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role === "structure.bridge").length;
  const water = `${values.cover} cover, ${result.build.ground.courses.length} river(s), ${result.build.ground.lakes.length} lake(s), ${bridges} bridge(s)`;
  console.log(`[world:random] ${result.level} (seed ${seed}): ${buildings} buildings, ${water}, ${result.written} files${cells}, ${seconds} s. Brief: ${result.brief}. Open it from the Content Browser.`);
}

main().catch((error) => {
  console.error(`[world:random] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
