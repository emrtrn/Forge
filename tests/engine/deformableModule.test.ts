/**
 * Deformable capability lifecycle through a fake shell host, without Rapier.
 */
import assert from "node:assert/strict";
import { BufferGeometry, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, type Object3D } from "three";

import type { EngineApp } from "../../engine/core/EngineApp";
import { createAssetDeformable } from "../../engine/physics/deformable/deformableTypes";
import type { PhysicsImpact } from "../../engine/physics/impactEvents";
import type { LayoutPlacement, RoomLayout } from "../../engine/scene/layout";
import { instanceEntityId } from "../../engine/scene/legacyRoomLayoutAdapter";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createDeformableModule } from "../../src/scene/capabilities/deformableModule";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  deformableCommandsService,
  deformableHostService,
  fractureCommandsService,
  scriptMessageBusService,
  type DeformableHost,
  type FractureCommands,
  type ScriptMessageBus,
} from "../../src/scene/capabilities/runtimeServiceKeys";

const ASSET_ID = "panel";
const OTHER_ASSET = "rigid";
const DT = 1 / 60;

interface Envelope { target?: string; source?: string; payload?: unknown }

function fakeBus() {
  const listeners = new Map<string, Set<(envelope: Envelope) => void>>();
  const sent: { topic: string; target: string | undefined; payload: unknown }[] = [];
  const bus = {
    subscribe(topic: string, listener: (envelope: Envelope) => void) {
      if (!listeners.has(topic)) listeners.set(topic, new Set());
      listeners.get(topic)!.add(listener);
      return () => { listeners.get(topic)!.delete(listener); };
    },
    emit(topic: string, target: string | undefined, payload: unknown, source?: string) {
      sent.push({ topic, target, payload });
      for (const listener of listeners.get(topic) ?? []) listener({ target, source, payload });
    },
  };
  return { bus: bus as unknown as ScriptMessageBus, sent, send: bus.emit };
}

const panelObject = (): Object3D => {
  const root = new Group();
  root.add(new Mesh(new PlaneGeometry(4, 4, 40, 40)));
  return root;
};
const geometryOf = (object: Object3D): BufferGeometry => (object.children[0] as Mesh).geometry;

function harness(placements: LayoutPlacement[] = [{ position: [0, 0, 0] }, { position: [9, 0, 0] }]) {
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const thresholds = new Map<string, number>();
  const impacts: PhysicsImpact[] = [];
  const objects = new Map<string, Object3D | null>();
  const fractured = new Set<string>();
  const host: DeformableHost = {
    physics: {
      setImpactEventThreshold(id, threshold) {
        if (threshold === null) thresholds.delete(id);
        else thresholds.set(id, threshold);
      },
      impacts: () => impacts,
    },
    deformableDef: (assetId) => assetId === ASSET_ID ? { ...createAssetDeformable(), dentImpulse: 100, fullImpulse: 1100, radius: 0.5, maxDepth: 0.2, plasticity: 0.5 } : null,
    renderObject: (id) => objects.get(id) ?? null,
  };
  const { bus, sent, send } = fakeBus();
  services.provide(deformableHostService, host);
  services.provide(scriptMessageBusService, bus);
  services.provide(fractureCommandsService, { isFractured: (id: string) => fractured.has(id) } as unknown as FractureCommands);
  const module = createDeformableModule();
  module.onRuntimeStart!(services);
  const commands = services.resolve(deformableCommandsService)!;
  const layout: RoomLayout = {
    schema: 1, name: "deformable-test", loadGroups: [], characters: [],
    instances: [{ assetId: ASSET_ID, placements }, { assetId: OTHER_ASSET, placements: [{ position: [3, 0, 0] }] }],
  };
  const context = createRuntimeContext({
    mode: "runtime",
    levelPath: "layouts/deformable-test.level.json",
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: {} as unknown as EngineApp,
    assetLoader: {} as unknown as AssetLoader,
    layout,
    sceneDocument: { schema: 1, name: "deformable-test", entities: [] },
    services,
  });
  void module.onLevelLoaded!(context);
  const first = instanceEntityId(ASSET_ID, 0);
  const second = instanceEntityId(ASSET_ID, 1);
  objects.set(first, panelObject());
  objects.set(second, panelObject());
  return {
    module, commands, thresholds, impacts, objects, fractured, sent, send, first, second,
    /** One frame with `list` as its impacts. */
    frame(list: PhysicsImpact[] = [], seconds = DT) {
      impacts.length = 0;
      impacts.push(...list);
      module.update!(seconds);
      impacts.length = 0;
    },
  };
}

