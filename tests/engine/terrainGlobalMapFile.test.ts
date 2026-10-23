import assert from "node:assert/strict";
import { encodeTerrainGlobalMap, decodeTerrainGlobalMap, validateTerrainGlobalMap, TERRAIN_GLOBAL_HEADER_BYTES } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, terrainGlobalMapPath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { validateSaveTerrainGlobal } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

function fixture() {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Global", tileQuads: 32, spacing: 1, tilesX: 2, tilesZ: 2,
    origin: [7, 100, -3], heightMin: -8, heightMax: 8, collision: true,
    layers: Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, name: `Layer ${i}`, color: "#123456" })),
    tiles: ["0_0", "1_0", "0_1"].map((key) => ({ key, minHeight: 0, maxHeight: 0 })),
  };
  const tiles = new Map(def.tiles.map(({ key }) => {
    const [x, z] = key.split("_").map(Number) as [number, number];
    const tile = createFlatTerrainTile(def, x, z);
    tile.weights.forEach((_, i) => { tile.weights[i] = i % 256; });
    return [key, tile];
  }));
  const attributes = buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles));
  return { def, attributes, bytes: encodeTerrainGlobalMap(def, attributes) };
}

export function registerTerrainGlobalMapFileTests(check: Check): void {
  check("terrain global file: bit-exact multi-tile round trip preserves NaN payloads, signed zero and both weight blocks", () => {
    const { def, attributes } = fixture();
    attributes.map.heights[0] = -0;
    attributes.normals[0] = -0;
    const hole = attributes.map.heights.findIndex(Number.isNaN);
    assert.ok(hole >= 0);
    new Uint32Array(attributes.map.heights.buffer)[hole] = 0x7fc01234;
    const bytes = encodeTerrainGlobalMap(def, attributes);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "FGLB");
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes, 1); // An unaligned Buffer/subarray must work too.
    const decoded = validateTerrainGlobalMap(def, padded.subarray(1));
    assert.deepEqual(decoded, attributes);
    assert.deepEqual(new Uint8Array(decoded.map.heights.buffer), new Uint8Array(attributes.map.heights.buffer));
    assert.deepEqual(new Uint8Array(decoded.normals.buffer), new Uint8Array(attributes.normals.buffer));
    assert.deepEqual(encodeTerrainGlobalMap(def, decodeTerrainGlobalMap(bytes)), bytes);
    decoded.weights[0] = 99;
    assert.notEqual(decoded.weights[0], attributes.weights[0], "decode owns its data");
  });

  check("terrain global file: corrupt headers, lengths, samples and definition mismatches are rejected", () => {
    const { def, attributes, bytes } = fixture();
    for (const offset of [0, 4, 6, 8, 12, 16, 20, 22, 24, 26, 28]) {
      const broken = bytes.slice(); broken[offset] = 255;
      assert.throws(() => decodeTerrainGlobalMap(broken), `header offset ${offset}`);
    }
    for (const broken of [bytes.subarray(0, 4), bytes.subarray(0, bytes.length - 1), new Uint8Array(bytes.length + 1)]) {
      assert.throws(() => decodeTerrainGlobalMap(broken));
    }
    const normalOffset = TERRAIN_GLOBAL_HEADER_BYTES + attributes.map.heights.byteLength;
    for (const [offset, value] of [[32, Infinity], [32, NaN], [normalOffset, NaN], [normalOffset, 2], [normalOffset + 8, 0.5]]) {
      const broken = bytes.slice(); new DataView(broken.buffer).setFloat32(offset!, value!, true);
      assert.throws(() => decodeTerrainGlobalMap(broken), `sample ${offset}: ${value}`);
    }
    for (const patch of [{ tilesX: 1 }, { tilesZ: 1 }, { tileQuads: 64 }, { layers: def.layers.slice(1) }]) {
      assert.throws(() => validateTerrainGlobalMap({ ...def, ...patch }, bytes), /definition/);
    }
    assert.throws(() => encodeTerrainGlobalMap(def, { ...attributes, normals: new Float32Array(3) }), /shape/);
    const path = "worlds/a.terrain.json";
    assert.equal(validateSaveTerrainGlobal(path, bytes), terrainGlobalMapPath(path));
    for (const invalid of ["../a.terrain.json", "/a.terrain.json", "a%2f.terrain.json", "a.json"]) {
      assert.throws(() => validateSaveTerrainGlobal(invalid, bytes));
    }
  });
}
