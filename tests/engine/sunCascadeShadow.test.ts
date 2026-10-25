/** Cascaded sun shadow binding: lights, sun hand-off, chained material patch (OPEN_WORLD_PLAN Faz 7c2). */
import assert from "node:assert/strict";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  ShaderLib,
  Vector3,
  type Material,
  type WebGLRenderer,
} from "three";
import { createSunCascadeLightsChunk, SunCascadeShadow, type SunCascadeUpdate } from "../../engine/render-three/sunCascadeShadow";

type Check = (label: string, fn: () => void) => void;
type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

function fixture(): { scene: Scene; sun: DirectionalLight; camera: PerspectiveCamera; mesh: Mesh<BoxGeometry, MeshStandardMaterial> } {
  const scene = new Scene();
  const root = new Group();
  root.position.set(10, 30, 5);
  root.rotation.set(-0.6, 0.4, 0);
  scene.add(root);
  const sun = new DirectionalLight("#ffeedd", 3.5);
  sun.castShadow = true;
  sun.shadow.intensity = 0.8;
  root.add(sun);
  scene.add(sun.target);
  sun.target.position.set(-20, 0, -14);
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 6000);
  camera.position.set(1500, 40, -900);
  camera.lookAt(1600, 30, -1000);
  scene.add(camera);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return { scene, sun, camera, mesh };
}

function options(sun: DirectionalLight, camera: PerspectiveCamera, overrides: Partial<SunCascadeUpdate> = {}): SunCascadeUpdate {
  return { sun, camera, count: 3, stagger: false, mapSize: 1024, distance: 150, ...overrides };
}

function lightDirection(light: DirectionalLight): Vector3 {
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  const from = light.getWorldPosition(new Vector3());
  return light.target.getWorldPosition(new Vector3()).sub(from).normalize();
}

function compile(material: Material): ShaderPatch {
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  } as unknown as ShaderPatch;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

function quietly<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

