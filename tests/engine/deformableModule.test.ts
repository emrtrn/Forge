/**
 * Deformable capability lifecycle through a fake shell host, without Rapier.
 */
import assert from "node:assert/strict";
import { BufferGeometry, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, type Object3D } from "three";

import type { EngineApp } from "../../engine/core/EngineApp";
import { createAssetDeformable, type AssetDeformableDef, type AssetDeformablePart } from "../../engine/physics/deformable/deformableTypes";
import type { PhysicsImpact } from "../../engine/physics/impactEvents";
import type { SavedDeformableState } from "../../engine/persistence/saveGameState";
import type { AssetManifest } from "../../engine/assets/manifest";
import { DEFORMABLE_COMPONENT, STATIC_MESH_COMPONENT } from "../../engine/scene/components";
import type { Entity, EntityComponentData } from "../../engine/scene/entity";
import type { LayoutPlacement, RoomLayout } from "../../engine/scene/layout";
import { instanceEntityId } from "../../engine/scene/legacyRoomLayoutAdapter";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createDeformableModule } from "../../src/scene/capabilities/deformableModule";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  assetManifestService,
  deformableCommandsService,
  deformableHostService,
  fractureCommandsService,
  scriptMessageBusService,
  type DeformableCommands,
  type DeformableHost,
  type FractureCommands,
  type ScriptMessageBus,
} from "../../src/scene/capabilities/runtimeServiceKeys";

const ASSET_ID = "panel";
const OTHER_ASSET = "rigid";
const DT = 1 / 60;
const TEST_DEF = { dentImpulse: 100, fullImpulse: 1100, radius: 0.5, maxDepth: 0.2, plasticity: 0.5 };
const MODEL_PATH = "/Meshes/Sedan.glb";

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

/** A body panel left of x = 0, and right of it a "Door" node holding a panel. */
const partedObject = (): { root: Group; body: Mesh; door: Mesh } => {
  const root = new Group();
  const body = new Mesh(new PlaneGeometry(4, 4, 40, 40));
  body.position.x = -2;
  const doorNode = new Group();
  doorNode.name = "Door";
  doorNode.position.x = 2;
  const door = new Mesh(new PlaneGeometry(4, 4, 40, 40));
  doorNode.add(door);
  root.add(body, doorNode);
  return { root, body, door };
};

function harness(
  placements: LayoutPlacement[] = [{ position: [0, 0, 0] }, { position: [9, 0, 0] }],
  actors: Entity[] = [],
  beforeLoad?: (commands: DeformableCommands) => void,
  defPatch: Partial<AssetDeformableDef> = {},
) {
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const thresholds = new Map<string, number>();
  const bodies = new Map<string, Entity>();
  const velocities = new Map<string, { linear: readonly number[]; angular: readonly number[] }>();
  const passing: [string, string][] = [];
  const dynamicObjects = new Map<string, Object3D>();
  const scene = new Scene();
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
      addEntities(entities) {
        for (const entity of entities) bodies.set(entity.id, entity);
        return entities.length;
      },
      removeEntities(entityIds) {
        for (const id of entityIds) bodies.delete(id);
      },
      // The source moves at 3 m/s along +X, turning about +Y at 2 rad/s around the origin.
      pointVelocity: (_id, point) => [3 + 2 * point[2], 0, -2 * point[0]],
      angularVelocityOf: () => [0, 2, 0],
      setBodyVelocity(id, linear, angular) {
        velocities.set(id, { linear, angular });
      },
      passThroughUntilApart(id, other) {
        passing.push([id, other]);
      },
    },
    attachDynamicObject(id, object) {
      if (object) dynamicObjects.set(id, object);
      else dynamicObjects.delete(id);
    },
    deformableDef: (assetId) => assetId === ASSET_ID ? { ...createAssetDeformable(), ...TEST_DEF, ...defPatch } : null,
    renderObject: (id) => objects.get(id) ?? null,
    dentsPerFrame: () => 4,
    wheelNodes: () => ["wheel-front"],
  };
  const { bus, sent, send } = fakeBus();
  services.provide(deformableHostService, host);
  services.provide(scriptMessageBusService, bus);
  services.provide(fractureCommandsService, { isFractured: (id: string) => fractured.has(id) } as unknown as FractureCommands);
  services.provide(assetManifestService, () => Promise.resolve({
    assets: [{ id: ASSET_ID, assetType: "staticMesh", path: MODEL_PATH }],
  } as unknown as AssetManifest));
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
    scene,
    camera: new PerspectiveCamera(),
    engineApp: {} as unknown as EngineApp,
    assetLoader: {} as unknown as AssetLoader,
    layout,
    sceneDocument: { schema: 1, name: "deformable-test", entities: actors },
    services,
  });
  beforeLoad?.(services.resolve(deformableCommandsService)!);
  const loaded = module.onLevelLoaded!(context);
  const first = instanceEntityId(ASSET_ID, 0);
  const second = instanceEntityId(ASSET_ID, 1);
  objects.set(first, panelObject());
  objects.set(second, panelObject());
  return {
    module, services, loaded, commands, thresholds, impacts, objects, fractured, sent, send, first, second,
    bodies, velocities, passing, dynamicObjects, scene,
    /** One frame with `list` as its impacts. */
    frame(list: PhysicsImpact[] = [], seconds = DT) {
      impacts.length = 0;
      impacts.push(...list);
      module.update!(seconds);
      impacts.length = 0;
    },
  };
}

