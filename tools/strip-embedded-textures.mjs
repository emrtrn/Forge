/**
 * Strips embedded textures from GLBs whose surfaces are authored through
 * `.materials.json` slot overrides.
 *
 * The runtime swaps `object.material` in `applyMaterialSlotOverrides`
 * (`src/scene/assetMaterialSlotsLoader.ts`) *after* GLTFLoader has already
 * downloaded and decoded whatever the exporter baked in, so those pixels cost
 * bandwidth and a PNG decode on every cold load and then render nothing.
 *
 * Materials themselves are deliberately kept — slot indices are derived from
 * the GLB's unique material list, so removing a material would shift the
 * mapping stored in the sidecar. Each material is left as a texture-less shell:
 * same count, same order, same names.
 *
 * Targets are named explicitly rather than discovered: only a GLB whose surfaces
 * are actually authored through a sidecar may be stripped, and nothing in the
 * file itself says whether that is true. A glob would eventually flatten a model
 * that was relying on its embedded maps, and the symptom — an untextured mesh —
 * would arrive long after the run that caused it.
 *
 * Usage:
 *   node tools/strip-embedded-textures.mjs path/to/a.glb path/to/b.glb   # dry run
 *   node tools/strip-embedded-textures.mjs --write path/to/a.glb         # in place (+ .bak)
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { copyFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((arg) => !arg.startsWith("--"));
if (targets.length === 0) {
  console.error("usage: node tools/strip-embedded-textures.mjs [--write] <file.glb>...");
  process.exit(1);
}
const files = targets.map((file) => resolve(file));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

let beforeTotal = 0;
let afterTotal = 0;
let failed = false;

for (const file of files) {
  const label = relative(process.cwd(), file).replaceAll("\\", "/");
  if (!existsSync(file)) {
    console.error(`  MISSING  ${label}`);
    failed = true;
    continue;
  }

  const before = (await stat(file)).size;
  const document = await io.read(file);
  const root = document.getRoot();

  const materialsBefore = root.listMaterials().map((material) => material.getName());
  const textures = root.listTextures();
  const removed = textures.map((texture) => {
    const image = texture.getImage();
    return {
      name: texture.getName() || "(unnamed)",
      mime: texture.getMimeType() || "?",
      bytes: image ? image.byteLength : 0,
    };
  });

  // dispose() unlinks the texture from every material and extension that
  // references it, so no per-slot nulling is needed and extension-held
  // textures are covered too. Orphaned image buffer views are dropped by the
  // writer, which only emits what the graph still reaches.
  for (const texture of textures) texture.dispose();

  const after = await io.writeBinary(document);
  const materialsAfter = root.listMaterials().map((material) => material.getName());

  // The sidecar maps slot index -> material id, and slot indices come from the
  // GLB's unique material list. If that list changed, the mapping just moved.
  const materialsHeld =
    materialsBefore.length === materialsAfter.length &&
    materialsBefore.every((name, index) => name === materialsAfter[index]);

  console.log(`\n=== ${label}`);
  console.log(`  ${mb(before)} -> ${mb(after.byteLength)}  (-${mb(before - after.byteLength)})`);
  if (removed.length === 0) console.log("  no embedded textures");
  for (const texture of removed) {
    console.log(`  - dropped ${texture.name} ${texture.mime} ${mb(texture.bytes)}`);
  }
  console.log(
    `  materials: ${materialsBefore.length} kept [${materialsAfter.join(", ")}]` +
      (materialsHeld ? "" : "  <-- CHANGED, slot mapping would shift"),
  );

  beforeTotal += before;
  afterTotal += after.byteLength;

  if (!materialsHeld) {
    console.error("  refusing to write: material list changed");
    failed = true;
    continue;
  }

  if (write) {
    const backup = `${file}.bak`;
    if (!existsSync(backup)) await copyFile(file, backup);
    await writeFile(file, after);
    console.log(`  written (backup: ${relative(process.cwd(), backup).replaceAll("\\", "/")})`);
  }
}

console.log(
  `\n${write ? "written" : "dry run"}: ${mb(beforeTotal)} -> ${mb(afterTotal)} ` +
    `(-${mb(beforeTotal - afterTotal)})`,
);
if (!write) console.log("re-run with --write to apply");
if (failed) process.exitCode = 1;
