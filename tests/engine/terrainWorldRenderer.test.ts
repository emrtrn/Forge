import assert from "node:assert/strict";
import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  DataArrayTexture,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type InstancedBufferGeometry,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { TerrainRenderer } from "../../engine/render-three/terrain/terrainRenderer";
import { encodeTerrainGlobalMap, validateTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import {
  TerrainWorldHeightBounds,
  buildTerrainGlobalAttributes,
  computeTileNormals,
  updateTerrainGlobalAttributes,
  worldTerrainRenderSource,
  type TerrainRenderSource,
} from "../../engine/terrain/terrainRenderSource";
import type { TerrainVertexRect } from "../../engine/terrain/terrainRenderData";
import { tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

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

type Mirror = Float32Array | Uint16Array | Uint8Array;
type TerrainTexture = DataTexture | DataArrayTexture;
const TEXTURES = ["Heights", "Normals", "Weights", "GlobalHeights", "GlobalNormals", "GlobalWeights"] as const;

function textures(terrain: TerrainRenderer): Record<string, TerrainTexture> {
  const shader = { uniforms: {}, vertexShader: "", fragmentShader: "" } as WebGLProgramParametersWithUniforms;
  terrain.mesh.material.onBeforeCompile(shader, undefined!);
  const { uniforms } = shader;
  return Object.fromEntries(TEXTURES.map((name) => [name, uniforms[`uTerrain${name}`]!.value as TerrainTexture]));
}

/** Records public copy requests and emulates their strided CPU data transfers. */
function uploadRecorder() {
  const properties = new Map<TerrainTexture, { __webglTexture: object; __version: number }>();
  const gpu = new Map<TerrainTexture, Mirror>();
  const copies: { texture: TerrainTexture; layer: number; rect: TerrainVertexRect; bytes: number }[] = [];
  const initialized: TerrainTexture[] = [];
  const fake = {
    properties: { get: (texture: TerrainTexture) => properties.get(texture) ?? {} },
    initTexture: (texture: TerrainTexture) => {
      initialized.push(texture);
      properties.set(texture, { __webglTexture: {}, __version: texture.version });
      gpu.set(texture, (texture.image.data as Mirror).slice());
    },
    copyTextureToTexture: (source: DataTexture, texture: TerrainTexture, region: Box3, position: Vector3) => {
      assert.ok(source.isDataTexture, "array destinations must use a CPU DataTexture source in r184");
      assert.ok(!properties.has(source), "the source descriptor must never be initialized on the GPU");
      assert.equal(source.format, texture.format);
      assert.equal(source.type, texture.type);
      const depth = texture instanceof DataArrayTexture ? texture.image.depth : 1;
      const channels = texture.image.data!.length / (texture.image.width * texture.image.height * depth);
      const width = region.max.x - region.min.x;
      const height = region.max.y - region.min.y;
      const data = source.image.data as Mirror;
      copies.push({ texture, layer: position.z, rect: {
        x0: position.x, x1: position.x + width - 1, z0: position.y, z1: position.y + height - 1,
      }, bytes: width * height * channels * data.BYTES_PER_ELEMENT });
      assert.equal(region.max.z - region.min.z, 1);
      for (let row = 0; row < height; row += 1) {
        const from = ((region.min.y + row) * source.image.width + region.min.x) * channels;
        const to = ((position.z * texture.image.height + position.y + row) * texture.image.width + position.x) * channels;
        gpu.get(texture)!.set(data.subarray(from, from + width * channels), to);
      }
    },
  } as unknown as WebGLRenderer;
  const flush = (terrain: TerrainRenderer) => terrain.mesh.onBeforeRender(fake, undefined!, undefined!, terrain.mesh.geometry, terrain.mesh.material, undefined!);
  const reset = () => { copies.length = 0; initialized.length = 0; };
  return { copies, initialized, properties, gpu, flush, reset };
}

function dabWorld(tilesX = 1, tilesZ = 1, hole = ""): TerrainRenderSource {
  const size = 257;
  const texels = size * size;
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < tilesZ; z += 1) {
    for (let x = 0; x < tilesX; x += 1) {
      if (tileKey(x, z) === hole) continue;
      const heights = new Float32Array(texels);
      const weights = new Uint8Array(texels * 8);
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          const gx = x * 256 + column;
          const gz = z * 256 + row;
          const index = row * size + column;
          heights[index] = heightAt(gx, gz);
          weights.set([120, gx % 100, gz % 100, 5], index * 4);
          weights.set([3, 4, 5, 6], (texels + index) * 4);
        }
      }
      tiles.set(tileKey(x, z), { x, z, size, heights, layerCount: 8, weights });
    }
  }
  return worldTerrainRenderSource({ tileQuads: 256, spacing: 1, tilesX, tilesZ }, tiles);
}

