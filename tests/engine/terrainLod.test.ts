import assert from "node:assert/strict";
import {
  createTerrainLodSettings,
  terrainLodMorphRanges,
  terrainLodRanges,
  terrainMorphFactor,
  terrainResidentTileKeys,
  TerrainLodSelector,
  validateTerrainLodRange,
  type TerrainLodNode,
  type TerrainLodWorld,
  type TerrainNodeHeights,
} from "../../engine/terrain/terrainLod";
import { TerrainSlotPool } from "../../engine/terrain/terrainSlotPool";
import { parseTileKey } from "../../engine/terrain/terrainTypes";
import { distanceToWorldCell } from "../../engine/world/worldGrid";

type Check = (label: string, fn: () => void) => void;

const world: TerrainLodWorld = { tileQuads: 256, spacing: 1, tilesX: 15, tilesZ: 11, origin: [-700, 120, 230] };
const mountain = (x: number, z: number): number => 80 * Math.sin(x / 256) * Math.cos(z / 320) + 30 * Math.sin((x + z) / 96);

/** Exact bounds for a sampled mountainous field, aggregated up the quadtree. */
function mountainBounds(def: TerrainLodWorld): TerrainNodeHeights {
  const settings = createTerrainLodSettings(def);
  const bounds = new Map<string, { min: number; max: number }>();
  const width = def.tilesX * def.tileQuads * def.spacing;
  const depth = def.tilesZ * def.tileQuads * def.spacing;
  const key = (level: number, ix: number, iz: number): string => `${level}:${ix}:${iz}`;
  for (let level = 0; level < settings.levels; level += 1) {
    const size = settings.leafSize * 2 ** level;
    for (let iz = 0; iz < Math.ceil(depth / size); iz += 1) {
      for (let ix = 0; ix < Math.ceil(width / size); ix += 1) {
        let min = Infinity;
        let max = -Infinity;
        if (level === 0) {
          for (let z = 0; z <= 4; z += 1) {
            for (let x = 0; x <= 4; x += 1) {
              const h = mountain((ix + x / 4) * size, (iz + z / 4) * size);
              min = Math.min(min, h);
              max = Math.max(max, h);
            }
          }
        } else {
          for (let child = 0; child < 4; child += 1) {
            const bound = bounds.get(key(level - 1, ix * 2 + (child & 1), iz * 2 + (child >> 1)));
            if (!bound) continue;
            min = Math.min(min, bound.min);
            max = Math.max(max, bound.max);
          }
        }
        assert.equal(validateTerrainLodRange(settings, max - min, size), null);
        bounds.set(key(level, ix, iz), { min, max });
      }
    }
  }
  return (level, ix, iz) => {
    const bound = bounds.get(key(level, ix, iz));
    assert.ok(bound, `missing node ${key(level, ix, iz)}`);
    return bound;
  };
}

