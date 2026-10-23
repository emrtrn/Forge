import assert from "node:assert/strict";
import {
  BehaviorSubsystem,
  type ActorCommandSink,
  type BehaviorRegistry,
  type PersistentScriptStateEntry,
} from "../../engine/behavior/behaviorSubsystem";
import { ActionMap } from "../../engine/input/actionMap";
import type { Entity } from "../../engine/scene/entity";

type Check = (label: string, fn: () => void) => void;

function actor(id = "actor:0"): Entity {
  return {
    id, name: id, tags: ["streamed"],
    components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      EventBindings: { bindings: [
        { event: "beginPlay", scriptId: "begin" },
        { event: "tick", scriptId: "tick" },
        { event: "endPlay", scriptId: "end" },
      ] },
      MessageBindings: { bindings: [{ message: "Ping", scriptId: "ping" }] },
    },
  };
}

function subsystem(registry: BehaviorRegistry, effects: string[] = []): BehaviorSubsystem {
  const actorCommandSink: ActorCommandSink = {
    setVisibility: (id, visible) => effects.push(`visibility:${id}:${visible}`),
    setCollisionEnabled: (id, enabled) => effects.push(`collision:${id}:${enabled}`),
    destroy: (id) => effects.push(`destroy:${id}`),
  };
  return new BehaviorSubsystem(registry, new ActionMap({}), () => undefined, undefined, undefined, { actorCommandSink });
}

function tick(behavior: BehaviorSubsystem, frame: number): void {
  behavior.update({ deltaSeconds: 0.016, elapsedSeconds: frame * 0.016, frame });
}