/** Edit the duplicated seam values too, as the world brush does before notifying renderers. */
function dab(source: TerrainRenderSource, rect: TerrainVertexRect): void {
  for (const key of source.keys()) {
    const [tx, tz] = key.split("_").map(Number) as [number, number];
    const tile = source.tile(tx, tz)!;
    for (let z = Math.max(rect.z0, tz * 256); z <= Math.min(rect.z1, (tz + 1) * 256); z += 1) {
      for (let x = Math.max(rect.x0, tx * 256); x <= Math.min(rect.x1, (tx + 1) * 256); x += 1) {
        const index = (z - tz * 256) * tile.size + x - tx * 256;
        tile.heights[index]! += 7;
        tile.weights[index * 4] = 10;
        tile.weights[(tile.size * tile.size + index) * 4] = 90;
      }
    }
  }
}

function assertRebuilt(terrain: TerrainRenderer, source: TerrainRenderSource, uploads: ReturnType<typeof uploadRecorder>): void {
  const rebuilt = renderer(source);
  const actual = textures(terrain);
  const expected = textures(rebuilt);
  for (const name of TEXTURES) {
    assert.deepEqual(actual[name]!.image.data, expected[name]!.image.data, `${name} CPU mirror matches full rebuild`);
    assert.deepEqual(uploads.gpu.get(actual[name]!), expected[name]!.image.data, `${name} uploaded regions match full rebuild`);
  }
  rebuilt.dispose();
}

function copyRegions(terrain: TerrainRenderer, uploads: ReturnType<typeof uploadRecorder>) {
  const names = new Map(Object.entries(textures(terrain)).map(([name, texture]) => [texture, name]));
  return uploads.copies.map(({ texture, ...copy }) => ({ name: names.get(texture), ...copy }));
}

