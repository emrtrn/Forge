import assert from "node:assert/strict";
import { Box3, Raycaster, Vector3 } from "three";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { createWorldTerrainObject } from "../../engine/render-three/landscape";
import { COLLIDER_COMPONENT, TRANSFORM_COMPONENT, type ColliderComponent, type TransformComponent } from "../../engine/scene/components";
import { createFlatLandscapeData } from "../../engine/scene/landscape";
import type { LayoutLandscape, Vec3 } from "../../engine/scene/layout";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { captureTerrainSnapshot } from "../../engine/terrain/terrainLandscapeBridge";
import { applyTerrainBrush, createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { validateTerrainTile, type WorldTerrainDocument } from "../../engine/terrain/terrainLoader";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, terrainTileHeightRange, tileKey, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import {
  isMultiTileTerrain,
  terrainTileTrimesh,
  worldTerrainActorPosition,
  worldTerrainColliderEntities,
  worldTerrainExtent,
  worldTerrainPlacementIssues,
} from "../../engine/terrain/worldTerrainActor";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";
import { fetchLandscapeDocument, fetchTerrainActorDocument } from "../../src/scene/terrainDocument";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const Q = 32;
const SPACING = 1.5;
const HOLE = tileKey(2, 1);

function heightAt(gx: number, gz: number): number {
  return Math.fround(4 * Math.sin(gx * 0.11) * Math.cos(gz * 0.07) + 0.03 * gx);
}

/** A 3×2 World Terrain with one hole; heights come from one global function so seams agree. */
function worldDocument(origin: Vec3 = [10, 2, -30]): WorldTerrainDocument {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "World", tileQuads: Q, spacing: SPACING, tilesX: 3, tilesZ: 2, origin,
    heightMin: -64, heightMax: 64, layers: [{ id: "grass", name: "Grass", color: "#4a7a3a" }], tiles: [], collision: true,
  };
  const tiles = new Map<string, ReturnType<typeof createFlatTerrainTile>>();
  for (let tz = 0; tz < def.tilesZ; tz += 1) {
    for (let tx = 0; tx < def.tilesX; tx += 1) {
      const key = tileKey(tx, tz);
      if (key === HOLE) continue;
      const tile = createFlatTerrainTile(def, tx, tz);
      for (let z = 0; z <= Q; z += 1) {
        for (let x = 0; x <= Q; x += 1) tile.heights[z * (Q + 1) + x] = heightAt(tx * Q + x, tz * Q + z);
      }
      const range = terrainTileHeightRange(tile);
      def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
      tiles.set(key, tile);
    }
  }
  return { def, tiles };
}

function lookup({ tiles }: WorldTerrainDocument) {
  return { tile: (x: number, z: number) => tiles.get(tileKey(x, z)) };
}

/** Height of a trimesh entity's surface under world (x, z), from whichever triangle contains it. */
function trimeshHeightAt(transform: TransformComponent, collider: ColliderComponent, x: number, z: number): number | null {
  const primitive = collider.primitives![0]!;
  const vertices = primitive.vertices!;
  const indices = primitive.indices!;
  const px = x - transform.position[0];
  const pz = z - transform.position[2];
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!];
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    const wa = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / det;
    const wb = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / det;
    const wc = 1 - wa - wb;
    if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
    return transform.position[1] + wa * a[1] + wb * b[1] + wc * c[1];
  }
  return null;
}

