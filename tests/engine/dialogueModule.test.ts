/**
 * Phase E: dialogue is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach, build a
 * level, fire a script message — with each of its host services stubbed, and pin
 * the degraded paths that make the module optional (no bus, no audio).
 */
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { ScriptMessageEnvelope } from "../../engine/behavior/scriptMessages";
import type { DialogueAudioRequest } from "../../engine/dialogue/dialogueSubsystem";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createDialogueModule } from "../../src/scene/capabilities/dialogueModule";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  dialogueAudioService,
  scriptMessageBusService,
  subtitleLocalizationService,
  type ScriptMessageBus,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

const VOICE = {
  schema: 1,
  type: "dialogueVoice",
  id: "DV_Narrator",
  name: "Narrator",
  displayName: "Narrator",
};

const LINE = {
  schema: 1,
  type: "dialogueLine",
  id: "DL_Welcome",
  spokenText: "Welcome to Forge.",
  contexts: [{ speakerVoiceId: "DV_Narrator", audioSourceId: "SFX_Welcome" }],
};

const MANIFEST = {
  assets: [
    { id: "DV_Narrator", type: "dialogueVoice", path: "Dialogue/DV_Narrator.dialoguevoice.json" },
    { id: "DL_Welcome", type: "dialogueLine", path: "Dialogue/DL_Welcome.dialogueline.json" },
    { id: "SM_Rock", type: "model", path: "Meshes/SM_Rock.glb" },
  ],
};

/** Serves the two dialogue assets above; anything else 404s, as in a real project. */
async function withStubbedFetch(run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("DV_Narrator") ? VOICE : url.includes("DL_Welcome") ? LINE : null;
    if (!body) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => body } as unknown as Response;
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

function levelContext(host: RuntimeServiceHost) {
  return createRuntimeContext({
    mode: "runtime",
    levelPath: "layouts/test.json",
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: new EngineApp(),
    assetLoader: { loadManifest: async () => MANIFEST } as unknown as AssetLoader,
    layout: { name: "test" } as unknown as RoomLayout,
    sceneDocument: { schema: 1, name: "test", entities: [] } as unknown as SceneDocument,
    services: host,
  });
}

export async function registerDialogueModuleTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("dialogue module registers manifest lines and plays them off the bus", async () => {
    await withStubbedFetch(async () => {
      const played: DialogueAudioRequest[] = [];
      const bus = testBus();
      let localeLoads = 0;
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      host.provide(scriptMessageBusService, bus);
      host.provide(dialogueAudioService, (request) => {
        played.push(request);
        return { stop: () => undefined };
      });
      host.provide(subtitleLocalizationService, {
        ensureLoaded: async () => {
          localeLoads += 1;
        },
        resolveSubtitle: () => undefined,
      });

      const registry = createCapabilityRegistry([createDialogueModule()]);
      registry.runtimeStart(host);
      const installed: string[] = [];
      host.installSubsystems((subsystem) => installed.push(subsystem.id));
      assert.deepEqual(installed, ["dialogue"], "dialogue ticks with the presentation systems");

      await registry.levelLoaded(levelContext(host));
      assert.equal(localeLoads, 1, "subtitles localize even in a scene with no HUD");
      assert.equal(bus.subscriptionCount(), 2, "play-dialogue + start-conversation");

      bus.send("play-dialogue", { lineId: "DL_Welcome" });
      assert.deepEqual(played, [
        { lineId: "DL_Welcome", sourceId: "SFX_Welcome", sourceType: "sound" },
      ]);

      // An unknown line is a no-op, not a throw: authored data can drift.
      bus.send("play-dialogue", { lineId: "DL_Missing" });
      assert.equal(played.length, 1);

      registry.levelUnloaded();
      assert.equal(bus.subscriptionCount(), 0, "level teardown releases the triggers");
      bus.send("play-dialogue", { lineId: "DL_Welcome" });
      assert.equal(played.length, 1, "and a stale trigger cannot fire into the next level");
    });
  });

  await checkAsync("dialogue module still loads when the host provides no services", async () => {
    await withStubbedFetch(async () => {
      // The character-free / script-free case: nothing publishes a bus, audio or
      // localization. The level must still boot and the module stay silent.
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      const registry = createCapabilityRegistry([createDialogueModule()]);
      registry.runtimeStart(host);
      host.installSubsystems(() => {});
      await registry.levelLoaded(levelContext(host));
      registry.levelUnloaded();
      registry.dispose();
    });
  });
}
