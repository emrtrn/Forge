import assert from "node:assert/strict";
import type { PhysicsAabb, PhysicsQuery, PhysicsSurfaceTriangle } from "../../engine/behavior/behaviorSubsystem";
import { ActionMap } from "../../engine/input/actionMap";
import { CharacterMovementSubsystem } from "../../engine/movement/characterMovementSubsystem";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import type { Entity } from "../../engine/scene/entity";

type Check = (label: string, fn: () => void) => void;

function box(id: string, x: number, z: number, size = 2): Entity {
  return {
    id,
    components: {
      Transform: { position: [x, -0.5, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [size, 1, size], isStatic: true, isSensor: false, physicalMaterialId: "stone" },
    },
  };
}

function mesh(id: string, x: number, z: number, size = 2): Entity {
  const entity = box(id, x, z, size);
  entity.components.Collider!.primitives = [
    { shape: "box", size: [1, 2, 1], center: [0, 1, 0] },
    {
      shape: "trimesh", size: [size, 2, size],
      // Up-facing ramp, vertical wall and downward-facing roof.
      vertices: [[0, 0, 0], [0, 1, size], [size, 0, 0], [0, 2, 0], [size, 2, 0]],
      indices: [0, 1, 2, 0, 2, 3, 3, 4, 1],
    },
  ];
  return entity;
}

function randomSource(): () => number {
  let state = 0x5eed1234;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function filtered(blockers: readonly PhysicsAabb[], x: number, z: number, radius: number): readonly PhysicsAabb[] {
  return blockers.filter((b) => b.min[0] <= x + radius && b.max[0] >= x - radius &&
    b.min[2] <= z + radius && b.max[2] >= z - radius);
}

/** Independent reproduction of the original cell + overflow surface query. */
function surfaceCandidates(surfaces: readonly PhysicsSurfaceTriangle[], x: number, z: number): PhysicsSurfaceTriangle[] {
  const local: PhysicsSurfaceTriangle[] = [];
  const overflow: PhysicsSurfaceTriangle[] = [];
  for (const s of surfaces) {
    const minX = Math.floor(Math.min(s.a[0], s.b[0], s.c[0]) / 4);
    const maxX = Math.floor(Math.max(s.a[0], s.b[0], s.c[0]) / 4);
    const minZ = Math.floor(Math.min(s.a[2], s.b[2], s.c[2]) / 4);
    const maxZ = Math.floor(Math.max(s.a[2], s.b[2], s.c[2]) / 4);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 256) overflow.push(s);
    else if (Math.floor(x / 4) >= minX && Math.floor(x / 4) <= maxX &&
      Math.floor(z / 4) >= minZ && Math.floor(z / 4) <= maxZ) local.push(s);
  }
  return [...local, ...overflow];
}

function legacyQuery(physics: PhysicsSubsystem): PhysicsQuery {
  return {
    contactsForEntity: (id) => physics.contactsForEntity(id),
    colliderHalfExtents: (id) => physics.colliderHalfExtents(id),
    staticBlockerAabbs: () => physics.staticBlockerAabbs(),
    staticSurfaceTriangles: () => physics.staticSurfaceTriangles(),
    staticSurfaceTrianglesNear: (x, z) => physics.staticSurfaceTrianglesNear(x, z),
  };
}

function pawn(): Entity {
  const entity = box("pawn", 0, 0, 0.6);
  entity.components.Transform!.position = [0, 0, 0];
  Object.assign(entity.components.Collider!, { size: [0.6, 1.8, 0.6], isStatic: false });
  entity.components.CharacterMovement = { movementMode: "walking", maxWalkSpeed: 6 };
  return entity;
}

export function registerStaticQueriesTests(check: Check): void {
  check("static queries random near blockers equal brute force in body/primitive order", () => {
    const random = randomSource();
    const physics = new PhysicsSubsystem();
    const entities = Array.from({ length: 350 }, (_, i) => {
      const entity = (i % 3 === 0 ? mesh : box)(`body:${i}`, random() * 160 - 80, random() * 160 - 80, random() * 9 + 0.01);
      entity.components.Transform!.rotation = [0, random() * 360, 0];
      if (i % 11 === 0) entity.components.Collider!.isSensor = true;
      if (i % 13 === 0) entity.components.Collider!.isStatic = false;
      return entity;
    });
    entities.push(box("overflow", 0, 0, 10000), mesh("overflow-mesh", -200, -200, 500));
    physics.setEntities(entities);
    for (let i = 0; i < 300; i += 1) {
      const x = random() * 200 - 100;
      const z = random() * 200 - 100;
      const radius = i % 10 === 0 ? 0 : random() * 20;
      assert.deepEqual(physics.staticBlockerAabbsNear(x, z, radius), filtered(physics.staticBlockerAabbs(), x, z, radius));
      assert.deepEqual(physics.staticSurfaceTrianglesNear(x, z), surfaceCandidates(physics.staticSurfaceTriangles(), x, z));
    }
  });

  check("static queries inclusive boundaries deduplicate cells and filter overflow", () => {
    const physics = new PhysicsSubsystem();
    physics.setEntities([box("span", 0, 0, 16), box("far-overflow", 10000, 10000, 1000)]);
    assert.equal(physics.staticBlockerAabbsNear(0, 0, 20).length, 1);
    assert.equal(physics.staticBlockerAabbsNear(-9, -9, 1).length, 1);
    assert.equal(physics.staticBlockerAabbsNear(8, 8, 0).length, 1);
    assert.equal(physics.staticBlockerAabbsNear(8.001, 8.001, 0).length, 0);
    assert.deepEqual(physics.staticBlockerAabbsNear(0, 0, 1e9), physics.staticBlockerAabbs());
  });

  check("static queries random incremental mutations equal a full rebuild", () => {
    const random = randomSource();
    const physics = new PhysicsSubsystem();
    const live = new Map<string, Entity>();
    const disabled = new Set<string>();
    for (let step = 0; step < 200; step += 1) {
      const id = `body:${Math.floor(random() * 24)}`;
      const op = Math.floor(random() * 4);
      const current = live.get(id);
      if (op === 0) {
        const entity = mesh(id, random() * 100 - 50, random() * 100 - 50, step % 9 === 0 ? 500 : 3);
        entity.components.Collider!.navigationRole = ["auto", "walkable", "obstacleOnly", "ignored"][step % 4]!;
        if (physics.addEntity(entity)) live.set(id, entity);
      } else if (op === 1) {
        physics.removeEntities([id, id, "missing"]);
        live.delete(id);
        disabled.delete(id);
      } else if (op === 2 && current) {
        const transform = { position: [random() * 100 - 50, 0, random() * 100 - 50] as [number, number, number],
          rotation: [0, random() * 360, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
        current.components.Transform = transform;
        physics.setEntityTransform(id, transform);
      } else if (current) {
        const enabled = disabled.has(id);
        physics.setEntityCollisionEnabled(id, enabled);
        if (enabled) disabled.delete(id);
        else disabled.add(id);
      }
      const rebuilt = new PhysicsSubsystem();
      rebuilt.setEntities([...live.values()]);
      for (const disabledId of disabled) rebuilt.setEntityCollisionEnabled(disabledId, false);
      assert.deepEqual(physics.staticBlockerAabbs(), rebuilt.staticBlockerAabbs());
      assert.deepEqual(physics.staticSurfaceTriangles(), rebuilt.staticSurfaceTriangles());
      assert.deepEqual(physics.staticNavigationBlockerAabbs(), rebuilt.staticNavigationBlockerAabbs());
      assert.deepEqual(physics.staticNavigationSurfaceTriangles(), rebuilt.staticNavigationSurfaceTriangles());
      for (let query = 0; query < 5; query += 1) {
        const x = random() * 100 - 50;
        const z = random() * 100 - 50;
        assert.deepEqual(physics.staticBlockerAabbsNear(x, z, 8), filtered(rebuilt.staticBlockerAabbs(), x, z, 8));
        assert.deepEqual(physics.staticSurfaceTrianglesNear(x, z), surfaceCandidates(rebuilt.staticSurfaceTriangles(), x, z));
      }
    }
  });

  check("static queries batches invalidate once and retain untouched records", () => {
    const physics = new PhysicsSubsystem();
    const a = mesh("a", 0, 0);
    const b = mesh("b", 10, 10);
    const before = physics.staticQueryDebug();
    assert.equal(physics.addEntities([a, b, a, { id: "no-body", components: {} }]), 2);
    assert.equal(physics.staticQueryDebug().invalidations - before.invalidations, 1);
    const blocker = physics.staticBlockerAabbs()[0];
    const surface = physics.staticSurfaceTriangles()[0];
    physics.addEntities([box("c", 20, 20), box("d", 30, 30)]);
    const added = physics.staticQueryDebug();
    physics.removeEntities(["c", "d", "c", "missing"]);
    assert.equal(physics.staticQueryDebug().invalidations - added.invalidations, 1);
    assert.equal(physics.staticQueryDebug().recordBuilds, added.recordBuilds);
    assert.equal(physics.staticBlockerAabbs()[0], blocker);
    assert.equal(physics.staticSurfaceTriangles()[0], surface);
    physics.addEntities([a, b]);
    physics.removeEntities(["missing"]);
    assert.equal(physics.staticQueryDebug().invalidations, added.invalidations + 1);
    const builds = physics.staticQueryDebug().recordBuilds;
    physics.setEntityCollisionEnabled("a", false);
    physics.setEntityCollisionEnabled("a", true);
    assert.equal(physics.staticQueryDebug().recordBuilds, builds);
    assert.equal(physics.staticBlockerAabbs()[0], blocker);
  });

  check("static queries id map stays consistent across replace remove clear and re-add", () => {
    const physics = new PhysicsSubsystem();
    const a = mesh("a", 0, 0);
    physics.setEntities([a]);
    assert.equal(physics.colliderPhysicalMaterialId("a"), "stone");
    assert.equal(physics.addEntity(a), false);
    physics.removeEntity("a");
    assert.equal(physics.colliderPhysicalMaterialId("a"), undefined);
    assert.equal(physics.colliderHalfExtents("a"), null);
    assert.equal(physics.addEntity(a), true);
    physics.staticBlockerAabbs();
    physics.staticSurfaceTriangles();
    physics.clear();
    assert.equal(physics.colliderPhysicalMaterialId("a"), undefined);
    assert.deepEqual(physics.staticBlockerAabbs(), []);
    assert.deepEqual(physics.staticSurfaceTrianglesNear(0, 0), []);
    assert.equal(physics.hasStaticGround(), false);
    assert.equal(physics.addEntity(a), true);
    physics.setEntities([box("b", 4, 4)]);
    assert.equal(physics.colliderPhysicalMaterialId("a"), undefined);
    assert.equal(physics.addEntity(a), true);
    assert.deepEqual(physics.staticBlockerAabbsNear(0, 0, 20), physics.staticBlockerAabbs());
  });

  check("static queries 5000 AABBs bound character blocker inspections without flat queries", () => {
    const physics = new PhysicsSubsystem();
    const player = pawn();
    physics.setEntities([...Array.from({ length: 5000 }, (_, i) => box(`floor:${i}`, (i % 100) * 8, Math.floor(i / 100) * 8)), player]);
    const query: PhysicsQuery = {
      ...legacyQuery(physics),
      staticBlockerAabbs: () => { throw new Error("movement materialized all blockers"); },
      staticSurfaceTriangles: () => { throw new Error("movement materialized all surfaces"); },
      staticBlockerAabbsNear: (x, z, r) => physics.staticBlockerAabbsNear(x, z, r),
      hasStaticGround: () => physics.hasStaticGround(),
    };
    const movement = new CharacterMovementSubsystem(new ActionMap({}), () => {}, query, {
      isPlayerControlled: () => false, getMoveIntent: () => ({ direction: [1, 0] }),
    });
    movement.setEntities([player]);
    const before = physics.staticQueryDebug();
    movement.update({ deltaSeconds: 1 / 60, elapsedSeconds: 1 / 60, frame: 1 });
    assert.ok(movement.transformOf("pawn")!.position[0] > 0);
    const inspected = physics.staticQueryDebug().blockerCandidatesInspected - before.blockerCandidatesInspected;
    assert.ok(inspected > 0 && inspected <= 12, `inspected ${inspected}, expected at most 12 of 5000`);
  });

  check("static queries movement preserves void falling and empty-scene fallback floor", () => {
    for (const hasDistantGround of [false, true]) {
      const physics = new PhysicsSubsystem();
      const player = pawn();
      physics.setEntities(hasDistantGround ? [player, box("far", 1000, 1000)] : [player]);
      const run = (query: PhysicsQuery): number[] => {
        const movement = new CharacterMovementSubsystem(new ActionMap({}), () => {}, query, {
          isPlayerControlled: () => false, getMoveIntent: () => ({ direction: [1, 0] }),
        });
        movement.setEntities([player]);
        for (let frame = 1; frame <= 10; frame += 1) {
          movement.update({ deltaSeconds: 0.1, elapsedSeconds: frame * 0.1, frame });
        }
        return movement.transformOf("pawn")!.position;
      };
      const indexed = run(physics);
      assert.deepEqual(indexed, run(legacyQuery(physics)));
      assert.equal(indexed[1]! < 0, hasDistantGround);
    }
  });

  check("static queries streamed colliders become nav blockers on add and stop on remove", () => {
    // World Partition adds/removes actors at runtime; the AI's static-geometry
    // revision keys on the blocker array identity, so each change must hand back
    // a new, correct list.
    const physics = new PhysicsSubsystem();
    physics.setEntities([box("floor", 0, 0, 40)]);
    const before = physics.staticNavigationBlockerAabbs();
    const wall = box("streamed-wall", 5, 0, 1);
    Object.assign(wall.components.Collider!, { size: [1, 4, 60] });
    assert.equal(physics.addEntity(wall), true);
    const withWall = physics.staticNavigationBlockerAabbs();
    assert.notEqual(withWall, before);
    assert.equal(withWall.length, before.length + 1);
    // The route (0,0,0) → (10,0,0) crosses x = 5 at z = 0, above the floor.
    const crossesRoute = (blockers: readonly PhysicsAabb[]) => blockers.some((blocker) =>
      blocker.min[0] <= 5 && blocker.max[0] >= 5 && blocker.min[2] <= 0 && blocker.max[2] >= 0 && blocker.max[1] > 0.5);
    assert.equal(crossesRoute(before), false);
    assert.equal(crossesRoute(withWall), true, "the streamed wall stands across the route");
    physics.removeEntities(["streamed-wall"]);
    const afterRemove = physics.staticNavigationBlockerAabbs();
    assert.notEqual(afterRemove, withWall);
    assert.deepEqual(afterRemove, before);
    assert.equal(crossesRoute(afterRemove), false);
  });

  check("static queries movement swept radius covers fast travel launch and platform carry", () => {
    const player = pawn();
    const wall = box("wall", 12, 0, 0.1);
    Object.assign(wall.components.Transform!, { position: [12, 2, 0] });
    Object.assign(wall.components.Collider!, { size: [0.1, 5, 10] });
    const physics = new PhysicsSubsystem();
    physics.setEntities([box("floor", 0, 0, 200), wall, player]);
    for (const mode of ["input", "launch", "carry"] as const) {
      const run = (query: PhysicsQuery): number[] => {
        const platform = { min: [-1, -1, -1] as [number, number, number], max: [1, 0.1, 1] as [number, number, number] };
        const movement = new CharacterMovementSubsystem(new ActionMap({}), () => {}, query, {
          isPlayerControlled: () => false,
          getMoveIntent: () => ({ direction: [1, 0], speed: mode === "input" ? 16 : 0 }),
          ...(mode === "carry" ? { platforms: { platforms: () => [{ id: "platform", aabb: platform, delta: [16, 0, 0] as const }] } } : {}),
        });
        movement.setEntities([player]);
        if (mode === "launch") movement.launch("pawn", [16, 0, 0]);
        movement.update({ deltaSeconds: 1, elapsedSeconds: 1, frame: 1 });
        return movement.transformOf("pawn")!.position;
      };
      assert.deepEqual(run(physics), run(legacyQuery(physics)), mode);
      assert.ok(run(physics)[0]! <= 11.651, `${mode}: ${run(physics)}`);
    }
  });
}
