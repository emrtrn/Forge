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
  fractureCommandsService,
  fractureHostService,
  type FractureHost,
} from "../../src/scene/capabilities/runtimeServiceKeys";

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
    onCellUnloaded(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachDynamicObject(id, object) { attachments.push({ id, object }); },
  };
  return {
    host, thresholds, impacts, added, removed, destroyed, impulses, attachments, poses, cells, listeners,
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

/** Each level owns its fetch stub and releases listeners and baked geometry. */
async function withLevel(
  run: (test: ReturnType<typeof harness> & { requested: string[] }) => Promise<void>,
  options: { layout?: RoomLayout; entities?: Entity[]; modelPath?: string } = {},
): Promise<void> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  const test = harness();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return url === "/Meshes/Crate.fracture.json"
      ? { ok: true, status: 200, json: async () => SIDECAR } as unknown as Response
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
    await test.module.onLevelLoaded!(context);
    await run({ ...test, requested });
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
      for (const listener of shell.listeners) listener("1_0");
      assert.deepEqual([...shell.removed].sort(), expectedRemoved.sort());
      assert.equal(commands.snapshot().activeChunks, retainedChunks.length);
      assert.equal(commands.isFractured(first), false);
      assert.deepEqual(shell.thresholds, new Map([[first, 400]]));
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
}
