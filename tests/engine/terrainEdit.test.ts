import assert from "node:assert/strict";
import { applyTerrainLayerState, createTerrainLayerAddition, createTerrainLayerRemoval } from "../../engine/terrain/terrainLayers";
import {
  editLandscapeBrushWeights,
  normalizeLandscapeBrushWeights,
  type LandscapeHeightBrushMode,
} from "../../engine/scene/landscapeBrush";
import {
  applyTerrainBrush,
  applyTerrainUndoPatches,
  createTerrainEditWorld,
  createTerrainLayerFillPatches,
  createTerrainPaintAccumulator,
  mergeTerrainDirtyRects,
  revertTerrainUndoPatches,
  type TerrainBrush,
  type TerrainEditWorld,
} from "../../engine/terrain/terrainEdit";
import { buildTerrainGlobalMap, updateTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMap";
import { raycastTerrain, terrainHeightAt, TerrainTileMap } from "../../engine/terrain/terrainHeightQuery";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainSculptNoise, type TerrainSculptTool } from "../../engine/terrain/terrainSculpt";
import { terrainBrushTileKeys } from "../../engine/terrain/terrainEditorStreaming";
import { createFlatTerrainTile, terrainTileLayerWeight, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;
type HeightBrush = Extract<TerrainBrush, { mode: TerrainSculptTool }> & { mode: LandscapeHeightBrushMode };
const modes = ["raise", "lower", "smooth", "flatten"] as const;

function fixture(tilesX = 2, tilesZ = 2, quads = 32, layers = 8): TerrainEditWorld {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "edit", tileQuads: quads, spacing: 1,
    tilesX, tilesZ, origin: [-17, 11, 29], heightMin: -256, heightMax: 256,
    layers: Array.from({ length: layers }, (_, i) => ({ id: `layer${i}`, name: `Layer ${i}`, color: "#ffffff" })),
    tiles: [], collision: true,
  };
  const tiles: TerrainTileData[] = [];
  for (let z = 0; z < tilesZ; z += 1) {
    for (let x = 0; x < tilesX; x += 1) {
      const tile = createFlatTerrainTile(def, x, z);
      for (let vz = 0; vz < tile.size; vz += 1) {
        for (let vx = 0; vx < tile.size; vx += 1) {
          const gx = x * quads + vx;
          const gz = z * quads + vz;
          tile.heights[vz * tile.size + vx] = (gx * gx % 19 - gz * 3 % 11) / 4;
        }
      }
      tiles.push(tile);
      def.tiles.push({ key: tileKey(x, z), minHeight: -256, maxHeight: 256 });
    }
  }
  return createTerrainEditWorld(def, tiles);
}

function brush(world: TerrainEditWorld, mode: LandscapeHeightBrushMode = "raise", gx = 32, gz = 32): HeightBrush {
  return {
    mode, x: world.def.origin[0] + gx * world.def.spacing, z: world.def.origin[2] + gz * world.def.spacing,
    radius: 4.6, strength: 0.73, falloff: 1.7, hitHeight: 7.25,
  };
}

/** Frozen pre-extraction SceneApp height dab; independent of the shared helpers. */
function legacyHeightDab(source: number[], width: number, depth: number, world: TerrainEditWorld, dab: HeightBrush): Float32Array {
  const output = [...source];
  const { origin, spacing } = world.def;
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(origin[0] + x * spacing - dab.x, origin[2] + z * spacing - dab.z);
      if (distance > dab.radius) continue;
      const influence = Math.pow(Math.min(1, Math.max(0, 1 - distance / dab.radius)), dab.falloff);
      if (influence <= 0) continue;
      const index = z * width + x;
      const current = source[index]!;
      const amount = dab.strength * influence;
      let after: number;
      if (dab.mode === "raise") after = current + amount;
      else if (dab.mode === "lower") after = current - amount;
      else if (dab.mode === "flatten") {
        const target = Number.isFinite(dab.flattenTargetHeight) ? dab.flattenTargetHeight! : dab.hitHeight ?? 0;
        after = current + (target - current) * Math.min(1, Math.max(0, amount));
      } else {
        let total = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx;
            const sz = z + dz;
            if (sx < 0 || sx >= width || sz < 0 || sz >= depth) continue;
            total += source[sz * width + sx] ?? 0;
            count += 1;
          }
        }
        after = current + ((count > 0 ? total / count : current) - current) * Math.min(1, Math.max(0, amount));
      }
      if (Math.abs(after - current) > 0.000001) output[index] = Math.round(after * 10_000) / 10_000;
    }
  }
  // Terrain's working format is Float32 metres; legacy stores JS numbers.
  return Float32Array.from(output);
}

function snapshot(world: TerrainEditWorld): Map<string, { heights: Float32Array; weights: Uint8Array }> {
  return new Map([...world.tiles].map(([key, tile]) => [key, { heights: tile.heights.slice(), weights: tile.weights.slice() }]));
}

function assertSeams(world: TerrainEditWorld): void {
  const vertices = new Map<string, { height: number; weights: number[] }>();
  for (const tile of world.tiles.values()) {
    for (let z = 0; z < tile.size; z += 1) {
      for (let x = 0; x < tile.size; x += 1) {
        const key = `${tile.x * world.def.tileQuads + x},${tile.z * world.def.tileQuads + z}`;
        const index = z * tile.size + x;
        const value = { height: tile.heights[index]!, weights: Array.from({ length: tile.layerCount }, (_, layer) => terrainTileLayerWeight(tile, layer, index)) };
        if (vertices.has(key)) assert.deepEqual(value, vertices.get(key), `seam ${key}`);
        vertices.set(key, value);
      }
    }
  }
}

