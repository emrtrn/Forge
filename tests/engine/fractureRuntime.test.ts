import assert from "node:assert/strict";
import { Vector3 } from "three";
import { bakeFracture, type FractureBakeResult } from "../../engine/physics/fracture/fractureBake";
import { normalizeAssetFracture, type AssetFractureDef } from "../../engine/physics/fracture/fractureTypes";
import {
  ChunkBudget, FractureRegistry, planChunkSpawns,
  FRACTURE_MAX_BREAK_SPEED, FRACTURE_MIN_CHUNK_MASS, FRACTURE_SCRIPTED_BREAK_SPEED,
  type ChunkSpawnSpec, type FracturePlacement, type FractureVec3, type LiveChunk,
} from "../../engine/physics/fracture/fractureRuntime";
import type { FractureSourceMesh } from "../../engine/physics/fracture/voronoiFracture";
import { composeTransformMatrix } from "../../engine/render-three/transforms";

type Check = (label: string, fn: () => void) => void;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const close3 = (actual: FractureVec3, expected: FractureVec3, epsilon = 1e-9): void => {
  for (let axis = 0; axis < 3; axis += 1) close(actual[axis]!, expected[axis]!, epsilon);
};
const definition = (patch: Partial<AssetFractureDef> = {}): AssetFractureDef => {
  const def = normalizeAssetFracture({ breakImpulse: 20, ...patch });
  assert.ok(def);
  return def;
};
const identity: FracturePlacement = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const transformed: FracturePlacement = { position: [5, 1, -3], rotation: [30, 45, 60], scale: [2, 1, 0.5] };
const velocity: FractureVec3 = [2, -3, 4];
const live = (id: string, bornAt: number, expiresAt = Infinity, ownerId = "crate"): LiveChunk =>
  ({ id, bornAt, expiresAt, ownerId });

function box(): FractureSourceMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const size: FractureVec3 = [2, 1, 0.5];
  for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    const u: FractureVec3 = Math.abs(n[0]) === 1 ? [0, 1, 0] : [1, 0, 0];
    const v: FractureVec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const base = positions.length / 3;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      for (let axis = 0; axis < 3; axis += 1) positions.push((n[axis]! + s * u[axis]! + t * v[axis]!) * size[axis]! / 2);
      normals.push(...n);
      uvs.push((s + 1) / 2, (t + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), indices: new Uint32Array(indices),
  };
}

function assertKick(specs: readonly ChunkSpawnSpec[], origin: FractureVec3, speed: number): void {
  for (const spec of specs) {
    const direction = new Vector3(...spec.position).sub(new Vector3(...origin));
    if (direction.length() < 1e-9) direction.set(0, 1, 0);
    else direction.normalize();
    close(Math.hypot(...spec.impulse), spec.massKg * speed);
    close3(spec.impulse, direction.multiplyScalar(spec.massKg * speed).toArray());
  }
}

function volumeCentre(specs: readonly ChunkSpawnSpec[], bake: FractureBakeResult, placement: FracturePlacement): FractureVec3 {
  const centre = new Vector3();
  let volume = 0;
  for (const spec of specs) {
    const chunk = bake.chunks[spec.chunkIndex]!;
    centre.addScaledVector(new Vector3(...chunk.pivot), chunk.volume);
    volume += chunk.volume;
  }
  if (volume > 0) centre.divideScalar(volume);
  return centre.applyMatrix4(composeTransformMatrix([...placement.position], [...placement.rotation], [...placement.scale])).toArray();
}

