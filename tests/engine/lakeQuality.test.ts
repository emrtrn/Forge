import assert from "node:assert/strict";
import { Scene } from "three";
import { LakeWaterController } from "../../src/scene/lakeWaterController";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { lakeQuality, qualityLake } from "../../engine/perf/lakeQuality";
import { resolveQualitySettings, normalizeGraphicsPreferences } from "../../engine/perf/qualityProfiles";
import { effectiveQualitySettings } from "../../engine/perf/adaptiveQuality";
import { resolveLakeAppearance } from "../../engine/scene/waterBody";
import { WaterReflectionRegistry } from "../../engine/render-three/waterReflectionRegistry";
import { createTerrainCausticsUniforms, updateTerrainCaustics } from "../../engine/render-three/terrain/terrainCaustics";
import { createTerrainShoreWetnessUniforms, updateTerrainShoreWetness } from "../../engine/render-three/terrain/terrainShoreWetness";
import type { TerrainUniforms } from "../../engine/render-three/terrain/terrainMaterial";
import { LakeRippleState } from "../../engine/terrain/lakeInteraction";
import { encodeLakeFoam, lakeFoamHash, lakeFoamPath, type LakeFoamData } from "../../engine/scene/lakeFoamBake";

const q = (level: "low" | "medium" | "high" | "ultra") => lakeQuality(resolveQualitySettings(level));
function fixture() {
  const f = createLakeFixture();
  f.lake.appearance = { causticsEnabled: true, shoreWetnessEnabled: true, foamEnabled: true,
    reflectionMode: "sharedPlanar", reflectionQuality: "high", reflectionGroup: "shared" };
  return f;
}
function masks(scene: Scene) {
  const c = createTerrainCausticsUniforms(), w = createTerrainShoreWetnessUniforms();
  updateTerrainCaustics(c as unknown as TerrainUniforms, scene, "terrain");
  updateTerrainShoreWetness(w as unknown as TerrainUniforms, scene, "terrain");
  return { caustics: c, wet: w };
}
function baked(): LakeFoamData {
  return { metadata: { schema: 1, min: [-20, -12], max: [-19, -11], level: 12, width: 1,
    nx: 4, nz: 4, sources: 0, triangles: 0, segments: 0, milliseconds: 0, fingerprint: "a".repeat(64) }, pixels: new Uint8Array(16).fill(255) };
}
type Check = (label: string, fn: () => Promise<void>) => Promise<void>;

