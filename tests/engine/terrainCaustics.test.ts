import assert from "node:assert/strict";
import { DataTexture, Group, NoColorSpace, RGBAFormat, Scene, Vector4 } from "three";
import { validateWaterBody, resolveLakeAppearance } from "../../engine/scene/waterBody";
import { normalizeForgeMaterialDef } from "../../engine/assets/material";
import { validateForgeMaterialDef } from "../../tools/saveValidator";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createTerrainLayerArray } from "../../engine/render-three/terrain/terrainLayerArray";
import { createTerrainCausticsUniforms, lakeCausticsContains, registerLakeCaustics, updateTerrainCaustics } from "../../engine/render-three/terrain/terrainCaustics";
import { createLakeFixture } from "./fixtures/lakeFixture";

type Check = (label: string, run: () => Promise<void>) => Promise<void>;
export async function registerTerrainCausticsTests(check: Check): Promise<void> {
  await check("terrain caustics: exact connected source faces preserve island, separate basin, seam and large origin", async () => {
    for (const offset of [0, 1_000_000]) {
      const doc = createLakeFixture([-64 + offset, 10, -64 + offset]);
      const original = [...doc.tiles.values()].map((t) => t.heights.slice());
      const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
      assert.equal(geometry.status, "ready"); const coverage = geometry.coverage!;
      assert.equal(coverage.triangles.length, 96 * 96 * 2);
      assert.ok(lakeCausticsContains(coverage, -20 + offset, -12 + offset));
      assert.ok(lakeCausticsContains(coverage, -0.01 + offset, -12 + offset));
      assert.ok(lakeCausticsContains(coverage, 0.01 + offset, -12 + offset));
      assert.equal(lakeCausticsContains(coverage, offset, offset), false);
      assert.equal(lakeCausticsContains(coverage, 30 + offset, offset), false);
      assert.equal(lakeCausticsContains(coverage, 48 + offset, offset), false);
      [...doc.tiles.values()].forEach((t, i) => assert.deepEqual(t.heights, original[i]));
    }
    const diagonal = { min: [0, 0] as [number, number], nx: 1, nz: 1, spacing: 1, triangles: new Uint8Array([1, 0]) };
    assert.ok(lakeCausticsContains(diagonal, 0.2, 0.2));
    assert.equal(lakeCausticsContains(diagonal, 0.8, 0.8), false);
  });

  await check("terrain caustics: bounded scene ownership, visibility, terrain reference and final disposal", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { causticsEnabled: true };
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const scene = new Scene(), object = new Group(); scene.add(object);
    const uniforms = createTerrainCausticsUniforms();
    const release = registerLakeCaustics(scene, doc.lake, geometry, object);
    updateTerrainCaustics(uniforms, scene, "terrain");
    assert.equal(uniforms.uCausticCount.value, 1);
    const texture = uniforms.uCausticMask.value as unknown as DataTexture;
    assert.equal(texture.image.width, 256); assert.equal(texture.image.height, 256);
    assert.equal(texture.format, RGBAFormat);
    const packed = texture.image.data as Uint8Array;
    for (let cell = 0; cell < geometry.coverage!.nx * geometry.coverage!.nz; cell++) {
      assert.equal(packed[cell * 4], geometry.coverage!.triangles[cell * 2]);
      assert.equal(packed[cell * 4 + 1], geometry.coverage!.triangles[cell * 2 + 1]);
    }
    assert.ok(packed.some((v, i) => i % 4 === 2 && v > 0), "original light pattern occupies B without changing RG flags");
    assert.ok((uniforms.uCausticArea.value as Vector4[])[0]!.z > 0);
    object.visible = false; updateTerrainCaustics(uniforms, scene, "terrain");
    assert.equal(uniforms.uCausticArea.value[0]!.z, 0);
    object.visible = true; updateTerrainCaustics(uniforms, scene, "other-terrain");
    assert.equal(uniforms.uCausticArea.value[0]!.z, 0);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; }); release(); release();
    assert.ok(disposed); updateTerrainCaustics(uniforms, scene);
    assert.equal(uniforms.uCausticCount.value, 0); assert.equal(uniforms.uCausticMask.value, null);
    const disabled = registerLakeCaustics(scene, { ...doc.lake, appearance: {} }, geometry, object);
    updateTerrainCaustics(uniforms, scene); assert.equal(uniforms.uCausticCount.value, 0); disabled();
    const invalid = registerLakeCaustics(scene, doc.lake, { ...geometry, status: "missing-data" }, object);
    updateTerrainCaustics(uniforms, scene); assert.equal(uniforms.uCausticCount.value, 0); invalid();
  });

  await check("terrain caustics: save allowlists preserve controls and reject malformed values; normals remain linear", async () => {
    const { lake } = createLakeFixture();
    assert.equal(resolveLakeAppearance(lake).causticsEnabled, false);
    const appearance = { causticsEnabled: true, causticsStrength: 1.25, causticsScale: 0.75, causticsSpeed: 0, causticsDepthFade: 6 };
    assert.deepEqual(validateWaterBody({ ...lake, appearance }).appearance, appearance);
    for (const patch of [{ causticsEnabled: "yes" }, { causticsStrength: NaN }, { causticsScale: 0 }, { causticsDepthFade: 31 }, { causticsSpeed: -1 }]) {
      assert.throws(() => validateWaterBody({ ...lake, appearance: patch }), /Invalid Lake|finite/);
    }
    const material = normalizeForgeMaterialDef({ terrainMetersPerRepeat: 2.4 });
    assert.equal(validateForgeMaterialDef(material).terrainMetersPerRepeat, 2.4);
    assert.throws(() => validateForgeMaterialDef({ ...material, terrainMetersPerRepeat: -1 }));
    const source = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    const array = createTerrainLayerArray([source, null], true);
    assert.equal(array.texture!.colorSpace, NoColorSpace);
    assert.deepEqual(Array.from(array.texture!.image.data!), [128, 128, 255, 255]);
    assert.deepEqual(array.index, [0, -1]); array.texture!.dispose(); source.dispose();
  });
}
