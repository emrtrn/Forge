import assert from "node:assert/strict";
import { forEachHeightfieldTriangle } from "../../engine/physics/heightfieldStatic";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { rotatePointAboutOrigin } from "../../engine/physics/rotatedBox";
import { COLLIDER_COMPONENT, TRANSFORM_COMPONENT, type ColliderComponent, type ColliderPrimitive, type TransformComponent } from "../../engine/scene/components";
import type { Entity, EntityComponentData } from "../../engine/scene/entity";
import { createLandscapeColliderPrimitive, createLandscapeHeightfieldPrimitive, type ForgeLandscapeData } from "../../engine/scene/landscape";
import type { Vec3 } from "../../engine/scene/layout";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createFlatTerrainTile, terrainTileHeightRange, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { terrainTileTrimesh, worldTerrainColliderEntities } from "../../engine/terrain/worldTerrainActor";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

/**
 * OPEN_WORLD_PLAN Faz 3: World Terrain tiles and legacy Landscapes collide as heightfields. Their
 * static triangles are produced on demand, and every PhysicsSubsystem query
 * must answer exactly what the per-tile trimesh it replaces answered.
 */

const Q = 32;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 2×2 tiles with one hole, relief from one global function, and a near-vertical cliff spike. */
function terrain(spacing: number, origin: Vec3): { def: WorldTerrainDef; tiles: Map<string, TerrainTileData> } {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Parity", tileQuads: Q, spacing, tilesX: 2, tilesZ: 2, origin,
    heightMin: -1e6, heightMax: 1e6, layers: [{ id: "grass", name: "Grass", color: "#4a7a3a" }], tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (const [tx, tz] of [[0, 0], [1, 0], [0, 1]] as const) {
    const tile = createFlatTerrainTile(def, tx, tz);
    for (let z = 0; z <= Q; z += 1) {
      for (let x = 0; x <= Q; x += 1) {
        const gx = tx * Q + x;
        const gz = tz * Q + z;
        // A 50 km spike makes its side triangles nearly vertical: wall blockers.
        const spike = gx === 40 && gz === 9 ? 50_000 : 0;
        tile.heights[z * (Q + 1) + x] = Math.fround(3 * Math.sin(gx * 0.21) * Math.cos(gz * 0.13) + 0.05 * gz + spike);
      }
    }
    const range = terrainTileHeightRange(tile);
    def.tiles.push({ key: tileKey(tx, tz), minHeight: range.min, maxHeight: range.max });
    tiles.set(tileKey(tx, tz), tile);
  }
  return { def, tiles };
}

function staticBox(id: string, position: Vec3, size: Vec3): Entity {
  const collider: ColliderComponent = { shape: "box", size, isStatic: true, isSensor: false };
  return {
    id, name: id,
    components: {
      [TRANSFORM_COMPONENT]: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      [COLLIDER_COMPONENT]: collider as unknown as EntityComponentData,
    },
  };
}

/** The same tiles as per-tile trimesh entities (the collider before Faz 3), same ids and frames. */
function trimeshEntities(heightfields: readonly Entity[], document: ReturnType<typeof terrain>): Entity[] {
  return heightfields.map((entity) => {
    const key = entity.id.split(":")[2]!;
    const { primitive } = terrainTileTrimesh(document.def, document.tiles.get(key)!);
    const collider = entity.components[COLLIDER_COMPONENT] as unknown as ColliderComponent;
    return {
      ...entity,
      components: {
        ...entity.components,
        [COLLIDER_COMPONENT]: { ...collider, primitives: [primitive] } as unknown as EntityComponentData,
      },
    };
  });
}

/** Interleaves other static bodies so body order matters in merged results. */
function scene(tiles: readonly Entity[]): Entity[] {
  return [
    staticBox("crate", [14, 2, 9], [3, 4, 3]),
    tiles[0]!,
    staticBox("wall", [30, 1, 20], [0.5, 6, 40]),
    ...tiles.slice(1),
    staticBox("far", [500, 0, 500], [2, 2, 2]),
  ];
}

