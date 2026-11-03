import assert from "node:assert/strict";
import { EngineApp } from "../../engine/core/EngineApp";
import { BehaviorSubsystem, type BehaviorRegistry } from "../../engine/behavior/behaviorSubsystem";
import { ActionMap } from "../../engine/input/actionMap";
import { EVENT_BINDINGS_COMPONENT } from "../../engine/scene/components";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import type { PhysicsImpact } from "../../engine/physics/impactEvents";
import type { Entity } from "../../engine/scene/entity";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const STEP = 1 / 60;

function floor(): Entity {
  return {
    id: "floor",
    components: {
      Transform: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [20, 1, 20], isStatic: true, isSensor: false },
    },
  } as unknown as Entity;
}

/** A 1 m, 10 kg crate whose underside starts `drop` metres above the floor. */
function crate(drop: number, x = 0): Entity {
  return {
    id: x === 0 ? "crate" : `crate:${x}`,
    components: {
      Transform: { position: [x, 0.5 + drop, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false, simulatePhysics: true, massKg: 10 },
    },
  } as unknown as Entity;
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

async function world(entities: Entity[], configure: (physics: PhysicsSubsystem) => void = () => {}) {
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setEntities(entities);
  configure(physics);
  const app = new EngineApp();
  app.registerSubsystem(physics);
  await app.init();
  return { physics, app };
}

/** Runs frames of `frameSeconds` until `slices` fixed steps ran; returns every frame's impacts. */
function run(app: EngineApp, physics: PhysicsSubsystem, frameSeconds: number, slices: number): PhysicsImpact[][] {
  const frames: PhysicsImpact[][] = [];
  let taken = 0;
  while (taken < slices) {
    app.update(frameSeconds);
    taken += physics.lastFrameStepCount();
    frames.push([...physics.impacts()]);
  }
  assert.equal(taken, slices, "the frame rate must divide the slice count");
  return frames;
}

const strongest = (frames: PhysicsImpact[][]): PhysicsImpact | null =>
  frames.flat().reduce<PhysicsImpact | null>((best, impact) => (!best || impact.impulse > best.impulse ? impact : best), null);

export async function registerPhysicsImpactTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("physics impacts: a 10 kg crate dropped 2 m reports ≈ m·v at the floor", () => withQuietRapier(async () => {
    const { physics, app } = await world([floor(), crate(2)], (p) => p.setImpactEventThreshold("floor", 5));
    const frames = run(app, physics, STEP, 120);
    const peak = strongest(frames);
    assert.ok(peak, "the landing must report an impact");
    // m·√(2gh) = 62.6 N·s; Faz 0 measured 64.4 on the same settings.
    assert.ok(peak.impulse > 50 && peak.impulse < 80, `impulse ${peak.impulse}`);
    assert.equal(peak.a, "crate");
    assert.equal(peak.b, "floor");
    // Out of `a` (the crate) towards `b` (the floor): straight down.
    assert.ok(peak.normal[1] < -0.99, `normal ${peak.normal.join(",")}`);
    assert.ok(peak.point, "a landing has manifold points");
    assert.ok(Math.abs(peak.point[1]) < 0.1, `point ${peak.point.join(",")}`);
    assert.ok(Math.abs(peak.point[0]) < 0.1 && Math.abs(peak.point[2]) < 0.1, "a flat landing hits the face centre");
    // √(2·9.81·2) = 6.26 m/s, estimated from post-slice velocity + J/m.
    assert.ok(peak.relativeSpeed > 5 && peak.relativeSpeed < 7.5, `speed ${peak.relativeSpeed}`);
    // The landing is one event; a resting crate (≈1.6 N·s per slice) stays under 5 N·s.
    assert.deepEqual(frames.slice(-20).flat(), [], "resting contact is below the threshold");
    assert.equal(physics.impactsForEntity("crate").length, 0);
    await app.dispose();
  }));

  await checkAsync("physics impacts: a threshold above the hit and an opted-out world stay silent", () => withQuietRapier(async () => {
    const high = await world([floor(), crate(2)], (p) => p.setImpactEventThreshold("floor", 500));
    assert.deepEqual(run(high.app, high.physics, STEP, 120).flat(), []);
    await high.app.dispose();

    const none = await world([floor(), crate(2)]);
    assert.deepEqual(run(none.app, none.physics, STEP, 120).flat(), []);
    await none.app.dispose();

    const optedOut = await world([floor(), crate(2)], (p) => {
      p.setImpactEventThreshold("floor", 5);
      p.setImpactEventThreshold("floor", null);
    });
    assert.deepEqual(run(optedOut.app, optedOut.physics, STEP, 120).flat(), []);
    await optedOut.app.dispose();
  }));

  await checkAsync("physics impacts: the opt-in survives a world rebuild and clear() drops it", () => withQuietRapier(async () => {
    const { physics, app } = await world([floor(), crate(2)]);
    // Opting in after init reaches the live colliders.
    physics.setImpactEventThreshold("floor", 5);
    physics.setEntities([floor(), crate(2)]);
    assert.ok(strongest(run(app, physics, STEP, 120)), "rebuilt bodies keep the opt-in");
    physics.clear();
    physics.setEntities([floor(), crate(2)]);
    assert.deepEqual(run(app, physics, STEP, 120).flat(), [], "clear() forgets the opt-in");
    await app.dispose();
  }));

  await checkAsync("physics impacts: an On Impact binding receives the impact, On Hit edges are unchanged", () => withQuietRapier(async () => {
    const events: string[] = [];
    const impacts: PhysicsImpact[] = [];
    const registry: BehaviorRegistry = {
      get: () => (context) => {
        const event = context.event;
        events.push(`${context.entityId}:${event?.kind}:${event?.phase ?? "-"}:${event?.otherEntityId}`);
        if (event?.impact) impacts.push(event.impact);
      },
    };
    const target = floor();
    (target.components as Record<string, unknown>)[EVENT_BINDINGS_COMPONENT] = {
      bindings: [{ event: "impact", scriptId: "record" }, { event: "hit", scriptId: "record" }],
    };
    const entities = [target, crate(2)];
    const physics = new PhysicsSubsystem({ backend: "rapier" });
    physics.setEntities(entities);
    physics.setImpactEventThreshold("floor", 5);
    const behavior = new BehaviorSubsystem(registry, new ActionMap({}), () => undefined, physics);
    behavior.setEntities(entities);
    const app = new EngineApp();
    app.registerSubsystem(physics);
    app.registerSubsystem(behavior);
    await app.init();
    run(app, physics, STEP, 120);
    assert.deepEqual(events, ["floor:hit:begin:crate", "floor:impact:-:crate"]);
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0]?.a, "crate");
    assert.ok((impacts[0]?.impulse ?? 0) > 50);
    await app.dispose();
  }));

  await checkAsync("physics impacts: 30, 60 and 144 Hz frames report the same fixed-step impacts", () => withQuietRapier(async () => {
    const totals: { impulse: number; peak: number; frames: number }[] = [];
    for (const hz of [30, 60, 144]) {
      const { physics, app } = await world([floor(), crate(2), crate(0.5, 3)], (p) => p.setImpactEventThreshold("floor", 5));
      // 144 Hz runs ~2.4 frames per slice; 240 slices is a whole number of frames at all three rates.
      const frames = run(app, physics, 1 / hz, 240);
      const flat = frames.flat();
      totals.push({
        impulse: flat.reduce((sum, impact) => sum + impact.impulse, 0),
        peak: strongest(frames)?.impulse ?? 0,
        frames: frames.filter((frame) => frame.length > 0).length,
      });
      assert.ok(flat.some((impact) => impact.a === "crate:3"), `${hz} Hz: the short drop reports too`);
      await app.dispose();
    }
    const [at30, at60, at144] = totals;
    assert.ok(at30 && at60 && at144);
    assert.ok(at60.impulse > 0);
    // The simulation is frame-rate independent; only how slices group into frames differs.
    for (const other of [at30, at144]) {
      assert.ok(Math.abs(other.impulse - at60.impulse) <= 1e-9 * at60.impulse, `${other.impulse} != ${at60.impulse}`);
    }
    assert.equal(at144.peak, at60.peak, "one slice per frame at most: the same peak slice");
    assert.ok(at30.peak >= at60.peak, "30 Hz may merge the peak with its neighbour slice");
  }));
}
