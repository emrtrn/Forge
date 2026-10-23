import assert from "node:assert/strict";
import { createFlatLandscapeData, type ForgeLandscapeData } from "../../engine/scene/landscape";
import type { LayoutLandscape } from "../../engine/scene/layout";
import { applyTerrainBrush, createTerrainEditWorld, revertTerrainUndoPatches, applyTerrainUndoPatches } from "../../engine/terrain/terrainEdit";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { captureTerrainSnapshot, terrainDocumentToLandscape } from "../../engine/terrain/terrainLandscapeBridge";
import { legacyLandscapeToWorldTerrain } from "../../engine/terrain/terrainLegacy";
import { validateTerrainTile } from "../../engine/terrain/terrainLoader";
import { decodeTerrainTile, encodeTerrainTile, terrainTileByteLength } from "../../engine/terrain/terrainTileCodec";
import { decodeTerrainTileForStreaming } from "../../engine/terrain/terrainTileStreaming";
import { terrainTileLayerWeight, terrainTileWorldBounds, tileKey } from "../../engine/terrain/terrainTypes";
import { expandLandscapeToWorldTerrain, worldTerrainExpandProblems, type WorldTerrainExpandOptions } from "../../engine/terrain/worldTerrainExpand";
import { WORLD_TERRAIN_CREATE_MAX_VERTICES } from "../../engine/terrain/worldTerrainCreate";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";
import { validateSaveTerrainTile, TERRAIN_TILE_BODY_MAX_BYTES } from "../../tools/terrainSaveValidator";

type Check = (label: string, fn: () => void) => void;
const OPTIONS: WorldTerrainExpandOptions = { tilesX: 3, tilesZ: 3, originalX: 1, originalZ: 1 };
const ACTOR: LayoutLandscape = { id: "authored", name: "Authored terrain", position: [133.5, 17, -81.25], dataRef: "landscapes/old.landscape.json", collision: false };

function authored(size = 65, layerCount = 5): ForgeLandscapeData {
  const data = createFlatLandscapeData("small");
  data.size = { verticesX: size, verticesZ: size, spacing: 1.5, heightScale: 2.5 };
  data.heights = Array.from({ length: size * size }, (_, i) => Math.sin(i * 0.013) * 5 + (i % size) / 17);
  data.layers = Array.from({ length: layerCount }, (_, layer) => ({
    id: `layer-${layer}`, name: `Layer ${layer}`,
    ...(layer === 0 ? { material: "material:authored" } : layer === 1 ? { material: null } : {}),
    weights: Array.from({ length: size * size }, (_, i) => layer === 0 ? 0.1234 + (i % 7) * 0.0001 : (0.8766 - (i % 7) * 0.0001) / (layerCount - 1)),
  }));
  return data;
}

function expand(data = authored(), options = OPTIONS) {
  const result = expandLandscapeToWorldTerrain(ACTOR, data, options);
  assert.ok(result.ok, result.ok ? "" : result.reasons.join(" "));
  return result.document;
}

