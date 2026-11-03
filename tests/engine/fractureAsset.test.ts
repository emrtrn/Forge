import assert from "node:assert/strict";
import {
  FRACTURE_DEFAULTS, FRACTURE_LIMITS, createAssetFracture, fractureSidecarPath,
  fractureGrain, fractureSourceHash, fractureWarnings, normalizeAssetFracture,
  type AssetFractureDef, type FractureCheckInput,
} from "../../engine/physics/fracture/fractureTypes";
import type { FractureSourceMesh } from "../../engine/physics/fracture/voronoiFracture";
import { restingImpulseFloor } from "../../engine/physics/impactEvents";
import { validatePlacement, validateSaveFracturePayload } from "../../tools/saveValidator";
import { clonePlacement } from "../../editor/core/layoutSnapshots";
import type { LayoutPlacement } from "../../engine/scene/layout";
import { collectDroppedFields } from "../../tools/droppedFields";

const maximal: AssetFractureDef = {
  version: 1, source: "voronoi", enabled: false, seed: 999999,
  cellCount: 64, pattern: "splinter", grainAxis: "z", grainStretch: 16, density: 20000, interiorMaterialId: "cut-stone", interiorUvScale: 100,
  breakImpulse: 1000000, damageToBreak: 1000000, chunkLifetime: 600,
  maxActiveChunks: 256, sourceHash: "fnv1a:1234abcd",
};
const currentHash = "fnv1a:12345678";
const input = (patch: Partial<FractureCheckInput> = {}): FractureCheckInput => ({
  def: { ...createAssetFracture(), sourceHash: currentHash },
  currentHash, closed: true, convex: true, materialCount: 1, totalMass: 10, step: 1 / 60,
  ...patch,
});
const mesh = (): FractureSourceMesh => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
});

