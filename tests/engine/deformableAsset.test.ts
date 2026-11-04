import assert from "node:assert/strict";
import {
  DEFORMABLE_DEFAULTS, DEFORMABLE_LIMITS, createAssetDeformable, deformableSidecarPath, normalizeAssetDeformable,
  type AssetDeformableDef,
} from "../../engine/physics/deformable/deformableTypes";
import { validateSaveDeformablePayload } from "../../tools/saveValidator";
import { collectDroppedFields } from "../../tools/droppedFields";

const maximal: AssetDeformableDef = {
  version: 1, enabled: false, mode: "impact", dentImpulse: 500000, fullImpulse: 2000000,
  radius: 10, maxDepth: 2, plasticity: 1, maxDents: 64, collisionPolicy: "visual_only",
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
