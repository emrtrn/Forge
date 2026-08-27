/**
 * Phase E: the baked runtime subsystems now live in Layer 2 capability modules.
 *
 * These checks pin the two properties the extraction has to preserve — the tick
 * order stays a declared contract, and switching a module off removes only its
 * behavior — plus the loose service coupling the modules use instead of holding
 * references to each other.
 */
import assert from "node:assert/strict";

import type { Subsystem } from "../../engine/core/Subsystem";
import type { Entity } from "../../engine/scene/entity";
import { createDefaultSplineActor } from "../../engine/scene/splineActor";
import { createSplineRegistry } from "../../engine/scene/splineRegistry";
import type { CapabilityModule } from "../../src/scene/capabilities/CapabilityModule";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createDefaultRuntimeModules } from "../../src/scene/capabilities/defaultRuntimeModules";
import { createMovingPlatformModule } from "../../src/scene/capabilities/movingPlatformModule";
import { createSplineFollowerModule } from "../../src/scene/capabilities/splineFollowerModule";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  characterTransformResetService,
  movingPlatformQueryService,
  splineFollowerDebugService,
  splineRegistrySourceService,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import type { SceneEntitySink } from "../../src/scene/SceneRuntimeCore";

type Check = (label: string, fn: () => void) => void;

interface TestRuntime {
  readonly host: RuntimeServiceHost;
  /** Subsystem ids in the order the engine app would tick them. */
  readonly tickOrder: string[];
  readonly synced: { id: string; position: readonly number[] }[];
  /** Feeds a level's entity set to every module sink, as the shell does. */
  loadLevel(entities: readonly Entity[]): void;
  /** Level Travel teardown, through the registry (reverse registration order). */
  unloadLevel(): void;
  tick(deltaSeconds: number): void;
}

/**
 * A miniature RuntimeSceneApp: the same attach → install → feed → tick sequence
 * the real shell runs, with the engine app replaced by an id log.
 */
function startTestRuntime(modules: readonly CapabilityModule[]): TestRuntime {
  const synced: { id: string; position: readonly number[] }[] = [];
  const host = createRuntimeServiceHost({
    syncEntityTransform: (entityId, transform) =>
      synced.push({ id: entityId, position: [...transform.position] }),
  });
  const registry = createCapabilityRegistry(modules);
  registry.runtimeStart(host);
  const installed: Subsystem[] = [];
  host.installSubsystems((subsystem) => installed.push(subsystem));
  return {
    host,
    tickOrder: installed.map((subsystem) => subsystem.id),
    synced,
    loadLevel(entities) {
      for (const sink of host.entitySinks() as readonly SceneEntitySink[]) {
        sink.setEntities(entities);
      }
    },
    unloadLevel() {
      registry.levelUnloaded();
    },
    tick(deltaSeconds) {
      let frame = 0;
      for (const subsystem of installed) {
        frame += 1;
        subsystem.update?.({ deltaSeconds, elapsedSeconds: deltaSeconds, frame });
      }
    },
  };
}

function platformEntity(id: string): Entity {
  return {
    id,
    components: {
      Transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [2, 0.5, 2], isStatic: true, isSensor: false },
      MovingPlatform: { offset: [4, 0, 0], speed: 2, startPhase: 0 },
    },
  } as unknown as Entity;
}

function followerEntity(id: string, splineId: string): Entity {
  return {
    id,
    components: {
      Transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] },
      SplinePathFollower: { splineId, speed: 4, startDistance: 0, wrapMode: "loop" },
    },
  } as unknown as Entity;
}