export function registerTerrainWorldRendererTests(check: Check): void {
  check("terrain world: decoded global attributes produce identical renderer textures with a missing tile", () => {
    const tiles = worldTiles();
    const source = worldSource();
    const expected = buildTerrainGlobalAttributes(source);
    const def: WorldTerrainDef = {
      schema: 1, type: "worldTerrain", name: "World", tileQuads: Q, spacing: SPACING, tilesX: TILES_X, tilesZ: TILES_Z,
      origin: [0, 0, 0], heightMin: -100, heightMax: 100, collision: true,
      layers: Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, name: `Layer ${i}`, color: "#ffffff" })),
      tiles: [...tiles.keys()].map((key) => ({ key, minHeight: -100, maxHeight: 100 })),
    };
    const decoded = validateTerrainGlobalMap(def, encodeTerrainGlobalMap(def, expected));
    assert.deepEqual(decoded, expected);
    assert.ok(decoded.map.heights.some(Number.isNaN));
    const computed = renderer(source);
    const fromFile = renderer(worldTerrainRenderSource(def, tiles, decoded));
    const fromOption = new TerrainRenderer(source, {
      viewMode: "lit", activeLayer: 0, layers: [], origin: new Vector3(-10, 2, 5), globalAttributes: decoded,
    });
    try {
      const a = textures(computed);
      for (const terrain of [fromFile, fromOption]) {
        const b = textures(terrain);
        assert.equal(b.GlobalWeights!.image.data, decoded.weights, "precomputed attributes are used directly");
        for (const name of ["GlobalHeights", "GlobalNormals", "GlobalWeights"]) {
          assert.deepEqual(b[name]!.image, a[name]!.image, name);
        }
        terrain.updateLod(cameraAt(300, 200, 200));
        computed.updateLod(cameraAt(300, 200, 200));
        assert.deepEqual(nodes(terrain), nodes(computed));
      }
    } finally { computed.dispose(); fromFile.dispose(); fromOption.dispose(); }
  });

  check("terrain uploads: 257 squared interior dab copies only dirty regions and matches a rebuild", () => {
    const source = dabWorld();
    const terrain = renderer(source);
    const uploads = uploadRecorder();
    uploads.flush(terrain);
    assert.equal(uploads.initialized.length, 6, "first upload initializes all CPU mirrors");
    uploads.reset();
    const rect = { x0: 126, x1: 130, z0: 126, z1: 130 };
    dab(source, rect);
    terrain.updateTile("0_0", rect);
    assert.equal(uploads.copies.length, 0, "updates defer until rendering");
    uploads.flush(terrain);
    const normal = { x0: 125, x1: 131, z0: 125, z1: 131 };
    const sample = { x0: 8, x1: 8, z0: 8, z1: 8 };
    assert.deepEqual(copyRegions(terrain, uploads), [
      { name: "Heights", layer: 0, rect, bytes: 100 },
      { name: "Normals", layer: 0, rect: normal, bytes: 196 },
      { name: "Weights", layer: 0, rect, bytes: 100 },
      { name: "Weights", layer: 1, rect, bytes: 100 },
      { name: "GlobalHeights", layer: 0, rect: sample, bytes: 4 },
      { name: "GlobalNormals", layer: 0, rect: sample, bytes: 8 },
      { name: "GlobalWeights", layer: 0, rect: sample, bytes: 4 },
      { name: "GlobalWeights", layer: 1, rect: sample, bytes: 4 },
    ]);
    assert.equal(uploads.initialized.length, 0, "an editing dab never requests a full texture upload");
    const before = Object.values(textures(terrain)).reduce((sum, texture) => sum + texture.image.data!.byteLength, 0);
    const after = uploads.copies.reduce((sum, copy) => sum + copy.bytes, 0);
    assert.equal(before, 1_062_564);
    assert.equal(after, 516);
    console.log(`[terrain uploads] 257x257, 5x5 interior dab: whole-layer reference ${before} B -> dirty regions ${after} B`);
    assertRebuilt(terrain, source, uploads);
    uploads.reset();
    uploads.flush(terrain);
    assert.equal(uploads.copies.length, 0, "additional render passes do not repeat copies");
    terrain.dispose();
  });

  check("terrain uploads: seam dab copies the neighbour edge strip and matches a rebuild", () => {
    const source = dabWorld(2);
    const terrain = renderer(source);
    const uploads = uploadRecorder();
    uploads.flush(terrain);
    uploads.reset();
    const rect = { x0: 254, x1: 256, z0: 126, z1: 130 };
    dab(source, rect);
    terrain.updateTile("0_0", rect);
    uploads.flush(terrain);
    const copies = copyRegions(terrain, uploads);
    assert.deepEqual(copies.filter((copy) => copy.name === "Normals"), [
      { name: "Normals", layer: 0, rect: { x0: 253, x1: 256, z0: 125, z1: 131 }, bytes: 112 },
      { name: "Normals", layer: 1, rect: { x0: 0, x1: 1, z0: 125, z1: 131 }, bytes: 56 },
    ]);
    assert.deepEqual(copies.filter((copy) => copy.name === "Heights"), [
      { name: "Heights", layer: 0, rect, bytes: 60 },
      { name: "Heights", layer: 1, rect: { x0: 0, x1: 0, z0: 126, z1: 130 }, bytes: 20 },
    ]);
    assert.deepEqual(copies.filter((copy) => copy.name === "Weights"), [
      { name: "Weights", layer: 0, rect, bytes: 60 },
      { name: "Weights", layer: 1, rect, bytes: 60 },
      { name: "Weights", layer: 2, rect: { x0: 0, x1: 0, z0: 126, z1: 130 }, bytes: 20 },
      { name: "Weights", layer: 3, rect: { x0: 0, x1: 0, z0: 126, z1: 130 }, bytes: 20 },
    ]);
    assert.deepEqual(copies.filter((copy) => copy.name!.startsWith("Global")), [
      { name: "GlobalHeights", layer: 0, rect: { x0: 16, x1: 16, z0: 8, z1: 8 }, bytes: 4 },
      { name: "GlobalNormals", layer: 0, rect: { x0: 16, x1: 16, z0: 8, z1: 8 }, bytes: 8 },
      { name: "GlobalWeights", layer: 0, rect: { x0: 16, x1: 16, z0: 8, z1: 8 }, bytes: 4 },
      { name: "GlobalWeights", layer: 1, rect: { x0: 16, x1: 16, z0: 8, z1: 8 }, bytes: 4 },
    ]);
    const after = uploads.copies.reduce((sum, copy) => sum + copy.bytes, 0);
    const before = Object.values(textures(terrain)).reduce((sum, texture) => sum + texture.image.data!.byteLength, 0);
    assert.equal(before, 2_124_788);
    assert.equal(after, 428);
    console.log(`[terrain uploads] 257x257, 3x5 seam dab: whole-layer reference ${before} B -> dirty regions ${after} B`);
    assertRebuilt(terrain, source, uploads);
    terrain.dispose();
  });

  check("terrain uploads: seam normal reach, corner copies, batching and context recovery", () => {
    const source = dabWorld(2, 2);
    const terrain = renderer(source);
    const uploads = uploadRecorder();
    // Changes before first render are included in initialization, without redundant subcopies.
    const nearSeam = { x0: 255, x1: 255, z0: 128, z1: 128 };
    dab(source, nearSeam);
    terrain.updateTile("0_0", nearSeam);
    uploads.flush(terrain);
    assert.equal(uploads.copies.length, 0);
    assertRebuilt(terrain, source, uploads);
    uploads.reset();
    dab(source, nearSeam);
    terrain.updateTile("0_0", nearSeam);
    uploads.flush(terrain);
    assert.deepEqual(copyRegions(terrain, uploads).filter((copy) => copy.name === "Normals" && copy.layer === 1), [
      { name: "Normals", layer: 1, rect: { x0: 0, x1: 0, z0: 127, z1: 129 }, bytes: 12 },
    ]);
    assert.ok(!uploads.copies.some((copy) => copy.texture === textures(terrain).Heights && copy.layer === 1));
    assertRebuilt(terrain, source, uploads);
    uploads.reset();
    const corner = { x0: 255, x1: 256, z0: 255, z1: 256 };
    dab(source, corner);
    terrain.updateTile("0_0", corner);
    // Two dabs before drawing merge per texture layer, reading the latest mirror.
    dab(source, corner);
    terrain.updateTile("0_0", corner);
    uploads.flush(terrain);
    assert.equal(uploads.copies.filter((copy) => copy.texture === textures(terrain).Normals).length, 4);
    assertRebuilt(terrain, source, uploads);
    uploads.reset();
    dab(source, nearSeam);
    terrain.updateTile("0_0", nearSeam);
    uploads.properties.clear(); // Simulate WebGLRenderer's property reset on context restore.
    uploads.flush(terrain);
    assert.equal(uploads.initialized.length, 6);
    assert.equal(uploads.copies.length, 0);
    assertRebuilt(terrain, source, uploads);
    terrain.dispose();
  });

  check("terrain uploads: edits without global samples skip maps; hole fill stays identical", () => {
    const source = dabWorld(2, 2, "1_1");
    const terrain = renderer(source);
    const uploads = uploadRecorder();
    uploads.flush(terrain);
    uploads.reset();
    const between = { x0: 120, x1: 121, z0: 120, z1: 121 };
    dab(source, between);
    terrain.updateTile("0_0", between);
    uploads.flush(terrain);
    assert.ok(copyRegions(terrain, uploads).every((copy) => !copy.name!.startsWith("Global")));
    assertRebuilt(terrain, source, uploads);
    uploads.reset();
    const edge = { x0: 254, x1: 256, z0: 270, z1: 274 };
    dab(source, edge);
    terrain.updateTile("0_1", { x0: 254, x1: 256, z0: 14, z1: 18 });
    uploads.flush(terrain);
    const changedFill = copyRegions(terrain, uploads).find((copy) => copy.name === "GlobalHeights")!;
    assert.ok(changedFill.rect.x1 > 16 && changedFill.rect.z1 > 16, "hole filling propagates changed boundary heights");
    assertRebuilt(terrain, source, uploads);
    terrain.dispose();
  });

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
