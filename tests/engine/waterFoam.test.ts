import { Group, Scene, Vector4 } from "three";
import { registerLakeShoreWetness, createTerrainShoreWetnessUniforms, updateTerrainShoreWetness } from "../../engine/render-three/terrain/terrainShoreWetness";
import assert from "node:assert/strict";
import { createLakeFoamMask } from "../../engine/render-three/waterFoam";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";
import { validateWaterBody, resolveLakeAppearance } from "../../engine/scene/waterBody";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createLakeFixture } from "./fixtures/lakeFixture";

type Check = (label: string, run: () => Promise<void>) => Promise<void>;
export async function registerWaterFoamTests(check: Check): Promise<void> {
  await check("Lake wet shore: reversible scene ownership, visibility, terrain binding and unchanged terrain data", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { shoreWetnessEnabled: true };
    const before = [...doc.tiles.values()].map(tile => tile.heights.slice());
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const scene = new Scene(), object = new Group(); scene.add(object);
    const release = registerLakeShoreWetness(scene, doc.lake, geometry, object);
    const uniforms = createTerrainShoreWetnessUniforms();
    updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetCount.value, 1);
    const texture = uniforms.uShoreWetMask.value as unknown as import("three").DataArrayTexture;
    assert.equal(texture.image.data!.length, 1024 * 1024 * 2);
    assert.ok(texture.image.data!.some((v, i) => i % 2 === 0 && v < 255));
    const grid = uniforms.uShoreWetGrid.value[0]!;
    const connected = (x: number, z: number) => {
      const gx = (x - grid.x) * grid.z, gz = (z - grid.y) * grid.z;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      if (ix < 0 || iz < 0 || ix >= grid.w || iz >= uniforms.uShoreWetRows.value[0]!) return false;
      const flags = texture.image.data![(iz * grid.w + ix) * 2 + 1]!;
      return (flags & (gx - ix + gz - iz <= 1 ? 1 : 2)) !== 0;
    };
    assert.equal(connected(-20, -12), true, "deep connected bed is wet");
    assert.equal(connected(0, 0), false, "dry island is outside the connected water");
    assert.equal(connected(30, 0), false, "separate basin below water level stays dry");
    assert.equal(connected(-60, 0), false, "outside grid must not wrap");
    assert.equal((uniforms.uShoreWetBounds.value as Vector4[])[0]!.x, -49, "mask extends onto dry side of bounds");
    assert.ok(uniforms.uShoreWetParams.value[0]!.w > 0);
    object.visible = false; updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    object.visible = true; updateTerrainShoreWetness(uniforms, scene, "another-terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    release(); release(); updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(disposed, true); assert.equal(uniforms.uShoreWetCount.value, 0); assert.equal(uniforms.uShoreWetMask.value, null);
    [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, before[i]));
    assert.equal(resolveLakeAppearance(createLakeFixture().lake).shoreWetnessEnabled, false);
  });
  await check("Lake foam: distance uses real shore/islands and is invariant at large origins", async () => {
    let baseline: Uint8Array | undefined;
    for (const offset of [0, 1_000_000]) {
      const doc = createLakeFixture([-64 + offset, 10, -64 + offset]);
      const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
      assert.equal(geometry.status, "ready");
      const mask = createLakeFoamMask(doc.lake, geometry, 1);
      const image = mask.image;
      const sample = (x: number, z: number) => image.data[Math.floor((z + 48) / 96 * image.height) * image.width + Math.floor((x + 48) / 96 * image.width)]!;
      assert.ok(sample(-31.9, 0) < 100, "outer shoreline must have contact distance");
      assert.ok(sample(6.2, 0) < 100, "island shoreline must have contact distance");
      assert.equal(sample(-20, 0), 255, "deep water away from shore must not get a foam band");
      if (baseline) assert.deepEqual(image.data, baseline);
      baseline = image.data.slice(); mask.dispose();
    }
  });
  await check("Lake foam: old defaults, strict shared appearance allowlist and sampling budget", async () => {
    const doc = createLakeFixture();
    assert.equal(resolveLakeAppearance(doc.lake).foamEnabled, false);
    const appearance = { foamEnabled: true, foamOpacity: 0.6, foamWidth: 1.2, foamScale: 0.5, foamSpeed: 0.3, shoreBlendDepth: 0.4, shoreWetnessEnabled: true, shoreWetnessWidth: 1.2, shoreWetnessStrength: 0.7 };
    assert.deepEqual(validateWaterBody({ ...doc.lake, appearance }).appearance, appearance);
    for (const appearance of [{ shoreWetnessEnabled: 1 }, { shoreWetnessWidth: 0 }, { shoreWetnessStrength: 2 }, { shoreBlendDepth: -1 }, { shoreBlendDepth: 3 }, { shoreBlendDepth: NaN }, { foamEnabled: "yes" }, { foamWidth: 0 }, { foamWidth: 5 }, { foamOpacity: 1.1 }, { foamScale: Infinity }, { foamSpeed: -1 }]) {
      assert.throws(() => validateWaterBody({ ...doc.lake, appearance }), /Invalid Lake|finite/);
    }
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.throws(() => createLakeFoamMask(doc.lake, geometry, 0.2), /over-budget/);
    const object = new LakeWaterObject({ ...doc.lake, appearance }, geometry, null);
    const texture = object.material.uniforms.foamMask!.value;
    assert.ok(texture); assert.equal(object.receiveShadow, true);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    object.dispose(); assert.equal(disposed, true);
    const old = new LakeWaterObject(doc.lake, geometry, null);
    assert.equal(old.material.uniforms.foamMask!.value, null); old.dispose();
  });
}