export function registerRuntimeCapabilityModuleTests(check: Check): void {
  check("tick slots order subsystems by meaning, not by registration sequence", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const stub = (id: string): Subsystem => ({ id });
    // Queued deliberately out of order — the slot decides.
    host.addSubsystem("presentation", stub("vfx"));
    host.addSubsystem("post-movement", stub("splineFollower"));
    host.addSubsystem("pre-physics", stub("animation"));
    host.addSubsystem("movement", stub("characterMovement"));
    host.addSubsystem("platform", stub("movingPlatform"));
    host.addSubsystem("physics", stub("physics"));
    host.addSubsystem("decision", stub("ai"));
    host.addSubsystem("gameplay", stub("behavior"));
    const order: string[] = [];
    host.installSubsystems((subsystem) => order.push(subsystem.id));
    assert.deepEqual(order, [
      "animation",
      "physics",
      "movingPlatform",
      "ai",
      "characterMovement",
      "splineFollower",
      "behavior",
      "vfx",
    ]);
  });

  check("a subsystem queued after the tick order is installed fails loudly", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    host.installSubsystems(() => {});
    assert.throws(
      () => host.addSubsystem("gameplay", { id: "late" }),
      /queued after the tick order was installed/,
    );
  });

  check("a duplicate runtime service is a wiring error, not a silent replacement", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    host.provide(splineRegistrySourceService, () => createSplineRegistry());
    assert.throws(
      () => host.provide(splineRegistrySourceService, () => createSplineRegistry()),
      /Duplicate runtime service/,
    );
  });

  check("the default module set keeps the runtime's authored tick order", () => {
    // Only the modules that register a subsystem without a host service appear:
    // character movement and AI both need one, and this bare runtime has neither.
    const runtime = startTestRuntime(createDefaultRuntimeModules());
    assert.deepEqual(runtime.tickOrder, [
      "movingPlatform",
      "splinePathFollower",
      "audio",
      "dialogue",
    ]);
  });

  check("moving-platform module drives platforms and publishes them to the solver", () => {
    const runtime = startTestRuntime([createMovingPlatformModule()]);
    const query = runtime.host.resolve(movingPlatformQueryService);
    assert.ok(query, "the module publishes the platform query the solver reads");
    runtime.loadLevel([platformEntity("lift")]);
    assert.equal(query.platforms().length, 1);
    assert.deepEqual(query.platforms()[0]?.delta, [0, 0, 0], "the setup frame is at rest");

    runtime.tick(0.5);
    const moved = runtime.synced.at(-1);
    assert.equal(moved?.id, "lift");
    assert.ok((moved?.position[0] ?? 0) > 0, "the platform advanced along its segment");
    assert.ok((query.platforms()[0]?.delta[0] ?? 0) > 0, "and reports a carry delta");
  });

  check("a level unload drops the module's platforms so the empty world ticks nothing", () => {
    const runtime = startTestRuntime([createMovingPlatformModule()]);
    runtime.loadLevel([platformEntity("lift")]);
    assert.equal(runtime.host.resolve(movingPlatformQueryService)?.platforms().length, 1);
    runtime.unloadLevel();
    assert.equal(runtime.host.resolve(movingPlatformQueryService)?.platforms().length, 0);
  });

  check("spline-follower module reads the host's registry and the character reset lazily", () => {
    const runtime = startTestRuntime([createSplineFollowerModule()]);
    const rail = createDefaultSplineActor();
    rail.id = "rail";
    rail.spline.points[1]!.position = [0, 0, 8];
    // Both services are published *after* the module attached, exactly as they
    // are in the shell (the registry is rebuilt per level).
    const reset: string[] = [];
    runtime.host.provide(splineRegistrySourceService, () => createSplineRegistry([rail]));
    runtime.host.provide(characterTransformResetService, (entityId) => reset.push(entityId));

    runtime.loadLevel([followerEntity("cart", "rail")]);
    runtime.tick(0.5);
    const moved = runtime.synced.at(-1);
    assert.equal(moved?.id, "cart");
    assert.deepEqual(moved?.position, [0, 0, 2], "the follower sampled its spline");
    assert.deepEqual(reset, ["cart"], "and reset the movement solver's stale copy first");
    assert.equal(runtime.host.resolve(splineFollowerDebugService)?.followers().length, 1);
  });

  check("spline followers still move when no character-movement service exists", () => {
    // The character-free case (an RTS): nothing provides the reset service, and
    // writing the sampled transform straight through is the correct behavior.
    const runtime = startTestRuntime([createSplineFollowerModule()]);
    const rail = createDefaultSplineActor();
    rail.id = "rail";
    rail.spline.points[1]!.position = [0, 0, 8];
    runtime.host.provide(splineRegistrySourceService, () => createSplineRegistry([rail]));
    runtime.loadLevel([followerEntity("cart", "rail")]);
    runtime.tick(0.5);
    assert.deepEqual(runtime.synced.at(-1)?.position, [0, 0, 2]);
  });

  check("a module set without the follower module reports no followers at all", () => {
    const runtime = startTestRuntime([createMovingPlatformModule()]);
    assert.equal(runtime.host.resolve(splineFollowerDebugService), undefined);
    assert.deepEqual(runtime.tickOrder, ["movingPlatform"]);
  });
}
