import assert from "node:assert/strict";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import {
  applyTerrainUndoPatches, createTerrainEditWorld, createTerrainHeightmapPatches, revertTerrainUndoPatches,
} from "../../engine/terrain/terrainEdit";
import {
  exportRawHeightmap, heightmapSamplesToRaw, importRawHeightmap, iterateRawHeightmapTiles, rawHeightmapToSamples,
  type RawHeightmapImportOptions,
} from "../../engine/terrain/terrainImport";
import { validateTerrainTile } from "../../engine/terrain/terrainLoader";
import {
  decodeTerrainTile, encodeTerrainTile, TERRAIN_TILE_HEADER_BYTES,
  type TerrainTileEncodeOptions,
} from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, tileKey, type TerrainTileData } from "../../engine/terrain/terrainTypes";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";

type Check = (label: string, fn: () => void) => void;

function fixture(tilesX = 2, tilesZ = 3, bigEndian = false): RawHeightmapImportOptions {
  const width = tilesX * 32 + 1;
  const height = tilesZ * 32 + 1;
  const bytes = new Uint8Array(width * height * 2);
  const view = new DataView(bytes.buffer);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) view.setUint16((z * width + x) * 2, (x * 997 + z * 7919) % 65536, !bigEndian);
  }
  return {
    bytes, width, height, endianness: bigEndian ? "big" : "little", tileQuads: 32,
    heightMin: -100.1, heightMax: 300.2, spacing: 2, origin: [-53, 17, 92],
  };
}

/** Pre-fast-path codec: independent DataView header, sample and weight writes. */
function referenceEncode(tile: TerrainTileData, options: TerrainTileEncodeOptions): Uint8Array {
  const float = options.heightFormat === "f32";
  const bytes = new Uint8Array(32 + tile.heights.length * (float ? 4 : 2) + tile.weights.length);
  bytes.set([70, 84, 73, 76]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, float ? 1 : 0, true);
  view.setUint16(8, tile.size, true);
  view.setUint8(10, tile.layerCount);
  view.setFloat32(12, options.heightMin, true);
  view.setFloat32(16, options.heightMax, true);
  view.setInt32(20, tile.x, true);
  view.setInt32(24, tile.z, true);
  const min = Math.fround(options.heightMin);
  const range = Math.fround(options.heightMax) - min;
  let offset = 32;
  for (const height of tile.heights) {
    const value = Number.isFinite(height) ? height : 0;
    if (float) view.setFloat32(offset, value, true);
    else view.setUint16(offset, Math.round(Math.min(1, Math.max(0, (value - min) / range)) * 65535), true);
    offset += float ? 4 : 2;
  }
  bytes.set(tile.weights, offset);
  return bytes;
}

function referenceHeights(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint16(8, true);
  const float = view.getUint16(6, true) === 1;
  const min = view.getFloat32(12, true);
  const range = view.getFloat32(16, true) - min;
  return Float32Array.from({ length: size * size }, (_, index) => float
    ? view.getFloat32(32 + index * 4, true) : min + view.getUint16(32 + index * 2, true) / 65535 * range);
}