export function registerWorldTerrainExpandTests(check: Check): void {
  check("terrain expand: accepts exactly 64/128/256 quads without mutating the source or actor", () => {
    for (const size of [65, 129, 257]) {
      const data = authored(size);
      const before = structuredClone(data);
      const actorBefore = structuredClone(ACTOR);
      const document = expand(data, { tilesX: 2, tilesZ: 1, originalX: 1, originalZ: 0 });
      assert.equal(document.def.tileQuads, size - 1);
      assert.equal(document.tiles.size, 2);
      assert.deepEqual(data, before);
      assert.deepEqual(ACTOR, actorBefore);
      document.tiles.get("0_0")!.heights[0] = 999;
      assert.deepEqual(data, before, "output arrays are owned by the expansion");
    }
  });

  check("terrain expand: refuses rotation, non-square and unsupported grids before changing anything", () => {
    const data = authored();
    for (const rotation of [[0, 1, 0], [0.00000001, 0, 0], [0, 0, 90]] as [number, number, number][]) {
      const actor = { ...ACTOR, rotation };
      const before = structuredClone({ actor, data });
      const result = expandLandscapeToWorldTerrain(actor, data, OPTIONS);
      assert.ok(!result.ok && result.reasons.some((reason) => /unrotated/.test(reason)));
      assert.deepEqual({ actor, data }, before);
    }
    const rectangular = authored();
    rectangular.size.verticesZ = 129;
    assert.match(worldTerrainExpandProblems(ACTOR, rectangular, OPTIONS).join(" "), /square/);
    for (const size of [33, 66, 130, 258, 513]) {
      const invalid = { ...data, size: { ...data.size, verticesX: size, verticesZ: size } };
      assert.match(worldTerrainExpandProblems(ACTOR, invalid, OPTIONS).join(" "), /64, 128 or 256/);
      assert.equal(expandLandscapeToWorldTerrain(ACTOR, invalid, OPTIONS).ok, false);
    }
  });

  check("terrain expand: refuses local splines and all attached River Water bodies, including hidden ones", () => {
    const data = authored();
    data.splines = [{ id: "road", name: "Road", points: [], segments: [] }];
    assert.match(worldTerrainExpandProblems(ACTOR, data, OPTIONS).join(" "), /splines/);
    delete data.splines;
    const rivers = [{ landscapeRef: ACTOR.id, hidden: true }];
    const before = structuredClone({ data, rivers });
    const result = expandLandscapeToWorldTerrain(ACTOR, data, OPTIONS, rivers);
    assert.ok(!result.ok && result.reasons.some((reason) => /River Water/.test(reason)));
    assert.deepEqual({ data, rivers }, before);
    assert.deepEqual(worldTerrainExpandProblems(ACTOR, data, OPTIONS, [{ landscapeRef: "other" }]), []);
  });

  check("terrain expand: enforces tile axes, original slot, minimum tiles and creation vertex cap", () => {
    const data = authored(257);
    for (const patch of [
      { tilesX: 1, tilesZ: 1, originalX: 0, originalZ: 0 }, { tilesX: 0 }, { tilesZ: 33 },
      { tilesX: 2.5 }, { tilesX: NaN }, { tilesZ: Infinity }, { originalX: -1 }, { originalZ: 3 }, { originalZ: 0.5 },
      { tilesX: 9, tilesZ: 8 },
    ]) assert.equal(expandLandscapeToWorldTerrain(ACTOR, data, { ...OPTIONS, ...patch }).ok, false, JSON.stringify(patch));
    assert.equal(8 * 8 * 257 * 257, WORLD_TERRAIN_CREATE_MAX_VERTICES);
    assert.deepEqual(worldTerrainExpandProblems(ACTOR, data, { ...OPTIONS, tilesX: 8, tilesZ: 8 }), []);
    const invalidHeight = authored();
    invalidHeight.heights[8] = NaN;
    assert.match(worldTerrainExpandProblems(ACTOR, invalidHeight, OPTIONS).join(" "), /finite height/);
    const tooManyLayers = authored(65, 9);
    assert.match(worldTerrainExpandProblems(ACTOR, tooManyLayers, OPTIONS).join(" "), /8 paint layers/);
    const unpainted = authored();
    unpainted.layers = [];
    assert.deepEqual(expand(unpainted).def.layers, [], "unpainted heightmaps keep their empty layer set");
    for (const patch of [{ spacing: NaN }, { spacing: 0 }, { heightScale: Infinity }]) {
      assert.equal(expandLandscapeToWorldTerrain(ACTOR, { ...data, size: { ...data.size, ...patch } }, OPTIONS).ok, false);
    }
    const badPaint = authored();
    badPaint.layers[0]!.weights[0] = 1.1;
    assert.match(worldTerrainExpandProblems(ACTOR, badPaint, OPTIONS).join(" "), /paint weight/);
  });

  check("terrain expand: original Float32 heights and all eight RGBA8 paint layers exactly match the legacy conversion", () => {
    const data = authored(65, 8);
    data.heights[0] = -0;
    const legacy = legacyLandscapeToWorldTerrain(ACTOR, data);
    const document = expand(data);
    const original = document.tiles.get("1_1")!;
    assert.ok(original.heights instanceof Float32Array);
    assert.ok(original.weights instanceof Uint8Array);
    assert.deepEqual(new Uint32Array(original.heights.buffer), new Uint32Array(legacy.tile.heights.buffer), "height bits match, including signed zero");
    assert.deepEqual(original.weights, legacy.tile.weights, "paint bytes match the 1x1 conversion");
    const restored = terrainDocumentToLandscape({
      def: { ...document.def, tilesX: 1, tilesZ: 1, tiles: [{ ...document.def.tiles.find((entry) => entry.key === "1_1")!, key: "0_0" }] },
      tiles: new Map([["0_0", { ...original, x: 0, z: 0 }]]),
    });
    assert.deepEqual(restored.heights, Array.from(legacy.tile.heights));
    assert.deepEqual(restored.layers, data.layers.map((layer, index) => ({ ...layer,
      weights: Array.from(legacy.tile.heights, (_height, vertex) => terrainTileLayerWeight(legacy.tile, index, vertex)),
    })));
    assert.equal(document.def.collision, false);
    assert.equal(document.def.name, ACTOR.name);
    assert.deepEqual(document.def.layers.map(({ id, name, material }) => ({ id, name, material })), data.layers.map(({ id, name, material }) => ({ id, name, material })));
  });

  check("terrain expand: every height extends the nearest original edge/corner and new interior paint is layer zero", () => {
    const data = authored();
    const legacy = legacyLandscapeToWorldTerrain(ACTOR, data).tile;
    const document = expand(data);
    const q = data.size.verticesX - 1;
    for (const tile of document.tiles.values()) {
      assert.ok(tile.heights instanceof Float32Array);
      assert.ok(tile.weights instanceof Uint8Array);
      for (let z = 0; z <= q; z += 1) for (let x = 0; x <= q; x += 1) {
        const sx = (tile.x - 1) * q + x;
        const sz = (tile.z - 1) * q + z;
        const source = Math.max(0, Math.min(q, sz)) * (q + 1) + Math.max(0, Math.min(q, sx));
        const index = z * tile.size + x;
        assert.equal(tile.heights[index], legacy.heights[source]);
        const original = sx >= 0 && sx <= q && sz >= 0 && sz <= q;
        for (let layer = 0; layer < data.layers.length; layer += 1) {
          assert.equal(terrainTileLayerWeight(tile, layer, index), original ? terrainTileLayerWeight(legacy, layer, source) : layer === 0 ? 1 : 0);
        }
      }
    }
  });

  check("terrain expand: every duplicated seam has identical heights and paint, including four-tile corners", () => {
    const document = expand();
    const compare = (a: typeof document.tiles extends Map<string, infer T> ? T : never, ai: number, b: typeof a, bi: number) => {
      assert.equal(a.heights[ai], b.heights[bi]);
      for (let layer = 0; layer < a.layerCount; layer += 1) assert.equal(terrainTileLayerWeight(a, layer, ai), terrainTileLayerWeight(b, layer, bi));
    };
    for (const tile of document.tiles.values()) {
      const right = document.tiles.get(tileKey(tile.x + 1, tile.z));
      const down = document.tiles.get(tileKey(tile.x, tile.z + 1));
      for (let i = 0; i < tile.size; i += 1) {
        if (right) compare(tile, i * tile.size + tile.size - 1, right, i * tile.size);
        if (down) compare(tile, (tile.size - 1) * tile.size + i, down, i);
      }
    }
  });

  check("terrain expand: all original tile slots keep the old world footprint and Y datum", () => {
    const data = authored();
    const edge = 64 * data.size.spacing;
    for (let originalZ = 0; originalZ < 3; originalZ += 1) for (let originalX = 0; originalX < 3; originalX += 1) {
      const document = expand(data, { ...OPTIONS, originalX, originalZ });
      const bounds = terrainTileWorldBounds(document.def, originalX, originalZ);
      assert.deepEqual(bounds, { minX: ACTOR.position[0] - edge / 2, minZ: ACTOR.position[2] - edge / 2,
        maxX: ACTOR.position[0] + edge / 2, maxZ: ACTOR.position[2] + edge / 2 });
      assert.equal(document.def.origin[1], ACTOR.position[1]);
    }
  });

  check("terrain expand: Float32/RGBA8 samples survive edit-world capture, binary validation, reload and worker GPU conversion", () => {
    const data = authored(65, 8);
    const legacySaved = decodeTerrainTile(captureTerrainSnapshot(ACTOR, data).bytes);
    const document = expand(data);
    const world = createTerrainEditWorld(document.def, document.tiles.values());
    const saved = captureWorldTerrainSave(world, world.tiles.keys(), new Map());
    assert.deepEqual(normalizeWorldTerrain(saved.def), saved.def);
    assert.equal(saved.tiles.length, 9);
    for (const { key, bytes } of saved.tiles) {
      assert.ok(bytes.byteLength <= TERRAIN_TILE_BODY_MAX_BYTES);
      assert.equal(bytes.byteLength, terrainTileByteLength(65, 8, "f32"));
      assert.match(validateSaveTerrainTile("layouts/test.terrain.json", key, bytes), /tile.bin$/);
      const tile = validateTerrainTile(saved.def, key, bytes);
      assert.equal(tile.heightFormat, "f32");
      assert.deepEqual(tile.heights, document.tiles.get(key)!.heights);
      assert.deepEqual(tile.weights, document.tiles.get(key)!.weights);
      if (key === "1_1") {
        assert.deepEqual(new Uint32Array(tile.heights.buffer), new Uint32Array(legacySaved.heights.buffer));
        assert.deepEqual(tile.weights, legacySaved.weights);
      }
      const gpu = decodeTerrainTileForStreaming(bytes, saved.def);
      assert.ok(gpu.heights instanceof Float32Array);
      assert.deepEqual(gpu.heights, Float32Array.from(tile.heights));
      assert.deepEqual(Uint8Array.from(gpu.weights.flatMap((block) => Array.from(block))), tile.weights);
    }
    const original = world.tiles.get("1_1")!;
    assert.notEqual(original.heights, document.tiles.get("1_1")!.heights);
    assert.notEqual(original.weights, document.tiles.get("1_1")!.weights);
  });

  check("terrain expand: sculpt/paint undo restores Float32 heights and RGBA8 paint throughout changed rectangles", () => {
    const document = expand();
    const world = createTerrainEditWorld(document.def, document.tiles.values());
    for (const brush of [{ mode: "raise" as const }, { mode: "paint" as const, layer: 1 }]) {
      const result = applyTerrainBrush(world, { ...brush, x: ACTOR.position[0], z: ACTOR.position[2], radius: 5, strength: 0.5, falloff: 0.3 });
      assert.ok(result.patches.length);
      const changed = structuredClone(world.tiles.get("1_1"));
      revertTerrainUndoPatches(world, result.patches);
      assert.deepEqual(world.tiles.get("1_1"), document.tiles.get("1_1"));
      applyTerrainUndoPatches(world, result.patches);
      assert.deepEqual(world.tiles.get("1_1"), changed);
      revertTerrainUndoPatches(world, result.patches);
    }
  });

  check("terrain expand codec: validator rejects nonfinite heights; codec rejects truncated data and unsupported flags", () => {
    const document = expand();
    const original = document.tiles.get("1_1")!;
    const bytes = encodeTerrainTile(original, { ...document.def, heightFormat: "f32" });
    const corrupt = bytes.slice();
    for (const height of [NaN, Infinity]) {
      new DataView(corrupt.buffer).setFloat32(32, height, true);
      assert.throws(() => validateSaveTerrainTile("layouts/test.terrain.json", "1_1", corrupt), /heights invalid/);
    }
    assert.throws(() => decodeTerrainTile(bytes.subarray(0, bytes.length - 1)), /expected/);
    const flags = bytes.slice();
    new DataView(flags.buffer).setUint16(6, 3, true);
    assert.throws(() => decodeTerrainTile(flags), /flags/);
    new DataView(flags.buffer).setUint16(6, 8, true);
    assert.throws(() => decodeTerrainTile(flags), /flags/);
  });
}
