import assert from "node:assert/strict";
import { Mesh, MeshStandardMaterial, Scene, Vector3, Vector4, type WebGLRenderer } from "three";
import { resolveHeightFog, applySceneFog, updateHeightFog } from "../../engine/render-three/heightFog";
import { heightFogDensityAverage, heightFogOpacityAt } from "../../engine/world/viewDistance";
import { validateHeightFog } from "../../tools/saveValidator";

function fogShader() {
  return {
      uniforms: {},
      vertexShader: "#include <fog_pars_vertex>\nvoid main(){vec4 mvPosition=vec4(0.);\n#include <fog_vertex>\n}",
      fragmentShader: "#include <fog_pars_fragment>\nvoid main(){\n#include <fog_fragment>\n}",
  } as Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];
}

type Check = (label: string, fn: () => void) => void;
export function registerHeightFogTests(check: Check): void {
  check("height fog: analytic integral matches numerical integration in both directions", () => {
    for (const [start, end] of [[0, 200], [200, 0], [20, 20], [20, 20.00001], [-50, 100]] as const) {
      const samples = 10000;
      let numerical = 0;
      for (let i = 0; i < samples; i++) numerical += Math.exp(-0.01 * (start + (end - start) * (i + 0.5) / samples));
      assert.ok(Math.abs(heightFogDensityAverage(0.01, 0, start, end) - numerical / samples) < 1e-7);
    }
    assert.equal(heightFogDensityAverage(0, 0, -100, 100), 1);
    assert.ok(Number.isFinite(heightFogDensityAverage(10, 0, -100000, 100000)));
  });
  check("height fog: clear distance, altitude and opacity cap affect far visibility", () => {
    const fog = resolveHeightFog({ density: 0.01, heightFalloff: 0.01, startDistance: 20, maxOpacity: 0.7 });
    assert.equal(heightFogOpacityAt(fog, 20, 0), 0);
    assert.equal(heightFogOpacityAt(fog, 10000, 0), 0.7);
    assert.ok(heightFogOpacityAt(fog, 100, 200) < heightFogOpacityAt(fog, 100, 0));
    assert.ok(heightFogOpacityAt(fog, 100, 0, 200) > heightFogOpacityAt(fog, 100, 200));
  });
  check("height fog: new settings survive save validation with precision", () => {
    const fog = { density: 0.000123, heightFalloff: 0.001234, baseHeight: -12.5, startDistance: 25, maxOpacity: 0.85, sunColor: "#ffddaa", sunStrength: 0.4 };
    assert.deepEqual(validateHeightFog(fog), fog);
    assert.deepEqual(validateHeightFog(validateHeightFog(fog)), fog);
    assert.throws(() => validateHeightFog({ heightFalloff: -1 }), /heightFalloff/);
    assert.throws(() => validateHeightFog({ maxOpacity: 2 }), /maxOpacity/);
    assert.deepEqual(validateHeightFog({ sunColor: "invalid" }), {});
  });
  check("height fog: material patch chains existing shader code and follows scene state", () => {
    const scene = new Scene();
    const material = new MeshStandardMaterial();
    let priorCalls = 0;
    material.onBeforeCompile = shader => { priorCalls++; shader.fragmentShader += "\n// existing patch"; };
    scene.add(new Mesh(undefined, material));
    const fog = resolveHeightFog({ heightFalloff: 0.01, sunStrength: 0.5 });
    applySceneFog(scene, fog);
    const originalFog = scene.fog;
    applySceneFog(scene, { ...fog, density: 0.02 });
    assert.equal(scene.fog, originalFog);
    updateHeightFog(scene, fog, new Vector3(0, 1, 0));
    const key = material.customProgramCacheKey();
    updateHeightFog(scene, fog, new Vector3(0, 1, 0));
    assert.equal(material.customProgramCacheKey(), key);
    const shader = fogShader();
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    assert.equal(priorCalls, 1);
    assert.ok(shader.vertexShader.includes("mvPosition.xyz * mat3(viewMatrix)"));
    assert.ok(shader.fragmentShader.includes("// existing patch"));
    const renderer = { getRenderTarget: () => null, outputColorSpace: "srgb" } as unknown as WebGLRenderer;
    material.onBeforeRender(renderer, scene, null!, null!, null!, null!);
    assert.equal((shader.uniforms.forgeFogShape!.value as Vector4).x, 0.01);
    assert.equal((shader.uniforms.forgeFogSun!.value as Vector4).w, 0.5);
    material.onBeforeRender(renderer, new Scene(), null!, null!, null!, null!);
    assert.equal((shader.uniforms.forgeFogShape!.value as Vector4).x, 0);
    assert.equal((shader.uniforms.forgeFogSun!.value as Vector4).w, 0);
    updateHeightFog(scene, null, null);
    material.onBeforeRender(renderer, scene, null!, null!, null!, null!);
    assert.equal((shader.uniforms.forgeFogShape!.value as Vector4).x, 0);
    material.dispose();
  });
  check("height fog: cloned compile hooks bind their own uniforms once", () => {
    const source = new MeshStandardMaterial();
    const sourceScene = new Scene();
    sourceScene.add(new Mesh(undefined, source));
    updateHeightFog(sourceScene, resolveHeightFog({ heightFalloff: 0.01 }), null);
    const clone = source.clone();
    clone.onBeforeCompile = source.onBeforeCompile;
    clone.customProgramCacheKey = source.customProgramCacheKey;
    const cloneScene = new Scene();
    cloneScene.add(new Mesh(undefined, clone));
    updateHeightFog(cloneScene, resolveHeightFog({ heightFalloff: 0.04 }), null);
    const shader = fogShader();
    clone.onBeforeCompile(shader, {} as WebGLRenderer);
    const renderer = { getRenderTarget: () => null, outputColorSpace: "srgb" } as unknown as WebGLRenderer;
    clone.onBeforeRender(renderer, cloneScene, null!, null!, null!, null!);
    assert.equal((shader.uniforms.forgeFogShape!.value as Vector4).x, 0.04);
    assert.equal(shader.fragmentShader.split("uniform vec4 forgeFogShape;").length - 1, 1);
    source.dispose(); clone.dispose();
  });

}
