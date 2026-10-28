import { Group, Scene, Vector4 } from "three";
import { registerLakeShoreWetness, createTerrainShoreWetnessUniforms, terrainShoreWetnessAt, updateTerrainShoreWetness } from "../../engine/render-three/terrain/terrainShoreWetness";
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
    assert.equal(uniforms.uShoreWetWidths.value[0], resolveLakeAppearance(doc.lake).shoreWetnessWidth, "puddle fade distance uses metres, independent of authored wet-shore width");
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
    // CPU mirror (wet tyre prints): on a shore point just above the level it
    // reads the full strength; farther, higher or below the level it is dry.
    const level = doc.lake.surfaceLevel, strength = resolveLakeAppearance(doc.lake).shoreWetnessStrength;
    const shoreX = geometry.shore[0]! + geometry.position[0], shoreZ = geometry.shore[1]! + geometry.position[2];
    assert.ok(Math.abs(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ) - strength) < 0.05, "shore line reads full strength");
    const raised = terrainShoreWetnessAt(scene, shoreX, level + 0.2, shoreZ);
    assert.ok(raised > 0 && Math.abs(raised - strength * 0.584) < 0.03, "the shader's height falloff (1 - smoothstep(0.08, 0.35, 0.2))");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.4, shoreZ), 0, "dry past the height band");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level - 0.1, shoreZ), 0, "below the level is the Lake's own query");
    assert.equal(terrainShoreWetnessAt(scene, 500, level, 500), 0, "outside the padded bounds");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ, "another-terrain"), 0, "bound to its terrain");
    object.visible = false; updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ), 0, "hidden Lake shows no wet shore");
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
    const appearance = { foamEnabled: true, foamOpacity: 0.6, foamWidth: 1.2, foamScale: 0.5, foamSpeed: 0.3, shoreBlendDepth: 0.4, shoreWetnessEnabled: true, shoreWetnessWidth: 1.2, shoreWetnessStrength: 0.7, surfaceStrength: 1.1, surfaceRoughness: 0.2,
      wheelWetTrailEnabled: false, wheelWetTrailLength: 2.5, wheelWetTrailStrength: 0.6, wheelWetTrailDrySeconds: 90 };
    assert.deepEqual(validateWaterBody({ ...doc.lake, appearance }).appearance, appearance);
    for (const appearance of [{ surfaceStrength: 3 }, { surfaceRoughness: 0 }, { surfaceRoughness: NaN }, { shoreWetnessEnabled: 1 }, { shoreWetnessWidth: 0 },
      { wheelWetTrailEnabled: "no" }, { wheelWetTrailLength: 0.2 }, { wheelWetTrailLength: 11 }, { wheelWetTrailStrength: 1.2 }, { wheelWetTrailDrySeconds: 2 }, { wheelWetTrailDrySeconds: NaN }, { shoreWetnessStrength: 2 }, { shoreBlendDepth: -1 }, { shoreBlendDepth: 3 }, { shoreBlendDepth: NaN }, { foamEnabled: "yes" }, { foamWidth: 0 }, { foamWidth: 5 }, { foamOpacity: 1.1 }, { foamScale: Infinity }, { foamSpeed: -1 }]) {
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
    assert.equal(old.material.uniforms.surfaceStrength!.value, 1);
    assert.equal(old.material.uniforms.surfaceRoughness!.value, 0.22);
    assert.equal(old.receiveShadow, true);
    assert.equal(old.material.uniforms.foamMask!.value, null); old.dispose();
  });
}
