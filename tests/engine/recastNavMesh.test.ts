import assert from "node:assert/strict";
import type { NavAgent, PathResult } from "../../engine/navigation/navigationTypes";
import { loadRecastModules, RecastNavMesh, type RecastModules, type RecastNavMeshOptions } from "../../engine/navigation/recastNavMesh";
import { RecastPlanner, type RecastTileWorker } from "../../engine/navigation/recastPlanner";
import { buildRecastTileBytes, createTileRcConfig, type RecastTileConfig, type RecastTileInput } from "../../engine/navigation/recastTileBuild";
import { createRecastTileHandler, type RecastTileWorkerRequest } from "../../engine/navigation/workers/recastTileWorker";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { createRecastNavMeshView } from "../../engine/render-three/recastNavMeshView";
import type { LineSegments, Mesh } from "three";
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

interface ManualJob {
  readonly request: RecastTileWorkerRequest;
  resolve(bytes: Uint8Array | null): void;
  reject(error: unknown): void;
}

/**
 * A tile worker driven by the test: it runs the real worker handler, but only
 * when told to (or, with `auto`, in a microtask), so results arrive between
 * planner updates the way a worker's messages do.
 */
class ManualTileWorker implements RecastTileWorker {
  readonly lanes = 1;
  auto = false;
  private readonly handle: (request: RecastTileWorkerRequest) => Uint8Array | null;
  private readonly jobs: ManualJob[] = [];

  constructor(modules: RecastModules) {
    this.handle = createRecastTileHandler(modules);
  }

