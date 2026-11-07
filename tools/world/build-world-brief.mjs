import { build } from "esbuild";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm run world:brief -- <brief under public/> [--out <level under public/>] [--force]
// Builds a level from a *.worldbrief.json without the editor
// (tools/world/worldBriefRun.ts, docs/world-builder/WORLD_BRIEF.md). An existing
// level is kept unless --force is given: rebuilding drops every edit made since,
// except its World Partition settings.
const usage = "Usage: npm run world:brief -- <*.worldbrief.json under public/> [--out <*.level.json under public/>] [--force]";

async function main() {
  const args = process.argv.slice(2);
  let brief = null;
  let out;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") force = true;
    else if (arg === "--out" && args[index + 1] && !args[index + 1].startsWith("--")) out = args[++index];
    else if (!arg.startsWith("--") && brief === null) brief = arg;
    else throw new Error(usage);
  }
  if (!brief) throw new Error(usage);
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const root = await realpath(resolve(repo, "public"));
  const bundled = await build({
    absWorkingDir: repo, tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false, logLevel: "error",
    stdin: { contents: 'export { runWorldBrief } from "./tools/world/worldBriefRun";', resolveDir: repo, loader: "ts" },
  });
  const { runWorldBrief } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const result = await runWorldBrief({ root, brief, out, force });
  const { build: world } = result;
  for (const warning of world.warnings) console.warn(`[world:brief] ${warning}`);
  for (const note of world.deferred) console.log(`[world:brief] not built yet: ${note}`);
  for (const spline of world.def.splines ?? []) {
    const points = spline.points.map((point) => point.position);
    let length = 0;
    let steepest = 0;
    points.forEach((point, index) => {
      if (index === 0) return;
      const previous = points[index - 1];
      const run = Math.hypot(point[0] - previous[0], point[2] - previous[2]);
      length += run;
      if (run > 0) steepest = Math.max(steepest, Math.abs(Math.atan2(point[1] - previous[1], run)) * 180 / Math.PI);
    });
    console.log(`[world:brief] spline ${spline.id}: ${points.length} points, ${Math.round(length)} m, steepest ${steepest.toFixed(1)}°`);
  }
  const pads = Object.entries(world.padHeights).map(([id, height]) => `${id} ${height} m`).join(", ");
  const cells = world.cellKeys.length ? `, ${world.cellKeys.length} World Partition cells` : "";
  const removed = result.removedCells.length ? `, ${result.removedCells.length} stale cell file(s) removed` : "";
  const registered = result.registered ? `, registered as ${result.registered}` : "";
  console.log(`[world:brief] ${result.level}: ${result.written} files${cells}${removed}${registered}; level ground ${pads || "none"}. Open it from the Content Browser.`);
}

main().catch((error) => {
  console.error(`[world:brief] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
