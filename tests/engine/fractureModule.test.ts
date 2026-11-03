/**
 * Fracture capability lifecycle through a fake shell host.
 * Covers registration, live-pose breaks and cell/level cleanup without Rapier.
 */
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type Object3D } from "three";

import type { AssetManifest } from "../../engine/assets/manifest";
import type { EngineApp } from "../../engine/core/EngineApp";
import { createAssetFracture } from "../../engine/physics/fracture/fractureTypes";
import {
  COLLIDER_COMPONENT,
  FRACTURABLE_COMPONENT,
  STATIC_MESH_COMPONENT,
  TRANSFORM_COMPONENT,
  readTransformComponent,
} from "../../engine/scene/components";
import type { Entity, EntityComponentData } from "../../engine/scene/entity";
import type { LayoutPlacement, RoomLayout, Vec3 } from "../../engine/scene/layout";
import { instanceEntityId } from "../../engine/scene/legacyRoomLayoutAdapter";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createFractureModule } from "../../src/scene/capabilities/fractureModule";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import { createRuntimeServiceHost, type RuntimeServices } from "../../src/scene/capabilities/RuntimeServices";
import {
  assetManifestService,
  audioCommandsService,
  fractureCommandsService,
  fractureHostService,
  vfxCommandsService,
  type AudioCommands,
  type FractureHost,
  type VfxCommands,
  type VfxSpawnOptions,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import type { AudioPlayOptions } from "../../engine/audio/audioSubsystem";
import type { SavedDestructibleState } from "../../engine/persistence/saveGameState";

const ASSET_ID = "sm-crate";
const MODEL_PATH = "Meshes/Crate.glb";
const SIDECAR = { ...createAssetFracture(), cellCount: 4, breakImpulse: 400, maxActiveChunks: 4 };

function actor(
  id: string,
  fracture: EntityComponentData | null = { breakImpulse: 120 },
  position: Vec3 = [3, 0, 0],
): Entity {
  return {
    id,
    components: {
      [TRANSFORM_COMPONENT]: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      [STATIC_MESH_COMPONENT]: { assetId: ASSET_ID },
      ...(fracture ? { [FRACTURABLE_COMPONENT]: fracture } : {}),
    },
  };
}

function layoutOf(placements: LayoutPlacement[] = []): RoomLayout {
  return {
    schema: 1, name: "fracture-test", loadGroups: [], characters: [],
    instances: [{ assetId: ASSET_ID, placements }],
  };
}

function placementLayout(): RoomLayout {
  return layoutOf([
    { position: [0, 0, 0] },
    { position: [2, 0, 0], fracture: { enabled: false } },
    { position: [4, 0, 0], fracture: { breakImpulse: 50 } },
  ]);
}

function fakeHost(services: RuntimeServices) {
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const material = new MeshStandardMaterial();
  const model = new Group();
  model.add(new Mesh(geometry, material));
  const thresholds = new Map<string, number>();
  const impacts: ReturnType<FractureHost["physics"]["impacts"]>[number][] = [];
  const added: Entity[] = [];
  const removed: string[] = [];
  const destroyed: string[] = [];
  const impulses: { id: string; impulse: readonly [number, number, number] }[] = [];
  const attachments: { id: string; object: Object3D | null }[] = [];
  const poses = new Map<string, NonNullable<ReturnType<FractureHost["sourcePose"]>>>();
  const cells = new Map<string, string>();
  const listeners = new Set<(key: string) => void>();
  /** Sources the shell has not built (their cell is unloaded or queued). */
  const unbuilt = new Set<string>();
  // World Support probe: a test decides which chunk poses touch the world.
  const world = { touches: (_position: readonly number[]) => false };
  const host: FractureHost = {
    physics: {
      setImpactEventThreshold(id, threshold) {
        if (threshold === null) thresholds.delete(id);
        else thresholds.set(id, threshold);
      },
      impacts: () => impacts,
      addEntities(entities) { added.push(...entities); return entities.length; },
      removeEntities(ids) { removed.push(...ids); },
      velocityOf: () => [0, 0, 0],
      applyImpulse(id, impulse) { impulses.push({ id, impulse }); },
      touchesStaticWorld: (position) => world.touches(position),
    },
    model: (id) => id === ASSET_ID ? model : null,
    exteriorMaterial: () => null,
    loadMaterial: async () => null,
    chunkBudget: () => 192,
    destroySource(id) {
      destroyed.push(id);
      // The real shell dispatches removal while the module is still breaking.
      services.removeEntity(id);
    },
    sourcePose: (id) => poses.get(id) ?? null,
    cellOf: (id) => cells.get(id) ?? null,
    isSourceLive: (id) => !unbuilt.has(id),
    onCellUnloaded(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachDynamicObject(id, object) { attachments.push({ id, object }); },
  };
  return {
    host, thresholds, impacts, added, removed, destroyed, impulses, attachments, poses, cells, listeners, world, unbuilt,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

function harness() {
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const shell = fakeHost(services);
  const module = createFractureModule();
  services.provide(fractureHostService, shell.host);
  module.onRuntimeStart!(services);
  const commands = services.resolve(fractureCommandsService);
  assert.ok(commands);
  return { services, shell, module, commands };
}

interface Presented {
  effects: { id: string; position: readonly number[] }[];
  sounds: { id: string; position: readonly number[] | null; spatial: boolean }[];
}

/** Each level owns its fetch stub and releases listeners and baked geometry. */
async function withLevel(
  run: (test: ReturnType<typeof harness> & { requested: string[]; presented: Presented }) => Promise<void>,
  options: {
    layout?: RoomLayout; entities?: Entity[]; modelPath?: string; sidecar?: object;
    /** Runs before `onLevelLoaded` (a save-game restore that beats the module's own level build). */
    beforeLoad?: (test: ReturnType<typeof harness>) => void;
  } = {},
): Promise<void> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  const test = harness();
  // Break presentation goes to the VFX and audio capabilities: record it.
  const presented: Presented = { effects: [], sounds: [] };
  test.services.provide(vfxCommandsService, {
    spawnEffectAt: async (id: string, spawn: VfxSpawnOptions) => {
      presented.effects.push({ id, position: spawn.position });
      return null;
    },
  } as unknown as VfxCommands);
  test.services.provide(audioCommandsService, {
    playOneShot: (id: string, play?: AudioPlayOptions) => {
      presented.sounds.push({ id, position: play?.position ?? null, spatial: play?.spatial === true });
    },
  } as unknown as AudioCommands);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return url === "/Meshes/Crate.fracture.json"
      ? { ok: true, status: 200, json: async () => options.sidecar ?? SIDECAR } as unknown as Response
      : { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const manifest = {
      assets: [{ id: ASSET_ID, assetType: "staticMesh", path: options.modelPath ?? MODEL_PATH }],
    } as unknown as AssetManifest;
    test.services.provide(assetManifestService, () => Promise.resolve(manifest));
    // No message bus: placement and actor registration must still finish.
    const context = createRuntimeContext({
      mode: "runtime",
      levelPath: "layouts/fracture-test.level.json",
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      engineApp: {} as unknown as EngineApp,
      assetLoader: {} as unknown as AssetLoader,
      layout: options.layout ?? layoutOf(),
      sceneDocument: { schema: 1, name: "fracture-test", entities: options.entities ?? [] },
      services: test.services,
    });
    options.beforeLoad?.(test);
    await test.module.onLevelLoaded!(context);
    await run({ ...test, requested, presented });
  } finally {
    globalThis.fetch = original;
    test.module.dispose!();
    test.shell.dispose();
  }
}

function chunksOf(entities: readonly Entity[], ownerId: string): string[] {
  return entities.filter((entity) => entity.id.startsWith(`fracture:${ownerId}:`)).map((entity) => entity.id);
}

export async function registerFractureModuleTests(check: (label: string, fn: () => Promise<void>) => void): Promise<void> {
  await check("fracture module: placements use sidecar thresholds and honor overrides and hidden state", async () => {
    await withLevel(async ({ commands, shell, requested }) => {
      assert.equal(commands.snapshot().fracturable, 2);
      assert.deepEqual(shell.thresholds, new Map([
        [instanceEntityId(ASSET_ID, 0), 400],
        [instanceEntityId(ASSET_ID, 2), 50],
      ]));
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 1)), false);
      assert.deepEqual(requested, ["/Meshes/Crate.fracture.json"], "one sidecar serves all placements");
    }, { layout: placementLayout() });
    await withLevel(async ({ commands, shell }) => {
      assert.equal(commands.snapshot().fracturable, 0);
      assert.equal(shell.thresholds.size, 0);
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), false);
    }, { layout: layoutOf([{ position: [0, 0, 0], hidden: true }]) });
  });

  await check("fracture module: level-start actors require an enabled component and a sidecar", async () => {
    await withLevel(async ({ commands, shell }) => {
      assert.equal(commands.snapshot().fracturable, 1);
      assert.deepEqual(shell.thresholds, new Map([["actor:0", 120]]));
      assert.equal(commands.breakEntity("actor:disabled"), false);
      assert.equal(commands.breakEntity("actor:plain"), false);
    }, { entities: [actor("actor:0"), actor("actor:disabled", { enabled: false }), actor("actor:plain", null)] });
    await withLevel(async ({ commands, shell, requested }) => {
      assert.deepEqual(requested, ["/Meshes/NoSidecar.fracture.json"]);
      assert.equal(commands.snapshot().fracturable, 0);
      assert.equal(shell.thresholds.size, 0);
      assert.equal(commands.breakEntity("actor:no-sidecar"), false);
    }, { entities: [actor("actor:no-sidecar")], modelPath: "Meshes/NoSidecar.glb" });
  });

  await check("fracture module: streamed actors register and unregister through entity sinks", async () => {
    await withLevel(async ({ services, commands, shell }) => {
      const before = commands.snapshot().fracturable;
      services.addEntity(actor("actor:streamed"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assert.equal(commands.snapshot().fracturable, before + 1);
      assert.equal(shell.thresholds.get("actor:streamed"), 120);
      services.removeEntity("actor:streamed");
      assert.equal(commands.snapshot().fracturable, before);
      assert.equal(shell.thresholds.has("actor:streamed"), false);
      assert.equal(commands.isFractured("actor:streamed"), false);
      assert.equal(commands.breakEntity("actor:streamed"), false);
    });
  });

  await check("fracture module: live pose wins and source removal mid-break preserves chunks", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      shell.poses.set("actor:0", { position: [5, 0, 2], rotation: [0, 90, 0], scale: [1, 1, 1] });
      assert.equal(commands.breakEntity("actor:0"), true);
      assert.deepEqual(shell.destroyed, ["actor:0"]);
      const count = shell.added.length;
      assert.ok(count >= 1 && count <= SIDECAR.maxActiveChunks);
      for (const chunk of shell.added) {
        assert.ok(chunk.id.startsWith("fracture:actor:0:"));
        const transform = readTransformComponent(chunk);
        assert.ok(transform);
        const [x, y, z] = transform.position;
        assert.ok(Math.hypot(x - 5, y - 0.5, z - 2) <= 1.5, "chunk follows the live pose");
        assert.ok(Math.abs(y - 8) > 1.5, "chunk did not use the authored height");
        assert.ok(chunk.components[COLLIDER_COMPONENT]);
      }
      assert.equal(shell.impulses.length, count);
      assert.deepEqual(shell.attachments.map(({ id }) => id), shell.added.map(({ id }) => id));
      assert.equal(shell.thresholds.has("actor:0"), false);
      module.update!(0.016);
      assert.equal(commands.isFractured("actor:0"), true);
      assert.equal(commands.snapshot().activeChunks, count);
      assert.equal(commands.breakEntity("actor:0"), false);
      assert.equal(shell.added.length, count);
      assert.deepEqual(shell.destroyed, ["actor:0"]);
    }, { entities: [actor("actor:0", { breakImpulse: 120 }, [0, 8, 0])] });
  });

  await check("fracture module: cell unload removes owned chunks and resets only placements", async () => {
    await withLevel(async ({ commands, shell }) => {
      const first = instanceEntityId(ASSET_ID, 0);
      const retained = instanceEntityId(ASSET_ID, 2);
      shell.cells.set(first, "1_0");
      shell.cells.set("actor:0", "1_0");
      shell.cells.set(retained, "0_0");
      for (const id of [first, "actor:0", retained]) assert.equal(commands.breakEntity(id), true);
      const expectedRemoved = [...chunksOf(shell.added, first), ...chunksOf(shell.added, "actor:0")];
      const retainedChunks = chunksOf(shell.added, retained);
      assert.ok(chunksOf(shell.added, first).length > 0);
      assert.ok(chunksOf(shell.added, "actor:0").length > 0);
      assert.ok(retainedChunks.length > 0);
      assert.equal(commands.snapshot().activeChunks, shell.added.length);
      assert.equal(shell.listeners.size, 1);
      // As the shell does: an unloaded cell's placement is not built.
      shell.unbuilt.add(first);
      for (const listener of shell.listeners) listener("1_0");
      assert.deepEqual([...shell.removed].sort(), expectedRemoved.sort());
      assert.equal(commands.snapshot().activeChunks, retainedChunks.length);
      // Registered again; its broken state waits for the cell to be built (Faz 5).
      assert.equal(commands.isFractured(first), false);
      assert.deepEqual(shell.thresholds, new Map([[first, 400]]));
      assert.ok(commands.captureState().some((entry) => entry.entityId === first && entry.state === "fractured"));
      assert.equal(commands.isFractured("actor:0"), false);
      assert.equal(commands.breakEntity("actor:0"), false, "unloaded actor must respawn before registering again");
      assert.equal(commands.snapshot().fracturable, 2);
      assert.equal(commands.isFractured(retained), true);
    }, { layout: placementLayout(), entities: [actor("actor:0")] });
  });

  await check("fracture module: level teardown releases cell listeners and all fracture state", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), true);
      assert.equal(commands.breakEntity("actor:0"), true);
      assert.ok(commands.snapshot().activeChunks > 0);
      assert.equal(shell.listeners.size, 1);
      module.onLevelUnloaded!();
      const snapshot = commands.snapshot();
      assert.equal(shell.listeners.size, 0);
      assert.equal(snapshot.fracturable, 0);
      assert.equal(snapshot.fractured, 0);
      assert.equal(snapshot.activeChunks, 0);
      assert.equal(shell.thresholds.size, 0);
      assert.deepEqual([...shell.removed].sort(), shell.added.map(({ id }) => id).sort());
      assert.equal(commands.isFractured("actor:0"), false);
    }, { layout: placementLayout(), entities: [actor("actor:0")] });
  });

  await check("fracture module: a break plays the asset's effect and sound at the impact point", async () => {
    const sidecar = { ...SIDECAR, breakEffect: "fx-dust", breakSound: "sc-break" };
    await withLevel(async ({ shell, module, presented }) => {
      shell.impacts.push({
        a: "car", b: instanceEntityId(ASSET_ID, 0), point: [0.2, 0.7, 0.1], normal: [0, 0, 1], impulse: 1000, relativeSpeed: 8,
      });
      module.update!(0.016);
      assert.deepEqual(presented.effects, [{ id: "fx-dust", position: [0.2, 0.7, 0.1] }]);
      assert.deepEqual(presented.sounds, [{ id: "sc-break", position: [0.2, 0.7, 0.1], spatial: true }]);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar });
    // Without them nothing is asked of the VFX or audio capabilities.
    await withLevel(async ({ commands, presented }) => {
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), true);
      assert.deepEqual(presented, { effects: [], sounds: [] });
    }, { layout: layoutOf([{ position: [0, 0, 0] }]) });
  });

  await check("fracture module: chunks below crumbleBelow become effects, not bodies", async () => {
    let planned = 0;
    await withLevel(async ({ commands, shell }) => {
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), true);
      planned = shell.added.length;
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: { ...SIDECAR, cellCount: 12, maxActiveChunks: 12 } });
    await withLevel(async ({ commands, shell, presented }) => {
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), true);
      const crumbled = planned - shell.added.length;
      assert.ok(crumbled > 0, "some chunks are under a fifth of the volume");
      assert.equal(commands.snapshot().activeChunks, shell.added.length);
      assert.equal(presented.effects.length, Math.min(6, crumbled));
      assert.ok(presented.effects.every((effect) => effect.id === "fx-bits"));
    }, {
      layout: layoutOf([{ position: [0, 0, 0] }]),
      sidecar: { ...SIDECAR, cellCount: 12, maxActiveChunks: 12, crumbleBelow: 0.2, crumbleEffect: "fx-bits" },
    });
  });

  await check("fracture module: a chunk past maxSeparation from the break point is removed", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      assert.equal(commands.breakEntity(instanceEntityId(ASSET_ID, 0)), true);
      const count = shell.added.length;
      assert.ok(count > 1);
      module.update!(0.016);
      assert.equal(commands.snapshot().activeChunks, count, "chunks near the break stay");
      const far = shell.attachments.find(({ object }) => object !== null)!;
      far.object!.position.set(40, 0, 0);
      module.update!(0.016);
      assert.deepEqual(shell.removed, [far.id]);
      assert.equal(commands.snapshot().activeChunks, count - 1);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: { ...SIDECAR, maxSeparation: 5 } });
  });

  // Faz 4c: anchored support. The unit crate spans y 0..1; the bottom slab anchors it.
  const SOURCE = instanceEntityId(ASSET_ID, 0);
  const anchoredSidecar = (support: Record<string, unknown> = {}) => ({
    ...SIDECAR, cellCount: 16, maxActiveChunks: 16,
    support: {
      mode: "anchored", anchors: [{ min: [-1, -0.1, -1], max: [1, 0.25, 1] }], worldSupport: false,
      damageRadius: 0.3, damageRadiusPerImpulse: 0, damageRadiusMax: 3, ...support,
    },
  });
  const hitSource = (shell: ReturnType<typeof fakeHost>, module: ReturnType<typeof createFractureModule>,
    id: string, point: [number, number, number], impulse: number) => {
    shell.impacts.splice(0, shell.impacts.length, { a: "car", b: id, point, normal: [0, 0, 1], impulse, relativeSpeed: 8 });
    module.update!(0.016);
    shell.impacts.length = 0;
  };
  const isStatic = (entity: Entity) => entity.id.includes(":static:");
  let wholeCount = 0;

  await check("fracture module: an anchored source breaks only around the hit and the rest stands", async () => {
    // The same asset without support breaks into every chunk: the count to compare with.
    await withLevel(async ({ commands, shell }) => {
      assert.equal(commands.breakEntity(SOURCE), true);
      wholeCount = shell.added.length;
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: { ...SIDECAR, cellCount: 16, maxActiveChunks: 16 } });

    await withLevel(async ({ commands, shell, module, presented }) => {
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      const statics = shell.added.filter(isStatic);
      const dynamics = shell.added.filter((entity) => !isStatic(entity));
      assert.deepEqual(shell.destroyed, [SOURCE]);
      assert.ok(statics.length > 0, "the anchored base stands");
      assert.ok(dynamics.length > 0, "the hit region falls");
      assert.equal(statics.length + dynamics.length, wholeCount, "every chunk is either standing or falling");
      for (const entity of statics) {
        assert.equal((entity.components.Collider as { isStatic?: boolean }).isStatic, true);
        assert.equal(shell.thresholds.get(entity.id), 400, "a standing chunk takes the next hit at the source's threshold");
      }
      const snapshot = commands.snapshot();
      assert.equal(snapshot.staticChunks, statics.length);
      assert.equal(snapshot.activeChunks, dynamics.length);
      assert.equal(commands.isFractured(SOURCE), true);
      assert.equal(presented.effects.length, 0, "the sidecar names no effect");

      // Below the threshold a standing chunk only takes the knock.
      const standing = statics[statics.length - 1]!.id;
      hitSource(shell, module, standing, [0, 0.5, 0.5], 100);
      assert.equal(commands.snapshot().staticChunks, statics.length);

      // A second hard hit low on the side, once the first collision is over,
      // frees more, and what it cut off falls with it.
      for (let frame = 0; frame < 20; frame += 1) module.update!(0.016);
      const before = shell.added.length;
      hitSource(shell, module, standing, [0.5, 0.35, 0], 1000);
      const freed = shell.removed.filter((id) => id.includes(":static:"));
      assert.ok(freed.length > 0);
      assert.equal(commands.snapshot().staticChunks, statics.length - freed.length);
      assert.ok(shell.added.length > before, "freed chunks become dynamic bodies");
      for (const id of freed) assert.equal(shell.thresholds.has(id), false);

      // A scripted break brings down what still stands; it cuts no support, so `collapsed` stays.
      const collapsed = commands.snapshot().collapsedChunks;
      assert.ok(Number.isInteger(collapsed) && collapsed >= 0 && collapsed < wholeCount);
      assert.equal(commands.breakEntity(SOURCE), true);
      assert.equal(commands.snapshot().staticChunks, 0);
      assert.equal(commands.snapshot().collapsedChunks, collapsed);
      assert.equal(commands.breakEntity(SOURCE), false, "nothing left to break");
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
  });

  await check("fracture module: standing chunks ignore debris and the frames of the same collision", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      const standing = commands.snapshot().staticChunks;
      const target = shell.added.filter(isStatic).at(-1)!.id;
      // The same collision a frame later: still one hit.
      hitSource(shell, module, target, [0.5, 0.35, 0], 1000);
      assert.equal(commands.snapshot().staticChunks, standing);
      // Falling chunks land on the structure hard, but debris never breaks it.
      for (let frame = 0; frame < 20; frame += 1) module.update!(0.016);
      const debris = shell.added.find((entity) => !isStatic(entity))!.id;
      const stillStanding = () => shell.added.filter(isStatic).map((entity) => entity.id)
        .filter((id) => !shell.removed.includes(id));
      const victim = stillStanding()[0]!;
      shell.impacts.push({ a: debris, b: victim, point: [0, 0.2, 0], normal: [0, 0, 1], impulse: 100000, relativeSpeed: 8 });
      module.update!(0.016);
      assert.equal(commands.snapshot().staticChunks, standing, "debris alone breaks nothing");
      // A new hit from a real body, after the episode, does break more.
      hitSource(shell, module, victim, [0, 0.2, 0], 100000);
      assert.ok(commands.snapshot().staticChunks < standing);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
  });

  await check("fracture module: an anchored source with nothing holding it breaks whole", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      assert.equal(shell.added.filter(isStatic).length, 0);
      assert.equal(shell.added.length, wholeCount);
      assert.equal(commands.snapshot().staticChunks, 0);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar({ anchors: [] }) });
  });

  await check("fracture module: World Support anchors the chunks that touch the world when it breaks", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      shell.world.touches = (position) => position[1]! < 0.35;
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      assert.ok(commands.snapshot().staticChunks > 0);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar({ anchors: [], worldSupport: true }) });
  });

  await check("fracture module: cutting every anchor brings the whole source down", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      // A wide hit at the base frees every anchored chunk: the rest is an island.
      hitSource(shell, module, SOURCE, [0, 0.1, 0], 1000);
      assert.equal(commands.snapshot().staticChunks, 0);
      // Decided before anything is built: no static body appears, every chunk falls.
      assert.equal(shell.added.filter(isStatic).length, 0);
      assert.equal(shell.added.length, wholeCount);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar({ damageRadius: 0.75 }) });
  });

  await check("fracture module: a partly broken source's standing chunks leave with its cell", async () => {
    await withLevel(async ({ commands, shell, module }) => {
      shell.cells.set(SOURCE, "2_0");
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      const statics = shell.added.filter(isStatic).map((entity) => entity.id);
      assert.ok(statics.length > 0);
      shell.unbuilt.add(SOURCE);
      for (const listener of shell.listeners) listener("2_0");
      assert.equal(commands.snapshot().staticChunks, 0);
      for (const id of statics) assert.ok(shell.removed.includes(id));
      // Registered again, unbuilt: the standing chunks come back with the cell (next check).
      assert.equal(commands.isFractured(SOURCE), false);
      assert.equal(shell.thresholds.get(SOURCE), 400);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
  });

  await check("fracture module: a damaged source's save restores the same standing chunks, quietly", async () => {
    let saved: SavedDestructibleState[] = [];
    let standing = 0;
    await withLevel(async ({ commands, shell, module }) => {
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      standing = commands.snapshot().staticChunks;
      saved = commands.captureState();
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.state, "damaged");
    assert.ok(standing > 0);

    // The load's restore arrives before the module has rebuilt the level.
    await withLevel(async ({ commands, shell, module, presented }) => {
      assert.deepEqual(shell.destroyed, [SOURCE]);
      assert.equal(commands.isFractured(SOURCE), true);
      assert.equal(commands.snapshot().staticChunks, standing);
      assert.equal(commands.snapshot().activeChunks, 0, "nothing falls on load");
      assert.equal(shell.added.filter((entity) => !isStatic(entity)).length, 0);
      assert.deepEqual(presented, { effects: [], sounds: [] });
      assert.deepEqual(commands.captureState(), saved);
      // It goes on breaking from where it was.
      for (let frame = 0; frame < 20; frame += 1) module.update!(0.016);
      const target = shell.added.filter(isStatic).at(-1)!.id;
      hitSource(shell, module, target, [0.5, 0.35, 0], 1000);
      assert.ok(commands.snapshot().staticChunks < standing);
    }, {
      layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar(),
      beforeLoad: ({ commands }) => commands.restoreState(saved),
    });
  });

  await check("fracture module: fractured and damage-only entries restore; others load intact", async () => {
    await withLevel(async ({ commands, shell }) => {
      const broken = instanceEntityId(ASSET_ID, 0);
      const worn = instanceEntityId(ASSET_ID, 2);
      commands.restoreState([
        { entityId: broken, state: "fractured", damage: 0 },
        { entityId: worn, state: "intact", damage: 7 },
      ]);
      assert.deepEqual(shell.destroyed, [broken]);
      assert.equal(shell.added.length, 0, "a fractured source loads without chunks");
      assert.equal(shell.thresholds.has(broken), false);
      assert.equal(commands.isFractured(worn), false);
      assert.deepEqual(commands.captureState(), [
        { entityId: broken, state: "fractured", damage: 0 },
        { entityId: worn, state: "intact", damage: 7 },
      ]);
      // Restoring again does not break twice.
      commands.restoreState([{ entityId: broken, state: "fractured", damage: 0 }]);
      assert.deepEqual(shell.destroyed, [broken]);
    }, { layout: placementLayout() });
  });

  await check("fracture module: a re-baked asset or an unknown id never breaks the load", async () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => { warnings.push(String(message)); };
    try {
      await withLevel(async ({ commands, shell }) => {
        commands.restoreState([
          { entityId: SOURCE, state: "damaged", damage: 0, chunkCount: 5, standing: "1f", anchored: "01" },
          { entityId: "sm-gone:4", state: "fractured", damage: 0 },
        ]);
        // Other chunk count: the opening it made stays, as a fractured source.
        assert.deepEqual(shell.destroyed, [SOURCE]);
        assert.equal(commands.snapshot().staticChunks, 0);
        assert.ok(warnings.some((message) => message.includes(SOURCE) && message.includes("5 chunks")));
        assert.ok(warnings.some((message) => message.includes("sm-gone:4")));
        // The unmatched entry is kept for a source that may still appear.
        assert.deepEqual(commands.captureState(), [
          { entityId: SOURCE, state: "fractured", damage: 0 },
          { entityId: "sm-gone:4", state: "fractured", damage: 0 },
        ]);
      }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
    } finally {
      console.warn = warn;
    }
  });

  await check("fracture module: a broken source stays broken when its cell unloads and returns", async () => {
    await withLevel(async ({ services, commands, shell, module }) => {
      shell.cells.set(SOURCE, "2_0");
      hitSource(shell, module, SOURCE, [0, 0.95, 0.5], 1000);
      const standing = commands.snapshot().staticChunks;
      const saved = commands.captureState();
      assert.ok(standing > 0);

      // The cell goes: its chunks with it, the broken state stays (and is saved).
      shell.unbuilt.add(SOURCE);
      for (const listener of shell.listeners) listener("2_0");
      assert.equal(commands.snapshot().staticChunks, 0);
      assert.deepEqual(commands.captureState(), saved);

      // The cell comes back: the shell builds the placement whole, the module breaks it back.
      shell.unbuilt.delete(SOURCE);
      services.addEntity({ id: SOURCE, components: {} });
      assert.deepEqual(shell.destroyed, [SOURCE, SOURCE]);
      assert.equal(commands.snapshot().staticChunks, standing);
      assert.equal(commands.snapshot().activeChunks, 0);
      assert.deepEqual(commands.captureState(), saved);
    }, { layout: layoutOf([{ position: [0, 0, 0] }]), sidecar: anchoredSidecar() });
  });

  await check("fracture module: a restore for an unbuilt source waits until the shell builds it", async () => {
    await withLevel(async ({ services, commands, shell }) => {
      const broken = instanceEntityId(ASSET_ID, 0);
      shell.unbuilt.add(broken);
      commands.restoreState([{ entityId: broken, state: "fractured", damage: 0 }]);
      assert.deepEqual(shell.destroyed, []);
      assert.equal(commands.isFractured(broken), false);
      assert.deepEqual(commands.captureState(), [{ entityId: broken, state: "fractured", damage: 0 }]);
      shell.unbuilt.delete(broken);
      services.addEntity({ id: broken, components: {} });
      assert.deepEqual(shell.destroyed, [broken]);
      assert.equal(commands.isFractured(broken), true);
    }, { layout: placementLayout() });
  });
}
