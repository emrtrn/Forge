/**
 * Turns a raw authored/generated GLB into a web-ready one.
 *
 * The input this exists for is the usual export from a mesh generator or a DCC
 * tool: a GLB with 2048px PBR maps stored as PNG. PNG is not a GPU format — the
 * driver expands it back to raw RGBA, so one 2048 map costs ~21 MB of VRAM with
 * mipmaps and a mesh with three maps costs ~64 MB. Across a hundred meshes that
 * is multiple gigabytes, which is why textures have to be resized and transcoded
 * to a block-compressed format before they land in the project.
 *
 * The chain, in the order the steps have to happen:
 *
 *   1. drop normal maps   A generator that derives normals from the albedo on
 *                         flat stylized geometry produces mostly noise, and this
 *                         is the single most expensive map (UASTC, 1 byte/px).
 *                         Keep them with --keep-normals when they are authored.
 *   2. resize             Must run before compression: `resize` filters PNG/JPEG
 *                         pixels, and once a texture is KTX2 it is too late.
 *   3. uastc              occlusion + metallicRoughness. Higher fidelity per
 *                         channel, needed because these are data, not color.
 *   4. etc1s              baseColor + emissive. Quarter the cost of UASTC and
 *                         perceptually fine for color.
 *   5. meshopt            geometry, decoded by the MeshoptDecoder the runtime
 *                         already installs in engine/render-three/gltfLoader.ts.
 *   6. validate           official glTF validator, same as the old BAT.
 *
 * Output keeps the input's base name (`Foo.glb`, never `Foo.ktx2.glb`) because
 * the project pairs sidecars by base name — Foo.collision.json / Foo.uvw.json /
 * Foo.materials.json all stop resolving the moment the stem changes.
 *
 * Requires Khronos KTX-Software (`ktx`) on PATH, or pointed at with --ktx-dir /
 * the KTX_TOOLS_DIR env var. Everything else is already a project dependency.
 *
 * Usage:
 *   node tools/optimize-mesh-glb.mjs <file-or-dir>...
 *   node tools/optimize-mesh-glb.mjs staging/ --out public/assets/StaticMeshes
 *   node tools/optimize-mesh-glb.mjs staging/ --size 512
 *   node tools/optimize-mesh-glb.mjs staging/ --dry-run     # inventory only
 *
 * Options:
 *   --out <dir>              output directory (default: <input dir>/optimized)
 *   --size <px>              max texture edge, aspect preserved (default: 1024)
 *   --keep-normals           keep normal maps instead of dropping them
 *   --meshopt-level <l>      medium | high (default: medium)
 *   --no-meshopt             skip geometry compression
 *   --prune                  also drop data nothing references (extra UVs, etc.)
 *   --ktx-dir <dir>          directory containing ktx.exe
 *   --dry-run                report what would happen, write nothing
 *   --verbose                echo each sub-command's output
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const CLI = resolve("node_modules/@gltf-transform/cli/bin/cli.js");
// Where to look when `ktx` is not on PATH. The env var comes first so a machine
// with a portable install needs no edit to a checked-in file.
const KTX_FALLBACK_DIRS = [
  ...(process.env.KTX_TOOLS_DIR ? [process.env.KTX_TOOLS_DIR] : []),
  "C:/Program Files/KTX-Software/bin",
  "/usr/local/bin",
];

// ETC1S transcodes to BC1 on desktop (4 bits/px), UASTC to BC7 (8 bits/px).
// A full mip chain adds a third on top of the base level.
const BYTES_PER_PIXEL = { etc1s: 0.5, uastc: 1 };
const MIP_FACTOR = 4 / 3;

const SLOTS = {
  etc1s: ["baseColorTexture", "emissiveTexture"],
  uastc: ["occlusionTexture", "metallicRoughnessTexture"],
};

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};

const OPTION_NAMES = ["--out", "--size", "--meshopt-level", "--ktx-dir"];
const inputs = argv.filter(
  (arg, index) => !arg.startsWith("--") && !OPTION_NAMES.includes(argv[index - 1]),
);

const size = Number.parseInt(option("--size", "1024"), 10);
const meshoptLevel = option("--meshopt-level", "medium");
const dropNormals = !flag("--keep-normals");
const runMeshopt = !flag("--no-meshopt");
const runPrune = flag("--prune");
const dryRun = flag("--dry-run");
const verbose = flag("--verbose");

if (inputs.length === 0) {
  console.error("usage: node tools/optimize-mesh-glb.mjs <file-or-dir>... [--out <dir>]");
  process.exit(1);
}
if (!Number.isFinite(size) || size < 16) {
  console.error(`--size must be a number >= 16, got "${option("--size", "1024")}"`);
  process.exit(1);
}
if (meshoptLevel !== "medium" && meshoptLevel !== "high") {
  console.error(`--meshopt-level must be "medium" or "high", got "${meshoptLevel}"`);
  process.exit(1);
}

// ------------------------------------------------------------------ helpers

// The decoder is only needed to *re-read* an already-optimized file — the final
// meshopt pass makes the output unreadable without it, and re-running the tool
// on its own output is an easy thing to do by accident.
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
const rel = (path) => relative(process.cwd(), path).replaceAll("\\", "/");

function resolveKtxDir() {
  const explicit = option("--ktx-dir", process.env.KTX_TOOLS_DIR);
  if (explicit) return existsSync(join(explicit, "ktx.exe")) ? explicit : null;
  for (const dir of KTX_FALLBACK_DIRS) {
    if (existsSync(join(dir, "ktx.exe"))) return dir;
  }
  return null;
}

function run(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

/** Which compression pass a texture belongs to, by how materials reference it. */
function textureRoles(document) {
  const roles = new Map();
  const note = (texture, slot) => {
    if (!texture) return;
    if (!roles.has(texture)) roles.set(texture, new Set());
    roles.get(texture).add(slot);
  };
  for (const material of document.getRoot().listMaterials()) {
    note(material.getBaseColorTexture(), "baseColorTexture");
    note(material.getEmissiveTexture(), "emissiveTexture");
    note(material.getOcclusionTexture(), "occlusionTexture");
    note(material.getMetallicRoughnessTexture(), "metallicRoughnessTexture");
    note(material.getNormalTexture(), "normalTexture");
  }
  return roles;
}

