import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type InstancedBufferGeometry,
} from "three";
import {
  createLandscapeObject,
  disposeLandscapeObject,
  updateLandscapeLod,
  updateLandscapeObjectGeometry,
  type LandscapeObject,
  type LandscapeRenderItem,
} from "../../engine/render-three/landscape";
import { terrainRendererOf } from "../../engine/render-three/terrain/terrainRenderer";
import { createFlatLandscapeData, type ForgeLandscapeData } from "../../engine/scene/landscape";
import {
  TerrainNodeHeightBounds,
  computeTerrainNormals,
  copyLandscapeHeights,
  fullTerrainRect,
  packTerrainWeights,
  terrainRenderGrid,
} from "../../engine/terrain/terrainRenderData";

type Check = (label: string, fn: () => void) => void;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Rolling hills plus noise over any grid size, so normals and LOD bounds are not trivial. */
function hillyData(verticesX: number, verticesZ: number, spacing = 1.5, seed = 7): ForgeLandscapeData {
  const data = createFlatLandscapeData("small");
  data.size = { verticesX, verticesZ, spacing, heightScale: 1 };
  const next = random(seed);
  data.heights = [];
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) data.heights.push(6 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + next() * 0.4);
  }
  data.layers = [];
  return data;
}

function item(data: ForgeLandscapeData, rotationY = 0): LandscapeRenderItem {
  return {
    id: "land", name: "Landscape", collision: true, hidden: false,
    position: [3, -2, 5], rotation: [0, rotationY, 0], data,
  } as LandscapeRenderItem;
}

function build(source: LandscapeRenderItem): LandscapeObject {
  const object = createLandscapeObject(source);
  object.updateMatrixWorld(true);
  return object;
}

/**
 * Independent reference surface: the authored grid as an ordinary mesh, centred
 * on the actor and split along the same b–c diagonal as the collider.
 */
