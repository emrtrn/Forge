/** Forge's own reference car. Run: node art/vehicles/reference-car/generate.mjs
 * Metres, +Y up, +Z forward. The actor's existing 1.6 scale is kept; physics
 * and wheel hard points remain in ReferenceCar.vehicle.json, unchanged.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

// GLTFExporter only needs Blob -> ArrayBuffer for an untextured binary export.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend(); });
  }
};

const output = new URL("../../../public/assets/vehicles/reference-car/", import.meta.url);
const scale = 1.6;
const root = new Group();
root.name = "ReferenceCar";
const paint = new MeshStandardMaterial({ color: "#5599bb", roughness: 0.65 });
paint.name = "ReferencePaint";
const glass = new MeshStandardMaterial({ color: "#263c50", roughness: 0.3 });
const rubber = new MeshStandardMaterial({ color: "#25282c", roughness: 0.95 });

function box(name, size, center, segments, material) {
  const geometry = new BoxGeometry(...size.map((value) => value / scale), ...segments);
  // BoxGeometry uses six material groups, but each part is one mesh/material.
  geometry.clearGroups();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.fromArray(center.map((value) => value / scale));
  root.add(mesh);
}

// Subdivisions give impacts nearby vertices even on the flat front of the car.
box("body", [2.08, 0.4, 4.08], [0, 1.05, -0.04], [8, 4, 16], paint);
box("cabin", [1.65, 0.51, 1.75], [0, 1.505, -0.15], [6, 3, 8], glass);
for (const [name, x, z] of [
  ["wheel-front-left", 0.68, 1.056], ["wheel-front-right", -0.68, 1.056],
  ["wheel-back-left", 0.68, -1.056], ["wheel-back-right", -0.68, -1.056],
]) {
  const geometry = new CylinderGeometry(0.48 / scale, 0.48 / scale, 0.28 / scale, 16);
  geometry.rotateZ(Math.PI / 2);
  geometry.clearGroups();
  const mesh = new Mesh(geometry, rubber);
  mesh.name = name;
  mesh.position.set(x / scale, 0.83 / scale, z / scale);
  root.add(mesh);
}

// A tiny original checker texture keeps the external texture loading path covered.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(8, 0);
header.writeUInt32BE(8, 4);
header[8] = 8;
header[9] = 2; // RGB, 8 bits per channel
const pixels = Buffer.alloc(8 * (1 + 8 * 3));
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const shade = ((x >> 2) + (y >> 2)) % 2 ? 210 : 255;
  pixels.fill(shade, y * 25 + 1 + x * 3, y * 25 + 4 + x * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
]);

const exported = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true }));
const jsonLength = exported.readUInt32LE(12);
const document = JSON.parse(exported.subarray(20, 20 + jsonLength).toString());
document.asset.generator = "Forge reference-car generator";
document.images = [{ uri: "ReferenceCarPalette.png" }];
document.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }];
document.textures = [{ sampler: 0, source: 0 }];
document.materials.find((material) => material.name === "ReferencePaint")
  .pbrMetallicRoughness.baseColorTexture = { index: 0 };
const json = Buffer.from(JSON.stringify(document));
const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
json.copy(paddedJson);
const binaryChunk = exported.subarray(20 + jsonLength);
const glbHeader = Buffer.alloc(20);
glbHeader.writeUInt32LE(0x46546c67, 0);
glbHeader.writeUInt32LE(2, 4);
glbHeader.writeUInt32LE(20 + paddedJson.length + binaryChunk.length, 8);
glbHeader.writeUInt32LE(paddedJson.length, 12);
glbHeader.writeUInt32LE(0x4e4f534a, 16);
const glb = Buffer.concat([glbHeader, paddedJson, binaryChunk]);
await mkdir(output, { recursive: true });
await writeFile(new URL("ReferenceCar.glb", output), glb);
await writeFile(new URL("ReferenceCarPalette.png", output), png);
console.log(`Reference car: ${glb.length} model bytes, ${png.length} texture bytes -> ${fileURLToPath(output)}`);
