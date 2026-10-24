/** Play-side procedural foliage ring (OPEN_WORLD_PLAN Faz 6 F3) over the same-thread generator. */
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { FoliageRenderBinding } from "../../engine/render-three/foliage";
import { normalizeFoliageType, type LandscapeFoliageRule } from "../../engine/scene/foliage";
import { generateFoliageCell, worldTerrainFoliageSurface } from "../../engine/scene/proceduralFoliage";
import { TerrainTileMap } from "../../engine/terrain/terrainHeightQuery";
import { createFlatTerrainTile, tileKey, type TerrainTileData } from "../../engine/terrain/terrainTypes";
import { planFoliageRing } from "../../engine/world/foliageRing";
import { LocalFoliageCellGenerator } from "../../src/scene/foliageCellGenerator";
import { ProceduralFoliageRing, type ProceduralFoliageTerrain } from "../../src/scene/proceduralFoliageRing";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const DEF = { tileQuads: 64, spacing: 1, tilesX: 2, tilesZ: 1, origin: [0, 0, 0] as [number, number, number], layers: [{ id: "grass" }] };
const RULE: LandscapeFoliageRule = { id: "meadow", landscapeId: "ground", layerId: "grass", foliageTypeId: "grass-type", density: 0.25, minWeight: 0.5, seed: 7 };

function fixture(options: { residentTiles?: string[] } = {}) {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1)));
  const gltf = { scene } as unknown as GLTF;
  const type = normalizeFoliageType({ name: "Grass", meshAssetId: "m", cullEnd: 40 });
  const resolver = { getType: () => type, getModel: () => gltf };
  const all = new Map<string, TerrainTileData>();
  for (const x of [0, 1]) all.set(tileKey(x, 0), createFlatTerrainTile(DEF, x, 0, x * 0.5));
  const resident = new TerrainTileMap();
  for (const key of options.residentTiles ?? [...all.keys()]) resident.set(all.get(key)!);
  const terrain: ProceduralFoliageTerrain = { id: "ground", def: DEF, tiles: resident, existingTiles: new Set(all.keys()) };
  const binding = new FoliageRenderBinding();
  const generator = new LocalFoliageCellGenerator();
  const ring = new ProceduralFoliageRing({ rules: [{ rule: RULE, type, terrain }], binding, resolver, generator });
  const instances = () => binding.allMeshes().reduce((sum, mesh) => sum + mesh.count, 0);
  /** What the ring should show around `center`: each planned cell generated directly. */
  const expected = (center: [number, number], density: number) => {
    const full = new TerrainTileMap();
    for (const tile of all.values()) full.set(tile);
    const surface = worldTerrainFoliageSurface(DEF, full);
    return planFoliageRing({ center, radius: 40, density, bounds: { minX: 0, maxX: 128, minZ: 0, maxZ: 64 }, built: new Map() }).build
      .reduce((sum, cell) => sum + generateFoliageCell(RULE, type, surface, {
        cellX: cell.cellX, cellZ: cell.cellZ, cellSize: 32, keepFraction: cell.keepFraction,
      }).count, 0);
  };
  return { ring, binding, generator, resident, all, instances, expected };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function frames(ring: ProceduralFoliageRing, center: [number, number], density: number, count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    ring.update(center, 1, density, 4);
    await settle();
  }
}

export async function registerProceduralFoliageRingTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("procedural foliage ring: prepare builds exactly the planned cells around the camera", async () => {
    const f = fixture();
    await f.ring.prepare([20, 20], 1, 1);
    const want = f.expected([20, 20], 1);
    assert.ok(want > 0);
    assert.equal(f.instances(), want);
    assert.equal(f.ring.snapshot().instances, want);
    assert.equal(f.ring.snapshot().pending, 0);
    f.ring.dispose();
    assert.equal(f.instances(), 0, "dispose removes every ring batch");
  });

  await checkAsync("procedural foliage ring: frames follow the camera and density", async () => {
    const f = fixture();
    await f.ring.prepare([20, 20], 1, 1);
    await frames(f.ring, [116, 20], 1);
    assert.equal(f.instances(), f.expected([116, 20], 1), "moved past 1.25x: old cells gone, new cells built");
    await frames(f.ring, [116, 20], 0.3);
    assert.equal(f.instances(), f.expected([116, 20], 0.3), "lower density rebuilds the ring thinner");
    await frames(f.ring, [116, 20], 0);
    assert.equal(f.instances(), 0, "zero density removes it");
    f.ring.dispose();
  });

  await checkAsync("procedural foliage ring: a cell waits for its tiles and grows once they are resident", async () => {
    const f = fixture({ residentTiles: ["0_0"] });
    // Camera on the seam: cells over tile 1_0 (x >= 64) need it.
    await f.ring.prepare([64, 20], 1, 1);
    const partial = f.instances();
    assert.ok(partial > 0 && partial < f.expected([64, 20], 1), "only cells clear of tile 1_0 so far");
    f.resident.set(f.all.get("1_0")!);
    await frames(f.ring, [64, 20], 1);
    assert.equal(f.instances(), f.expected([64, 20], 1));
    // Streamed out: the generator forgets it; cells already built stay.
    f.resident.delete(1, 0);
    await frames(f.ring, [64, 20], 1, 2);
    assert.equal(f.instances(), f.expected([64, 20], 1));
    f.ring.dispose();
  });
}