export function registerBehaviorSubsystemTests(check: Check): void {
  check("behavior unload: endPlay once, detached indexes/messages/ticks, persisted state survives a fresh life", () => {
    const events: string[] = [];
    const begins: unknown[] = [];
    const effects: string[] = [];
    const registry: BehaviorRegistry = {
      get: (id) => {
        if (id === "begin") return (context) => {
          begins.push({ saved: context.state.get("saved", null), temporary: context.state.get("temporary", null),
            endSaved: context.state.get("endSaved", null), endTemporary: context.state.get("endTemporary", null) });
          context.state.persist("saved", { visits: 1 });
          context.state.set("temporary", 7);
          events.push("begin");
        };
        if (id === "end") return (context) => {
          events.push(`end:${context.event?.reason}:${context.event?.payload?.reason}`);
          assert.equal(context.world.byName("actor:0"), "actor:0");
          assert.deepEqual(context.world.byTag("streamed"), ["actor:0"]);
          assert.equal(context.state.get("temporary", 0), 7);
          context.state.persist("endSaved", true);
          context.state.set("endTemporary", 9);
        };
        if (id === "tick" || id === "ping") return () => { events.push(id); };
        if (id === "observe") return (context) => {
          assert.equal(context.world.byName("actor:0"), null);
          assert.deepEqual(context.world.byTag("streamed"), []);
          assert.equal(context.world.transformOf("actor:0"), null);
        };
        return undefined;
      },
    };
    const behavior = subsystem(registry, effects);
    const entity = actor();
    behavior.setEntities([entity]);
    tick(behavior, 1);
    behavior.emitScriptMessage("Ping", "host", undefined, entity.id);
    tick(behavior, 2);
    assert.deepEqual(events, ["begin", "tick", "tick", "ping"]);
    assert.equal(behavior.unloadEntity(entity.id), true);
    assert.equal(behavior.unloadEntity(entity.id), false);
    assert.equal(behavior.unloadEntity("missing"), false);
    assert.equal(behavior.getScriptActorDebugInfo(entity.id), null);
    assert.deepEqual(behavior.getScriptMessageDebugSnapshot().subscribers, []);
    assert.deepEqual(behavior.getPersistentStateSnapshot(), [
      { entityId: entity.id, key: "endSaved", value: true },
      { entityId: entity.id, key: "saved", value: { visits: 1 } },
    ]);
    const afterUnload = [...events];
    const observer: Entity = { id: "observer", components: {
      Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Behavior: { scriptId: "observe" },
    } };
    assert.equal(behavior.addEntity(observer), true);
    behavior.emitScriptMessage("Ping", "host", undefined, entity.id);
    behavior.emitScriptMessage("Ping", "host");
    behavior.emitActorEvent(entity.id, "interact");
    tick(behavior, 3);
    assert.deepEqual(events, afterUnload);
    assert.equal(behavior.unloadEntity(observer.id), true);
    assert.equal(behavior.addEntity(entity), true);
    assert.deepEqual(events, afterUnload, "BeginPlay waits for the next tick");
    tick(behavior, 4);
    behavior.emitScriptMessage("Ping", "host", undefined, entity.id);
    tick(behavior, 5);
    assert.deepEqual(begins, [
      { saved: null, temporary: null, endSaved: null, endTemporary: null },
      { saved: { visits: 1 }, temporary: null, endSaved: true, endTemporary: null },
    ]);
    assert.deepEqual(events, ["begin", "tick", "tick", "ping", "end:unloaded:unloaded", "begin", "tick", "tick", "ping"]);
    assert.deepEqual(effects, [], "unload never calls the host destroy sink");
  });

  check("behavior unload: non-persisted state is discarded when no keys survive", () => {
    const seen: unknown[] = [];
    const behavior = subsystem({ get: (id) => id === "begin" ? (context) => {
      seen.push(context.state.get("temporary", null));
      context.state.set("temporary", 1);
    } : undefined });
    behavior.setEntities([actor()]);
    tick(behavior, 1);
    assert.equal(behavior.unloadEntity("actor:0"), true);
    assert.deepEqual(behavior.getPersistentStateSnapshot(), []);
    assert.equal(behavior.addEntity(actor()), true);
    tick(behavior, 2);
    assert.deepEqual(seen, [null, null]);
  });

  check("behavior unload: persisted hide/collision markers survive and apply on re-add", () => {
    let firstLife = true;
    const effects: string[] = [];
    const behavior = subsystem({ get: (id) => id === "begin" ? (context) => {
      if (!firstLife) return;
      firstLife = false;
      context.actor.setVisibility(false, { persist: true });
      context.actor.setCollisionEnabled(false, { persist: true });
    } : undefined }, effects);
    behavior.setEntities([actor()]);
    tick(behavior, 1);
    const snapshot = behavior.getPersistentStateSnapshot();
    assert.deepEqual(snapshot, [
      { entityId: "actor:0", key: "__actorCollisionDisabled", value: true },
      { entityId: "actor:0", key: "__actorHidden", value: true },
    ]);
    effects.length = 0;
    assert.equal(behavior.unloadEntity("actor:0"), true);
    assert.deepEqual(behavior.getPersistentStateSnapshot(), snapshot);
    assert.deepEqual(effects, []);
    assert.equal(behavior.addEntity(actor()), true);
    assert.deepEqual(effects, ["visibility:actor:0:false", "collision:actor:0:false"]);
    tick(behavior, 2);
    assert.equal(effects.length, 2);
  });

  check("behavior unload: EndPlay destroy marker survives without issuing a host destroy command", () => {
    const effects: string[] = [];
    const behavior = subsystem({ get: (id) => id === "end" ? (context) => {
      context.actor.destroy({ persist: true });
    } : undefined }, effects);
    behavior.setEntities([actor()]);
    tick(behavior, 1);
    assert.equal(behavior.unloadEntity("actor:0"), true);
    assert.equal(behavior.isPersistedDestroyed("actor:0"), true);
    assert.deepEqual(behavior.getPersistentStateSnapshot(), [
      { entityId: "actor:0", key: "__actorDestroyed", value: true },
    ]);
    tick(behavior, 2);
    assert.deepEqual(effects, [], "queued EndPlay commands never destroy an unloaded actor through the host");
    assert.equal(behavior.unloadEntity("actor:0"), false);
  });

  check("behavior snapshot: non-live entries survive and effects wait until that entity is added", () => {
    const effects: string[] = [];
    const seen: unknown[] = [];
    const behavior = subsystem({ get: (id) => id === "begin" ? (context) => {
      seen.push(context.state.get("saved", null));
    } : undefined }, effects);
    behavior.setEntities([]);
    const entries: PersistentScriptStateEntry[] = [
      { entityId: "actor:0", key: "__actorHidden", value: true },
      { entityId: "actor:0", key: "__actorCollisionDisabled", value: true },
      { entityId: "actor:0", key: "saved", value: { visits: [1, 2] } },
      { entityId: "actor:1", key: "__actorDestroyed", value: true },
      { entityId: "actor:1", key: "__actorHidden", value: true },
      { entityId: "actor:1", key: "__actorCollisionDisabled", value: true },
    ];
    const before = structuredClone(entries);
    behavior.applyPersistentStateSnapshot(entries);
    assert.deepEqual(behavior.getPersistentStateSnapshot(), [...before].sort((a, b) =>
      a.entityId.localeCompare(b.entityId) || a.key.localeCompare(b.key)));
    assert.deepEqual(effects, []);
    assert.equal(behavior.isPersistedDestroyed("actor:1"), true);
    assert.equal(behavior.isPersistedDestroyed("actor:0"), false);
    assert.equal(behavior.isPersistedDestroyed("missing"), false);
    (entries[2]!.value as { visits: number[] }).visits.push(3);
    assert.equal(behavior.addEntity(actor()), true);
    assert.deepEqual(effects, ["visibility:actor:0:false", "collision:actor:0:false"]);
    tick(behavior, 1);
    assert.deepEqual(seen, [{ visits: [1, 2] }], "restored state is cloned and visible to BeginPlay");
    effects.length = 0;
    assert.equal(behavior.addEntity(actor("actor:2")), true);
    assert.deepEqual(effects, [], "adding another actor does not replay live effects");
    assert.equal(behavior.addEntity(actor("actor:1")), true);
    assert.deepEqual(effects, ["destroy:actor:1"], "destroy supersedes hide/collision");
    assert.equal(behavior.getScriptActorDebugInfo("actor:1"), null);
    assert.equal(behavior.isPersistedDestroyed("actor:1"), true);
    effects.length = 0;
    behavior.applyPersistentStateSnapshot([]);
    assert.deepEqual(effects, ["visibility:actor:0:false", "collision:actor:0:false"], "restore effects only target live actors");
  });

  check("behavior snapshot: setEntities and clear wipe unloaded state and destroy markers", () => {
    const behavior = subsystem({ get: () => undefined });
    for (const reset of [() => behavior.setEntities([]), () => behavior.clear()]) {
      behavior.applyPersistentStateSnapshot([
        { entityId: "actor:0", key: "saved", value: 42 },
        { entityId: "actor:1", key: "__actorDestroyed", value: true },
      ]);
      assert.equal(behavior.isPersistedDestroyed("actor:1"), true);
      reset();
      assert.deepEqual(behavior.getPersistentStateSnapshot(), []);
      assert.equal(behavior.isPersistedDestroyed("actor:1"), false);
    }
  });
}