function layerByte(tile: TerrainTileData, layer: number, index: number): number {
  return tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4]!;
}

/** Deterministic per-world-vertex RGBA8 paint summing to 255 (seam vertices agree); a few vertices are special. */
function paintRemovalFixture(world: TerrainEditWorld, removed: number): void {
  const q = world.def.tileQuads;
  const layers = world.def.layers.length;
  for (const tile of world.tiles.values()) {
    for (let vz = 0; vz < tile.size; vz++) {
      for (let vx = 0; vx < tile.size; vx++) {
        const gx = tile.x * q + vx;
        const gz = tile.z * q + vz;
        const raw = Array.from({ length: layers }, (_, layer) => (gx * 7 + gz * 13 + layer * 29 + gx * gz * (layer + 3)) % 11);
        const kind = (gx + gz * 5) % 9;
        if (kind === 0) raw.fill(0), raw[removed] = 1; // only the removed layer
        if (kind === 1) raw[removed] = 0; // removal leaves the vertex as it was
        if (kind === 2) raw.fill(0); // unpainted
        const total = raw.reduce((sum, value) => sum + value, 0);
        const bytes = raw.map((value) => total > 0 ? Math.floor(value * 255 / total) : 0);
        if (total > 0) bytes[raw.findIndex((value) => value > 0)]! += 255 - bytes.reduce((sum, value) => sum + value, 0);
        const index = vz * tile.size + vx;
        bytes.forEach((value, layer) => { tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4] = value; });
      }
    }
  }
}

