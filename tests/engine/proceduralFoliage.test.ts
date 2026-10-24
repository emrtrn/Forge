import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import { normalizeFoliageType, type LandscapeFoliageRule } from "../../engine/scene/foliage";
import { makeFoliageRng } from "../../engine/scene/foliagePaint";
import type { LandscapeFoliageGenerationInput } from "../../engine/scene/landscapeFoliage";
import {
  foliageCellSeed, generateFoliageCell, landscapeFoliageSurface, MAX_FOLIAGE_CELL_INSTANCES,
  worldTerrainFoliageSurface, type FoliageCellRequest, type FoliageSurface, type GeneratedFoliageCell,
} from "../../engine/scene/proceduralFoliage";
import { TerrainTileMap, terrainHeightAt, terrainSmoothNormalAt } from "../../engine/terrain/terrainHeightQuery";
import { TERRAIN_MAX_LAYERS, type TerrainTileData } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;
const RULE: LandscapeFoliageRule = {
  id: "grass-rule", landscapeId: "ground", layerId: "grass", foliageTypeId: "grass",
  density: 2, minWeight: 0.5, seed: 17,
};
const TYPE = normalizeFoliageType({ name: "Grass", meshAssetId: "grass" });
const REQUEST: FoliageCellRequest = { cellX: 0, cellZ: 0, cellSize: 16, keepFraction: 1 };
const FLAT: FoliageSurface = {
  heightAt: () => 2, normalAt: () => [0, 1, 0], layerWeightAt: () => 1,
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
};

function translations(cell: GeneratedFoliageCell): string[] {
  return Array.from({ length: cell.count }, (_, i) => Array.from(cell.matrices.slice(i * 16 + 12, i * 16 + 15)).join(","));
}

