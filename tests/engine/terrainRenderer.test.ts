import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type InstancedBufferGeometry,
} from "three";
import {
  createWorldTerrainObject,
  disposeLandscapeObject,
  updateLandscapeLod,
  updateWorldTerrainObjectTiles,
  type LandscapeObject,
} from "../../engine/render-three/landscape";
import { setTerrainFarTiling, setTerrainSelfShadow, terrainRendererOf, withTerrainCullingSuspended } from "../../engine/render-three/terrain/terrainRenderer";
import type { WorldTerrainDocument } from "../../engine/terrain/terrainLoader";
import { TerrainNodeHeightBounds, computeTerrainNormals } from "../../engine/terrain/terrainRenderData";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** World-space hills plus per-vertex noise, so normals and LOD bounds are not trivial. */
function hillHeight(x: number, z: number, next: () => number): number {
  return 6 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + next() * 0.4;
}

/**
 * A World Terrain of hills centred on (3, -2, 5). Shared seam vertices get the
 * same height in both tiles, as a saved terrain has.
 */
function hillyTerrain(tilesX: number, tilesZ: number, tileQuads: number, spacing = 1.5, seed = 7): WorldTerrainDocument {
  const extentX = tilesX * tileQuads * spacing;
  const extentZ = tilesZ * tileQuads * spacing;
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Hills", tileQuads, spacing, tilesX, tilesZ,
    origin: [3 - extentX / 2, -2, 5 - extentZ / 2], heightMin: -64, heightMax: 64,
    layers: [{ id: "grass", name: "Grass", color: "#5f9449" }], tiles: [], collision: true,
  };
  const next = random(seed);
  const columns = tilesX * tileQuads + 1;
  const global = new Float32Array(columns * (tilesZ * tileQuads + 1));
  for (let index = 0; index < global.length; index += 1) global[index] = hillHeight(index % columns, Math.floor(index / columns), next);
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < tilesZ; tz += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const tile = createFlatTerrainTile(def, tx, tz);
      for (let z = 0; z <= tileQuads; z += 1) {
        for (let x = 0; x <= tileQuads; x += 1) {
          tile.heights[z * (tileQuads + 1) + x] = global[(tz * tileQuads + z) * columns + tx * tileQuads + x]!;
        }
      }
      tiles.set(tileKey(tx, tz), tile);
      def.tiles.push({ key: tileKey(tx, tz), minHeight: -64, maxHeight: 64 });
    }
  }
  return { def, tiles };
}

function build(document: WorldTerrainDocument): LandscapeObject {
  const object = createWorldTerrainObject({ name: "Landscape", collision: true, hidden: false, document });
  object.updateMatrixWorld(true);
  return object;
}

/**
 * Independent reference surface: every tile as an ordinary world-space mesh,
 * split along the same b–c diagonal as the collider.
 */
