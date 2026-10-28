import assert from "node:assert/strict";
import { HeightfieldStaticSource } from "../../engine/physics/heightfieldStatic";
import { buildNavGrid, searchNavGrid, type NavAgent } from "../../engine/navigation/gridNavigation";
import { navFloorSampler } from "../../engine/navigation/navFloorSampler";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { createReferenceCarDefinition, NEUTRAL_VEHICLE_INPUT } from "../../engine/physics/vehicle/vehicleTypes";
import { COLLIDER_COMPONENT, TRANSFORM_COMPONENT, type ColliderComponent, type TransformComponent } from "../../engine/scene/components";
import type { Entity, EntityComponentData } from "../../engine/scene/entity";
import type { Vec3 } from "../../engine/scene/layout";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createFlatTerrainTile, terrainTileHeightRange, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { terrainTileHeightfield, worldTerrainColliderEntities } from "../../engine/terrain/worldTerrainActor";
import { heightfieldWireGeometry, heightfieldWireSegments } from "../../engine/render-three/collisionView";
import { terrainTileTrimesh } from "./terrainTrimeshReference";

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

/** Same 64 m square and 1 m samples: four 32-quad tiles or one 64-quad control. */
function vehicleTerrain(seamed: boolean): ReturnType<typeof terrain> {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Vehicle seams", tileQuads: seamed ? Q : 2 * Q,
    spacing: 1, tilesX: seamed ? 2 : 1, tilesZ: seamed ? 2 : 1, origin: [-Q, 0, -Q],
    heightMin: -1, heightMax: 1, layers: [{ id: "grass", name: "Grass", color: "#4a7a3a" }],
    tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < def.tilesZ; z += 1) {
    for (let x = 0; x < def.tilesX; x += 1) {
      const key = tileKey(x, z);
      tiles.set(key, createFlatTerrainTile(def, x, z));
      def.tiles.push({ key, minHeight: 0, maxHeight: 0 });
    }
  }
  return { def, tiles };
}

interface SeamDrive {
  label: string;
  yaw: number;
  start: Vec3;
  endTile: string;
  touchedTiles: string[];
}

async function driveTerrainSeam(seamed: boolean, route: SeamDrive) {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  const ground = worldTerrainColliderEntities({ id: "seams", name: "Seams", collision: true }, vehicleTerrain(seamed));
  assert.equal(ground.length, seamed ? 4 : 1);
  assert.ok(ground.every((entity) => (entity.components[COLLIDER_COMPONENT] as unknown as ColliderComponent).primitives![0]!.shape === "heightfield"));
  // Same chassis and reference-car API as createVehicleTestWorld in tools/engine-tests.ts.
  physics.setGravity([0, -9.81, 0]);
  // Enable runtime pose synchronization; read simulatedTransform below, not the
  // sink's interpolated presentation pose (one slice behind at alpha = 0).
  physics.setTransformSink(() => {});
  physics.setEntities([...ground, {
    id: "car",
    components: {
      Transform: { position: route.start, rotation: [0, route.yaw, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1.8, 0.6, 4.2], isStatic: false, isSensor: false, simulatePhysics: true },
    },
  }]);
  try {
    await physics.init();
    assert.equal(physics.usesRapier(), true);
    assert.equal(physics.createVehicle("car", createReferenceCarDefinition()), true);
    const dt = 1 / 60;
    let frame = 0;
    const tick = (): void => {
      frame += 1;
      physics.update({ deltaSeconds: dt, elapsedSeconds: frame * dt, frame });
      assert.equal(physics.lastFrameStepCount(), 1);
    };
    const wheels = () => physics.vehicleState("car")!.wheels;
    const tileId = (key: string) => `landscape:seams:${seamed ? key : "0_0"}`;
    // Exclude spawn drop/spring settling; the subsequent motion is driven only by throttle.
    for (let index = 0; index < 180; index += 1) tick();
    assert.ok(wheels().every((wheel) => wheel.inContact && wheel.groundEntityId === tileId("0_0")));
    physics.setVehicleInput("car", { ...NEUTRAL_VEHICLE_INPUT, throttle: 1 });
    const yaw = route.yaw * Math.PI / 180;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const progressAt = (position: Vec3) => route.label === "X" ? position[0]
      : route.label === "Z" ? position[2] : (position[0] + position[2]) / Math.SQRT2;
    let previous = physics.simulatedTransform("car")!.position;
    const nearSeam: { vy: number; dy: number }[] = [];
    const touched = new Set<string>();
    let crossed = false;
    for (let index = 0; index < 360; index += 1) {
      tick();
      const position = physics.simulatedTransform("car")!.position;
      const progress = progressAt(position);
      const state = physics.vehicleState("car")!;
      for (const wheel of state.wheels) {
        assert.ok(wheel.inContact && wheel.groundEntityId, `${route.label} (${seamed ? "2x2" : "control"}): grounded at frame ${frame}, position ${position}, speed ${state.forwardSpeed}`);
        touched.add(wheel.groundEntityId);
      }
      const lateral = (position[0] - route.start[0]) * forwardZ - (position[2] - route.start[2]) * forwardX;
      assert.ok(Math.abs(lateral) < 0.1, `${route.label}: stayed straight (${lateral} m)`);
      // ±4 m covers the complete wheelbase before/after each seam, including a straddling step.
      if (Math.min(progress, progressAt(previous)) <= 4 && Math.max(progress, progressAt(previous)) >= -4) {
        assert.ok(state.forwardSpeed > 1, `${route.label}: actually driving at the seam`);
        nearSeam.push({ vy: physics.velocityOf("car")![1], dy: position[1] - previous[1] });
      }
      previous = position;
      if (progress >= 10) {
        assert.ok(state.wheels.every((wheel) => wheel.groundEntityId === tileId(route.endTile)), `${route.label}: every wheel reached the far tile`);
        crossed = true;
        break;
      }
    }
    assert.ok(crossed, `${route.label}: crossed the seam under engine force within 6 s`);
    assert.ok(nearSeam.length >= 20, `${route.label}: enough seam samples (${nearSeam.length})`);
    assert.deepEqual([...touched].sort(), [...new Set(route.touchedTiles.map(tileId))].sort(), `${route.label}: real wheel rays reached the expected tile colliders`);
    return {
      samples: nearSeam,
      maxVy: Math.max(...nearSeam.map((sample) => Math.abs(sample.vy))),
      maxDy: Math.max(...nearSeam.map((sample) => Math.abs(sample.dy))),
    };
  } finally {
    physics.dispose();
  }
}