function samplePoints(document: ReturnType<typeof terrain>, count: number): [number, number, number][] {
  const random = seeded(11);
  const { origin, spacing } = document.def;
  const extent = 2 * Q * spacing;
  const points: [number, number, number][] = [];
  for (let index = 0; index < count; index += 1) {
    points.push([origin[0] - 3 + random() * (extent + 6), origin[2] - 3 + random() * (extent + 6), random() * 6]);
  }
  // Tile seams, a 4 m cell boundary, the hole and the spike.
  const seam = origin[0] + Q * spacing;
  points.push([seam, origin[2] + 7.3, 1], [seam, origin[2] + Q * spacing, 2.5], [16, 16, 0], [16, 16, 4],
    [origin[0] + 1.5 * Q * spacing, origin[2] + 1.5 * Q * spacing, 1], [origin[0] + 40 * spacing, origin[2] + 9 * spacing, 1.5]);
  return points;
}

function assertSameStaticQueries(trimesh: PhysicsSubsystem, heightfield: PhysicsSubsystem, points: [number, number, number][], label: string): void {
  assert.equal(heightfield.hasStaticGround(), trimesh.hasStaticGround(), `${label}: hasStaticGround`);
  for (const [x, z, radius] of points) {
    assert.deepEqual(heightfield.staticSurfaceTrianglesNear(x, z), trimesh.staticSurfaceTrianglesNear(x, z), `${label}: surfaces at ${x},${z}`);
    assert.deepEqual(heightfield.staticBlockerAabbsNear(x, z, radius), trimesh.staticBlockerAabbsNear(x, z, radius), `${label}: blockers at ${x},${z} r${radius}`);
  }
  assert.deepEqual(heightfield.staticBlockerAabbs(), trimesh.staticBlockerAabbs(), `${label}: all blockers`);
  assert.deepEqual(heightfield.staticSurfaceTriangles(), trimesh.staticSurfaceTriangles(), `${label}: all surfaces`);
  assert.deepEqual(heightfield.staticNavigationBlockerAabbs(), trimesh.staticNavigationBlockerAabbs(), `${label}: nav blockers`);
  assert.deepEqual(heightfield.staticNavigationSurfaceTriangles(), trimesh.staticNavigationSurfaceTriangles(), `${label}: nav surfaces`);
}

function landscape(verticesX: number, verticesZ: number, heightScale: number): ForgeLandscapeData {
  const heights: number[] = [];
  for (let z = 0; z < verticesZ; z += 1) {
    for (let x = 0; x < verticesX; x += 1) {
      // Dyadic samples/scales keep static-query deepEqual exact across Float32 storage.
      const relief = Math.round(48 * Math.sin(x * 0.21) * Math.cos(z * 0.13) + z) / 16;
      heights.push(relief + (x === 40 && z === 9 ? 50_000 : 0));
    }
  }
  return {
    schema: 1, type: "landscape", size: { verticesX, verticesZ, spacing: 1.5, heightScale },
    chunks: { quadsPerChunk: 32 }, heights, layers: [],
  };
}

function landscapeEntity(primitive: ColliderPrimitive, rotation: Vec3): Entity {
  const collider: ColliderComponent = {
    shape: "box", size: primitive.size, isStatic: true, isSensor: false,
    navigationRole: "walkable", primitives: [primitive],
  };
  if (primitive.center) collider.center = primitive.center;
  return {
    id: "landscape:legacy", name: "Legacy Collider",
    components: {
      [TRANSFORM_COMPONENT]: { position: [-7, 2, -5], rotation, scale: [1, 1, 1] },
      [COLLIDER_COMPONENT]: collider as unknown as EntityComponentData,
    },
  };
}

