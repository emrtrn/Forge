import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type InstancedBufferGeometry,
} from "three";
import { TerrainRenderer } from "../../engine/render-three/terrain/terrainRenderer";
import {
  TerrainWorldHeightBounds,
  buildTerrainGlobalAttributes,
  computeTileNormals,
  updateTerrainGlobalAttributes,
  worldTerrainRenderSource,
  type TerrainRenderSource,
} from "../../engine/terrain/terrainRenderSource";
import { tileKey, type TerrainTileData } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

const Q = 64;
const SPACING = 1.5;
const TILES_X = 3;
const TILES_Z = 2;
const HOLE = tileKey(2, 1);

/** One function over global vertex coordinates, so duplicated seam vertices agree. */
function heightAt(gx: number, gz: number): number {
  return Math.fround(5 * Math.sin(gx * 0.09) * Math.cos(gz * 0.05) + 0.02 * gx - 0.01 * gz);
}

function worldTiles(): Map<string, TerrainTileData> {
  const tiles = new Map<string, TerrainTileData>();
  const size = Q + 1;
  for (let tz = 0; tz < TILES_Z; tz += 1) {
    for (let tx = 0; tx < TILES_X; tx += 1) {
      if (tileKey(tx, tz) === HOLE) continue;
      const heights = new Float32Array(size * size);
      const weights = new Uint8Array(size * size * 4);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const gx = tx * Q + x;
          const gz = tz * Q + z;
          heights[z * size + x] = heightAt(gx, gz);
          weights.set([gx % 256, gz % 256, (gx + gz) % 256, 7], (z * size + x) * 4);
        }
      }
      tiles.set(tileKey(tx, tz), { x: tx, z: tz, size, heights, layerCount: 4, weights });
    }
  }
  return tiles;
}

function worldSource(): TerrainRenderSource {
  return worldTerrainRenderSource({ tileQuads: Q, spacing: SPACING, tilesX: TILES_X, tilesZ: TILES_Z }, worldTiles());
}

const inHole = (gx: number, gz: number) => gx > 2 * Q && gz > Q;

function renderer(source: TerrainRenderSource, options: { slotCapacity?: number; uploadsPerFrame?: number } = {}) {
  return new TerrainRenderer(source, { viewMode: "lit", activeLayer: 0, layers: [], origin: new Vector3(-10, 2, 5), ...options });
}

