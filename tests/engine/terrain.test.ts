/** World Terrain data model, tile codec, CPU queries, legacy conversion and World Partition grid math. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { terrainTileHeightfieldShape } from "../../engine/physics/terrainCollider";
import { createFlatLandscapeData, createLandscapeColliderPrimitive, type ForgeLandscapeData } from "../../engine/scene/landscape";
import type { LayoutLandscape, Vec3 } from "../../engine/scene/layout";
import {
  TerrainTileMap,
  raycastTerrain,
  terrainFaceNormalAt,
  terrainHeightAt,
  terrainHeightAtSmooth,
  terrainLayerWeightsAt,
  terrainSmoothNormalAt,
  type TerrainQueryDef,
} from "../../engine/terrain/terrainHeightQuery";
import { legacyLandscapeToWorldTerrain } from "../../engine/terrain/terrainLegacy";
import {
  TerrainTileCodecError,
  decodeTerrainTile,
  encodeTerrainTile,
  terrainTileByteLength,
} from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile,
  isValidTileQuads,
  parseTileKey,
  terrainTileLayerWeight,
  terrainWorldBounds,
  tileKey,
  type TerrainTileData,
} from "../../engine/terrain/terrainTypes";
import {
  distanceToWorldCell,
  parseWorldCellKey,
  worldCellAt,
  worldCellForActor,
  worldCellKey,
  worldCellsInRadius,
} from "../../engine/world/worldGrid";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const close = (actual: number | null | undefined, expected: number, epsilon = 1e-5): void => {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

/** A terrain grid whose tiles sample `height(globalX, globalZ)` at every vertex. */
function buildTerrain(
  tilesX: number,
  tilesZ: number,
  tileQuads: number,
  spacing: number,
  height: (gx: number, gz: number) => number,
  origin: Vec3 = [0, 0, 0],
): { def: TerrainQueryDef; tiles: TerrainTileMap } {
  const def: TerrainQueryDef = { tileQuads, spacing, tilesX, tilesZ, origin };
  const tiles = new TerrainTileMap();
  for (let tz = 0; tz < tilesZ; tz += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const tile = createFlatTerrainTile({ tileQuads, layers: [] }, tx, tz);
      for (let vz = 0; vz <= tileQuads; vz += 1) {
        for (let vx = 0; vx <= tileQuads; vx += 1) {
          tile.heights[vz * tile.size + vx] = height(tx * tileQuads + vx, tz * tileQuads + vz);
        }
      }
      tiles.set(tile);
    }
  }
  return { def, tiles };
}

function sampleTile(tileQuads: number, layerCount: number): TerrainTileData {
  const layers = Array.from({ length: layerCount }, (_, index) => ({ id: `l${index}`, name: `L${index}`, color: "#ffffff" }));
  const tile = createFlatTerrainTile({ tileQuads, layers }, -3, 7);
  for (let index = 0; index < tile.heights.length; index += 1) tile.heights[index] = Math.sin(index * 0.37) * 40 - 5;
  for (let index = 0; index < tile.weights.length; index += 1) tile.weights[index] = (index * 31) % 256;
  return tile;
}

