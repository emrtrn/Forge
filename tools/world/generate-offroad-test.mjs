import { build } from "esbuild";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Writes the off-road surface test level (tools/world/offroadTestWorld.ts) into
// the smoke fixtures (tests/smoke/fixtures/levels), never public/. Small and
// deterministic: the output is committed.
const root = await realpath("tests/smoke/fixtures/levels");
const bundled = await build({
  tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false,
  stdin: { contents: 'export * from "./tools/world/offroadTestWorld"; export { terrainTilePath, terrainGlobalMapPath } from "./engine/terrain/terrainTypes";', resolveDir: process.cwd(), loader: "ts" },
});
const { generateOffroadTestWorld, offroadTestLevel, offroadTestFixtureFile, OFFROAD_TEST_LEVEL, OFFROAD_TEST_TERRAIN, terrainTilePath, terrainGlobalMapPath } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const withinFixtures = (path) => {
  const absolute = resolve(offroadTestFixtureFile(path));
  if (!absolute.startsWith(root + sep)) throw new Error("Path escapes the test level fixtures");
  return absolute;
};
const world = generateOffroadTestWorld();
const tilesDir = dirname(withinFixtures(terrainTilePath(OFFROAD_TEST_TERRAIN, "0_0")));
await rm(tilesDir, { recursive: true, force: true });
await mkdir(tilesDir, { recursive: true });
for (const [key, tile] of world.tileBytes) await writeFile(withinFixtures(terrainTilePath(OFFROAD_TEST_TERRAIN, key)), tile);
await writeFile(withinFixtures(terrainGlobalMapPath(OFFROAD_TEST_TERRAIN)), world.globalBytes);
await writeFile(withinFixtures(OFFROAD_TEST_TERRAIN), JSON.stringify(world.def, null, 2) + "\n");
await writeFile(withinFixtures(OFFROAD_TEST_LEVEL), JSON.stringify(offroadTestLevel(world, OFFROAD_TEST_TERRAIN), null, 2) + "\n");
console.log(`[world:offroad] ${OFFROAD_TEST_LEVEL}: ${world.def.tilesX}x${world.def.tilesZ} tiles x ${world.def.tileQuads} quads`);