function referenceMesh({ def, tiles }: WorldTerrainDocument): Group {
  const group = new Group();
  const size = def.tileQuads + 1;
  for (const tile of tiles.values()) {
    const positions = new Float32Array(size * size * 3);
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = z * size + x;
        positions.set([
          def.origin[0] + (tile.x * def.tileQuads + x) * def.spacing,
          def.origin[1] + tile.heights[index]!,
          def.origin[2] + (tile.z * def.tileQuads + z) * def.spacing,
        ], index * 3);
      }
    }
    const indices: number[] = [];
    for (let z = 0; z < size - 1; z += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const a = z * size + x;
        indices.push(a, a + size, a + 1, a + 1, a + size, a + size + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    group.add(new Mesh(geometry, new MeshBasicMaterial()));
  }
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
  check("terrain renderer: normals match the clamped central-difference formula, edges included", () => {
    const size = 65, spacing = 1.25;
    const next = random(7);
    const heights = Float32Array.from({ length: size * size }, (_, index) => hillHeight(index % size, Math.floor(index / size), next));
    const normals = new Float32Array(size * size * 2);
    computeTerrainNormals(heights, size, spacing, normals, { x0: 0, x1: size - 1, z0: 0, z1: size - 1 });
    const at = (x: number, z: number) => heights[Math.min(Math.max(z, 0), size - 1) * size + Math.min(Math.max(x, 0), size - 1)]!;
    for (let z = 0; z < size; z += 6) {
      for (let x = 0; x < size; x += 7) {
        const dx = at(x - 1, z) - at(x + 1, z);
        const dz = at(x, z - 1) - at(x, z + 1);
        const length = Math.sqrt(dx * dx + 4 * spacing * spacing + dz * dz);
        const index = (z * size + x) * 2;
        assert.ok(Math.abs(normals[index]! - dx / length) < 1e-5);
        assert.ok(Math.abs(normals[index + 1]! - dz / length) < 1e-5);
      }
    }
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
    for (const [tilesX, tilesZ, tileQuads] of [[1, 1, 256], [3, 2, 64]] as const) {
      const document = hillyTerrain(tilesX, tilesZ, tileQuads);
      const object = build(document);
      const extentX = tilesX * tileQuads * document.def.spacing;
      const extentZ = tilesZ * tileQuads * document.def.spacing;
      const camera = new PerspectiveCamera();
      const next = random(5);
      for (let round = 0; round < 25; round += 1) {
        camera.position.set((next() - 0.5) * extentX * 3, next() * 300, (next() - 0.5) * extentZ * 3);
        camera.updateMatrixWorld(true);
        updateLandscapeLod(object, camera);
        // The view cull keeps a subset; unculled, the same camera's LOD covers it all.
        withTerrainCullingSuspended(() => assertNodesTileGrid(object, extentX, extentZ));
      }
      // A camera on the surface sees full resolution: level-0 nodes are one patch.
      camera.position.set(3, 10, 5);
      camera.lookAt(extentX / 2, 0, extentZ / 2);
      camera.updateMatrixWorld(true);
      updateLandscapeLod(object, camera);
      const sizes = nodeRects(object, Infinity, Infinity).map(([x0, , x1]) => x1! - x0!);
      assert.equal(Math.min(...sizes), 32 * document.def.spacing);
      disposeLandscapeObject(object);
    }
  });

  check("terrain renderer: the view frustum culls nodes behind the camera and re-selects on a turn", () => {
    const document = hillyTerrain(3, 2, 64);
    const object = build(document);
    const extentX = 3 * 64 * document.def.spacing;
    const extentZ = 2 * 64 * document.def.spacing;
    const [ox, oy, oz] = document.def.origin;
    // Camera placement in terrain-local X/Z (node rects are local).
    const place = (x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number) => {
      camera.position.set(ox + x, oy + y, oz + z);
      camera.lookAt(ox + lookX, oy + lookY, oz + lookZ);
      camera.updateMatrixWorld(true);
      updateLandscapeLod(object, camera);
      return nodeRects(object, extentX, extentZ);
    };
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 20000);
    const [cx, cz] = [extentX / 2, extentZ / 2];
    const ahead = place(cx, 20, cz, cx, 20, cz - 1);
    const all = withTerrainCullingSuspended(() => nodeRects(object, extentX, extentZ));
    assert.ok(ahead.length > 0 && ahead.length < all.length, `${ahead.length} culled of ${all.length}`);
    assert.ok(ahead.every(([, z0]) => z0! < cz), "nothing wholly behind the camera");
    // The capture pass's unculled selection is only borrowed.
    updateLandscapeLod(object, camera);
    assert.equal(nodeRects(object, extentX, extentZ).length, ahead.length);

    // A turn alone (no move) re-selects.
    const behind = place(cx, 20, cz, cx, 20, cz + 1);
    assert.ok(behind.length > 0 && behind.every(([, , , z1]) => z1! > cz), "the turn shows the other half");

    // Pitched down, the nodes past the screen's top edge stay for a lake to reflect.
    const down = place(cx, 60, extentZ, cx, 0, extentZ - 40);
    assert.ok(down.some(([, z0]) => z0! < extentZ / 4), "far slopes above the view are kept");
    disposeLandscapeObject(object);
  });

  check("terrain renderer: self-shadow keeps the nodes inside a shadow frustum the view does not see; quality hooks toggle", () => {
    const document = hillyTerrain(3, 2, 64);
    const object = build(document);
    const terrain = terrainOf(object);
    const extentX = 3 * 64 * document.def.spacing;
    const extentZ = 2 * 64 * document.def.spacing;
    const [ox, oy, oz] = document.def.origin;
    const [cx, cz] = [extentX / 2, extentZ / 2];
    assert.equal(terrain.mesh.castShadow, true, "the page default casts");
    assert.ok(terrain.mesh.customDepthMaterial, "the shadow pass draws the displaced surface");
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 20000);
    camera.position.set(ox + cx, oy + 20, oz + cz);
    camera.lookAt(ox + cx, oy + 20, oz + cz - 1);
    camera.updateMatrixWorld(true);
    // A sun straight overhead whose 40 m box sits behind the camera.
    const sun = new DirectionalLight();
    sun.castShadow = true;
    sun.position.set(ox + cx, oy + 200, oz + cz + 60);
    sun.target.position.set(ox + cx, oy, oz + cz + 60);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    const behindInBox = (rects: number[][]) => rects.some(([x0, z0, x1, z1]) =>
      z0! >= cz && x0! < cx + 20 && x1! > cx - 20 && z0! < cz + 80 && z1! > cz + 40);
    updateLandscapeLod(object, camera, [sun]);
    assert.ok(behindInBox(nodeRects(object, extentX, extentZ)), "the shadow box's nodes stay");
    updateLandscapeLod(object, camera);
    assert.ok(!behindInBox(nodeRects(object, extentX, extentZ)), "without the light only the view's do");

    setTerrainSelfShadow(false);
    try {
      assert.equal(terrain.mesh.castShadow, false);
      updateLandscapeLod(object, camera, [sun]);
      assert.ok(!behindInBox(nodeRects(object, extentX, extentZ)), "a terrain that casts nothing ignores shadow frusta");
    } finally {
      setTerrainSelfShadow(true);
    }
    assert.equal(terrain.mesh.castShadow, true);

    // The far tiling break is a program switch: a define, toggled page-wide.
    const lit = terrain.mesh.material as { defines?: Record<string, unknown>; version: number };
    assert.equal(lit.defines?.FORGE_TERRAIN_FAR_TILING, 1);
    const version = lit.version;
    setTerrainFarTiling(false);
    try {
      assert.equal(lit.defines?.FORGE_TERRAIN_FAR_TILING, undefined);
      assert.ok(lit.version > version, "the lit program recompiles");
    } finally {
      setTerrainFarTiling(true);
    }
    assert.equal(lit.defines?.FORGE_TERRAIN_FAR_TILING, 1);
    disposeLandscapeObject(object);
  });

  check("terrain renderer: raycasts hit the authored surface, and nothing past its edge", () => {
    for (const [tilesX, tilesZ, tileQuads] of [[1, 1, 128], [3, 2, 64]] as const) {
      const document = hillyTerrain(tilesX, tilesZ, tileQuads, 1.25, tilesX * 31 + tileQuads);
      const reach = Math.max(tilesX, tilesZ) * tileQuads * 1.25 * 1.5;
      const reference = referenceMesh(document);
      const terrain = build(document);
      const raycaster = new Raycaster();
      const next = random(tilesX + tileQuads);
      let hits = 0;
      let misses = 0;
      for (let ray = 0; ray < 200; ray += 1) {
        // Aim past the edges too: those rays must miss both surfaces.
        const target = new Vector3((next() - 0.5) * reach, 0, (next() - 0.5) * reach).add(new Vector3(3, -2, 5));
        const origin = target.clone().add(new Vector3((next() - 0.5) * 80, 40 + next() * 60, (next() - 0.5) * 80));
        raycaster.set(origin, target.clone().sub(origin).normalize());
        const expected = raycaster.intersectObject(reference, true)[0];
        const actual = raycaster.intersectObject(terrain, true)[0];
        assert.equal(Boolean(actual), Boolean(expected), `ray ${ray} hit mismatch (${tilesX}x${tilesZ})`);
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
    const document = hillyTerrain(1, 1, 64);
    const tile = document.tiles.get("0_0")!;
    tile.heights.fill(0);
    const object = build(document);
    const mesh = terrainOf(object).mesh;
    assert.equal(mesh.geometry.boundingBox!.max.y, 0);
    const size = tile.size;
    tile.heights[32 * size + 32] = 12;
    updateWorldTerrainObjectTiles(object, new Map([["0_0", { x0: 32, x1: 32, z0: 32, z1: 32 }]]));
    assert.equal(mesh.geometry.boundingBox!.max.y, 12);
    const raycaster = new Raycaster(new Vector3(3, 50, 5), new Vector3(0, -1, 0));
    const hit = raycaster.intersectObject(object, true)[0];
    assert.ok(hit && Math.abs(hit.point.y - (12 - 2)) < 1e-4, `peak hit at ${hit?.point.y}`);
    // An edge edit keeps the height bounds exact.
    tile.heights[size * size - 1] = -9;
    updateWorldTerrainObjectTiles(object, new Map([["0_0", { x0: size - 1, x1: size - 1, z0: size - 1, z1: size - 1 }]]));
    assert.equal(mesh.geometry.boundingBox!.min.y, -9);
    disposeLandscapeObject(object);
  });
}