export function registerTerrainTests(check: Check): void {
  check("terrain: tile keys round-trip, including negative coordinates", () => {
    assert.equal(tileKey(-3, 12), "-3_12");
    assert.deepEqual(parseTileKey("-3_12"), { x: -3, z: 12 });
    assert.equal(parseTileKey("3-12"), null);
    assert.equal(parseTileKey("a_1"), null);
  });

  check("terrain: tile quads must be a power of two in 32..512", () => {
    for (const valid of [32, 64, 128, 256, 512]) assert.ok(isValidTileQuads(valid), String(valid));
    for (const invalid of [16, 100, 255, 257, 1024, 0, -64, 64.5]) assert.ok(!isValidTileQuads(invalid), String(invalid));
  });

  check("terrain: flat tile weights layer 0 fully and reads per-layer weights", () => {
    const layers = Array.from({ length: 6 }, (_, index) => ({ id: `l${index}`, name: "", color: "#000" }));
    const tile = createFlatTerrainTile({ tileQuads: 32, layers }, 0, 0, 2.5);
    assert.equal(tile.weights.length, 2 * 33 * 33 * 4);
    assert.equal(tile.heights[100], 2.5);
    assert.equal(terrainTileLayerWeight(tile, 0, 500), 1);
    assert.equal(terrainTileLayerWeight(tile, 5, 500), 0);
    tile.weights[33 * 33 * 4 + 500 * 4 + 1] = 255; // layer 5 = block 1, channel 1
    assert.equal(terrainTileLayerWeight(tile, 5, 500), 1);
    assert.equal(terrainTileLayerWeight(tile, 6, 500), 0);
  });

  check("terrain codec: u16 round-trip is within one quantization step", () => {
    const tile = sampleTile(64, 5);
    const bytes = encodeTerrainTile(tile, { heightMin: -64, heightMax: 64 });
    assert.equal(bytes.length, terrainTileByteLength(65, 5, "u16"));
    assert.equal(bytes.length, 32 + 65 * 65 * 2 + 2 * 65 * 65 * 4);
    const decoded = decodeTerrainTile(bytes);
    assert.equal(decoded.x, -3);
    assert.equal(decoded.z, 7);
    assert.equal(decoded.size, 65);
    assert.equal(decoded.layerCount, 5);
    assert.equal(decoded.heightFormat, "u16");
    const step = 128 / 65535;
    for (let index = 0; index < tile.heights.length; index += 1) {
      assert.ok(Math.abs(decoded.heights[index]! - tile.heights[index]!) <= step / 2 + 1e-6, `height ${index}`);
    }
    assert.deepEqual(Array.from(decoded.weights), Array.from(tile.weights));
  });

  check("terrain codec: f32 heights round-trip exactly and decode from an offset view", () => {
    const tile = sampleTile(32, 0);
    const bytes = encodeTerrainTile(tile, { heightMin: -1, heightMax: 1, heightFormat: "f32" });
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    const decoded = decodeTerrainTile(padded.subarray(8));
    assert.equal(decoded.heightFormat, "f32");
    assert.equal(decoded.weights.length, 0);
    assert.deepEqual(Array.from(decoded.heights), Array.from(tile.heights));
  });

  check("terrain codec: u16 encode clamps heights outside the range", () => {
    const tile = createFlatTerrainTile({ tileQuads: 32, layers: [] }, 0, 0);
    tile.heights[0] = 500;
    tile.heights[1] = -500;
    tile.heights[2] = Number.NaN;
    const decoded = decodeTerrainTile(encodeTerrainTile(tile, { heightMin: -10, heightMax: 10 }));
    close(decoded.heights[0], 10, 1e-4);
    close(decoded.heights[1], -10, 1e-4);
    close(decoded.heights[2], 0, 1e-3);
  });

  check("terrain codec: rejects corrupt or mismatched input", () => {
    const bytes = encodeTerrainTile(sampleTile(32, 2), { heightMin: -64, heightMax: 64 });
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    assert.throws(() => decodeTerrainTile(badMagic), TerrainTileCodecError);
    const badVersion = bytes.slice();
    new DataView(badVersion.buffer).setUint16(4, 99, true);
    assert.throws(() => decodeTerrainTile(badVersion), /unsupported version/);
    assert.throws(() => decodeTerrainTile(bytes.slice(0, bytes.length - 1)), /expected/);
    assert.throws(() => decodeTerrainTile(bytes.slice(0, 10)), /truncated/);
    const badSize = bytes.slice();
    new DataView(badSize.buffer).setUint16(8, 100, true);
    assert.throws(() => decodeTerrainTile(badSize), /vertices per side/);
    const tile = sampleTile(32, 2);
    assert.throws(() => encodeTerrainTile(tile, { heightMin: 5, heightMax: 5 }), /height range/);
    assert.throws(() => encodeTerrainTile({ ...tile, heights: new Float32Array(3) }, { heightMin: 0, heightMax: 1 }), /heights/);
    assert.throws(() => encodeTerrainTile({ ...tile, layerCount: 9 }, { heightMin: 0, heightMax: 1 }), /layer count/);
  });

  check("terrain query: height follows the render triangulation, not a bilinear blend", () => {
    // One raised far corner (d): bilinear would give 0.5625 at (0.75, 0.75).
    const { def, tiles } = buildTerrain(1, 1, 32, 2, (gx, gz) => (gx === 1 && gz === 1 ? 1 : 0), [10, 3, -4]);
    close(terrainHeightAt(def, tiles, 10 + 0.5, -4 + 0.5), 3);
    close(terrainHeightAt(def, tiles, 10 + 1.5, -4 + 1.5), 3.5);
    close(terrainHeightAt(def, tiles, 10 + 2, -4 + 2), 4);
    // On the b–c diagonal both triangles agree.
    close(terrainHeightAt(def, tiles, 10 + 1.2, -4 + 0.8), 3);
    // The visual-only smooth sample is the bilinear blend.
    close(terrainHeightAtSmooth(def, tiles, 10 + 1.5, -4 + 1.5), 3.5625);
    close(terrainHeightAtSmooth(def, tiles, 10 + 2, -4 + 2), 4);
  });

  check("terrain query: heights are continuous across tile seams and bounded by the grid", () => {
    const slope = (gx: number, gz: number) => gx * 0.25 - gz * 0.1;
    const { def, tiles } = buildTerrain(3, 2, 32, 1.5, slope, [-50, 0, -20]);
    for (const [gx, gz] of [[31.9, 5], [32, 5], [32.1, 5], [64, 31.99], [64, 32], [96, 64], [0, 0]] as const) {
      close(terrainHeightAt(def, tiles, -50 + gx * 1.5, -20 + gz * 1.5), slope(gx, gz));
    }
    assert.equal(terrainHeightAt(def, tiles, -50 - 0.01, 0), null);
    assert.equal(terrainHeightAt(def, tiles, -50 + 96 * 1.5 + 0.01, 0), null);
    tiles.delete(1, 0);
    assert.equal(terrainHeightAt(def, tiles, -50 + 40 * 1.5, -20 + 5 * 1.5), null);
    close(terrainHeightAt(def, tiles, -50 + 20 * 1.5, -20 + 5 * 1.5), slope(20, 5));
    assert.deepEqual(terrainWorldBounds({ ...def, tilesX: 3, tilesZ: 2 }), { minX: -50, minZ: -20, maxX: 94, maxZ: 76 });
  });

  check("terrain query: face and smooth normals match the slope and cross tile seams", () => {
    const { def, tiles } = buildTerrain(2, 1, 32, 2, (gx) => gx * 1);
    const expected = [-0.5 / Math.hypot(0.5, 1), 1 / Math.hypot(0.5, 1), 0];
    const face = terrainFaceNormalAt(def, tiles, 10.3, 7.1)!;
    expected.forEach((value, axis) => close(face[axis], value));
    const seam = terrainSmoothNormalAt(def, tiles, 64, 10)!;
    expected.forEach((value, axis) => close(seam[axis], value));
    tiles.delete(1, 0);
    // The seam vertex is duplicated in tile 0, so its neighbour still reads it.
    const edge = terrainSmoothNormalAt(def, tiles, 62, 10)!;
    expected.forEach((value, axis) => close(edge[axis], value));
    close(terrainHeightAt(def, tiles, 64, 10), 32);
    // Past the seam the missing tile leaves a one-sided difference: half the slope.
    const oneSided = terrainSmoothNormalAt(def, tiles, 64, 10)!;
    const half = [-1 / Math.hypot(1, 4), 4 / Math.hypot(1, 4), 0];
    half.forEach((value, axis) => close(oneSided[axis], value));
    assert.equal(terrainSmoothNormalAt(def, tiles, 66, 10), null);
  });

  check("terrain query: layer weights are bilinear per layer", () => {
    const layers = [{ id: "a", name: "A", color: "#000" }, { id: "b", name: "B", color: "#000" }];
    const tile = createFlatTerrainTile({ tileQuads: 32, layers }, 0, 0);
    tile.weights.fill(0);
    // Layer b fully at vertex (1, 0) only.
    tile.weights[1 * 4 + 1] = 255;
    const tiles = new TerrainTileMap();
    tiles.set(tile);
    const def: TerrainQueryDef = { tileQuads: 32, spacing: 1, tilesX: 1, tilesZ: 1, origin: [0, 0, 0] };
    const weights = terrainLayerWeightsAt(def, tiles, 0.5, 0.5)!;
    assert.equal(weights.length, 2);
    close(weights[0], 0);
    close(weights[1], 0.25);
  });

  check("terrain raycast: hits the surface the height query reports", () => {
    const hills = (gx: number, gz: number) => Math.sin(gx * 0.3) * 3 + Math.cos(gz * 0.2) * 2;
    const { def, tiles } = buildTerrain(4, 4, 32, 1, hills, [-64, 5, -64]);
    const down = raycastTerrain(def, tiles, [3.3, 100, -7.7], [0, -1, 0])!;
    close(down.point[1], terrainHeightAt(def, tiles, 3.3, -7.7)!);
    close(down.distance, 100 - down.point[1]);
    assert.ok(down.normal[1] > 0);
    const slanted = raycastTerrain(def, tiles, [-60, 30, -60], [1, -0.25, 0.8])!;
    assert.ok(slanted);
    close(slanted.point[1], terrainHeightAt(def, tiles, slanted.point[0], slanted.point[2])!, 1e-4);
    assert.ok(slanted.tileX >= 0 && slanted.tileZ >= 0);
  });

  check("terrain raycast: skips tiles it passes over and finds a bump further along", () => {
    const bump = (gx: number, gz: number) => (gx >= 100 && gx <= 104 && gz >= 10 && gz <= 14 ? 20 : 0);
    const { def, tiles } = buildTerrain(4, 1, 32, 1, bump);
    const hit = raycastTerrain(def, tiles, [0.5, 10, 12], [1, 0, 0])!;
    assert.ok(hit, "horizontal ray hits the bump face");
    assert.equal(hit.tileX, 3);
    assert.ok(hit.point[0] > 99 && hit.point[0] < 100.1, String(hit.point[0]));
    assert.equal(raycastTerrain(def, tiles, [0.5, 10, 12], [1, 0, 0], 50), null, "maxDistance stops short of the bump");
    assert.equal(raycastTerrain(def, tiles, [0.5, 30, 12], [1, 0, 0]), null, "ray above every tile misses");
    assert.equal(raycastTerrain(def, tiles, [0.5, -5, 12], [0, 1, 0]), null, "terrain is not hit from below");
    tiles.delete(3, 0);
    assert.equal(raycastTerrain(def, tiles, [0.5, 10, 12], [1, 0, 0]), null, "missing tile is a hole");
    assert.equal(raycastTerrain(def, tiles, [200, 10, 12], [0, -1, 0]), null, "off-terrain ray misses");
  });

  check("terrain raycast: a ray entering from outside the grid finds the edge", () => {
    const { def, tiles } = buildTerrain(2, 2, 32, 2, () => 1, [0, 0, 0]);
    const hit = raycastTerrain(def, tiles, [-10, 11, 20], [1, -1, 0])!;
    close(hit.point[1], 1);
    close(hit.point[0], 0);
  });

  check("terrain legacy: the runtime-parity Landscape converts to a matching 1×1 terrain", () => {
    const data = JSON.parse(readFileSync("public/landscapes/runtime-parity.landscape.json", "utf8")) as ForgeLandscapeData;
    const actor: LayoutLandscape = { id: "parity-landscape", position: [-32, -0.6, -32], dataRef: "landscapes/runtime-parity.landscape.json" };
    const { def, tile, warnings } = legacyLandscapeToWorldTerrain(actor, data);
    assert.deepEqual(warnings, []);
    assert.equal(def.tileQuads, 64);
    assert.deepEqual(def.origin, [-64, -0.6, -64]);
    assert.equal(def.tiles.length, 1);
    assert.equal(def.layers.length, data.layers.length);
    assert.ok(def.heightMin <= def.tiles[0]!.minHeight && def.heightMax >= def.tiles[0]!.maxHeight);
    const tiles = new TerrainTileMap();
    tiles.set(tile);
    // Every legacy collider vertex lies on the converted surface.
    const primitive = createLandscapeColliderPrimitive(data);
    for (const vertex of primitive.vertices) {
      const worldX = actor.position[0] + vertex[0];
      const worldZ = actor.position[2] + vertex[2];
      close(terrainHeightAt(def, tiles, worldX, worldZ), actor.position[1] + vertex[1]);
    }
    // And survives a u16 save/load within one quantization step.
    const decoded = decodeTerrainTile(encodeTerrainTile(tile, def));
    const step = (def.heightMax - def.heightMin) / 65535;
    tile.heights.forEach((height, index) => assert.ok(Math.abs(decoded.heights[index]! - height) <= step));
  });

  check("terrain legacy: folds heightScale, quantizes weights and reports adaptations", () => {
    const data = createFlatLandscapeData("small");
    data.size.heightScale = 2;
    data.heights[0] = 3;
    data.layers[1]!.weights[0] = 0.5;
    const actor: LayoutLandscape = { id: "l", position: [0, 1, 0], rotation: [0, 45, 0], dataRef: "x" };
    const { def, tile, warnings } = legacyLandscapeToWorldTerrain(actor, data);
    assert.equal(tile.heights[0], 6);
    assert.equal(terrainTileLayerWeight(tile, 1, 0), 128 / 255);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /rotation/);
    assert.equal(def.collision, true);

    const odd = createFlatLandscapeData("small");
    odd.size = { verticesX: 101, verticesZ: 101, spacing: 2, heightScale: 1 };
    odd.heights = new Array(101 * 101).fill(1);
    odd.layers = odd.layers.map((layer) => ({ ...layer, weights: new Array(101 * 101).fill(0) }));
    const resampled = legacyLandscapeToWorldTerrain({ id: "o", position: [0, 0, 0], dataRef: "x" }, odd);
    assert.equal(resampled.def.tileQuads, 128);
    close(resampled.def.tileQuads * resampled.def.spacing, 200, 1e-9);
    assert.match(resampled.warnings[0]!, /resampled to 128/);
  });

  check("world grid: cell lookup owns boundaries by their min edge, negatives included", () => {
    const grid = { cellSize: 128 };
    assert.deepEqual(worldCellAt(grid, 0, 0), { x: 0, z: 0 });
    assert.deepEqual(worldCellAt(grid, 128, 127.9), { x: 1, z: 0 });
    assert.deepEqual(worldCellAt(grid, -0.01, -128), { x: -1, z: -1 });
    assert.deepEqual(worldCellAt({ cellSize: 100, origin: [50, -50] }, 49, -50), { x: -1, z: 0 });
    assert.equal(worldCellKey(-2, 5), "-2_5");
    assert.deepEqual(parseWorldCellKey("-2_5"), { x: -2, z: 5 });
  });

  check("world grid: cells in radius are complete and nearest first", () => {
    const grid = { cellSize: 100 };
    assert.deepEqual(worldCellsInRadius(grid, 50, 50, 0), [{ x: 0, z: 0 }]);
    assert.equal(worldCellsInRadius(grid, 0, 0, 0).length, 4, "a corner point touches four cells");
    const cells = worldCellsInRadius(grid, 50, 50, 150);
    assert.deepEqual(cells[0], { x: 0, z: 0 });
    for (const cell of cells) assert.ok(distanceToWorldCell(grid, cell.x, cell.z, 50, 50) <= 150);
    const all = new Set(cells.map((cell) => worldCellKey(cell.x, cell.z)));
    for (let z = -3; z <= 3; z += 1) {
      for (let x = -3; x <= 3; x += 1) {
        assert.equal(all.has(worldCellKey(x, z)), distanceToWorldCell(grid, x, z, 50, 50) <= 150, `${x},${z}`);
      }
    }
    let previous = 0;
    for (const cell of cells) {
      const distance = distanceToWorldCell(grid, cell.x, cell.z, 50, 50);
      assert.ok(distance >= previous);
      previous = distance;
    }
    assert.deepEqual(worldCellsInRadius(grid, 0, 0, -1), []);
  });

  check("world grid: actors wider than a cell stay persistent", () => {
    const grid = { cellSize: 128 };
    assert.deepEqual(worldCellForActor(grid, [300, -10]), { x: 2, z: -1 });
    assert.deepEqual(worldCellForActor(grid, [300, -10], { width: 20, depth: 128 }), { x: 2, z: -1 });
    assert.equal(worldCellForActor(grid, [300, -10], { width: 200, depth: 4 }), null);
  });
}

