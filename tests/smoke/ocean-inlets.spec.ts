import { expect, test } from "./test";

test("ocean inlet: GPU calm collar follows live width at caps, sides and corners without changing ownership", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__ocean-inlet-probe", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Inlet GPU probe</title>" }));
  await page.goto("/__ocean-inlet-probe");
  const result = await page.evaluate(async () => {
    // Import the production helper through Vite; measure compiled GLSL rather
    // than a second CPU implementation of its distance/smoothstep formula.
    const threePath = "/node_modules/three/build/three.module.js", inletPath = "/engine/render-three/ocean/oceanInlets.ts";
    const T = await import(threePath), I = await import(inletPath);
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const uniforms = { ...I.createOceanInletUniforms(), point: { value: new T.Vector2() } };
    const material = new T.ShaderMaterial({ glslVersion: T.GLSL3, uniforms,
      vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader: I.OCEAN_INLETS_GLSL + "\nuniform vec2 point;out vec4 result;void main(){result=vec4(oceanInletWaveWeight(point),oceanInletContains(point)?1.:0.,0.,1.);}" });
    const geometry = new T.PlaneGeometry(2, 2), scene = new T.Scene(), camera = new T.Camera();
    scene.add(new T.Mesh(geometry, material));
    const target = new T.WebGLRenderTarget(1, 1, { type: T.FloatType });
    const read = (x: number, z: number) => {
      uniforms.point.value.set(x, z); renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixel = new Float32Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
      return { weight: pixel[0]!, contains: pixel[1]! };
    };
    const rows = [], ownership = [];
    try {
      for (const rotated of [false, true]) for (const width of [.3, 3, 9, 60]) {
        const point = (along: number, across: number) => rotated ? [100 - across, -20 + along] : [100 + along, -20 + across];
        I.updateOceanInletUniforms(uniforms, [{ start: point(0, 0), end: point(30, 0), width }]);
        const band = uniforms.oceanInletStart.value[0].w;
        // Avoid asserting exact inclusion of a decimal boundary after float32
        // world-coordinate rounding; sample clearly on each side instead.
        const inside = point(29.98, width - .02), outside = point(30.02, 0);
        ownership.push({ inside: read(inside[0]!, inside[1]!), outside: read(outside[0]!, outside[1]!) });
        for (const factor of [0, .25, .625, 1, 2]) for (const side of ["cap", "side", "corner"]) {
          const d = band * factor;
          const p = side === "cap" ? point(30 + d, 0) : side === "side" ? point(15, width + d)
            : point(30 + d / Math.SQRT2, width + d / Math.SQRT2);
          rows.push({ rotated, width, band, factor, side, ...read(p[0]!, p[1]!) });
        }
      }
      const inlet = { start: [100, -20], end: [130, -20], width: 3 };
      I.updateOceanInletUniforms(uniforms, [{ ...inlet, active: false }]); const inactive = read(115, -20);
      I.updateOceanInletUniforms(uniforms, []); const empty = read(115, -20);
      I.updateOceanInletUniforms(uniforms, [{ start: [0, 0], end: [10, 0], width: 1 }, inlet]); const second = read(115, -20);
      return { rows, ownership, inactive, empty, second, glError: renderer.getContext().getError() };
    } finally { renderer.setRenderTarget(null); target.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); }
  });
  await info.attach("inlet-shader-probe", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  for (const row of result.rows) {
    expect(row.weight, JSON.stringify(row)).toBeCloseTo(row.factor <= .25 ? 0 : row.factor >= 1 ? 1 : .5, 4);
    if (row.factor > 0) expect(row.contains, JSON.stringify(row)).toBe(0);
  }
  for (const pair of result.ownership) {
    expect(pair.inside).toEqual({ weight: 0, contains: 1 }); expect(pair.outside).toEqual({ weight: 0, contains: 0 });
  }
  expect(result.inactive).toEqual({ weight: 1, contains: 0 }); expect(result.empty).toEqual(result.inactive);
  expect(result.second).toEqual({ weight: 0, contains: 1 }); expect(result.glError).toBe(0); expect(errors).toEqual([]);
});
