import assert from "node:assert/strict";
import type { NavAgent, PathResult } from "../../engine/navigation/gridNavigation";
import { loadRecastModules, RecastNavMesh, type RecastModules, type RecastNavMeshOptions } from "../../engine/navigation/recastNavMesh";
import { RecastPlanner } from "../../engine/navigation/recastPlanner";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import type { NavigationRole } from "../../engine/scene/collision";
import type { ColliderComponent, ColliderPrimitive } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { Vec3 } from "../../engine/scene/layout";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const AGENT: NavAgent = { radius: 0.35, height: 1.8, stepHeight: 0.45, maxStepDown: 0.5, maxSlopeAngleDeg: 50 };

function body(id: string, position: Vec3, collider: Partial<ColliderComponent>): Entity {
  return {
    id,
    components: {
      Transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: true, isSensor: false, ...collider },
    },
  };
}

function box(id: string, min: Vec3, max: Vec3, navigationRole?: NavigationRole): Entity {
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return body(id, center, { size, ...(navigationRole ? { navigationRole } : {}) });
}

function ground(id = "ground", half = 40): Entity {
  return box(id, [-half, -1, -half], [half, 0, half]);
}

/** A ramp rising along +Z from `z0` (height 0) to `z1` (height `top`), as an up-facing trimesh. */
function ramp(id: string, x0: number, x1: number, z0: number, z1: number, top: number): Entity {
  const primitive: ColliderPrimitive = {
    shape: "trimesh",
    size: [x1 - x0, top, z1 - z0],
    center: [(x0 + x1) / 2, top / 2, (z0 + z1) / 2],
    vertices: [[x0, 0, z0], [x1, 0, z0], [x1, top, z1], [x0, top, z1]],
    // (b - a) × (c - a) points up: the floor's own winding.
    indices: [0, 2, 1, 0, 3, 2],
  };
  return body(id, [0, 0, 0], { shape: "trimesh", size: primitive.size, primitives: [primitive] });
}

function heightfield(id: string, quads: number, spacing: number, height: (x: number, z: number) => number): Entity {
  const heights = new Float32Array((quads + 1) * (quads + 1));
  let min = Infinity;
  let max = -Infinity;
  const half = (quads * spacing) / 2;
  for (let z = 0; z <= quads; z += 1) {
    for (let x = 0; x <= quads; x += 1) {
      const value = height(x * spacing - half, z * spacing - half);
      heights[z * (quads + 1) + x] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const primitive: ColliderPrimitive = {
    shape: "heightfield",
    size: [quads * spacing, max - min, quads * spacing],
    center: [0, (min + max) / 2, 0],
    heightfield: { quadsX: quads, quadsZ: quads, spacing, heights },
  };
  return body(id, [0, 0, 0], { shape: "heightfield", size: primitive.size, primitives: [primitive] });
}

function navMesh(modules: RecastModules, entities: Entity[], options: RecastNavMeshOptions = {}, agent = AGENT) {
  const physics = new PhysicsSubsystem();
  physics.setEntities(entities);
  const mesh = new RecastNavMesh(modules, agent, {
    forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) =>
      physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
    forEachObstacleInRect: (minX, minZ, maxX, maxZ, visit) =>
      physics.forEachNavigationObstacleInRect(minX, minZ, maxX, maxZ, visit),
  }, options);
  return { physics, mesh };
}

function path(mesh: RecastNavMesh, start: Vec3, goal: Vec3): PathResult {
  const pad = 2;
  mesh.ensureTilesInRect(
    Math.min(start[0], goal[0]) - pad, Math.min(start[2], goal[2]) - pad,
    Math.max(start[0], goal[0]) + pad, Math.max(start[2], goal[2]) + pad,
  );
  return mesh.findPath(start, goal);
}

/** Samples every segment every 5 cm and returns the samples inside the XZ box. */
function samplesInside(points: readonly Vec3[], min: [number, number], max: [number, number]): Vec3[] {
  const inside: Vec3[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      if (x > min[0] && x < max[0] && z > min[1] && z < max[1]) inside.push([x, a[1] + (b[1] - a[1]) * t, z]);
    }
  }
  return inside;
}

function last(result: PathResult): Vec3 {
  return result.points[result.points.length - 1]!;
}