const LOOSE_DOOR: AssetDeformablePart[] = [{
  id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] }, detach: { impulse: 800, massKg: 40, kick: 0 },
}];

/** A harness whose first object has a door that tears off at 800 N·s. */
function lossyHarness() {
  const test = harness(undefined, undefined, undefined, { parts: LOOSE_DOOR });
  const { root, door } = partedObject();
  test.objects.set(test.first, root);
  return {
    ...test, root, door, doorNode: door.parent!,
    tear: () => test.frame([{ ...hitOn(test.first, 900), point: [1, 0, 0.05] }]),
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
      { deformable: 2, dented: 1, dents: 1, missed: 0, skipped: 0, lastDentMs: 0, detached: 0 },
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

  check("deformable module: a part keeps its dent, names it, and has its own collision", () => {
    const parts: AssetDeformablePart[] = [{ id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] } }];
    const test = harness(undefined, undefined, undefined, { parts });
    const { root, body, door } = partedObject();
    test.objects.set(test.first, root);
    const bodyGeometry = body.geometry;
    const doorGeometry = door.geometry;
    test.frame([{ ...hitOn(test.first, 1100), point: [1, 0, 0.05] }]);
    assert.equal(body.geometry, bodyGeometry, "the door's dent stays off the body");
    assert.notEqual(door.geometry, doorGeometry);
    const message = test.sent.find((item) => item.topic === "Deformable.Dented");
    assert.equal((message?.payload as { part?: string }).part, "door");

    // Same collision, same frame budget: the body still takes its own first hit.
    test.frame([{ ...hitOn(test.first, 1100), point: [-1, 0, 0.05] }]);
    assert.notEqual(body.geometry, bodyGeometry);
    assert.equal(test.commands.snapshot().dents, 2);
    const saved = test.commands.captureState();
    assert.deepEqual(saved[0]!.dents.map((dent) => dent.part), ["door", undefined]);
    test.module.dispose!();
  });

  check("deformable module: a hard hit tears a part off once, at the speed of the spot it was on", () => {
    const parts: AssetDeformablePart[] = [{
      id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] },
      detach: { impulse: 800, massKg: 40, kick: 1.5 },
    }];
    const test = harness(undefined, undefined, undefined, { parts });
    const { root, door } = partedObject();
    test.objects.set(test.first, root);
    const onDoor = (impulse: number): PhysicsImpact => ({ ...hitOn(test.first, impulse), point: [1, 0, 0.05] });

    test.frame([onDoor(700)]);
    assert.equal(test.bodies.size, 0, "a dent, but not hard enough to tear it off");
    assert.equal(door.parent!.parent, root);
    const dented = door.geometry;

    test.frame([], 0.3);
    test.frame([onDoor(900)]);
    assert.equal(door.geometry, dented, "the dented mesh leaves, not a clean one");
    assert.notEqual(door.parent!.parent, root);
    assert.equal(test.commands.snapshot().detached, 1);
    assert.equal(test.commands.snapshot().dents, 0, "the dent left with the part");

    assert.equal(test.bodies.size, 1);
    const [pieceId, body] = [...test.bodies][0]!;
    assert.ok(pieceId.startsWith(`detached:${test.first}:door:`));
    const collider = body.components.Collider as unknown as { massKg: number; simulatePhysics: boolean; primitives: { points: unknown[] }[] };
    assert.equal(collider.massKg, 40);
    assert.equal(collider.simulatePhysics, true);
    assert.equal(collider.primitives[0]!.points.length, 8);
    assert.deepEqual(test.passing, [[pieceId, test.first]]);
    assert.equal(test.dynamicObjects.has(pieceId), true);
    assert.equal(test.dynamicObjects.get(pieceId)!.parent, test.scene);

    // The fake source's spot velocity at the piece's centre, plus the kick away from the object.
    const { linear, angular } = test.velocities.get(pieceId)!;
    const [x, , z] = (body.components.Transform as unknown as { position: [number, number, number] }).position;
    const length = Math.hypot(x, z);
    assert.ok(Math.abs(linear[0]! - (3 + 2 * z + 1.5 * x / length)) < 1e-5, String(linear));
    assert.ok(Math.abs(linear[2]! - (-2 * x + 1.5 * z / length)) < 1e-5, String(linear));
    assert.equal(linear[1], 0);
    assert.deepEqual(angular, [0, 2, 0]);
    const message = test.sent.filter((item) => item.topic === "Deformable.PartDetached");
    assert.equal(message.length, 1);
    assert.deepEqual(message[0]!.payload, { entityId: test.first, part: "door", pieceId, impulse: 900, instigator: "car" });

    test.frame([], 0.3);
    test.frame([onDoor(5000)]);
    test.frame([onDoor(5000), onDoor(5000)]);
    assert.equal(test.bodies.size, 1, "a part goes only once");
    assert.equal(test.sent.filter((item) => item.topic === "Deformable.PartDetached").length, 1);
    test.module.dispose!();
    assert.equal(test.bodies.size, 0, "the level end takes the piece away");
    assert.equal(test.dynamicObjects.size, 0);
    assert.equal(test.scene.children.length, 0);
  });

  check("deformable module: a piece hitting its own car leaves no dent, one hit can dent and tear", () => {
    const parts: AssetDeformablePart[] = [{ id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] }, detach: { impulse: 800, massKg: 40, kick: 0 } }];
    const test = harness(undefined, undefined, undefined, { parts });
    const { root, door } = partedObject();
    test.objects.set(test.first, root);
    const shared = door.geometry;
    test.frame([{ ...hitOn(test.first, 900), point: [1, 0, 0.05] }]);
    assert.notEqual(door.geometry, shared, "the tearing hit left its dent on the part first");
    const dents = test.commands.snapshot().dents;
    test.frame([], 0.3);
    test.frame([{ ...hitOn(test.first, 900, "detached:other:door:0"), point: [-1, 0, 0.05] }]);
    assert.equal(test.commands.snapshot().dents, dents);
    test.module.dispose!();
  });

  check("deformable module: a rebuilt object comes without its lost parts, with its other dents", () => {
    const test = lossyHarness();
    test.tear();
    test.frame([{ ...hitOn(test.first, 500), point: [-1, 0, 0.05] }]);
    assert.equal(test.commands.snapshot().dents, 1);

    test.objects.set(test.first, null);
    test.frame();
    const rebuilt = partedObject();
    test.objects.set(test.first, rebuilt.root);
    test.frame();
    assert.equal(rebuilt.door.parent!.parent, null, "the door stays gone");
    assert.equal(test.commands.snapshot().dents, 1);
    test.module.dispose!();
  });

  check("deformable module: a save lists lost parts and the asset, a load without them puts the door back", () => {
    const test = lossyHarness();
    const { door, doorNode, root } = test;
    const shared = door.geometry;
    test.tear();
    const saved = test.commands.captureState();
    assert.deepEqual(saved, [{ entityId: test.first, dents: [], detachedParts: ["door"], assetId: ASSET_ID }]);

    // An older save: the door was on.
    test.commands.restoreState([]);
    assert.equal(test.commands.snapshot().detached, 0);
    assert.equal(test.bodies.size, 0, "the loose piece is gone");
    assert.equal(doorNode.parent, root);
    assert.equal(door.geometry, shared);
    test.frame();

    // The later save: the door was off, and no piece comes back with it.
    test.commands.restoreState(saved);
    test.frame();
    assert.equal(doorNode.parent, null);
    assert.equal(test.commands.snapshot().detached, 0);
    assert.deepEqual(test.commands.captureState(), saved, "it stays lost in the next save");
    test.frame([], 0.3);
    test.frame([{ ...hitOn(test.first, 5000), point: [1, 0, 0.05] }]);
    assert.equal(test.bodies.size, 0, "a part that is gone cannot tear off again");

    test.commands.restoreState([]);
    test.frame();
    assert.equal(doorNode.parent, root, "a door only a save removed comes back too");
    test.module.dispose!();
  });

  check("deformable module: a save entry from another asset is ignored", () => {
    const test = lossyHarness();
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      test.commands.restoreState([{ entityId: test.first, dents: [], detachedParts: ["door"], assetId: "some-other-truck" }]);
    } finally {
      console.warn = warn;
    }
    test.frame();
    assert.equal(test.doorNode.parent, test.root);
    assert.deepEqual(test.commands.captureState(), []);
    assert.equal(warnings.length, 1);
    test.module.dispose!();
  });

  check("deformable module: loose pieces stay under a budget, the oldest goes first", () => {
    const test = harness(Array.from({ length: 18 }, (_, index) => ({ position: [index * 9, 0, 0] as [number, number, number] })), undefined, undefined, { parts: LOOSE_DOOR });
    for (let index = 0; index < 18; index += 1) {
      const id = instanceEntityId(ASSET_ID, index);
      test.objects.set(id, partedObject().root);
      test.frame([{ ...hitOn(id, 900), point: [1, 0, 0.05] }]);
    }
    assert.equal(test.commands.snapshot().detached, 16);
    assert.equal(test.dynamicObjects.size, 16);
    assert.equal(test.scene.children.length, 16);
    assert.equal([...test.bodies.keys()].some((id) => id.includes(`${instanceEntityId(ASSET_ID, 0)}:`)), false);
    test.module.dispose!();
  });

  check("deformable module: a part without detach stays on, however hard the hit", () => {
    const parts: AssetDeformablePart[] = [{ id: "door", nodes: ["Door"], zone: { min: [0, -2, -1], max: [4, 2, 1] } }];
    const test = harness(undefined, undefined, undefined, { parts });
    const { root, door } = partedObject();
    test.objects.set(test.first, root);
    test.frame([{ ...hitOn(test.first, 100000), point: [1, 0, 0.05] }]);
    assert.equal(test.bodies.size, 0);
    assert.equal(door.parent!.parent, root);
    test.module.dispose!();
  });

  check("deformable module: a part that matches no mesh warns once and the hit lands on the body", () => {
    const parts: AssetDeformablePart[] = [{ id: "hood", nodes: ["Hood"], zone: { min: [-9, -9, -9], max: [9, 9, 9] } }];
    const test = harness(undefined, undefined, undefined, { parts });
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      test.frame([hitOn(test.first, 1100)]);
      test.frame([], 0.3);
      test.frame([hitOn(test.first, 1100)]);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(warnings, ["[deformable] parts with no matching mesh, hits fall back to the body: hood"]);
    assert.ok(dentDepth(test.objects.get(test.first)!) > 0.05);
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

const actorEntity = (id: string, deformable: EntityComponentData | null): Entity => ({
  id,
  name: id,
  components: {
    [STATIC_MESH_COMPONENT]: { assetId: ASSET_ID } as unknown as EntityComponentData,
    ...(deformable ? { [DEFORMABLE_COMPONENT]: deformable } : {}),
  },
}) as unknown as Entity;

/** Serves the actor mesh's sidecar while `run` works. */
async function withSidecar(run: () => Promise<void>, sidecar: object = TEST_DEF): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => (String(input) === "/Meshes/Sedan.deformable.json"
    ? { ok: true, status: 200, json: async () => sidecar }
    : { ok: false, status: 404, json: async () => ({}) }) as unknown as Response) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** Lets a streamed actor's sidecar load finish. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A car: a body beside a named wheel and a wheel the vehicle module has rigged. */
function carObject(): { root: Object3D; body: Mesh; wheel: Mesh; rigged: Mesh } {
  const root = new Group();
  const body = new Mesh(new PlaneGeometry(4, 4, 40, 40));
  const wheel = new Mesh(new PlaneGeometry(4, 4, 40, 40));
  wheel.name = "wheel-front";
  const rigged = new Mesh(new PlaneGeometry(4, 4, 40, 40));
  const pivot = new Group();
  pivot.name = "VehicleWheel:wheel-back";
  pivot.add(rigged);
  root.add(body, wheel, pivot);
  return { root, body, wheel, rigged };
}

export async function registerDeformableActorTests(check: (label: string, run: () => Promise<void>) => Promise<void> | void): Promise<void> {
  await check("deformable module: a save round-trips dents, and a restore replaces what happened since", () => withSidecar(async () => {
    const test = harness();
    const object = test.objects.get(test.first)!;
    test.frame([hitOn(test.first, 1100)]);
    const saved = JSON.parse(JSON.stringify(test.commands.captureState())) as SavedDeformableState[];
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.entityId, test.first);
    assert.equal(saved[0]!.dents.length, 1);

    test.frame([], 0.3);
    test.frame([hitOn(test.second, 1100)]);
    test.commands.restoreState(saved);
    test.frame();
    assert.equal(test.commands.snapshot().dented, 1);
    assert.equal(dentDepth(test.objects.get(test.second)!), 0, "the dent made after the save is gone");
    assert.ok(Math.abs(dentDepth(object) - 0.1) < 1e-4);
    assert.deepEqual(test.sent.filter((item) => item.topic === "Deformable.Dented").length, 2, "a restore is quiet");
    assert.deepEqual(JSON.parse(JSON.stringify(test.commands.captureState())), saved);
    test.module.dispose!();
  }));

  await check("deformable module: a restore that beats the level's build waits for it", () => withSidecar(async () => {
    const saved: SavedDeformableState[] = [{
      entityId: instanceEntityId(ASSET_ID, 0),
      dents: [{ point: [0, 0, 0], direction: [0, 0, -1], depth: 0.1 }],
    }];
    const test = harness(undefined, [], (commands) => commands.restoreState(saved));
    await test.loaded;
    test.frame();
    assert.ok(Math.abs(dentDepth(test.objects.get(test.first)!) - 0.1) < 1e-4);
    test.module.dispose!();
  }));

  await check("deformable module: an entry with no object warns, stays in the next save and does no harm", () => withSidecar(async () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
    try {
      const saved: SavedDeformableState[] = [{ entityId: "instance:gone:7", dents: [{ point: [0, 0, 0], direction: [0, 0, -1], depth: 0.1 }] }];
      const test = harness();
      await test.loaded;
      test.commands.restoreState(saved);
      test.frame();
      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]), /instance:gone:7/);
      assert.deepEqual(test.commands.captureState(), saved);
      test.module.dispose!();
    } finally {
      console.warn = warn;
    }
  }));

  await check("deformable module: an actor opts in with its component, and only then", () => withSidecar(async () => {
    const test = harness([], [
      actorEntity("actor:car", {} as EntityComponentData),
      actorEntity("actor:off", { enabled: false } as unknown as EntityComponentData),
      actorEntity("actor:plain", null),
    ]);
    await test.loaded;
    assert.deepEqual(test.thresholds, new Map([["actor:car", TEST_DEF.dentImpulse]]));
    test.module.dispose!();
  }));

  await check("deformable module: a car's body dents, its wheels stay rigid", () => withSidecar(async () => {
    const test = harness([], [actorEntity("actor:car", {} as EntityComponentData)]);
    await test.loaded;
    const car = carObject();
    const wheelGeometry = car.wheel.geometry;
    const riggedGeometry = car.rigged.geometry;
    const bodyGeometry = car.body.geometry;
    test.objects.set("actor:car", car.root);
    test.frame([hitOn("actor:car", 1100)]);
    assert.notEqual(car.body.geometry, bodyGeometry);
    assert.equal(car.wheel.geometry, wheelGeometry);
    assert.equal(car.rigged.geometry, riggedGeometry);
    test.module.dispose!();
  }));

  await check("deformable module: an actor that streams out takes its loose parts, not its loss", () => withSidecar(async () => {
    const test = harness([], []);
    await test.loaded;
    const entity = actorEntity("actor:car", {} as EntityComponentData);
    test.services.addEntity(entity);
    await settle();
    const first = partedObject();
    test.objects.set("actor:car", first.root);
    test.frame([{ ...hitOn("actor:car", 900), point: [1, 0, 0.05] }]);
    assert.equal(test.commands.snapshot().detached, 1);

    test.services.removeEntity("actor:car");
    test.objects.set("actor:car", null);
    test.frame();
    assert.equal(test.commands.snapshot().detached, 0, "nothing is left lying where nobody goes back");
    assert.equal(test.scene.children.length, 0);

    test.services.addEntity(entity);
    await settle();
    const returned = partedObject();
    test.objects.set("actor:car", returned.root);
    test.frame();
    assert.equal(returned.door.parent!.parent, null);
    test.module.dispose!();
  }, { ...TEST_DEF, parts: LOOSE_DOOR }));

  await check("deformable module: an actor that streams out comes back with its dents", () => withSidecar(async () => {
    const test = harness([], []);
    await test.loaded;
    const entity = actorEntity("actor:car", {} as EntityComponentData);
    test.services.addEntity(entity);
    await settle();
    assert.equal(test.thresholds.has("actor:car"), true);
    test.objects.set("actor:car", panelObject());
    test.frame([hitOn("actor:car", 1100)]);

    test.services.removeEntity("actor:car");
    test.objects.set("actor:car", null);
    test.frame();
    assert.equal(test.thresholds.has("actor:car"), false);
    assert.equal(test.commands.snapshot().dents, 1);

    test.services.addEntity(entity);
    await settle();
    const returned = panelObject();
    test.objects.set("actor:car", returned);
    test.frame();
    assert.ok(Math.abs(dentDepth(returned) - 0.1) < 1e-4);
    test.module.dispose!();
  }));
}
