import { writeFileSync } from "node:fs";

import { expect, test } from "./test";

/**
 * A Sphere Reflection Capture must really change what a surface reflects.
 *
 * The probe patch splices GLSL into a three.js chunk, and when its anchors move
 * it falls back to a plain envMap: nothing crashes and the surface still looks
 * reflective. So this renders the patch and reads the pixels. The probe bakes a
 * red (+X) / green (-X) room and the global environment is pure blue, which
 * makes each patch feature a colour question:
 *
 * - blend: a mirror is probe-coloured inside the radius, blue outside it. A
 *   plain envMap would stay red/green across the whole plane.
 * - specular-only: a rough surface's diffuse light stays blue inside the radius,
 *   even though the 512px probe and the 256px sky have different LOD counts.
 * - parallax: a mirror seen by a parallel camera has one reflection direction,
 *   so only the parallax patch can split it into a red and a green side.
 */
test.setTimeout(120_000);

type Rgb = [number, number, number];

test("Sphere Reflection Capture blends, stays specular-only and parallax-corrects", async ({ page }, testInfo) => {
  await page.goto("/templates/game-starter/index.html");
  const measured = await page.evaluate(async () => {
    const THREE = await import("/tests/smoke/pages/engineThree.ts" as string);
    const capture = await import("/engine/render-three/reflectionCapture.ts" as string);
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
    renderer.toneMapping = THREE.NoToneMapping;

    const room = new THREE.SphereGeometry(20, 32, 16);
    const positions = room.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 1) colors[i * 3 + (positions.getX(i) > 0 ? 0 : 1)] = 1;
    room.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const probeScene = new THREE.Scene();
    probeScene.add(new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

    const skyScene = new THREE.Scene();
    skyScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(20, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x0000ff, side: THREE.BackSide }),
    ));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = pmrem.fromScene(skyScene, 0);
    pmrem.dispose();

    const bake = (parallax: boolean) => capture.bakeSphereReflectionCapture(renderer, probeScene, {
      name: "probe", hidden: false, position: [0, 1, 0], rotation: [0, 0, 0],
      radius: 5, intensity: 1, priority: 0, resolution: 512, parallax, near: 0.1, far: 100,
    });

    const size = 64;
    const scene = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial());
    plane.rotation.x = -Math.PI / 2;
    scene.add(plane);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 20);
    camera.position.set(0, 5, 0);
    camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
    const pixels = new Float32Array(size * size * 4);
    // World X/Z on the plane; the parallel camera makes it a linear pixel lookup.
    const at = (x: number, z: number): Rgb => {
      const i = (Math.floor(((-z + 10) / 20) * size) * size + Math.floor(((x + 10) / 20) * size)) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
    const shoot = (roughness: number, metalness: number, probe: unknown, globalEnv: unknown): void => {
      delete plane.userData.captureBaseMaterial;
      plane.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness });
      capture.applyProbeEnvMapToObject(plane, probe, globalEnv, 1);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    };

    const flat = bake(false);
    shoot(0.05, 1, flat, sky.texture);
    const blend = { inside: at(0, 0), outside: at(8, 8) };
    shoot(1, 0, flat, sky.texture);
    const diffuse = { inside: at(0, 0) };
    const parallaxBake = bake(true);
    shoot(0.05, 1, parallaxBake, null);
    const parallax = { right: at(3, 0), left: at(-3, 0) };
    shoot(0.05, 1, flat, null);
    const plain = { right: at(3, 0), left: at(-3, 0), far: at(8, 8) };
    return { blend, diffuse, parallax, plain };
  });

  writeFileSync(testInfo.outputPath("reflection-capture.json"), JSON.stringify(measured, null, 2));
  const report = JSON.stringify(measured);
  const [probeR, probeG, probeB] = measured.blend.inside;
  const [skyR, skyG, skyB] = measured.blend.outside;
  expect(probeR + probeG, report).toBeGreaterThan(probeB * 2);
  expect(skyB, report).toBeGreaterThan((skyR + skyG) * 2);

  const [diffuseR, diffuseG, diffuseB] = measured.diffuse.inside;
  expect(diffuseB, report).toBeGreaterThan((diffuseR + diffuseG) * 2);

  // Without parallax the two sides match; with it, they swap into red and green.
  expect(Math.abs(measured.plain.right[0] - measured.plain.left[0]), report).toBeLessThan(0.05);
  expect(measured.parallax.right[0], report).toBeGreaterThan(measured.parallax.right[1] * 2);
  expect(measured.parallax.left[1], report).toBeGreaterThan(measured.parallax.left[0] * 2);

  // The probe has no edge of its own: past the radius a plain envMap still shows
  // it, which is what the blue reading above rules out for the patched one.
  expect(measured.plain.far[2], report).toBeLessThan(0.05);
});