/** A hit on `b` from `a`, pushing `b`'s surface towards -Z. */
const hitOn = (entityId: string, impulse: number, other = "car"): PhysicsImpact => ({
  a: other, b: entityId, point: [0, 0, 0.05], normal: [0, 0, -1], impulse, relativeSpeed: 5,
});

const dentDepth = (object: Object3D): number => {
  const position = geometryOf(object).getAttribute("position");
  let depth = 0;
  for (let index = 0; index < position.count; index += 1) depth = Math.max(depth, -position.getZ(index));
  return depth;
};

export function registerDeformableModuleTests(check: (label: string, run: () => void) => void): void {
  check("deformable module: placements with a sidecar opt in at dentImpulse, the rest stay out", () => {
    const test = harness([{ position: [0, 0, 0] }, { position: [1, 0, 0], hidden: true }]);
    assert.deepEqual(test.thresholds, new Map([[test.first, 100]]));
    assert.equal(test.commands.snapshot().deformable, 1);
    test.module.dispose!();
    assert.equal(test.thresholds.size, 0);
  });

  check("deformable module: an impact dents only the object it hit, into the surface", () => {
    const test = harness();
    const shared = geometryOf(test.objects.get(test.second)!);
    test.frame([hitOn(test.first, 1100)]);
    assert.ok(Math.abs(dentDepth(test.objects.get(test.first)!) - 0.1) < 1e-4);
    assert.equal(geometryOf(test.objects.get(test.second)!), shared);
    assert.deepEqual(
      { ...test.commands.snapshot(), lastDentMs: 0 },
      { deformable: 2, dented: 1, dents: 1, missed: 0, skipped: 0, lastDentMs: 0 },
    );
    const message = test.sent.find((item) => item.topic === "Deformable.Dented");
    assert.equal(message?.target, test.first);
    assert.equal((message?.payload as { instigator?: string }).instigator, "car");
    test.module.dispose!();
  });

  check("deformable module: as the impact's `a`, the surface is pushed the other way", () => {
    const test = harness();
    test.frame([{ a: test.first, b: "car", point: [0, 0, 0.05], normal: [0, 0, 1], impulse: 1100, relativeSpeed: 5 }]);
    assert.ok(Math.abs(dentDepth(test.objects.get(test.first)!) - 0.1) < 1e-4);
    test.module.dispose!();
  });

  check("deformable module: weak hits, debris and pointless impacts leave no dent", () => {
    const test = harness();
    test.frame([hitOn(test.first, 99)]);
    test.frame([hitOn(test.first, 900, "fracture:crate:3")]);
    test.frame([{ ...hitOn(test.first, 900), point: null }]);
    assert.equal(test.commands.snapshot().dents, 0);
    test.module.dispose!();
  });

  check("deformable module: one collision counts once, a harder frame only adds the difference", () => {
    const test = harness();
    const object = test.objects.get(test.first)!;
    test.frame([hitOn(test.first, 600)]);
    assert.ok(Math.abs(dentDepth(object) - 0.05) < 1e-4);
    test.frame([hitOn(test.first, 600)]);
    test.frame([hitOn(test.first, 300)]);
    assert.ok(Math.abs(dentDepth(object) - 0.05) < 1e-4, "the same collision going on");
    test.frame([hitOn(test.first, 1100)]);
    assert.ok(Math.abs(dentDepth(object) - 0.1) < 1e-4, "harder: up to that hit's depth");
    test.frame([], 0.3);
    test.frame([hitOn(test.first, 1100)]);
    assert.ok(Math.abs(dentDepth(object) - 0.2) < 1e-3, "a new collision adds up");
    test.module.dispose!();
  });

  check("deformable module: a rebuilt object gets its dents back and the old copy is freed", () => {
    const test = harness();
    const original = test.objects.get(test.first)!;
    test.frame([hitOn(test.first, 1100)]);
    const copy = geometryOf(original);
    let freed = 0;
    copy.addEventListener("dispose", () => { freed += 1; });

    // Its World Partition cell unloads: nothing renders it, the dents stay known.
    test.objects.set(test.first, null);
    test.frame();
    assert.equal(freed, 1);
    assert.equal(test.commands.snapshot().dents, 1);

    const rebuilt = panelObject();
    test.objects.set(test.first, rebuilt);
    test.frame();
    assert.ok(Math.abs(dentDepth(rebuilt) - 0.1) < 1e-4);
    test.module.dispose!();
  });

  check("deformable module: a hit on an unbuilt object is counted, not fatal", () => {
    const test = harness();
    test.objects.set(test.first, null);
    test.frame([hitOn(test.first, 1100)]);
    assert.equal(test.commands.snapshot().skipped, 1);
    assert.equal(test.commands.snapshot().dents, 0);
    test.module.dispose!();
  });

  check("deformable module: a broken object leaves the module", () => {
    const test = harness();
    test.frame([hitOn(test.first, 1100)]);
    test.send("Fracture.Broken", undefined, { entityId: test.first });
    assert.equal(test.thresholds.has(test.first), false);
    assert.equal(test.commands.snapshot().deformable, 1);
    assert.equal(test.commands.snapshot().dents, 0);

    test.fractured.add(test.second);
    test.frame([hitOn(test.second, 1100)]);
    assert.equal(test.commands.snapshot().dents, 0, "already broken this frame");
    test.module.dispose!();
  });

  check("deformable module: a script dents through its message, bad payloads are ignored", () => {
    const test = harness();
    const message = { point: [0, 0, 0.05], direction: [0, 0, -2], impulse: 1100 };
    test.send("Deformable.Dent", test.first, message, "kinematic-press");
    test.send("Deformable.Dent", test.second, { ...message, direction: [0, 0, 0] });
    test.send("Deformable.Dent", test.second, { ...message, point: "here" });
    test.send("Deformable.Dent", undefined, message);
    test.frame();
    assert.equal(test.commands.snapshot().dents, 1);
    assert.ok(Math.abs(dentDepth(test.objects.get(test.first)!) - 0.1) < 1e-4);
    test.module.dispose!();
  });

  check("deformable module: a pile-up spreads over frames, and past the queue it is dropped", () => {
    const placements = Array.from({ length: 20 }, (_, index) => ({ position: [index, 0, 0] as [number, number, number] }));
    const test = harness(placements);
    const ids = placements.map((_, index) => instanceEntityId(ASSET_ID, index));
    for (const id of ids) test.objects.set(id, panelObject());
    test.frame(ids.map((id) => hitOn(id, 1100)));
    assert.equal(test.commands.snapshot().dents, 4);
    assert.equal(test.commands.snapshot().skipped, 4);
    test.frame();
    assert.equal(test.commands.snapshot().dents, 8);
    test.frame();
    test.frame();
    assert.equal(test.commands.snapshot().dents, 16);
    test.module.dispose!();
  });

  check("deformable module: a level end gives shared geometry back", () => {
    const test = harness();
    const object = test.objects.get(test.first)!;
    const shared = geometryOf(object);
    test.frame([hitOn(test.first, 1100)]);
    assert.notEqual(geometryOf(object), shared);
    test.module.onLevelUnloaded!();
    assert.equal(geometryOf(object), shared);
    assert.equal(test.thresholds.size, 0);
    test.module.dispose!();
  });
}
