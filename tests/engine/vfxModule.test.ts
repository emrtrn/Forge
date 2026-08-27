/**
 * Phase E: VFX is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach it to a
 * scene, prepare a level's manifest, start its `autoPlay` emitters, trigger one
 * from a script — and pin the degraded path that makes it optional: with no
 * scene to render into, nothing registers at all.
 */
import assert from "node:assert/strict";
import { Scene } from "three";

import {
  PARTICLE_EMITTER_COMPONENT,
  TRANSFORM_COMPONENT,
} from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  vfxCommandsService,
  vfxHostService,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import { createVfxModule } from "../../src/scene/capabilities/vfxModule";

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

/** A minimal but complete schema-2 effect: one burst of long-lived particles. */
const EFFECT = {
  schema: 2,
  type: "particleEffect",
  name: "FX_Test",
  system: { enabled: true, loop: true, duration: 4, maxParticles: 16 },
  spawn: { mode: "burst", rate: 0, count: 4, delay: 0, interval: 0, shape: "point" },
  particle: { lifetimeMin: 10, lifetimeMax: 10, sizeMin: 1, sizeMax: 1 },
};

const MANIFEST = {
  assets: [
    { id: "FX_Test", type: "effect", path: "Effects/FX_Test.effect.json" },
    { id: "T_Spark", type: "texture", path: "Textures/T_Spark.png" },
    { id: "SM_Rock", type: "model", path: "Meshes/SM_Rock.glb" },
  ],
};

/** Serves the effect above; anything else 404s, as in a real project. */
async function withStubbedFetch(run: (requested: string[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (!url.includes("FX_Test")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => EFFECT } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run(requested);
  } finally {
    globalThis.fetch = original;
  }
}

/** An emitter actor: the smallest entity the module spawns an effect for. */
function emitter(id: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    name: id,
    components: {
      [TRANSFORM_COMPONENT]: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [PARTICLE_EMITTER_COMPONENT]: { effectId: "FX_Test", autoPlay: true, ...extra },
    },
  } as unknown as Entity;
}

function documentOf(entities: readonly Entity[]): SceneDocument {
  return { schema: 1, name: "test", entities } as unknown as SceneDocument;
}

function startedHost(scene: Scene | null): {
  host: RuntimeServiceHost;
  installed: string[];
  registry: ReturnType<typeof createCapabilityRegistry>;
} {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  if (scene) host.provide(vfxHostService, { scene });
  const registry = createCapabilityRegistry([createVfxModule()]);
  registry.runtimeStart(host);
  const installed: string[] = [];
  host.installSubsystems((subsystem) => installed.push(subsystem.id));
  return { host, installed, registry };
}

export async function registerVfxModuleTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("vfx module parents its container and spawns the level's autoPlay emitters", async () => {
    await withStubbedFetch(async (requested) => {
      const scene = new Scene();
      const { host, installed, registry } = startedHost(scene);
      assert.deepEqual(installed, ["vfx"], "particles are output, so they tick last");
      assert.equal(
        scene.children.filter((child) => child.name === "vfx-root").length,
        1,
        "the effect container is parented once, for the runtime's life",
      );

      const commands = host.resolve(vfxCommandsService);
      assert.ok(commands);
      assert.equal(commands.debugSnapshot().activeInstances, 0);

      commands.prepareLevel(MANIFEST as never);
      await commands.playAutoPlay(
        documentOf([
          emitter("actor:0"),
          emitter("actor:1", { autoPlay: false }),
          emitter("actor:2", { enabled: false }),
          // No emitter component at all: skipped, not a failure.
          { id: "actor:3", name: "actor:3", components: {} } as unknown as Entity,
        ]),
      );

      assert.equal(
        requested.filter((url) => url.includes("FX_Test")).length,
        1,
        "the definition is warmed once and shared by every placement",
      );
      const snapshot = commands.debugSnapshot();
      assert.equal(snapshot.activeInstances, 1, "only the autoPlay, enabled emitter spawned");
      assert.equal(snapshot.instances[0]?.effectId, "FX_Test");

      // Level teardown stops live instances but keeps the container attached and
      // the definition cache warm for the rebuild.
      registry.levelUnloaded();
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      assert.equal(commands.debugSnapshot().cachedDefinitions, 1, "the cache stays warm");
      assert.equal(scene.children.filter((child) => child.name === "vfx-root").length, 1);
      registry.dispose();
    });
  });

  await checkAsync("vfx module separates the autoPlay path from a script trigger", async () => {
    await withStubbedFetch(async () => {
      const { host, registry } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);

      // A script's `playParticleEffect` fires an emitter that is deliberately
      // not autoPlay; the spawn path for a runtime-spawned actor does not.
      const scripted = emitter("actor:0", { autoPlay: false });
      await commands.playAutoPlayEntity(scripted);
      assert.equal(commands.debugSnapshot().activeInstances, 0, "autoPlay path skips it");

      await commands.triggerEntityEffect(scripted);
      assert.equal(commands.debugSnapshot().activeInstances, 1, "the script trigger plays it");

      // `enabled: false` is off for both paths — it is the actor's own switch.
      await commands.triggerEntityEffect(emitter("actor:1", { enabled: false }));
      assert.equal(commands.debugSnapshot().activeInstances, 1);
      registry.dispose();
    });
  });

  await checkAsync("vfx module carries the quality profile's particle density", async () => {
    await withStubbedFetch(async () => {
      const { host, registry } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      await commands.playAutoPlay(documentOf([emitter("actor:0")]));

      // Applied on top of the authored density and never written back to the
      // definition, so it survives being set before or after a spawn.
      commands.setGlobalDensity(0);
      commands.setGlobalDensity(0.5);
      assert.equal(commands.debugSnapshot().activeInstances, 1, "density never stops an effect");

      // An unknown effect id is a cached miss, not a throw: authored data drifts.
      await commands.triggerEntityEffect(emitter("actor:1", { effectId: "FX_Missing" }));
      assert.equal(commands.debugSnapshot().activeInstances, 1);
      registry.dispose();
    });
  });

  await checkAsync("a runtime with no scene to render into registers no vfx at all", async () => {
    // The I3 case: emitter actors still exist and still run their scripts, there
    // is simply no pool, no cache and no per-frame advance.
    const { host, installed, registry } = startedHost(null);
    assert.deepEqual(installed, []);
    assert.equal(host.resolve(vfxCommandsService), undefined);
    registry.dispose();
  });
}
