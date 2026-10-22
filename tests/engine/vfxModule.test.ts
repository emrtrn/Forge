/**
 * Phase E: VFX is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach it to a
 * scene, prepare a level's manifest, start its `autoPlay` emitters, trigger one
 * from a script — and pin the degraded path that makes it optional: with no
 * scene to render into, nothing registers at all.
 */
import assert from "node:assert/strict";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Points, Scene, type InstancedMesh } from "three";
import type { Subsystem } from "../../engine/core/Subsystem";

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

const RUNTIME_EFFECT = {
  schema: 2,
  system: { loop: true, seed: 123, maxParticles: 128 },
  spawn: { mode: "rate", rate: 10 },
  initialize: { lifetime: [2, 2], direction: [0, 1, 0], speed: [2, 2], spreadAngleDeg: 0, startSize: [1, 1] },
  update: { gravityScale: 0 },
};

/** Serves the effect above; anything else 404s, as in a real project. */
async function withStubbedFetch(run: (requested: string[]) => Promise<void>, effect: unknown = EFFECT): Promise<void> {
  const original = globalThis.fetch;
  // The flat particle runtime uses Math.random; pin it for reproducible steps.
  const originalRandom = Math.random;
  let seed = 123;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (!url.includes("FX_Test")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => effect } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run(requested);
  } finally {
    globalThis.fetch = original;
    Math.random = originalRandom;
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

function startedHost(scene: Scene | null, models?: readonly Group[]): {
  host: RuntimeServiceHost;
  installed: string[];
  registry: ReturnType<typeof createCapabilityRegistry>;
  advance: (deltaSeconds: number, steps?: number) => void;
} {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  if (scene) host.provide(vfxHostService, { scene, ...(models ? { loadModels: async () => models } : {}) });
  const registry = createCapabilityRegistry([createVfxModule()]);
  registry.runtimeStart(host);
  const installed: string[] = [];
  const subsystems: Subsystem[] = [];
  host.installSubsystems((subsystem) => { installed.push(subsystem.id); subsystems.push(subsystem); });
  return {
    host, installed, registry,
    advance(deltaSeconds, steps = 1) {
      for (let frame = 0; frame < steps; frame += 1) {
        for (const subsystem of subsystems) subsystem.update?.({ deltaSeconds, elapsedSeconds: 0, frame });
      }
    },
  };
}

export async function registerVfxModuleTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("vfx module runtime spawn accepts relative effect paths and snapshots loading transforms", async () => {
    await withStubbedFetch(async (requested) => {
      const scene = new Scene();
      const { host, registry, advance } = startedHost(scene);
      const commands = host.resolve(vfxCommandsService)!;
      const position: [number, number, number] = [1, 2, 3];
      const direction: [number, number, number] = [1, 0, 0];
      const pending = commands.spawnEffectAt("Effects/FX_Test_unregistered.effect.json", { position, direction });
      position[0] = 99;
      direction[0] = 0;
      direction[1] = 1;
      const handle = await pending;
      assert.ok(handle);
      assert.deepEqual(requested, ["/Effects/FX_Test_unregistered.effect.json"]);
      advance(0.1);
      handle.setEmissionRate(0);
      advance(0.1);
      const positions = (scene.children[0]!.children[0] as Points).geometry.getAttribute("position");
      assert.ok(Math.abs(positions.getX(0) - 1.2) < 1e-5);
      assert.equal(positions.getY(0), 2);
      const disposing = commands.createEffectEmitter("Effects/FX_Test_disposing.effect.json", { position });
      registry.dispose();
      assert.equal(await disposing, null, "runtime teardown also cancels pending spawns");
    }, RUNTIME_EFFECT);
  });

  await checkAsync("vfx module runtime spawn rejects malformed assets and non-relative paths once", async () => {
    await withStubbedFetch(async (requested) => {
      const { host, registry } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (message: unknown) => warnings.push(String(message));
      const refs = ["Effects/FX_Test_invalid.effect.json", "../FX_Test.effect.json", "https://example.com/FX_Test.effect.json"];
      try {
        for (const ref of refs) {
          assert.equal(await commands.spawnEffectAt(ref, { position: [0, 0, 0] }), null);
          assert.equal(await commands.createEffectEmitter(ref, { position: [0, 0, 0] }), null);
        }
        assert.equal(warnings.length, refs.length);
        assert.deepEqual(requested, ["/Effects/FX_Test_invalid.effect.json"]);
      } finally {
        console.warn = originalWarn;
        registry.dispose();
      }
    }, { schema: 999 });
  });

  await checkAsync("vfx module runtime spawn one-shot auto-recycles and shares the asset path cache", async () => {
    await withStubbedFetch(async (requested) => {
      const scene = new Scene();
      const { host, registry, advance } = startedHost(scene);
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const handle = await commands.spawnEffectAt("Effects/FX_Test.effect.json", {
        position: [1, 2, 3], direction: [2, 0, 0], scale: 2,
      });
      assert.ok(handle);
      const points = scene.children[0]!.children[0] as Points;
      advance(0.1);
      assert.equal(points.geometry.getAttribute("aSize").getX(0), 2);
      handle.setEmissionRate(0);
      advance(0.1);
      assert.ok(Math.abs(points.geometry.getAttribute("position").getX(0) - 1.4) < 1e-5);
      advance(0.1, 50);
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      assert.equal(commands.debugSnapshot().pooledInstances, 1);
      assert.equal(scene.children[0]!.children.length, 0);
      const next = await commands.spawnEffectAt("FX_Test", { position: [0, 0, 0] });
      assert.ok(next);
      assert.equal(requested.length, 1, "manifest id and path warm the same definition");
      handle.dispose();
      handle.stop(false);
      handle.setTransform([99, 99, 99]);
      handle.setEmissionRate(0);
      advance(0.1);
      assert.equal(commands.debugSnapshot().aliveParticles, 1, "retired handle cannot control a pooled reuse");
      const reused = scene.children[0]!.children[0] as Points;
      advance(0.1);
      assert.ok(Math.abs(reused.geometry.getAttribute("position").getY(0) - 0.2) < 1e-5,
        "pool reset restores authored direction and scale");
      next.dispose();
      registry.dispose();
    }, RUNTIME_EFFECT);
  });

  await checkAsync("vfx module runtime spawn emitter follows transform without moving its live trail", async () => {
    await withStubbedFetch(async () => {
      const scene = new Scene();
      const { host, registry, advance } = startedHost(scene);
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const handle = await commands.createEffectEmitter("FX_Test", { position: [1, 2, 3] });
      assert.ok(handle);
      const points = scene.children[0]!.children[0] as Points;
      advance(0.1);
      handle.setTransform([7, 8, 9], [2, 0, 0]);
      advance(0.1);
      const positions = points.geometry.getAttribute("position");
      assert.ok(Math.abs(positions.getY(0) - 2.2) < 1e-5);
      assert.equal(positions.getX(0), 1);
      assert.deepEqual([positions.getX(1), positions.getY(1), positions.getZ(1)], [7, 8, 9]);
      handle.setEmissionRate(0);
      advance(0.1);
      assert.ok(Math.abs(positions.getX(1) - 7.2) < 1e-5);
      assert.equal(positions.getY(1), 8);
      registry.dispose();
    }, RUNTIME_EFFECT);
  });

  await checkAsync("vfx module runtime spawn rate zero idles and rate two doubles deterministic emission", async () => {
    await withStubbedFetch(async () => {
      const { host, registry, advance } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const idle = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      const full = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      const double = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(idle && full && double);
      idle.setEmissionRate(0);
      double.setEmissionRate(2);
      advance(0.1, 5);
      assert.deepEqual(commands.debugSnapshot().instances.map((i) => i.aliveParticles), [0, 5, 10]);
      commands.setGlobalDensity(0.5);
      advance(0.1, 4);
      assert.deepEqual(commands.debugSnapshot().instances.map((i) => i.aliveParticles), [0, 7, 14],
        "quality density composes with each live rate");
      idle.setEmissionRate(1);
      commands.setGlobalDensity(1);
      advance(0.1);
      assert.equal(commands.debugSnapshot().instances[0]!.aliveParticles, 1, "idle resumes without catch-up");
      idle.setEmissionRate(-1);
      advance(0.1);
      assert.equal(commands.debugSnapshot().instances[0]!.aliveParticles, 1, "negative rate clamps to zero");
      commands.setGlobalDensity(0);
      advance(0.1, 30);
      assert.equal(commands.debugSnapshot().activeInstances, 3, "persistent emitters survive idle past lifetime");
      assert.equal(commands.debugSnapshot().aliveParticles, 0);
      registry.dispose();
    }, { ...RUNTIME_EFFECT, system: { ...RUNTIME_EFFECT.system, loop: false } });
  });

  await checkAsync("vfx module runtime spawn bursts respect rate and quality at their scheduled tick", async () => {
    await withStubbedFetch(async () => {
      const { host, registry, advance } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const handles = await Promise.all([0, 1, 2].map(async (rate) => {
        const handle = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
        assert.ok(handle);
        handle.setEmissionRate(rate);
        return handle;
      }));
      commands.setGlobalDensity(0.5);
      advance(0.1);
      assert.deepEqual(commands.debugSnapshot().instances.map((i) => i.aliveParticles), [0, 2, 4]);
      handles[0]!.setEmissionRate(2);
      advance(0.1);
      assert.equal(commands.debugSnapshot().instances[0]!.aliveParticles, 0, "suppressed bursts are consumed");
      registry.dispose();
    }, { ...RUNTIME_EFFECT, spawn: { mode: "burst", count: 4 } });
  });

  await checkAsync("vfx module runtime spawn stop and dispose are idempotent and drain live particles", async () => {
    await withStubbedFetch(async () => {
      const { host, registry, advance } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const handle = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(handle);
      advance(0.1, 5);
      handle.stop();
      handle.stop();
      handle.setEmissionRate(2);
      advance(0.1);
      assert.equal(commands.debugSnapshot().aliveParticles, 5, "fade stop preserves the live tail");
      advance(0.1, 30);
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      const immediate = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(immediate);
      advance(0.1);
      assert.equal(commands.debugSnapshot().aliveParticles, 1, "pooled stopped effect emits again");
      immediate.stop(false);
      immediate.stop(false);
      immediate.dispose();
      immediate.dispose();
      handle.dispose();
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      const empty = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(empty);
      empty.stop();
      advance(0.01);
      assert.equal(commands.debugSnapshot().activeInstances, 0, "an empty stopped emitter retires immediately");
      registry.dispose();
    }, RUNTIME_EFFECT);
  });

  await checkAsync("vfx module runtime spawn unload invalidates handles and pending loads", async () => {
    await withStubbedFetch(async () => {
      const { host, registry, advance } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const old = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(old);
      registry.levelUnloaded();
      commands.prepareLevel(MANIFEST as never);
      const next = await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] });
      assert.ok(next);
      old.setTransform([99, 99, 99]);
      old.setEmissionRate(0);
      old.stop();
      old.dispose();
      advance(0.1);
      assert.equal(commands.debugSnapshot().aliveParticles, 1);
      const pending = commands.spawnEffectAt("Effects/FX_Test_pending.effect.json", { position: [0, 0, 0] });
      const pendingEntity = commands.triggerEntityEffect(emitter("pending", { effectId: "Effects/FX_Test_entity.effect.json" }));
      registry.levelUnloaded();
      assert.equal(await pending, null);
      await pendingEntity;
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      registry.dispose();
      next.setEmissionRate(2);
      next.dispose();
      assert.equal(await commands.createEffectEmitter("FX_Test", { position: [0, 0, 0] }), null);
    }, RUNTIME_EFFECT);
  });

  await checkAsync("vfx module runtime spawn missing assets return null with one warning per reference", async () => {
    await withStubbedFetch(async (requested) => {
      const { host, registry } = startedHost(new Scene());
      const commands = host.resolve(vfxCommandsService)!;
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (message: unknown) => warnings.push(String(message));
      try {
        for (const ref of ["FX_Missing", "Effects/Missing.effect.json"]) {
          const results = await Promise.all([
            commands.spawnEffectAt(ref, { position: [0, 0, 0] }),
            commands.createEffectEmitter(ref, { position: [0, 0, 0] }),
          ]);
          assert.deepEqual(results, [null, null]);
        }
        assert.equal(warnings.length, 2);
        assert.ok(warnings.every((w) => w.startsWith("[vfx]") && w.includes("ignoring")));
        assert.equal(requested.length, 1, "unknown id does not fetch; missing path is cached");
        registry.levelUnloaded();
        assert.equal(await commands.spawnEffectAt("FX_Missing", { position: [0, 0, 0] }), null);
        assert.equal(warnings.length, 2, "cached failure stays deduplicated across rebuilds");
      } finally {
        console.warn = originalWarn;
        registry.dispose();
      }
    });
  });

  await checkAsync("vfx module runtime spawn mesh emitter follows direction and honours particle caps", async () => {
    await withStubbedFetch(async () => {
      const scene = new Scene();
      const model = new Group();
      const geometry = new BoxGeometry();
      const material = new MeshBasicMaterial();
      model.add(new Mesh(geometry, material));
      const { host, registry, advance } = startedHost(scene, [model]);
      const commands = host.resolve(vfxCommandsService)!;
      commands.prepareLevel(MANIFEST as never);
      const handle = await commands.createEffectEmitter("FX_Test", { position: [1, 2, 3] });
      assert.ok(handle);
      handle.setTransform([4, 5, 6], [1, 0, 0]);
      advance(0.1);
      handle.setEmissionRate(0);
      advance(0.1);
      const mesh = scene.children[0]!.children[0]!.children[0] as InstancedMesh;
      const matrix = new Matrix4();
      mesh.getMatrixAt(0, matrix);
      assert.ok(Math.abs(matrix.elements[12]! - 4.2) < 1e-5);
      assert.equal(matrix.elements[13], 5);
      assert.equal(matrix.elements[14], 6);
      handle.setEmissionRate(1e12);
      advance(0.1, 4);
      assert.equal(commands.debugSnapshot().aliveParticles, 3, "authored mesh cap wins over rate multiplier");
      handle.stop();
      advance(0.1, 30);
      assert.equal(commands.debugSnapshot().activeInstances, 0);
      registry.dispose();
      geometry.dispose();
      material.dispose();
    }, { ...RUNTIME_EFFECT, renderer: { type: "mesh", modelIds: ["SM_Rock"], maxModelParticles: 3 } });
  });

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
