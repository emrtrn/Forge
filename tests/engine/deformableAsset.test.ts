import assert from "node:assert/strict";
import {
  DEFORMABLE_DEFAULTS, DEFORMABLE_DETACH_LIMITS, DEFORMABLE_LIMITS, DEFORMABLE_MAX_PARTS, createAssetDeformable, deformableSidecarPath, normalizeAssetDeformable,
  type AssetDeformableDef,
} from "../../engine/physics/deformable/deformableTypes";
import { validateSaveDeformablePayload } from "../../tools/saveValidator";
import { collectDroppedFields } from "../../tools/droppedFields";

const maximal: AssetDeformableDef = {
  version: 1, enabled: false, mode: "impact", dentImpulse: 500000, fullImpulse: 2000000,
  radius: 10, maxDepth: 2, plasticity: 1, maxDents: 64, collisionPolicy: "visual_only",
  parts: [{
    id: "door_left", nodes: ["Door_L", "Door_L_Trim"], zone: { min: [0.7, 0.4, -0.6], max: [1.3, 2.6, 0.45] },
    detach: { impulse: 1000000, massKg: 100000, kick: 50 },
  }],
};

/** Registers deformable sidecar normalization and save allowlist checks. */
export function registerDeformableAssetTests(check: (label: string, run: () => void) => void): void {
  check("deformable asset: a maximal sidecar round-trips through the normalizer and the save", () => {
    assert.deepEqual(normalizeAssetDeformable(maximal), maximal);
    const payload = validateSaveDeformablePayload({ path: "assets/props/Panel.deformable.json", deformable: maximal });
    assert.deepEqual(payload.deformable, maximal);
    assert.deepEqual(collectDroppedFields(maximal, payload.deformable).paths, []);
  });

  check("deformable asset: an empty object gets the defaults, a new sidecar is valid", () => {
    assert.deepEqual(normalizeAssetDeformable({}), DEFORMABLE_DEFAULTS);
    assert.deepEqual(normalizeAssetDeformable(createAssetDeformable()), createAssetDeformable());
  });

  check("deformable asset: unsupported sidecars are refused", () => {
    for (const value of [null, 3, [], { version: 2 }, { mode: "cloth" }, { collisionPolicy: "rebuild" }]) {
      assert.equal(normalizeAssetDeformable(value), null);
    }
  });

  check("deformable asset: fields stay in bounds and the ramp never collapses", () => {
    const low = normalizeAssetDeformable({ radius: -1, maxDepth: 0, plasticity: -2, maxDents: 0, dentImpulse: -5 })!;
    assert.equal(low.radius, DEFORMABLE_LIMITS.radius[0]);
    assert.equal(low.maxDepth, DEFORMABLE_LIMITS.maxDepth[0]);
    assert.equal(low.plasticity, 0);
    assert.equal(low.maxDents, 1);
    assert.equal(low.dentImpulse, 0);
    assert.equal(normalizeAssetDeformable({ maxDents: 7.6 })!.maxDents, 8);
    assert.equal(normalizeAssetDeformable({ radius: "wide" })!.radius, DEFORMABLE_DEFAULTS.radius);
    const inverted = normalizeAssetDeformable({ dentImpulse: 900, fullImpulse: 100 })!;
    assert.ok(inverted.fullImpulse > inverted.dentImpulse);
  });

  check("deformable asset: broken parts are left out and the save reports them", () => {
    const good = { id: "door", nodes: ["Door"], zone: { min: [0, 0, 0], max: [1, 1, 1] } };
    const parts = [
      good,
      { ...good },
      { ...good, id: "" },
      { ...good, id: "no-nodes", nodes: [] },
      { ...good, id: "inverted", zone: { min: [2, 0, 0], max: [1, 1, 1] } },
      { ...good, id: "no-zone", zone: null },
      { ...good, id: "short", zone: { min: [0, 0], max: [1, 1, 1] } },
      { ...good, id: "nan", zone: { min: [Number.NaN, 0, 0], max: [1, 1, 1] } },
      "door",
    ];
    assert.deepEqual(normalizeAssetDeformable({ parts })!.parts, [good]);
    assert.equal("parts" in normalizeAssetDeformable({ parts: [] })!, false, "an old sidecar stays as it was");
    assert.equal("parts" in normalizeAssetDeformable({ parts: "door" })!, false);
    const many = Array.from({ length: DEFORMABLE_MAX_PARTS + 5 }, (_, index) => ({ ...good, id: `part-${index}` }));
    assert.equal(normalizeAssetDeformable({ parts: many })!.parts!.length, DEFORMABLE_MAX_PARTS);
    const sent = { ...maximal, parts: [{ ...good, futureField: 1 }] };
    const saved = validateSaveDeformablePayload({ path: "assets/Panel.deformable.json", deformable: sent });
    assert.deepEqual(collectDroppedFields(sent, saved.deformable).paths, ["parts[0].futureField"]);
  });

  check("deformable asset: a part's detach needs an impulse and stays in bounds", () => {
    const part = { id: "door", nodes: ["Door"], zone: { min: [0, 0, 0], max: [1, 1, 1] } };
    const read = (detach: unknown) => normalizeAssetDeformable({ parts: [{ ...part, detach }] })!.parts![0]!.detach;
    assert.deepEqual(read({ impulse: 500 }), { impulse: 500, massKg: 20, kick: 1 });
    assert.deepEqual(read({ impulse: -1, massKg: 0, kick: 99 }), {
      impulse: 0, massKg: DEFORMABLE_DETACH_LIMITS.massKg[0], kick: DEFORMABLE_DETACH_LIMITS.kick[1],
    });
    for (const broken of [{ massKg: 5 }, { impulse: "hard" }, { impulse: Number.NaN }, null, 3, []]) {
      assert.equal(read(broken), undefined, "the part stays, it just never tears off");
    }
  });

  check("deformable asset: the sidecar sits beside its model", () => {
    assert.equal(deformableSidecarPath("assets/props/Panel.glb"), "assets/props/Panel.deformable.json");
    assert.equal(deformableSidecarPath("\\assets\\props\\Panel.gltf"), "assets/props/Panel.deformable.json");
  });

  check("deformable asset: the save refuses a bad path or sidecar and reports unknown fields", () => {
    for (const path of ["../Panel.deformable.json", "/assets/Panel.deformable.json", "a\\b.deformable.json", "c:/x.deformable.json", "assets/Panel.fracture.json", 3]) {
      assert.throws(() => validateSaveDeformablePayload({ path, deformable: maximal }), /deformable path/);
    }
    assert.throws(() => validateSaveDeformablePayload({ path: "assets/Panel.deformable.json", deformable: { mode: "cloth" } }), /deformable must be/);
    assert.throws(() => validateSaveDeformablePayload(null), /payload must be an object/);
    const sent = { ...maximal, futureField: 1 };
    const saved = validateSaveDeformablePayload({ path: "assets/Panel.deformable.json", deformable: sent });
    assert.deepEqual(collectDroppedFields(sent, saved.deformable).paths, ["futureField"]);
  });
}
