/**
 * Phase E: AI is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach, prepare a
 * level, feed it entities, load the level, tear it down — with each host service
 * stubbed, and pin the degraded paths that make the capability optional: a
 * runtime with no AI host, and a level with no message bus.
 */
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { Subsystem } from "../../engine/core/Subsystem";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { AISubsystem } from "../../engine/ai/aiSubsystem";
import { normalizeAiBehaviorTreeAsset } from "../../engine/ai/behaviorAsset";
import { normalizeAiStateTreeAsset } from "../../engine/ai/stateTreeAsset";
import { SmartObjectReservationStore } from "../../engine/ai/smartObjects";
import type { ScriptMessageEnvelope } from "../../engine/behavior/scriptMessages";
import { AI_CONTROLLER_COMPONENT, TRANSFORM_COMPONENT } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createAiModule } from "../../src/scene/capabilities/aiModule";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  aiCommandsService,
  aiDebugService,
  aiHostService,
  assetManifestService,
  characterMovementQueryService,
  scriptMessageBusService,
  type AiHost,
  type ScriptMessageBus,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

const BEHAVIOR_TREE = {
  schema: 1,
  type: "behaviorTree",
  id: "BT_Guard",
  root: { kind: "wait", seconds: 1 },
};

const MANIFEST = {
  assets: [
    { id: "BT_Guard", type: "behaviorTree", path: "AI/BT_Guard.behaviortree.json" },
    { id: "SM_Rock", type: "model", path: "Meshes/SM_Rock.glb" },
  ],
};

/** One AI Navigation Volume, so the nav bounds are derived from real authoring. */
const LAYOUT = {
  name: "test",
  aiNavigationVolumes: [
    { id: "nav-1", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], size: [10, 4, 10] },
  ],
  targetPoints: [{ id: "TP_A", position: [1, 0, 1] }],
} as unknown as RoomLayout;