export function registerTerrainImportTests(check: Check): void {
  check("terrain heightmap u16 codes and little-endian RAW bytes convert both ways", () => {
    const samples = Uint16Array.from([0, 1, 255, 256, 32768, 65534, 65535]);
    const raw = heightmapSamplesToRaw(samples);
    assert.deepEqual(Array.from(raw.subarray(0, 8)), [0, 0, 1, 0, 255, 0, 0, 1]);
    assert.deepEqual(rawHeightmapToSamples(raw), samples);
    assert.deepEqual(rawHeightmapToSamples(raw.subarray(2, 6)), Uint16Array.from([1, 255]));
    assert.throws(() => rawHeightmapToSamples(new Uint8Array(3)), /odd byte count/);
  });

  check("terrain RAW: 2x3 tiles round-trip byte-identically with row-major orientation", () => {
    const options = fixture();
    const { def, tiles } = importRawHeightmap(options);
    assert.equal(def.tilesX, 2);
    assert.equal(def.tilesZ, 3);
    assert.deepEqual(def.origin, options.origin);
    assert.equal(def.spacing, 2);
    assert.deepEqual(def.layers, []);
    assert.deepEqual(normalizeWorldTerrain(def), def);
    assert.deepEqual([...tiles.keys()], ["0_0", "1_0", "0_1", "1_1", "0_2", "1_2"]);
    assert.deepEqual(exportRawHeightmap(def, tiles), options.bytes);
    const source = new DataView((options.bytes as Uint8Array).buffer);
    for (const [key, bytes] of tiles) {
      const tile = validateTerrainTile(def, key, bytes);
      const view = new DataView(bytes.buffer);
      for (let z = 0; z < tile.size; z += 1) {
        for (let x = 0; x < tile.size; x += 1) {
          assert.equal(view.getUint16(32 + (z * tile.size + x) * 2, true),
            source.getUint16(((tile.z * 32 + z) * options.width + tile.x * 32 + x) * 2, true));
        }
      }
    }
  });

  check("terrain RAW: duplicated neighbour edges and four-tile corners are identical", () => {
    const { tiles } = importRawHeightmap(fixture());
    for (let z = 0; z < 3; z += 1) {
      for (let x = 0; x < 2; x += 1) {
        const tile = decodeTerrainTile(tiles.get(tileKey(x, z))!);
        const rightBytes = tiles.get(tileKey(x + 1, z));
        const belowBytes = tiles.get(tileKey(x, z + 1));
        const right = rightBytes ? decodeTerrainTile(rightBytes) : null;
        const below = belowBytes ? decodeTerrainTile(belowBytes) : null;
        for (let index = 0; index < tile.size; index += 1) {
          if (right) assert.equal(tile.heights[index * 33 + 32], right.heights[index * 33]);
          if (below) assert.equal(tile.heights[32 * 33 + index], below.heights[index]);
        }
      }
    }
  });

  check("terrain RAW: summaries exactly bound decoded per-tile samples", () => {
    const { def, tiles } = importRawHeightmap(fixture());
    for (const summary of def.tiles) {
      const tile = validateTerrainTile(def, summary.key, tiles.get(summary.key)!);
      assert.equal(summary.minHeight, Math.min(...tile.heights));
      assert.equal(summary.maxHeight, Math.max(...tile.heights));
    }
  });

  check("terrain RAW: invalid dimensions describe nearest valid sizes without resampling", () => {
    const options = fixture();
    assert.throws(() => importRawHeightmap({ ...options, width: 70 }), /RAW width 70.*multiple of tileQuads 32.*nearest valid sizes: 65 or 97.*explicit resolution; no resampling/);
    assert.throws(() => importRawHeightmap({ ...options, height: 96 }), /RAW height 96.*nearest valid sizes: 65 or 97/);
    for (const width of [0, 1, -3, 33.5, Infinity, NaN, 1057]) {
      assert.throws(() => importRawHeightmap({ ...options, width }), /RAW width.*nearest valid sizes/);
    }
  });

  check("terrain RAW: validates byte length, tile shape, range, spacing, origin and endianness", () => {
    const options = fixture();
    assert.throws(() => importRawHeightmap({ ...options, bytes: new Uint8Array(2) }), /expected.*bytes/);
    assert.throws(() => importRawHeightmap({ ...options, tileQuads: 31 }), /tileQuads/);
    for (const [heightMin, heightMax] of [[1, 1], [2, 1], [Infinity, 2], [1, 1 + 1e-9], [-1e40, 1e40]]) {
      assert.throws(() => importRawHeightmap({ ...options, heightMin: heightMin!, heightMax: heightMax! }), /height/);
    }
    assert.throws(() => importRawHeightmap({ ...options, spacing: 0 }), /spacing/);
    assert.throws(() => importRawHeightmap({ ...options, origin: [0, NaN, 0] }), /origin/);
    assert.throws(() => importRawHeightmap({ ...options, endianness: "middle" as "little" }), /endianness/);
  });

  check("terrain RAW: big-endian and unaligned input export canonical little-endian bytes", () => {
    const options = fixture(2, 3, true);
    const source = options.bytes as Uint8Array;
    const padded = new Uint8Array(source.length + 3);
    padded.set(source, 1);
    const { def, tiles } = importRawHeightmap({ ...options, bytes: padded.subarray(1, source.length + 1) });
    assert.deepEqual(exportRawHeightmap(def, tiles), fixture().bytes);
    const { endianness: _endianness, ...defaults } = fixture(1, 1);
    const fromBuffer = importRawHeightmap({ ...defaults, bytes: (defaults.bytes as Uint8Array).buffer as ArrayBuffer });
    assert.deepEqual(exportRawHeightmap(fromBuffer.def, fromBuffer.tiles), defaults.bytes);
  });

  check("terrain RAW: iterator and export report per-tile progress with transferable import buffers", () => {
    const options = fixture();
    const iterator = iterateRawHeightmapTiles(options);
    for (let completed = 1; completed <= 6; completed += 1) {
      const next = iterator.next();
      assert.equal(next.done, false);
      if (next.done) throw new Error("early iterator completion");
      assert.equal(next.value.completed, completed);
      assert.equal(next.value.total, 6);
      assert.equal(next.value.summary.key, next.value.key);
      const bytes = next.value.bytes;
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
      assert.equal(bytes.byteLength, 0, "worker may transfer a tile before requesting the next one");
    }
    assert.deepEqual(iterator.next(), { done: true, value: importRawHeightmap(options).def });
    const lazy = iterateRawHeightmapTiles({ ...options, width: 70 });
    assert.throws(() => lazy.next(), /nearest valid sizes/);
    const { def, tiles } = importRawHeightmap(options);
    const keys: string[] = [];
    assert.deepEqual(exportRawHeightmap(def, tiles, ({ key, completed, total }) => {
      keys.push(key);
      assert.equal(completed, keys.length);
      assert.equal(total, 6);
    }), options.bytes);
    assert.deepEqual(keys, [...tiles.keys()]);
  });

  check("terrain RAW: all 65536 codes survive a range narrower than Float32 sample precision", () => {
    const width = 257;
    const bytes = new Uint8Array(width * width * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < width * width; index += 1) view.setUint16(index * 2, index % 65536, true);
    const { def, tiles } = importRawHeightmap({
      ...fixture(1, 1), bytes, width, height: width, tileQuads: 256, heightMin: 1e6, heightMax: 1e6 + 1,
    });
    assert.deepEqual(exportRawHeightmap(def, tiles), bytes);
  });

  check("terrain RAW: f32 export clamps heights and quantizes to the nearest u16 level", () => {
    const { def } = importRawHeightmap({ ...fixture(1, 1), heightMin: -2, heightMax: 2 });
    const tile = createFlatTerrainTile(def, 0, 0);
    tile.heights.set([-100, -2, -0.37, 0, 0.5, 2, 100]);
    const bytes = encodeTerrainTile(tile, { ...def, heightFormat: "f32" });
    const output = exportRawHeightmap(def, new Map([["0_0", bytes]]));
    const view = new DataView(output.buffer);
    for (let index = 0; index < tile.heights.length; index += 1) {
      const expected = Math.min(2, Math.max(-2, tile.heights[index]!));
      assert.ok(Math.abs(-2 + view.getUint16(index * 2, true) / 65535 * 4 - expected) <= 2 / 65535);
    }
    assert.equal(view.getUint16(0, true), 0);
    assert.equal(view.getUint16(12, true), 65535);
  });

  check("terrain RAW: export detects disagreeing X/Z edges and shared corners", () => {
    for (const [key, index] of [["1_0", 33], ["0_1", 1], ["1_1", 0]] as const) {
      const { def, tiles } = importRawHeightmap(fixture());
      const bytes = tiles.get(key)!;
      const view = new DataView(bytes.buffer);
      const offset = TERRAIN_TILE_HEADER_BYTES + index * 2;
      view.setUint16(offset, view.getUint16(offset, true) ^ 1, true);
      assert.throws(() => exportRawHeightmap(def, tiles), /duplicated edge mismatch.*tile/);
    }
  });

  check("terrain RAW: export checks edges before quantization and detects collapsed u16 disagreements", () => {
    const { def, tiles } = importRawHeightmap({ ...fixture(2, 1), heightMin: 0, heightMax: 1 });
    for (const [key, bytes] of tiles) {
      const tile = decodeTerrainTile(bytes);
      tile.heights.fill(0.5);
      if (key === "1_0") tile.heights[0] = 0.5 + 2 ** -24;
      tiles.set(key, encodeTerrainTile(tile, { ...def, heightFormat: "f32" }));
    }
    assert.throws(() => exportRawHeightmap(def, tiles), /duplicated edge mismatch/);
    const narrow = importRawHeightmap({ ...fixture(2, 1), heightMin: 1e6, heightMax: 1e6 + 1 });
    const bytes = narrow.tiles.get("1_0")!;
    const view = new DataView(bytes.buffer);
    const oldHeight = decodeTerrainTile(bytes).heights[0];
    const offset = TERRAIN_TILE_HEADER_BYTES;
    view.setUint16(offset, view.getUint16(offset, true) ^ 1, true);
    assert.equal(decodeTerrainTile(bytes).heights[0], oldHeight);
    assert.throws(() => exportRawHeightmap(narrow.def, narrow.tiles), /duplicated edge mismatch/);
  });

  check("terrain RAW: 2x2 u16 round trip preserves covered samples exactly with a hole in any position", () => {
    for (const hole of ["0_0", "1_0", "0_1", "1_1"]) {
      for (const range of [{ heightMin: -100.1, heightMax: 300.2 }, { heightMin: 1e6, heightMax: 1e6 + 1 }]) {
        const options = { ...fixture(2, 2), ...range };
        const { def, tiles } = importRawHeightmap(options);
        def.tiles = def.tiles.filter(({ key }) => key !== hole);
        tiles.delete(hole);
        const resident = [...tiles.values()].map(decodeTerrainTile);
        const expected = (options.bytes as Uint8Array).slice();
        const output = new DataView(expected.buffer);
        for (let z = 0; z < options.height; z += 1) {
          for (let x = 0; x < options.width; x += 1) {
            const covered = resident.some((tile) => x >= tile.x * 32 && x <= (tile.x + 1) * 32
              && z >= tile.z * 32 && z <= (tile.z + 1) * 32);
            if (!covered) output.setUint16((z * options.width + x) * 2, 0, true);
          }
        }
        const progress: number[] = [];
        const raw = exportRawHeightmap(def, tiles, ({ completed, total }) => {
          assert.equal(total, 3);
          progress.push(completed);
        });
        assert.deepEqual(raw, expected);
        assert.deepEqual(progress, [1, 2, 3]);
        const restored = importRawHeightmap({ ...options, bytes: raw });
        restored.def.tiles = restored.def.tiles.filter(({ key }) => key !== hole);
        restored.tiles.delete(hole);
        assert.deepEqual(exportRawHeightmap(restored.def, restored.tiles), raw);
      }
    }
  });

  check("terrain RAW editor: full-tile import preserves holes, paint and seams; undo restores exact heights and summaries", () => {
    const options = fixture(2, 2);
    const imported = importRawHeightmap(options);
    const def = structuredClone(imported.def);
    def.tiles = def.tiles.filter(({ key }) => key !== "0_0");
    def.layers = [{ id: "base", name: "Base", color: "#ffffff" }, { id: "paint", name: "Paint", color: "#00ff00" }];
    const previous = def.tiles.map(({ key }) => {
      const decoded = decodeTerrainTile(imported.tiles.get(key)!);
      const tile = createFlatTerrainTile(def, decoded.x, decoded.z);
      tile.heights.forEach((_, index) => { tile.heights[index] = Math.fround(index / 117 - 3.2); });
      tile.weights.forEach((_, index) => { tile.weights[index] = index % 256; });
      return tile;
    });
    const world = createTerrainEditWorld(def, previous);
    const before = structuredClone(world.def);
    const originals = new Map([...world.tiles].map(([key, tile]) => [key, { heights: tile.heights.slice(), weights: tile.weights.slice() }]));
    const heights = new Map([...imported.tiles].map(([key, bytes]) => [key, decodeTerrainTile(bytes).heights]));
    const patches = createTerrainHeightmapPatches(world, heights);
    assert.equal(patches.length, 3);
    assert.deepEqual(world.def, before, "staging makes no changes");
    for (const patch of patches) assert.deepEqual(patch.rect, { x0: 0, z0: 0, x1: 32, z1: 32 });
    const dirty = applyTerrainUndoPatches(world, patches);
    assert.equal(dirty.size, 3);
    assert.equal(world.tiles.has("0_0"), false);
    for (const [key, tile] of world.tiles) {
      assert.deepEqual(tile.heights, heights.get(key));
      assert.deepEqual(tile.weights, originals.get(key)!.weights);
      const right = world.tile(tile.x + 1, tile.z);
      const below = world.tile(tile.x, tile.z + 1);
      for (let index = 0; index < tile.size; index += 1) {
        if (right) assert.equal(tile.heights[index * 33 + 32], right.heights[index * 33]);
        if (below) assert.equal(tile.heights[32 * 33 + index], below.heights[index]);
      }
      const summary = world.def.tiles.find((entry) => entry.key === key)!;
      assert.equal(summary.minHeight, Math.min(...tile.heights));
      assert.equal(summary.maxHeight, Math.max(...tile.heights));
    }
    const snapshot = captureWorldTerrainSave(world, dirty.keys(), new Map());
    const exported = exportRawHeightmap(snapshot.def, new Map(snapshot.tiles.map(({ key, bytes }) => [key, bytes])));
    const expectedDef = { ...imported.def, tiles: imported.def.tiles.filter(({ key }) => key !== "0_0") };
    assert.deepEqual(exported, exportRawHeightmap(expectedDef, imported.tiles), "editable Float32 path preserves normal-range u16 codes");
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(world.def, before);
    for (const [key, tile] of world.tiles) {
      assert.deepEqual(tile.heights, originals.get(key)!.heights);
      assert.deepEqual(tile.weights, originals.get(key)!.weights);
    }
    applyTerrainUndoPatches(world, patches);
    for (const [key, tile] of world.tiles) assert.deepEqual(tile.heights, heights.get(key));
  });

  check("terrain RAW editor: wrong-size RAW and invalid tile patches reject before changing heights", () => {
    const options = fixture(2, 2);
    const imported = importRawHeightmap(options);
    const world = createTerrainEditWorld(imported.def, [...imported.tiles.values()].map(decodeTerrainTile));
    const before = structuredClone([...world.tiles]);
    for (const length of [0, 2, options.width * options.height * 2 - 2, options.width * options.height * 2 + 2]) {
      assert.throws(() => importRawHeightmap({ ...options, bytes: new Uint8Array(length) }), /expected 8450 bytes for 65x65/);
    }
    const heights = new Map([...world.tiles].map(([key, tile]) => [key, tile.heights.slice()]));
    heights.get("1_1")![0] = NaN;
    assert.throws(() => createTerrainHeightmapPatches(world, heights), /Invalid imported terrain heights/);
    heights.delete("1_1");
    assert.throws(() => createTerrainHeightmapPatches(world, heights), /Invalid imported terrain heights/);
    assert.deepEqual([...world.tiles], before);
  });

  check("terrain RAW editor: imported relief outside encoding range is exported through a widened save snapshot", () => {
    const imported = importRawHeightmap(fixture(2, 2));
    const world = createTerrainEditWorld(imported.def, [...imported.tiles.values()].map(decodeTerrainTile));
    const raised = importRawHeightmap({ ...fixture(2, 2), heightMin: -2000, heightMax: 3000 });
    const heights = new Map([...raised.tiles].map(([key, bytes]) => [key, decodeTerrainTile(bytes).heights]));
    const patches = createTerrainHeightmapPatches(world, heights);
    applyTerrainUndoPatches(world, patches);
    const snapshot = captureWorldTerrainSave(world, world.tiles.keys(), new Map());
    assert.equal(snapshot.widened, true);
    assert.ok(snapshot.def.heightMin < -1999);
    assert.ok(snapshot.def.heightMax > 2999);
    const raw = exportRawHeightmap(snapshot.def, new Map(snapshot.tiles.map(({ key, bytes }) => [key, bytes])));
    const restored = importRawHeightmap({ ...fixture(2, 2), bytes: raw, heightMin: snapshot.def.heightMin, heightMax: snapshot.def.heightMax });
    const halfStep = (snapshot.def.heightMax - snapshot.def.heightMin) / 65535 / 2;
    for (const [key, bytes] of restored.tiles) {
      const tile = decodeTerrainTile(bytes);
      tile.heights.forEach((height, index) => assert.ok(Math.abs(height - world.tiles.get(key)!.heights[index]!) <= halfStep + 0.001));
    }
    assert.equal(world.def.heightMin, imported.def.heightMin, "export leaves the live definition unchanged");
    revertTerrainUndoPatches(world, patches);
    for (const [key, tile] of world.tiles) assert.deepEqual(tile.heights, decodeTerrainTile(imported.tiles.get(key)!).heights);
  });

  check("terrain RAW: export rejects missing declared tiles, malformed headers and non-finite samples", () => {
    const { def, tiles } = importRawHeightmap(fixture());
    const missing = new Map(tiles);
    missing.delete("1_2");
    assert.throws(() => exportRawHeightmap(def, missing), /missing tile 1_2/);
    const swapped = new Map(tiles);
    swapped.set("0_0", tiles.get("1_0")!);
    assert.throws(() => exportRawHeightmap(def, swapped), /header does not match/);
    const tile = decodeTerrainTile(tiles.get("0_0")!);
    const corrupt = encodeTerrainTile(tile, { ...def, heightFormat: "f32" });
    new DataView(corrupt.buffer).setFloat32(TERRAIN_TILE_HEADER_BYTES, NaN, true);
    tiles.set("0_0", corrupt);
    assert.throws(() => exportRawHeightmap(def, tiles), /non-finite heights/);
  });

  check("terrain codec fast path: random tiles match previous DataView bytes and decoded samples", () => {
    let seed = 0x12345678;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (const tileQuads of [32, 64, 128]) {
      for (const layerCount of [0, 1, 4, 5, 8]) {
        const layers = Array.from({ length: layerCount }, (_, index) => ({ id: `${index}`, name: "Base", color: "#ffffff" }));
        const tile = createFlatTerrainTile({ tileQuads, layers }, -3, 7);
        for (let index = 0; index < tile.heights.length; index += 1) tile.heights[index] = random() * 1600 - 800;
        tile.heights.set([NaN, Infinity, -Infinity, -128.37, 400.19, 0]);
        for (let index = 0; index < tile.weights.length; index += 1) tile.weights[index] = Math.floor(random() * 256);
        for (const heightFormat of ["u16", "f32"] as const) {
          const options = { heightMin: -128.37, heightMax: 400.19, heightFormat };
          const expected = referenceEncode(tile, options);
          const actual = encodeTerrainTile(tile, options);
          assert.deepEqual(actual, expected);
          assert.deepEqual(decodeTerrainTile(actual).heights, referenceHeights(expected));
          for (const offset of [1, 2, 7, 8]) {
            const padded = new Uint8Array(actual.length + offset + 3);
            padded.set(actual, offset);
            assert.deepEqual(decodeTerrainTile(padded.subarray(offset, offset + actual.length)), decodeTerrainTile(actual));
          }
        }
      }
    }
  });
}
