import assert from "node:assert/strict";
import { buildTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMap";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { TerrainLodSelector } from "../../engine/terrain/terrainLod";
import {
  landscapeRenderSource,
  terrainRenderNodeHeights,
  terrainRenderSourceHeightRange,
  worldTerrainRenderSource,
  writeLandscapeRegion,
} from "../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, terrainTileLayerWeight, tileKey, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import { TerrainTexturePool } from "../../engine/render-three/terrain/terrainTexturePool";

type Check = (label: string, fn: () => void) => void;

/** A non-square, non-power-of-two legacy grid with six paint layers and relief. */
function legacyData(verticesX = 65, verticesZ = 97, spacing = 0.5, heightScale = 2): ForgeLandscapeData {
  const count = verticesX * verticesZ;
  const heights = Array.from({ length: count }, (_, index) => {
    const x = index % verticesX;
    const z = Math.floor(index / verticesX);
    return Math.sin(x / 7) * 3 + Math.cos(z / 5) * 2 + x * 0.01;
  });
  const layers = Array.from({ length: 6 }, (_, layer) => ({
    id: `layer${layer}`,
    name: `Layer ${layer}`,
    weights: Array.from({ length: count }, (_, index) => ((index + layer) % 6) / 5),
  }));
  return {
    schema: 1,
    type: "landscape",
    size: { verticesX, verticesZ, spacing, heightScale },
    chunks: { quadsPerChunk: 32 },
    heights,
    layers,
  };
}

function worldDef(tilesX: number, tilesZ: number, layers = 2): WorldTerrainDef {
  return {
    schema: 1,
    type: "worldTerrain",
    name: "Render",
    tileQuads: 32,
    spacing: 2,
    tilesX,
    tilesZ,
    origin: [-40, 5, 12],
    heightMin: -64,
    heightMax: 64,
    layers: Array.from({ length: layers }, (_, index) => ({ id: `l${index}`, name: `L${index}`, color: "#808080" })),
    tiles: [],
    collision: true,
  };
}

export function registerTerrainRenderTests(check: Check): void {
  check("terrain render source: legacy grid pads into the next power-of-two tile around the actor", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    assert.equal(source.def.tileQuads, 128);
    assert.deepEqual([source.def.tilesX, source.def.tilesZ], [1, 1]);
    assert.deepEqual(source.def.origin, [-16, 0, -24]);
    assert.deepEqual([source.extentX, source.extentZ], [32, 48]);
    assert.equal(source.layerCount, 6);
    const tile = source.tiles.tile(0, 0)!;
    assert.equal(tile.size, 129);
    // Every authored vertex lands where the chunk mesh put it, heightScale folded in.
    for (const [x, z] of [[0, 0], [64, 0], [0, 96], [64, 96], [31, 47], [7, 90]] as const) {
      const expected = data.heights[z * 65 + x]! * 2;
      const height = terrainHeightAt(source.def, source.tiles, -16 + x * 0.5, -24 + z * 0.5)!;
      assert.ok(Math.abs(height - expected) < 1e-5, `vertex ${x},${z}: ${height} vs ${expected}`);
    }
    // Padding repeats the far edges, so clamped coarse vertices never see a cliff.
    assert.equal(tile.heights[50 * 129 + 100], tile.heights[50 * 129 + 64]);
    assert.equal(tile.heights[120 * 129 + 10], tile.heights[96 * 129 + 10]);
    assert.equal(tile.heights[128 * 129 + 128], tile.heights[96 * 129 + 64]);
  });

  check("terrain render source: legacy weights quantize into two RGBA8 blocks", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const tile = source.tiles.tile(0, 0)!;
    assert.equal(tile.weights.length, 2 * 129 * 129 * 4);
    for (const [x, z] of [[0, 0], [13, 22], [64, 96]] as const) {
      for (let layer = 0; layer < 6; layer += 1) {
        const expected = Math.round(data.layers[layer]!.weights[z * 65 + x]! * 255) / 255;
        assert.equal(terrainTileLayerWeight(tile, layer, z * 129 + x), expected);
      }
    }
    // A ninth layer is not drawn.
    const many = legacyData(65, 65);
    many.layers.push(...[6, 7, 8].map((index) => ({ id: `layer${index}`, name: `L${index}`, weights: new Array(65 * 65).fill(0.5) })));
    assert.equal(landscapeRenderSource(many).layerCount, 8);
  });

  check("terrain render source: region writes refresh the padding an edge edit drives", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const tile = source.tiles.tile(0, 0)!;
    const interior = { x0: 10, x1: 12, z0: 20, z1: 21 };
    data.heights[20 * 65 + 11] = 40;
    assert.deepEqual(writeLandscapeRegion(source, data, interior), interior);
    assert.equal(tile.heights[20 * 129 + 11], 80);
    data.heights[96 * 65 + 64] = -9;
    data.layers[0]!.weights[96 * 65 + 64] = 1;
    const rect = writeLandscapeRegion(source, data, { x0: 60, x1: 64, z0: 94, z1: 96 });
    assert.deepEqual(rect, { x0: 60, x1: 128, z0: 94, z1: 128 });
    assert.equal(tile.heights[128 * 129 + 128], -18);
    assert.equal(tile.heights[100 * 129 + 64], -18);
    assert.equal(terrainTileLayerWeight(tile, 0, 128 * 129 + 128), 1);
    // The cached raycast range follows the edit.
    assert.equal(terrainRenderSourceHeightRange(source).max, 80);
    assert.throws(() => writeLandscapeRegion(source, legacyData(65, 65), interior), /changed shape/);
  });

  check("terrain render source: World Terrain keeps its world frame and full extent", () => {
    const def = worldDef(3, 2, 6);
    const tiles = new Map([[tileKey(0, 0), createFlatTerrainTile(def, 0, 0, 4)], [tileKey(2, 1), createFlatTerrainTile(def, 2, 1, -3)]]);
    const source = worldTerrainRenderSource({ def, tiles });
    assert.deepEqual(source.def.origin, [-40, 5, 12]);
    assert.deepEqual([source.extentX, source.extentZ], [192, 128]);
    assert.equal(source.layerCount, 6);
    assert.equal(source.legacyGrid, undefined);
    assert.equal(terrainHeightAt(source.def, source.tiles, -30, 20), 9);
    assert.equal(terrainHeightAt(source.def, source.tiles, 50, 20), null, "hole");
    const heights = terrainRenderNodeHeights(source, 64);
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 4 });
    assert.deepEqual(heights(2, 0, 0), { min: -3, max: 4 });
    assert.deepEqual(heights(0, 1, 0), { min: 0, max: 0 }, "a hole contributes nothing");
    const tile = tiles.get(tileKey(0, 0))!;
    tile.heights[5] = 30;
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 4 }, "cached until invalidated");
    heights.invalidate(tile);
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 30 });
  });

  check("terrain LOD: an extent clips nodes to a padded legacy footprint", () => {
    const source = landscapeRenderSource(legacyData(65, 97, 1, 1));
    const heights = terrainRenderNodeHeights(source, 32);
    const selector = new TerrainLodSelector(source.def, heights, { extent: [source.extentX, source.extentZ] });
    assert.deepEqual([selector.extentX, selector.extentZ], [64, 96]);
    for (const camera of [[0, 10, 0], [-200, 50, 300], [31, 2, -47]] as const) {
      const nodes = selector.select(camera);
      let area = 0;
      for (const node of nodes) {
        assert.ok(node.box.minX >= -32 && node.box.maxX <= 32 && node.box.minZ >= -48 && node.box.maxZ <= 48, "inside the footprint");
        assert.ok(node.box.maxX > node.box.minX && node.box.maxZ > node.box.minZ, "no empty node");
        area += (node.box.maxX - node.box.minX) * (node.box.maxZ - node.box.minZ);
      }
      assert.equal(area, 64 * 96, "nodes tile the footprint exactly once");
    }
    assert.throws(() => new TerrainLodSelector(source.def, heights, { extent: [0, 10] }), /extent/);
  });

  check("terrain texture pool: tiles upload into slot layers and cached slots skip the copy", () => {
    const def = worldDef(2, 1, 5);
    const a = createFlatTerrainTile(def, 0, 0, 1);
    const b = createFlatTerrainTile(def, 1, 0, 2);
    b.weights[(33 * 33 + 7) * 4 + 1] = 99; // weight block 1, channel 1
    const tiles = new Map([[tileKey(0, 0), a], [tileKey(1, 0), b]]);
    const source = worldTerrainRenderSource({ def, tiles });
    const global = buildTerrainGlobalMap(source.def, source.tiles, 32);
    const pool = new TerrainTexturePool(33, 1, 5, global);
    assert.equal(pool.weightBlocks, 2);
    assert.equal(pool.globalHeights.image.width, global.width);
    assert.deepEqual(Array.from(pool.globalHeights.image.data as Float32Array), Array.from(global.heights));
    const heightData = pool.heights.image.data as Float32Array;
    const weightData = pool.weights.image.data as Uint8Array;

    assert.equal(pool.acquire(a), 0);
    assert.equal(heightData[100], 1);
    assert.deepEqual([...pool.heights.layerUpdates], [0]);
    assert.deepEqual([...pool.weights.layerUpdates], [0, 1]);
    assert.equal(pool.acquire(b), -1, "the only slot is active");
    pool.release(0, 0);
    assert.equal(pool.slotOf(0, 0), 0, "released data stays cached");
    assert.equal(pool.acquire(b), 0, "pressure evicts the released tile");
    assert.equal(pool.slotOf(0, 0), -1);
    assert.equal(heightData[100], 2);
    assert.equal(weightData[(33 * 33 + 7) * 4 + 1], 99, "second weight block lands in the slot's second layer");

    pool.heights.clearLayerUpdates();
    b.heights[34] = 7;
    b.heights[0] = 9;
    pool.update(b, { x0: 1, x1: 1, z0: 1, z1: 1 });
    assert.equal(heightData[34], 7);
    assert.equal(heightData[0], 2, "rect narrows the CPU copy");
    assert.deepEqual([...pool.heights.layerUpdates], [0]);
    pool.release(1, 0);
    assert.equal(pool.acquire(b), 0);
    assert.throws(() => pool.acquire(createFlatTerrainTile({ ...def, tileQuads: 64 }, 0, 0)), /pool holds 33/);
    pool.dispose();
  });

  check("terrain texture pool: an unpainted terrain still binds one zero weight layer per slot", () => {
    const def = worldDef(1, 1, 0);
    const tile = createFlatTerrainTile(def, 0, 0, 3);
    const source = worldTerrainRenderSource({ def, tiles: new Map([[tileKey(0, 0), tile]]) });
    const pool = new TerrainTexturePool(33, 1, 0, buildTerrainGlobalMap(source.def, source.tiles, 32));
    assert.equal(pool.weightBlocks, 1);
    (pool.weights.image.data as Uint8Array).fill(5);
    pool.acquire(tile);
    assert.ok((pool.weights.image.data as Uint8Array).every((value) => value === 0));
    pool.dispose();
  });
}
