import assert from "node:assert/strict";
import { BoxGeometry, Group, InstancedMesh, type Material, Matrix4, Mesh, MeshStandardMaterial, ShaderLib, Vector3 } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { normalizeForgeMaterialDef } from "../../engine/assets/material";
import { normalizeWindSwaySettings, resolveLevelWind, resolveWind, WIND_SWAY_DEFAULTS } from "../../engine/environment/wind";
import { FoliageRenderBinding } from "../../engine/render-three/foliage";
import { createThreeMaterialFromForgeDef, MATERIAL_SWAY_KEY } from "../../engine/render-three/materials";
import { StaticDetailCulling } from "../../engine/render-three/staticDetailCulling";
import { normalizeFoliageData, normalizeFoliageType } from "../../engine/scene/foliage";
import { validateFoliageTypeAsset, validateForgeMaterialDef } from "../../tools/saveValidator";
import { QUALITY_PROFILES } from "../../engine/perf/qualityProfiles";
import {
  applyMaterialWindSway,
  createWindSwayGlobalUniforms,
  createWindSwayMaterialUniforms,
  createWindSwayShadowMaterials,
  installWindSway,
  materialSways,
  patchWindSwayShader,
  updateWindSwayUniforms,
} from "../../engine/render-three/windSway";

type Check = (label: string, fn: () => void) => void;
type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