function nodes(terrain: TerrainRenderer): { x0: number; z0: number; size: number; slot: number; tileX: number; tileZ: number; skirt: boolean }[] {
  const geometry = terrain.mesh.geometry as InstancedBufferGeometry;
  const a = geometry.getAttribute("terrainNodeA") as BufferAttribute;
  const b = geometry.getAttribute("terrainNodeB") as BufferAttribute;
  const c = geometry.getAttribute("terrainNodeC") as BufferAttribute;
  return Array.from({ length: geometry.instanceCount }, (_, index) => ({
    x0: a.getX(index), z0: a.getY(index), size: a.getZ(index), slot: a.getW(index), tileX: b.getX(index), tileZ: b.getY(index),
    skirt: c.getX(index) > 0.5,
  }));
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

export function registerTerrainWorldRendererTests(check: Check): void {
  check("terrain world: seam normals equal a single-grid reference, holes clamp", () => {
    const source = worldSource();
    const out = new Float32Array((Q + 1) * (Q + 1) * 2);
    const width = TILES_X * Q;
    const depth = TILES_Z * Q;
    for (const key of source.keys()) {
      const [tx, tz] = key.split("_").map(Number) as [number, number];
      computeTileNormals(source, key, out);
      for (let z = 0; z <= Q; z += 4) {
        for (let x = 0; x <= Q; x += 1) {
          const gx = tx * Q + x;
          const gz = tz * Q + z;
          // Next to the hole the neighbour is missing on purpose; checked separately.
          if (inHole(gx + 1, gz) || inHole(gx - 1, gz) || inHole(gx, gz + 1) || inHole(gx, gz - 1)) continue;
          const h = (px: number, pz: number) => heightAt(Math.min(Math.max(px, 0), width), Math.min(Math.max(pz, 0), depth));
          const dx = h(gx - 1, gz) - h(gx + 1, gz);
          const dz = h(gx, gz - 1) - h(gx, gz + 1);
          const length = Math.sqrt(dx * dx + 4 * SPACING * SPACING + dz * dz);
          const index = (z * (Q + 1) + x) * 2;
          assert.ok(Math.abs(out[index]! - dx / length) < 1e-5, `tile ${key} vertex ${x},${z}`);
          assert.ok(Math.abs(out[index + 1]! - dz / length) < 1e-5, `tile ${key} vertex ${x},${z}`);
        }
      }
    }
    // Tile 1_1's +X edge borders the hole: its right neighbour clamps to the vertex itself.
    computeTileNormals(source, tileKey(1, 1), out);
    const x = Q;
    const z = 20;
    const gx = Q + x;
    const gz = Q + z;
    const dx = heightAt(gx - 1, gz) - heightAt(gx, gz);
    const dz = heightAt(gx, gz - 1) - heightAt(gx, gz + 1);
    assert.ok(Math.abs(out[(z * (Q + 1) + x) * 2]! - dx / Math.sqrt(dx * dx + 4 * SPACING * SPACING + dz * dz)) < 1e-5);
  });

  check("terrain world: node height bounds equal brute force across tiles, holes stay conservative", () => {
    const source = worldSource();
    const bounds = new TerrainWorldHeightBounds(source);
    assert.equal(bounds.tileLevel, 1);
    const brute = (level: number, ix: number, iz: number) => {
      const span = 32 * 2 ** level;
      let min = Infinity;
      let max = -Infinity;
      for (let gz = iz * span; gz <= Math.min((iz + 1) * span, TILES_Z * Q); gz += 1) {
        for (let gx = ix * span; gx <= Math.min((ix + 1) * span, TILES_X * Q); gx += 1) {
          // A seam vertex next to the hole still exists in its other tile.
          const owners = [[Math.floor(gx / Q), Math.floor(gz / Q)], [Math.ceil(gx / Q) - 1, Math.floor(gz / Q)],
            [Math.floor(gx / Q), Math.ceil(gz / Q) - 1], [Math.ceil(gx / Q) - 1, Math.ceil(gz / Q) - 1]];
          const inTileOfNode = owners.some(([tx, tz]) => tileKey(tx!, tz!) !== HOLE && tx! >= 0 && tz! >= 0 && tx! < TILES_X && tz! < TILES_Z
            && tx! * Q <= gx && gx <= (tx! + 1) * Q && tz! * Q <= gz && gz <= (tz! + 1) * Q
            && (level > 1 || (Math.floor(ix * span / Q) === tx && Math.floor(iz * span / Q) === tz)));
          if (!inTileOfNode) continue;
          min = Math.min(min, heightAt(gx, gz));
          max = Math.max(max, heightAt(gx, gz));
        }
      }
      return { min, max };
    };
    for (let level = 0; level <= 1; level += 1) {
      const span = 2 ** (1 - level);
      for (let iz = 0; iz < TILES_Z * span; iz += 1) {
        for (let ix = 0; ix < TILES_X * span; ix += 1) {
          const node = bounds.node(level, ix, iz);
          if (tileKey(Math.floor(ix / span), Math.floor(iz / span)) === HOLE) {
            assert.deepEqual(node, bounds.range());
            continue;
          }
          const expected = brute(level, ix, iz);
          assert.equal(node.min, expected.min, `level ${level} node ${ix},${iz}`);
          assert.equal(node.max, expected.max, `level ${level} node ${ix},${iz}`);
        }
      }
    }
    const rangeOf = (tiles: string[]) => {
      const out = { min: Infinity, max: -Infinity };
      for (const key of tiles) {
        const [tx, tz] = key.split("_").map(Number) as [number, number];
        for (let z = 0; z <= Q; z += 1) {
          for (let x = 0; x <= Q; x += 1) {
            out.min = Math.min(out.min, heightAt(tx * Q + x, tz * Q + z));
            out.max = Math.max(out.max, heightAt(tx * Q + x, tz * Q + z));
          }
        }
      }
      return out;
    };
    const all = rangeOf([...source.keys()]);
    assert.deepEqual(bounds.range(), all);
    // Level 2 spans 2×2 tiles; level 3 spans the whole 3×2 grid.
    assert.deepEqual(bounds.node(2, 0, 0), rangeOf(["0_0", "1_0", "0_1", "1_1"]));
    assert.deepEqual(bounds.node(2, 1, 0), rangeOf(["2_0"]));
    assert.deepEqual(bounds.node(3, 0, 0), all);
  });

  check("terrain world: global map samples vertex heights, normals and weights; holes are flagged", () => {
    const source = worldSource();
    const global = buildTerrainGlobalAttributes(source);
    const { map } = global;
    assert.equal(map.stride, 4);
    assert.equal(map.width, TILES_X * Q / 4 + 1);
    assert.equal(map.height, TILES_Z * Q / 4 + 1);
    const width = TILES_X * Q;
    const depth = TILES_Z * Q;
    const h = (px: number, pz: number) => heightAt(Math.min(Math.max(px, 0), width), Math.min(Math.max(pz, 0), depth));
    for (let sz = 0; sz < map.height; sz += 1) {
      for (let sx = 0; sx < map.width; sx += 1) {
        const sample = sz * map.width + sx;
        const gx = sx * 4;
        const gz = sz * 4;
        if (inHole(gx, gz)) {
          assert.ok(Number.isNaN(map.heights[sample]!));
          assert.equal(global.normals[sample * 3 + 2], 1);
          continue;
        }
        assert.equal(map.heights[sample], heightAt(gx, gz));
        assert.equal(global.normals[sample * 3 + 2], 0);
        if (!(inHole(gx + 1, gz) || inHole(gx, gz + 1))) {
          const dx = h(gx - 1, gz) - h(gx + 1, gz);
          const dz = h(gx, gz - 1) - h(gx, gz + 1);
          const length = Math.sqrt(dx * dx + 4 * SPACING * SPACING + dz * dz);
          assert.ok(Math.abs(global.normals[sample * 3]! - dx / length) < 1e-5, `sample ${sx},${sz}`);
          assert.ok(Math.abs(global.normals[sample * 3 + 1]! - dz / length) < 1e-5, `sample ${sx},${sz}`);
        }
        assert.deepEqual([...global.weights.subarray(sample * 4, sample * 4 + 4)], [gx % 256, gz % 256, (gx + gz) % 256, 7]);
        assert.deepEqual([...global.weights.subarray((map.width * map.height + sample) * 4, (map.width * map.height + sample) * 4 + 4)], [0, 0, 0, 0]);
      }
    }
    // An edit re-samples only the touched points.
    const tile = source.tile(0, 0)!;
    tile.heights[8 * (Q + 1) + 8] = 99;
    const rect = updateTerrainGlobalAttributes(global, source, tileKey(0, 0), { x0: 8, x1: 8, z0: 8, z1: 8 });
    assert.ok(rect && rect.x0 <= 2 && rect.x1 >= 2 && rect.z0 <= 2 && rect.z1 >= 2);
    assert.equal(map.heights[2 * map.width + 2], 99);
  });

  check("terrain world: selected nodes cover every tile once and never a missing tile at full resolution", () => {
    const source = worldSource();
    const terrain = renderer(source);
    const width = TILES_X * Q * SPACING;
    const depth = TILES_Z * Q * SPACING;
    const next = (() => {
      let state = 9;
      return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
    })();
    for (let round = 0; round < 30; round += 1) {
      terrain.updateLod(cameraAt(-10 + (next() - 0.25) * width * 1.5, 2 + next() * 200, 5 + (next() - 0.25) * depth * 1.5));
      const list = nodes(terrain);
      for (let probe = 0; probe < 150; probe += 1) {
        const px = next() * width;
        const pz = next() * depth;
        const covering = list.filter((node) => px >= node.x0 && px < node.x0 + node.size && pz >= node.z0 && pz < node.z0 + node.size);
        if (inHole(px / SPACING, pz / SPACING)) {
          assert.ok(covering.length <= 1 && covering.every((node) => node.slot < 0), "a hole is only ever drawn (and discarded) from the global map");
          continue;
        }
        assert.equal(covering.length, 1, `point ${px},${pz} covered ${covering.length} times`);
      }
    }
    terrain.dispose();
  });

  check("terrain world: tile slots stream nearest-first under the upload budget and capacity", () => {
    const source = worldSource();
    const terrain = renderer(source, { slotCapacity: 2, uploadsPerFrame: 1 });
    assert.equal(terrain.residentTileCount, 0);
    // On tile 0_0 in terrain-local space: (0, 0) of the mesh is at origin (-10, 2, 5).
    const near = cameraAt(-10 + 20, 2 + 8, 5 + 20);
    terrain.updateLod(near);
    assert.equal(terrain.residentTileCount, 1);
    terrain.updateLod(near);
    assert.equal(terrain.residentTileCount, 2);
    terrain.updateLod(near);
    assert.equal(terrain.residentTileCount, 2, "capacity caps resident tiles");
    const tileSize = Q * SPACING;
    for (const node of nodes(terrain)) {
      if (node.slot < 0) continue;
      assert.ok(node.slot < 2);
      assert.ok(node.x0 >= node.tileX && node.x0 < node.tileX + tileSize, "a slot node lies in its tile");
      assert.ok(node.z0 >= node.tileZ && node.z0 < node.tileZ + tileSize, "a slot node lies in its tile");
    }
    assert.ok(nodes(terrain).some((node) => node.slot >= 0 && node.tileX === 0 && node.tileZ === 0), "the camera's tile is drawn from its slot");
    // Skirts hang only where a slot node meets a global stand-in.
    const list = nodes(terrain);
    const edgeShared = (p: (typeof list)[number], q: (typeof list)[number]) =>
      ((p.x0 + p.size === q.x0 || q.x0 + q.size === p.x0) && p.z0 < q.z0 + q.size && q.z0 < p.z0 + p.size)
      || ((p.z0 + p.size === q.z0 || q.z0 + q.size === p.z0) && p.x0 < q.x0 + q.size && q.x0 < p.x0 + p.size);
    assert.ok(list.some((node) => node.skirt));
    for (const node of list.filter((entry) => entry.skirt && entry.slot >= 0)) {
      assert.ok(list.some((other) => other.slot < 0 && other.skirt && edgeShared(node, other)), "a skirted slot node borders a stand-in");
    }
    const steady = renderer(source);
    steady.updateLod(near);
    assert.ok(nodes(steady).every((node) => !node.skirt), "with every tile resident no skirt hangs");
    steady.dispose();
    // Far at the other corner: the old tiles give their slots up for new ones.
    const far = cameraAt(-10 + tileSize * 1.5, 2 + 8, 5 + tileSize * 0.5);
    for (let frame = 0; frame < 4; frame += 1) terrain.updateLod(far);
    assert.ok(nodes(terrain).some((node) => node.slot >= 0 && node.tileX === tileSize && node.tileZ === 0));
    assert.ok(nodes(terrain).every((node) => node.slot < 0 || node.tileX !== 0 || node.tileZ !== tileSize));
    terrain.dispose();
  });

  check("terrain world: raycasts hit the same surface as a reference mesh and miss the hole", () => {
    const source = worldSource();
    const terrain = renderer(source);
    terrain.mesh.updateMatrixWorld(true);
    const width = TILES_X * Q;
    const positions: number[] = [];
    for (let gz = 0; gz <= TILES_Z * Q; gz += 1) {
      for (let gx = 0; gx <= width; gx += 1) positions.push(-10 + gx * SPACING, 2 + heightAt(gx, gz), 5 + gz * SPACING);
    }
    const indices: number[] = [];
    for (let gz = 0; gz < TILES_Z * Q; gz += 1) {
      for (let gx = 0; gx < width; gx += 1) {
        if (inHole(gx + 0.5, gz + 0.5)) continue;
        const a = gz * (width + 1) + gx;
        indices.push(a, a + width + 1, a + 1, a + 1, a + width + 1, a + width + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    const reference = new Mesh(geometry, new MeshBasicMaterial());
    const raycaster = new Raycaster();
    let state = 4;
    const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
    let hits = 0;
    let misses = 0;
    for (let ray = 0; ray < 250; ray += 1) {
      const target = new Vector3(-10 + next() * width * SPACING, 0, 5 + next() * TILES_Z * Q * SPACING);
      const origin = target.clone().add(new Vector3((next() - 0.5) * 60, 30 + next() * 50, (next() - 0.5) * 60));
      raycaster.set(origin, target.clone().sub(origin).normalize());
      const expected = raycaster.intersectObject(reference)[0];
      const actual = raycaster.intersectObject(terrain.mesh)[0];
      assert.equal(Boolean(actual), Boolean(expected), `ray ${ray} hit mismatch`);
      if (!actual || !expected) {
        misses += 1;
        continue;
      }
      hits += 1;
      assert.ok(actual.point.distanceTo(expected.point) < 1e-3, `ray ${ray}`);
    }
    assert.ok(hits > 100 && misses > 10, `${hits} hits / ${misses} misses`);
    terrain.dispose();
  });
}
