import assert from "node:assert/strict";
import {
  Box3, BufferAttribute, BufferGeometry, Color, DataTexture, Frustum, Group, Matrix3, Matrix4,
  DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, ShaderLib, Vector2, Vector3,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from "three";
import { buildTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMap";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { TerrainLodSelector } from "../../engine/terrain/terrainLod";
import {
  terrainSourceQueryDef, TerrainWorldHeightBounds, worldTerrainRenderSource, type TerrainRenderSource,
} from "../../engine/terrain/terrainRenderSource";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { TerrainTexturePool } from "../../engine/render-three/terrain/terrainTexturePool";
import { TerrainRenderer, terrainRendererOf } from "../../engine/render-three/terrain/terrainRenderer";
import { TERRAIN_LIT_FIXED_SAMPLERS, terrainLitFragmentSamplers, type TerrainUniforms } from "../../engine/render-three/terrain/terrainMaterial";
import {
  createWorldTerrainObject, disposeLandscapeObject, resolveLandscape, updateWorldTerrainAppearance, updateWorldTerrainObjectTiles,
} from "../../engine/render-three/landscape";
import type { LayoutLandscape } from "../../engine/scene/layout";
import { EditorSelectionOutline } from "../../src/scene/editorSelectionOutline";
import { SunCascadeShadow } from "../../engine/render-three/sunCascadeShadow";

type Check = (label: string, fn: () => void) => void;

/** A filled RGBA8 data texture, readable by the layer-array packer without a canvas. */
function rgbaTexture(width: number, height: number, rgba: readonly number[]): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  const texture = new DataTexture(data, width, height);
  texture.needsUpdate = true;
  return texture;
}

/** A one-tile World Terrain with six paint layers and relief, its origin at (0, 0, 0). */
function reliefTerrain(size = 65, spacing = 0.5, heightScale = 2): { def: WorldTerrainDef; tile: TerrainTileData; source: TerrainRenderSource } {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Relief", tileQuads: size - 1, spacing, tilesX: 1, tilesZ: 1,
    origin: [0, 0, 0], heightMin: -64, heightMax: 64,
    layers: Array.from({ length: 6 }, (_, layer) => ({ id: `layer${layer}`, name: `Layer ${layer}`, color: "#808080" })),
    tiles: [{ key: "0_0", minHeight: -64, maxHeight: 64 }], collision: true,
  };
  const tile = createFlatTerrainTile(def, 0, 0);
  for (let index = 0; index < size * size; index += 1) {
    const x = index % size;
    const z = Math.floor(index / size);
    tile.heights[index] = (Math.sin(x / 7) * 3 + Math.cos(z / 5) * 2 + x * 0.01) * heightScale;
  }
  return { def, tile, source: worldTerrainRenderSource(def, new Map([["0_0", tile]])) };
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
 * centred on the actor, cells split a,c,b / b,c,d.
 */
function legacyChunkMesh({ def, tile }: ReturnType<typeof reliefTerrain>, rotation: [number, number, number]): Mesh {
  const verticesX = tile.size, verticesZ = tile.size, spacing = def.spacing;
  const positions = new Float32Array(verticesX * verticesZ * 3);
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) {
      const index = z * verticesX + x;
      positions.set([x * spacing - ((verticesX - 1) * spacing) / 2, tile.heights[index]!, z * spacing - ((verticesZ - 1) * spacing) / 2], index * 3);
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

function makeTerrain({ source }: ReturnType<typeof reliefTerrain>): TerrainRenderer {
  return new TerrainRenderer(source, {
    origin: new Vector3(-source.extent[0] / 2, 0, -source.extent[1] / 2),
    viewMode: "lit", activeLayer: 0, layers: [{ color: "#5d7f3a", texture: null, scale: 1 }],
  });
}

function placedTerrain(data: ReturnType<typeof reliefTerrain>, rotation: [number, number, number]): { group: Group; terrain: TerrainRenderer } {
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

  check("terrain LOD: a 2×3 tile extent tiles the footprint with track-detail refinement and frustum culling", () => {
    const def: WorldTerrainDef = { ...worldDef(2, 3), tileQuads: 32, spacing: 1, origin: [0, 0, 0] };
    const tiles = new Map<string, TerrainTileData>();
    for (let z = 0; z < 3; z += 1) for (let x = 0; x < 2; x += 1) {
      tiles.set(tileKey(x, z), createFlatTerrainTile(def, x, z));
      def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
    }
    const source = worldTerrainRenderSource(def, tiles);
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
    const data = reliefTerrain(65, 0.5, 2);
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
    const { group, terrain } = placedTerrain(reliefTerrain(65, 1, 1), [0, 0, 0]);
    const ray = new Raycaster(new Vector3(43, 50, -2), new Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(group, true).length, 0);
    ray.set(new Vector3(3, 50, -2), new Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(group, true).length, 1);
    ray.far = 10;
    assert.equal(ray.intersectObject(group, true).length, 0);
    terrain.dispose();
  });

  check("terrain renderer: cloud edit cases retain sculpt bounds, shader views and displaced pass materials", () => {
    const { tile, source } = reliefTerrain(65, 1, 1);
    const terrain = new TerrainRenderer(source, { origin: new Vector3(-32, 0, -32), viewMode: "lit", activeLayer: 0, layers: [] });
    tile.heights[10 * 65 + 10] = 99;
    terrain.updateTile("0_0", { x0: 10, x1: 10, z0: 10, z1: 10 });
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

  check("terrain renderer: the paint layers share one array sampler, as the cascade budget counts", () => {
    // Normals ×2, weights ×2, track field, shared water array and connected Lake faces.
    assert.equal(TERRAIN_LIT_FIXED_SAMPLERS, 7);
    const { source } = reliefTerrain(65, 1, 1);
    const compile = (material: MeshBasicMaterial, renderer: WebGLRenderer) => {
      const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, renderer);
      return shader;
    };
    for (const layerCount of [1, 5, 8]) {
      for (const textured of [false, true]) {
        const layers = Array.from({ length: layerCount }, (_, index) => ({
          texture: textured ? rgbaTexture(4, 4, [index * 30, 0, 0, 255]) : null,
          color: `#${(index + 1).toString(16).repeat(6)}`,
          scale: 1,
        }));
        const terrain = new TerrainRenderer(source, { origin: new Vector3(), viewMode: "lit", activeLayer: 0, layers });
        const material = (terrain as unknown as { materials: { material: MeshBasicMaterial } }).materials.material;
        const shader = compile(material, {} as WebGLRenderer);
        // 16 units (three's default when the renderer is unknown) keep the water path at any layer count.
        assert.equal(shader.defines?.FORGE_TERRAIN_WATER, 1, `${layerCount} layers, textured ${textured}`);
        // three's own samplers sit behind #includes; every sampler line here is the terrain's.
        const own = shader.fragmentShader.match(/^uniform\s+(?:\w+\s+)?sampler\w*\s/gm) ?? [];
        assert.equal(own.length, terrainLitFragmentSamplers(textured), `${layerCount} layers, textured ${textured}`);
        assert.equal(terrain.litFragmentSamplers, textured ? 8 : 7);
        assert.equal(material.customProgramCacheKey(), `forge-terrain-cdlod-l${textured ? 1 : 0}`, "the layer count is not part of the program");
        assert.ok(!/uLayerTex\d/.test(shader.fragmentShader), "no per-layer samplers");
        if (textured) {
          assert.ok(shader.fragmentShader.includes(`texture(uLayerTexArray, vec3(forgeP * uLayerScale[${layerCount - 1}], uLayerTexIndex[${layerCount - 1}]))`));
          assert.equal((shader.uniforms.uLayerTexArray!.value as { image: { depth: number } }).image.depth, layerCount);
        } else {
          assert.ok(!shader.fragmentShader.includes("uLayerTexArray"));
          assert.ok(shader.fragmentShader.includes("vec4 forgeS0 = vec4(uLayerColors[0], 1.0);"));
        }
        terrain.dispose();
      }
    }
  });

  check("terrain caustics: micro-normal array and cascaded shadow patches compose and release together", () => {
    const texture = rgbaTexture(2, 2, [128, 180, 240, 255]);
    const terrain = new TerrainRenderer(reliefTerrain(65).source, {
      origin: new Vector3(), viewMode: "lit", activeLayer: 0, layers: [{ texture: null, normalTexture: texture, color: "#aaaaaa", scale: 1 }],
    });
    const materials = (terrain as any).materials;
    assert.equal(materials.normalArray.colorSpace, "");
    assert.equal(terrain.litFragmentSamplers, terrainLitFragmentSamplers(false, true));
    const scene = new Scene(), sun = new DirectionalLight(), camera = new PerspectiveCamera(60, 1.5, 0.1, 1000);
    sun.position.set(20, 50, 20); camera.position.set(0, 50, 60); camera.lookAt(0, 0, 0);
    scene.add(sun, sun.target, terrain.mesh); scene.updateMatrixWorld(true);
    const cascades = new SunCascadeShadow(scene);
    cascades.update({ sun, camera, count: 3, stagger: false, mapSize: 512, distance: 100 });
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as WebGLProgramParametersWithUniforms;
    materials.material.onBeforeCompile(shader, {} as WebGLRenderer);
    assert.ok(shader.uniforms.forgeSunShadowFade, "the terrain callback must leave the cascade include available");
    assert.ok(shader.uniforms.uLayerNormalArray);
    assert.match(shader.fragmentShader, /forgeSunShadow = forgeAccum \+ forgeRemaining/);
    assert.match(shader.fragmentShader, /#define getDirectionalLightInfo forgeCausticDirectionalLightInfo/);
    let disposed = 0; materials.normalArray.addEventListener("dispose", () => disposed++);
    terrain.dispose(); cascades.dispose(); texture.dispose(); assert.equal(disposed, 1);
  });

  check("landscape binding: cloud sculpt and tint cases retain the actor and dispose spline geometry", () => {
    const { def, tile } = reliefTerrain(65, 1, 1);
    def.origin = [-22, 2, -32];
    def.layers = def.layers.slice(0, 4).map((layer, index) => ({ ...layer, id: ["grass", "dirt", "rock", "snow"][index]! }));
    const document = { def, tiles: new Map([["0_0", tile]]) };
    const actor = { id: "land", name: "Hills", position: [10, 2, 0], dataRef: "x.terrain.json" } as unknown as LayoutLandscape;
    const group = createWorldTerrainObject({ ...resolveLandscape(actor), document, viewMode: "lit", activeLayerId: "rock", layerColors: { dirt: "#123456" } });
    group.updateMatrixWorld(true);
    const terrain = terrainRendererOf(group.children[0]!)!;
    assert.equal(group.children.length, 1);
    assert.equal(terrain.mesh.name, "landscape-terrain");
    const uniforms = uniformsOf(terrain);
    assert.equal((uniforms.uLayerColors!.value as Color[])[1]!.getHexString(), "123456");
    const ray = new Raycaster(new Vector3(10, 50, 0), new Vector3(0, -1, 0));
    const before = ray.intersectObject(group, true)[0]!;
    tile.heights[32 * 65 + 32] = 20;
    updateWorldTerrainObjectTiles(group, new Map([["0_0", { x0: 31, x1: 33, z0: 31, z1: 33 }]]));
    updateWorldTerrainAppearance(group, def.layers, "layer", "snow");
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
    const terrain = makeTerrain(reliefTerrain(65));
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
