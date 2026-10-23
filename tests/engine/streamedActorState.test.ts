import assert from "node:assert/strict";
import { StreamedActorStateCache, poseMatches } from "../../engine/world/streamedActorState";

type Check = (label: string, fn: () => void) => void;

const HOME = { position: [10, 0, 4] as const, rotation: [0, 90, 0] as const };

export function registerStreamedActorStateTests(check: Check): void {
  check("streamed actor state: poseMatches wraps angles and tolerates small drift", () => {
    assert.equal(poseMatches(HOME, { position: [10.04, 0, 4], rotation: [0, 90.4, 0] }), true);
    assert.equal(poseMatches(HOME, { position: [10.2, 0, 4], rotation: [0, 90, 0] }), false);
    assert.equal(poseMatches(HOME, { position: [10, 0, 4], rotation: [0, 91, 0] }), false);
    assert.equal(
      poseMatches({ position: [0, 0, 0], rotation: [0, 359.8, 0] }, { position: [0, 0, 0], rotation: [0, -0.1, 0] }),
      true,
      "359.8° and -0.1° are 0.1° apart",
    );
  });

  check("streamed actor state: only a moved body is remembered and take consumes it", () => {
    const cache = new StreamedActorStateCache();
    assert.equal(cache.remember("crate", { position: [12, 0, 4], rotation: [0, 90, 0] }, HOME), true);
    assert.equal(cache.has("crate"), true);
    assert.deepEqual(cache.take("crate"), { position: [12, 0, 4], rotation: [0, 90, 0] });
    assert.equal(cache.has("crate"), false);
    assert.equal(cache.take("crate"), undefined);
    // Coming back home forgets the older entry instead of keeping a stale pose.
    cache.remember("crate", { position: [12, 0, 4], rotation: [0, 90, 0] }, HOME);
    assert.equal(cache.remember("crate", { position: [10.01, 0, 4], rotation: [0, 90, 0] }, HOME), false);
    assert.equal(cache.has("crate"), false);
  });

  check("streamed actor state: a car left on its handbrake at home is still remembered", () => {
    const cache = new StreamedActorStateCache();
    const braked = { ...HOME, vehicle: { handbrake: true, drivetrain: null } };
    assert.equal(cache.remember("car", braked, HOME), true);
    assert.equal(cache.remember("car", { ...HOME, vehicle: { handbrake: false, drivetrain: { gear: 2, engineRpm: 3000 } } }, HOME), false);
    assert.equal(cache.has("car"), false);
  });

  check("streamed actor state: saved vehicles are parked and cached cars export at rest", () => {
    const cache = new StreamedActorStateCache();
    cache.rememberSavedVehicle({
      entityId: "actor:3",
      position: [50, 1, 60],
      rotation: [0, 45, 0],
      linearVelocity: [9, 0, 2],
      angularVelocity: [0, 1, 0],
      handbrake: false,
      drivetrain: { gear: 3, engineRpm: 4200 },
    });
    cache.remember("actor:7", { position: [1, 0, 1], rotation: [0, 0, 0] }, { position: [0, 0, 0], rotation: [0, 0, 0] });
    assert.deepEqual(cache.savedVehicles(), [{
      entityId: "actor:3",
      position: [50, 1, 60],
      rotation: [0, 45, 0],
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      handbrake: false,
      drivetrain: { gear: 3, engineRpm: 4200 },
    }], "plain bodies are not vehicles and stay out of the save list");
    cache.clear();
    assert.deepEqual(cache.savedVehicles(), []);
    assert.equal(cache.has("actor:7"), false);
  });
}
