import { expect, test } from "./test";

/**
 * The Sky Light (IBL) capture must be finite and change smoothly with the sun.
 *
 * Captured with the sky's sun disc, its ×19000 HDR core overflowed the
 * half-float cube faces: the prefiltered environment held Inf/NaN, and what a
 * rough surface received flipped between washed out and normal with fractions
 * of a degree of sun movement — invisible with one static capture, glaring
 * once the World Environment recaptures as the sun moves. This sweeps the sun
 * through sunrise and a mid-morning band in 0.25° steps and measures the
 * diffuse light a white rough surface gets from the capture alone.
 */
test.setTimeout(240_000);

test("Sky Light capture is finite and continuous as the sun moves", async ({ page }) => {
  await page.goto("/templates/game-starter/index.html");
  const sweeps = await page.evaluate(async () => {
    // Vite's pre-bundled three, the same module the served engine code imports.
    const THREE = await import("/node_modules/.vite/deps/three.js" as string);
    const reflection = await import("/engine/render-three/reflection.ts" as string);
    const skyAtmosphere = await import("/engine/scene/skyAtmosphere.ts" as string);
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
    renderer.toneMapping = THREE.NoToneMapping;
    const sky = skyAtmosphere.resolveSkyAtmosphere({});
    const scene = new THREE.Scene();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }),
    );
    plane.rotation.x = -Math.PI / 2;
    scene.add(plane);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 5, 0);
    camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.FloatType });
    const pixels = new Float32Array(16 * 16 * 4);
    const measure = (elevationDeg: number): number => {
      const el = (elevationDeg * Math.PI) / 180;
      const az = (100 * Math.PI) / 180;
      const sun = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const capture = reflection.captureSkyEnvironment(renderer, sky, sun, 128);
      scene.environment = capture.texture;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.readRenderTargetPixels(target, 0, 0, 16, 16, pixels);
      capture.dispose();
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i]! + pixels[i + 1]! + pixels[i + 2]!;
      return sum / (16 * 16 * 3);
    };
    const sweep = (from: number, to: number): number[] => {
      const values: number[] = [];
      for (let e = from; e <= to + 1e-9; e += 0.25) values.push(measure(e));
      return values;
    };
    return { sunrise: sweep(0, 6), morning: sweep(20, 26) };
  });

  for (const [name, values] of Object.entries(sweeps)) {
    for (const value of values) expect(Number.isFinite(value), `${name}: ${values.join(" ")}`).toBe(true);
    // A rising sun only ever brightens the sky, and a quarter degree never
    // multiplies the light: near the horizon the sky climbs steeply out of the
    // dark (~+25% per step), mid-morning by ~1%; the disc bug swung it 2-3x
    // back and forth.
    for (let i = 1; i < values.length; i += 1) {
      const ratio = values[i]! / values[i - 1]!;
      expect(ratio, `${name} step ${i}: ${values.join(" ")}`).toBeGreaterThanOrEqual(1);
      expect(ratio, `${name} step ${i}: ${values.join(" ")}`).toBeLessThan(1.3);
    }
  }
});
