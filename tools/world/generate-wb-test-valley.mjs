import { build } from "esbuild";
import { copyFile, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Writes the World Builder test valley (tools/world/wbTestValley.ts) into public/:
// level, World Terrain, world recipe and the neutral region profile it names.
// Generated output is gitignored: regenerate it, never commit it. Rerunning
// overwrites the recipe too, dropping World Builder edits made in the editor.
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
    contents: 'export * from "./tools/world/wbTestValley"; export { terrainTilePath, terrainGlobalMapPath } from "./engine/terrain/terrainTypes"; export { worldRecipePath } from "./engine/worldbuilder/recipe";',
    resolveDir: process.cwd(), loader: "ts",
  },
});
const {
  generateWbTestValley, WB_TEST_VALLEY_LEVEL, WB_TEST_VALLEY_TERRAIN, WB_TEST_VALLEY_PROFILE,
  terrainTilePath, terrainGlobalMapPath, worldRecipePath,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const valley = generateWbTestValley();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
await rm(dirname(withinPublic(terrainTilePath(WB_TEST_VALLEY_TERRAIN, "0_0"))), { recursive: true, force: true });
for (const [key, bytes] of valley.tileBytes) await write(terrainTilePath(WB_TEST_VALLEY_TERRAIN, key), bytes);
await write(terrainGlobalMapPath(WB_TEST_VALLEY_TERRAIN), valley.globalBytes);
await write(WB_TEST_VALLEY_TERRAIN, json(valley.def));
await write(WB_TEST_VALLEY_LEVEL, json(valley.level));
await write(worldRecipePath(WB_TEST_VALLEY_LEVEL), json(valley.recipe));
await mkdir(dirname(withinPublic(WB_TEST_VALLEY_PROFILE)), { recursive: true });
await copyFile("tests/engine/fixtures/neutral.regionprofile.json", withinPublic(WB_TEST_VALLEY_PROFILE));
console.log(`[world:valley] ${WB_TEST_VALLEY_LEVEL}: 512 m test valley, recipe ${worldRecipePath(WB_TEST_VALLEY_LEVEL)}. `
  + "Open it in the editor (Content Browser or /__open-level) and run the World Builder stages.");