export function registerWorldTerrainActorTests(check: Check): void {
  check("world terrain frame: def.origin is the min corner, the actor is the grid centre, same relation as the 1x1 bridge", () => {
    const { def } = worldDocument();
    assert.deepEqual(worldTerrainExtent(def), [3 * Q * SPACING, 2 * Q * SPACING]);
    assert.deepEqual(worldTerrainActorPosition(def), [10 + 1.5 * Q * SPACING, 2, -30 + Q * SPACING]);
    // The 1×1 save bridge writes origin = position − half extent; reading it back must give the actor position.
    const actor: LayoutLandscape = { id: "l", position: [7, -1, 3], dataRef: "landscapes/l.landscape.json" };
    assert.deepEqual(worldTerrainActorPosition(captureTerrainSnapshot(actor, createFlatLandscapeData("small")).def), actor.position);
    assert.deepEqual(worldTerrainPlacementIssues({ position: worldTerrainActorPosition(def) }, def), []);
    assert.equal(worldTerrainPlacementIssues({ position: [0, 0, 0] }, def).length, 1);
    assert.match(worldTerrainPlacementIssues({ position: worldTerrainActorPosition(def), rotation: [0, 30, 0] }, def)[0]!, /rotated/);
  });

  check("world terrain shape: only a single (0, 0) tile goes through the 1x1 adapter", () => {
    const one = { tilesX: 1, tilesZ: 1, tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }] };
    assert.equal(isMultiTileTerrain(one), false);
    assert.equal(isMultiTileTerrain({ ...one, tilesX: 2 }), true);
    assert.equal(isMultiTileTerrain({ ...one, tiles: [] }), true);
    assert.equal(isMultiTileTerrain(worldDocument().def), true);
  });

  check("world terrain render: the group puts tile (0, 0)'s min corner at def.origin and picks the queried surface", () => {
    const document = worldDocument();
    const object = createWorldTerrainObject({ name: "World", hidden: false, collision: true, document });
    object.updateMatrixWorld(true);
    assert.deepEqual(object.position.toArray(), worldTerrainActorPosition(document.def));
    assert.deepEqual(object.rotation.toArray().slice(0, 3), [0, 0, 0]);
    const box = new Box3().setFromObject(object);
    assert.ok(Math.abs(box.min.x - 10) < 1e-6 && Math.abs(box.min.z + 30) < 1e-6, `box min ${box.min.toArray()}`);
    const [width, depth] = worldTerrainExtent(document.def);
    assert.ok(Math.abs(box.max.x - (10 + width)) < 1e-6 && Math.abs(box.max.z - (-30 + depth)) < 1e-6);
    const raycaster = new Raycaster();
    for (const [x, z] of [[11.3, -29.1], [10 + Q * SPACING, -30 + 7.25], [60.2, 5.7], [140.1, -20.3]] as const) {
      raycaster.set(new Vector3(x, 500, z), new Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(object, true)[0];
      const expected = terrainHeightAt(document.def, lookup(document), x, z)!;
      assert.ok(hit, `no hit at ${x},${z}`);
      assert.ok(Math.abs(hit.point.y - expected) < 1e-3, `${x},${z}: ${hit.point.y} vs ${expected}`);
    }
    // The hole is not picked.
    raycaster.set(new Vector3(10 + 2.5 * Q * SPACING, 500, -30 + 1.5 * Q * SPACING), new Vector3(0, -1, 0));
    assert.equal(raycaster.intersectObject(object, true).length, 0);
  });

  check("world terrain collision: one static trimesh entity per tile, ids landscape:<id>:<tile>, surface = terrainHeightAt", () => {
    const document = worldDocument();
    const entities = worldTerrainColliderEntities({ id: "big", name: "Big", collision: true }, document);
    assert.deepEqual(entities.map((entity) => entity.id).sort(),
      ["0_0", "0_1", "1_0", "1_1", "2_0"].map((key) => `landscape:big:${key}`));
    assert.deepEqual(worldTerrainColliderEntities({ id: "big", name: "Big", collision: false }, document), []);
    let checked = 0;
    for (const entity of entities) {
      const transform = entity.components[TRANSFORM_COMPONENT] as unknown as TransformComponent;
      const collider = entity.components[COLLIDER_COMPONENT] as unknown as ColliderComponent;
      assert.equal(collider.isStatic, true);
      assert.equal(collider.navigationRole, "walkable");
      assert.deepEqual(transform.rotation, [0, 0, 0]);
      const key = entity.id.split(":")[2]!;
      const [tx, tz] = key.split("_").map(Number) as [number, number];
      const tile = document.tiles.get(key)!;
      // Same frame as the future Rapier heightfield body: tile centre at the datum.
      assert.deepEqual(transform.position, terrainTileTrimesh(document.def, tile).translation);
      for (let sample = 0; sample < 12; sample += 1) {
        const x = 10 + (tx * Q + 0.37 + sample * 2.61) * SPACING;
        const z = -30 + (tz * Q + 0.73 + sample * 2.47) * SPACING;
        const expected = terrainHeightAt(document.def, lookup(document), x, z)!;
        const actual = trimeshHeightAt(transform, collider, x, z);
        assert.ok(actual !== null && Math.abs(actual - expected) < 1e-4, `${key} ${x},${z}: ${actual} vs ${expected}`);
        checked += 1;
      }
    }
    assert.equal(checked, 60);
  });

  check("world terrain collision: PhysicsSubsystem serves the tile triangles as walkable ground, the hole stays empty", () => {
    const document = worldDocument();
    const physics = new PhysicsSubsystem();
    physics.setEntities(worldTerrainColliderEntities({ id: "big", name: "Big", collision: true }, document));
    assert.equal(physics.hasStaticGround(), true);
    const surfaceAt = (x: number, z: number): number | null => {
      for (const { a, b, c, normalY } of physics.staticSurfaceTrianglesNear(x, z)) {
        const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
        if (wa < -1e-9 || wb < -1e-9 || 1 - wa - wb < -1e-9) continue;
        assert.ok(normalY > 0, "terrain triangles face up");
        return wa * a[1] + wb * b[1] + (1 - wa - wb) * c[1];
      }
      return null;
    };
    // Points on both sides of the (0,0)|(1,0) and (0,0)|(0,1) seams and inside tiles.
    for (const [x, z] of [[11.3, -29.1], [10 + Q * SPACING - 0.2, -20.4], [10 + Q * SPACING + 0.2, -20.4], [40.7, -30 + Q * SPACING + 0.1], [140.1, -20.3]] as const) {
      const expected = terrainHeightAt(document.def, lookup(document), x, z)!;
      const actual = surfaceAt(x, z);
      assert.ok(actual !== null && Math.abs(actual - expected) < 1e-4, `${x},${z}: ${actual} vs ${expected}`);
    }
    assert.equal(surfaceAt(10 + 2.5 * Q * SPACING, -30 + 1.5 * Q * SPACING), null);
  });
}

