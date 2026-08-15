import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { Entity } from "../../engine/scene/entity";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import type { AssetLoader } from "../../src/scene/assetLoader";
import type { CapabilityModule } from "../../src/scene/capabilities/CapabilityModule";
import {
  CapabilityRegistry,
  createCapabilityRegistry,
} from "../../src/scene/capabilities/capabilityRegistry";
import {
  createRuntimeContext,
  type RuntimeContext,
} from "../../src/scene/capabilities/RuntimeContext";

type Check = (label: string, fn: () => void) => void;

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

function entity(id: string): Entity {
  return { id, components: {} };
}

function testContext(entities: Entity[] = []): RuntimeContext {
  const sceneDocument = {
    schema: 1,
    name: "test",
    entities,
  } as unknown as SceneDocument;
  return createRuntimeContext({
    mode: "runtime",
    levelPath: "layouts/test.json",
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: new EngineApp(),
    assetLoader: {} as AssetLoader,
    layout: { name: "test" } as unknown as RoomLayout,
    sceneDocument,
  });
}

/** Records every lifecycle hook it receives, and optionally throws in one of them. */
function recordingModule(
  id: string,
  calls: string[],
  throwIn?: "onLevelLoaded" | "update",
): CapabilityModule {
  return {
    id,
    onLevelLoaded: () => {
      calls.push(`${id}:loaded`);
      if (throwIn === "onLevelLoaded") throw new Error(`${id} failed`);
    },
    onLevelUnloaded: () => calls.push(`${id}:unloaded`),
    update: () => {
      calls.push(`${id}:update`);
      if (throwIn === "update") throw new Error(`${id} failed`);
    },
    dispose: () => calls.push(`${id}:disposed`),
  };
}

/** Silences the registry's quarantine report while a test drives a failing module. */
async function withSilencedErrors(run: () => Promise<void>): Promise<void> {
  const original = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = original;
  }
}

export async function registerCapabilityRegistryTests(
  check: Check,
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("empty capability registry runs the whole lifecycle as a no-op", async () => {
    const registry = createCapabilityRegistry();
    assert.equal(registry.size, 0);
    assert.deepEqual(registry.ids(), []);
    await registry.levelLoaded(testContext());
    registry.update(0.016);
    registry.levelUnloaded();
    registry.dispose();
  });

  await checkAsync("capability modules set up in registration order and tear down in reverse", async () => {
    const calls: string[] = [];
    const registry = createCapabilityRegistry([
      recordingModule("first", calls),
      recordingModule("second", calls),
    ]);
    assert.deepEqual(registry.ids(), ["first", "second"]);
    await registry.levelLoaded(testContext());
    registry.update(0.5);
    registry.levelUnloaded();
    registry.dispose();
    assert.deepEqual(calls, [
      "first:loaded",
      "second:loaded",
      "first:update",
      "second:update",
      "second:unloaded",
      "first:unloaded",
      "second:disposed",
      "first:disposed",
    ]);
  });

  check("capability registry rejects duplicate module ids instead of dropping one", () => {
    const registry = new CapabilityRegistry();
    registry.register({ id: "dialogue" });
    assert.throws(() => registry.register({ id: "dialogue" }), /Duplicate capability module id/);
    assert.equal(registry.size, 1);
    assert.ok(registry.has("dialogue"));
  });

  await checkAsync("a module that throws is quarantined, the rest of the level still loads", async () => {
    const calls: string[] = [];
    const registry = createCapabilityRegistry([
      recordingModule("broken", calls, "onLevelLoaded"),
      recordingModule("healthy", calls),
    ]);
    await withSilencedErrors(async () => {
      await registry.levelLoaded(testContext());
      registry.update(0.016);
    });
    assert.deepEqual(calls, ["broken:loaded", "healthy:loaded", "healthy:update"]);
  });

  await checkAsync("a module that throws while ticking stops ticking, others keep running", async () => {
    const calls: string[] = [];
    const registry = createCapabilityRegistry([
      recordingModule("broken", calls, "update"),
      recordingModule("healthy", calls),
    ]);
    await withSilencedErrors(async () => {
      await registry.levelLoaded(testContext());
      registry.update(0.016);
      registry.update(0.016);
    });
    assert.deepEqual(calls, [
      "broken:loaded",
      "healthy:loaded",
      "broken:update",
      "healthy:update",
      "healthy:update",
    ]);
  });

  await checkAsync("a fresh level load clears quarantine so a module gets another chance", async () => {
    const calls: string[] = [];
    const registry = createCapabilityRegistry([recordingModule("flaky", calls, "update")]);
    await withSilencedErrors(async () => {
      await registry.levelLoaded(testContext());
      registry.update(0.016);
      registry.update(0.016);
      await registry.levelLoaded(testContext());
      registry.update(0.016);
    });
    assert.deepEqual(calls, [
      "flaky:loaded",
      "flaky:update",
      "flaky:loaded",
      "flaky:update",
    ]);
  });

  await checkAsync("capability registry awaits async module setup before returning", async () => {
    const calls: string[] = [];
    const slow: CapabilityModule = {
      id: "slow",
      onLevelLoaded: async () => {
        await Promise.resolve();
        calls.push("slow:loaded");
      },
    };
    const registry = createCapabilityRegistry([slow, recordingModule("after", calls)]);
    await registry.levelLoaded(testContext());
    assert.deepEqual(calls, ["slow:loaded", "after:loaded"]);
  });

  check("runtime context exposes the built level's entities by id", () => {
    const context = testContext([entity("a"), entity("b")]);
    assert.equal(context.mode, "runtime");
    assert.equal(context.levelPath, "layouts/test.json");
    assert.equal(context.entities.length, 2);
    assert.equal(context.entity("b")?.id, "b");
    assert.equal(context.entity("missing"), undefined);
  });

  check("disposed capability registry refuses further registration", () => {
    const registry = new CapabilityRegistry();
    registry.dispose();
    assert.throws(() => registry.register({ id: "late" }), /disposed registry/);
  });
}