  build(config: RecastTileConfig, input: RecastTileInput): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const job: ManualJob = { request: { id: 0, config, input }, resolve, reject };
      if (this.auto) queueMicrotask(() => this.run(job));
      else this.jobs.push(job);
    });
  }

  pending(): number {
    return this.jobs.length;
  }

  async finishAll(): Promise<void> {
    for (const job of this.jobs.splice(0)) this.run(job);
    await nextMacrotask();
  }

  async failAll(error: Error): Promise<void> {
    for (const job of this.jobs.splice(0)) job.reject(error);
    await nextMacrotask();
  }

  private run(job: ManualJob): void {
    try {
      job.resolve(this.handle(job.request));
    } catch (error) {
      job.reject(error);
    }
  }
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  await checkAsync("recast streaming: physics logs the regions whose static geometry changed", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 50)]);
    assert.equal(physics.takeNavigationDirtyRegions(), "all", "a full rebuild dirties everything");
    assert.deepEqual(physics.takeNavigationDirtyRegions(), [], "taking clears the log");
    physics.addEntity(box("crate", [10, 0, 10], [12, 1, 12]));
    assert.deepEqual(physics.takeNavigationDirtyRegions(), [{ minX: 10, minZ: 10, maxX: 12, maxZ: 12 }]);
    physics.setEntityTransform("crate", { position: [21, 0.5, 1], rotation: [0, 0, 0], scale: [1, 1, 1] });
    assert.deepEqual(physics.takeNavigationDirtyRegions(), [
      { minX: 10, minZ: 10, maxX: 12, maxZ: 12 },
      { minX: 20, minZ: 0, maxX: 22, maxZ: 2 },
    ], "a move dirties where it was and where it is");
    physics.setEntityCollisionEnabled("crate", false);
    physics.removeEntity("crate");
    assert.equal((physics.takeNavigationDirtyRegions() as unknown[]).length, 2, "collision toggle and removal");
    const dynamic = body("ball", [0, 1, 0], { isStatic: false });
    physics.addEntity(dynamic);
    physics.setEntityTransform("ball", { position: [5, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    assert.deepEqual(physics.takeNavigationDirtyRegions(), [], "moving bodies never touch the nav mesh");
    for (let index = 0; index < 300; index += 1) physics.addEntity(box(`pebble-${index}`, [index, 0, 0], [index + 0.5, 0.2, 0.5]));
    assert.equal(physics.takeNavigationDirtyRegions(), "all", "an overflowing log collapses to everything");
  });

  await checkAsync("recast streaming: invokers build nearby tiles within the frame budget and drop far ones after lingering", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 300)]);
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
    }, { buildRadius: 40, keepRadius: 80, lingerSeconds: 5, frameBudgetMs: 0, maxSyncBuilds: 0 });
    const loaded = () => planner.loadedTiles().reduce((total, entry) => total + entry.tiles.length, 0);
    const invokers = [{ position: [16, 0, 16] as Vec3, agent: AGENT }];
    const first = planner.update({ invokers, bounds: [], now: 0 });
    assert.equal(first.built, 1, "a zero budget still builds one tile per frame");
    assert.ok(first.queued > 0);
    let now = 0;
    while (planner.streamingStats().queued > 0 && now < 100) planner.update({ invokers, bounds: [], now: (now += 0.1) });
    const settled = loaded();
    // Tiles whose square is within 40 m of (16, 16): a 3x3 block plus the edge ring.
    assert.ok(settled >= 9 && settled <= 25, `tiles around the invoker: ${settled}`);
    const moved = [{ position: [216, 0, 216] as Vec3, agent: AGENT }];
    planner.update({ invokers: moved, bounds: [], now: (now += 1) });
    assert.ok(planner.loadedTiles()[0]!.tiles.includes("0_0"), "an unwanted tile lingers");
    planner.update({ invokers: moved, bounds: [], now: (now += 6) });
    assert.ok(!planner.loadedTiles()[0]!.tiles.includes("0_0"), "and is dropped once the linger time has passed");
    planner.dispose();
  });

  await checkAsync("recast streaming: a request waits for its corridor, then dirty rectangles rebuild only their tiles", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 60)]);
    let builds = 0;
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => {
        builds += 1;
        physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit);
      },
      forEachObstacleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationObstacleInRect(minX, minZ, maxX, maxZ, visit),
    }, { frameBudgetMs: 1000, maxSyncBuilds: 0, buildRadius: 0 });
    const request = { agent: AGENT, start: [2, 0, -10] as Vec3, goal: [2, 0, 10] as Vec3, bounds: [] };
    physics.takeNavigationDirtyRegions();
    assert.equal(planner.findPath(request).status, "pending");
    planner.update({ invokers: [], bounds: [], now: 0 });
    const straight = planner.findPath(request);
    assert.equal(straight.status, "success");
    assert.equal(straight.points.length, 2, "open ground: a straight line");

    // A wall appears across the path: only the tiles under it turn stale.
    physics.addEntity(box("wall", [-8, 0, -0.5], [12, 3, 0.5]));
    const dirty = physics.takeNavigationDirtyRegions();
    assert.notEqual(dirty, "all");
    for (const rect of dirty as { minX: number; minZ: number; maxX: number; maxZ: number }[]) {
      planner.invalidateRect(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
    }
    const loaded = planner.loadedTiles()[0]!;
    assert.ok(loaded.stale > 0 && loaded.stale < loaded.tiles.length, `stale ${loaded.stale} of ${loaded.tiles.length}`);
    builds = 0;
    assert.equal(planner.findPath(request).status, "pending", "stale corridor tiles are rebuilt before searching");
    planner.update({ invokers: [], bounds: [], now: 1 });
    assert.equal(builds, loaded.stale, "only the stale tiles were rebuilt");
    const around = planner.findPath(request);
    assert.equal(around.status, "success");
    assert.ok(around.points.length > 2, "the new wall is walked around");
    assert.deepEqual(samplesInside(around.points, [-8, -0.5], [12, 0.5]), []);
    planner.dispose();
  });

  await checkAsync("recast worker: the worker handler builds the same tile bytes as a main-thread build", async () => {
    const { mesh } = navMesh(modules, [ground("ground", 60), box("wall", [-8, 0, -0.5], [12, 3, 0.5])]);
    const input = mesh.gatherTileInput(0, -1);
    assert.ok(input);
    const direct = buildRecastTileBytes(modules.core, createTileRcConfig(modules.core, mesh.tileConfig), mesh.tileConfig, input);
    // The request crosses a structured clone on its way to the worker.
    const request = structuredClone({ id: 1, config: mesh.tileConfig, input });
    const viaWorker = createRecastTileHandler(modules)(request);
    assert.ok(direct && viaWorker);
    assert.ok(direct.length > 0);
    assert.deepEqual(viaWorker, direct);
    mesh.dispose();
  });

  await checkAsync("recast worker: results join on a later update, stale ones are rebuilt, settle drains, a failure falls back", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 60)]);
    const worker = new ManualTileWorker(modules);
    const errors: unknown[] = [];
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
      forEachObstacleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationObstacleInRect(minX, minZ, maxX, maxZ, visit),
    }, { frameBudgetMs: 1000, maxSyncBuilds: 0, buildRadius: 0, tileWorker: worker, onWorkerError: (error) => errors.push(error) });
    const request = { agent: AGENT, start: [2, 0, -10] as Vec3, goal: [2, 0, 10] as Vec3, bounds: [] };
    const loaded = () => planner.loadedTiles().reduce((total, entry) => total + entry.tiles.length, 0);
    physics.takeNavigationDirtyRegions();

    assert.equal(planner.findPath(request).status, "pending");
    const sent = planner.update({ invokers: [], bounds: [], now: 0 });
    assert.equal(sent.built, 0);
    assert.ok((sent.submitted ?? 0) > 0 && sent.inFlight === sent.submitted, JSON.stringify(sent));
    assert.ok(sent.inFlight! <= worker.lanes * 2, "at most twice the lanes in flight");
    assert.equal(loaded(), 0, "nothing is added while the worker builds");
    const again = planner.update({ invokers: [], bounds: [], now: 0 });
    assert.equal(again.submitted, 0, "a tile in flight is not sent twice");
    await worker.finishAll();
    // Corridor tiles beyond the in-flight cap go out as earlier ones come back.
    for (let frame = 1; frame < 20 && planner.findPath(request).status === "pending"; frame += 1) {
      planner.update({ invokers: [], bounds: [], now: frame });
      await worker.finishAll();
    }
    assert.equal(planner.findPath(request).status, "success", "the worker's tiles answer the request");

    // A wall appears; while its tiles are at the worker, the geometry changes again.
    physics.addEntity(box("wall", [-8, 0, -0.5], [12, 3, 0.5]));
    const invalidate = () => {
      const dirty = physics.takeNavigationDirtyRegions();
      assert.notEqual(dirty, "all");
      for (const rect of dirty as { minX: number; minZ: number; maxX: number; maxZ: number }[]) {
        planner.invalidateRect(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
      }
    };
    invalidate();
    assert.equal(planner.findPath(request).status, "pending");
    const rebuilding = planner.update({ invokers: [], bounds: [], now: 30 });
    assert.ok((rebuilding.submitted ?? 0) > 0);
    physics.setEntityTransform("wall", { position: [2, 1.5, 0.2], rotation: [0, 0, 0], scale: [1, 1, 1] });
    invalidate();
    await worker.finishAll();
    const discarded = planner.update({ invokers: [], bounds: [], now: 31 });
    assert.equal(discarded.built, 0, "results gathered before the second change are thrown away");
    assert.equal(discarded.submitted, rebuilding.submitted, "and their tiles go back to the worker");

    // settle drains everything without a frame budget, the worker answering on its own.
    // The waiting move asks again, queueing the corridor tiles the second change touched.
    planner.findPath(request);
    worker.auto = true;
    await worker.finishAll();
    const settled = await planner.settle({ invokers: [], bounds: [], now: 32 }, 5000);
    worker.auto = false;
    assert.equal(settled.queued, 0);
    assert.equal(settled.inFlight, 0);
    const around = planner.findPath(request);
    assert.equal(around.status, "success");
    assert.ok(around.points.length > 2, "the moved wall is walked around");

    // The worker fails: one report, and tiles build on the main thread from then on.
    physics.setEntityTransform("wall", { position: [2, 1.5, 0.6], rotation: [0, 0, 0], scale: [1, 1, 1] });
    invalidate();
    assert.equal(planner.findPath(request).status, "pending");
    planner.update({ invokers: [], bounds: [], now: 40 });
    await worker.failAll(new Error("lane lost"));
    assert.equal(errors.length, 1);
    const fallback = planner.update({ invokers: [], bounds: [], now: 41 });
    assert.ok(fallback.built > 0 && fallback.submitted === undefined, JSON.stringify(fallback));
    assert.equal(worker.pending(), 0, "nothing more is sent to the failed worker");
    assert.equal(planner.findPath(request).status, "success", "main-thread builds answer it");
    planner.dispose();
  });

  await checkAsync("recast debug: the revision follows tile changes and the view draws polygons, tiles and stale tiles", async () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([ground("ground", 60)]);
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
    }, { buildRadius: 20, frameBudgetMs: 1000, maxSyncBuilds: 0 });
    const empty = planner.debugRevision();
    const invokers = [{ position: [16, 0, 16] as Vec3, agent: AGENT }];
    planner.update({ invokers, bounds: [], now: 0 });
    const built = planner.debugRevision();
    assert.notEqual(built, empty, "building tiles changes the revision");
    planner.update({ invokers, bounds: [], now: 0.1 });
    assert.equal(planner.debugRevision(), built, "an idle update keeps it");

    const [mesh] = planner.debugMeshes();
    assert.ok(mesh && mesh.tiles.length > 0 && mesh.tiles.every((tile) => !tile.stale));
    const { positions, indices } = mesh.geometry();
    const view = createRecastNavMeshView({ positions, indices, tiles: mesh.tiles, tileSize: mesh.tileSize });
    const fill = view.getObjectByName("ai-navmesh-polygons") as Mesh;
    assert.equal(fill.geometry.index!.count, indices.length, "every Detour triangle is filled");
    assert.ok(fill.geometry.getAttribute("position").getY(0) > positions[1]!, "lifted off the floor");
    assert.ok(view.getObjectByName("ai-navmesh-edges"));
    const outlines = view.getObjectByName("ai-navmesh-tiles") as LineSegments;
    assert.equal(outlines.geometry.getAttribute("position").count, mesh.tiles.length * 8, "four edges per tile");
    assert.equal(view.getObjectByName("ai-navmesh-stale-tiles"), undefined);

    planner.invalidateRect(10, 10, 12, 12);
    assert.notEqual(planner.debugRevision(), built, "a stale tile changes it");
    const [staleMesh] = planner.debugMeshes();
    const staleView = createRecastNavMeshView({ ...staleMesh!.geometry(), tiles: staleMesh!.tiles, tileSize: staleMesh!.tileSize });
    assert.ok(staleView.getObjectByName("ai-navmesh-stale-tiles"), "stale tiles get their own outline");
    planner.clear();
    assert.equal(planner.debugMeshes().length, 0);
    assert.notEqual(planner.debugRevision(), built, "a cleared planner never repeats an old revision");
    planner.dispose();
  });

  await checkAsync("recast nav: clearance padding erodes walls further, closing a gap the bare radius fits", async () => {
    // A 1.2 m gap between two walls across the whole floor.
    const walls = [ground("ground", 20), box("west", [-20, 0, -0.5], [-0.6, 3, 0.5]), box("east", [0.6, 0, -0.5], [20, 3, 0.5])];
    const bare = navMesh(modules, walls, {}, { ...AGENT, radius: 0.35, clearancePadding: 0 });
    const padded = navMesh(modules, walls, {}, { ...AGENT, radius: 0.35, clearancePadding: 0.4 });
    try {
      const through = path(bare.mesh, [0, 0, -6], [0, 0, 6]);
      assert.equal(through.status, "success", "0.7 m of agent fits a 1.2 m gap");
      assert.equal(path(padded.mesh, [0, 0, -6], [0, 0, 6]).status, "failure", "1.5 m of agent plus padding does not");
    } finally {
      bare.mesh.dispose();
      padded.mesh.dispose();
    }
  });

  await checkAsync("recast planner: reachability answers reachable, unreachable and pending without building points", async () => {
    const physics = new PhysicsSubsystem();
    // A walled pen at x > 10: open ground outside cannot reach in.
    physics.setEntities([
      ground("ground", 60),
      box("pen-w", [10, 0, -6], [10.5, 3, 6]), box("pen-e", [20, 0, -6], [20.5, 3, 6]),
      box("pen-n", [10, 0, 6], [20.5, 3, 6.5]), box("pen-s", [10, 0, -6.5], [20.5, 3, -6]),
    ]);
    let snaps = 0;
    const planner = new RecastPlanner(modules, {
      forEachTriangleInRect: (minX, minZ, maxX, maxZ, visit) => physics.forEachNavigationTriangleInRect(minX, minZ, maxX, maxZ, visit),
    }, { maxSyncBuilds: 0, frameBudgetMs: 1000, buildRadius: 0, snapHeight: () => { snaps += 1; return 0; } });
    const ask = (goal: Vec3) => planner.reachability({ agent: AGENT, start: [0, 0, 0], goal, bounds: [] });
    assert.equal(ask([4, 0, 4]), "pending", "unbuilt corridor tiles");
    planner.update({ invokers: [], bounds: [], now: 0 });
    assert.equal(ask([4, 0, 4]), "reachable");
    // The pen lies in the same 32 m tile, already built.
    assert.equal(ask([15, 0, 0]), "unreachable", "inside the closed pen");
    assert.equal(snaps, 0, "no path points were produced");
    planner.dispose();
  });
}
