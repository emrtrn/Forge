import { build } from "esbuild";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// Repairs stale tile summaries in a World Terrain definition. Overlapping saves can
// rewrite a tile after the definition was committed; the tile (the sculpt) is the
// source of truth, so only the definition's minHeight/maxHeight is recomputed.
const usage = "Usage: npm run terrain:repair -- <path/to/x.terrain.json under public/> [--write | --check]";
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const [target, ...extra] = args.filter((arg) => !arg.startsWith("--"));
if (!target || extra.length || [...flags].some((flag) => !["--write", "--check"].includes(flag)) || (flags.has("--write") && flags.has("--check"))) {
  throw new Error(usage);
}

const root = await realpath("public");
const withinPublic = (path) => {
  const absolute = resolve(root, path.replace(/^public[\\/]/, ""));
  if (!absolute.startsWith(root + sep)) throw new Error("Path escapes public");
  return absolute;
};
const bundled = await build({
  tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false,
  stdin: {
    contents: [
      'export { normalizeWorldTerrain } from "./engine/terrain/terrainDefinition";',
      'export { repairTerrainSummaries } from "./engine/terrain/terrainRepair";',
      'export { validateTerrainTile } from "./engine/terrain/terrainLoader";',
      'export { decodeTerrainTile } from "./engine/terrain/terrainTileCodec";',
      'export { encodeTerrainGlobalMap } from "./engine/terrain/terrainGlobalMapFile";',
      'export { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "./engine/terrain/terrainRenderSource";',
      'export { terrainTilePath, terrainGlobalMapPath } from "./engine/terrain/terrainTypes";',
    ].join("\n"),
    resolveDir: process.cwd(), loader: "ts",
  },
});
const terrain = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const publicPath = target.replace(/\\/g, "/").replace(/^public\//, "");
const def = terrain.normalizeWorldTerrain(JSON.parse(await readFile(withinPublic(publicPath), "utf8")));
const tiles = new Map();
for (const { key } of def.tiles) {
  tiles.set(key, terrain.decodeTerrainTile(new Uint8Array(await readFile(withinPublic(terrain.terrainTilePath(publicPath, key))))));
}

const { def: repaired, changes } = terrain.repairTerrainSummaries(def, tiles);
if (!changes.length) {
  console.log(`[terrain:repair] ${publicPath}: all ${def.tiles.length} tile summaries cover their samples; nothing to do`);
  process.exit(0);
}
const fmt = (range) => `${range.min.toFixed(4)}..${range.max.toFixed(4)}`;
for (const change of changes) console.log(`  tile ${change.key}: declared ${fmt(change.before)} -> actual ${fmt(change.after)}`);

// The repaired definition must now pass the same check the editor and the save endpoint run.
// Anything else wrong with a tile (header, encoding range, non-finite heights) is not a stale summary.
for (const { key } of repaired.tiles) {
  terrain.validateTerrainTile(repaired, key, new Uint8Array(await readFile(withinPublic(terrain.terrainTilePath(publicPath, key)))));
}

if (flags.has("--check")) {
  console.error(`[terrain:repair] ${publicPath}: ${changes.length} stale tile summar${changes.length === 1 ? "y" : "ies"}; run with --write to fix`);
  process.exit(1);
}
if (!flags.has("--write")) {
  console.log(`[terrain:repair] dry run: ${changes.length} stale tile summar${changes.length === 1 ? "y" : "ies"}; add --write to fix`);
  process.exit(0);
}

// The far-map is derived from tiles that changed after it may have been built, so rebuild it with the definition.
const globalPath = withinPublic(terrain.terrainGlobalMapPath(publicPath));
const hasGlobal = await readFile(globalPath).then(() => true, (error) => (error.code === "ENOENT" ? false : Promise.reject(error)));
if (hasGlobal) {
  const attributes = terrain.buildTerrainGlobalAttributes(terrain.worldTerrainRenderSource(repaired, tiles));
  await writeFile(globalPath, terrain.encodeTerrainGlobalMap(repaired, attributes));
}
await writeFile(withinPublic(publicPath), `${JSON.stringify(repaired, null, 2)}\n`);
console.log(`[terrain:repair] ${publicPath}: fixed ${changes.length} tile summar${changes.length === 1 ? "y" : "ies"}${hasGlobal ? " and rebuilt the global map" : ""}`);