export async function registerLakeQualityTests(check: Check): Promise<void> {
  await check("lake quality: profile ceilings preserve authored switches and custom/adaptive settings are reversible", async () => {
    const f = fixture(), original = structuredClone(f.lake);
    const low = resolveLakeAppearance(qualityLake(f.lake, q("low")));
    assert.equal(low.foamEnabled, false); assert.equal(low.shoreWetnessEnabled, false);
    assert.equal(low.causticsEnabled, false);
    // A tier ceiling drops the planar capture (Low borrows the sky) but keeps the authored mode.
    assert.equal(low.reflectionMode, original.appearance!.reflectionMode); assert.equal(low.reflectionQuality, "low");
    const medium = resolveLakeAppearance(qualityLake(f.lake, q("medium")));
    assert.equal(medium.foamEnabled, true); assert.equal(medium.causticsEnabled, false);
    assert.equal(medium.reflectionMode, original.appearance!.reflectionMode); assert.equal(medium.reflectionQuality, "low");
    assert.equal(resolveLakeAppearance(qualityLake(f.lake, q("high"))).reflectionQuality, "medium");
    assert.deepEqual(f.lake, original, "the profile layer never writes authored settings");
    f.lake.appearance!.reflectionQuality = "medium";
    assert.equal(resolveLakeAppearance(qualityLake(f.lake, q("ultra"))).reflectionQuality, "medium", "Ultra cannot upgrade authored medium");
    f.lake.appearance = { causticsEnabled: false, foamEnabled: false, shoreWetnessEnabled: false, reflectionMode: "off", surfaceWavesEnabled: false };
    assert.deepEqual(resolveLakeAppearance(qualityLake(f.lake, q("ultra"))), resolveLakeAppearance(f.lake));
    const custom = normalizeGraphicsPreferences({ selectedQualityLevel: "custom", customSettings: {
      lakeMaxRipples: 900, lakeFoamAllowed: false, lakeReflectionQuality: "medium", unknown: true } });
    assert.equal(custom.customSettings!.lakeMaxRipples, 24); assert.equal(custom.customSettings!.lakeFoamAllowed, false);
    assert.equal(custom.customSettings!.lakeReflectionQuality, "medium"); assert.ok(!("unknown" in custom.customSettings!));
    const base = resolveQualitySettings("ultra"), reduced = effectiveQualitySettings(base,
      ["lake-reflection-down", "lake-reflection-down", "lake-caustics-off", "lake-ripples-down", "lake-shore-effects-off"]);
    assert.equal(reduced.lakeReflectionQuality, "off"); assert.equal(reduced.lakeMaxRipples, 12);
    assert.equal(reduced.lakeCausticsAllowed, false); assert.equal(reduced.lakeFoamAllowed, false); assert.equal(reduced.lakeShoreWetnessAllowed, false);
    assert.deepEqual(effectiveQualitySettings(base, []), base);
  });

  await check("lake quality: all levels release masks/captures and retain the exact mesh, normals, source and interaction geometry", async () => {
    const f = fixture(), scene = new Scene(), reflections = new WaterReflectionRegistry(); let normals = 0, reads = 0;
    const source = JSON.stringify(f.lake);
    const controller = new LakeWaterController({ scene, editor: false, reflections, quality: q("ultra"), document: () => f,
      load: async (_, key) => { reads++; return f.tiles.get(key)!; }, normal: async () => { normals++; return null; } });
    try {
      await controller.rebuild([f.lake]);
      const object = controller.objects.get(f.lake.id)!, geometry = object.geometry, result = controller.results.get(f.lake.id)!;
      const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
      object.setSurfaceWaveTime(2); const waveTime = object.material.uniforms.surfaceWaveTime!.value;
      let current = masks(scene), released = 0;
      for (const texture of [current.caustics.uCausticMask.value, current.wet.uShoreWetMask.value, object.material.uniforms.foamMask!.value] as any[]) {
        assert.ok(texture); texture.addEventListener("dispose", () => { released++; });
      }
      assert.equal(reflections.size, 1); assert.equal((object.reflectionSource!.binding.texture.image as any).width, 512);
      for (let i = 0; i < 3; i++) {
        await controller.setQuality(q("low")); current = masks(scene);
        assert.equal(current.caustics.uCausticCount.value, 0); assert.equal(current.caustics.uCausticMask.value, null);
        assert.equal(current.wet.uShoreWetCount.value, 0); assert.equal(current.wet.uShoreWetMask.value, null);
        assert.equal(object.material.uniforms.foamMask!.value, null); assert.equal(object.material.uniforms.reflectionTexture!.value, null);
        assert.equal(reflections.size, 0);
        await controller.setQuality(q("medium")); current = masks(scene);
        assert.ok(current.wet.uShoreWetMask.value); assert.equal(current.caustics.uCausticCount.value, 0);
        assert.ok(object.material.uniforms.foamMask!.value); assert.equal(reflections.size, 0);
        await controller.setQuality(q("high")); current = masks(scene);
        assert.equal(current.caustics.uCausticCount.value, 1); assert.equal(reflections.size, 1);
        assert.equal((object.reflectionSource!.binding.texture.image as any).width, 256);
        await controller.setQuality(q("ultra"));
        assert.equal((object.reflectionSource!.binding.texture.image as any).width, 512);
        assert.equal(controller.objects.get(f.lake.id), object); assert.equal(controller.results.get(f.lake.id), result);
        assert.equal(object.geometry, geometry); assert.equal(geometry.getAttribute("position"), position); assert.equal(geometry.getAttribute("normal"), normal);
        assert.equal(object.material.uniforms.surfaceWaveTime!.value, waveTime);
      }
      assert.equal(released, 3); assert.equal(normals, 1); assert.equal(reads, 0);
      assert.equal(JSON.stringify(f.lake), source); assert.equal(controller.qualityErrors.size, 0);
      controller.dispose(); current = masks(scene);
      assert.equal(reflections.size, 0); assert.equal(current.caustics.uCausticCount.value, 0); assert.equal(current.wet.uShoreWetCount.value, 0);
      // The shells reuse their controller across level travel, including its abort controllers.
      await controller.rebuild([f.lake]); assert.equal(controller.objects.size, 1);
    } finally { controller.dispose(); }
  });

  await check("lake quality: shared reflection leases preserve other consumers and newest profile wins without a geometry rebuild", async () => {
    const f = fixture(), reflections = new WaterReflectionRegistry(), scene = new Scene();
    const external = reflections.acquire("shared", 12, "high");
    const controller = new LakeWaterController({ scene, editor: false, reflections, quality: q("ultra"), document: () => f,
      load: async (_, key) => f.tiles.get(key)!, normal: async () => null });
    try {
      await controller.rebuild([f.lake, { ...f.lake, id: "lake-2" }]); assert.equal(reflections.size, 1);
      const objects = [...controller.objects.values()]; assert.ok(objects.every(o => o.reflectionSource === external));
      await controller.setQuality(q("low")); assert.equal(reflections.size, 1, "the other system's high lease is retained");
      await Promise.all([controller.setQuality(q("ultra")), controller.setQuality(q("low")), controller.setQuality(q("high"))]);
      assert.equal(reflections.size, 2, "two Lakes share one medium lease, external keeps high");
      assert.equal(objects[0]!.reflectionSource, objects[1]!.reflectionSource);
      assert.notEqual(objects[0]!.reflectionSource, external);
      await controller.rebuild([]); assert.equal(reflections.size, 1);
    } finally { controller.dispose(); reflections.release(external); }
    assert.equal(reflections.size, 0);
  });

  await check("lake quality: ripple caps retain recent waves and continuous wheel-contact history", async () => {
    const state = new LakeRippleState();
    const contacts = (frame: number) => Array.from({ length: 24 }, (_, i) => ({ id: String(i), x: i + frame * .05, y: 12, z: 0, radius: .5, rotation: frame, tractionSlip: .8 }));
    state.advance(1 / 60, contacts(0)); state.advance(1 / 60, contacts(1)); assert.equal(state.ripples.length, 24);
    const newest = state.ripples.at(-1);
    state.setLimit(8); assert.equal(state.ripples.length, 8); assert.equal(state.ripples.at(-1), newest);
    state.setLimit(12); state.advance(.13, []); // contacts expire normally, not through a quality reset
    state.advance(1 / 60, contacts(2)); state.advance(1 / 60, contacts(3)); assert.equal(state.ripples.length, 12);
    state.setLimit(24); state.advance(.13, contacts(4)); state.advance(1 / 60, contacts(5)); assert.equal(state.ripples.length, 24);
  });

  await check("lake quality: low skips baked foam reads, releases uploaded foam, preserves editor undo artifacts and survives travel", async () => {
    const f = fixture(), scene = new Scene();
    const controller = new LakeWaterController({ scene, editor: true, quality: q("low"), document: () => f,
      load: async (_, key) => f.tiles.get(key)!, normal: async () => null });
    try {
      const bytes = encodeLakeFoam(baked()), reference = await controller.foam.stage("layouts/quality.level.json", bytes);
      f.lake.geometryFoam = { enabled: true, width: 1, strength: .8, scale: 1, speed: .3, bake: reference };
      const read = controller.foam.read.bind(controller.foam); let reads = 0;
      controller.foam.read = async (...args) => { reads++; return read(...args); };
      await controller.rebuild([f.lake]); assert.equal(reads, 0);
      const object = controller.objects.get(f.lake.id)!, geometry = object.geometry;
      await controller.setQuality(q("medium")); assert.equal(reads, 1);
      const texture = object.material.uniforms.geometryFoamMask!.value; let disposed = false;
      assert.ok(texture); texture.addEventListener("dispose", () => { disposed = true; });
      await controller.setQuality(q("low")); assert.equal(disposed, true);
      assert.equal(object.material.uniforms.geometryFoamMask!.value, null); assert.ok(!object.material.defines.FORGE_LAKE_GEOMETRY_FOAM);
      assert.ok(controller.foam.artifact(reference.manifest), "pending editor save/undo data must survive quality changes");
      await controller.setQuality(q("ultra")); assert.equal(object.geometry, geometry); assert.ok(object.material.uniforms.geometryFoamMask!.value);
      controller.dispose();
      await controller.foam.stage("layouts/quality.level.json", bytes);
      await controller.rebuild([f.lake]); assert.ok(controller.objects.get(f.lake.id)!.material.uniforms.geometryFoamMask!.value);
    } finally { controller.dispose(); }
  });

  await check("lake quality: a late aborted foam response cannot repopulate the low-profile cache or publish stale textures", async () => {
    const f = fixture(), bytes = encodeLakeFoam(baked()), hash = await lakeFoamHash(bytes), path = lakeFoamPath("layouts/quality.level.json", hash);
    f.lake.geometryFoam = { enabled: true, width: 1, strength: .8, scale: 1, speed: .3, bake: { manifest: path, fingerprint: "a".repeat(64) } };
    const originalFetch = globalThis.fetch; let binaryReads = 0, release: (() => void) | undefined, started: (() => void) | undefined;
    const binaryStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async input => {
      if (String(input).endsWith(".json")) return Response.json({ schema: 1, dataPath: path.replace(/\.json$/, ".bin"), sha256: hash });
      if (++binaryReads === 1) { started!(); await new Promise<void>(resolve => { release = resolve; }); }
      return new Response(bytes);
    };
    const controller = new LakeWaterController({ scene: new Scene(), editor: false, quality: q("low"), document: () => f,
      load: async (_, key) => f.tiles.get(key)!, normal: async () => null });
    try {
      await controller.rebuild([f.lake]); const object = controller.objects.get(f.lake.id)!, geometry = object.geometry;
      const high = controller.setQuality(q("high")); await binaryStarted;
      const low = controller.setQuality(q("low")); release!(); await Promise.all([high, low]);
      assert.equal(object.material.uniforms.geometryFoamMask!.value, null); assert.equal(controller.foamErrors.size, 0);
      await controller.setQuality(q("high")); assert.equal(binaryReads, 2, "aborted data was not retained in the store");
      assert.ok(object.material.uniforms.geometryFoamMask!.value); assert.equal(object.geometry, geometry);
    } finally { release?.(); controller.dispose(); globalThis.fetch = originalFetch; }
  });
}