/** Serves the behavior tree above; anything else 404s, as in a real project. */
async function withStubbedFetch(run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (!url.includes("BT_Guard")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => BEHAVIOR_TREE } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** A message bus that records its live subscriptions so teardown is observable. */
function testBus(): ScriptMessageBus & {
  send(type: string, payload: Record<string, unknown>): void;
  subscriptionCount(): number;
} {
  const handlers = new Map<string, ((envelope: ScriptMessageEnvelope) => void)[]>();
  return {
    subscribe(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
    },
    emit() {},
    send(type, payload) {
      for (const handler of handlers.get(type) ?? []) {
        handler({ type, source: "test", payload } as unknown as ScriptMessageEnvelope);
      }
    },
    subscriptionCount() {
      return [...handlers.values()].reduce((total, list) => total + list.length, 0);
    },
  };
}

const TRANSFORM = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

const NAV_BLOCKER = { min: [-1, 0, -1] as const, max: [1, 2, 1] as const };

function testAiHost(overrides: Partial<AiHost> = {}): AiHost {
  return {
    debug: false,
    navigation: {
      staticBlockerAabbs: () => [NAV_BLOCKER],
      staticNavigationBlockerAabbs: () => [NAV_BLOCKER],
      staticNavigationSurfaceTriangles: () => [],
      colliderHalfExtents: () => null,
    },
    qualityFocusPosition: () => null,
    reportIdleLocomotion: () => {},
    ...overrides,
  };
}

/** A possessed NPC pawn: the smallest entity that becomes an AI controller. */
function npc(id: string): Entity {
  return {
    id,
    name: id,
    components: {
      [TRANSFORM_COMPONENT]: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [AI_CONTROLLER_COMPONENT]: { behaviorTree: "BT_Guard" },
    },
  } as unknown as Entity;
}

function levelContext(host: RuntimeServiceHost, layout: RoomLayout, entities: readonly Entity[]) {
  return createRuntimeContext({
    mode: "runtime",
    levelPath: "layouts/test.json",
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: new EngineApp(),
    assetLoader: { loadManifest: async () => MANIFEST } as unknown as AssetLoader,
    layout,
    sceneDocument: { schema: 1, name: "test", entities } as unknown as SceneDocument,
    services: host,
  });
}

export async function registerAiModuleTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("incremental AI creates only new runners and preserves behavior and StateTree memory", async () => {
    const moves: string[] = [];
    const createAi = () => {
      const ai = new AISubsystem({
        taskRegistry: {
          get: () => (context) => {
            const ticks = Number(context.memory.get("ticks") ?? 0) + 1;
            context.memory.set("ticks", ticks);
            context.blackboard.set("ticks", ticks);
            return context.moveTo!({ controller: context.controller, position: [10, 0, 0] });
          },
        },
        moveTo: (request) => { moves.push(request.controller.pawnEntityId); return "running"; },
      });
      ai.setAssetLibrary({
        blackboards: new Map([["BB", { schema: 1, type: "blackboard", keys: [{ key: "ticks", kind: "number", default: 0 }] }]]),
        behaviors: new Map([["BT", normalizeAiBehaviorTreeAsset({
          schema: 1, type: "behaviorTree", blackboard: "BB", root: { kind: "task", task: "count" },
        })]]),
        stateTrees: new Map([["ST", normalizeAiStateTreeAsset({
          schema: 1, type: "stateTree", blackboard: "BB", states: [{ id: "active", tasks: [{ task: "count" }] }],
        })]]),
      });
      return ai;
    };
    const actor = (id: string, stateTree: boolean): Entity => ({
      ...npc(id),
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        AIController: {
          behaviorTree: "BT", ...(stateTree ? { stateTree: "ST" } : {}),
          perception: { sightRadius: 20, fieldOfViewDeg: 360 },
        },
      },
    });
    const tick = (ai: AISubsystem) => ai.update({ deltaSeconds: 0.1, elapsedSeconds: 0.1, frame: 1 });
    const ai = createAi();
    const fresh = createAi();
    ai.setEntities([actor("old-bt", false), actor("old-st", true)]);
    tick(ai);
    const oldController = ai.getControllerForPawn("old-bt")!;
    oldController.setGoal("keep this goal");
    ai.updateEntityTransform("old-bt", { ...TRANSFORM, position: [7, 0, 0] });
    const before = structuredClone(ai.getDebugSnapshot());
    const added = [actor("new-bt", false), actor("new-st", true)];
    fresh.setEntities(added);
    for (const entity of added) { ai.addEntity(entity); ai.addEntity(entity); }
    assert.equal(ai.getControllerForPawn("old-bt"), oldController);
    assert.deepEqual(ai.getDebugSnapshot().controllers.slice(0, 2), before.controllers);
    assert.deepEqual(ai.getDebugSnapshot().controllers.slice(2), fresh.getDebugSnapshot().controllers);
    tick(ai);
    tick(fresh);
    for (const id of ["old-bt", "old-st"]) {
      assert.equal(ai.getControllerForPawn(id)!.blackboard.get("ticks"), 2, "existing runner task memory survives");
    }
    const newRunnerMemory = (target: AISubsystem, offset: number) =>
      target.getDebugSnapshot().controllers.slice(offset).map((snapshot) => ({
        behavior: snapshot.behavior, stateTree: snapshot.stateTree, blackboard: snapshot.blackboard,
      }));
    assert.deepEqual(newRunnerMemory(ai, 2), newRunnerMemory(fresh, 0), "both runner kinds tick like freshly loaded controllers");
    const source: Entity = { id: "source", components: { Transform: { position: [0, 0, 4], rotation: [0, 0, 0], scale: [1, 1, 1] } } };
    ai.addEntity(source);
    tick(ai);
    assert.ok(ai.getControllerForPawn("old-bt")!.getPerception().some((stimulus) => stimulus.sourceEntityId === "source"));
    const survivor = structuredClone(ai.getDebugSnapshot().controllers[0]);
    ai.removeEntity("new-bt");
    ai.removeEntity("new-bt");
    ai.removeEntity("new-st");
    ai.removeEntity("source");
    ai.removeEntity("unknown");
    assert.deepEqual(ai.getDebugSnapshot().controllers[0], survivor);
    assert.equal(ai.getControllerForPawn("new-bt"), undefined);
    moves.length = 0;
    tick(ai);
    assert.deepEqual(moves, ["old-bt", "old-st"], "removed runners stop producing movement requests");
    assert.ok(!oldController.getPerception().some((stimulus) => stimulus.sourceEntityId === "source"));
    ai.dispose();
    fresh.dispose();
  });

  await checkAsync("incremental smart objects preserve other reservations and release removed owners and slots", async () => {
    const store = new SmartObjectReservationStore();
    const object = (id: string): Entity => ({ id, components: { SmartObject: { tags: ["seat"], slots: [{ id: "seat" }] } } });
    store.setEntities([object("old")]);
    assert.equal(store.claim({ entityId: "old", slotId: "seat", reservedBy: "keeper" }), true);
    const before = store.reservation("old", "seat");
    store.addEntity(object("new"));
    store.addEntity(object("new"));
    assert.equal(store.reservation("old", "seat"), before);
    assert.equal(store.claim({ entityId: "new", slotId: "seat", reservedBy: "npc" }), true);
    store.removeEntity("npc");
    assert.equal(store.reservation("new", "seat"), null, "removed NPC releases its claim on a surviving object");
    assert.equal(store.claim({ entityId: "new", slotId: "seat", reservedBy: "keeper" }), true);
    store.removeEntity("new");
    store.removeEntity("new");
    store.removeEntity("unknown");
    assert.equal(store.reservation("new", "seat"), null);
    assert.equal(store.claim({ entityId: "new", slotId: "seat", reservedBy: "npc" }), false);
    assert.equal(store.reservation("old", "seat"), before);
  });

  await checkAsync("AI module forwards incremental entities without resetting an existing controller", async () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    host.provide(aiHostService, testAiHost());
    const registry = createCapabilityRegistry([createAiModule()]);
    registry.runtimeStart(host);
    host.entitySinks()[0]!.setEntities([npc("old")]);
    host.resolve(aiCommandsService)!.updateEntityTransform("old", { ...TRANSFORM, position: [8, 0, 0] });
    const debug = host.resolve(aiDebugService)!;
    const before = structuredClone(debug.controllers().controllers[0]);
    host.addEntity(npc("new"));
    assert.equal(debug.controllers().controllerCount, 2);
    assert.deepEqual(debug.controllers().controllers[0], before);
    host.removeEntity("new");
    host.removeEntity("new");
    assert.deepEqual(debug.controllers().controllers, [before]);
    registry.dispose();
  });

  await checkAsync("ai module ticks in the decision slot and derives controllers from the level", async () => {
    await withStubbedFetch(async () => {
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      host.provide(aiHostService, testAiHost());
      host.provide(assetManifestService, async () => MANIFEST as never);

      const registry = createCapabilityRegistry([createAiModule()]);
      registry.runtimeStart(host);
      const installed: string[] = [];
      host.installSubsystems((subsystem) => installed.push(subsystem.id));
      assert.deepEqual(installed, ["ai"], "decisions tick before the movement slot");
      assert.equal(host.entitySinks().length, 1, "feeds itself the level's entity set");

      const commands = host.resolve(aiCommandsService);
      const debug = host.resolve(aiDebugService);
      assert.ok(commands && debug);

      // Before a level is prepared there is nothing to report, and every read
      // answers rather than throwing.
      assert.equal(debug.controllers().controllerCount, 0);
      assert.deepEqual(debug.navigation().bounds, [], "no layout yet, so no authored nav bounds");
      assert.equal(commands.moveIntentFor("npc:0", TRANSFORM, 0.016), null);

      // Assets and routes resolve before the entity set derives its controllers,
      // which is the order the shell is required to call these in.
      await commands.prepareLevel(LAYOUT);
      host.entitySinks()[0]!.setEntities([npc("npc:0"), npc("npc:1")]);
      assert.equal(debug.controllers().controllerCount, 2, "one controller per AI pawn");

      const navigation = debug.navigation();
      assert.deepEqual(navigation.blockers, [NAV_BLOCKER], "reads the host's nav world");
      assert.equal(navigation.bounds.length, 1, "the authored AI Navigation Volume");
      assert.equal(navigation.followers.length, 0, "nothing has been asked to move yet");

      // Level teardown empties the capability while the level it planned in is
      // still intact; the next level re-prepares and re-feeds it.
      registry.levelUnloaded();
      assert.equal(debug.controllers().controllerCount, 0);
      assert.deepEqual(debug.navigation().bounds, [], "the level's nav volumes went with it");
      registry.dispose();
    });
  });

  await checkAsync("ai module bridges script messages into stimuli and drops them on teardown", async () => {
    await withStubbedFetch(async () => {
      const bus = testBus();
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      host.provide(aiHostService, testAiHost());
      host.provide(assetManifestService, async () => MANIFEST as never);
      host.provide(scriptMessageBusService, bus);

      const registry = createCapabilityRegistry([createAiModule()]);
      registry.runtimeStart(host);
      host.installSubsystems(() => {});
      const commands = host.resolve(aiCommandsService)!;
      await commands.prepareLevel(LAYOUT);
      host.entitySinks()[0]!.setEntities([npc("npc:0")]);

      await registry.levelLoaded(levelContext(host, LAYOUT, [npc("npc:0")]));
      assert.equal(bus.subscriptionCount(), 6, "damage, death, alert, ui-action, game-event");

      // A stimulus off the bus is accepted rather than thrown away; the runner
      // consumes it on its next decision tick.
      bus.send("damage", { amount: 5 });
      assert.equal(host.resolve(aiDebugService)!.controllers().controllerCount, 1);

      registry.levelUnloaded();
      assert.equal(bus.subscriptionCount(), 0, "teardown releases every trigger");
      registry.dispose();
    });
  });

  await checkAsync("ai module runs a level with no message bus at all", async () => {
    await withStubbedFetch(async () => {
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      host.provide(aiHostService, testAiHost());
      // No `asset-manifest` either: a shell that publishes neither still boots
      // the capability, it simply has no authored trees to build runners from.
      const registry = createCapabilityRegistry([createAiModule()]);
      registry.runtimeStart(host);
      host.installSubsystems(() => {});

      const commands = host.resolve(aiCommandsService)!;
      await commands.prepareLevel(LAYOUT);
      host.entitySinks()[0]!.setEntities([npc("npc:0")]);
      await registry.levelLoaded(levelContext(host, LAYOUT, [npc("npc:0")]));

      // Perception still tracks the pawn, so a transform written outside the
      // solver must reach it whether or not anything else is wired up.
      commands.updateEntityTransform("npc:0", TRANSFORM);
      commands.setDistanceUpdateSettings({ farUpdateHz: 5 });
      assert.equal(host.resolve(aiDebugService)!.controllers().controllerCount, 1);
      registry.dispose();
    });
  });

  await checkAsync("a runtime with no AI host registers nothing at all", async () => {
    // The pawn-less / directly-commanded case (I3): no controller ever runs, the
    // movement solver is never handed an intent, and the shell's debug reads fall
    // back to their empty defaults.
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createAiModule()]);
    registry.runtimeStart(host);
    const installed: string[] = [];
    host.installSubsystems((subsystem) => installed.push(subsystem.id));

    assert.deepEqual(installed, []);
    assert.equal(host.entitySinks().length, 0);
    assert.equal(host.resolve(aiCommandsService), undefined);
    assert.equal(host.resolve(aiDebugService), undefined);
    registry.dispose();
  });

  await checkAsync("ai module plans moveTo through Recast when the host hands out collider triangles", async () => {
    const walkTree = {
      schema: 1,
      type: "behaviorTree",
      id: "BT_Walk",
      root: { kind: "task", task: "forge.moveToPosition", params: { position: [0, 0, 8] } },
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("BT_Walk")
        ? ({ ok: true, json: async () => walkTree } as unknown as Response)
        : ({ ok: false, json: async () => ({}) } as unknown as Response)) as typeof globalThis.fetch;
    try {
      // A real physics world: a ground slab and a wall between the pawn and its goal.
      const physics = new PhysicsSubsystem();
      const staticBox = (id: string, position: [number, number, number], size: [number, number, number]) => ({
        id,
        components: {
          [TRANSFORM_COMPONENT]: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
          Collider: { shape: "box", size, isStatic: true, isSensor: false },
        },
      }) as unknown as Entity;
      physics.setEntities([staticBox("ground", [0, -0.5, 0], [40, 1, 40]), staticBox("wall", [0, 1.5, 0], [12, 3, 1])]);

      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      host.provide(aiHostService, testAiHost({ navigation: physics }));
      host.provide(assetManifestService, async () => ({
        assets: [{ id: "BT_Walk", type: "behaviorTree", path: "AI/BT_Walk.behaviortree.json" }],
      }) as never);
      const pawnTransform = { position: [0, 0, -8] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
      host.provide(characterMovementQueryService, {
        transformOf: (entityId) => (entityId === "npc:0" ? pawnTransform : null),
        velocityOf: () => null,
        forEachCharacter: () => {},
        launch: () => {},
      });
      const registry = createCapabilityRegistry([createAiModule()]);
      registry.runtimeStart(host);
      const subsystems: Subsystem[] = [];
      host.installSubsystems((subsystem) => subsystems.push(subsystem));

      const layout = {
        name: "recast",
        aiNavigationVolumes: [
          { id: "nav", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], size: [30, 6, 30] },
        ],
      } as unknown as RoomLayout;
      const walker = {
        id: "npc:0",
        name: "npc:0",
        components: {
          [TRANSFORM_COMPONENT]: pawnTransform,
          [AI_CONTROLLER_COMPONENT]: { behaviorTree: "BT_Walk" },
        },
      } as unknown as Entity;
      await host.resolve(aiCommandsService)!.prepareLevel(layout);
      host.entitySinks()[0]!.setEntities([walker]);
      await registry.levelLoaded(levelContext(host, layout, [walker]));
      for (const subsystem of subsystems) subsystem.update?.({ deltaSeconds: 0.1, elapsedSeconds: 0.1, frame: 1 });

      const navigation = host.resolve(aiDebugService)!.navigation();
      assert.equal(navigation.planner, "recast");
      assert.ok((navigation.navMeshTiles ?? 0) > 0, "the request built the tiles it needed");
      const follower = navigation.followers.find((entry) => entry.entityId === "npc:0");
      assert.ok(follower, "the move request is being followed");
      assert.equal(follower.status, "following");
      const path = follower.path;
      assert.ok(path.length >= 3, `string-pulled around a wall end: ${JSON.stringify(path)}`);
      assert.ok(path.slice(1, -1).every((point) => Math.abs(point[0]) >= 6), "corners clear the wall's ends");
      assert.ok(path.every((point) => Math.abs(point[1]) < 1e-3), "corners snapped onto the ground's top");
      registry.dispose();
    } finally {
      globalThis.fetch = original;
    }
  });
}