export function registerTerrainHeightfieldPhysicsTests(check: Check): void {
  check("terrain heightfield navigation: 257x257 tile bakes without requesting the full triangle list", () => {
    const def: WorldTerrainDef = { ...vehicleTerrain(false).def, tileQuads: 256, tilesX: 1, tilesZ: 1,
      origin: [0, 0, 0], tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }] };
    const document = { def, tiles: new Map([["0_0", createFlatTerrainTile(def, 0, 0)]]) };
    const physics = new PhysicsSubsystem();
    const originalAll = HeightfieldStaticSource.prototype.all;
    let fullCalls = 0;
    HeightfieldStaticSource.prototype.all = function () {
      fullCalls += 1;
      throw new Error("nav bake must not allocate the tile's 131072 triangles");
    };
    try {
      physics.setEntities(worldTerrainColliderEntities({ id: "large", name: "Large", collision: true }, document));
      const surfaces = physics.staticNavigationSurfaceTriangles(false);
      const blockers = physics.staticNavigationBlockerAabbs();
      assert.deepEqual(surfaces, []);
      assert.deepEqual(blockers, []);
      assert.deepEqual(physics.staticBlockerAabbs(), [], "debug/perception must not generate surfaces either");
      const bounds = [{ min: [0, -1, 0] as Vec3, max: [16, 10, 16] as Vec3 }];
      const agent = { radius: 0.3, height: 1.8, stepHeight: 0.6 };
      const sampleFloorYs = navFloorSampler(blockers, surfaces, bounds, agent, 0,
        physics.staticNavigationSurfaceSamplesAt.bind(physics));
      const grid = buildNavGrid({ agent, blockers, bounds, footY: 0, sampleFloorYs });
      assert.ok(grid);
      assert.equal(searchNavGrid(grid, [2, 0, 2], [12, 0, 12]).status, "success");
      assert.equal(fullCalls, 0);
    } finally {
      HeightfieldStaticSource.prototype.all = originalAll;
      physics.dispose();
    }
  });

  check("terrain heightfield navigation: floor layers, baked grids and paths equal trimesh without full surface generation", () => {
    const document = terrain(1, [0, 0, 0]);
    const fields = worldTerrainColliderEntities({ id: "world", name: "World", collision: true }, document);
    const ramp = staticBox("ramp", [6, 5, 6], [4, 2, 4]);
    (ramp.components[COLLIDER_COMPONENT] as unknown as ColliderComponent).primitives = [{
      shape: "trimesh", size: [4, 2, 4],
      vertices: [[-2, 0, -2], [2, 2, -2], [-2, 0, 2], [2, 2, 2]],
      indices: [0, 2, 1, 1, 2, 3],
    }];
    const extras = [ramp, staticBox("platform", [10, 6, 10], [5, 0.5, 5]),
      staticBox("low-ceiling", [20, 3, 8], [4, 0.5, 4])];
    const trimesh = new PhysicsSubsystem();
    const heightfield = new PhysicsSubsystem();
    trimesh.setEntities([...scene(trimeshEntities(fields, document)), ...extras]);
    heightfield.setEntities([...scene(fields), ...extras]);
    const originalAll = HeightfieldStaticSource.prototype.all;
    let fullCalls = 0;
    HeightfieldStaticSource.prototype.all = function () {
      fullCalls += 1;
      throw new Error("navigation must not materialise full heightfield surfaces");
    };
    const agent: NavAgent = { radius: 0.3, height: 1.8, stepHeight: 0.6, maxSlopeAngleDeg: 50 };
    const bounds = [{ min: [-2, -10, -2] as Vec3, max: [66, 60_000, 66] as Vec3 }];
    const points = samplePoints(document, 500);
    // Grid vertices, diagonal, tile seams, and points within the barycentric edge tolerance.
    for (const x of [0, 1, 31, 32, 64]) {
      for (const z of [0, 1, 9, 32, 64]) {
        for (const eps of [-5e-7, 0, 5e-7]) points.push([x + eps, z, 0], [x + 0.5, z + 0.5 + eps, 0]);
      }
    }
    const compare = (label: string, bake = false): void => {
      const oldSurfaces = trimesh.staticNavigationSurfaceTriangles();
      const surfaces = heightfield.staticNavigationSurfaceTriangles(false);
      assert.equal(surfaces.length, 2, "only the two non-heightfield ramp surfaces remain in the nav list");
      assert.ok(surfaces.length <= oldSurfaces.length);
      const blockers = heightfield.staticNavigationBlockerAabbs();
      assert.deepEqual(blockers, trimesh.staticNavigationBlockerAabbs(), `${label}: exact nav blockers including cliff`);
      assert.deepEqual(heightfield.staticBlockerAabbs(), trimesh.staticBlockerAabbs(), `${label}: perception blockers`);
      const oldSampler = navFloorSampler(trimesh.staticNavigationBlockerAabbs(), oldSurfaces, bounds, agent, 0);
      const sampler = navFloorSampler(blockers, surfaces, bounds, agent, 0,
        heightfield.staticNavigationSurfaceSamplesAt.bind(heightfield));
      for (const [x, z] of points) assert.deepEqual(sampler(x, z), oldSampler(x, z), `${label}: layers at ${x},${z}`);
      if (!bake) return;
      const request = { agent, bounds: [{ min: [1, -10, 1] as Vec3, max: [25, 20, 25] as Vec3 }], footY: 0, cellSize: 0.5 };
      const grid = buildNavGrid({ ...request, blockers, sampleFloorYs: sampler });
      const oldGrid = buildNavGrid({ ...request, blockers: trimesh.staticNavigationBlockerAabbs(), sampleFloorYs: oldSampler });
      assert.ok(grid && oldGrid);
      assert.deepEqual(grid, oldGrid, `${label}: baked multi-layer grid`);
      const start: Vec3 = [3, sampler(3, 3)![0]!, 3];
      const goal: Vec3 = [10, sampler(10, 3)![0]!, 3];
      const path = searchNavGrid(grid, start, goal);
      assert.equal(path.status, "success", "fixture exercises a reachable route");
      assert.deepEqual(path, searchNavGrid(oldGrid, start, goal), `${label}: path`);
    };
    try {
      compare("loaded", true);
      const before = heightfield.staticNavigationSurfaceTriangles(false);
      for (const physics of [trimesh, heightfield]) physics.setEntityCollisionEnabled(fields[0]!.id, false);
      assert.notEqual(heightfield.staticNavigationSurfaceTriangles(false), before, "terrain-only toggle invalidates nav revision identity");
      compare("disabled");
      for (const physics of [trimesh, heightfield]) physics.setEntityCollisionEnabled(fields[0]!.id, true);
      compare("re-enabled", true);
      for (const role of ["ignored", "obstacleOnly", "auto", "walkable"] as const) {
        const withRole = fields.map((entity) => ({ ...entity, components: { ...entity.components,
          [COLLIDER_COMPONENT]: { ...entity.components[COLLIDER_COMPONENT], navigationRole: role },
        } }));
        heightfield.setEntities([...scene(withRole), ...extras]);
        trimesh.setEntities([...scene(trimeshEntities(withRole, document)), ...extras]);
        compare(role);
      }
      const beforeRemoval = heightfield.staticNavigationSurfaceTriangles(false);
      for (const physics of [trimesh, heightfield]) physics.removeEntities([fields[0]!.id]);
      assert.notEqual(heightfield.staticNavigationSurfaceTriangles(false), beforeRemoval, "terrain removal invalidates nav revision identity");
      compare("removed");
      heightfield.addEntities([fields[0]!]);
      trimesh.addEntities(trimeshEntities([fields[0]!], document));
      compare("added");
      assert.equal(fullCalls, 0);
    } finally {
      HeightfieldStaticSource.prototype.all = originalAll;
      trimesh.dispose();
      heightfield.dispose();
    }
  });

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

  check("terrain heightfield collision overlay: the editor wire traces exactly the legacy trimesh edges per tile", () => {
    const edges = ({ vertices, indices }: { vertices: Vec3[]; indices: number[] }): Vec3[] =>
      Array.from({ length: indices.length / 3 }, (_, t) => indices.slice(t * 3, t * 3 + 3).map((i) => vertices[i]!))
        .flatMap(([a, b, c]) => [a!, b!, b!, c!, c!, a!]);
    const document = terrain(1.5, [3, -2, 7]);
    for (const tile of document.tiles.values()) {
      const field = terrainTileHeightfield(document.def, tile);
      const mesh = terrainTileTrimesh(document.def, tile);
      assert.deepEqual(field.translation, mesh.translation);
      assert.deepEqual(heightfieldWireSegments(field.primitive.heightfield!), edges(mesh.primitive));
    }
  });

  check("terrain heightfield collision overlay: the indexed wire draws every triangle edge exactly once", () => {
    const key = (p: ArrayLike<number>): string => Array.from(p, (value) => Math.fround(value)).join(",");
    const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const fields = [
      ...[...terrain(1.5, [3, -2, 7]).tiles.values()].map((tile) => terrainTileHeightfield(terrain(1.5, [3, -2, 7]).def, tile).primitive.heightfield!),
    ];
    for (const field of fields) {
      const segments = heightfieldWireSegments(field);
      const expected = new Set<string>();
      for (let i = 0; i < segments.length; i += 2) expected.add(edgeKey(key(segments[i]!), key(segments[i + 1]!)));
      const { positions, indices } = heightfieldWireGeometry(field);
      const drawn = new Set<string>();
      for (let i = 0; i < indices.length; i += 2) {
        const a = indices[i]!, b = indices[i + 1]!;
        drawn.add(edgeKey(key(positions.subarray(a * 3, a * 3 + 3)), key(positions.subarray(b * 3, b * 3 + 3))));
      }
      assert.equal(indices.length / 2, drawn.size, "no edge is drawn twice");
      assert.deepEqual([...drawn].sort(), [...expected].sort());
    }
  });
}

export async function registerTerrainHeightfieldRapierTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain heightfield physics: Rapier vehicle drives X/Z seams and the shared corner without a suspension kick against a single-tile control", async () => {
    for (const route of [
      { label: "X", yaw: 90, start: [-12, 1, -16], endTile: "1_0", touchedTiles: ["0_0", "1_0"] },
      { label: "Z", yaw: 0, start: [-16, 1, -12], endTile: "0_1", touchedTiles: ["0_0", "0_1"] },
      { label: "corner", yaw: 45, start: [-12, 1, -12], endTile: "1_1", touchedTiles: ["0_0", "1_0", "0_1", "1_1"] },
    ] satisfies SeamDrive[]) {
      const control = await driveTerrainSeam(false, route);
      const seam = await driveTerrainSeam(true, route);
      console.info(`[terrain vehicle seam] ${route.label}: control / 2x2 max |vy| ${control.maxVy.toExponential(6)} / ${seam.maxVy.toExponential(6)} m/s; max |deltaY| ${control.maxDy.toExponential(6)} / ${seam.maxDy.toExponential(6)} m (${seam.samples.length} seam steps)`);
      // The flat control reads ~0.0612 m/s at slice end while Y stays constant.
      // Allow at most +5 mm/s and +0.1 mm/step over that control, with absolute
      // caps so a regression common to both fixtures cannot make the test pass.
      assert.ok(control.maxVy < 0.07 && control.maxDy < 0.001, `${route.label}: smooth control`);
      assert.ok(seam.maxVy < Math.min(0.07, control.maxVy + 0.005), `${route.label}: seam vertical velocity ${seam.maxVy} vs ${control.maxVy}`);
      assert.ok(seam.maxDy < Math.min(0.001, control.maxDy + 0.0001), `${route.label}: seam step delta Y ${seam.maxDy} vs ${control.maxDy}`);
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