export function registerWorldTerrainSaveTests(check: Check): void {
  check("world terrain save: a dab across a seam saves just the touched tiles, each in its loaded format, and they validate", () => {
    const document = worldDocument();
    const world = createTerrainEditWorld(document.def, document.tiles.values());
    // On the x seam between tiles (0, 0) and (1, 0), well inside z of row 0.
    const seamX = document.def.origin[0] + Q * SPACING;
    const { dirty } = applyTerrainBrush(world, { x: seamX, z: -30 + 10 * SPACING, radius: 4, strength: 0.5, falloff: 1, mode: "raise" });
    assert.deepEqual([...dirty.keys()].sort(), ["0_0", "1_0"]);
    const formats = new Map([["0_0", "u16" as const], ["1_0", "f32" as const]]);
    const snapshot = captureWorldTerrainSave(world, dirty.keys(), formats);
    assert.equal(snapshot.widened, false);
    assert.deepEqual(snapshot.tiles.map((tile) => tile.key), ["0_0", "1_0"]);
    assert.equal(snapshot.def.heightMin, document.def.heightMin);
    for (const { key, bytes } of snapshot.tiles) {
      const decoded = validateTerrainTile(snapshot.def, key, bytes);
      assert.equal(decoded.heightFormat, formats.get(key));
      const edited = world.tiles.get(key)!.heights;
      const step = decoded.heightFormat === "u16" ? (snapshot.def.heightMax - snapshot.def.heightMin) / 65535 : 0;
      decoded.heights.forEach((height, index) => assert.ok(Math.abs(height - edited[index]!) <= step / 2 + 1e-6, `${key}[${index}]`));
    }
    // Seam copies agree, so the terrain stays watertight after a reload.
    const left = world.tiles.get("0_0")!;
    const right = world.tiles.get("1_0")!;
    for (let z = 0; z <= Q; z += 1) assert.equal(left.heights[z * (Q + 1) + Q], right.heights[z * (Q + 1)]);
    // The caller's definition is not touched; the snapshot carries the refreshed summaries.
    assert.notEqual(snapshot.def, world.def);
    assert.ok(snapshot.def.tiles.find((tile) => tile.key === "0_0")!.maxHeight >= document.def.tiles.find((tile) => tile.key === "0_0")!.maxHeight);
  });

  check("world terrain save: leaving the encoding range widens it to whole metres and re-encodes every tile", () => {
    const document = worldDocument();
    const world = createTerrainEditWorld(document.def, document.tiles.values());
    const centre = { x: 10 + 1.5 * Q * SPACING, z: -30 + 0.5 * Q * SPACING };
    for (let dab = 0; dab < 40; dab += 1) applyTerrainBrush(world, { ...centre, radius: 3, strength: 2, falloff: 1, mode: "raise" });
    const peak = Math.max(...world.tiles.get("1_0")!.heights);
    assert.ok(peak > document.def.heightMax, `peak ${peak}`);
    const snapshot = captureWorldTerrainSave(world, ["1_0"], new Map());
    assert.equal(snapshot.widened, true);
    assert.equal(snapshot.def.heightMax, Math.ceil(peak) + 1);
    assert.equal(snapshot.def.heightMin, document.def.heightMin);
    assert.deepEqual(snapshot.tiles.map((tile) => tile.key), [...document.tiles.keys()].sort());
    for (const { key, bytes } of snapshot.tiles) assert.equal(validateTerrainTile(snapshot.def, key, bytes).heightFormat, "f32");
    // The edit world keeps its range until the save is acknowledged.
    assert.equal(world.def.heightMax, document.def.heightMax);
  });
}

export async function registerWorldTerrainActorAsyncTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain read path: a multi-tile World Terrain loads as tiles and never through the 1x1 adapter", async () => {
    const { def, tiles } = worldDocument();
    const path = "worlds/big.terrain.json";
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async (input) => {
        const url = String(input);
        const key = /\/(\d+_\d+)\.tile\.bin/.exec(url)?.[1];
        if (key) {
          const bytes = encodeTerrainTile(tiles.get(key)!, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: "f32" });
          return new Response(bytes.slice().buffer);
        }
        return new Response(JSON.stringify(def));
      };
      const loaded = await fetchTerrainActorDocument(path);
      assert.equal(loaded.kind, "world");
      if (loaded.kind !== "world") return;
      assert.deepEqual([...loaded.document.tiles.keys()].sort(), [...tiles.keys()].sort());
      assert.deepEqual(loaded.document.def.origin, def.origin);
      assert.deepEqual(Array.from(loaded.document.tiles.get("1_1")!.heights), Array.from(tiles.get("1_1")!.heights));
      await assert.rejects(fetchLandscapeDocument(path), /multi-tile World Terrain/);
    } finally { globalThis.fetch = original; }
  });
}
