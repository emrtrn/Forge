import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { computeLandscapeSplineMeshInstances, resolveLandscapeSplineMeshChains } from "../../engine/scene/landscape";
import { prepareTerrainSplineMeshSource, terrainSplineMeshTileKeys } from "../../engine/terrain/terrainSplineMeshes";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { buildLandscapeSplineMeshGroup, disposeLandscapeSplineMeshGroup, landscapeSplineMeshColliderPrimitive } from "../../src/scene/SceneRuntimeCore";
import { EngineApp } from "../../engine/core/EngineApp";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

function fixture(deform = true) {
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Road", tileQuads: 32, spacing: 1,
    tilesX: 4, tilesZ: 2, origin: [1000000.25, 7.5, -1000000.75], heightMin: -64, heightMax: 64,
    collision: true, layers: [{ id: "grass", name: "Grass", color: "#558833" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < 2; z++) for (let x = 0; x < 4; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    for (let iz = 0; iz < tile.size; iz++) for (let ix = 0; ix < tile.size; ix++) tile.heights[iz * tile.size + ix] = (z * 32 + iz) * 0.25;
    tiles.set(tileKey(x, z), tile); def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 16 });
  }
  def.splines = [{ id: "road", coordinateSpace: "world", points: [14, 32, 54].map((x, index) => ({
    id: String(index), position: [def.origin[0] + x, def.origin[1] + 6, def.origin[2] + 16], width: 4, falloff: 1,
  })), segments: [0, 1].map((index) => ({ id: `s${index}`, startPointId: String(index), endPointId: String(index + 1),
    mesh: { enabled: true, assetId: "road", deform, alignToTerrain: true } })) }];
  const geometry = new BoxGeometry(4, 0.2, 10, 1, 1, 8);
  const root = new Group(); root.add(new Mesh(geometry, new MeshBasicMaterial()));
  const models = new Map([["road", { scene: root } as unknown as GLTF]]);
  return { def, tiles, models, geometry };
}

export async function registerTerrainSplineMeshTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain spline mesh: world frame, seam weld and exact bank use local geometry at a large origin", async () => {
    const document = fixture(); const before = JSON.stringify(document.def);
    const source = await prepareTerrainSplineMeshSource(document);
    assert.deepEqual(terrainSplineMeshTileKeys(document.def), ["0_0", "1_0"]);
    const normal = source.normalAt(-32, -16);
    assert.ok(Math.abs(normal[2] / normal[1] + 0.25) < 1e-10);
    const built = buildLandscapeSplineMeshGroup({ data: source, models: document.models, castShadow: false, receiveShadow: true })!;
    const meshes: Mesh[] = []; built.group.traverse((child) => { if (child instanceof Mesh) meshes.push(child); });
    assert.equal(meshes.length, 1, "tile boundary does not split a compatible chain");
    meshes[0]!.geometry.computeBoundingBox();
    const box = meshes[0]!.geometry.boundingBox!;
    assert.ok(box.min.x > -52 && box.max.x < -8, "world origin is not baked into Float32 vertices");
    assert.ok(box.max.y - box.min.y > 0.9, "cross slope banks the width of the road");
    const collider = landscapeSplineMeshColliderPrimitive(built.group, () => true)!;
    assert.equal(collider.vertices.length, meshes[0]!.geometry.getAttribute("position").count);
    assert.equal(JSON.stringify(document.def), before, "building never migrates or writes live definition");
    let sourceDisposed = false, bentDisposed = false;
    document.geometry.addEventListener("dispose", () => { sourceDisposed = true; });
    meshes[0]!.geometry.addEventListener("dispose", () => { bentDisposed = true; });
    disposeLandscapeSplineMeshGroup(built.group);
    assert.ok(bentDisposed); assert.equal(sourceDisposed, false);
  });

  await checkAsync("terrain spline mesh: fetch only missing aligned path tiles, keep streaming residency unchanged and reject failures", async () => {
    const document = fixture(); const disk = new Map(document.tiles); document.tiles.clear();
    const requested: string[] = [];
    const source = await prepareTerrainSplineMeshSource(document, async (key) => { requested.push(key); return disk.get(key)!; });
    assert.deepEqual(requested.sort(), ["0_0", "1_0"]); assert.equal(document.tiles.size, 0);
    assert.ok(source.normalAt(-32, -16)[1] > 0.9);
    await assert.rejects(prepareTerrainSplineMeshSource(document), /requires terrain tile/);
    await assert.rejects(prepareTerrainSplineMeshSource(document, async () => { throw new Error("read failed"); }), /read failed/);
    document.def.tiles = document.def.tiles.filter(({ key }) => key !== "1_0");
    const hole = await prepareTerrainSplineMeshSource(document, async (key) => disk.get(key)!);
    assert.throws(() => hole.normalAt(-10, -16), /normal unavailable/, "holes never supply a flat normal");
    document.def.splines![0]!.segments.forEach((segment) => { segment.mesh!.alignToTerrain = false; });
    assert.deepEqual(terrainSplineMeshTileKeys(document.def), []);
  });

  await checkAsync("terrain spline mesh: rigid instances align, per-segment collision and asset opt-outs match output", async () => {
    const document = fixture(false);
    document.def.splines![0]!.segments[1]!.mesh!.collision = false;
    const source = await prepareTerrainSplineMeshSource(document);
    const instances = computeLandscapeSplineMeshInstances(source.splines[0]!, { normalAt: source.normalAt });
    assert.equal(instances.length, 20);
    assert.equal(instances.filter((instance) => instance.collision).length, 9);
    const built = buildLandscapeSplineMeshGroup({ data: source, models: document.models, castShadow: false, receiveShadow: true })!;
    assert.equal(built.meshes.length, 2, "same asset with different collision needs separate batches");
    const collider = landscapeSplineMeshColliderPrimitive(built.group, () => true)!;
    assert.ok(Math.max(...collider.vertices.map((p) => p[0])) < -31.9);
    assert.equal(landscapeSplineMeshColliderPrimitive(built.group, () => false), null);
    document.def.splines![0]!.segments.forEach((segment) => { segment.mesh!.deform = true; });
    const chains = resolveLandscapeSplineMeshChains(document.def.splines![0]!);
    assert.equal(chains.length, 1, "collision changes never split the visual weld/frame/UV chain");
    assert.deepEqual(chains[0]!.segments.map((segment) => segment.collision), [true, false]);
    const mixed = buildLandscapeSplineMeshGroup({ data: await prepareTerrainSplineMeshSource(document), models: document.models, castShadow: false, receiveShadow: true })!;
    const partial = landscapeSplineMeshColliderPrimitive(mixed.group, () => true)!;
    assert.ok(Math.max(...partial.vertices.map((point) => point[0])) < -31.9);
    document.def.splines![0]!.segments[1]!.mesh!.collision = true;
    const full = buildLandscapeSplineMeshGroup({ data: await prepareTerrainSplineMeshSource(document), models: document.models, castShadow: false, receiveShadow: true })!;
    const bent = (group: Group): Mesh => group.getObjectByName("deformed-road")!.children[0] as Mesh;
    assert.deepEqual(bent(mixed.group).geometry.getAttribute("position").array, bent(full.group).geometry.getAttribute("position").array);
    assert.deepEqual(bent(mixed.group).geometry.getAttribute("uv").array, bent(full.group).geometry.getAttribute("uv").array);
  });

  await checkAsync("terrain spline mesh: Rapier contacts the rendered road above terrain on both sides of a tile seam", async () => {
    const document = fixture(); const source = await prepareTerrainSplineMeshSource(document);
    const built = buildLandscapeSplineMeshGroup({ data: source, models: document.models, castShadow: false, receiveShadow: true })!;
    const primitive = landscapeSplineMeshColliderPrimitive(built.group, () => true)!;
    const centre = worldTerrainActorPosition(document.def);
    // A moderate world transform for this backend check avoids testing Rapier's
    // unrelated million-metre float precision; source conversion above covers it.
    const translation = [31, 7.5, -13] as [number, number, number];
    const physics = new PhysicsSubsystem({ backend: "rapier" });
    physics.setEntities([{ id: "road", components: {
      Transform: { position: translation, rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: primitive.size, center: primitive.center, isStatic: true, isSensor: false,
        primitives: [{ shape: "trimesh", ...primitive }] },
    } }]);
    const app = new EngineApp(); app.registerSubsystem(physics); await app.init();
    try {
      app.update(1 / 60);
      built.group.position.set(...translation); built.group.updateMatrixWorld(true);
      for (const x of [-40, -32.1, -31.9, -20]) {
        const from = new Vector3(x + translation[0], 40, -16 + translation[2]);
        const ray = new Raycaster(from, new Vector3(0, -1, 0));
        const hit = ray.intersectObject(built.group, true)[0]!; assert.ok(hit);
        const fraction = physics.traceCamera(from.toArray(), [from.x, 0, from.z]); assert.ok(fraction !== null);
        const physicsY = 40 * (1 - fraction);
        assert.ok(Math.abs(physicsY - hit.point.y) < 0.001, `${x}: physics=${physicsY}, render=${hit.point.y}`);
        assert.ok(physicsY > translation[1] + 4.5, "road collision is above the sloped terrain");
      }
      assert.ok(centre[0] > 1e6);
    } finally { await app.dispose(); }
  });

}
