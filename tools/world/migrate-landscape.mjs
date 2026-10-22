import { build } from "esbuild";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Explicit one-off fixture migration; never runs on editor boot or on every public level.
const levelPath = process.argv[2];
if (!levelPath || !/^[\w/-]+\.level\.json$/.test(levelPath) || levelPath.includes("..")) {
  throw new Error("Usage: node tools/world/migrate-landscape.mjs layouts/RuntimeParity.level.json");
}
const root = await realpath("public");
const withinPublic = (path) => {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + sep)) throw new Error("Path escapes public");
  return absolute;
};
const bundled = await build({ tsconfig: "tsconfig.json", stdin: { contents: 'export { captureTerrainSnapshot } from "./engine/terrain/terrainLandscapeBridge"; export { terrainTilePath } from "./engine/terrain/terrainTypes";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "node", write: false });
const { captureTerrainSnapshot, terrainTilePath } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const level = JSON.parse(await readFile(withinPublic(levelPath), "utf8"));
for (const actor of level.landscapes ?? []) {
  if (actor.dataRef.endsWith(".terrain.json")) continue;
  const data = JSON.parse(await readFile(withinPublic(actor.dataRef), "utf8"));
  const snapshot = captureTerrainSnapshot(actor, data);
  const tile = withinPublic(terrainTilePath(snapshot.path, "0_0"));
  await mkdir(dirname(tile), { recursive: true });
  await writeFile(tile, snapshot.bytes);
  await writeFile(withinPublic(snapshot.path), JSON.stringify(snapshot.def, null, 2) + "\n");
  actor.dataRef = snapshot.path;
  console.log(`${actor.id}: ${snapshot.path}`);
}
await writeFile(withinPublic(levelPath), JSON.stringify(level, null, 2) + "\n");