function near(actual: number | null, expected: number, epsilon = 1e-5): void {
  assert.ok(actual !== null && Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function landscape(): LandscapeFoliageGenerationInput {
  return {
    id: "ground", position: [10, 7, -20],
    data: {
      schema: 1, type: "landscape", size: { verticesX: 3, verticesZ: 3, spacing: 2, heightScale: 2 },
      chunks: { quadsPerChunk: 2 },
      heights: [0, 1, 2, 3, 5, 4, -1, -2, 0],
      layers: Array.from({ length: 6 }, (_, layer) => ({ id: `layer-${layer}`, name: `Layer ${layer}`,
        weights: Array.from({ length: 9 }, (_, index) => (index + layer) / 15) })),
    },
  };
}

export function registerProceduralFoliageTests(check: Check): void {
  check("procedural foliage: deterministic matrices and nested density subsets keep exact translations", () => {
    assert.deepEqual(generateFoliageCell(RULE, TYPE, FLAT, REQUEST), generateFoliageCell(RULE, TYPE, FLAT, REQUEST));
    const results = [0.25, 0.5, 1].map((keepFraction) => generateFoliageCell(RULE, TYPE, FLAT, { ...REQUEST, keepFraction }));
    assert.ok(results[0]!.count > 0);
    assert.ok(results[0]!.count < results[1]!.count && results[1]!.count < results[2]!.count);
    for (let i = 0; i < 2; i += 1) {
      const larger = new Set(translations(results[i + 1]!));
      for (const translation of translations(results[i]!)) assert.ok(larger.has(translation));
      const matrices = new Set(Array.from({ length: results[i + 1]!.count }, (_, j) =>
        Array.from(results[i + 1]!.matrices.slice(j * 16, (j + 1) * 16)).join(",")));
      for (let j = 0; j < results[i]!.count; j += 1) {
        assert.ok(matrices.has(Array.from(results[i]!.matrices.slice(j * 16, (j + 1) * 16)).join(",")));
      }
    }
  });

  check("procedural foliage: packed compose matches three for tilt, local yaw, antiparallel and zero normals", () => {
    const tilted = new Vector3(0.3, 0.8, -0.4).normalize();
    const normals: [number, number, number][] = [tilted.toArray(), [0, 1, 0], [0, -1, 0], [0, 0, 0], [1e-7, -1, 0]];
    for (const normal of normals) {
      for (const alignToNormal of [true, false]) {
        for (const randomYaw of [true, false]) {
          const type = { ...TYPE, alignToNormal, randomYaw, slopeMax: 180,
            scaleMin: [0.4, 0.4, 0.4] as [number, number, number], scaleMax: [1.8, 1.8, 1.8] as [number, number, number],
            zOffsetMin: -0.3, zOffsetMax: 0.7 };
          const surface: FoliageSurface = { ...FLAT, normalAt: () => normal };
          const request = { ...REQUEST, cellX: -1, cellZ: 2, cellSize: 2 };
          const generated = generateFoliageCell(RULE, type, surface, request);
          const rng = makeFoliageRng(foliageCellSeed(RULE.seed, request.cellX, request.cellZ));
          const perSide = Math.max(1, Math.round(request.cellSize * Math.sqrt(RULE.density)));
          assert.equal(generated.count, perSide * perSide);
          for (let i = 0; i < generated.count; i += 1) {
            const jx = rng(), jz = rng();
            rng();
            const scaleT = rng(), yawT = rng(), offsetT = rng();
            const x = request.cellX * request.cellSize + (i % perSide + jx) * request.cellSize / perSide;
            const z = request.cellZ * request.cellSize + (Math.floor(i / perSide) + jz) * request.cellSize / perSide;
            const up = alignToNormal ? new Vector3(...normal) : new Vector3(0, 1, 0);
            if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
            else up.normalize();
            const align = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up);
            const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), randomYaw ? yawT * 2 * Math.PI : 0);
            const scale = type.scaleMin[0] + (type.scaleMax[0] - type.scaleMin[0]) * scaleT;
            const offset = type.zOffsetMin + (type.zOffsetMax - type.zOffsetMin) * offsetT;
            const expected = new Matrix4().compose(new Vector3(x, 2, z).addScaledVector(up, offset),
              align.multiply(yaw), new Vector3(scale, scale, scale));
            expected.elements.forEach((value, j) => near(generated.matrices[i * 16 + j]!, value));
          }
        }
      }
    }
  });

  check("procedural foliage: layer, slope, height and unavailable surface filters reject candidates", () => {
    const half: FoliageSurface = { ...FLAT, layerWeightAt: (_id, x) => x < 8 ? 0 : 1 };
    const weighted = generateFoliageCell(RULE, TYPE, half, REQUEST);
    assert.ok(weighted.count > 0);
    for (let i = 0; i < weighted.count; i += 1) assert.ok(weighted.matrices[i * 16 + 12]! >= 8);
    const plane: FoliageSurface = { ...FLAT, normalAt: () => [Math.SQRT1_2, Math.SQRT1_2, 0] };
    assert.equal(generateFoliageCell(RULE, { ...TYPE, slopeMax: 10 }, plane, REQUEST).count, 0);
    assert.equal(generateFoliageCell(RULE, { ...TYPE, heightMin: 3 }, FLAT, REQUEST).count, 0);
    assert.equal(generateFoliageCell(RULE, { ...TYPE, heightMax: 1 }, FLAT, REQUEST).count, 0);
    for (const surface of [{ ...FLAT, layerWeightAt: () => null }, { ...FLAT, normalAt: () => null },
      { ...FLAT, heightAt: () => null }]) assert.equal(generateFoliageCell(RULE, TYPE, surface, REQUEST).count, 0);
    const bounded: FoliageSurface = { ...FLAT, bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 8 },
      heightAt: (x, z) => x < 8 && z < 8 ? 2 : null };
    const result = generateFoliageCell(RULE, TYPE, bounded, REQUEST);
    assert.ok(result.count > 0);
    for (let i = 0; i < result.count; i += 1) {
      assert.ok(result.matrices[i * 16 + 12]! < 8 && result.matrices[i * 16 + 14]! < 8);
    }
    assert.equal(generateFoliageCell(RULE, TYPE, { ...FLAT, layerWeightAt: () => RULE.minWeight - 0.5e-6 }, REQUEST).count,
      generateFoliageCell(RULE, TYPE, FLAT, REQUEST).count);
  });

  check("procedural foliage: caps and disabled requests return exactly sized buffers", () => {
    for (const maxInstances of [0, 1, 7]) {
      const result = generateFoliageCell(RULE, TYPE, FLAT, { ...REQUEST, maxInstances });
      assert.equal(result.count, maxInstances);
      assert.equal(result.matrices.length, result.count * 16);
    }
    const capped = generateFoliageCell({ ...RULE, density: 8 }, TYPE, FLAT, { ...REQUEST, cellSize: 32 });
    assert.equal(capped.count, MAX_FOLIAGE_CELL_INSTANCES);
    assert.equal(capped.matrices.length, MAX_FOLIAGE_CELL_INSTANCES * 16);
    for (const request of [{ ...REQUEST, cellSize: 0 }, { ...REQUEST, cellSize: -1 },
      { ...REQUEST, keepFraction: 0 }, { ...REQUEST, keepFraction: -1 }]) {
      assert.deepEqual(generateFoliageCell(RULE, TYPE, FLAT, request), { count: 0, matrices: new Float32Array(0) });
    }
    assert.equal(generateFoliageCell({ ...RULE, density: 0 }, TYPE, FLAT, REQUEST).matrices.length, 0);
    assert.equal(generateFoliageCell({ ...RULE, density: -1 }, TYPE, FLAT, REQUEST).count, 0);
  });

  check("procedural foliage: cell seeds are unsigned, distinct nearby and support negative layouts", () => {
    const seeds = new Set<number>();
    for (let z = -10; z <= 10; z += 1) {
      for (let x = -10; x <= 10; x += 1) {
        const seed = foliageCellSeed(1, x, z);
        assert.equal(seed, seed >>> 0);
        seeds.add(seed);
      }
    }
    assert.equal(seeds.size, 441);
    assert.equal(foliageCellSeed(-1, -2, 3), foliageCellSeed(0xffffffff, -2, 3));
    const negative = generateFoliageCell(RULE, TYPE, FLAT, { ...REQUEST, cellX: -1, cellZ: -1 });
    assert.ok(negative.count > 0);
    assert.notDeepEqual(negative.matrices, generateFoliageCell(RULE, TYPE, FLAT, REQUEST).matrices);
    const adjacent = generateFoliageCell(RULE, TYPE, FLAT, { ...REQUEST, cellX: 1 });
    assert.notEqual(negative.matrices[12]! + 16, adjacent.matrices[12]! - 16);
    for (let i = 0; i < negative.count; i += 1) {
      assert.ok(negative.matrices[i * 16 + 12]! >= -16 && negative.matrices[i * 16 + 12]! < 0);
      assert.ok(negative.matrices[i * 16 + 14]! >= -16 && negative.matrices[i * 16 + 14]! < 0);
    }
  });

  check("procedural foliage: world surface uses exact resident tile heights, seam normals and layer ids", () => {
    const def = { tileQuads: 2, spacing: 2, tilesX: 2, tilesZ: 1,
      origin: [10, 5, -4] as [number, number, number], layers: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const tiles = new TerrainTileMap();
    for (let x = 0; x < 2; x += 1) {
      const tile: TerrainTileData = { x, z: 0, size: 3, layerCount: 2,
        heights: Float32Array.from({ length: 9 }, (_, i) => x * 2 + i % 3 + Math.floor(i / 3)),
        weights: new Uint8Array(9 * 4) };
      for (let i = 0; i < 9; i += 1) { tile.weights[i * 4] = 51; tile.weights[i * 4 + 1] = 204; }
      tiles.set(tile);
    }
    const surface = worldTerrainFoliageSurface(def, tiles);
    assert.deepEqual(surface.bounds, { minX: 10, maxX: 18, minZ: -4, maxZ: 0 });
    for (const x of [10, 13.9, 14, 14.1, 18]) {
      assert.equal(surface.heightAt(x, -2), terrainHeightAt(def, tiles, x, -2));
      assert.deepEqual(surface.normalAt(x, -2), terrainSmoothNormalAt(def, tiles, x, -2));
      near(surface.layerWeightAt("a", x, -2), 0.2);
      near(surface.layerWeightAt("b", x, -2), 0.8);
      assert.equal(surface.layerWeightAt("c", x, -2), 0);
    }
    assert.equal(surface.layerWeightAt("unknown", 14, -2), null);
    assert.equal(surface.heightAt(9, -2), null);
    assert.equal(surface.layerWeightAt("b", 9, -2), null);
    tiles.delete(1, 0);
    assert.equal(surface.heightAt(15, -2), null);
    assert.equal(surface.normalAt(15, -2), null);
    assert.equal(surface.layerWeightAt("b", 15, -2), null);
    assert.equal(surface.heightAt(14, -2), terrainHeightAt(def, tiles, 14, -2));
  });

  check("procedural foliage: legacy landscape preserves vertex heights, packed weights and triangle interpolation", () => {
    const input = landscape();
    const before = structuredClone(input);
    const surface = landscapeFoliageSurface(input)!;
    assert.ok(surface);
    assert.deepEqual(surface.bounds, { minX: 8, maxX: 12, minZ: -22, maxZ: -18 });
    for (let z = 0; z < 3; z += 1) {
      for (let x = 0; x < 3; x += 1) {
        const index = z * 3 + x;
        near(surface.heightAt(8 + x * 2, -22 + z * 2), input.data.heights[index]! * 2 + 7);
        for (const layer of input.data.layers) {
          near(surface.layerWeightAt(layer.id, 8 + x * 2, -22 + z * 2), layer.weights[index]!, 1 / 255 + 1e-6);
        }
      }
    }
    near(surface.heightAt(9, -21), 11);
    assert.deepEqual(input, before);
    const clamped = landscape();
    clamped.data.layers[0]!.weights[0] = -1;
    clamped.data.layers[1]!.weights[0] = 2;
    const clampedSurface = landscapeFoliageSurface(clamped)!;
    assert.equal(clampedSurface.layerWeightAt("layer-0", 8, -22), 0);
    assert.equal(clampedSurface.layerWeightAt("layer-1", 8, -22), 1);
    const limited = landscape();
    limited.data.layers = Array.from({ length: TERRAIN_MAX_LAYERS + 1 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, weights: Array(9).fill(1) }));
    assert.equal(landscapeFoliageSurface(limited)!.layerWeightAt(`l${TERRAIN_MAX_LAYERS}`, 8, -22), 0);
  });

  check("procedural foliage: legacy landscape rejects rotation, non-square grids and invalid dimensions", () => {
    const input = landscape();
    for (const rotation of [[1, 0, 0], [0, -1, 0], [0, 0, 1]] as [number, number, number][]) {
      assert.equal(landscapeFoliageSurface({ ...input, rotation }), null);
    }
    assert.ok(landscapeFoliageSurface({ ...input, rotation: [1e-10, 0, 0] }));
    for (const size of [{ ...input.data.size, verticesZ: 2 }, { ...input.data.size, verticesX: 1, verticesZ: 1 },
      { ...input.data.size, spacing: 0 }, { ...input.data.size, spacing: -1 }]) {
      assert.equal(landscapeFoliageSurface({ ...input, data: { ...input.data, size } }), null);
    }
  });
}
