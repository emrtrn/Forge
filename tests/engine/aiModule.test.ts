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
}