function shaderOf(name: keyof typeof ShaderLib): ShaderPatch {
  const lib = ShaderLib[name];
  return { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as ShaderPatch;
}

const settings = { amplitude: 0.2, height: 1.5, frequency: 0.8 };

function foliageFixture(material: Material, type: Record<string, unknown>, windSwayUniforms = createWindSwayGlobalUniforms()) {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  const gltf = { scene } as unknown as GLTF;
  const foliageType = normalizeFoliageType({ name: "t", meshAssetId: "m", ...type });
  const data = normalizeFoliageData({
    schema: 1,
    type: "foliage",
    groups: [{
      id: "g",
      foliageTypeId: "t",
      target: { kind: "staticMesh", id: "x" },
      instances: [{ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    }],
  });
  const binding = new FoliageRenderBinding({ windSwayUniforms });
  binding.rebuild(data, { getType: () => foliageType, getModel: () => gltf });
  return binding;
}

function compiledVertex(material: Material, name: keyof typeof ShaderLib): ShaderPatch {
  const shader = shaderOf(name);
  material.onBeforeCompile(shader, undefined as never);
  return shader;
}

function swayingMaterial(): Material {
  return createThreeMaterialFromForgeDef(normalizeForgeMaterialDef({ name: "Sway", sway: settings }));
}

/** A static batch as the shells build it: an InstancedMesh holding a 0.01 node scale in its instances. */
function staticBatch(material: Material): { group: Group; mesh: InstancedMesh } {
  const group = new Group();
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 1);
  mesh.userData.sourceMatrix = new Matrix4().makeScale(0.01, 0.01, 0.01);
  group.add(mesh);
  return { group, mesh };
}

export function registerWindSwayTests(check: Check): void {
  check("wind sway: material sway round-trips the normalizer and the save allowlist", () => {
    const material = normalizeForgeMaterialDef({ name: "Sway", sway: { amplitude: 0.4, height: 2, frequency: 1.5 } });
    assert.deepEqual(material.sway, { amplitude: 0.4, height: 2, frequency: 1.5 });
    const saved = validateForgeMaterialDef(material);
    assert.deepEqual(saved.sway, material.sway);
    assert.deepEqual(normalizeForgeMaterialDef(saved), material);
    assert.equal("sway" in normalizeForgeMaterialDef({ name: "Still" }), false, "absent stays absent");
    assert.equal("sway" in validateForgeMaterialDef(normalizeForgeMaterialDef({ name: "Still" })), false);
    assert.equal(normalizeForgeMaterialDef({ name: "Wild", sway: { amplitude: 99 } }).sway?.amplitude, 5);
  });

  check("wind sway: a static batch moves onto clones, leaving the cached material and still meshes alone", () => {
    const source = swayingMaterial();
    assert.equal(materialSways(source), true);
    const still = new MeshStandardMaterial();
    const { group, mesh } = staticBatch(source);
    const stillMesh = new Mesh(new BoxGeometry(1, 1, 1), still);
    group.add(stillMesh);
    const global = createWindSwayGlobalUniforms();
    const owned: Material[] = [];
    applyMaterialWindSway(group, global, owned);

    assert.notEqual(mesh.material, source);
    assert.equal(Object.prototype.hasOwnProperty.call(source, "onBeforeCompile"), false, "the cached material stays unpatched");
    assert.equal(stillMesh.material, still);
    assert.equal(stillMesh.customDepthMaterial, undefined);
    assert.equal(owned.length, 3, "clone + depth + distance go to the batch's disposal list");
    assert.ok(owned.includes(mesh.material as Material) && owned.includes(mesh.customDepthMaterial!) && owned.includes(mesh.customDistanceMaterial!));
    const shader = compiledVertex(mesh.material as Material, "physical");
    assert.equal(shader.uniforms.uWindStrength, global.uWindStrength, "shares the level wind with foliage");
    assert.equal(shader.uniforms.uSwayBaseScale!.value, 0.01, "the instance matrix holds the node scale, so it comes in a uniform");
    assert.equal(compiledVertex(mesh.customDepthMaterial!, "depth").uniforms.uSwayBaseScale!.value, 0.01, "the shadow agrees");
  });

  check("wind sway: a material's own patch and a placement tint's clone survive", () => {
    const source = swayingMaterial();
    const order: string[] = [];
    source.onBeforeCompile = () => { order.push("own"); };
    const { group, mesh } = staticBatch(source);
    applyMaterialWindSway(group, createWindSwayGlobalUniforms(), []);
    compiledVertex(mesh.material as Material, "physical");
    assert.deepEqual(order, ["own"]);
    assert.equal(materialSways(swayingMaterial().clone()), true, "the opt-in survives Material.clone()");
    assert.equal(MATERIAL_SWAY_KEY in new MeshStandardMaterial().userData, false);
  });

  check("wind sway: a placement clone's mask ignores the placement scale in both tagging styles", () => {
    for (const tagEveryNode of [false, true]) {
      const placement = new Group();
      placement.userData.placementIndex = 0;
      placement.scale.setScalar(3);
      const node = new Group();
      node.scale.setScalar(0.01);
      if (tagEveryNode) node.userData.placementIndex = 0;
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), swayingMaterial());
      if (tagEveryNode) mesh.userData.placementIndex = 0;
      node.add(mesh);
      placement.add(node);
      applyMaterialWindSway(placement, createWindSwayGlobalUniforms(), []);
      const scale = compiledVertex(mesh.material as Material, "physical").uniforms.uSwayBaseScale!.value as number;
      assert.ok(Math.abs(scale - 0.01) < 1e-6, `node scale only, got ${scale}`);
    }
  });

  check("wind sway: small-object culling fades a swaying mesh without losing its swaying shadow", () => {
    const { group, mesh } = staticBatch(swayingMaterial());
    const global = createWindSwayGlobalUniforms();
    applyMaterialWindSway(group, global, []);
    const culling = new StaticDetailCulling();
    assert.equal(culling.register("small", 0.5, group, { skipWholeInstanced: false }), true);
    const lit = compiledVertex(mesh.material as Material, "physical");
    assert.ok(lit.vertexShader.includes("swayBasis") && lit.uniforms.uFoliageFadeRange, "lit: fade and sway");
    const depth = mesh.customDepthMaterial!;
    const shadow = compiledVertex(depth, "depth");
    assert.ok(shadow.vertexShader.includes("swayBasis") && shadow.uniforms.uFoliageFadeRange, "shadow: fade and sway");
    assert.equal(shadow.uniforms.uWindStrength, global.uWindStrength);
    culling.register("small", 0.5, group, { skipWholeInstanced: false });
    assert.equal(mesh.customDepthMaterial, depth, "registering again keeps the shadow");
    culling.dispose();
  });

  check("wind sway: a still small object keeps the shared fade shadow", () => {
    const { group, mesh } = staticBatch(new MeshStandardMaterial());
    const culling = new StaticDetailCulling();
    culling.register("small", 0.5, group, { skipWholeInstanced: false });
    assert.equal(compiledVertex(mesh.customDepthMaterial!, "depth").vertexShader.includes("swayBasis"), false);
    culling.dispose();
  });

  check("wind sway: the patch splices after begin_vertex in lit, depth and distance shaders", () => {
    for (const name of ["physical", "standard", "lambert", "depth", "distance"] as const) {
      const shader = shaderOf(name);
      const fragment = shader.fragmentShader;
      const global = createWindSwayGlobalUniforms();
      const material = createWindSwayMaterialUniforms(settings);
      assert.equal(patchWindSwayShader(shader, global, material), true, name);
      const begin = shader.vertexShader.indexOf("#include <begin_vertex>");
      const sway = shader.vertexShader.indexOf("transformed += (transpose(swayBasis)");
      const project = shader.vertexShader.indexOf("#include <project_vertex>");
      assert.ok(begin >= 0 && begin < sway && sway < project, `${name}: sway sits between begin_vertex and project_vertex`);
      assert.ok(shader.vertexShader.indexOf("uniform float uSwayAmplitude;") < begin, `${name}: uniforms are declared before main`);
      assert.equal(shader.fragmentShader, fragment, `${name}: the fragment shader is untouched`);
      assert.equal(shader.uniforms.uWindStrength, global.uWindStrength, `${name}: shared global uniform`);
      assert.equal(shader.uniforms.uSwayHeight, material.uSwayHeight, `${name}: per-material uniform`);
    }
  });

  check("wind sway: a shader without the anchors is left as is", () => {
    const shader = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" } as unknown as ShaderPatch;
    assert.equal(patchWindSwayShader(shader, createWindSwayGlobalUniforms(), createWindSwayMaterialUniforms(settings)), false);
    assert.equal(shader.vertexShader, "void main() {}");
    assert.deepEqual(shader.uniforms, {});
  });

  check("wind sway: install chains after the material's own patch, once, with its own cache key", () => {
    const material = new MeshStandardMaterial();
    const order: string[] = [];
    material.onBeforeCompile = (shader) => {
      order.push(shader.vertexShader.includes("swayBasis") ? "prior-after-sway" : "prior");
    };
    material.customProgramCacheKey = () => "layer-blend";
    const global = createWindSwayGlobalUniforms();
    installWindSway(material, global, createWindSwayMaterialUniforms(settings));
    const rebound = createWindSwayMaterialUniforms({ ...settings, amplitude: 0.5 });
    installWindSway(material, global, rebound);
    const shader = shaderOf("physical");
    material.onBeforeCompile(shader, undefined as never);
    assert.deepEqual(order, ["prior"]);
    assert.equal(shader.vertexShader.split("uniform float uSwayAmplitude;").length, 2, "spliced once");
    assert.equal(shader.uniforms.uSwayAmplitude, rebound.uSwayAmplitude, "a second install rebinds uniforms");
    assert.equal(material.customProgramCacheKey(), "layer-blend|forge-wind-sway-v1");

    const plain = new MeshStandardMaterial();
    assert.notEqual(plain.customProgramCacheKey(), material.customProgramCacheKey(), "unswayed materials keep their programs");
  });

  check("wind sway: shadow materials sway with the same uniforms", () => {
    const global = createWindSwayGlobalUniforms();
    const uniforms = createWindSwayMaterialUniforms(settings);
    const { depth, distance } = createWindSwayShadowMaterials(global, uniforms);
    for (const [material, name] of [[depth, "depth"], [distance, "distance"]] as const) {
      const shader = shaderOf(name);
      material.onBeforeCompile(shader, undefined as never);
      assert.equal(shader.uniforms.uWindTime, global.uWindTime);
      assert.equal(shader.uniforms.uSwayFrequency, uniforms.uSwayFrequency);
    }
  });

  check("wind sway: the frame update writes wind, time, view origin and the fade window", () => {
    const global = createWindSwayGlobalUniforms();
    updateWindSwayUniforms(global, resolveWind({ directionDeg: 90, strength: 0.7, gust: 0.2 }, null, null), 12.5, { x: 1, y: 2, z: 3 }, 80);
    assert.equal(global.uWindTime.value, 12.5);
    assert.ok(Math.abs(global.uWindDirection.value.x - 1) < 1e-9 && Math.abs(global.uWindDirection.value.y) < 1e-9);
    assert.equal(global.uWindStrength.value, 0.7);
    assert.equal(global.uWindGust.value, 0.2);
    assert.deepEqual(global.uWindViewOrigin.value.toArray(), [1, 2, 3]);
    assert.deepEqual(global.uWindSwayFadeRange.value.toArray(), [60, 80]);
    updateWindSwayUniforms(global, resolveWind(null, null, null), 0, { x: 0, y: 0, z: 0 });
    assert.deepEqual(global.uWindSwayFadeRange.value.toArray(), [0, 0], "no fade end keeps sway at every distance");
  });

  check("wind sway: foliage type sway is optional, clamps leniently and survives the save", () => {
    assert.equal("sway" in normalizeFoliageType({ name: "t", meshAssetId: "m" }), false);
    assert.equal("sway" in normalizeFoliageType({ name: "t", meshAssetId: "m", sway: null }), false);
    assert.deepEqual(normalizeFoliageType({ name: "t", meshAssetId: "m", sway: {} }).sway, WIND_SWAY_DEFAULTS);
    assert.deepEqual(normalizeWindSwaySettings({ amplitude: 9, height: 0, frequency: "x" }), { amplitude: 5, height: 0.01, frequency: WIND_SWAY_DEFAULTS.frequency });
    const asset = { ...normalizeFoliageType({ name: "Grass", meshAssetId: "m" }), sway: { amplitude: 0.3, height: 0.8, frequency: 1.2 } };
    assert.deepEqual(validateFoliageTypeAsset(asset).sway, { amplitude: 0.3, height: 0.8, frequency: 1.2 });
  });

  check("wind sway: the WES wind group only counts while the environment is active", () => {
    const layout = { worldEnvironment: { wind: { strength: 0.9 } }, worldSettings: { wind: { strength: 0.1 } } };
    assert.equal(resolveLevelWind(layout, null).strength, 0.1, "no active WES: World Settings");
    assert.equal(resolveLevelWind(layout, { season: "summer", weather: { preset: "clear", intensity: 1 } }).strength, 0.9);
    assert.equal(resolveLevelWind(null, null).strength, resolveWind(null, null, null).strength);
  });

  check("wind sway: foliage without sway or cull keeps the shared material; sway clones it", () => {
    const source = new MeshStandardMaterial();
    const plain = foliageFixture(source, {});
    assert.equal(plain.allMeshes()[0]!.material, source);

    const wind = createWindSwayGlobalUniforms();
    const swaying = foliageFixture(source, { sway: settings }, wind);
    const mesh = swaying.allMeshes()[0]!;
    assert.notEqual(mesh.material, source, "the shared GLTF material is never patched");
    assert.equal(Object.prototype.hasOwnProperty.call(source, "onBeforeCompile"), false);
    const lit = compiledVertex(mesh.material as Material, "physical");
    assert.ok(lit.vertexShader.includes("swayBasis"));
    assert.equal(lit.uniforms.uWindStrength, wind.uWindStrength, "groups read the shell-owned wind");
    assert.equal(lit.uniforms.uFoliageFadeRange, undefined, "no cull: no fade");
    const depth = compiledVertex(mesh.customDepthMaterial!, "depth");
    assert.ok(depth.vertexShader.includes("swayBasis"), "the shadow sways too");
    assert.equal(swaying.windSwayUniforms, wind);
  });

  check("wind sway: a culled, swaying type fades and sways in one program, shadows included", () => {
    const binding = foliageFixture(new MeshStandardMaterial(), { sway: settings, cullStart: 20, cullEnd: 40 });
    const mesh = binding.allMeshes()[0]!;
    const material = mesh.material as Material;
    const lit = compiledVertex(material, "physical");
    assert.ok(lit.vertexShader.includes("swayBasis") && lit.vertexShader.includes("vFoliageFadeDistance"));
    assert.ok(lit.uniforms.uFoliageFadeRange && lit.uniforms.uSwayAmplitude);
    assert.equal(material.customProgramCacheKey(), "forge-foliage-fade-v1|forge-wind-sway-v1");
    for (const [shadow, name] of [[mesh.customDepthMaterial!, "depth"], [mesh.customDistanceMaterial!, "distance"]] as const) {
      const shader = compiledVertex(shadow, name);
      assert.ok(shader.vertexShader.includes("swayBasis") && shader.vertexShader.includes("vFoliageFadeDistance"), name);
    }
    binding.updateCulling(new Vector3(30, 0, 0), 1);
    assert.deepEqual((lit.uniforms.uFoliageFadeRange as { value: { toArray(): number[] } }).value.toArray(), [20, 40], "culling still drives the fade window");
  });

  check("wind sway: quality sets a sway distance per profile and the shader skips calm or far instances", () => {
    const distances = (["ultra", "high", "medium", "low"] as const).map((level) => QUALITY_PROFILES[level].windSwayDistance);
    assert.deepEqual(distances, [150, 100, 60, 30]);
    const shader = shaderOf("physical");
    patchWindSwayShader(shader, createWindSwayGlobalUniforms(), createWindSwayMaterialUniforms(settings));
    const branch = shader.vertexShader.indexOf("if (uWindStrength > 0.0 && swayFade > 0.0) {");
    assert.ok(branch > 0 && branch < shader.vertexShader.indexOf("float swayMask"), "the distance test runs before the sway maths");
  });
}
