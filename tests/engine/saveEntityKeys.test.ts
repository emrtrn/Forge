import assert from "node:assert/strict";
import { createSaveEntityKeys, rekeyEntries, SAVED_ACTOR_PREFIX } from "../../engine/persistence/saveEntityKeys";
import { cloneActorInstance, cloneUngroupedActorInstance, ensureActorIds } from "../../editor/core/layoutSnapshots";
import type { LayoutActorInstance } from "../../engine/scene/layout";
import { validateActorInstance } from "../../tools/saveValidator";
import { collectDroppedFields } from "../../tools/droppedFields";

const actor = (id?: string): LayoutActorInstance => ({
  classRef: "assets/Truck.actor.json", position: [0, 0, 0], ...(id ? { id } : {}),
});

/** Registers save identity checks. */
export function registerSaveEntityKeyTests(check: (label: string, run: () => void) => void): void {
  check("save identity: a saved actor is found again after its index moved", () => {
    const saved = createSaveEntityKeys([actor("truck"), actor("car")]).toSaved("actor:1");
    assert.equal(saved, `${SAVED_ACTOR_PREFIX}car`);
    const edited = createSaveEntityKeys([actor("new"), actor("truck"), actor("other"), actor("car")]);
    assert.equal(edited.toRuntime(saved), "actor:3");
  });

  check("save identity: old saves and id-less actors stay by index, other entities pass through", () => {
    const keys = createSaveEntityKeys([actor(), actor("car")]);
    assert.equal(keys.toSaved("actor:0"), "actor:0");
    assert.equal(keys.toRuntime("actor:0"), "actor:0");
    assert.equal(keys.toRuntime("actor:7"), "actor:7", "a save from before ids reads as it always did");
    for (const id of ["spawned:2", "character:0", "instance:crate:3", "fracture:x"]) {
      assert.equal(keys.toSaved(id), id);
      assert.equal(keys.toRuntime(id), id);
    }
  });

  check("save identity: an actor that left the level is null, never another actor", () => {
    const keys = createSaveEntityKeys([actor("car")]);
    assert.equal(keys.toRuntime(`${SAVED_ACTOR_PREFIX}truck`), null);
  });

  check("save identity: of two actors sharing an id the first has it", () => {
    const keys = createSaveEntityKeys([actor("twin"), actor("twin")]);
    assert.equal(keys.toSaved("actor:0"), `${SAVED_ACTOR_PREFIX}twin`);
    assert.equal(keys.toSaved("actor:1"), "actor:1");
    assert.equal(keys.toRuntime(`${SAVED_ACTOR_PREFIX}twin`), "actor:0");
  });

  check("save identity: entries are renamed, a null drops them, the rest is kept", () => {
    const entries = [{ entityId: "a", value: 1 }, { entityId: "b", value: 2 }];
    assert.deepEqual(rekeyEntries(entries, (id) => (id === "a" ? "x" : null)), [{ entityId: "x", value: 1 }]);
    assert.deepEqual(entries[0], { entityId: "a", value: 1 }, "the input stays as it was");
  });

  check("actor id: the editor fills gaps and splits doubles, a kept id never changes", () => {
    const actors = [actor("keep"), actor(), actor("keep"), actor()];
    ensureActorIds(actors);
    assert.equal(actors[0]!.id, "keep");
    const ids = actors.map((item) => item.id!);
    assert.equal(new Set(ids).size, 4);
    assert.ok(ids.slice(1).every((id) => id.startsWith("act-")));
    const again = actors.map((item) => item.id);
    ensureActorIds(actors);
    assert.deepEqual(actors.map((item) => item.id), again, "a second pass changes nothing");
    ensureActorIds(undefined);
  });

  check("actor id: an undo snapshot keeps it, a duplicate does not", () => {
    assert.equal(cloneActorInstance(actor("truck")).id, "truck");
    assert.equal("id" in cloneUngroupedActorInstance(actor("truck")), false);
  });

  check("actor id: it round-trips through the save, a bad one is refused", () => {
    const sent = actor("act-abc-123");
    const saved = validateActorInstance(sent);
    assert.equal(saved.id, "act-abc-123");
    assert.deepEqual(collectDroppedFields(sent, saved).paths, []);
    for (const id of ["", "has space", 7, "../x"]) {
      assert.throws(() => validateActorInstance({ ...actor(), id }), /invalid actor instance id/);
    }
  });
}