export function registerTerrainHeightfieldPhysicsTests(check: Check): void {
  for (const { label, verticesX, verticesZ, heightScale, rotation } of [
    { label: "square", verticesX: 65, verticesZ: 65, heightScale: 1, rotation: [0, 0, 0] as Vec3 },
    { label: "rotated", verticesX: 65, verticesZ: 65, heightScale: 1, rotation: [0, 30, 0] as Vec3 },
    { label: "non-square 129x65", verticesX: 129, verticesZ: 65, heightScale: 1, rotation: [0, 0, 0] as Vec3 },
    { label: "heightScale 2.5", verticesX: 65, verticesZ: 65, heightScale: 2.5, rotation: [0, 0, 0] as Vec3 },
  ]) {
    check(`landscape heightfield physics: ${label} matches every legacy trimesh static query in order`, () => {
      const data = landscape(verticesX, verticesZ, heightScale);
      const originalHeights = [...data.heights];
      const mesh = createLandscapeColliderPrimitive(data);
      const field = createLandscapeHeightfieldPrimitive(data);
      assert.equal(field.shape, "heightfield");
      assert.deepEqual(field.size, mesh.size);
      assert.deepEqual(field.center, mesh.center);
      assert.deepEqual(data.heights, originalHeights, "building the collider does not mutate authored heights");
      // Verify the diagonal, winding and complete triangle sequence before querying physics.
      forEachHeightfieldTriangle(field.heightfield!, 0, verticesX - 2, 0, verticesZ - 2, (a, b, c, index) => {
        assert.deepEqual([a, b, c], mesh.indices.slice(index * 3, index * 3 + 3).map((i) => mesh.vertices[i]!));
      });
      const trimesh = new PhysicsSubsystem();
      const heightfield = new PhysicsSubsystem();
      try {
        trimesh.setEntities(scene([landscapeEntity(mesh, rotation)]));
        heightfield.setEntities(scene([landscapeEntity(field, rotation)]));
        assert.ok(trimesh.staticBlockerAabbs().length > 3, "the landscape cliff produces wall blockers");
        const points: [number, number, number][] = [];
        const random = seeded(37);
        const extentX = (verticesX - 1) * data.size.spacing;
        const extentZ = (verticesZ - 1) * data.size.spacing;
        for (let index = 0; index < 200; index += 1) {
          const [x, , z] = rotatePointAboutOrigin([-7, 2, -5], [
            (random() - 0.5) * (extentX + 12), 0, (random() - 0.5) * (extentZ + 12),
          ], rotation);
          points.push([x, z, random() * 6]);
        }
        for (const local of [
          [-extentX / 2, 0, -extentZ / 2], [extentX / 2, 0, extentZ / 2],
          [40 * data.size.spacing - extentX / 2, 0, 9 * data.size.spacing - extentZ / 2],
        ] as Vec3[]) {
          const [x, , z] = rotatePointAboutOrigin([-7, 2, -5], local, rotation);
          points.push([x, z, 0], [x, z, 4]);
        }
        points.push([16, 16, 0], [16, 16, 4], [1000, 1000, 1]);
        assertSameStaticQueries(trimesh, heightfield, points, label);
        assertSameStaticQueries(trimesh, heightfield, points, `${label} cached`);
      } finally {
        trimesh.dispose();
        heightfield.dispose();
      }
    });
  }

  check("terrain heightfield physics: on-demand triangles answer every static query exactly like the per-tile trimesh", () => {
    const document = terrain(1.5, [-7, 2, -5]);
    const heightfields = worldTerrainColliderEntities({ id: "world", name: "World", collision: true }, document);
    assert.ok(heightfields.every((entity) => (entity.components[COLLIDER_COMPONENT] as unknown as ColliderComponent).primitives![0]!.shape === "heightfield"));
    const trimesh = new PhysicsSubsystem();
    const heightfield = new PhysicsSubsystem();
    trimesh.setEntities(scene(trimeshEntities(heightfields, document)));
    heightfield.setEntities(scene(heightfields));
    // The spike's sides are wall blockers, so the blocker path is exercised too.
    assert.ok(trimesh.staticBlockerAabbs().length > 3, "the fixture has terrain wall blockers");
    const points = samplePoints(document, 300);
    // Twice: the second pass reads the per-cell cache.
    assertSameStaticQueries(trimesh, heightfield, points, "loaded");
    assertSameStaticQueries(trimesh, heightfield, points, "cached");

    // Runtime collision toggle, then back on.
    for (const physics of [trimesh, heightfield]) physics.setEntityCollisionEnabled("landscape:world:1_0", false);
    assertSameStaticQueries(trimesh, heightfield, points.slice(0, 80), "tile disabled");
    for (const physics of [trimesh, heightfield]) physics.setEntityCollisionEnabled("landscape:world:1_0", true);
    assertSameStaticQueries(trimesh, heightfield, points.slice(0, 80), "tile re-enabled");

    // A rotated body cannot use the axis-aligned cell mapping: it is expanded at load instead.
    for (const physics of [trimesh, heightfield]) {
      const transform = heightfields[0]!.components[TRANSFORM_COMPONENT] as unknown as TransformComponent;
      physics.setEntityTransform("landscape:world:0_0", { ...transform, rotation: [0, 30, 0] });
    }
    assertSameStaticQueries(trimesh, heightfield, points.slice(0, 120), "rotated tile");

    for (const physics of [trimesh, heightfield]) physics.removeEntity("landscape:world:0_1");
    assertSameStaticQueries(trimesh, heightfield, points.slice(0, 80), "tile removed");
  });

  check("terrain heightfield physics: quads wider than the on-demand limit are expanded at load and still match", () => {
    const document = terrain(40, [-900, 0, -700]);
    const heightfields = worldTerrainColliderEntities({ id: "wide", name: "Wide", collision: true }, document);
    const trimesh = new PhysicsSubsystem();
    const heightfield = new PhysicsSubsystem();
    trimesh.setEntities(trimeshEntities(heightfields, document));
    heightfield.setEntities(heightfields);
    assertSameStaticQueries(trimesh, heightfield, samplePoints(document, 120), "wide quads");
  });

  check("terrain heightfield physics: a collision-free World Terrain leaves no static ground", () => {
    const document = terrain(1.5, [0, 0, 0]);
    const physics = new PhysicsSubsystem();
    physics.setEntities(worldTerrainColliderEntities({ id: "world", name: "World", collision: false }, document));
    assert.equal(physics.hasStaticGround(), false);
    physics.setEntities(worldTerrainColliderEntities({ id: "world", name: "World", collision: true }, document));
    assert.equal(physics.hasStaticGround(), true);
    for (const id of ["0_0", "1_0", "0_1"]) physics.setEntityCollisionEnabled(`landscape:world:${id}`, false);
    assert.equal(physics.hasStaticGround(), false);
  });
}

export async function registerTerrainHeightfieldRapierTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("landscape heightfield physics: rotated non-square Rapier rays match the legacy trimesh surface", async () => {
    const data = landscape(129, 65, 1.7);
    // Non-dyadic heights also exercise Float32 conversion at the Rapier boundary.
    data.heights = data.heights.map((_, index) => 3 * Math.sin(index * 0.21) + 0.01 * index);
    const mesh = createLandscapeColliderPrimitive(data);
    const rotation: Vec3 = [0, 30, 0];
    const trimesh = new PhysicsSubsystem({ backend: "rapier" });
    const heightfield = new PhysicsSubsystem({ backend: "rapier" });
    try {
      trimesh.setEntities([landscapeEntity(mesh, rotation)]);
      heightfield.setEntities([landscapeEntity(createLandscapeHeightfieldPrimitive(data), rotation)]);
      for (const physics of [trimesh, heightfield]) {
        await physics.init();
        assert.equal(physics.usesRapier(), true);
        physics.update({ deltaSeconds: 1 / 30, elapsedSeconds: 1 / 30, frame: 1 });
      }
      const random = seeded(19);
      for (let index = 0; index < 100; index += 1) {
        const gx = 1 + random() * 125;
        const gz = 1 + random() * 61;
        const x0 = Math.floor(gx);
        const z0 = Math.floor(gz);
        const tx = gx - x0;
        const tz = gz - z0;
        const a = z0 * data.size.verticesX + x0;
        const b = a + 1;
        const c = a + data.size.verticesX;
        const d = c + 1;
        const y = (i: number) => mesh.vertices[i]![1];
        const expected = 2 + (tx + tz <= 1
          ? y(a) * (1 - tx - tz) + y(b) * tx + y(c) * tz
          : y(b) * (1 - tz) + y(c) * (1 - tx) + y(d) * (tx + tz - 1));
        const [x, , z] = rotatePointAboutOrigin([-7, 2, -5], [
          (gx - 64) * data.size.spacing, 0, (gz - 32) * data.size.spacing,
        ], rotation);
        const from: Vec3 = [x, 500, z];
        const to: Vec3 = [x, -100, z];
        const oldFraction = trimesh.traceCamera(from, to);
        const fraction = heightfield.traceCamera(from, to);
        assert.ok(oldFraction !== null && fraction !== null, `both rays at ${x},${z} hit the landscape`);
        const oldHeight = 500 - oldFraction! * 600;
        const height = 500 - fraction! * 600;
        assert.ok(Math.abs(height - expected) < 2e-3, `${x},${z}: heightfield ${height} vs trimesh surface ${expected}`);
        assert.ok(Math.abs(height - oldHeight) < 2e-3, `${x},${z}: heightfield ${height} vs trimesh ray ${oldHeight}`);
      }
    } finally {
      trimesh.dispose();
      heightfield.dispose();
    }
  });

  await checkAsync("terrain heightfield physics: the Rapier collider PhysicsSubsystem builds is the queried surface", async () => {
    const document = terrain(1.5, [-7, 2, -5]);
    const physics = new PhysicsSubsystem({ backend: "rapier" });
    physics.setEntities(worldTerrainColliderEntities({ id: "world", name: "World", collision: true }, document));
    await physics.init();
    try {
      assert.equal(physics.usesRapier(), true);
      // Scene queries see colliders once the world has stepped, as in a running game.
      physics.update({ deltaSeconds: 1 / 30, elapsedSeconds: 1 / 30, frame: 1 });
      const lookup = { tile: (x: number, z: number) => document.tiles.get(tileKey(x, z)) };
      const random = seeded(5);
      const extent = 2 * Q * 1.5;
      let checked = 0;
      for (let index = 0; index < 200; index += 1) {
        const x = -7 + random() * extent;
        const z = -5 + random() * extent;
        const expected = terrainHeightAt(document.def, lookup, x, z);
        // Skip the spike's neighbourhood (a 50 km column) and the hole.
        if (expected === null || Math.abs(expected) > 100) continue;
        const fraction = physics.traceCamera([x, 200, z], [x, -200, z]);
        assert.ok(fraction !== null, `ray at ${x},${z} hit the terrain`);
        const y = 200 - fraction! * 400;
        assert.ok(Math.abs(y - expected) < 2e-3, `${x},${z}: rapier ${y} vs ${expected}`);
        checked += 1;
      }
      assert.ok(checked > 100, `checked ${checked}`);
      // The hole has no collider.
      assert.equal(physics.traceCamera([-7 + 1.5 * Q * 1.5, 200, -5 + 1.5 * Q * 1.5], [-7 + 1.5 * Q * 1.5, -200, -5 + 1.5 * Q * 1.5]), null);
    } finally {
      physics.dispose();
    }
  });
}
