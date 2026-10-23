import { build } from "esbuild";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Writes the open-world test world (tools/world/testWorld.ts) into public/.
// Generated output is gitignored: regenerate it, never commit it.
const usage = "Usage: npm run world:test [-- --tiles 16 --quads 256 --spacing 1 --seed 1337]";
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const name = { "--tiles": "tiles", "--quads": "tileQuads", "--spacing": "spacing", "--seed": "seed" }[args[index]];
  const value = Number(args[index + 1]);
  if (!name || !Number.isFinite(value)) throw new Error(usage);
  options[name] = value;
}
const root = await realpath("public");
const withinPublic = (path) => {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + sep)) throw new Error("Path escapes public");
  return absolute;
};
const bundled = await build({
  tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false,
  stdin: { contents: 'export * from "./tools/world/testWorld"; export { terrainTilePath, terrainGlobalMapPath } from "./engine/terrain/terrainTypes";', resolveDir: process.cwd(), loader: "ts" },
});
const { generateTestWorld, testWorldLevel, OPEN_WORLD_TEST_LEVEL, OPEN_WORLD_TEST_TERRAIN, terrainTilePath, terrainGlobalMapPath } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const started = performance.now();
const world = generateTestWorld(options);
const tilesDir = dirname(withinPublic(terrainTilePath(OPEN_WORLD_TEST_TERRAIN, "0_0")));
// A rerun with fewer tiles must not leave stale ones behind.
await rm(tilesDir, { recursive: true, force: true });
await mkdir(tilesDir, { recursive: true });
let bytes = 0;
for (const [key, tile] of world.tileBytes) {
  await writeFile(withinPublic(terrainTilePath(OPEN_WORLD_TEST_TERRAIN, key)), tile);
  bytes += tile.byteLength;
}
await writeFile(withinPublic(terrainGlobalMapPath(OPEN_WORLD_TEST_TERRAIN)), world.globalBytes);
await writeFile(withinPublic(OPEN_WORLD_TEST_TERRAIN), JSON.stringify(world.def, null, 2) + "\n");
await writeFile(withinPublic(OPEN_WORLD_TEST_LEVEL), JSON.stringify(testWorldLevel(world, OPEN_WORLD_TEST_TERRAIN), null, 2) + "\n");
const { tilesX, tilesZ, tileQuads, spacing } = world.def;
console.log(`[world:test] ${OPEN_WORLD_TEST_LEVEL}: ${tilesX}x${tilesZ} tiles x ${tileQuads} quads x ${spacing} m `
  + `(${(tilesX * tileQuads * spacing / 1000).toFixed(1)} km), ${(bytes / 1048576).toFixed(1)} MiB of tiles + `
  + `${(world.globalBytes.byteLength / 1048576).toFixed(1)} MiB global map in ${((performance.now() - started) / 1000).toFixed(1)} s`);
