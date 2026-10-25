import assert from "node:assert/strict";
import { buildTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMap";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { TerrainLodSelector } from "../../engine/terrain/terrainLod";
import {
  landscapeRenderSource,
  terrainRenderNodeHeights,
  terrainRenderSourceHeightRange,
  worldTerrainRenderSource,
  writeLandscapeRegion,
} from "../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, terrainTileLayerWeight, tileKey, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import { TerrainTexturePool } from "../../engine/render-three/terrain/terrainTexturePool";
import {
  Box3,
  Color,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Matrix3,
  PerspectiveCamera,
  Raycaster,
  ShaderLib,
  Texture,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { TerrainRenderer, createTerrainPatchGeometry, packTerrainNode } from "../../engine/render-three/terrain/terrainRenderer";
import type { TerrainLook } from "../../engine/render-three/terrain/terrainMaterial";
import {
  createLandscapeObject,
  disposeLandscapeObject,
  landscapeTerrainRenderer,
  resolveLandscape,
  updateLandscapeObjectGeometry,
} from "../../engine/render-three/landscape";
import type { LayoutLandscape } from "../../engine/scene/layout";


type Check = (label: string, fn: () => void) => void;

/** A non-square, non-power-of-two legacy grid with six paint layers and relief. */
function legacyData(verticesX = 65, verticesZ = 97, spacing = 0.5, heightScale = 2): ForgeLandscapeData {
  const count = verticesX * verticesZ;
  const heights = Array.from({ length: count }, (_, index) => {
    const x = index % verticesX;
    const z = Math.floor(index / verticesX);
    return Math.sin(x / 7) * 3 + Math.cos(z / 5) * 2 + x * 0.01;
  });
  const layers = Array.from({ length: 6 }, (_, layer) => ({
    id: `layer${layer}`,
    name: `Layer ${layer}`,
    weights: Array.from({ length: count }, (_, index) => ((index + layer) % 6) / 5),
  }));
  return {
    schema: 1,
    type: "landscape",
    size: { verticesX, verticesZ, spacing, heightScale },
    chunks: { quadsPerChunk: 32 },
    heights,
    layers,
  };
}

function worldDef(tilesX: number, tilesZ: number, layers = 2): WorldTerrainDef {
  return {
    schema: 1,
    type: "worldTerrain",
    name: "Render",
    tileQuads: 32,
    spacing: 2,
    tilesX,
    tilesZ,
    origin: [-40, 5, 12],
    heightMin: -64,
    heightMax: 64,
    layers: Array.from({ length: layers }, (_, index) => ({ id: `l${index}`, name: `L${index}`, color: "#808080" })),
    tiles: [],
    collision: true,
  };
}

export function registerTerrainRenderTests(check: Check): void {
  check("terrain render source: legacy grid pads into the next power-of-two tile around the actor", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    assert.equal(source.def.tileQuads, 128);
    assert.deepEqual([source.def.tilesX, source.def.tilesZ], [1, 1]);
    assert.deepEqual(source.def.origin, [-16, 0, -24]);
    assert.deepEqual([source.extentX, source.extentZ], [32, 48]);
    assert.equal(source.layerCount, 6);
    const tile = source.tiles.tile(0, 0)!;
    assert.equal(tile.size, 129);
    // Every authored vertex lands where the chunk mesh put it, heightScale folded in.
    for (const [x, z] of [[0, 0], [64, 0], [0, 96], [64, 96], [31, 47], [7, 90]] as const) {
      const expected = data.heights[z * 65 + x]! * 2;
      const height = terrainHeightAt(source.def, source.tiles, -16 + x * 0.5, -24 + z * 0.5)!;
      assert.ok(Math.abs(height - expected) < 1e-5, `vertex ${x},${z}: ${height} vs ${expected}`);
    }
    // Padding repeats the far edges, so clamped coarse vertices never see a cliff.
    assert.equal(tile.heights[50 * 129 + 100], tile.heights[50 * 129 + 64]);
    assert.equal(tile.heights[120 * 129 + 10], tile.heights[96 * 129 + 10]);
    assert.equal(tile.heights[128 * 129 + 128], tile.heights[96 * 129 + 64]);
  });

  check("terrain render source: legacy weights quantize into two RGBA8 blocks", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const tile = source.tiles.tile(0, 0)!;
    assert.equal(tile.weights.length, 2 * 129 * 129 * 4);
    for (const [x, z] of [[0, 0], [13, 22], [64, 96]] as const) {
      for (let layer = 0; layer < 6; layer += 1) {
        const expected = Math.round(data.layers[layer]!.weights[z * 65 + x]! * 255) / 255;
        assert.equal(terrainTileLayerWeight(tile, layer, z * 129 + x), expected);
      }
    }
    // A ninth layer is not drawn.
    const many = legacyData(65, 65);
    many.layers.push(...[6, 7, 8].map((index) => ({ id: `layer${index}`, name: `L${index}`, weights: new Array(65 * 65).fill(0.5) })));
    assert.equal(landscapeRenderSource(many).layerCount, 8);
  });

  check("terrain render source: region writes refresh the padding an edge edit drives", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const tile = source.tiles.tile(0, 0)!;
    const interior = { x0: 10, x1: 12, z0: 20, z1: 21 };
    data.heights[20 * 65 + 11] = 40;
    assert.deepEqual(writeLandscapeRegion(source, data, interior), interior);
    assert.equal(tile.heights[20 * 129 + 11], 80);
    data.heights[96 * 65 + 64] = -9;
    data.layers[0]!.weights[96 * 65 + 64] = 1;
    const rect = writeLandscapeRegion(source, data, { x0: 60, x1: 64, z0: 94, z1: 96 });
    assert.deepEqual(rect, { x0: 60, x1: 128, z0: 94, z1: 128 });
    assert.equal(tile.heights[128 * 129 + 128], -18);
    assert.equal(tile.heights[100 * 129 + 64], -18);
    assert.equal(terrainTileLayerWeight(tile, 0, 128 * 129 + 128), 1);
    // The cached raycast range follows the edit.
    assert.equal(terrainRenderSourceHeightRange(source).max, 80);
    assert.throws(() => writeLandscapeRegion(source, legacyData(65, 65), interior), /changed shape/);
  });

  check("terrain render source: World Terrain keeps its world frame and full extent", () => {
    const def = worldDef(3, 2, 6);
    const tiles = new Map([[tileKey(0, 0), createFlatTerrainTile(def, 0, 0, 4)], [tileKey(2, 1), createFlatTerrainTile(def, 2, 1, -3)]]);
    const source = worldTerrainRenderSource({ def, tiles });
    assert.deepEqual(source.def.origin, [-40, 5, 12]);
    assert.deepEqual([source.extentX, source.extentZ], [192, 128]);
    assert.equal(source.layerCount, 6);
    assert.equal(source.legacyGrid, undefined);
    assert.equal(terrainHeightAt(source.def, source.tiles, -30, 20), 9);
    assert.equal(terrainHeightAt(source.def, source.tiles, 50, 20), null, "hole");
    const heights = terrainRenderNodeHeights(source, 64);
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 4 });
    assert.deepEqual(heights(2, 0, 0), { min: -3, max: 4 });
    assert.deepEqual(heights(0, 1, 0), { min: 0, max: 0 }, "a hole contributes nothing");
    const tile = tiles.get(tileKey(0, 0))!;
    tile.heights[5] = 30;
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 4 }, "cached until invalidated");
    heights.invalidate(tile);
    assert.deepEqual(heights(0, 0, 0), { min: 4, max: 30 });
  });

  check("terrain LOD: an extent clips nodes to a padded legacy footprint", () => {
    const source = landscapeRenderSource(legacyData(65, 97, 1, 1));
    const heights = terrainRenderNodeHeights(source, 32);
    const selector = new TerrainLodSelector(source.def, heights, { extent: [source.extentX, source.extentZ] });
    assert.deepEqual([selector.extentX, selector.extentZ], [64, 96]);
    for (const camera of [[0, 10, 0], [-200, 50, 300], [31, 2, -47]] as const) {
      const nodes = selector.select(camera);
      let area = 0;
      for (const node of nodes) {
        assert.ok(node.box.minX >= -32 && node.box.maxX <= 32 && node.box.minZ >= -48 && node.box.maxZ <= 48, "inside the footprint");
        assert.ok(node.box.maxX > node.box.minX && node.box.maxZ > node.box.minZ, "no empty node");
        area += (node.box.maxX - node.box.minX) * (node.box.maxZ - node.box.minZ);
      }
      assert.equal(area, 64 * 96, "nodes tile the footprint exactly once");
    }
    assert.throws(() => new TerrainLodSelector(source.def, heights, { extent: [0, 10] }), /extent/);
  });

  check("terrain texture pool: tiles upload into slot layers and cached slots skip the copy", () => {
    const def = worldDef(2, 1, 5);
    const a = createFlatTerrainTile(def, 0, 0, 1);
    const b = createFlatTerrainTile(def, 1, 0, 2);
    b.weights[(33 * 33 + 7) * 4 + 1] = 99; // weight block 1, channel 1
    const tiles = new Map([[tileKey(0, 0), a], [tileKey(1, 0), b]]);
    const source = worldTerrainRenderSource({ def, tiles });
    const global = buildTerrainGlobalMap(source.def, source.tiles, 32);
    const pool = new TerrainTexturePool(33, 1, 5, global);
    assert.equal(pool.weightBlocks, 2);
    assert.equal(pool.globalHeights.image.width, global.width);
    assert.deepEqual(Array.from(pool.globalHeights.image.data as Float32Array), Array.from(global.heights));
    const heightData = pool.heights.image.data as Float32Array;
    const weightData = pool.weights.image.data as Uint8Array;

    assert.equal(pool.acquire(a), 0);
    assert.equal(heightData[100], 1);
    assert.deepEqual([...pool.heights.layerUpdates], [0]);
    assert.deepEqual([...pool.weights.layerUpdates], [0, 1]);
    assert.equal(pool.acquire(b), -1, "the only slot is active");
    pool.release(0, 0);
    assert.equal(pool.slotOf(0, 0), 0, "released data stays cached");
    assert.equal(pool.acquire(b), 0, "pressure evicts the released tile");
    assert.equal(pool.slotOf(0, 0), -1);
    assert.equal(heightData[100], 2);
    assert.equal(weightData[(33 * 33 + 7) * 4 + 1], 99, "second weight block lands in the slot's second layer");

    pool.heights.clearLayerUpdates();
    b.heights[34] = 7;
    b.heights[0] = 9;
    pool.update(b, { x0: 1, x1: 1, z0: 1, z1: 1 });
    assert.equal(heightData[34], 7);
    assert.equal(heightData[0], 2, "rect narrows the CPU copy");
    assert.deepEqual([...pool.heights.layerUpdates], [0]);
    pool.release(1, 0);
    assert.equal(pool.acquire(b), 0);
    assert.throws(() => pool.acquire(createFlatTerrainTile({ ...def, tileQuads: 64 }, 0, 0)), /pool holds 33/);
    pool.dispose();
  });

  check("terrain texture pool: an unpainted terrain still binds one zero weight layer per slot", () => {
    const def = worldDef(1, 1, 0);
    const tile = createFlatTerrainTile(def, 0, 0, 3);
    const source = worldTerrainRenderSource({ def, tiles: new Map([[tileKey(0, 0), tile]]) });
    const pool = new TerrainTexturePool(33, 1, 0, buildTerrainGlobalMap(source.def, source.tiles, 32));
    assert.equal(pool.weightBlocks, 1);
    (pool.weights.image.data as Uint8Array).fill(5);
    pool.acquire(tile);
    assert.ok((pool.weights.image.data as Uint8Array).every((value) => value === 0));
    pool.dispose();
  });
}

