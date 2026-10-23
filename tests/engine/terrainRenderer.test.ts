import assert from "node:assert/strict";
import { Mesh, PerspectiveCamera, Raycaster, Vector3, type BufferAttribute, type InstancedBufferGeometry } from "three";
import {
  createLandscapeObject,
  disposeLandscapeObject,
  landscapeRendererModeFromQuery,
  setLandscapeRendererMode,
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
  fullTerrainRect,
  isCdlodRenderableSize,
  packTerrainWeights,
} from "../../engine/terrain/terrainRenderData";

type Check = (label: string, fn: () => void) => void;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Rolling hills plus noise, so normals and LOD bounds are not trivial. */
function hillyData(preset: "small" | "medium" | "large", spacing = 1.5, seed = 7): ForgeLandscapeData {
  const data = createFlatLandscapeData(preset);
  data.size.spacing = spacing;
  const next = random(seed);
  const size = data.size.verticesX;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      data.heights[z * size + x] = 6 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + next() * 0.4;
    }
  }
  return data;
}

function item(data: ForgeLandscapeData, rotationY = 0): LandscapeRenderItem {
  return {
    id: "land", name: "Landscape", collision: true, hidden: false,
    position: [3, -2, 5], rotation: [0, rotationY, 0], data,
  } as LandscapeRenderItem;
}

function build(mode: "cdlod" | "legacy", source: LandscapeRenderItem): LandscapeObject {
  setLandscapeRendererMode(mode);
  try {
    const object = createLandscapeObject(source);
    object.updateMatrixWorld(true);
    return object;
  } finally {
    setLandscapeRendererMode("cdlod");
  }
}

function terrainOf(object: LandscapeObject) {
  const mesh = object.children.find((child) => terrainRendererOf(child));
  const terrain = mesh ? terrainRendererOf(mesh) : null;
  assert.ok(terrain, "expected a CDLOD terrain mesh");
  return terrain;
}

/** Nodes as terrain-local squares, clipped to the grid; must tile it exactly once. */
function assertNodesTileGrid(object: LandscapeObject, extent: number): void {
  const geometry = terrainOf(object).mesh.geometry as InstancedBufferGeometry;
  const a = geometry.getAttribute("terrainNodeA") as BufferAttribute;
  let area = 0;
  const samples = random(3);
  const rects: number[][] = [];
  for (let index = 0; index < geometry.instanceCount; index += 1) {
    const x0 = a.getX(index);
    const z0 = a.getY(index);
    const size = a.getZ(index);
    const x1 = Math.min(x0 + size, extent);
    const z1 = Math.min(z0 + size, extent);
    assert.ok(x1 > x0 && z1 > z0, "nodes start inside the grid");
    area += (x1 - x0) * (z1 - z0);
    rects.push([x0, z0, x1, z1]);
  }
  assert.ok(Math.abs(area - extent * extent) < 1e-6 * extent * extent, `node area ${area} != ${extent * extent}`);
  for (let probe = 0; probe < 200; probe += 1) {
    const px = samples() * extent;
    const pz = samples() * extent;
    const covering = rects.filter(([x0, z0, x1, z1]) => px >= x0! && px < x1! && pz >= z0! && pz < z1!).length;
    assert.equal(covering, 1, `point ${px},${pz} covered ${covering} times`);
  }
}