function referenceMesh(source: LandscapeRenderItem): Group {
  const { verticesX, verticesZ, spacing, heightScale } = source.data.size;
  const positions = new Float32Array(verticesX * verticesZ * 3);
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) {
      const index = z * verticesX + x;
      positions.set([
        x * spacing - ((verticesX - 1) * spacing) / 2,
        source.data.heights[index]! * heightScale,
        z * spacing - ((verticesZ - 1) * spacing) / 2,
      ], index * 3);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < verticesZ - 1; z += 1) {
    for (let x = 0; x < verticesX - 1; x += 1) {
      const a = z * verticesX + x;
      indices.push(a, a + verticesX, a + 1, a + 1, a + verticesX, a + verticesX + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const group = new Group();
  group.add(new Mesh(geometry, new MeshBasicMaterial()));
  group.position.set(...source.position);
  group.rotation.set(0, (source.rotation[1] * Math.PI) / 180, 0);
  group.updateMatrixWorld(true);
  return group;
}

function terrainOf(object: LandscapeObject) {
  const mesh = object.children.find((child) => terrainRendererOf(child));
  const terrain = mesh ? terrainRendererOf(mesh) : null;
  assert.ok(terrain, "expected a CDLOD terrain mesh");
  return terrain;
}

function nodeRects(object: LandscapeObject, extentX: number, extentZ: number): number[][] {
  const geometry = terrainOf(object).mesh.geometry as InstancedBufferGeometry;
  const a = geometry.getAttribute("terrainNodeA") as BufferAttribute;
  return Array.from({ length: geometry.instanceCount }, (_, index) => [
    a.getX(index), a.getY(index),
    Math.min(a.getX(index) + a.getZ(index), extentX), Math.min(a.getY(index) + a.getZ(index), extentZ),
  ]);
}

/** Nodes as terrain-local rectangles clipped to the authored grid must tile it exactly once. */
function assertNodesTileGrid(object: LandscapeObject, extentX: number, extentZ: number): void {
  const rects = nodeRects(object, extentX, extentZ);
  let area = 0;
  for (const [x0, z0, x1, z1] of rects) {
    assert.ok(x1! > x0! && z1! > z0!, "nodes start inside the authored grid");
    area += (x1! - x0!) * (z1! - z0!);
  }
  assert.ok(Math.abs(area - extentX * extentZ) < 1e-6 * extentX * extentZ, `node area ${area} != ${extentX * extentZ}`);
  const samples = random(3);
  for (let probe = 0; probe < 200; probe += 1) {
    const px = samples() * extentX;
    const pz = samples() * extentZ;
    const covering = rects.filter(([x0, z0, x1, z1]) => px >= x0! && px < x1! && pz >= z0! && pz < z1!).length;
    assert.equal(covering, 1, `point ${px},${pz} covered ${covering} times`);
  }
}

export function registerTerrainRendererTests(check: Check): void {
  check("terrain renderer: any grid is drawn in the next power-of-two square of at least one patch", () => {
    const grid = (x: number, z: number) => terrainRenderGrid({ verticesX: x, verticesZ: z }).stride;
    assert.equal(grid(65, 65), 65);
    assert.equal(grid(257, 257), 257);
    assert.equal(grid(100, 100), 129);
    assert.equal(grid(129, 65), 129);
    assert.equal(grid(70, 200), 257);
    assert.equal(grid(17, 17), 33);
    assert.throws(() => terrainRenderGrid({ verticesX: 1, verticesZ: 9 }), /at least 2/);
  });

  check("terrain renderer: padding repeats the authored edge; normals match the clamped edge formula", () => {
    const data = hillyData(100, 73, 1.25);
    const grid = terrainRenderGrid(data.size);
    const heights = new Float32Array(grid.stride * grid.stride);
    copyLandscapeHeights(data, grid, heights, fullTerrainRect(grid));
    const authored = (x: number, z: number) =>
      data.heights[Math.min(Math.max(z, 0), 72) * 100 + Math.min(Math.max(x, 0), 99)]!;
    for (const [x, z] of [[0, 0], [99, 0], [99, 72], [128, 72], [50, 128], [128, 128], [110, 10]] as const) {
      assert.equal(heights[z * grid.stride + x], Math.fround(authored(x, z)), `texel ${x},${z}`);
    }
    const normals = new Float32Array(grid.stride * grid.stride * 2);
    computeTerrainNormals(heights, grid.stride, data.size.spacing, normals, fullTerrainRect(grid));
    for (let z = 0; z < 73; z += 6) {
      for (let x = 0; x < 100; x += 7) {
        const dx = authored(x - 1, z) - authored(x + 1, z);
        const dz = authored(x, z - 1) - authored(x, z + 1);
        const length = Math.sqrt(dx * dx + 4 * 1.25 * 1.25 + dz * dz);
        const index = (z * grid.stride + x) * 2;
        assert.ok(Math.abs(normals[index]! - dx / length) < 1e-5);
        assert.ok(Math.abs(normals[index + 1]! - dz / length) < 1e-5);
      }
    }
  });

  check("terrain renderer: weights pack block-major RGBA8 at the padded stride, clamped, layers past eight dropped", () => {
    const data = createFlatLandscapeData("small");
    const grid = terrainRenderGrid(data.size);
    const size = data.size.verticesX;
    data.layers = Array.from({ length: 9 }, (_, layer) => ({
      id: `l${layer}`, name: `L${layer}`, weights: new Array(size * size).fill(layer === 0 ? 1.5 : layer / 10),
    }));
    const out = new Uint8Array(grid.stride * grid.stride * 4 * 2);
    packTerrainWeights(data, grid, out, fullTerrainRect(grid));
    const texel = 3 * grid.stride + 5;
    assert.deepEqual([...out.subarray(texel * 4, texel * 4 + 4)], [255, 26, 51, 77]);
    const second = (grid.stride * grid.stride + texel) * 4;
    assert.deepEqual([...out.subarray(second, second + 4)], [102, 128, 153, 179]);
  });

  check("terrain renderer: node height bounds equal brute force after partial updates", () => {
    const size = 129;
    const heights = new Float32Array(size * size);
    const next = random(11);
    for (let index = 0; index < heights.length; index += 1) heights[index] = next() * 10;
    const bounds = new TerrainNodeHeightBounds(heights, size, 32);
    const brute = (level: number, ix: number, iz: number) => {
      const span = 32 * 2 ** level;
      let min = Infinity;
      let max = -Infinity;
      for (let z = iz * span; z <= Math.min((iz + 1) * span, size - 1); z += 1) {
        for (let x = ix * span; x <= Math.min((ix + 1) * span, size - 1); x += 1) {
          min = Math.min(min, heights[z * size + x]!);
          max = Math.max(max, heights[z * size + x]!);
        }
      }
      return { min, max };
    };
    for (let round = 0; round < 20; round += 1) {
      const x0 = Math.floor(next() * size);
      const z0 = Math.floor(next() * size);
      const rect = { x0, z0, x1: Math.min(size - 1, x0 + Math.floor(next() * 40)), z1: Math.min(size - 1, z0 + Math.floor(next() * 40)) };
      for (let z = rect.z0; z <= rect.z1; z += 1) {
        for (let x = rect.x0; x <= rect.x1; x += 1) heights[z * size + x] = (next() - 0.5) * 50;
      }
      bounds.update(rect);
      for (let level = 0; level <= 2; level += 1) {
        const n = 4 >> level;
        for (let iz = 0; iz < n; iz += 1) {
          for (let ix = 0; ix < n; ix += 1) {
            const expected = brute(level, ix, iz);
            const actual = bounds.node(level, ix, iz);
            assert.equal(actual.min, Math.fround(expected.min));
            assert.equal(actual.max, Math.fround(expected.max));
          }
        }
      }
      assert.deepEqual(bounds.node(9, 0, 0), bounds.range());
    }
  });

  check("terrain renderer: selected nodes tile the authored grid once from any camera", () => {
    for (const [verticesX, verticesZ] of [[257, 257], [100, 73]] as const) {
      const data = hillyData(verticesX, verticesZ);
      const object = build(item(data, 30));
      const extentX = (verticesX - 1) * data.size.spacing;
      const extentZ = (verticesZ - 1) * data.size.spacing;
      const camera = new PerspectiveCamera();
      const next = random(5);
      for (let round = 0; round < 25; round += 1) {
        camera.position.set((next() - 0.5) * extentX * 3, next() * 300, (next() - 0.5) * extentZ * 3);
        camera.updateMatrixWorld(true);
        updateLandscapeLod(object, camera);
        assertNodesTileGrid(object, extentX, extentZ);
      }
      // A camera on the surface sees full resolution: level-0 nodes are one patch.
      camera.position.set(3, 10, 5);
      camera.updateMatrixWorld(true);
      updateLandscapeLod(object, camera);
      const sizes = nodeRects(object, Infinity, Infinity).map(([x0, , x1]) => x1! - x0!);
      assert.equal(Math.min(...sizes), 32 * data.size.spacing);
      disposeLandscapeObject(object);
    }
  });

  check("terrain renderer: raycasts hit the authored surface, and nothing past its edge", () => {
    for (const [verticesX, verticesZ, rotationY] of [[129, 129, 0], [129, 129, 37], [100, 73, 21]] as const) {
      const source = item(hillyData(verticesX, verticesZ, 1.25), rotationY);
      const reach = Math.max(verticesX, verticesZ) * 1.25 * 1.5;
      const reference = referenceMesh(source);
      const terrain = build(source);
      const raycaster = new Raycaster();
      const next = random(verticesX + rotationY);
      let hits = 0;
      let misses = 0;
      for (let ray = 0; ray < 200; ray += 1) {
        // Aim past the edges too: those rays must miss both surfaces.
        const target = new Vector3((next() - 0.5) * reach, 0, (next() - 0.5) * reach).add(new Vector3(3, -2, 5));
        const origin = target.clone().add(new Vector3((next() - 0.5) * 80, 40 + next() * 60, (next() - 0.5) * 80));
        raycaster.set(origin, target.clone().sub(origin).normalize());
        const expected = raycaster.intersectObject(reference, true)[0];
        const actual = raycaster.intersectObject(terrain, true)[0];
        assert.equal(Boolean(actual), Boolean(expected), `ray ${ray} hit mismatch (${verticesX}x${verticesZ})`);
        if (!expected || !actual) {
          misses += 1;
          continue;
        }
        hits += 1;
        assert.ok(actual.point.distanceTo(expected.point) < 1e-3, `ray ${ray}: ${actual.point.toArray()} vs ${expected.point.toArray()}`);
        assert.ok(Math.abs(actual.distance - expected.distance) < 1e-3);
        assert.ok(actual.face!.normal.angleTo(expected.face!.normal) < 1e-3);
        assert.ok(terrainRendererOf(actual.object));
      }
      assert.ok(hits > 50 && misses > 20, `${hits} hits / ${misses} misses`);
      disposeLandscapeObject(terrain);
    }
  });

  check("terrain renderer: an edit updates the raycast surface and the bounding box", () => {
    const data = createFlatLandscapeData("small");
    const object = build(item(data));
    const mesh = terrainOf(object).mesh;
    assert.equal(mesh.geometry.boundingBox!.max.y, 0);
    const size = data.size.verticesX;
    data.heights[32 * size + 32] = 12;
    updateLandscapeObjectGeometry(object, data, { x0: 32, x1: 32, z0: 32, z1: 32 });
    assert.equal(mesh.geometry.boundingBox!.max.y, 12);
    const raycaster = new Raycaster(new Vector3(3, 50, 5), new Vector3(0, -1, 0));
    const hit = raycaster.intersectObject(object, true)[0];
    assert.ok(hit && Math.abs(hit.point.y - (12 - 2)) < 1e-4, `peak hit at ${hit?.point.y}`);
    // An edge edit refreshes the padding too, so the height bounds stay exact.
    data.heights[size * size - 1] = -9;
    updateLandscapeObjectGeometry(object, data, { x0: size - 1, x1: size - 1, z0: size - 1, z1: size - 1 });
    assert.equal(mesh.geometry.boundingBox!.min.y, -9);
    disposeLandscapeObject(object);
  });
}