export function registerSunCascadeShadowTests(check: Check): void {
  check("sun cascade shadow: three's lighting chunk still carries the anchors the patch needs", () => {
    const chunk = createSunCascadeLightsChunk();
    assert.ok(chunk.includes("forgeSunShadow"));
    assert.ok(!chunk.includes("getShadow( directionalShadowMap[ i ]"), "the per-light directional shadow line is replaced");
    assert.ok(chunk.includes("UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS"), "helper lights skip their BRDF");
    // Past a cascade's depth range the fragment falls to the next cascade.
    assert.equal(chunk.split("step( 0.0, forgeCoord.z ) * step( forgeCoord.z, 1.0 )").length, 5);
    // Point and spot shadows are untouched.
    assert.ok(chunk.includes("pointShadowMap[ i ]") && chunk.includes("spotShadowMap[ i ]"));
    assert.equal(chunk.split("RE_Direct(").length, ShaderChunk.lights_fragment_begin.split("RE_Direct(").length);
    assert.throws(() => createSunCascadeLightsChunk("void main() {}"), /directional shadow line not found/);
  });

  check("sun cascade shadow: cascades replace the sun in the render and hand it back", () => {
    const { scene, sun, camera } = fixture();
    const cascades = new SunCascadeShadow(scene);
    const sunLayers = sun.layers.mask;
    assert.equal(cascades.update(options(sun, camera)), true);
    assert.equal(cascades.isActive, true);
    assert.equal(sun.layers.mask, 0, "the sun leaves the render");
    assert.equal(sun.castShadow, true, "authored castShadow stays readable");
    assert.equal(cascades.group.parent, scene);
    const lights = cascades.cascadeLights;
    assert.equal(lights.length, 3);
    assert.ok(lights.every((light) => light.castShadow));
    assert.ok(lights[0]!.color.equals(sun.color));
    assert.equal(lights[0]!.intensity, 3.5);
    assert.ok(lights.slice(1).every((light) => light.intensity === 0 && light.color.getHex() === 0));
    assert.ok(lights.every((light) => light.shadow.intensity === 0.8 && light.shadow.mapSize.width === 1024));
    const sunDirection = lightDirection(sun);
    for (const light of lights) assert.ok(lightDirection(light).distanceTo(sunDirection) < 1e-9, "cascades shine along the sun");
    // Cascades are nested and grow outward.
    const extents = lights.map((light) => light.shadow.camera.right);
    assert.ok(extents[0]! < extents[1]! && extents[1]! < extents[2]!);
    assert.deepEqual(cascades.fadeUniform.value.toArray(), [127.5, 150]);

    sun.color.set("#ff0000");
    sun.intensity = 1.25;
    cascades.update(options(sun, camera));
    assert.ok(lights[0]!.color.equals(sun.color));
    assert.equal(lights[0]!.intensity, 1.25);

    sun.visible = false;
    cascades.update(options(sun, camera));
    assert.equal(cascades.group.visible, false, "a hidden sun hides its cascades");
    sun.visible = true;

    cascades.deactivate();
    assert.equal(cascades.isActive, false);
    assert.equal(sun.layers.mask, sunLayers);
    assert.equal(cascades.group.parent, null);
    assert.equal(cascades.cascadeLights.length, 0);
  });

  check("sun cascade shadow: count or sun changes rebuild the cascades", () => {
    const { scene, sun, camera } = fixture();
    const cascades = new SunCascadeShadow(scene);
    cascades.update(options(sun, camera, { count: 2 }));
    assert.equal(cascades.cascadeLights.length, 2);
    cascades.update(options(sun, camera, { count: 4 }));
    assert.equal(cascades.cascadeLights.length, 4);
    assert.equal(cascades.group.children.length, 8, "lights + targets of the current count only");
    const other = new DirectionalLight("#ffffff", 2);
    other.castShadow = true;
    scene.add(other, other.target);
    other.target.position.set(1, -1, 0);
    quietly(() => cascades.update(options(other, camera)));
    assert.equal(sun.layers.mask, 1, "the previous sun is restored");
    assert.equal(other.layers.mask, 0);
    cascades.dispose();
    assert.equal(cascades.group.parent, null);
  });

  check("sun cascade shadow: other shadowed directional lights are muted with one warning", () => {
    const { scene, sun, camera } = fixture();
    const fill = new DirectionalLight("#ffffff", 1);
    fill.name = "Fill";
    fill.castShadow = true;
    scene.add(fill, fill.target);
    const cascades = new SunCascadeShadow(scene);
    const { warnings } = quietly(() => {
      cascades.update(options(sun, camera));
      cascades.update(options(sun, camera));
    });
    assert.equal(fill.castShadow, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /"Fill"/);
    cascades.deactivate();
    assert.equal(fill.castShadow, true);
  });

  check("sun cascade shadow: stagger redraws cascades 2+ on alternate frames and keeps their frames", () => {
    const { scene, sun, camera } = fixture();
    const cascades = new SunCascadeShadow(scene);
    cascades.update(options(sun, camera, { count: 4, stagger: true }));
    const lights = cascades.cascadeLights;
    assert.deepEqual(lights.map((light) => light.shadow.autoUpdate), [true, true, false, false]);
    for (const light of lights) light.shadow.needsUpdate = false;
    const before = lights.map((light) => light.position.clone());
    camera.position.x += 40;
    camera.updateMatrixWorld(true);
    cascades.update(options(sun, camera, { count: 4, stagger: true }));
    // Frame 1: cascade 3 redraws, cascade 2 keeps its map and matrix.
    assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, false, false, true]);
    assert.ok(lights[2]!.position.equals(before[2]!));
    assert.ok(!lights[3]!.position.equals(before[3]!));
    assert.ok(!lights[0]!.position.equals(before[0]!));
    cascades.update(options(sun, camera, { count: 4, stagger: true }));
    assert.equal(lights[2]!.shadow.needsUpdate, true);
  });

  check("sun cascade shadow: the material patch chains, keys by state and is a no-op while inactive", () => {
    const { scene, sun, camera, mesh } = fixture();
    const material = mesh.material;
    let priorRuns = 0;
    material.onBeforeCompile = (shader) => {
      priorRuns += 1;
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", "// prior patch\nvoid main() {");
    };
    material.customProgramCacheKey = () => "prior-key";
    const unlit = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(unlit);
    const cascades = new SunCascadeShadow(scene);
    cascades.update(options(sun, camera));

    assert.equal(material.customProgramCacheKey(), "prior-key|forge-sun-cascades");
    const shader = compile(material);
    assert.equal(priorRuns, 1);
    assert.ok(shader.fragmentShader.includes("// prior patch"));
    assert.ok(shader.fragmentShader.includes("uniform vec2 forgeSunShadowFade;"));
    assert.ok(shader.fragmentShader.includes("forgeSunShadow = forgeAccum + forgeRemaining;"));
    assert.ok(!shader.fragmentShader.includes("#include <lights_fragment_begin>"));
    assert.equal(shader.uniforms.forgeSunShadowFade, cascades.fadeUniform, "one shared fade uniform");
    // A second pass over an already patched source (a clone that copied the callback) changes nothing.
    const twice = shader.fragmentShader;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    assert.equal(shader.fragmentShader.split("uniform vec2 forgeSunShadowFade;").length, 2);
    assert.ok(twice.length <= shader.fragmentShader.length);
    assert.equal(Object.prototype.hasOwnProperty.call(unlit.material, "onBeforeCompile"), false, "unlit materials are left alone");

    // Patched once, even across frames.
    const patchedCallback = material.onBeforeCompile;
    cascades.update(options(sun, camera));
    assert.equal(material.onBeforeCompile, patchedCallback);

    // Later materials (a streamed cell) are picked up on the next frame.
    const late = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    scene.add(late);
    cascades.update(options(sun, camera));
    assert.equal(late.material.customProgramCacheKey().endsWith("|forge-sun-cascades"), true);

    cascades.deactivate();
    assert.equal(material.customProgramCacheKey(), "prior-key");
    const inactive = compile(material);
    assert.ok(inactive.fragmentShader.includes("#include <lights_fragment_begin>"));
    assert.ok(inactive.fragmentShader.includes("// prior patch"));
  });
}
