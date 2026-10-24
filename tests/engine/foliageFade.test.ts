import assert from "node:assert/strict";
import {
  BoxGeometry,
  Group,
  type Material,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Vector2,
  Vector3,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { FoliageRenderBinding } from "../../engine/render-three/foliage";
import {
  createFoliageFadeMaterial,
  foliageFadeWindow,
  patchFoliageFadeShader,
  type FoliageFadeUniforms,
} from "../../engine/render-three/foliageFade";
import { normalizeFoliageData, normalizeFoliageType } from "../../engine/scene/foliage";

type Check = (label: string, fn: () => void) => void;
type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

function uniforms(): FoliageFadeUniforms {
  return { uFoliageFadeOrigin: { value: new Vector3() }, uFoliageFadeRange: { value: new Vector2() } };
}

function shaderOf(name: keyof typeof ShaderLib): ShaderPatch {
  const lib = ShaderLib[name];
  return { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as ShaderPatch;
}

function bindingFixture(material: Material, cullStart: number, cullEnd: number) {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  const gltf = { scene } as unknown as GLTF;
  const type = normalizeFoliageType({ name: "t", meshAssetId: "m", cullStart, cullEnd });
  const resolver = { getType: () => type, getModel: () => gltf };
  const data = normalizeFoliageData({
    schema: 1,
    type: "foliage",
    groups: [{
      id: "g",
      foliageTypeId: "t",
      target: { kind: "staticMesh", id: "x" },
      instances: [
        { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { position: [40, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
    }],
  });
  const binding = new FoliageRenderBinding();
  binding.rebuild(data, resolver);
  return binding;
}

function fadeRange(material: Material): Vector2 {
  const shader = shaderOf("physical");
  material.onBeforeCompile(shader, undefined as never);
  return (shader.uniforms.uFoliageFadeRange as { value: Vector2 }).value;
}

export function registerFoliageFadeTests(check: Check): void {
  check("foliage fade: the window fades only for 0 < cullStart < cullEnd and scales with quality", () => {
    assert.equal(foliageFadeWindow(0, 0), null, "never culls");
    assert.equal(foliageFadeWindow(20, 0), null, "cullEnd 0 wins over cullStart");
    assert.deepEqual(foliageFadeWindow(60, 100), [60, 100]);
    assert.deepEqual(foliageFadeWindow(60, 100, 0.5), [30, 50]);
    assert.deepEqual(foliageFadeWindow(60, 100, 0), [60, 100], "non-positive scale falls back to 1");
    // Types authored before the fade (cullStart ignored) keep a cut at cullEnd.
    assert.deepEqual(foliageFadeWindow(0, 100), [100, 100]);
    assert.deepEqual(foliageFadeWindow(120, 100, 2), [200, 200]);
  });

  check("foliage fade: the patch splices into lit, depth and distance shaders and binds the uniforms", () => {
    for (const name of ["physical", "standard", "lambert", "basic", "depth", "distance"] as const) {
      const shader = shaderOf(name);
      const fade = uniforms();
      assert.equal(patchFoliageFadeShader(shader, fade), true, name);
      assert.equal(shader.uniforms.uFoliageFadeOrigin, fade.uFoliageFadeOrigin, `${name} shares the origin uniform`);
      assert.equal(shader.uniforms.uFoliageFadeRange, fade.uFoliageFadeRange, `${name} shares the range uniform`);
      assert.match(shader.vertexShader, /#include <project_vertex>\n#ifdef USE_INSTANCING\n {2}vFoliageFadeDistance = /, name);
      assert.match(shader.fragmentShader, /void main\s*\(\s*\)\s*\{\n {2}float foliageFade = /, name);
      assert.equal(shader.fragmentShader.match(/discard;/g)?.length ?? 0, (ShaderLib[name].fragmentShader.match(/discard;/g)?.length ?? 0) + 1, name);
    }
    const broken = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" } as unknown as ShaderPatch;
    assert.equal(patchFoliageFadeShader(broken, uniforms()), false);
    assert.equal(broken.vertexShader, "void main() {}", "a shader without anchors is left alone");
  });

  check("foliage fade: a fading clone keeps the source defines and runs its patch first", () => {
    const source = new MeshStandardMaterial({ color: 0x336633 });
    source.defines = { STANDARD: "", USE_FORGE_LAYER_A: "" };
    const order: string[] = [];
    source.onBeforeCompile = (shader) => {
      order.push("source");
      assert.equal(shader.uniforms.uFoliageFadeRange, undefined, "the source patch runs before the fade");
    };
    source.customProgramCacheKey = () => "forge-layer-blend";
    const fade = uniforms();
    const clone = createFoliageFadeMaterial(source, fade);
    assert.notEqual(clone, source);
    assert.deepEqual((clone as MeshStandardMaterial).defines, source.defines);
    assert.notEqual((clone as MeshStandardMaterial).defines, source.defines, "defines are copied, not shared");
    assert.equal(clone.customProgramCacheKey(), "forge-layer-blend|forge-foliage-fade-v1");
    const shader = shaderOf("physical");
    clone.onBeforeCompile(shader, undefined as never);
    assert.deepEqual(order, ["source"]);
    assert.equal(shader.uniforms.uFoliageFadeRange, fade.uFoliageFadeRange);
    const plain = createFoliageFadeMaterial(new MeshStandardMaterial(), uniforms());
    assert.equal(plain.customProgramCacheKey(), "forge-foliage-fade-v1");
  });

  check("foliage fade: culled groups render through fading clones that follow the camera and quality scale", () => {
    const source = new MeshStandardMaterial();
    const binding = bindingFixture(source, 60, 100);
    const meshes = binding.allMeshes();
    assert.equal(meshes.length, 2, "two 16 m chunks");
    const material = meshes[0]!.material as Material;
    assert.notEqual(material, source, "the shared GLTF material is not patched in place");
    assert.equal(Object.prototype.hasOwnProperty.call(source, "onBeforeCompile"), false, "the source stays unpatched");
    assert.equal(meshes[1]!.material, material, "chunks of one group share a clone");
    assert.ok(meshes[0]!.customDepthMaterial instanceof MeshDepthMaterial);
    assert.ok(meshes[0]!.customDistanceMaterial instanceof MeshDistanceMaterial);
    assert.deepEqual(fadeRange(material).toArray(), [60, 100], "window set at build");
    binding.updateCulling(new Vector3(5, 1, 2), 0.5);
    assert.deepEqual(fadeRange(material).toArray(), [30, 50]);
    const depthShader = shaderOf("depth");
    meshes[0]!.customDepthMaterial!.onBeforeCompile(depthShader, undefined as never);
    assert.deepEqual((depthShader.uniforms.uFoliageFadeOrigin as { value: Vector3 }).value.toArray(), [5, 1, 2],
      "shadow passes measure from the view camera");
    assert.deepEqual((depthShader.uniforms.uFoliageFadeRange as { value: Vector2 }).value.toArray(), [30, 50]);

    const disposed: string[] = [];
    material.addEventListener("dispose", () => disposed.push("clone"));
    meshes[0]!.customDepthMaterial!.addEventListener("dispose", () => disposed.push("depth"));
    meshes[0]!.customDistanceMaterial!.addEventListener("dispose", () => disposed.push("distance"));
    source.addEventListener("dispose", () => disposed.push("source"));
    binding.dispose();
    assert.deepEqual(disposed.sort(), ["clone", "depth", "distance"], "owned materials go with the group, the GLTF one stays");
  });

  check("foliage fade: a type that never culls keeps its original material", () => {
    const source = new MeshStandardMaterial();
    const binding = bindingFixture(source, 0, 0);
    for (const mesh of binding.allMeshes()) {
      assert.equal(mesh.material, source);
      assert.equal(mesh.customDepthMaterial, undefined);
    }
    binding.updateCulling(new Vector3(), 0.5);
    binding.dispose();
  });
}
