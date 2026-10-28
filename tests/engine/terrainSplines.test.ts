import assert from "node:assert/strict";
import type { ForgeLandscapeSpline } from "../../engine/scene/landscape";
import {
  applyTerrainUndoPatches, createTerrainEditWorld, createTerrainRegionPatches,
  revertTerrainUndoPatches, type TerrainEditWorld,
} from "../../engine/terrain/terrainEdit";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createTerrainSplinePatches, terrainSplineToLocal, terrainSplineToWorld, type WorldTerrainSpline,
} from "../../engine/terrain/terrainSplines";
import {
  createFlatTerrainTile, terrainTileLayerWeight, tileKey, type TerrainTileData, type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

function fixture(tilesX = 2, tilesZ = 2): TerrainEditWorld {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Spline test", tileQuads: 32, spacing: 1,
    tilesX, tilesZ, origin: [101.25, 19, -71.5], heightMin: -256, heightMax: 256,
    layers: Array.from({ length: 8 }, (_, i) => ({ id: `layer-${i}`, name: `Layer ${i}`, color: "#ffffff" })),
    tiles: [], collision: true,
  };
  const tiles: TerrainTileData[] = [];
  for (let z = 0; z < tilesZ; z++) for (let x = 0; x < tilesX; x++) {
    tiles.push(createFlatTerrainTile(def, x, z));
    def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
  }
  return createTerrainEditWorld(def, tiles);
}

function road(world: TerrainEditWorld): WorldTerrainSpline {
  const point = (id: string, x: number, z: number) => ({
    id, position: [world.def.origin[0] + x, world.def.origin[1] - 3, world.def.origin[2] + z] as [number, number, number], width: 6, falloff: 3,
  });
  return {
    coordinateSpace: "world", id: "road", name: "Road", points: [point("a", 8, 32), point("b", 56, 32)],
    segments: [{ id: "ab", startPointId: "a", endPointId: "b",
      deform: { enabled: true, flatten: true, raiseTerrain: false, lowerTerrain: false, targetOffset: -0.25 },
      paint: { enabled: true, layerId: "layer-6", strength: 0.6 } }],
  };
}

const snapshot = (world: TerrainEditWorld) => structuredClone({ def: world.def, tiles: world.tiles });

function assertSeams(world: TerrainEditWorld): void {
  const owners = new Map<string, { height: number; weights: number[] }>();
  for (const tile of world.tiles.values()) for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) {
    const key = `${tile.x * 32 + x}_${tile.z * 32 + z}`;
    const index = z * tile.size + x;
    const values = { height: tile.heights[index]!, weights: Array.from({ length: 8 }, (_, layer) => terrainTileLayerWeight(tile, layer, index)) };
    if (owners.has(key)) assert.deepEqual(values, owners.get(key), `seam ${key}`);
    else owners.set(key, values);
  }
}

