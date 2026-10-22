// Original geometric starter content. No downloaded models, images or fonts.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

export const STARTER_LICENSE = "Project-original; distribution controlled by the project owner";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}

function checkerPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2; // RGB, two alternating original colors.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 45, 135, 165, 220, 190, 115, 0, 220, 190, 115, 45, 135, 165]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function cubeGeometry() {
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  const positions = [], normals = [], uvs = [], indices = [];
  for (const [normal, corners] of faces) {
    const offset = positions.length / 3;
    for (const corner of corners) { positions.push(...corner); normals.push(...normal); }
    uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const arrays = [new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint16Array(indices)];
  const binary = Buffer.concat(arrays.map((array) => Buffer.from(array.buffer)));
  let offset = 0;
  const views = arrays.map((array) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: array.byteLength };
    offset += array.byteLength;
    return view;
  });
  return { binary, gltf: {
    asset: { version: "2.0", generator: "Forge original geometric starter" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "Starter Cube" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    buffers: [{ uri: "cube.bin", byteLength: binary.length }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 24, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    textures: [{ source: 0 }], images: [{ uri: "checker.png" }],
  } };
}

const text = (id, value) => ({ id, widget: "Text", props: { text: value } });
const button = (id, label, message) => ({ id, widget: "Button", props: { text: label, onClick: { type: "message", message } } });

/** Write only into the caller-owned staging directory, never public/. */
export async function createStarterContent(root) {
  const documents = new Map();
  const json = (path, value) => documents.set(path, Buffer.from(JSON.stringify(value) + "\n"));
  const { binary, gltf } = cubeGeometry();
  documents.set("assets/release/cube.bin", binary);
  documents.set("assets/release/checker.png", checkerPng());
  json("assets/release/cube.gltf", gltf);
  json("assets/release/cube.materials.json", { schema: 1, slots: ["release-material"] });
  for (const kind of ["collision", "uvw", "skeleton"]) json(`assets/release/cube.${kind}.json`, { schema: 1 });
  json("assets/release/checker.material.json", {
    schema: 1, name: "Original Checker", shadingModel: "standard", baseColor: "#ffffff",
    baseColorTexture: "release-texture", roughness: 0.8, metalness: 0,
  });
  const panel = (children) => ({ id: "root", widget: "Canvas", props: { align: "center", justify: "center" }, children: [
    { id: "panel", widget: "Panel", props: { width: 420, padding: 24, gap: 12, background: "#17202d" }, children },
  ] });
  json("assets/release/menu.ui.json", { schema: 1, type: "ui", name: "Starter Menu", initialFocus: "resume", root: panel([
    text("title", "Starter Menu"),
    { id: "quick-status", widget: "Text", props: { text: { bind: "save.slots.quick.status" } } },
    { id: "quick-level", widget: "Text", props: { text: { bind: "save.slots.quick.level" } } },
    button("quick-save", "Save", "save:write:quick"), button("quick-load", "Load", "save:load:quick"),
    button("travel", "Next level", "travel:layouts/destination.level.json"),
    button("home", "First level", "travel:layouts/starter.level.json"), button("resume", "Resume", "game:resume"),
  ]) });
  json("assets/release/hud.ui.json", { schema: 1, type: "ui", name: "Starter HUD", root: {
    id: "root", widget: "Canvas", props: { padding: 24 }, children: [text("instructions", "Forge Starter | WASD: move | Q/E: height | Escape: menu")],
  } });
  json("landscapes/starter.landscape.json", {
    schema: 1, type: "landscape", size: { verticesX: 65, verticesZ: 65, spacing: 0.5, heightScale: 1 },
    chunks: { quadsPerChunk: 32 }, heights: Array(65 * 65).fill(0),
    layers: [{ id: "base", name: "Checker", material: "release-material", weights: Array(65 * 65).fill(1) }], splines: [],
  });
  for (const [file, name, x] of [["starter", "ReleaseStarter", -2], ["destination", "ReleaseDestination", 2]]) {
    json(`layouts/${file}.level.json`, {
      schema: 1, name, loadGroups: [],
      instances: [{ assetId: "release-cube", placements: [{ position: [x, 1, 0], scale: 1, rotationYDeg: 20 }] }], characters: [],
      worldSettings: { gameMode: "forge.defaultCamera", hudWidget: "release-hud", pauseMenuWidget: "release-menu", backgroundColor: "#182331", locale: "en" },
      lights: [{ id: "sun", type: "directional", position: [6, 9, 6], rotation: [-40, 25, 0], color: "#ffffff", intensity: 3, castShadow: true }],
      landscapes: [{ id: "starter-landscape", name: "Starter Ground", position: [0, -0.1, 0], dataRef: "landscapes/starter.landscape.json", collision: true }],
    });
    json(`layouts/${file}.foliage.json`, { schema: 1, type: "foliage", instances: [] });
    json(`layouts/${file}.meshpaint.json`, { schema: 1, type: "meshPaint", placements: [] });
  }
  const records = [
    ["release-cube", "staticMesh", "cube.gltf"], ["release-texture", "texture", "checker.png"],
    ["release-material", "material", "checker.material.json"], ["release-hud", "ui", "hud.ui.json"], ["release-menu", "ui", "menu.ui.json"],
  ].map(([id, assetType, file]) => ({
    id, name: id, assetType, category: "release-starter", path: `assets/release/${file}`, tags: ["starter"], placeable: assetType === "staticMesh",
    placement: { surface: "floor", snapToWall: false, allowRotation: true, allowScale: true },
    runtime: { loadGroup: "release-starter", castShadow: true, receiveShadow: true, collision: true, bytes: documents.get(`assets/release/${file}`).length },
    source: { origin: "forge-project-original", pack: "Geometric release starter" }, license: STARTER_LICENSE,
  }));
  json("assets/manifest.json", { version: 1, generated: "2026-10-22", ktx2: false, assets: records });
  json("project.3dgame.json", {
    schema: 1, name: "forge-release-starter", type: "three-game", version: "0.1.0", entry: "src/main.ts", publicDir: "public",
    editor: { defaultScene: "layouts/starter.level.json", assetManifest: "assets/manifest.json" }, scripts: {}, output: { distDir: "dist" },
  });
  const provenance = {};
  for (const [path, bytes] of documents) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), bytes);
    provenance[path] = {
      kind: "project-original", license: STARTER_LICENSE, evidence: "builder/web/starter-content.mjs",
      description: "Original geometric data, procedural checker pixels, or starter JSON authored in this project; no third-party source assets.",
    };
  }
  return provenance;
}