/** Registers fracture sidecar normalization, persistence, hash and warning checks. */
export function registerFractureAssetTests(check: (label: string, fn: () => void) => void): void {
  check("fracture asset: defaults are complete and freshly copied", () => {
    assert.deepEqual(normalizeAssetFracture({}), FRACTURE_DEFAULTS);
    const first = createAssetFracture();
    const second = createAssetFracture();
    assert.deepEqual(first, FRACTURE_DEFAULTS);
    assert.notEqual(first, FRACTURE_DEFAULTS);
    assert.notEqual(first, second);
    first.cellCount = 64;
    assert.equal(second.cellCount, 12);
  });

  check("fracture asset: every valid field survives normalization", () => {
    assert.deepEqual(normalizeAssetFracture(maximal), maximal);
  });

  check("fracture asset: numeric limits clamp and integer fields round", () => {
    for (const [key, [min, max]] of Object.entries(FRACTURE_LIMITS)) {
      assert.equal(normalizeAssetFracture({ [key]: min - 5 })?.[key as keyof AssetFractureDef], min);
      assert.equal(normalizeAssetFracture({ [key]: max + 1e9 })?.[key as keyof AssetFractureDef], max);
    }
    assert.equal(normalizeAssetFracture({ cellCount: 1 })?.cellCount, 2);
    assert.equal(normalizeAssetFracture({ cellCount: 100 })?.cellCount, 64);
    assert.equal(normalizeAssetFracture({ cellCount: 12.6 })?.cellCount, 13);
    assert.equal(normalizeAssetFracture({ density: 0 })?.density, 1);
    assert.equal(normalizeAssetFracture({ breakImpulse: -5 })?.breakImpulse, 0);
    assert.equal(normalizeAssetFracture({ chunkLifetime: 1e9 })?.chunkLifetime, 600);
    assert.equal(normalizeAssetFracture({ seed: 12.6 })?.seed, 13);
    assert.equal(normalizeAssetFracture({ seed: 4294967295 })?.seed, 999999);
    assert.equal(normalizeAssetFracture({ seed: -3 })?.seed, 0);
    assert.equal(normalizeAssetFracture({ maxActiveChunks: 12.6 })?.maxActiveChunks, 13);
  });

  check("fracture asset: wrong types and non-finite numbers use defaults", () => {
    for (const wrong of ["wrong", false, [], {}, null, Number.NaN, Infinity, -Infinity]) {
      const raw = Object.fromEntries(Object.keys(FRACTURE_LIMITS).map((key) => [key, wrong]));
      assert.deepEqual(normalizeAssetFracture(raw), FRACTURE_DEFAULTS);
    }
    assert.deepEqual(normalizeAssetFracture({ enabled: "false", interiorMaterialId: 1, sourceHash: 1 }), FRACTURE_DEFAULTS);
  });

  check("fracture asset: nullable fields and hash syntax are enforced", () => {
    assert.equal(normalizeAssetFracture({ damageToBreak: null })?.damageToBreak, null);
    for (const interiorMaterialId of ["", null, 42]) {
      assert.equal(normalizeAssetFracture({ interiorMaterialId })?.interiorMaterialId, null);
    }
    for (const sourceHash of ["bad", "fnv1a:ABCDEF12", "fnv1a:1234567", "fnv1a:123456789", "fnv1a:1234567g"]) {
      assert.equal(normalizeAssetFracture({ sourceHash })?.sourceHash, null);
    }
    assert.equal(normalizeAssetFracture({ sourceHash: "fnv1a:00000000" })?.sourceHash, "fnv1a:00000000");
  });

  check("fracture asset: unsupported versions sources and non-objects are rejected", () => {
    for (const raw of [{ version: 2 }, { source: "imported" }, { version: undefined }, { source: null }, [], "x", null]) {
      assert.equal(normalizeAssetFracture(raw), null);
    }
  });

  check("fracture asset: maximal save round-trips without dropped fields", () => {
    const path = "assets/x/Crate.fracture.json";
    const output = validateSaveFracturePayload({ path, fracture: maximal });
    assert.deepEqual(output, { path, fracture: maximal });
    assert.deepEqual(collectDroppedFields(maximal, output.fracture, "fracture").paths, []);
  });

  check("fracture asset: geometry and unknown keys are dropped and reported", () => {
    const raw = { ...maximal, chunks: [{ id: "c0", mass: 1 }], extra: true };
    const output = validateSaveFracturePayload({ path: "Crate.fracture.json", fracture: raw });
    assert.deepEqual(output.fracture, maximal);
    assert.deepEqual(collectDroppedFields(raw, output.fracture, "fracture").paths, ["fracture.chunks", "fracture.extra"]);
  });

  check("fracture asset: save paths must stay relative with the correct suffix", () => {
    for (const path of ["/Crate.fracture.json", "C:/Crate.fracture.json", "../Crate.fracture.json",
      "assets/../Crate.fracture.json", "assets\\Crate.fracture.json", "Crate.json", "Crate.fracture.json\0", 3, null]) {
      assert.throws(() => validateSaveFracturePayload({ path, fracture: maximal }), /fracture path/);
    }
    assert.equal(validateSaveFracturePayload({ path: "assets/a..b.fracture.json", fracture: {} }).path,
      "assets/a..b.fracture.json");
  });

  check("fracture asset: save rejects damaged payloads with the schema error", () => {
    for (const raw of [null, [], "x"]) {
      assert.throws(() => validateSaveFracturePayload(raw), /fracture payload must be an object/);
    }
    for (const fracture of [null, [], "x", { version: 2 }, { source: "imported" }]) {
      assert.throws(() => validateSaveFracturePayload({ path: "Crate.fracture.json", fracture }),
        { message: 'fracture must be an object with version 1 and source "voronoi"' });
    }
  });

  check("fracture asset: sidecar paths follow collision slash and extension rules", () => {
    for (const path of ["assets/x/Crate.glb", "/assets/x/Crate.glb", "\\assets\\x\\Crate.glb"]) {
      assert.equal(fractureSidecarPath(path), "assets/x/Crate.fracture.json");
    }
    assert.equal(fractureSidecarPath("assets.v1/x/Crate"), "assets.v1/x/Crate.fracture.json");
  });

  check("fracture asset: source hash is deterministic with a pinned little-endian value", () => {
    const source = mesh();
    const hash = fractureSourceHash(source);
    assert.match(hash, /^fnv1a:[0-9a-f]{8}$/);
    assert.equal(fractureSourceHash(mesh()), hash);
    assert.equal(fractureSourceHash({
      positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 1, 0]),
      uvs: new Float32Array([0, 0]), indices: new Uint32Array([0]),
    }), "fnv1a:610134d8");
  });

  check("fracture asset: source hash covers positions normals UVs and index order", () => {
    const original = fractureSourceHash(mesh());
    const moved = mesh();
    moved.positions[0] = moved.positions[0]! + 1e-3;
    assert.notEqual(fractureSourceHash(moved), original);
    const normal = mesh();
    normal.normals[0] = 1e-3;
    assert.notEqual(fractureSourceHash(normal), original);
    const uv = mesh();
    uv.uvs![0] = 1e-3;
    assert.notEqual(fractureSourceHash(uv), original);
    assert.notEqual(fractureSourceHash({ ...mesh(), indices: new Uint32Array([1, 0, 2]) }), original);
  });

  check("fracture asset: implicit indices match sequential indices and missing UVs differ from zeros", () => {
    const source = mesh();
    assert.equal(fractureSourceHash(source), fractureSourceHash({ ...source, indices: null }));
    assert.notEqual(fractureSourceHash({ ...source, uvs: null }),
      fractureSourceHash({ ...source, uvs: new Float32Array(6) }));
    // Subarray offsets must not make the hash include unrelated backing bytes.
    const padded = new Float32Array([99, ...source.positions, 99]);
    assert.equal(fractureSourceHash({ ...source, positions: padded.subarray(1, 10) }), fractureSourceHash(source));
  });

  check("fracture asset: not-baked is exclusive with stale-bake", () => {
    assert.deepEqual(fractureWarnings(input({ def: createAssetFracture() })).map(({ code }) => code), ["not-baked"]);
  });

  check("fracture asset: stale-bake requires a differing non-null source hash", () => {
    assert.deepEqual(fractureWarnings(input({ def: { ...createAssetFracture(), sourceHash: "fnv1a:00000000" } }))
      .map(({ code }) => code), ["stale-bake"]);
    assert.deepEqual(fractureWarnings(input()), []);
  });

  check("fracture asset: not-closed warns on open meshes", () => {
    assert.deepEqual(fractureWarnings(input({ closed: false })).map(({ code }) => code), ["not-closed"]);
  });

  check("fracture asset: not-convex warns on concave meshes", () => {
    assert.deepEqual(fractureWarnings(input({ convex: false })).map(({ code }) => code), ["not-convex"]);
  });

  check("fracture asset: many-chunks starts above 32", () => {
    assert.deepEqual(fractureWarnings(input({ def: { ...input().def, cellCount: 32 } })), []);
    assert.deepEqual(fractureWarnings(input({ def: { ...input().def, cellCount: 33 } })).map(({ code }) => code), ["many-chunks"]);
  });

  check("fracture asset: self-weight warns only below the floor and displays it with one decimal", () => {
    const base = input();
    const floor = restingImpulseFloor(base.totalMass, base.step);
    assert.deepEqual(fractureWarnings({ ...base, def: { ...base.def, breakImpulse: floor } }), []);
    const warnings = fractureWarnings({ ...base, def: { ...base.def, breakImpulse: floor - 1e-9 } });
    assert.deepEqual(warnings.map(({ code }) => code), ["self-weight"]);
    assert.ok(warnings[0]?.message.includes(`${floor.toFixed(1)} N·s`));
  });

  check("fracture asset: multi-material warns when exterior faces use the first material", () => {
    assert.deepEqual(fractureWarnings(input({ materialCount: 2 })).map(({ code }) => code), ["multi-material"]);
  });

  check("fracture asset: combined warnings preserve their fixed order", () => {
    const base = input({ closed: false, convex: false, materialCount: 2 });
    const def = { ...createAssetFracture(), cellCount: 33, breakImpulse: 0 };
    assert.deepEqual(fractureWarnings({ ...base, def }).map(({ code }) => code),
      ["not-baked", "not-closed", "not-convex", "many-chunks", "self-weight", "multi-material"]);
    assert.deepEqual(fractureWarnings({ ...base, def: { ...def, sourceHash: "fnv1a:00000000" } }).map(({ code }) => code),
      ["stale-bake", "not-closed", "not-convex", "many-chunks", "self-weight", "multi-material"]);
  });

  check("fracture asset: disabled fracture suppresses all warnings", () => {
    assert.deepEqual(fractureWarnings(input({
      def: { ...createAssetFracture(), enabled: false, cellCount: 64, breakImpulse: 0 },
      closed: false, convex: false, materialCount: 2,
    })), []);
  });

  check("fracture asset: pattern and grain fall back and clamp, grain only for splinter", () => {
    const def = normalizeAssetFracture({ pattern: "shatter", grainAxis: "w", grainStretch: 99 })!;
    assert.equal(def.pattern, "uniform");
    assert.equal(def.grainAxis, "y");
    assert.equal(def.grainStretch, FRACTURE_LIMITS.grainStretch[1]);
    assert.equal(normalizeAssetFracture({ grainStretch: 0 })!.grainStretch, FRACTURE_LIMITS.grainStretch[0]);
    assert.equal(fractureGrain(def), undefined);
    assert.deepEqual(fractureGrain({ ...def, pattern: "splinter", grainAxis: "x", grainStretch: 5 }), { axis: 0, stretch: 5 });
    assert.deepEqual(fractureGrain({ ...def, pattern: "splinter", grainAxis: "z" }), { axis: 2, stretch: 16 });
  });

  check("fracture placement override: save keeps opt-out and threshold, editor clone copies it", () => {
    const placement: LayoutPlacement = { position: [0, 0, 0], fracture: { enabled: false, breakImpulse: 250 } };
    const saved = validatePlacement(placement);
    assert.deepEqual(saved.fracture, { enabled: false, breakImpulse: 250 });
    assert.deepEqual(collectDroppedFields(placement, saved).paths, []);
    const clone = clonePlacement(placement);
    assert.deepEqual(clone.fracture, placement.fracture);
    assert.notEqual(clone.fracture, placement.fracture);
  });

  check("fracture placement override: inherited enabled and empty overrides are not written", () => {
    assert.equal(validatePlacement({ position: [0, 0, 0], fracture: {} }).fracture, undefined);
    assert.equal(validatePlacement({ position: [0, 0, 0], fracture: { enabled: true } }).fracture, undefined);
    const [min, max] = FRACTURE_LIMITS.breakImpulse;
    assert.deepEqual(validatePlacement({ position: [0, 0, 0], fracture: { breakImpulse: min } }).fracture, { breakImpulse: min });
    assert.deepEqual(validatePlacement({ position: [0, 0, 0], fracture: { breakImpulse: max } }).fracture, { breakImpulse: max });
  });

  check("fracture placement override: malformed values reject the save", () => {
    const [min, max] = FRACTURE_LIMITS.breakImpulse;
    for (const fracture of [null, [], "off", { enabled: "no" }, { breakImpulse: "400" },
      { breakImpulse: Number.NaN }, { breakImpulse: min - 1 }, { breakImpulse: max + 1 }]) {
      assert.throws(() => validatePlacement({ position: [0, 0, 0], fracture }), /placement fracture/);
    }
  });
}