export function registerTerrainRendererTests(check: Check): void {
  check("terrain renderer: only square power-of-two grids of at least one patch use CDLOD", () => {
    const size = (verticesX: number, verticesZ = verticesX, spacing = 1) => ({ verticesX, verticesZ, spacing, heightScale: 1 });
    assert.equal(isCdlodRenderableSize(size(65)), true);
    assert.equal(isCdlodRenderableSize(size(257)), true);
    assert.equal(isCdlodRenderableSize(size(33)), true);
    assert.equal(isCdlodRenderableSize(size(17)), false);
    assert.equal(isCdlodRenderableSize(size(100)), false);
    assert.equal(isCdlodRenderableSize(size(129, 65)), false);
    assert.equal(isCdlodRenderableSize(size(129, 129, 0)), false);
    assert.equal(landscapeRendererModeFromQuery("?editor&terrainRenderer=legacy"), "legacy");
    assert.equal(landscapeRendererModeFromQuery("?editor"), "cdlod");

    const legacy = createFlatLandscapeData("small");
    legacy.size.verticesX = 100;
    legacy.size.verticesZ = 100;
    legacy.heights = new Array(100 * 100).fill(0);
    legacy.layers = [];
    const fallback = build("cdlod", item(legacy));
    assert.equal(fallback.children.some((child) => terrainRendererOf(child)), false);
    assert.ok(fallback.children.every((child) => child.name === "landscape-chunk"));
    disposeLandscapeObject(fallback);
  });

  check("terrain renderer: normals match the legacy chunk mesh's per-vertex normals", () => {
    const data = hillyData("small");
    const legacy = build("legacy", item(data));
    const size = data.size.verticesX;
    const heights = Float32Array.from(data.heights);
    const normals = new Float32Array(size * size * 2);
    computeTerrainNormals(heights, size, data.size.spacing, normals, fullTerrainRect(size));
    const half = ((size - 1) * data.size.spacing) / 2;
    let compared = 0;
    for (const chunk of legacy.children as Mesh[]) {
      const position = chunk.geometry.getAttribute("position");
      const normal = chunk.geometry.getAttribute("normal");
      for (let index = 0; index < position.count; index += 1) {
        const x = Math.round((position.getX(index) + half) / data.size.spacing);
        const z = Math.round((position.getZ(index) + half) / data.size.spacing);
        const vertex = z * size + x;
        assert.ok(Math.abs(normal.getX(index) - normals[vertex * 2]!) < 1e-5);
        assert.ok(Math.abs(normal.getZ(index) - normals[vertex * 2 + 1]!) < 1e-5);
        compared += 1;
      }
    }
    assert.ok(compared >= size * size);
    disposeLandscapeObject(legacy);
  });

  check("terrain renderer: weights pack block-major RGBA8, clamped, layers past eight dropped", () => {
    const data = createFlatLandscapeData("small");
    const size = data.size.verticesX;
    data.layers = Array.from({ length: 9 }, (_, layer) => ({
      id: `l${layer}`, name: `L${layer}`, weights: new Array(size * size).fill(layer === 0 ? 1.5 : layer / 10),
    }));
    const out = new Uint8Array(size * size * 4 * 2);
    packTerrainWeights(data, out, fullTerrainRect(size));
    const vertex = 3 * size + 5;
    assert.deepEqual([...out.subarray(vertex * 4, vertex * 4 + 4)], [255, 26, 51, 77]);
    const second = (size * size + vertex) * 4;
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

  check("terrain renderer: selected nodes tile the whole grid once from any camera", () => {
    const data = hillyData("large");
    const object = build("cdlod", item(data, 30));
    const extent = (data.size.verticesX - 1) * data.size.spacing;
    const camera = new PerspectiveCamera();
    const next = random(5);
    let finest = Infinity;
    for (let round = 0; round < 25; round += 1) {
      camera.position.set((next() - 0.5) * extent * 3, next() * 300, (next() - 0.5) * extent * 3);
      camera.updateMatrixWorld(true);
      updateLandscapeLod(object, camera);
      assertNodesTileGrid(object, extent);
      const geometry = terrainOf(object).mesh.geometry as InstancedBufferGeometry;
      finest = Math.min(finest, (geometry.getAttribute("terrainNodeA") as BufferAttribute).getZ(0));
    }
    // A camera on the surface sees full resolution: level-0 nodes are one patch.
    camera.position.set(3, 10, 5);
    camera.updateMatrixWorld(true);
    updateLandscapeLod(object, camera);
    const a = (terrainOf(object).mesh.geometry as InstancedBufferGeometry).getAttribute("terrainNodeA") as BufferAttribute;
    const sizes = Array.from({ length: (terrainOf(object).mesh.geometry as InstancedBufferGeometry).instanceCount }, (_, i) => a.getZ(i));
    assert.equal(Math.min(...sizes), 32 * data.size.spacing);
    assert.ok(finest <= 32 * data.size.spacing * 2);
    disposeLandscapeObject(object);
  });

  check("terrain renderer: raycasts hit the same surface point and normal as the legacy mesh", () => {
    const data = hillyData("medium", 1.25);
    for (const rotationY of [0, 37]) {
      const legacy = build("legacy", item(data, rotationY));
      const cdlod = build("cdlod", item(data, rotationY));
      const raycaster = new Raycaster();
      const next = random(rotationY + 1);
      let hits = 0;
      for (let ray = 0; ray < 150; ray += 1) {
        const target = new Vector3((next() - 0.5) * 150, 0, (next() - 0.5) * 150).add(new Vector3(3, -2, 5));
        const origin = target.clone().add(new Vector3((next() - 0.5) * 80, 40 + next() * 60, (next() - 0.5) * 80));
        raycaster.set(origin, target.clone().sub(origin).normalize());
        const expected = raycaster.intersectObject(legacy, true)[0];
        const actual = raycaster.intersectObject(cdlod, true)[0];
        assert.equal(Boolean(actual), Boolean(expected), `ray ${ray} hit mismatch`);
        if (!expected || !actual) continue;
        hits += 1;
        assert.ok(actual.point.distanceTo(expected.point) < 1e-3, `ray ${ray}: ${actual.point.toArray()} vs ${expected.point.toArray()}`);
        assert.ok(Math.abs(actual.distance - expected.distance) < 1e-3);
        assert.ok(actual.face!.normal.angleTo(expected.face!.normal) < 1e-3);
        assert.ok(terrainRendererOf(actual.object));
      }
      assert.ok(hits > 100, `only ${hits} rays hit`);
      disposeLandscapeObject(legacy);
      disposeLandscapeObject(cdlod);
    }
  });

  check("terrain renderer: an edit updates the raycast surface and the bounding box", () => {
    const data = createFlatLandscapeData("small");
    const object = build("cdlod", item(data));
    const mesh = terrainOf(object).mesh;
    assert.equal(mesh.geometry.boundingBox!.max.y, 0);
    const size = data.size.verticesX;
    data.heights[32 * size + 32] = 12;
    updateLandscapeObjectGeometry(object, data, { x0: 32, x1: 32, z0: 32, z1: 32 });
    assert.equal(mesh.geometry.boundingBox!.max.y, 12);
    const raycaster = new Raycaster(new Vector3(3, 50, 5), new Vector3(0, -1, 0));
    const hit = raycaster.intersectObject(object, true)[0];
    assert.ok(hit && Math.abs(hit.point.y - (12 - 2)) < 1e-4, `peak hit at ${hit?.point.y}`);
    disposeLandscapeObject(object);
  });
}
