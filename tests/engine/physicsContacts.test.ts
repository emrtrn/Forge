import assert from "node:assert/strict";
import { EngineApp } from "../../engine/core/EngineApp";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import type { Entity } from "../../engine/scene/entity";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

function box(id: string, position: [number, number, number], flags: { isStatic: boolean; isSensor: boolean }): Entity {
  return {
    id,
    components: {
      Transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], ...flags },
    },
  } as unknown as Entity;
}

/**
 * A level-sized crowd of static colliders around a few overlapping bodies and
 * sensors. The per-frame contact pass must report exactly the pairs (and the
 * order) it always has while skipping work on the static crowd.
 */
function scene(): Entity[] {
  const entities: Entity[] = [];
  // Interleave the crowd with the interesting bodies so insertion order mixes them.
  for (let index = 0; index < 60; index += 1) {
    entities.push(box(`static:${String(index).padStart(2, "0")}`, [20 + (index % 10) * 3, 0, Math.floor(index / 10) * 3], { isStatic: true, isSensor: false }));
    if (index === 10) entities.push(box("wall", [0.25, 0, 0], { isStatic: true, isSensor: false }));
    if (index === 20) entities.push(box("trigger", [-0.25, 0, 0], { isStatic: true, isSensor: true }));
    if (index === 30) entities.push(box("dynamic", [0, 0, 0], { isStatic: false, isSensor: false }));
    if (index === 40) entities.push(box("probe", [0, 0, 0.4], { isStatic: false, isSensor: true }));
    if (index === 50) entities.push(box("crowd-trigger", [20, 0, 0.3], { isStatic: true, isSensor: true }));
  }
  return entities;
}

async function withQuietRapier<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] ?? "").includes("deprecated parameters for the initialization function")) return;
    warn(...args);
  };
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

export async function registerPhysicsContactTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("physics contacts: a static crowd does not change reported pairs or their order", () => withQuietRapier(async () => {
    const physics = new PhysicsSubsystem({ backend: "rapier" });
    physics.setEntities(scene());
    const app = new EngineApp();
    app.registerSubsystem(physics);
    await app.init();
    app.update(0.016);
    // Recorded from the all-pairs implementation: AABB sensor pairs keep their
    // body-order orientation (trigger→dynamic, wall→probe), Rapier pairs sort by id.
    assert.deepEqual(physics.contactsForEntity("dynamic"), [
      { a: "dynamic", b: "wall", isSensor: false },
      { a: "trigger", b: "dynamic", isSensor: true },
      { a: "dynamic", b: "probe", isSensor: true },
    ]);
    assert.deepEqual(physics.contactsForEntity("wall"), [
      { a: "dynamic", b: "wall", isSensor: false },
      { a: "wall", b: "probe", isSensor: true },
    ]);
    assert.deepEqual(physics.contactsForEntity("trigger"), [
      { a: "trigger", b: "dynamic", isSensor: true },
      { a: "trigger", b: "probe", isSensor: true },
    ]);
    assert.deepEqual(physics.contactsForEntity("probe"), [
      { a: "wall", b: "probe", isSensor: true },
      { a: "trigger", b: "probe", isSensor: true },
      { a: "dynamic", b: "probe", isSensor: true },
    ]);
    // Static against static never reports, sensor or not.
    assert.deepEqual(physics.contactsForEntity("crowd-trigger"), []);
    assert.deepEqual(physics.contactsForEntity("static:00"), []);
    await app.dispose();
  }));
}