/** Registers pure fracture state, spawn planning and chunk budget regression tests. */
export function registerFractureRuntimeTests(check: Check): void {
  const bake = bakeFracture(box(), { seed: 17, cellCount: 8, totalMass: 24 });

  check("fracture runtime: disabled definitions and placement overrides do not register", () => {
    const registry = new FractureRegistry();
    assert.equal(registry.register("disabled", definition({ enabled: false })), false);
    assert.equal(registry.register("disabled", definition({ enabled: false }), { enabled: true }), false);
    assert.equal(registry.register("override", definition(), { enabled: false }), false);
    assert.deepEqual(registry.ids(), []);
    assert.equal(registry.has("disabled"), false);
    assert.equal(registry.has("override"), false);
    registry.register("disabled", definition());
    assert.equal(registry.register("disabled", definition({ enabled: false })), false);
    assert.equal(registry.has("disabled"), false);
    registry.register("override", definition());
    assert.equal(registry.register("override", definition(), { enabled: false }), false);
    assert.equal(registry.has("override"), false);
  });

  check("fracture runtime: valid threshold overrides win and invalid ones use the asset", () => {
    const registry = new FractureRegistry();
    const def = definition();
    registry.register("crate", def, { breakImpulse: 7 });
    assert.equal(registry.def("crate"), def);
    assert.equal(registry.breakImpulse("crate"), 7);
    assert.equal(registry.applyImpact("crate", 6), false);
    assert.equal(registry.applyImpact("crate", 7), true);
    for (const threshold of [-1, NaN, Infinity, -Infinity]) {
      registry.register("crate", def, { breakImpulse: threshold });
      assert.equal(registry.breakImpulse("crate"), def.breakImpulse);
      assert.equal(registry.applyImpact("crate", def.breakImpulse - 1), false);
      assert.equal(registry.applyImpact("crate", def.breakImpulse), true);
    }
    registry.register("crate", def, { breakImpulse: 0 });
    assert.equal(registry.breakImpulse("crate"), 0);
    assert.equal(registry.applyImpact("crate", 0), true);
  });

  check("fracture runtime: finite impacts break at the threshold exactly once", () => {
    const registry = new FractureRegistry();
    const def = definition();
    registry.register("crate", def);
    assert.equal(registry.state("crate"), "intact");
    for (const impulse of [NaN, Infinity, -Infinity, -1, def.breakImpulse - 0.001]) {
      assert.equal(registry.applyImpact("crate", impulse), false);
      assert.equal(registry.state("crate"), "intact");
    }
    assert.equal(registry.applyImpact("crate", def.breakImpulse), true);
    assert.equal(registry.state("crate"), "fractured");
    assert.equal(registry.applyImpact("crate", def.breakImpulse * 10), false);
    assert.equal(registry.requestBreak("crate"), false);
  });

  check("fracture runtime: damage accumulates and breaks on reaching or crossing the threshold", () => {
    const registry = new FractureRegistry();
    registry.register("crate", definition({ damageToBreak: 10 }));
    for (const amount of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(registry.applyDamage("crate", amount), false);
      assert.equal(registry.damage("crate"), 0);
    }
    assert.equal(registry.applyDamage("crate", 4), false);
    assert.equal(registry.damage("crate"), 4);
    assert.equal(registry.applyDamage("crate", 5), false);
    assert.equal(registry.damage("crate"), 9);
    assert.equal(registry.applyDamage("crate", 1), true);
    assert.equal(registry.damage("crate"), 10);
    assert.equal(registry.applyDamage("crate", 100), false);
    assert.equal(registry.damage("crate"), 10);
    assert.equal(registry.applyImpact("crate", 100), false);
    registry.register("crossing", definition({ damageToBreak: 10 }));
    assert.equal(registry.applyDamage("crossing", 11), true);
    assert.equal(registry.damage("crossing"), 11);
  });

  check("fracture runtime: null damage threshold accumulates without breaking", () => {
    const registry = new FractureRegistry();
    registry.register("crate", definition({ damageToBreak: null }));
    assert.equal(registry.applyDamage("crate", 1000000), false);
    assert.equal(registry.applyDamage("crate", 1), false);
    assert.equal(registry.damage("crate"), 1000001);
    assert.equal(registry.state("crate"), "intact");
    assert.equal(registry.requestBreak("crate"), true);
    assert.equal(registry.applyDamage("crate", 1), false);
    assert.equal(registry.damage("crate"), 1000001);
  });

  check("fracture runtime: scripted and restored breaks suppress all later triggers", () => {
    const registry = new FractureRegistry();
    registry.register("scripted", definition({ damageToBreak: 1 }));
    assert.equal(registry.requestBreak("scripted"), true);
    assert.equal(registry.requestBreak("scripted"), false);
    registry.register("restored", definition({ damageToBreak: 1 }));
    registry.markFractured("restored");
    registry.markFractured("restored");
    for (const id of registry.ids()) {
      assert.equal(registry.state(id), "fractured");
      assert.equal(registry.requestBreak(id), false);
      assert.equal(registry.applyImpact(id, 100), false);
      assert.equal(registry.applyDamage(id, 100), false);
      assert.equal(registry.damage(id), 0);
    }
  });

  check("fracture runtime: registration resets state and damage, with ordered ids and cleanup", () => {
    const registry = new FractureRegistry();
    registry.register("b", definition({ damageToBreak: 10 }), { breakImpulse: 1 });
    registry.register("a", definition());
    registry.applyDamage("b", 3);
    registry.requestBreak("b");
    const replacement = definition({ breakImpulse: 40 });
    assert.equal(registry.register("b", replacement), true);
    assert.equal(registry.state("b"), "intact");
    assert.equal(registry.damage("b"), 0);
    assert.equal(registry.breakImpulse("b"), 40);
    assert.equal(registry.def("b"), replacement);
    assert.deepEqual(registry.ids(), ["b", "a"]);
    registry.unregister("b");
    assert.equal(registry.has("b"), false);
    registry.register("b", definition());
    assert.deepEqual(registry.ids(), ["a", "b"]);
    registry.clear();
    assert.deepEqual(registry.ids(), []);
    assert.equal(registry.has("a"), false);
    assert.equal(registry.state("a"), null);
    assert.equal(registry.def("a"), null);
    assert.equal(registry.breakImpulse("a"), null);
    assert.equal(registry.damage("a"), 0);
    assert.equal(registry.applyImpact("a", 100), false);
    assert.equal(registry.applyDamage("a", 100), false);
    assert.equal(registry.requestBreak("a"), false);
    registry.markFractured("a");
    registry.unregister("a");
    assert.deepEqual(registry.ids(), []);
  });

  check("fracture runtime: spawn budget keeps largest volumes in ascending chunk index", () => {
    assert.ok(bake.chunks.length > 3);
    const def = definition({ maxActiveChunks: 3 });
    const expected = bake.chunks.map((chunk, index) => ({ volume: chunk.volume, index }))
      .sort((a, b) => b.volume - a.volume || a.index - b.index)
      .slice(0, 3).map(({ index }) => index).sort((a, b) => a - b);
    const specs = planChunkSpawns(bake, def, identity, velocity, null);
    assert.deepEqual(specs.map((spec) => spec.chunkIndex), expected);
    assert.deepEqual(specs.map((spec) => spec.chunkId), expected.map((index) => bake.chunks[index]!.id));
    const tied = { ...bake, chunks: bake.chunks.map((chunk) => ({ ...chunk, volume: 1 })) };
    assert.deepEqual(planChunkSpawns(tied, def, identity, velocity, null).map((spec) => spec.chunkIndex), [0, 1, 2]);
    assert.deepEqual(planChunkSpawns({ ...bake, chunks: [] }, def, identity, velocity, null), []);
  });

  check("fracture runtime: identity preserves pivots, hulls and masses with independent copies", () => {
    const specs = planChunkSpawns(bake, definition(), identity, velocity, null);
    assert.equal(specs.length, bake.chunks.length);
    // Shares of the whole baked volume (crumble threshold input): they sum to one.
    close(specs.reduce((sum, spec) => sum + spec.volumeFraction, 0), 1);
    for (const spec of specs) {
      const chunk = bake.chunks[spec.chunkIndex]!;
      close(spec.volumeFraction, chunk.volume / bake.chunks.reduce((sum, item) => sum + item.volume, 0));
      close3(spec.position, chunk.pivot);
      assert.deepEqual(spec.hull, chunk.hull);
      close(spec.massKg, chunk.mass);
      assert.deepEqual(spec.rotation, identity.rotation);
      assert.deepEqual(spec.scale, identity.scale);
      assert.deepEqual(spec.linearVelocity, velocity);
      assert.notEqual(spec.position, chunk.pivot);
      assert.notEqual(spec.hull, chunk.hull);
      for (let index = 0; index < chunk.hull.length; index += 1) assert.notEqual(spec.hull[index], chunk.hull[index]);
      assert.notEqual(spec.rotation, identity.rotation);
      assert.notEqual(spec.scale, identity.scale);
      assert.notEqual(spec.linearVelocity, velocity);
    }
    assert.notEqual(specs[0]!.linearVelocity, specs[1]!.linearVelocity);
    assert.notEqual(specs[0]!.rotation, specs[1]!.rotation);
    assert.notEqual(specs[0]!.scale, specs[1]!.scale);
  });

  check("fracture runtime: XYZ rotation and nonuniform scale agree with Forge transform matrices", () => {
    for (const scale of [transformed.scale, [-2, 3, 0.5] as const]) {
      const placement = { ...transformed, scale };
      const matrix = composeTransformMatrix([...placement.position], [...placement.rotation], [...scale]);
      const specs = planChunkSpawns(bake, definition(), placement, velocity, null);
      for (const spec of specs) {
        const chunk = bake.chunks[spec.chunkIndex]!;
        close3(spec.position, new Vector3(...chunk.pivot).applyMatrix4(matrix).toArray());
        for (let index = 0; index < chunk.hull.length; index += 1) {
          const point = chunk.hull[index]!;
          close3(spec.hull[index]!, [point[0] * scale[0], point[1] * scale[1], point[2] * scale[2]]);
        }
        close(spec.massKg, chunk.mass * Math.abs(scale[0] * scale[1] * scale[2]));
        assert.deepEqual(spec.rotation, placement.rotation);
        assert.deepEqual(spec.scale, scale);
        assert.deepEqual(spec.linearVelocity, velocity);
      }
    }
  });

  check("fracture runtime: degenerate scale clamps every chunk mass to the minimum", () => {
    const specs = planChunkSpawns(bake, definition(), { ...identity, scale: [0, 0, 0] }, velocity, null);
    for (const spec of specs) {
      assert.equal(spec.massKg, FRACTURE_MIN_CHUNK_MASS);
      close3(spec.position, [0, 0, 0]);
      for (const point of spec.hull) close3(point, [0, 0, 0]);
      close3(spec.impulse, [0, FRACTURE_MIN_CHUNK_MASS * FRACTURE_SCRIPTED_BREAK_SPEED, 0]);
    }
  });

  check("fracture runtime: impact kicks point away from contact with the documented speed", () => {
    const def = definition({ maxActiveChunks: 3 });
    const point: FractureVec3 = [-4, -2, 7];
    const massScale = Math.abs(transformed.scale[0] * transformed.scale[1] * transformed.scale[2]);
    const keptMass = [...bake.chunks].sort((a, b) => b.volume - a.volume).slice(0, 3)
      .reduce((sum, chunk) => sum + Math.max(FRACTURE_MIN_CHUNK_MASS, chunk.mass * massScale), 0);
    const impulse = keptMass * 2;
    const specs = planChunkSpawns(bake, def, transformed, velocity, { point, impulse });
    const speed = 0.5 * Math.min(FRACTURE_MAX_BREAK_SPEED, impulse / keptMass);
    close(speed, 1);
    assertKick(specs, point, speed);
  });

  check("fracture runtime: large hits cap outward speed before halving it", () => {
    const point: FractureVec3 = [4, -1, 3];
    const specs = planChunkSpawns(bake, definition(), transformed, velocity, { point, impulse: 1000000 });
    assertKick(specs, point, 0.5 * FRACTURE_MAX_BREAK_SPEED);
  });

  check("fracture runtime: scripted and null-contact kicks use the kept volume centre", () => {
    const def = definition({ maxActiveChunks: 3 });
    const scripted = planChunkSpawns(bake, def, transformed, velocity, null);
    const origin = volumeCentre(scripted, bake, transformed);
    assertKick(scripted, origin, FRACTURE_SCRIPTED_BREAK_SPEED);
    const mass = scripted.reduce((sum, spec) => sum + spec.massKg, 0);
    const impact = planChunkSpawns(bake, def, transformed, velocity, { point: null, impulse: mass * 4 });
    assertKick(impact, origin, 2);
  });

  check("fracture runtime: invalid impact strengths give zero kick and coincident points push up", () => {
    const def = definition();
    for (const impulse of [0, -1, NaN, Infinity, -Infinity]) {
      const specs = planChunkSpawns(bake, def, transformed, velocity, { point: null, impulse });
      for (const spec of specs) close3(spec.impulse, [0, 0, 0]);
    }
    const first = bake.chunks[0]!;
    const single = { ...bake, chunks: [first] };
    const scripted = planChunkSpawns(single, def, identity, velocity, null);
    close3(scripted[0]!.impulse, [0, first.mass * FRACTURE_SCRIPTED_BREAK_SPEED, 0]);
    const point: FractureVec3 = [first.pivot[0] + 1e-10, first.pivot[1], first.pivot[2]];
    const hit = planChunkSpawns(single, def, identity, velocity, { point, impulse: first.mass * 2 });
    close3(hit[0]!.impulse, [0, first.mass, 0]);
  });

  check("fracture runtime: smaller chunks have shorter lifetimes based on the kept mean", () => {
    const def = definition({ chunkLifetime: 10, maxActiveChunks: 5 });
    const specs = planChunkSpawns(bake, def, identity, velocity, null);
    const mean = specs.reduce((sum, spec) => sum + bake.chunks[spec.chunkIndex]!.volume, 0) / specs.length;
    assert.ok(specs.some((spec) => bake.chunks[spec.chunkIndex]!.volume < mean));
    assert.ok(specs.some((spec) => bake.chunks[spec.chunkIndex]!.volume >= mean));
    for (const spec of specs) {
      const volume = bake.chunks[spec.chunkIndex]!.volume;
      close(spec.lifetime, 10 * (0.5 + 0.5 * Math.min(1, volume / mean)));
    }
    for (const spec of planChunkSpawns(bake, definition({ chunkLifetime: 0 }), identity, velocity, null)) {
      assert.equal(spec.lifetime, Infinity);
    }
    const zeroVolume = { ...bake, chunks: bake.chunks.map((chunk) => ({ ...chunk, volume: 0 })) };
    for (const spec of planChunkSpawns(zeroVolume, def, identity, velocity, null)) assert.equal(spec.lifetime, 10);
  });

  check("fracture runtime: spawn planning is deterministic and leaves all inputs unchanged", () => {
    const def = definition({ maxActiveChunks: 4 });
    const impact = { point: [2, 3, 4] as const, impulse: 123 };
    const before = structuredClone({ bake, def, placement: transformed, velocity, impact });
    const first = planChunkSpawns(bake, def, transformed, velocity, impact);
    const second = planChunkSpawns(bake, def, transformed, velocity, impact);
    assert.deepEqual(first, second);
    assert.notEqual(first[0]!.position, second[0]!.position);
    assert.deepEqual({ bake, def, placement: transformed, velocity, impact }, before);
  });

  check("fracture runtime: expiration includes the boundary in birth order and keeps Infinity", () => {
    const budget = new ChunkBudget();
    budget.add(live("late", 3, 5));
    budget.add(live("tie-first", 1, 5));
    budget.add(live("oldest", 0, 4));
    budget.add(live("tie-second", 1, 2));
    budget.add(live("permanent", -1));
    budget.add(live("future", 2, 6));
    assert.equal(budget.size, 6);
    assert.deepEqual(budget.expire(1), []);
    assert.deepEqual(budget.expire(5), ["oldest", "tie-first", "tie-second", "late"]);
    assert.deepEqual(budget.ids(), ["permanent", "future"]);
    assert.equal(budget.size, 2);
    assert.deepEqual(budget.expire(Infinity), ["future"]);
    assert.deepEqual(budget.ids(), ["permanent"]);
  });

  check("fracture runtime: count budget floors caps and evicts oldest with insertion ties", () => {
    const budget = new ChunkBudget();
    budget.add(live("new", 4));
    budget.add(live("tie-first", 2));
    budget.add(live("oldest", 1));
    budget.add(live("tie-second", 2));
    assert.deepEqual(budget.ids(), ["oldest", "tie-first", "tie-second", "new"]);
    assert.deepEqual(budget.enforce(Infinity), []);
    assert.deepEqual(budget.enforce(2.9), ["oldest", "tie-first"]);
    assert.equal(budget.size, 2);
    assert.deepEqual(budget.enforce(2), []);
    assert.deepEqual(budget.enforce(0), ["tie-second", "new"]);
    assert.equal(budget.size, 0);
    budget.add(live("negative", 0));
    assert.deepEqual(budget.enforce(-1), ["negative"]);
  });

  check("fracture runtime: owner cleanup and clear return ids in birth order", () => {
    const budget = new ChunkBudget();
    budget.add(live("a-new", 3));
    budget.add(live("b", 2, Infinity, "wall"));
    budget.add(live("a-old", 1));
    budget.add(live("c", 0, Infinity, "panel"));
    assert.deepEqual(budget.removeOwner("missing"), []);
    assert.deepEqual(budget.removeOwner("crate"), ["a-old", "a-new"]);
    assert.deepEqual(budget.ids(), ["c", "b"]);
    assert.equal(budget.size, 2);
    assert.deepEqual(budget.clear(), ["c", "b"]);
    assert.deepEqual(budget.clear(), []);
    assert.deepEqual(budget.ids(), []);
    assert.equal(budget.size, 0);
  });

  check("fracture runtime: adding an existing id replaces its owner, lifetime and insertion", () => {
    const budget = new ChunkBudget();
    budget.add(live("replaced", 1, 2));
    budget.add(live("peer", 1));
    budget.add(live("replaced", 1, 10, "wall"));
    assert.equal(budget.size, 2);
    assert.deepEqual(budget.ids(), ["peer", "replaced"]);
    assert.deepEqual(budget.expire(2), []);
    assert.deepEqual(budget.removeOwner("crate"), ["peer"]);
    assert.deepEqual(budget.expire(10), ["replaced"]);
    budget.add(live("replaced", 5));
    budget.add(live("older", 2));
    assert.deepEqual(budget.ids(), ["older", "replaced"]);
    assert.equal(budget.remove("replaced"), true);
    assert.equal(budget.remove("replaced"), false);
    assert.equal(budget.remove("missing"), false);
    assert.equal(budget.size, 1);
    assert.deepEqual(budget.ids(), ["older"]);
  });
}