/**
 * Two parts of a real scene that the room above does not have. The Sky's box
 * follows the viewport camera, so a probe far from the camera sits outside it.
 * Water refreshes its planar reflection from `scene.onBeforeRender`, which also
 * runs for each cube face of the bake, and has to hand the same face back.
 */
test("Sphere Reflection Capture sees the Sky far from the camera and past planar water", async ({ page }, testInfo) => {
  await page.goto("/templates/game-starter/index.html");
  const measured = await page.evaluate(async () => {
    const THREE = await import("/tests/smoke/pages/engineThree.ts" as string);
    const capture = await import("/engine/render-three/reflectionCapture.ts" as string);
    const skyActor = await import("/engine/render-three/skyAtmosphere.ts" as string);
    const planar = await import("/engine/render-three/planarReflectionSource.ts" as string);
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
    renderer.toneMapping = THREE.NoToneMapping;

    const size = 16;
    const scene = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial());
    plane.rotation.x = -Math.PI / 2;
    scene.add(plane);
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 20);
    camera.position.set(0, 5, 0);
    camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
    const pixels = new Float32Array(size * size * 4);

    // What a mirror facing the sky reads from a probe baked in this Sky scene.
    const mirror = (skyPosition: [number, number, number], planarWater: boolean): number[] => {
      const probeScene = new THREE.Scene();
      const sky = skyActor.createSkyObject();
      skyActor.applySkyUniforms(sky, skyActor.resolveSkyAtmosphere({}));
      skyActor.applySkySunDirection(sky, new THREE.Vector3(0.5, 0.7, 0.5).normalize());
      sky.position.set(...skyPosition);
      probeScene.add(sky);
      const source = planarWater ? new planar.PlanarReflectionSource(0, "high") : null;
      if (source) {
        // Without a consumer on screen the source has nothing to refresh.
        const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        water.rotation.x = -Math.PI / 2;
        probeScene.add(water);
        source.addConsumer(water);
        probeScene.onBeforeRender = (r: unknown, s: unknown, c: unknown) => source.update(r, s, c);
      }
      const bake = capture.bakeSphereReflectionCapture(renderer, probeScene, {
        name: "probe", hidden: false, position: [0, 1, 0], rotation: [0, 0, 0],
        radius: 50, intensity: 1, priority: 0, resolution: 256, parallax: false, near: 0.1, far: 100,
      });
      source?.dispose();
      delete plane.userData.captureBaseMaterial;
      plane.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 });
      capture.applyProbeEnvMapToObject(plane, bake, null, 1);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      capture.disposeSphereReflectionCaptureBake(bake);
      return Array.from(pixels.subarray(0, 3)) as number[];
    };

    return { reference: mirror([0, 1, 0], false), farCamera: mirror([200, 1, 0], false), planarWater: mirror([0, 1, 0], true) };
  });
  writeFileSync(testInfo.outputPath("reflection-capture-sky.json"), JSON.stringify(measured, null, 2));
  const report = JSON.stringify(measured);
  // A clear sky straight up: blue, far from the black of an unwritten cube face.
  expect(measured.reference[2], report).toBeGreaterThan(1);
  expect(measured.farCamera[2], report).toBeCloseTo(measured.reference[2]!, 1);
  expect(measured.planarWater[2], report).toBeCloseTo(measured.reference[2]!, 1);
});
