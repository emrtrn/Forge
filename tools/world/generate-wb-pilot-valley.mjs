import { build } from "esbuild";
import { access, copyFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Writes the World Builder pilot valley (tools/world/wbPilotValley.ts) under
// public/assets/world-pilot/Levels/, where the Content Browser lists it. The
// level is then edited in the editor and committed, so an existing level is
// kept unless `--force` is given: regenerating drops every edit made since.
const root = await realpath("public");
const withinPublic = (path) => {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + sep)) throw new Error("Path escapes public");
  return absolute;
};
const write = async (path, data) => {
  await mkdir(dirname(withinPublic(path)), { recursive: true });
  await writeFile(withinPublic(path), data);
};
const bundled = await build({
  tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false,
  stdin: {
    contents: 'export * from "./tools/world/wbPilotValley"; export { terrainTilePath, terrainGlobalMapPath } from "./engine/terrain/terrainTypes"; export { worldRecipePath } from "./engine/worldbuilder/recipe";',
    resolveDir: process.cwd(), loader: "ts",
  },
});
const {
  generateWbPilotValley, pilotRegionProfile, WB_PILOT_LEVEL, WB_PILOT_TERRAIN, WB_PILOT_PROFILE, WB_PILOT_REFERENCE, WB_PILOT_FOLIAGE,
  terrainTilePath, terrainGlobalMapPath, worldRecipePath,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

if (!process.argv.includes("--force") && await access(withinPublic(WB_PILOT_LEVEL)).then(() => true, () => false)) {
  console.error(`[world:pilot] ${WB_PILOT_LEVEL} exists; it may hold editor changes. Rerun with --force to rebuild it from scratch.`);
  process.exit(1);
}
const neutral = JSON.parse(await readFile("tests/engine/fixtures/neutral.regionprofile.json", "utf8"));
const profile = pilotRegionProfile(neutral);
const valley = generateWbPilotValley(profile);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
await rm(dirname(withinPublic(terrainTilePath(WB_PILOT_TERRAIN, "0_0"))), { recursive: true, force: true });
for (const [key, bytes] of valley.tileBytes) await write(terrainTilePath(WB_PILOT_TERRAIN, key), bytes);
await write(terrainGlobalMapPath(WB_PILOT_TERRAIN), valley.globalBytes);
await write(WB_PILOT_TERRAIN, json(valley.def));
await write(WB_PILOT_LEVEL, json(valley.level));
await write(worldRecipePath(WB_PILOT_LEVEL), json(valley.recipe));
await write(WB_PILOT_PROFILE, json(profile));
await write(WB_PILOT_FOLIAGE, json(valley.foliage));
await mkdir(dirname(withinPublic(WB_PILOT_REFERENCE)), { recursive: true });
await copyFile("art/world-pilot/references/pilot-plan-map.png", withinPublic(WB_PILOT_REFERENCE));

const { added, warnings } = valley.roads;
for (const warning of warnings) console.warn(`[world:pilot] ${warning}`);
for (const spline of valley.def.splines ?? []) {
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
  console.log(`[world:pilot] spline ${spline.id}: ${points.length} points, ${Math.round(length)} m, steepest ${steepest.toFixed(1)}°`);
}
console.log(`[world:pilot] ${WB_PILOT_LEVEL}: roads added ${added.join(", ")}, cabin ground ${valley.cabinHeight} m. Open it from the Content Browser.`);