/** Deterministic `[0, 1)` sequence so a failing sample is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export async function registerTerrainRapierTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain rapier: heightfield collider surface equals terrainHeightAt (K3a)", async () => {
    const RAPIER = await import("@dimforge/rapier3d-compat");
    await RAPIER.init();
    const random = seededRandom(7);
    // Rough relief hashed from the global vertex, so duplicated seam vertices
    // agree as the editor keeps them; twisted cells make bilinear miss by decimetres.
    const relief = (gx: number, gz: number) => ((Math.imul(gx * 73856093 ^ gz * 19349663, 2654435761) >>> 0) / 4294967296) * 8 - 4;
    const { def, tiles } = buildTerrain(2, 2, 32, 1.5, relief, [5, 2, -7]);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      for (const tile of tiles.values()) {
        const shape = terrainTileHeightfieldShape(def, tile);
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(shape.translation[0], shape.translation[1], shape.translation[2]),
        );
        const scale = { x: shape.scale[0], y: shape.scale[1], z: shape.scale[2] };
        world.createCollider(RAPIER.ColliderDesc.heightfield(shape.nrows, shape.ncols, shape.heights, scale), body);
      }
      world.step();
      const extent = 64 * 1.5;
      const points: [number, number][] = [];
      for (let index = 0; index < 400; index += 1) points.push([5 + random() * extent, -7 + random() * extent]);
      // Tile seams and the shared corner, plus cell diagonals.
      points.push([5 + 48, -7 + 10.3], [5 + 20.1, -7 + 48], [5 + 48, -7 + 48], [5 + 0.75, -7 + 0.75], [5 + 0.2, -7 + 1.3]);
      let maxSmoothGap = 0;
      for (const [x, z] of points) {
        const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true);
        assert.ok(hit, `ray at ${x}, ${z} hit the heightfield`);
        const rapierY = 50 - hit.timeOfImpact;
        close(terrainHeightAt(def, tiles, x, z), rapierY, 1e-3);
        maxSmoothGap = Math.max(maxSmoothGap, Math.abs(terrainHeightAtSmooth(def, tiles, x, z)! - rapierY));
      }
      // The check is only meaningful if bilinear sampling would have failed it.
      assert.ok(maxSmoothGap > 0.05, `bilinear deviates by ${maxSmoothGap}`);
    } finally {
      world.free();
    }
  });
}
