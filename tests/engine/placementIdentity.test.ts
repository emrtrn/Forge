/**
 * World Builder F1, step 1: placements carry a stable `id` and a semantic
 * `role` (World Builder plan v0.4 §13.4). Ownership records and the
 * placeholder → model swap point at the id, so it has to survive save, undo
 * snapshots and asset regrouping — and must never be shared by a duplicate.
 */
import assert from "node:assert/strict";

import {
  clonePlacement,
  cloneUngroupedPlacement,
  reidentifyDuplicatePlacement,
} from "../../editor/core/layoutSnapshots";
import type { LayoutPlacement, RoomLayout } from "../../engine/scene/layout";
import {
  collectPlacementIds,
  findDuplicatePlacementId,
  isPlacementId,
  isSemanticRole,
} from "../../engine/scene/placementIdentity";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateLayout, validatePlacement } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

function layoutWith(groups: Array<{ assetId: string; placements: LayoutPlacement[] }>): RoomLayout {
  return { schema: 1, name: "Placement identity", loadGroups: [], instances: groups, characters: [] };
}

export function registerPlacementIdentityTests(check: Check): void {
  check("placement identity: id and role syntax", () => {
    for (const id of ["plc-mh2x1a-3k9f", "village_01.house:3", "A"]) assert.ok(isPlacementId(id), id);
    for (const id of ["", " plc", "-plc", "plc 1", "plc/1", "x".repeat(129), 7, null]) {
      assert.ok(!isPlacementId(id), String(id));
    }
    for (const role of ["building", "building.residential.detached", "prop.sign.speedLimit", "vegetation.tree_2"]) {
      assert.ok(isSemanticRole(role), role);
    }
    for (const role of ["", "Building", "building.", ".building", "building..house", "building.Residential", "2d.house", "a-b", 3]) {
      assert.ok(!isSemanticRole(role), String(role));
    }
  });

  check("placement identity: save keeps id and role first and leaves plain placements unchanged", () => {
    const authored = { position: [1, 0, 2], name: "House", id: "plc-1", role: "building.residential.detached" };
    const saved = validatePlacement(authored);
    assert.deepEqual(Object.keys(saved).slice(0, 3), ["id", "role", "position"]);
    assert.deepEqual(collectDroppedFields(authored, saved, "placement").paths, []);

    const plain = validatePlacement({ position: [1, 0, 2], name: "Rock" });
    assert.equal(JSON.stringify(plain), '{"position":[1,0,2],"name":"Rock"}');

    assert.throws(() => validatePlacement({ position: [0, 0, 0], id: "" }), /invalid placement id/);
    assert.throws(() => validatePlacement({ position: [0, 0, 0], id: 4 }), /invalid placement id/);
    assert.throws(() => validatePlacement({ position: [0, 0, 0], role: "House" }), /invalid placement role/);
  });

  check("placement identity: a layout rejects the same id twice, across asset groups", () => {
    const unique = layoutWith([
      { assetId: "shape:cube", placements: [{ position: [0, 0, 0], id: "plc-a" }, { position: [1, 0, 0] }] },
      { assetId: "mesh:house", placements: [{ position: [2, 0, 0], id: "plc-b", role: "building" }] },
    ]);
    const saved = validateLayout(unique);
    assert.deepEqual(collectDroppedFields(unique, saved, "layout").paths, []);

    const clash = layoutWith([
      { assetId: "shape:cube", placements: [{ position: [0, 0, 0], id: "plc-a" }] },
      { assetId: "mesh:house", placements: [{ position: [2, 0, 0], id: "plc-a" }] },
    ]);
    assert.throws(() => validateLayout(clash), /duplicate placement id "plc-a"/);
    assert.equal(findDuplicatePlacementId(unique.instances), null);
  });

  check("placement identity: undo snapshots keep id and role; duplicates get a fresh id and keep the role", () => {
    const source: LayoutPlacement = { position: [0, 0, 0], id: "plc-a", role: "building.civic.school", groupId: "g" };
    const snapshot = clonePlacement(source);
    assert.deepEqual(snapshot, source);
    assert.notEqual(snapshot, source);

    const layout = layoutWith([{ assetId: "shape:cube", placements: [source, { position: [1, 0, 0], id: "plc-b" }] }]);
    const taken = collectPlacementIds(layout);
    assert.deepEqual([...taken].sort(), ["plc-a", "plc-b"]);

    const first = cloneUngroupedPlacement(source);
    const second = cloneUngroupedPlacement(source);
    reidentifyDuplicatePlacement(first, taken);
    reidentifyDuplicatePlacement(second, taken);
    assert.ok(isPlacementId(first.id) && isPlacementId(second.id));
    assert.ok(!["plc-a", "plc-b"].includes(first.id!));
    assert.notEqual(first.id, second.id);
    assert.equal(first.role, "building.civic.school");
    assert.equal(source.id, "plc-a");

    const anonymous = cloneUngroupedPlacement({ position: [0, 0, 0], role: "prop.bench" });
    reidentifyDuplicatePlacement(anonymous, taken);
    assert.equal(anonymous.id, undefined);
  });
}