function estimateVram(document) {
  const roles = textureRoles(document);
  let bytes = 0;
  for (const [texture, slots] of roles) {
    const dimensions = texture.getSize();
    if (!dimensions) continue;
    const codec = [...slots].some((slot) => SLOTS.etc1s.includes(slot)) ? "etc1s" : "uastc";
    bytes += dimensions[0] * dimensions[1] * BYTES_PER_PIXEL[codec] * MIP_FACTOR;
  }
  return bytes;
}

async function collectInputs(entries) {
  const files = [];
  for (const entry of entries) {
    const path = resolve(entry);
    if (!existsSync(path)) {
      console.error(`missing input: ${entry}`);
      process.exitCode = 1;
      continue;
    }
    if ((await stat(path)).isDirectory()) {
      for (const name of await readdir(path)) {
        if (/\.(glb|gltf)$/i.test(name)) files.push(join(path, name));
      }
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

/**
 * Drops normal maps and reports the texture inventory. Done through the SDK
 * because the CLI has no "remove one slot" command, and done first so the
 * resize and transcode passes never touch pixels that are about to be deleted.
 */
async function prepass(inputFile, outputFile) {
  const document = await io.read(inputFile);
  const root = document.getRoot();
  const materials = root.listMaterials();

  let droppedBytes = 0;
  let droppedCount = 0;
  if (dropNormals) {
    const normals = new Set();
    for (const material of materials) {
      const texture = material.getNormalTexture();
      if (texture) {
        normals.add(texture);
        material.setNormalTexture(null);
      }
    }
    for (const texture of normals) {
      // A texture could in principle be wired to another slot too; only retire
      // the ones whose last remaining parent is the document root.
      const stillUsed = texture.listParents().some((parent) => parent !== root);
      if (stillUsed) continue;
      droppedBytes += texture.getImage()?.byteLength ?? 0;
      droppedCount += 1;
      texture.dispose();
    }
  }

  const inventory = [...textureRoles(document)].map(([texture, slots]) => ({
    name: texture.getName() || "(unnamed)",
    slots: [...slots].join("+"),
    size: texture.getSize(),
    bytes: texture.getImage()?.byteLength ?? 0,
  }));

  if (!dryRun) await writeFile(outputFile, await io.writeBinary(document));

  return { materials: materials.map((m) => m.getName() || "(unnamed)"), inventory, droppedBytes, droppedCount };
}

// --------------------------------------------------------------------- main

const ktxDir = resolveKtxDir();
if (!ktxDir && !dryRun) {
  console.error("ERROR: Khronos KTX-Software (ktx.exe) was not found.");
  console.error("Looked in:");
  for (const dir of KTX_FALLBACK_DIRS) console.error(`  ${dir}`);
  console.error("Pass --ktx-dir <dir>, set KTX_TOOLS_DIR, or install from");
  console.error("https://github.com/KhronosGroup/KTX-Software/releases");
  process.exit(1);
}
const childEnv = ktxDir ? { ...process.env, PATH: `${ktxDir};${process.env.PATH}` } : process.env;

const files = await collectInputs(inputs);
if (files.length === 0) {
  console.error("no .glb or .gltf inputs found");
  process.exit(1);
}

const outDir = resolve(option("--out", join(dirname(files[0]), "optimized")));
if (!dryRun) await mkdir(outDir, { recursive: true });

console.log(`${dryRun ? "dry run" : "optimizing"}: ${files.length} file(s)`);
console.log(`  textures  max ${size}px, normals ${dropNormals ? "dropped" : "kept"}`);
console.log(`  geometry  ${runMeshopt ? `meshopt ${meshoptLevel}` : "untouched"}`);
if (!dryRun) console.log(`  output    ${rel(outDir)}`);

let beforeTotal = 0;
let afterTotal = 0;
let vramTotal = 0;
let failed = 0;

for (const file of files) {
  const stem = basename(file, extname(file));
  const label = rel(file);
  const before = (await stat(file)).size;
  beforeTotal += before;

  console.log(`\n=== ${label}`);

  const work = await mkdtemp(join(tmpdir(), "forge-glb-"));
  try {
    let current = join(work, "step0.glb");
    const { materials, inventory, droppedBytes, droppedCount } = await prepass(file, current);

    console.log(`  materials: ${materials.length} [${materials.join(", ")}]`);
    if (materials.length > 1) {
      console.log("             ^ more than one slot: draw calls will not collapse to 1");
    }
    for (const texture of inventory) {
      const dimensions = texture.size ? `${texture.size[0]}x${texture.size[1]}` : "?";
      console.log(`  - ${texture.slots.padEnd(24)} ${dimensions.padEnd(11)} ${mb(texture.bytes)}`);
    }
    if (droppedCount > 0) console.log(`  - dropped ${droppedCount} normal map(s), ${mb(droppedBytes)}`);

    if (dryRun) continue;

    // Which transcode passes have anything to do. Running a pass whose slots
    // are all empty is wasted process spawn, and noisy when it warns.
    const present = new Set(inventory.flatMap((texture) => texture.slots.split("+")));
    const passes = [
      ["resize", ["--width", String(size), "--height", String(size), "--filter", "lanczos3"]],
    ];
    if (SLOTS.uastc.some((slot) => present.has(slot))) {
      passes.push([
        "uastc",
        // prettier-ignore
        ["--slots", `{${SLOTS.uastc.join(",")}}`, "--level", "4", "--rdo", "--rdo-lambda", "0.75", "--zstd", "18"],
      ]);
    }
    if (SLOTS.etc1s.some((slot) => present.has(slot))) {
      passes.push(["etc1s", ["--slots", `{${SLOTS.etc1s.join(",")}}`, "--quality", "255", "--compression", "1"]]);
    }
    if (runPrune) passes.push(["prune", []]);
    if (runMeshopt) passes.push(["meshopt", ["--level", meshoptLevel]]);

    // Dimensions have to be read after resize but before transcode: KTX2 sizes
    // are what the VRAM estimate needs, and they are cheaper to read as PNG.
    let vram = 0;
    let broke = false;

    for (const [index, [command, args]] of passes.entries()) {
      const next = join(work, `step${index + 1}.glb`);
      const { code, output } = await run([command, current, next, ...args], childEnv);
      if (verbose) console.log(output.trim().split("\n").map((line) => `      ${line}`).join("\n"));
      if (code !== 0 || !existsSync(next)) {
        console.error(`  FAILED at ${command} (exit ${code})`);
        if (!verbose) console.error(output.trim().split("\n").map((line) => `      ${line}`).join("\n"));
        broke = true;
        break;
      }
      current = next;
      if (command === "resize") vram = estimateVram(await io.read(current));
    }

    if (broke) {
      failed += 1;
      continue;
    }

    const { code, output } = await run(["validate", current], childEnv);
    if (code !== 0) {
      console.error("  FAILED validation");
      console.error(output.trim().split("\n").map((line) => `      ${line}`).join("\n"));
      failed += 1;
      continue;
    }

    const target = join(outDir, `${stem}.glb`);
    await rename(current, target).catch(async () => {
      // rename across volumes fails; the temp dir is on %TEMP%, output is not.
      const { readFile, writeFile: write } = await import("node:fs/promises");
      await write(target, await readFile(current));
    });

    const after = (await stat(target)).size;
    afterTotal += after;
    vramTotal += vram;
    console.log(`  ${mb(before)} -> ${mb(after)} on disk, ~${mb(vram)} VRAM`);
    console.log(`  written ${rel(target)}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

console.log("");
if (dryRun) {
  console.log(`dry run over ${files.length} file(s), ${mb(beforeTotal)} on disk`);
  console.log("re-run without --dry-run to write");
} else {
  const done = files.length - failed;
  console.log(`${done}/${files.length} converted`);
  console.log(`  disk  ${mb(beforeTotal)} -> ${mb(afterTotal)}`);
  console.log(`  VRAM  ~${mb(vramTotal)} for these ${done} model(s)`);
}
if (failed > 0) process.exitCode = 1;
