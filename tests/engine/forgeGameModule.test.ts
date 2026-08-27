/**
 * Phase F: the Layer 3 game-module host.
 *
 * The checks drive the host the way the runtime shell does — register, build a
 * level, tick, travel, dispose — and pin the two contracts a fork relies on:
 * lifecycle ordering (setup forward, teardown reverse, Layer 3 last) and
 * failure isolation, so one broken game module cannot stop the template from
 * booting (I6).
 */
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { Entity } from "../../engine/scene/entity";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createRuntimeContext, type RuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import {
  createRuntimeServiceHost,
  runtimeServiceKey,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  createGameModuleHost,
  type ForgeGameModule,
  type ForgeRuntimeHandle,
  type GameModuleHost,
} from "../../src/scene/ForgeGameModule";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => void;

function testContext(entities: Entity[] = []): RuntimeContext {
  const sceneDocument = { schema: 1, name: "test", entities } as unknown as SceneDocument;
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

function testHandle(): ForgeRuntimeHandle {
  return {
    services: createRuntimeServiceHost({ syncEntityTransform: () => {} }),
    scene: new Scene(),
    camera: new PerspectiveCamera(),
  };
}

function testHost(): { host: GameModuleHost; handle: ForgeRuntimeHandle } {
  const handle = testHandle();
  return { host: createGameModuleHost(handle), handle };
}

/** Records every lifecycle hook it receives, and optionally throws in one of them. */
function recordingModule(
  id: string,
  calls: string[],
  throwIn?: "register" | "loaded" | "update",
): ForgeGameModule {
  const record = (hook: string): void => {
    calls.push(`${id}:${hook}`);
    if (throwIn === hook) throw new Error(`${id} failed in ${hook}`);
  };
  return {
    id,
    register: () => record("register"),
    onLevelLoaded: async () => record("loaded"),
    start: () => record("start"),
    update: () => record("update"),
    onLevelUnloaded: () => record("unloaded"),
    dispose: () => record("dispose"),
  };
}

async function withSilencedErrors(run: () => Promise<void>): Promise<void> {
  const original = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = original;
  }
}

export async function registerForgeGameModuleTests(
  check: Check,
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("a runtime with no game module runs the whole lifecycle as a no-op", async () => {
    const { host } = testHost();
    assert.deepEqual(host.ids(), []);
    await host.levelLoaded(testContext());
    host.start();
    host.update(0.016);
    host.levelUnloaded();
    host.dispose();
  });

  await checkAsync("setup runs in registration order, teardown in reverse", async () => {
    const calls: string[] = [];
    const { host } = testHost();
    host.use(recordingModule("first", calls));
    host.use(recordingModule("second", calls));
    await host.levelLoaded(testContext());
    host.start();
    host.update(0.016);
    host.levelUnloaded();
    host.dispose();
    assert.deepEqual(calls, [
      // register fires at `use`, so a module can publish services before any
      // level exists — exactly what the level build then resolves.
      "first:register",
      "second:register",
      "first:loaded",
      "second:loaded",
      "first:start",
      "second:start",
      "first:update",
      "second:update",
      "second:unloaded",
      "first:unloaded",
      "second:dispose",
      "first:dispose",
    ]);
  });

  check("a game module publishes services through the same container as Layer 2", () => {
    const key = runtimeServiceKey<string>("game-rules");
    const { host, handle } = testHost();
    host.use({
      id: "demo",
      register: (runtime) => runtime.services.provide(key, "authored"),
    });
    assert.equal(handle.services.resolve(key), "authored");
  });

  check("duplicate game module ids are a wiring error, not a silent replacement", () => {
    const { host } = testHost();
    host.use({ id: "demo" });
    assert.throws(() => host.use({ id: "demo" }), /Duplicate game module id/);
  });

  await checkAsync("a module that throws while registering never runs again", async () => {
    const calls: string[] = [];
    const { host } = testHost();
    await withSilencedErrors(async () => {
      host.use(recordingModule("broken", calls, "register"));
      host.use(recordingModule("healthy", calls));
      await host.levelLoaded(testContext());
      host.update(0.016);
      host.levelUnloaded();
    });
    assert.deepEqual(calls, [
      "broken:register",
      "healthy:register",
      "healthy:loaded",
      "healthy:update",
      "healthy:unloaded",
    ]);
  });

  await checkAsync("a module that throws on one level gets a clean chance on the next", async () => {
    const calls: string[] = [];
    const { host } = testHost();
    host.use(recordingModule("broken", calls, "loaded"));
    host.use(recordingModule("healthy", calls));
    calls.length = 0;
    await withSilencedErrors(async () => {
      await host.levelLoaded(testContext());
      host.update(0.016);
      host.levelUnloaded();
      await host.levelLoaded(testContext());
    });
    assert.deepEqual(calls, [
      "broken:loaded",
      "healthy:loaded",
      // The broken module is skipped for the rest of that level…
      "healthy:update",
      "healthy:unloaded",
      // …but still gets its unload hook (it may hold half-built state)…
      "broken:unloaded",
      // …and is tried again on the next level.
      "broken:loaded",
      "healthy:loaded",
    ]);
  });

  await checkAsync("a module that throws while ticking stops ticking, others keep running", async () => {
    const calls: string[] = [];
    const { host } = testHost();
    host.use(recordingModule("broken", calls, "update"));
    host.use(recordingModule("healthy", calls));
    calls.length = 0;
    await withSilencedErrors(async () => {
      host.update(0.016);
      host.update(0.016);
    });
    assert.deepEqual(calls, ["broken:update", "healthy:update", "healthy:update"]);
  });

  check("a disposed runtime refuses further game modules", () => {
    const { host } = testHost();
    host.dispose();
    assert.throws(() => host.use({ id: "late" }), /disposed runtime/);
  });
}