/**
 * The pre-Faz-2 chunk renderer's surface, rebuilt as one mesh: vertices
 * centred on the actor, heightScale applied, cells split a,c,b / b,c,d.
 */
function legacyChunkMesh(data: ForgeLandscapeData, rotation: [number, number, number]): Mesh {
  const { verticesX, verticesZ, spacing, heightScale } = data.size;
  const positions = new Float32Array(verticesX * verticesZ * 3);
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) {
      const index = z * verticesX + x;
      positions.set([x * spacing - ((verticesX - 1) * spacing) / 2, data.heights[index]! * heightScale, z * spacing - ((verticesZ - 1) * spacing) / 2], index * 3);
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
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.position.set(3, 1.5, -2);
  mesh.rotation.set((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180, "XYZ");
  mesh.updateMatrixWorld(true);
  return mesh;
}

const LOOK: TerrainLook = {
  viewMode: "lit",
  layers: [{ color: "#5d7f3a", texture: null, tiling: 8 }],
  activeLayer: 0,
  defaultColor: "#5d7f3a",
};

/** A legacy landscape drawn by the GPU renderer, placed like the chunk mesh under a rotated actor. */
function placedTerrain(data: ForgeLandscapeData, rotation: [number, number, number]): { group: Group; terrain: TerrainRenderer } {
  const terrain = new TerrainRenderer(landscapeRenderSource(data), LOOK);
  const group = new Group();
  group.add(terrain.mesh);
  group.position.set(3, 1.5, -2);
  group.rotation.set((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180, "XYZ");
  group.updateMatrixWorld(true);
  return { group, terrain };
}

export function registerTerrainRendererTests(check: Check): void {
  check("terrain renderer: patch and node packing match the shader's layout", () => {
    const geometry = createTerrainPatchGeometry(4);
    assert.equal(geometry.getAttribute("position").count, 25);
    assert.deepEqual(Array.from(geometry.index!.array.slice(0, 6)), [0, 5, 1, 1, 5, 6], "b–c diagonal like the collider");
    assert.equal(geometry.index!.count, 4 * 4 * 6);
    const data = new Float32Array(16);
    packTerrainNode(data, 1, 10, 20, 32, 2, -1, 0, 0);
    assert.deepEqual(Array.from(data.slice(8)), [10, 20, 32, 2, -1, 0, 0, 0]);
  });

  check("terrain renderer: raycasts hit the same points as the legacy chunk mesh under a rotated actor", () => {
    const data = legacyData(65, 97, 0.5, 2);
    const rotation: [number, number, number] = [0, 37, 0];
    const { group, terrain } = placedTerrain(data, rotation);
    const legacy = legacyChunkMesh(data, rotation);
    const raycaster = new Raycaster();
    let hits = 0;
    for (let index = 0; index < 60; index += 1) {
      const origin = new Vector3(3 + Math.sin(index * 1.7) * 14, 30, -2 + Math.cos(index * 2.3) * 20);
      const direction = new Vector3(Math.sin(index) * 0.4, -1, Math.cos(index * 0.7) * 0.4).normalize();
      raycaster.set(origin, direction);
      const expected = raycaster.intersectObject(legacy, true)[0];
      const actual = raycaster.intersectObject(group, true)[0];
      assert.equal(Boolean(actual), Boolean(expected), `ray ${index} hit/miss parity`);
      if (!actual || !expected) continue;
      hits += 1;
      assert.ok(actual.point.distanceTo(expected.point) < 1e-4, `ray ${index}: ${actual.point.toArray()} vs ${expected.point.toArray()}`);
      assert.ok(Math.abs(actual.distance - expected.distance) < 1e-4);
      assert.equal(actual.object, terrain.mesh);
      const actualNormal = actual.face!.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(terrain.mesh.matrixWorld));
      const expectedNormal = expected.face!.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(expected.object.matrixWorld));
      assert.ok(actualNormal.distanceTo(expectedNormal) < 1e-4, `ray ${index} face normal`);
    }
    assert.ok(hits > 25, `enough rays hit to compare (${hits})`);
    terrain.dispose();
    legacy.geometry.dispose();
  });

  check("terrain renderer: rays never hit the padded margin and respect raycaster far", () => {
    const data = legacyData(65, 97, 1, 1);
    const { group, terrain } = placedTerrain(data, [0, 0, 0]);
    const raycaster = new Raycaster(new Vector3(3 + 40, 50, -2), new Vector3(0, -1, 0));
    assert.equal(raycaster.intersectObject(group, true).length, 0, "x = +40 is inside the 128-quad tile but outside the 64 m footprint");
    raycaster.set(new Vector3(3, 50, -2), new Vector3(0, -1, 0));
    assert.equal(raycaster.intersectObject(group, true).length, 1);
    raycaster.far = 10;
    assert.equal(raycaster.intersectObject(group, true).length, 0);
    terrain.dispose();
  });

  check("terrain renderer: selection packs visible nodes over the footprint and slots single-tile nodes", () => {
    const data = legacyData(65, 97, 1, 1);
    const { terrain } = placedTerrain(data, [0, 0, 0]);
    const camera = new PerspectiveCamera(90, 1, 0.1, 5000);
    camera.position.set(3, 400, -2);
    camera.lookAt(3, 0, -2);
    camera.updateMatrixWorld(true);
    terrain.select(camera);
    assert.equal(terrain.mesh.geometry.instanceCount, terrain.stats.nodes);
    assert.ok(terrain.stats.nodes > 0);
    const nodes = terrain.nodeBuffer;
    let area = 0;
    for (let base = 0; base < nodes.length; base += 8) {
      const [x, z, size, , slot] = nodes.slice(base, base + 5);
      area += (Math.min(x! + size!, 64) - x!) * (Math.min(z! + size!, 96) - z!);
      assert.equal(slot, 0, "a 1×1 source always reads its tile");
    }
    assert.equal(area, 64 * 96);
    camera.lookAt(3, 0, 5000);
    camera.position.set(3, 1, 300);
    camera.updateMatrixWorld(true);
    terrain.select(camera);
    assert.equal(terrain.stats.nodes, 0, "a camera looking away culls every node");
    terrain.dispose();

    const def = worldDef(2, 2, 1);
    const tiles = new Map([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, z]) => [tileKey(x!, z!), createFlatTerrainTile(def, x!, z!, x! + z!)]));
    const world = new TerrainRenderer(worldTerrainRenderSource({ def, tiles }), LOOK);
    world.mesh.updateMatrixWorld(true);
    camera.position.set(-40 + 64, 5000, 12 + 64);
    camera.lookAt(-40 + 64, 0, 12 + 64);
    camera.updateMatrixWorld(true);
    world.select(camera);
    const far = world.nodeBuffer;
    assert.equal(far.length, 8, "from far away one root node covers the world");
    assert.equal(far[4], -1, "a node spanning tiles reads the global map");
    world.dispose();
  });

  check("terrain renderer: edits update bounds, the height view range and the global map", () => {
    const data = legacyData(65, 65, 1, 1);
    const source = landscapeRenderSource(data);
    const terrain = new TerrainRenderer(source, LOOK);
    data.heights[10 * 65 + 10] = 99;
    const rect = writeLandscapeRegion(source, data, { x0: 10, x1: 10, z0: 10, z1: 10 });
    terrain.updateTile(0, 0, rect);
    assert.equal(terrain.mesh.geometry.boundingBox!.max.y, 99);
    const uniforms = (terrain as unknown as { terrainMaterial: { uniforms: Record<string, { value: unknown }> } }).terrainMaterial.uniforms;
    assert.equal((uniforms.uTerrainHeightRange!.value as Vector2).y, 99);
    const box = new Box3().setFromObject(terrain.mesh);
    assert.deepEqual([box.min.x, box.max.x, box.min.z, box.max.z], [-32, 32, -32, 32]);
    terrain.dispose();
  });

  check("terrain material: shader injection replaces the standard chunks and keeps the look switchable", () => {
    const terrain = new TerrainRenderer(landscapeRenderSource(legacyData(65, 65, 1, 1)), LOOK);
    const material = terrain.material;
    const shader = {
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    assert.match(shader.vertexShader, /texelFetch\(uTerrainNodes/);
    assert.match(shader.vertexShader, /vec3 transformed = uTerrainOrigin/);
    assert.doesNotMatch(shader.vertexShader, /#include <begin_vertex>/);
    assert.match(shader.fragmentShader, /forgeTerrainNormal\(\)/);
    assert.match(shader.fragmentShader, /if \(vTerrainHole > 0.5\) discard;/);
    assert.ok(shader.uniforms.uTerrainHeights && shader.uniforms.uTerrainNodes && shader.uniforms.uLayerColor);
    assert.equal(material.defines!.TERRAIN_VIEW_MODE, "0");
    assert.equal(material.defines!.TERRAIN_SPLAT, undefined);
    const version = material.version;
    terrain.setLook({ ...LOOK, layers: [{ color: "#ffffff", texture: new Texture(), tiling: 4 }] });
    assert.equal(material.defines!.TERRAIN_SPLAT, "");
    assert.ok(material.version > version, "a define change recompiles");
    const splatVersion = material.version;
    terrain.setLook({ ...LOOK, layers: [{ color: "#000000", texture: new Texture(), tiling: 2 }] });
    assert.equal(material.version, splatVersion, "uniform-only changes do not recompile");
    terrain.setLook({ ...LOOK, viewMode: "layer", activeLayer: 3 });
    assert.equal(material.defines!.TERRAIN_VIEW_MODE, "3");
    assert.notEqual(material.customProgramCacheKey(), "");
    terrain.dispose();
  });

  check("landscape binding: the actor group wraps the GPU terrain and sculpt edits reach it", () => {
    const data = legacyData(65, 65, 1, 1);
    data.layers = data.layers.slice(0, 4).map((layer, index) => ({ ...layer, id: ["grass", "dirt", "rock", "snow"][index]! }));
    const actor = { id: "land", name: "Hills", position: [10, 2, 0], rotation: [0, 90, 0], dataRef: "x.landscape.json" } as unknown as LayoutLandscape;
    const group = createLandscapeObject({
      ...resolveLandscape(actor), position: [10, 2, 0], rotation: [0, 90, 0], data,
      viewMode: "lit", activeLayerId: "rock", layerColors: { dirt: "#123456" },
    });
    group.updateMatrixWorld(true);
    const terrain = landscapeTerrainRenderer(group)!;
    assert.equal(group.children.length, 1);
    assert.equal(group.children[0], terrain.mesh);
    assert.equal(terrain.mesh.name, "landscape-terrain");
    assert.ok(Math.abs(group.rotation.y - Math.PI / 2) < 1e-9);
    const uniforms = (terrain as unknown as { terrainMaterial: { uniforms: Record<string, { value: unknown }> } }).terrainMaterial.uniforms;
    const colors = uniforms.uLayerColor!.value as Color[];
    assert.equal(colors[1]!.getHexString(), "123456", "assigned-material tint by layer id");
    assert.equal(uniforms.uTerrainActiveLayer!.value, 2);

    const raycaster = new Raycaster(new Vector3(10, 50, 0), new Vector3(0, -1, 0));
    const before = raycaster.intersectObject(group, true)[0]!;
    data.heights[32 * 65 + 32] = 20;
    updateLandscapeObjectGeometry(group, data, { x0: 31, x1: 33, z0: 31, z1: 33 }, "layer", "snow");
    const after = raycaster.intersectObject(group, true)[0]!;
    assert.ok(Math.abs(after.point.y - (2 + 20)) < 1e-4, `sculpted vertex is hit: ${after.point.y}`);
    assert.notEqual(before.point.y, after.point.y);
    assert.equal(terrain.material.defines!.TERRAIN_VIEW_MODE, "3");
    assert.equal(uniforms.uTerrainActiveLayer!.value, 3);

    // A child parented by the editor (spline meshes) still gets its geometry freed.
    const child = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    let disposed = false;
    child.geometry.addEventListener("dispose", () => (disposed = true));
    group.add(child);
    disposeLandscapeObject(group);
    assert.ok(disposed);
    assert.equal(landscapeTerrainRenderer(group), null);
  });
}
