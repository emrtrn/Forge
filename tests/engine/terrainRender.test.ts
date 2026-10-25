import assert from "node:assert/strict";
import {
  Box3, BufferAttribute, BufferGeometry, Color, Frustum, Group, Matrix3, Matrix4,
  Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, ShaderLib, Vector2, Vector3,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from "three";
import { buildTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMap";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { TerrainLodSelector } from "../../engine/terrain/terrainLod";
import {
  landscapeRenderSource, terrainSourceQueryDef, TerrainWorldHeightBounds, worldTerrainRenderSource,
} from "../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, terrainTileLayerWeight, tileKey, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import { TerrainTexturePool } from "../../engine/render-three/terrain/terrainTexturePool";
import { TerrainRenderer, terrainRendererOf } from "../../engine/render-three/terrain/terrainRenderer";
import type { TerrainUniforms } from "../../engine/render-three/terrain/terrainMaterial";
import { createLandscapeObject, disposeLandscapeObject, resolveLandscape, updateLandscapeObjectGeometry } from "../../engine/render-three/landscape";
import type { LayoutLandscape } from "../../engine/scene/layout";
import { EditorSelectionOutline } from "../../src/scene/editorSelectionOutline";

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

function makeTerrain(data: ForgeLandscapeData): TerrainRenderer {
  const source = landscapeRenderSource(data);
  return new TerrainRenderer(source, {
    origin: new Vector3(-source.extent[0] / 2, 0, -source.extent[1] / 2),
    viewMode: "lit", activeLayer: 0, layers: [{ color: "#5d7f3a", texture: null, scale: 1 }],
  });
}

function placedTerrain(data: ForgeLandscapeData, rotation: [number, number, number]): { group: Group; terrain: TerrainRenderer } {
  const terrain = makeTerrain(data);
  const group = new Group();
  group.add(terrain.mesh);
  group.position.set(3, 1.5, -2);
  group.rotation.set(...rotation.map((v) => v * Math.PI / 180) as [number, number, number]);
  group.updateMatrixWorld(true);
  return { group, terrain };
}

function uniformsOf(terrain: TerrainRenderer): TerrainUniforms {
  return (terrain as unknown as { materials: { uniforms: TerrainUniforms } }).materials.uniforms;
}

/** Cloud renderer cases ported to the streaming/deformation renderer retained at integration. */
export function registerTerrainRenderTests(check: Check): void {
  check("terrain render source: legacy footprint, scaled vertices and padded edges survive integration", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const tile = source.tile(0, 0)!;
    assert.equal(source.tileQuads, 128);
    assert.deepEqual(source.extent, [32, 48]);
    assert.equal(tile.size, 129);
    for (const [x, z] of [[0, 0], [64, 0], [0, 96], [64, 96], [31, 47], [7, 90]] as const) {
      const height = terrainHeightAt(terrainSourceQueryDef(source), source, x * 0.5, z * 0.5)!;
      assert.ok(Math.abs(height - data.heights[z * 65 + x]! * 2) < 1e-5);
    }
    assert.equal(tile.heights[50 * 129 + 100], tile.heights[50 * 129 + 64]);
    assert.equal(tile.heights[120 * 129 + 10], tile.heights[96 * 129 + 10]);
    assert.equal(tile.heights[128 * 129 + 128], tile.heights[96 * 129 + 64]);
  });

  check("terrain render source: six painted layers quantize and ninth layers stay outside the GPU format", () => {
    const data = legacyData();
    const tile = landscapeRenderSource(data).tile(0, 0)!;
    assert.equal(tile.weights.length, 2 * 129 * 129 * 4);
    for (const [x, z] of [[0, 0], [13, 22], [64, 96]] as const) {
      for (let layer = 0; layer < 6; layer += 1) {
        assert.equal(terrainTileLayerWeight(tile, layer, z * 129 + x), Math.round(data.layers[layer]!.weights[z * 65 + x]! * 255) / 255);
      }
    }
    data.layers.push(...[6, 7, 8].map((index) => ({ id: `layer${index}`, name: `L${index}`, weights: new Array(65 * 97).fill(0.5) })));
    assert.equal(landscapeRenderSource(data).tile(0, 0)!.layerCount, 8);
  });

  check("terrain render source: an edited corner refreshes padding and conservative height bounds", () => {
    const data = legacyData();
    const source = landscapeRenderSource(data);
    const bounds = new TerrainWorldHeightBounds(source);
    data.heights[20 * 65 + 11] = 40;
    const interior = { x0: 10, x1: 12, z0: 20, z1: 21 };
    assert.deepEqual(source.refresh(interior), interior);
    bounds.updateTile("0_0", interior);
    data.heights[96 * 65 + 64] = -9;
    data.layers[0]!.weights[96 * 65 + 64] = 1;
    const rect = source.refresh({ x0: 60, x1: 64, z0: 94, z1: 96 });
    assert.deepEqual(rect, { x0: 60, x1: 128, z0: 94, z1: 128 });
    const tile = source.tile(0, 0)!;
    assert.equal(tile.heights[128 * 129 + 128], -18);
    assert.equal(terrainTileLayerWeight(tile, 0, 128 * 129 + 128), 1);
    bounds.updateTile("0_0", rect);
    assert.equal(bounds.range().max, 80);
  });

  check("terrain render source: a sparse World Terrain retains world queries, holes and invalidated bounds", () => {
    const def = worldDef(3, 2, 6);
    const tiles = new Map([["0_0", createFlatTerrainTile(def, 0, 0, 4)], ["2_1", createFlatTerrainTile(def, 2, 1, -3)]]);
    def.tiles = [{ key: "0_0", minHeight: 4, maxHeight: 4 }, { key: "2_1", minHeight: -3, maxHeight: -3 }];
    const source = worldTerrainRenderSource(def, tiles);
    assert.deepEqual(source.extent, [192, 128]);
    assert.equal(terrainHeightAt(def, source, -30, 20), 9);
    assert.equal(terrainHeightAt(def, source, 50, 20), null);
    const bounds = new TerrainWorldHeightBounds(source);
    assert.deepEqual(bounds.node(0, 0, 0), { min: 4, max: 4 });
    assert.deepEqual(bounds.range(), { min: -3, max: 4 });
    tiles.get("0_0")!.heights[5] = 30;
    assert.deepEqual(bounds.node(0, 0, 0), { min: 4, max: 4 });
    bounds.updateTile("0_0", { x0: 5, x1: 5, z0: 0, z1: 0 });
    assert.deepEqual(bounds.node(0, 0, 0), { min: 4, max: 30 });
  });

  check("terrain LOD: clipped legacy extent still tiles the footprint with track-detail refinement", () => {
    const source = landscapeRenderSource(legacyData(65, 97, 1, 1));
    const bounds = new TerrainWorldHeightBounds(source);
    const selector = new TerrainLodSelector(terrainSourceQueryDef(source), (l, x, z) => bounds.node(l, x, z), { extent: source.extent });
    assert.deepEqual([selector.extentX, selector.extentZ], [64, 96]);
    for (const camera of [[0, 10, 0], [-200, 50, 300], [31, 2, 47]] as const) {
      for (const detail of [null, { minX: 0, minZ: 0, maxX: 64, maxZ: 96, levels: 2 }]) {
        const nodes = selector.select(camera, undefined, detail);
        let area = 0;
        for (const { box } of nodes) {
          assert.ok(box.minX >= 0 && box.maxX <= 64 && box.minZ >= 0 && box.maxZ <= 96);
          assert.ok(box.maxX > box.minX && box.maxZ > box.minZ);
          area += (box.maxX - box.minX) * (box.maxZ - box.minZ);
        }
        assert.equal(area, 64 * 96);
        if (detail && camera[0] === 0) assert.ok(nodes.some((node) => node.level < 0));
      }
    }
    for (const extent of [[0, 10], [NaN, 10], [Infinity, 10]] as const) {
      assert.throws(() => new TerrainLodSelector(terrainSourceQueryDef(source), () => ({ min: 0, max: 0 }), { extent }), /extent/);
    }
    const camera = new PerspectiveCamera(90, 1, 0.1, 5000);
    camera.position.set(32, 1, 300); camera.lookAt(32, 1, 5000); camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = (box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) =>
      frustum.intersectsBox(new Box3(new Vector3(box.minX, box.minY, box.minZ), new Vector3(box.maxX, box.maxY, box.maxZ)));
    assert.equal(selector.select([32, 1, 300], visible).length, 0);
  });
  check("terrain texture pool: tiles upload into slot layers and cached slots skip the copy", () => {
    const def = worldDef(2, 1, 5);
    const a = createFlatTerrainTile(def, 0, 0, 1);
    const b = createFlatTerrainTile(def, 1, 0, 2);
    b.weights[(33 * 33 + 7) * 4 + 1] = 99; // weight block 1, channel 1
    const tiles = new Map([[tileKey(0, 0), a], [tileKey(1, 0), b]]);
    const source = worldTerrainRenderSource(def, tiles);
    const global = buildTerrainGlobalMap(def, source, 32);
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
    const source = worldTerrainRenderSource(def, new Map([[tileKey(0, 0), tile]]));
    const pool = new TerrainTexturePool(33, 1, 0, buildTerrainGlobalMap(def, source, 32));
    assert.equal(pool.weightBlocks, 1);
    (pool.weights.image.data as Uint8Array).fill(5);
    pool.acquire(tile);
    assert.ok((pool.weights.image.data as Uint8Array).every((value) => value === 0));
    pool.dispose();
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

  check("terrain renderer: padded margins and raycaster far do not produce false picks", () => {
    const { group, terrain } = placedTerrain(legacyData(65, 97, 1, 1), [0, 0, 0]);
    const ray = new Raycaster(new Vector3(43, 50, -2), new Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(group, true).length, 0);
    ray.set(new Vector3(3, 50, -2), new Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(group, true).length, 1);
    ray.far = 10;
    assert.equal(ray.intersectObject(group, true).length, 0);
    terrain.dispose();
  });

  check("terrain renderer: cloud edit cases retain sculpt bounds, shader views and displaced pass materials", () => {
    const data = legacyData(65, 65, 1, 1);
    const source = landscapeRenderSource(data);
    const terrain = new TerrainRenderer(source, { origin: new Vector3(-32, 0, -32), viewMode: "lit", activeLayer: 0, layers: [] });
    data.heights[10 * 65 + 10] = 99;
    terrain.updateTile("0_0", source.refresh({ x0: 10, x1: 10, z0: 10, z1: 10 }));
    assert.equal(terrain.mesh.geometry.boundingBox!.max.y, 99);
    const uniforms = uniformsOf(terrain);
    assert.equal((uniforms.uTerrainHeightRange!.value as Vector2).y, 99);
    const box = new Box3().setFromObject(terrain.mesh);
    assert.deepEqual([box.min.x, box.max.x, box.min.z, box.max.z], [-32, 32, -32, 32]);
    const materials = (terrain as unknown as { materials: { material: MeshBasicMaterial; normalMaterial: MeshBasicMaterial; depthMaterial: MeshBasicMaterial } }).materials;
    for (const material of [materials.material, materials.normalMaterial, materials.depthMaterial]) {
      const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      assert.doesNotMatch(shader.vertexShader, /#include <begin_vertex>/);
      assert.match(shader.vertexShader, /forgeTerrainHeight/);
    }
    terrain.setAppearance("layer", 5, ["#123456"]);
    assert.equal(uniforms.uTerrainView!.value, 3);
    assert.equal(uniforms.uTerrainActiveLayer!.value, 5);
    assert.equal((uniforms.uLayerColors!.value as Color[])[0]!.getHexString(), "123456");
    terrain.dispose();
  });

  check("landscape binding: cloud sculpt and tint cases retain the actor and dispose spline geometry", () => {
    const data = legacyData(65, 65, 1, 1);
    data.layers = data.layers.slice(0, 4).map((layer, index) => ({ ...layer, id: ["grass", "dirt", "rock", "snow"][index]! }));
    const actor = { id: "land", name: "Hills", position: [10, 2, 0], rotation: [0, 90, 0], dataRef: "x.landscape.json" } as unknown as LayoutLandscape;
    const group = createLandscapeObject({ ...resolveLandscape(actor), position: [10, 2, 0], rotation: [0, 90, 0], data, viewMode: "lit", activeLayerId: "rock", layerColors: { dirt: "#123456" } });
    group.updateMatrixWorld(true);
    const terrain = terrainRendererOf(group.children[0]!)!;
    assert.equal(group.children.length, 1);
    assert.equal(terrain.mesh.name, "landscape-terrain");
    const uniforms = uniformsOf(terrain);
    assert.equal((uniforms.uLayerColors!.value as Color[])[1]!.getHexString(), "123456");
    const ray = new Raycaster(new Vector3(10, 50, 0), new Vector3(0, -1, 0));
    const before = ray.intersectObject(group, true)[0]!;
    data.heights[32 * 65 + 32] = 20;
    updateLandscapeObjectGeometry(group, data, { x0: 31, x1: 33, z0: 31, z1: 33 }, "layer", "snow");
    const after = ray.intersectObject(group, true)[0]!;
    assert.ok(Math.abs(after.point.y - 22) < 1e-4);
    assert.notEqual(before.point.y, after.point.y);
    assert.equal(uniforms.uTerrainView!.value, 3);
    assert.equal(uniforms.uTerrainActiveLayer!.value, 3);
    const child = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    let disposed = false;
    child.geometry.addEventListener("dispose", () => { disposed = true; });
    group.add(child);
    disposeLandscapeObject(group);
    assert.ok(disposed);
  });

  check("selection outline: GPU terrain patches are excluded while spline meshes keep their proxies", () => {
    const terrain = makeTerrain(legacyData(65, 65));
    const invisible = new MeshBasicMaterial({ colorWrite: false });
    // Exercise the real clone method without constructing a WebGL post-process pipeline.
    const outline = Object.create(EditorSelectionOutline.prototype) as EditorSelectionOutline;
    Object.assign(outline, { invisibleMaterial: invisible });
    const group = new Group(); group.add(terrain.mesh);
    assert.equal(outline.cloneRenderableMeshes(group), null);
    const spline = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    group.add(spline);
    const proxy = outline.cloneRenderableMeshes(group)!;
    assert.equal(proxy.children.length, 1);
    assert.equal((proxy.children[0] as Mesh).geometry, spline.geometry);
    assert.equal((proxy.children[0] as Mesh).material, invisible);
    terrain.dispose(); spline.geometry.dispose(); spline.material.dispose(); invisible.dispose();
  });
}