function randomSource(): () => number {
  let seed = 0x51cd10d;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function cameras(def: TerrainLodWorld): Array<readonly [number, number, number]> {
  const random = randomSource();
  return Array.from({ length: 180 }, (_, index) => {
    const x = random() * (def.tilesX * 256 + 1024) - 512;
    const z = random() * (def.tilesZ * 256 + 1024) - 512;
    const y = index % 15 === 0 ? 2000 : mountain(x, z) + random() * 500 + 2;
    return [def.origin[0] + x, def.origin[1] + y, def.origin[2] + z];
  });
}

/** Rasterize footprints to test all shared edges and detect holes/overlaps. */
function nodeLevels(nodes: TerrainLodNode[], effective: boolean): Int16Array {
  const width = world.tilesX * 8;
  const depth = world.tilesZ * 8;
  const levels = new Int16Array(width * depth).fill(-1);
  for (const node of nodes) {
    const cells = 2 ** node.level;
    const level = node.level + (effective && !node.inRange ? 1 : 0);
    for (let z = node.iz * cells; z < Math.min((node.iz + 1) * cells, depth); z += 1) {
      for (let x = node.ix * cells; x < Math.min((node.ix + 1) * cells, width); x += 1) {
        assert.equal(levels[z * width + x], -1, "selected nodes overlap");
        levels[z * width + x] = level;
      }
    }
  }
  assert.ok(levels.every((level) => level >= 0), "selected nodes leave a hole");
  return levels;
}

export function registerTerrainLodTests(check: Check): void {
  check("terrain LOD: mountainous neighbours differ by at most one across 180 seeded cameras", () => {
    const selector = new TerrainLodSelector(world, mountainBounds(world));
    const width = world.tilesX * 8;
    for (const camera of cameras(world)) {
      const nodes = selector.select(camera);
      for (const effective of [false, true]) {
        const levels = nodeLevels(nodes, effective);
        for (let z = 0; z < world.tilesZ * 8; z += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = z * width + x;
            const level = levels[index]!;
            if (x + 1 < width) assert.ok(Math.abs(level - levels[index + 1]!) <= 1, `X gap at ${x},${z}; camera ${camera}; effective ${effective}`);
            if (z + 1 < world.tilesZ * 8) assert.ok(Math.abs(level - levels[index + width]!) <= 1, `Z gap at ${x},${z}; camera ${camera}; effective ${effective}`);
          }
        }
      }
    }
  });

  check("terrain LOD: ranges double and morph matches the shader at start, midpoint and end", () => {
    const settings = createTerrainLodSettings(world);
    assert.equal(settings.patchQuads, 32);
    assert.equal(settings.leafSize, 32);
    assert.equal(settings.range0, 128);
    assert.equal(settings.tileLevel, 3);
    const ranges = terrainLodRanges(settings);
    const morph = terrainLodMorphRanges(settings);
    for (let level = 0; level < settings.levels; level += 1) {
      assert.equal(ranges[level], settings.range0 * 2 ** level);
      if (level > 0) assert.equal(ranges[level], ranges[level - 1]! * 2);
      const [start, end] = morph[level]!;
      assert.equal(terrainMorphFactor(start - 1, [start, end]), 0);
      assert.equal(terrainMorphFactor(start, [start, end]), 0);
      assert.ok(terrainMorphFactor(start + (end - start) * 0.001, [start, end]) < 0.002);
      assert.ok(Math.abs(terrainMorphFactor((start + end) / 2, [start, end]) - 0.5) < 1e-9);
      assert.equal(terrainMorphFactor(end, [start, end]), 1);
      assert.equal(terrainMorphFactor(end + 1, [start, end]), 1);
      if (level < settings.levels - 1) {
        assert.equal(end, ranges[level]! * 0.99);
        const previous = level === 0 ? 0 : ranges[level - 1]!;
        assert.equal(start, previous + (end - previous) * 0.7);
      }
    }
    const custom = createTerrainLodSettings(world, { patchQuads: 16, leafSize: 64, range0: 300, levels: 7, morphStartRatio: 0.5 });
    assert.equal(custom.tileLevel, 2);
    assert.equal(terrainLodMorphRanges(custom)[0]![0], 148.5);
    assert.throws(() => createTerrainLodSettings(world, { leafSize: 48 }), /leafSize/);
    assert.throws(() => createTerrainLodSettings(world, { patchQuads: 3 }), /patchQuads/);
    assert.throws(() => createTerrainLodSettings(world, { levels: 2 }), /levels/);
    assert.throws(() => createTerrainLodSettings(world, { range0: Infinity }), /ranges/);
    assert.throws(() => createTerrainLodSettings(world, { morphStartRatio: 1 }), /morphStartRatio/);
  });

  check("terrain LOD: residency covers every slot node; fully morphed tile nodes use the global map", () => {
    const selector = new TerrainLodSelector(world, mountainBounds(world));
    let tileFallbacks = 0;
    let fineNodes = 0;
    for (const camera of cameras(world)) {
      const resident = new Set(terrainResidentTileKeys(world, selector.settings, camera));
      for (const node of selector.select(camera)) {
        if (node.needsTileSlot) {
          fineNodes += 1;
          assert.ok(node.level <= selector.settings.tileLevel);
          assert.ok(node.tileKey && resident.has(node.tileKey), `missing ${node.tileKey} for camera ${camera}`);
          const tx = Math.floor((node.box.minX - world.origin[0]) / 256);
          const tz = Math.floor((node.box.minZ - world.origin[2]) / 256);
          assert.equal(node.tileKey, `${tx}_${tz}`);
          assert.ok(node.box.maxX <= world.origin[0] + (tx + 1) * 256);
          assert.ok(node.box.maxZ <= world.origin[2] + (tz + 1) * 256);
        } else {
          assert.equal(node.tileKey, null);
          assert.ok(node.level > selector.settings.tileLevel || (node.level === selector.settings.tileLevel && !node.inRange));
          if (node.level === selector.settings.tileLevel) {
            tileFallbacks += 1;
            const dx = Math.max(node.box.minX - camera[0], 0, camera[0] - node.box.maxX);
            const dy = Math.max(node.box.minY - camera[1], 0, camera[1] - node.box.maxY);
            const dz = Math.max(node.box.minZ - camera[2], 0, camera[2] - node.box.maxZ);
            assert.equal(terrainMorphFactor(Math.hypot(dx, dy, dz), node.morphRange), 1);
          }
        }
      }
    }
    assert.ok(tileFallbacks > 0 && fineNodes > 0);
  });

  check("terrain LOD: radius four includes 67 interior tiles in near-to-far order", () => {
    const large = { ...world, tilesX: 32, tilesZ: 32 };
    const settings = createTerrainLodSettings(large);
    const camera = [large.origin[0] + 16.3 * 256, 5000, large.origin[2] + 16.3 * 256] as const;
    const keys = terrainResidentTileKeys(large, settings, camera);
    assert.equal(keys.length, 67);
    assert.equal(new Set(keys).size, 67);
    const grid = { cellSize: 256, origin: [large.origin[0], large.origin[2]] as const };
    let previous = -1;
    for (const key of keys) {
      const { x, z } = parseTileKey(key)!;
      const distance = distanceToWorldCell(grid, x, z, camera[0], camera[2]);
      assert.ok(distance >= previous && distance <= 4 * 256);
      previous = distance;
    }
    // 67 is an area estimate, not a cap: a camera at the tile centre needs 69.
    assert.equal(terrainResidentTileKeys(large, settings, [large.origin[0] + 16.5 * 256, 0, large.origin[2] + 16.5 * 256]).length, 69);
    assert.ok(terrainResidentTileKeys(large, settings, large.origin).every((key) => {
      const coord = parseTileKey(key)!;
      return coord.x >= 0 && coord.z >= 0 && coord.x < 32 && coord.z < 32;
    }));
    assert.deepEqual(terrainResidentTileKeys(large, settings, [1e6, 0, 1e6]), []);
  });

  check("terrain LOD: relief validation flags ratio three and accepts four through H/size 1.41", () => {
    assert.match(validateTerrainLodRange({ leafSize: 32, range0: 96 }, 32)!, /range0\/leaf \(3\) must be >.*H\/size = 1/);
    assert.equal(validateTerrainLodRange({ leafSize: 32, range0: 96 }, 0), null);
    const settings = { leafSize: 32, range0: 128 };
    for (const size of [32, 64, 256, 1024]) {
      assert.equal(validateTerrainLodRange(settings, size * 1.41, size), null);
      assert.ok(validateTerrainLodRange(settings, size * 1.42, size));
    }
    assert.ok(validateTerrainLodRange({ leafSize: 32, range0: 32 * 2 * Math.sqrt(3) }, 32));
    assert.match(validateTerrainLodRange(settings, NaN)!, /finite/);
    assert.ok(validateTerrainLodRange(settings, -1));
    assert.ok(validateTerrainLodRange(settings, 1, 0));
  });

  check("terrain LOD: non-square edges, visibility injection and distant roots preserve coverage", () => {
    const selector = new TerrainLodSelector(world, mountainBounds(world));
    const camera = [world.origin[0] + 3800, world.origin[1] + 30, world.origin[2] + 2750] as const;
    const all = selector.select(camera);
    nodeLevels(all, false);
    assert.ok(all.some((node) => !node.needsTileSlot));
    for (const node of all) {
      assert.equal(node.offsetX, world.origin[0] + node.ix * node.size);
      assert.equal(node.offsetZ, world.origin[2] + node.iz * node.size);
      assert.ok(node.box.maxX <= world.origin[0] + 15 * 256);
      assert.ok(node.box.maxZ <= world.origin[2] + 11 * 256);
    }
    assert.deepEqual(selector.select(camera, () => false), []);
    const cut = world.origin[0] + 7 * 256;
    const visible = selector.select(camera, (box) => box.maxX > cut);
    assert.deepEqual(visible, all.filter((node) => node.box.maxX > cut));
    const far = selector.select([1e6, 1e6, 1e6]);
    assert.ok(far.every((node) => node.level === selector.settings.levels - 1 && !node.needsTileSlot));
    nodeLevels(far, false);
    const forest = new TerrainLodSelector(world, mountainBounds(world), { levels: 5 });
    assert.ok(forest.select([1e6, 1e6, 1e6]).length > 1);
    nodeLevels(forest.select(camera), false);
  });

  check("terrain slots: release and re-acquire reuse cached data without evicting active slots", () => {
    const pool = new TerrainSlotPool(2);
    assert.deepEqual(pool.acquire("a"), { slot: 0, cached: false, evictedKey: null });
    assert.deepEqual(pool.acquire("a"), { slot: 0, cached: true, evictedKey: null });
    pool.release("a");
    assert.ok(pool.has("a"));
    assert.equal(pool.slotOf("a"), 0);
    assert.deepEqual(pool.acquire("a"), { slot: 0, cached: true, evictedKey: null });
    assert.deepEqual(pool.acquire("b"), { slot: 1, cached: false, evictedKey: null });
    assert.equal(pool.acquire("c"), null);
    assert.equal(pool.size, 2);
    pool.release("missing");
    assert.equal(pool.slotOf("missing"), undefined);
  });

  check("terrain slots: capacity pressure evicts least-recently-released data", () => {
    const pool = new TerrainSlotPool(3);
    for (const key of ["a", "b", "c"]) pool.acquire(key);
    pool.release("b");
    pool.release("a");
    pool.release("b"); // Repeated release does not move the release time.
    assert.deepEqual(pool.acquire("d"), { slot: 1, cached: false, evictedKey: "b" });
    assert.ok(!pool.has("b"));
    assert.equal(pool.slotOf("b"), undefined);
    assert.deepEqual(pool.acquire("a"), { slot: 0, cached: true, evictedKey: null });
    pool.release("d");
    pool.release("a");
    assert.deepEqual(pool.acquire("e"), { slot: 1, cached: false, evictedKey: "d" });
    assert.deepEqual(pool.acquire("f"), { slot: 0, cached: false, evictedKey: "a" });
    assert.equal(pool.slotOf("c"), 2);
    assert.equal(pool.acquire("g"), null);
    const freeFirst = new TerrainSlotPool(2);
    freeFirst.acquire("a");
    freeFirst.release("a");
    assert.deepEqual(freeFirst.acquire("b"), { slot: 1, cached: false, evictedKey: null });
    assert.ok(freeFirst.has("a"));
  });

  check("terrain slots: default capacity 80 stays bounded across repeated allocation cycles", () => {
    const pool = new TerrainSlotPool();
    assert.equal(pool.capacity, 80);
    const active = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      const key = `${i}_0`;
      const acquisition = pool.acquire(key);
      assert.ok(acquisition);
      assert.ok(acquisition.slot >= 0 && acquisition.slot < 80);
      assert.ok(!Array.from(active.values()).includes(acquisition.slot));
      active.set(key, acquisition.slot);
      if (active.size > 40) {
        const oldest = active.keys().next().value!;
        pool.release(oldest);
        active.delete(oldest);
      }
      assert.ok(pool.size <= pool.capacity);
      for (const [activeKey, slot] of active) assert.equal(pool.slotOf(activeKey), slot);
    }
    assert.equal(pool.size, 80);
    for (const capacity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => new TerrainSlotPool(capacity), /capacity/);
  });
}