export async function registerRecastNavMeshTests(checkAsync: CheckAsync): Promise<void> {
  const modules = await loadRecastModules();

  await checkAsync("recast nav: path detours around a wall, never through it", async () => {
    const { mesh } = navMesh(modules, [ground(), box("wall", [-10, 0, -0.5], [10, 3, 0.5])]);
    const result = path(mesh, [0, 0, -8], [0, 0, 8]);
    assert.equal(result.status, "success");
    assert.deepEqual(samplesInside(result.points, [-10 - AGENT.radius * 0.9, -0.5 - AGENT.radius * 0.9],
      [10 + AGENT.radius * 0.9, 0.5 + AGENT.radius * 0.9]), []);
    assert.ok(Math.abs(last(result)[2] - 8) < 0.05 && Math.abs(last(result)[1]) < 0.15);
    mesh.dispose();
  });

  await checkAsync("recast nav: a ramp climbs onto a platform", async () => {
    const { mesh } = navMesh(modules, [
      ground(), ramp("ramp", 15, 25, 0, 10, 2), box("platform", [15, 0, 10], [25, 2, 20]),
    ]);
    const result = path(mesh, [0, 0, -5], [20, 2, 15]);
    assert.equal(result.status, "success");
    assert.ok(Math.abs(last(result)[1] - 2) < 0.15, `ends on the platform: ${last(result)}`);
    mesh.dispose();
  });

  await checkAsync("recast nav: stairs within stepHeight climb, taller risers do not", async () => {
    const stairs = (riser: number) => {
      const steps: Entity[] = [];
      for (let index = 0; index < 5; index += 1) {
        steps.push(box(`step-${index}`, [-2, 0, index * 0.6], [2, riser * (index + 1), 20], "walkable"));
      }
      return steps;
    };
    const goalY = (riser: number): Vec3 => [0, riser * 5, 10];
    const low = navMesh(modules, [ground(), ...stairs(0.3)]);
    const climbed = path(low.mesh, [0, 0, -6], goalY(0.3));
    assert.equal(climbed.status, "success");
    assert.ok(Math.abs(last(climbed)[1] - 1.5) < 0.15, `top of the stairs: ${last(climbed)}`);
    low.mesh.dispose();
    const high = navMesh(modules, [ground(), ...stairs(0.6)]);
    assert.equal(path(high.mesh, [0, 0, -6], goalY(0.6)).status, "failure");
    high.mesh.dispose();
  });

  await checkAsync("recast nav: an obstacleOnly slab is never floor, an auto one is", async () => {
    const slab = (role?: NavigationRole) => box("slab", [-3, 0, 6], [3, 0.2, 12], role);
    const auto = navMesh(modules, [ground(), slab()]);
    assert.equal(path(auto.mesh, [0, 0, -6], [0, 0.2, 9]).status, "success");
    auto.mesh.dispose();
    const obstacle = navMesh(modules, [ground(), slab("obstacleOnly")]);
    assert.equal(path(obstacle.mesh, [0, 0, -6], [0, 0.2, 9]).status, "failure");
    // ...but it still blocks: a path past it walks around the slab.
    const around = path(obstacle.mesh, [0, 0, 3], [0, 0, 15]);
    assert.equal(around.status, "success");
    assert.deepEqual(samplesInside(around.points, [-3, 6], [3, 12]), []);
    obstacle.mesh.dispose();
  });

  await checkAsync("recast nav: headroom under a floating deck decides whether the floor below is walkable", async () => {
    const deck = (bottom: number) => box("deck", [-4, bottom, -4], [4, bottom + 0.2, 4]);
    const tall = navMesh(modules, [ground(), deck(2.4)]);
    const under = path(tall.mesh, [0, 0, -10], [0, 0, 10]);
    assert.equal(under.status, "success");
    assert.ok(under.points.every((point) => point[1] < 0.3), "stays on the ground under the deck");
    assert.ok(samplesInside(under.points, [-4, -4], [4, 4]).length > 0, "walks straight under it");
    tall.mesh.dispose();
    const low = navMesh(modules, [ground(), deck(1.2)]);
    const around = path(low.mesh, [0, 0, -10], [0, 0, 10]);
    assert.equal(around.status, "success");
    assert.deepEqual(samplesInside(around.points, [-4 + AGENT.radius, -4 + AGENT.radius],
      [4 - AGENT.radius, 4 - AGENT.radius]), []);
    low.mesh.dispose();
  });

  await checkAsync("recast nav: heightfield terrain paths across tile seams and over a hill", async () => {
    const hill = (x: number, z: number) => 3 * Math.exp(-((x * x + z * z) / 200));
    const { mesh } = navMesh(modules, [heightfield("terrain", 96, 1, hill)]);
    const result = path(mesh, [-40, hill(-40, -40), -40], [40, hill(40, 40), 40]);
    assert.equal(result.status, "success");
    assert.ok(mesh.loadedTileKeys().length >= 9, `tiles: ${mesh.loadedTileKeys().join(" ")}`);
    assert.ok(Math.abs(last(result)[1] - hill(40, 40)) < 0.2);
    // Corner heights follow the hill rather than a flat plane.
    assert.ok(result.points.every((point) => Math.abs(point[1] - hill(point[0], point[2])) < 0.35));
    mesh.dispose();
  });

  await checkAsync("recast nav: tiles stream — dropped tiles stop a path, rebuilt ones restore it", async () => {
    const { mesh } = navMesh(modules, [ground("ground", 60)]);
    assert.equal(path(mesh, [-50, 0, 0], [50, 0, 0]).status, "success");
    const kept = new Set(mesh.loadedTileKeys().filter((key) => key.startsWith("-2_") || key.startsWith("-1_")));
    assert.ok(mesh.retainTiles(kept) > 0);
    assert.equal(mesh.findPath([-50, 0, 0], [50, 0, 0]).status, "failure");
    assert.equal(path(mesh, [-50, 0, 0], [50, 0, 0]).status, "success");
    mesh.dispose();
  });

  await checkAsync("recast nav: authored bounds limit tiles and endpoints", async () => {
    const bounds = [{ min: [-20, -2, -20] as const, max: [20, 4, 20] as const }];
    const { mesh } = navMesh(modules, [ground("ground", 80)], { bounds });
    mesh.ensureTilesInRect(-70, -70, 70, 70);
    assert.ok(mesh.loadedTileKeys().every((key) => {
      const [x, z] = key.split("_").map(Number) as [number, number];
      return x >= -1 && x <= 0 && z >= -1 && z <= 0;
    }), mesh.loadedTileKeys().join(" "));
    assert.equal(mesh.findPath([0, 0, 0], [10, 0, 10]).status, "success");
    assert.equal(mesh.findPath([0, 0, 0], [30, 0, 0]).status, "failure");
    mesh.dispose();
  });

  await checkAsync("recast nav: a rotated box collider is voxelized as its oriented shape", async () => {
    const wall = body("wall", [0, 1.5, 0], { size: [20, 3, 1] });
    (wall.components.Transform as { rotation: Vec3 }).rotation = [0, 45, 0];
    const { mesh } = navMesh(modules, [ground(), wall]);
    // A point right beside the diagonal wall, inside its axis-aligned bounds: an
    // AABB model would erase it, the oriented box leaves it walkable.
    const result = path(mesh, [-6, 0, -6], [5, 0, -8]);
    assert.equal(result.status, "success");
    mesh.dispose();
  });

  await checkAsync("recast planner: per-profile meshes, revision drops, capped tile builds, snapped heights", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 200)]);
    let triangleQueries = 0;
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => {
        triangleQueries += 1;
        physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit);
      },
    }, { maxTilesPerRequest: 6, snapHeight: () => 0.05 });
    planner.setRevision(1);
    const near = planner.findPath({ agent: AGENT, start: [1, 0, 1], goal: [10, 0, 10], bounds: [] });
    assert.equal(near.status, "success");
    assert.ok(near.points.every((point) => point[1] === 0.05), "every corner went through snapHeight");
    const tiles = () => planner.loadedTiles().reduce((total, entry) => total + entry.tiles.length, 0);
    // Endpoint tiles (1) + at most 6 more for the margin rectangle.
    assert.ok(tiles() <= 7, `capped: ${tiles()}`);

    const wide: NavAgent = { ...AGENT, radius: 0.8 };
    assert.equal(planner.findPath({ agent: wide, start: [1, 0, 1], goal: [10, 0, 10], bounds: [] }).status, "success");
    assert.equal(planner.loadedTiles().length, 2, "one mesh per agent profile");

    // Same revision: loaded tiles are reused; only tiles the cap left out get built.
    const queries = triangleQueries;
    const loaded = tiles();
    planner.setRevision(1);
    assert.equal(planner.findPath({ agent: AGENT, start: [2, 0, 2], goal: [9, 0, 9], bounds: [] }).status, "success");
    assert.equal(triangleQueries - queries, tiles() - loaded);
    // New revision: every mesh is dropped and rebuilt on demand.
    planner.setRevision(2);
    assert.equal(planner.loadedTiles().length, 0);
    assert.equal(planner.findPath({ agent: AGENT, start: [2, 0, 2], goal: [9, 0, 9], bounds: [] }).status, "success");
    assert.ok(triangleQueries > queries);
    // A far endpoint still gets its own tile even when the cap is spent.
    const far = planner.findPath({ agent: AGENT, start: [1, 0, 1], goal: [150, 0, 150], bounds: [] });
    assert.equal(far.status, "failure", "the corridor between them is not loaded under the cap");
    planner.dispose();
  });
}