export function registerTerrainEditTests(check: Check): void {
  check("terrain paint layers: removal spreads the weight proportionally, keeps 255 and seams, drops a weight block, exact undo", () => {
    const world = fixture(2, 2, 32, 5);
    paintRemovalFixture(world, 2);
    const original = new Map([...world.tiles].map(([key, tile]) => [key, tile.weights.slice()]));
    const layerObjects = [...world.def.layers];
    const removal = createTerrainLayerRemoval(world, "layer2");
    assert.deepEqual(removal.after.layers.map((layer) => layer.id), ["layer0", "layer1", "layer3", "layer4"]);
    assert.equal(removal.after.layers[3], layerObjects[4], "kept layers keep their identity");
    const seen = { only: 0, untouched: 0, unpainted: 0, spread: 0 };
    for (const [key, tile] of world.tiles) {
      const count = tile.size * tile.size;
      const weights = removal.after.weights.get(key)!;
      assert.equal(tile.weights.length, 2 * count * 4);
      assert.equal(weights.length, count * 4, "five layers -> four drops to one RGBA8 block");
      const next = { ...tile, layerCount: 4, weights };
      for (let i = 0; i < count; i++) {
        const old = Array.from({ length: 5 }, (_, layer) => layerByte(tile, layer, i));
        const kept = old.filter((_, layer) => layer !== 2);
        const now = Array.from({ length: 4 }, (_, layer) => layerByte(next, layer, i));
        const total = old.reduce((sum, value) => sum + value, 0);
        const rest = total - old[2]!;
        assert.equal(now.reduce((sum, value) => sum + value, 0), old[2] ? 255 : total, `${key} vertex ${i} total`);
        if (total === 0) { seen.unpainted++; assert.deepEqual(now, [0, 0, 0, 0]); }
        else if (old[2] === 0) { seen.untouched++; assert.deepEqual(now, kept); }
        else if (rest === 0) { seen.only++; assert.deepEqual(now, [255, 0, 0, 0]); }
        else {
          seen.spread++;
          now.forEach((value, layer) => {
            assert.ok(Math.abs(value - kept[layer]! * total / rest) < 1, `${key} vertex ${i} layer ${layer} proportional`);
            assert.ok(value >= kept[layer]!);
          });
        }
      }
    }
    assert.ok(Object.values(seen).every((value) => value > 0), JSON.stringify(seen));
    applyTerrainLayerState(world, removal.after);
    assert.equal(world.def.layers.length, 4);
    assertSeams(world);
    for (const tile of world.tiles.values()) {
      assert.equal(tile.layerCount, 4);
      const decoded = decodeTerrainTile(encodeTerrainTile(tile, { heightMin: -256, heightMax: 256, heightFormat: "f32" }));
      assert.equal(decoded.layerCount, 4);
      assert.deepEqual(decoded.weights, tile.weights);
    }
    applyTerrainLayerState(world, removal.before);
    assert.deepEqual(world.def.layers, layerObjects);
    assert.equal(world.def.layers[2], layerObjects[2], "undo restores the removed layer object");
    for (const [key, tile] of world.tiles) {
      assert.equal(tile.layerCount, 5);
      assert.deepEqual(tile.weights, original.get(key));
    }
  });
  check("terrain paint layers: removal from eight layers shifts later channels across blocks; guards", () => {
    const world = fixture(1, 1, 32, 8);
    paintRemovalFixture(world, 0);
    const tile = world.tiles.get("0_0")!;
    const count = tile.size * tile.size;
    // Unnormalized legacy bytes: a touched vertex normalizes to 255, an untouched one only shifts.
    for (const index of [0, 1]) for (let layer = 0; layer < 8; layer++) tile.weights[Math.floor(layer / 4) * count * 4 + index * 4 + layer % 4] = 0;
    tile.weights[0] = 100; tile.weights[1] = 50; tile.weights[2] = 50;
    tile.weights[4 + 1] = 120;
    const removal = createTerrainLayerRemoval(world, "layer0");
    const weights = removal.after.weights.get("0_0")!;
    assert.equal(weights.length, 2 * count * 4, "seven layers stay in two blocks");
    const next = { ...tile, layerCount: 7, weights };
    for (let i = 0; i < count; i++) {
      const old = Array.from({ length: 8 }, (_, layer) => layerByte(tile, layer, i));
      const now = Array.from({ length: 7 }, (_, layer) => layerByte(next, layer, i));
      if (i === 0) assert.deepEqual(now, [128, 127, 0, 0, 0, 0, 0]);
      else assert.equal(now.reduce((sum, value) => sum + value, 0), old.reduce((sum, value) => sum + value, 0));
      // Layer 4 (block 1, R) lands in block 0, A; layer 7 (block 1, A) in block 1, B.
      if (old[0] === 0) assert.deepEqual(now, old.slice(1));
    }
    assert.throws(() => createTerrainLayerRemoval(world, "missing"), /does not exist/);
    assert.throws(() => createTerrainLayerRemoval(fixture(1, 1, 32, 1), "layer0"), /at least one/);
    const partial = fixture(2, 1, 32, 4);
    partial.tiles.delete("1_0");
    assert.throws(() => createTerrainLayerRemoval(partial, "layer1"), /Load all/);
  });
  check("terrain paint layers: fifth channel preserves all tiles, relief and old weights; undo and binary round-trip", () => {
    const world = fixture(2, 2, 32, 4);
    const original = [...world.tiles].map(([key, tile]) => ({ key, heights: tile.heights.slice(), weights: tile.weights.slice() }));
    const firstLayer = world.def.layers[0];
    const addition = createTerrainLayerAddition(world, { id: "wet-mud", name: "Wet Mud", color: "#493226", material: "lt-wet-mud", physicalMaterial: "mud" });
    applyTerrainLayerState(world, addition.after);
    for (const entry of original) {
      const tile = world.tiles.get(entry.key)!;
      assert.equal(tile.layerCount, 5);
      assert.deepEqual(tile.heights, entry.heights);
      assert.deepEqual(tile.weights.slice(0, entry.weights.length), entry.weights);
      assert.ok(tile.weights.slice(entry.weights.length).every((weight) => weight === 0));
      const decoded = decodeTerrainTile(encodeTerrainTile(tile, { heightMin: -256, heightMax: 256, heightFormat: "f32" }));
      assert.equal(decoded.layerCount, 5);
      assert.deepEqual(decoded.weights, tile.weights);
    }
    applyTerrainLayerState(world, addition.before);
    assert.equal(world.def.layers[0], firstLayer, "older material undo commands retain their layer identity");
    for (const entry of original) assert.deepEqual(world.tiles.get(entry.key)!.weights, entry.weights);
    world.tiles.delete("1_1");
    assert.throws(() => createTerrainLayerAddition(world, { id: "other", name: "Other", color: "#fff" }), /Load all/);
    assert.throws(() => createTerrainLayerAddition(fixture(), { id: "other", name: "Other", color: "#fff" }), /limit/);
  });
  for (const mode of ["noise", "ramp", "terrace", "erosion"] as const) {
    check(`terrain sculpt ${mode} crosses four tiles, preserves paint, supports exact undo/redo and f32 save`, () => {
      const world = fixture();
      const before = snapshot(world);
      const centre = brush(world);
      const dab = { ...centre, mode, strength: 1, falloff: 0,
        ramp: { start: { x: centre.x - 10, z: centre.z, height: -2 }, end: { x: centre.x + 10, z: centre.z, height: 6 } },
      };
      const result = applyTerrainBrush(world, dab);
      assert.equal(result.dirty.size, 4);
      assertSeams(world);
      const after = snapshot(world);
      assert.notDeepEqual(after, before);
      for (const [key, tile] of world.tiles) {
        assert.deepEqual(tile.weights, before.get(key)!.weights);
        assert.deepEqual(decodeTerrainTile(encodeTerrainTile(tile, { ...world.def, heightFormat: "f32" })).heights, tile.heights);
      }
      revertTerrainUndoPatches(world, result.patches);
      assert.deepEqual(snapshot(world), before);
      applyTerrainUndoPatches(world, result.patches);
      assert.deepEqual(snapshot(world), after);
    });
  }

  check("terrain sculpt Noise is spatially continuous, seeded and independent of tile partition", () => {
    assert.equal(terrainSculptNoise(12.25, -4.5, 7), terrainSculptNoise(12.25, -4.5, 7));
    assert.notEqual(terrainSculptNoise(12.25, -4.5, 7), terrainSculptNoise(12.25, -4.5, 8));
    assert.ok(Math.abs(terrainSculptNoise(1 - 1e-6, 0.3, 1) - terrainSculptNoise(1 + 1e-6, 0.3, 1)) < 1e-5);
    const tiled = fixture(2, 2, 32), single = fixture(1, 1, 64);
    const dab = { ...brush(tiled), mode: "noise" as const, radius: 12, noiseScale: 3.5, noiseSeed: 71 };
    applyTerrainBrush(tiled, dab);
    applyTerrainBrush(single, dab);
    const monolithic = single.tile(0, 0)!;
    for (const tile of tiled.tiles.values()) for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) {
      assert.equal(tile.heights[z * tile.size + x], monolithic.heights[(tile.z * 32 + z) * 65 + tile.x * 32 + x]);
    }
  });

  for (const hydraulic of [false, true]) {
    check(`terrain erosion ${hydraulic ? "Hydraulic" : "Thermal"} is tile-partition independent, preserves seams and supports exact undo`, () => {
      const tiled = fixture(2, 2, 32), single = fixture(1, 1, 64);
      const before = snapshot(tiled);
      const dab = { ...brush(tiled), mode: "erosion" as const, radius: 12, erosionHydraulic: hydraulic, strength: 0.75 };
      const result = applyTerrainBrush(tiled, dab);
      applyTerrainBrush(single, dab);
      assert.ok(result.patches.length > 0);
      assertSeams(tiled);
      const monolithic = single.tile(0, 0)!;
      for (const tile of tiled.tiles.values()) for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) {
        assert.equal(tile.heights[z * tile.size + x], monolithic.heights[(tile.z * 32 + z) * 65 + tile.x * 32 + x]);
      }
      const after = snapshot(tiled);
      revertTerrainUndoPatches(tiled, result.patches);
      assert.deepEqual(snapshot(tiled), before);
      applyTerrainUndoPatches(tiled, result.patches);
      assert.deepEqual(snapshot(tiled), after);
      for (const [key, tile] of tiled.tiles) assert.deepEqual(tile.weights, before.get(key)!.weights);
    });
  }

  check("terrain sculpt Ramp interpolates endpoint heights and offsets along the whole corridor", () => {
    const world = fixture();
    for (const tile of world.tiles.values()) tile.heights.fill(0);
    const dab = { ...brush(world), mode: "ramp" as const, radius: 2, strength: 1, falloff: 0,
      rampStartOffset: 1, rampEndOffset: 3,
      ramp: { start: { x: world.def.origin[0] + 8, z: world.def.origin[2] + 16, height: 1 },
        end: { x: world.def.origin[0] + 56, z: world.def.origin[2] + 16, height: 7 } },
    };
    applyTerrainBrush(world, dab);
    const at = (x: number, z = 16) => terrainHeightAt(world.def, world, world.def.origin[0] + x, world.def.origin[2] + z)! - world.def.origin[1];
    assert.equal(at(8), 2);
    assert.equal(at(32), 6);
    assert.equal(at(56), 10);
    assert.equal(at(32, 22), 0, "outside the road and shoulders is untouched");
    assert.deepEqual(terrainBrushTileKeys(world.def, dab.x, dab.z, dab.radius, dab.ramp), ["0_0", "1_0"]);
    assertSeams(world);
    const before = snapshot(world);
    assert.equal(applyTerrainBrush(world, { ...dab, ramp: { start: dab.ramp.start, end: dab.ramp.start } }).dirty.size, 0);
    assert.deepEqual(snapshot(world), before, "a click without a drag is a no-op");
  });

  check("terrain sculpt Ramp has a level road cross-section at normal strength and falloff, with separate shoulders", () => {
    for (const strength of [0.1, 0.25, 1]) for (const height of [-6, 6]) {
      const world = fixture();
      for (const tile of world.tiles.values()) tile.heights.fill(0);
      const centre = brush(world);
      const dab = { ...centre, mode: "ramp" as const, radius: 4, strength, falloff: 2, rampShoulder: 2,
        ramp: { start: { x: centre.x - 12, z: centre.z, height }, end: { x: centre.x + 12, z: centre.z, height } },
      };
      applyTerrainBrush(world, dab);
      const at = (dz: number) => terrainHeightAt(world.def, world, centre.x, centre.z + dz)! - world.def.origin[1];
      for (let dz = -4; dz <= 4; dz++) assert.equal(at(dz), height, `flat road at offset ${dz}, strength ${strength}`);
      assert.equal(at(-5), height / 4, "left shoulder blends outside the road");
      assert.equal(at(5), height / 4, "right shoulder blends outside the road");
      assert.equal(at(-6), 0);
      assert.equal(at(6), 0);
      assertSeams(world);
    }
  });

  check("terrain sculpt Ramp cuts irregular terrain to the same plane across a diagonal road and includes shoulder tiles", () => {
    const world = fixture();
    const centre = brush(world);
    applyTerrainBrush(world, { ...centre, mode: "ramp", radius: 4, strength: 0.25, falloff: 2, rampShoulder: 2,
      ramp: { start: { x: centre.x - 12, z: centre.z - 12, height: 2 }, end: { x: centre.x + 12, z: centre.z + 12, height: 10 } },
    });
    // These vertices lie on the same perpendicular cross-section of the ramp.
    for (let offset = -2; offset <= 2; offset++) {
      assert.equal(terrainHeightAt(world.def, world, centre.x + offset, centre.z - offset)! - world.def.origin[1], 6);
    }
    assertSeams(world);
    const ramp = { start: { x: world.def.origin[0] + 26, z: world.def.origin[2] + 8, height: 2 },
      end: { x: world.def.origin[0] + 26, z: world.def.origin[2] + 20, height: 4 } };
    assert.deepEqual(terrainBrushTileKeys(world.def, ramp.start.x, ramp.start.z, 1, ramp, 0), ["0_0"]);
    assert.deepEqual(terrainBrushTileKeys(world.def, ramp.start.x, ramp.start.z, 1, ramp, 4), ["0_0", "1_0"]);
  });

  check("terrain sculpt Terrace supports negative heights and exact step spacing", () => {
    const world = fixture(1, 1);
    const tile = world.tile(0, 0)!;
    for (const [before, expected] of [[1.2, 2], [-1.2, -2], [0.2, 0], [-0.2, 0], [4, 4]]) {
      tile.heights.fill(before!);
      applyTerrainBrush(world, { ...brush(world, "raise", 16, 16), mode: "terrace", terraceStep: 2, terraceSmoothing: 0, strength: 1, falloff: 0 });
      assert.ok(Math.abs(tile.heights[16 * tile.size + 16]! - expected!) < 1e-6);
    }
  });

  check("terrain sculpt rejects invalid parameters and unavailable ramp tiles before any writes", () => {
    const world = fixture();
    const original = snapshot(world);
    for (const invalid of [{ noiseScale: 0 }, { terraceStep: 0 }, { erosionRainAmount: NaN }, { terraceSmoothing: 2 }, { rampShoulder: -1 }]) {
      assert.throws(() => applyTerrainBrush(world, { ...brush(world), mode: "noise", ...invalid }), /Invalid terrain sculpt/);
      assert.deepEqual(snapshot(world), original);
    }
    world.tiles.delete("1_0");
    const before = snapshot(world);
    assert.throws(() => applyTerrainBrush(world, { ...brush(world), mode: "ramp",
      ramp: { start: { x: -10, z: 45, height: 1 }, end: { x: 40, z: 45, height: 8 } },
    }), /not resident/);
    assert.deepEqual(snapshot(world), before);
    const modes: TerrainSculptTool[] = ["noise", "terrace", "erosion"];
    for (const mode of modes) {
      assert.throws(() => applyTerrainBrush(world, { ...brush(world), mode }), /not resident/);
      assert.deepEqual(snapshot(world), before);
    }
  });

  check("terrain edit working copy owns decoded arrays and summaries", () => {
    const source = fixture(1, 1);
    const decoded = decodeTerrainTile(encodeTerrainTile(source.tile(0, 0)!, source.def));
    const before = decoded.heights.slice();
    const world = createTerrainEditWorld(source.def, [decoded]);
    const summaries = structuredClone(source.def.tiles);
    applyTerrainBrush(world, brush(world, "raise", 10, 10));
    assert.deepEqual(decoded.heights, before);
    assert.deepEqual(source.def.tiles, summaries);
    assert.notEqual(world.tile(0, 0)!.weights.buffer, decoded.weights.buffer);
  });

  for (const mode of modes) {
    check(`terrain edit legacy ${mode} matches single tile exactly in Float32`, () => {
      for (const [gx, gz, strength, falloff] of [[13.25, 15.5, 0.73, 1.7], [0, 0, 2, 0], [32, 32, 1e-8, 2]]) {
        for (const explicitTarget of [false, true]) {
          const world = fixture(1, 1);
          world.def.spacing = 0.5;
          const tile = world.tile(0, 0)!;
          const dab = { ...brush(world, mode, gx, gz), strength: strength!, falloff: falloff!, ...(explicitTarget ? { flattenTargetHeight: -2.25 } : {}) };
          const expected = legacyHeightDab([...tile.heights], tile.size, tile.size, world, dab);
          applyTerrainBrush(world, dab);
          assert.deepEqual(tile.heights, expected);
        }
      }
    });
  }

  check("terrain edit seam and corner dabs keep all four tile copies bit identical", () => {
    const world = fixture();
    for (const mode of modes) {
      for (const [gx, gz] of [[32, 16], [32, 32], [16, 32]]) {
        const result = applyTerrainBrush(world, brush(world, mode, gx, gz));
        assert.equal(result.dirty.size, gx === 32 && gz === 32 ? 4 : 2);
        assertSeams(world);
      }
    }
  });

  check("terrain edit smooth crosses seams using the monolithic pre-dab neighbourhood", () => {
    const world = fixture();
    const width = 65;
    const source: number[] = [];
    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const tx = Math.min(Math.floor(x / 32), 1);
        const tz = Math.min(Math.floor(z / 32), 1);
        source.push(world.tile(tx, tz)!.heights[(z - tz * 32) * 33 + x - tx * 32]!);
      }
    }
    const dab = brush(world, "smooth");
    const expected = legacyHeightDab(source, width, width, world, dab);
    const reversed = createTerrainEditWorld(world.def, [...world.tiles.values()].reverse());
    applyTerrainBrush(world, dab);
    applyTerrainBrush(reversed, dab);
    assert.deepEqual(snapshot(world), snapshot(reversed));
    for (const tile of world.tiles.values()) {
      for (let z = 0; z < tile.size; z += 1) {
        for (let x = 0; x < tile.size; x += 1) {
          assert.equal(tile.heights[z * tile.size + x], expected[(tile.z * 32 + z) * width + tile.x * 32 + x]);
        }
      }
    }
  });

  check("terrain edit shared paint math preserves legacy normalization and redistribution", () => {
    const values = [0.2, 0.3, 0.1, 0.4];
    editLandscapeBrushWeights(values, "paint", 1, 0.2, () => 0);
    assert.deepEqual(values, [0.1429, 0.5, 0.0714, 0.2857]);
    editLandscapeBrushWeights(values, "erase", 1, 0.2, () => 0);
    assert.deepEqual(values, [0.3429, 0.3, 0.0714, 0.2857]);
    const smooth = [0.25, 0.75];
    editLandscapeBrushWeights(smooth, "smoothWeights", 0, 0.5, (i) => i === 0 ? 0.5 : 0.5);
    assert.deepEqual(smooth, [0.375, 0.625]);
    const empty = [0, 0, 0];
    normalizeLandscapeBrushWeights(empty);
    assert.deepEqual(empty, [1, 0, 0]);
    const eraseBase = [0.5, 0.5];
    editLandscapeBrushWeights(eraseBase, "erase", 0, 0.25, () => 0);
    assert.deepEqual(eraseBase, [0.3333, 0.6667]);
  });

  for (const mode of ["paint", "erase", "smoothWeights"] as const) {
    check(`terrain edit ${mode} normalizes eight layers and keeps seams identical`, () => {
      const world = fixture();
      for (const layer of [1, 4, 7, 2]) applyTerrainBrush(world, { ...brush(world), mode: "paint", layer });
      const before = snapshot(world);
      const result = applyTerrainBrush(world, { ...brush(world), mode, layer: 7 });
      assert.equal(result.dirty.size, 4);
      assert.notDeepEqual(snapshot(world), before);
      for (const tile of world.tiles.values()) {
        for (let i = 0; i < tile.heights.length; i += 1) {
          const sum = Array.from({ length: 8 }, (_, layer) => Math.round(terrainTileLayerWeight(tile, layer, i) * 255)).reduce((a, b) => a + b, 0);
          assert.equal(sum, 255);
        }
      }
      assertSeams(world);
    });
  }

  check("terrain edit paint handles zero weights and partial RGBA blocks", () => {
    for (const layers of [1, 3, 4, 5, 8]) {
      const world = fixture(2, 2, 32, layers);
      for (const tile of world.tiles.values()) tile.weights.fill(0);
      applyTerrainBrush(world, { ...brush(world), mode: "erase", layer: layers - 1, radius: 0.25 });
      applyTerrainBrush(world, { ...brush(world), mode: "paint", layer: layers - 1, radius: 0.25 });
      for (const tile of world.tiles.values()) {
        const index = (32 - tile.z * 32) * tile.size + 32 - tile.x * 32;
        let sum = 0;
        for (let layer = 0; layer < Math.ceil(layers / 4) * 4; layer += 1) {
          const offset = Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4;
          if (layer < layers) sum += tile.weights[offset]!;
          else assert.equal(tile.weights[offset], 0, "unused channels stay untouched");
        }
        assert.equal(sum, 255);
      }
      assertSeams(world);
    }
  });

  check("terrain edit low-strength paint accumulates across a stroke instead of rounding away", () => {
    const strength = 0.001, dabs = 40;
    const stroke = (accumulate: boolean) => {
      const world = fixture(2, 2, 32, 2);
      const original = snapshot(world);
      const paint = accumulate ? createTerrainPaintAccumulator() : undefined;
      const patches = [];
      for (let i = 0; i < dabs; i += 1) {
        patches.push(...applyTerrainBrush(world, { ...brush(world), mode: "paint", layer: 1, strength }, { paint }).patches);
      }
      return { world, original, patches };
    };
    // Each dab moves the centre by 0.255 of a byte step: alone, it rounds back.
    const plain = stroke(false);
    assert.deepEqual(snapshot(plain.world), plain.original);
    const reference = [1, 0];
    for (let i = 0; i < dabs; i += 1) editLandscapeBrushWeights(reference, "paint", 1, strength, () => 0);
    const { world, original, patches } = stroke(true);
    const centre = world.tile(1, 1)!;
    assert.equal(Math.round(terrainTileLayerWeight(centre, 1, 0) * 255), Math.round(reference[1]! * 255));
    assert.ok(Math.round(terrainTileLayerWeight(centre, 1, 0) * 255) >= 9);
    for (const tile of world.tiles.values()) {
      for (let i = 0; i < tile.heights.length; i += 1) {
        assert.equal(Math.round(terrainTileLayerWeight(tile, 0, i) * 255) + Math.round(terrainTileLayerWeight(tile, 1, i) * 255), 255);
      }
    }
    assertSeams(world);
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), original);
  });

  check("terrain edit accumulated smoothWeights reads each dab's starting weights", () => {
    const run = (paint?: ReturnType<typeof createTerrainPaintAccumulator>) => {
      const world = fixture(2, 2, 32, 4);
      applyTerrainBrush(world, { ...brush(world), mode: "paint", layer: 3, radius: 2.5, strength: 1 });
      applyTerrainBrush(world, { ...brush(world), mode: "smoothWeights", layer: 0, radius: 6 }, { paint });
      return snapshot(world);
    };
    // A fresh accumulator holds nothing yet, so the first dab must match a plain one.
    assert.deepEqual(run(createTerrainPaintAccumulator()), run());
  });

  check("terrain edit Fill Layer patches cover every tile, keep heights and undo exactly", () => {
    const world = fixture(2, 2, 32, 5);
    applyTerrainBrush(world, { ...brush(world), mode: "paint", layer: 2 });
    const before = snapshot(world);
    const patches = createTerrainLayerFillPatches(world, 4);
    assert.equal(patches.length, 4);
    assert.deepEqual(snapshot(world), before, "creating the patches writes nothing");
    applyTerrainUndoPatches(world, patches);
    for (const [key, tile] of world.tiles) {
      assert.deepEqual(tile.heights, before.get(key)!.heights);
      for (let i = 0; i < tile.heights.length; i += 1) {
        for (let layer = 0; layer < 5; layer += 1) assert.equal(terrainTileLayerWeight(tile, layer, i), layer === 4 ? 1 : 0);
      }
    }
    assertSeams(world);
    assert.deepEqual(createTerrainLayerFillPatches(world, 4), [], "an already filled grid has nothing to change");
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), before);
    assert.throws(() => createTerrainLayerFillPatches(world, 5), /Invalid terrain fill layer/);
    world.tiles.delete("1_1");
    assert.throws(() => createTerrainLayerFillPatches(world, 0), /not resident/);
  });

  check("terrain edit dirty rectangles bound every changed vertex tightly and merge", () => {
    const world = fixture();
    for (const mode of ["raise", "paint"] as const) {
      const before = snapshot(world);
      const result = applyTerrainBrush(world, mode === "raise" ? brush(world) : { ...brush(world), mode, layer: 5 });
      for (const [key, tile] of world.tiles) {
        const points: { x: number; z: number }[] = [];
        for (let i = 0; i < tile.heights.length; i += 1) {
          const changed = tile.heights[i] !== before.get(key)!.heights[i]
            || Array.from({ length: 8 }, (_, layer) => Math.floor(layer / 4) * tile.size * tile.size * 4 + i * 4 + layer % 4)
              .some((offset) => tile.weights[offset] !== before.get(key)!.weights[offset]);
          if (changed) points.push({ x: i % tile.size, z: Math.floor(i / tile.size) });
        }
        assert.ok(points.length > 0);
        assert.deepEqual(result.dirty.get(key), {
          x0: Math.min(...points.map((p) => p.x)), x1: Math.max(...points.map((p) => p.x)),
          z0: Math.min(...points.map((p) => p.z)), z1: Math.max(...points.map((p) => p.z)),
        });
      }
    }
    assert.deepEqual(mergeTerrainDirtyRects({ x0: 1, x1: 3, z0: 4, z1: 5 }, { x0: 2, x1: 7, z0: 0, z1: 4 }), { x0: 1, x1: 7, z0: 0, z1: 5 });
    assert.equal(applyTerrainBrush(world, { ...brush(world), x: -1e5 }).dirty.size, 0);
    assert.equal(applyTerrainBrush(world, { ...brush(world), strength: 0 }).patches.length, 0);
  });

  check("terrain edit undo and redo restore bit-identical heights weights and summaries", () => {
    const world = fixture();
    for (const dab of [brush(world, "smooth"), { ...brush(world), mode: "paint", layer: 6 } as const]) {
      const before = snapshot(world);
      const bounds = structuredClone(world.def.tiles);
      const result = applyTerrainBrush(world, dab);
      const after = snapshot(world);
      const afterBounds = structuredClone(world.def.tiles);
      assert.deepEqual(revertTerrainUndoPatches(world, result.patches), result.dirty);
      assert.deepEqual(snapshot(world), before);
      assert.deepEqual(world.def.tiles, bounds);
      assert.deepEqual(applyTerrainUndoPatches(world, result.patches), result.dirty);
      assert.deepEqual(snapshot(world), after);
      assert.deepEqual(world.def.tiles, afterBounds);
    }
  });

  check("terrain edit undo patch bytes scale with dirty area rather than tile area", () => {
    const bytes: number[] = [];
    for (const quads of [32, 256]) {
      const world = fixture(1, 1, quads);
      const result = applyTerrainBrush(world, { ...brush(world, "raise", 12, 12), radius: 2.1 });
      assert.equal(result.patches.length, 1);
      const patch = result.patches[0]!;
      const count = (patch.rect.x1 - patch.rect.x0 + 1) * (patch.rect.z1 - patch.rect.z0 + 1);
      const size = patch.before.heights.byteLength + patch.before.weights.byteLength + patch.after.heights.byteLength + patch.after.weights.byteLength;
      assert.equal(size, count * (4 + 8) * 2);
      assert.ok(count <= 25);
      bytes.push(size);
    }
    assert.equal(bytes[0], bytes[1]);
  });

  check("terrain edit overlapping stroke patches undo in reverse order and redo forwards", () => {
    const world = fixture();
    const before = snapshot(world);
    const first = applyTerrainBrush(world, brush(world));
    const second = applyTerrainBrush(world, brush(world, "flatten", 33, 32));
    const third = applyTerrainBrush(world, { ...brush(world), mode: "paint", layer: 5 });
    const patches = [...first.patches, ...second.patches, ...third.patches];
    const after = snapshot(world);
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), before);
    applyTerrainUndoPatches(world, patches);
    assert.deepEqual(snapshot(world), after);
    assertSeams(world);
  });

  check("terrain edit missing footprint or smoothing halo rejects atomically while holes remain editable", () => {
    const world = fixture();
    world.tiles.delete("1_1");
    const before = snapshot(world);
    assert.throws(() => applyTerrainBrush(world, brush(world)), /not resident/);
    assert.deepEqual(snapshot(world), before);
    const nearSeam = { ...brush(world, "smooth", 31, 33), radius: 0.25 };
    assert.throws(() => applyTerrainBrush(world, nearSeam), /not resident/);
    assert.deepEqual(snapshot(world), before);
    world.def.tiles = world.def.tiles.filter((entry) => entry.key !== "1_1");
    assert.ok(applyTerrainBrush(world, brush(world)).patches.length > 0);
    assertSeams(world);
  });

  check("terrain edit min max and cached raycast bounds refresh after edit and undo", () => {
    const world = fixture(1, 1);
    const tile = world.tile(0, 0)!;
    tile.heights.fill(0);
    const dab = { ...brush(world, "raise", 16, 16), strength: 50, radius: 1 };
    assert.ok(raycastTerrain(world.def, world, [dab.x, 100, dab.z], [0, -1, 0]));
    const result = applyTerrainBrush(world, dab);
    assert.deepEqual(world.def.tiles[0], { key: "0_0", minHeight: 0, maxHeight: 50 });
    const hit = raycastTerrain(world.def, world, [dab.x - 10, 61, dab.z], [1, 0, 0]);
    assert.ok(hit, "horizontal ray above the old bounds hits raised terrain");
    revertTerrainUndoPatches(world, result.patches);
    assert.deepEqual(world.def.tiles[0], { key: "0_0", minHeight: 0, maxHeight: 0 });
    applyTerrainBrush(world, { ...dab, mode: "lower" });
    assert.deepEqual(world.def.tiles[0], { key: "0_0", minHeight: -50, maxHeight: 0 });
  });

  check("terrain global map uses tile-parent stride and exact point heights including world edges", () => {
    const world = fixture(2, 3, 256);
    world.def.spacing = 0.5;
    const map = buildTerrainGlobalMap(world.def, world);
    assert.equal(map.stride, 16);
    assert.equal(map.width, 33);
    assert.equal(map.height, 49);
    for (let z = 0; z < map.height; z += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const expected = terrainHeightAt(world.def, world, world.def.origin[0] + x * 8, world.def.origin[2] + z * 8);
        assert.equal(map.heights[z * map.width + x], Math.fround(expected!));
      }
    }
    assert.equal(buildTerrainGlobalMap(world.def, world, 16).stride, 32);
    assert.throws(() => buildTerrainGlobalMap(world.def, world, 3));
  });

  check("terrain global map incremental random edits and undo equal full point-sample rebuilds", () => {
    const world = fixture(3, 2);
    const map = buildTerrainGlobalMap(world.def, world, 8);
    let state = 123456;
    const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    for (let i = 0; i < 70; i += 1) {
      const mode = modes[i % modes.length]!;
      const dab = { ...brush(world, mode, random() * 96, random() * 64), radius: 1 + random() * 15, strength: random() * 2 };
      const result = applyTerrainBrush(world, dab);
      for (const [key, rect] of result.dirty) updateTerrainGlobalMap(map, world.def, world, key, rect);
      assert.deepEqual(map.heights, buildTerrainGlobalMap(world.def, world, 8).heights);
      if (i % 7 === 0) {
        for (const [key, rect] of revertTerrainUndoPatches(world, result.patches)) updateTerrainGlobalMap(map, world.def, world, key, rect);
        assert.deepEqual(map.heights, buildTerrainGlobalMap(world.def, world, 8).heights);
      }
    }
  });

  check("terrain global map incremental sampling is confined to dirty texels and supports streaming", () => {
    const world = fixture();
    const resident = new TerrainTileMap();
    const map = buildTerrainGlobalMap(world.def, resident, 8);
    assert.ok(map.heights.every(Number.isNaN));
    for (const [key, tile] of world.tiles) {
      resident.set(tile);
      updateTerrainGlobalMap(map, world.def, resident, key);
      assert.deepEqual(map.heights, buildTerrainGlobalMap(world.def, resident, 8).heights);
    }
    const original = map.heights.slice();
    resident.delete(0, 0);
    updateTerrainGlobalMap(map, world.def, resident, "0_0");
    assert.deepEqual(map.heights, original, "stream-out preserves the global map");
    const calls: [number, number][] = [];
    const lookup = { tile: (x: number, z: number) => { calls.push([x, z]); return world.tile(x, z); } };
    map.heights.fill(-999);
    assert.deepEqual(updateTerrainGlobalMap(map, world.def, lookup, "0_0", { x0: 7, x1: 9, z0: 15, z1: 17 }), { x0: 1, x1: 1, z0: 2, z1: 2 });
    assert.equal(calls.length, 1);
    assert.equal(map.heights.filter((value) => value !== -999).length, 1);
    calls.length = 0;
    assert.equal(updateTerrainGlobalMap(map, world.def, lookup, "0_0", { x0: 1, x1: 7, z0: 1, z1: 7 }), null);
    assert.equal(calls.length, 0);
  });
}