export function registerTerrainSplineTests(check: Check): void {
  check("terrain spline world/local round trip preserves ids, settings and tangent vectors without aliasing", () => {
    const world = fixture(3, 2);
    world.def.spacing = 0.5;
    const source: ForgeLandscapeSpline = {
      id: "legacy", hidden: true, locked: true, smooth: true, smoothness: 0.7,
      points: [{ id: "p", position: [1.25, -2, 3.5], arriveTangent: [4, 5, 6], leaveTangent: [-7, 8, 9], width: 3, falloff: 2 }], segments: [],
    };
    const before = structuredClone(source);
    const converted = terrainSplineToWorld(world.def, source);
    assert.deepEqual(converted.points[0]!.position, [126.5, 17, -52]);
    assert.deepEqual(converted.points[0]!.arriveTangent, [4, 5, 6]);
    assert.deepEqual(terrainSplineToLocal(world.def, converted), source);
    assert.throws(() => terrainSplineToWorld(world.def, converted), /explicit coordinate frame/);
    converted.points[0]!.arriveTangent![0] = 200;
    assert.deepEqual(source, before);
  });

  check("terrain spline preparation is pure and both effects cross four tiles with exact seam copies", () => {
    const world = fixture();
    const source = road(world);
    const before = snapshot(world);
    const splineBefore = structuredClone(source);
    const patches = createTerrainSplinePatches(world, source);
    assert.deepEqual(snapshot(world), before);
    assert.deepEqual(source, splineBefore);
    assert.equal(patches.length, 4);
    assert.ok(patches.every(({ rect }) => (rect.x1 - rect.x0 + 1) * (rect.z1 - rect.z0 + 1) < 33 * 33));
    const dirty = applyTerrainUndoPatches(world, patches);
    assert.equal(dirty.size, 4);
    assert.equal(terrainHeightAt(world.def, world, world.def.origin[0] + 32, world.def.origin[2] + 32), 15.75);
    assertSeams(world);
    const after = snapshot(world);
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), before, "undo restores heights, weights and summaries");
    applyTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), after, "redo restores the same arrays");
  });

  check("terrain spline unloaded footprint or seam tile rejects preparation without partial writes", () => {
    for (const key of ["1_0", "0_1", "1_1"]) {
      const world = fixture();
      world.tiles.delete(key);
      const before = snapshot(world);
      assert.throws(() => createTerrainSplinePatches(world, road(world)), /not resident/);
      assert.deepEqual(snapshot(world), before);
    }
  });

  check("terrain spline real holes are skipped and remote unloaded tiles do not block a local road", () => {
    const world = fixture();
    world.tiles.delete("1_1");
    world.def.tiles = world.def.tiles.filter(({ key }) => key !== "1_1");
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, road(world)));
    assert.equal(world.tiles.size, 3);
    assert.equal(world.def.tiles.length, 3);
    assertSeams(world);
    const local = fixture();
    local.tiles.delete("1_1");
    const source = road(local);
    source.points[0]!.position = [local.def.origin[0] + 5, 20, local.def.origin[2] + 5];
    source.points[1]!.position = [local.def.origin[0] + 12, 20, local.def.origin[2] + 5];
    assert.deepEqual(createTerrainSplinePatches(local, source).map(({ key }) => key), ["0_0"]);
  });

  check("terrain spline only requires the corridor footprint rather than its entire diagonal bounding box", () => {
    const world = fixture();
    world.tiles.delete("1_0");
    const source = road(world);
    source.points[0]!.position = [world.def.origin[0] + 5, 17, world.def.origin[2] + 5];
    source.points[1]!.position = [world.def.origin[0] + 50, 17, world.def.origin[2] + 60];
    for (const point of source.points) { point.width = 0.2; point.falloff = 0; }
    assert.ok(createTerrainSplinePatches(world, source).length > 0);
  });

  check("terrain spline eight-layer paint has exact byte totals and leaves heights untouched", () => {
    const world = fixture();
    for (const tile of world.tiles.values()) {
      const count = tile.size * tile.size;
      for (let i = 0; i < count; i++) {
        tile.weights[i * 4] = 200;
        tile.weights[count * 4 + i * 4 + 3] = 55;
      }
    }
    const before = snapshot(world);
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, road(world), "paint"));
    for (const [key, tile] of world.tiles) {
      assert.deepEqual(tile.heights, before.tiles.get(key)!.heights);
      for (let i = 0; i < tile.heights.length; i++) {
        const sum = Array.from({ length: 8 }, (_, layer) => Math.round(terrainTileLayerWeight(tile, layer, i) * 255)).reduce((a, b) => a + b);
        assert.equal(sum, 255);
      }
    }
    assertSeams(world);
    assert.ok(world.tiles.get("0_0")!.weights.some((value, index) => index >= 33 * 33 * 4 && value > before.tiles.get("0_0")!.weights[index]!));
  });

  check("terrain spline raise/lower gates and target offsets respect the world height datum", () => {
    for (const height of [-3, 3]) for (const direction of ["raiseTerrain", "lowerTerrain"] as const) {
      const world = fixture();
      const source = road(world);
      source.points.forEach((point) => { point.position[1] = world.def.origin[1] + height; });
      source.segments[0]!.deform = { enabled: true, flatten: false, raiseTerrain: false, lowerTerrain: false, [direction]: true };
      const patches = createTerrainSplinePatches(world, source, "deform");
      const allowed = (height > 0) === (direction === "raiseTerrain");
      assert.equal(patches.length > 0, allowed);
      applyTerrainUndoPatches(world, patches);
      assert.equal(world.tiles.get("1_1")!.heights[0], allowed ? height : 0);
      assert.ok(world.tiles.get("1_1")!.weights.every((value, i) => value === (i < 33 * 33 * 4 && i % 4 === 0 ? 255 : 0)));
    }
  });

  check("terrain spline patches survive tile codec and definition round trips with seam equality", () => {
    const world = fixture();
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, road(world)));
    const def = normalizeWorldTerrain(JSON.parse(JSON.stringify(world.def)));
    const tiles = [...world.tiles.values()].map((tile) => decodeTerrainTile(encodeTerrainTile(tile, {
      heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: "f32",
    })));
    const reloaded = createTerrainEditWorld(def, tiles);
    assert.deepEqual(reloaded.def, world.def);
    for (const [key, tile] of reloaded.tiles) {
      assert.deepEqual(tile.heights, world.tiles.get(key)!.heights);
      assert.deepEqual(tile.weights, world.tiles.get(key)!.weights);
    }
    assertSeams(reloaded);
  });

  check("terrain spline disabled effects, unknown paint layers and outside corridors are no-ops", () => {
    const world = fixture();
    const source = road(world);
    source.segments[0]!.deform!.enabled = false;
    source.segments[0]!.paint!.layerId = "missing";
    world.tiles.clear();
    assert.deepEqual(createTerrainSplinePatches(world, source), []);
    const outside = road(world);
    outside.points.forEach((point) => { point.position[0] += 1000; });
    assert.deepEqual(createTerrainSplinePatches(world, outside), []);
  });

  check("terrain spline invalid data, oversized regions and invalid staged values fail without mutation", () => {
    const world = fixture();
    const before = snapshot(world);
    for (const invalid of [NaN, Infinity]) {
      const source = road(world);
      source.points[1]!.position[1] = invalid;
      assert.throws(() => createTerrainSplinePatches(world, source), /finite/);
    }
    const bounds = { minX: world.def.origin[0], minZ: world.def.origin[2], maxX: world.def.origin[0] + 60, maxZ: world.def.origin[2] + 60 };
    for (const value of [{ height: Infinity }, { weights: [-1, 0, 0, 0, 0, 0, 0, 0] }, { weights: [1] }]) {
      assert.throws(() => createTerrainRegionPatches(world, bounds, { affects: () => true, sample: () => value }), /Invalid terrain edit/);
    }
    assert.deepEqual(snapshot(world), before);
    world.def.tilesX = 32; world.def.tilesZ = 32; world.def.tileQuads = 512;
    assert.throws(() => createTerrainRegionPatches(world, { ...bounds, maxX: 1200, maxZ: 1200 }, {
      affects: () => true, sample: () => ({}),
    }), /too large/);
  });
}
