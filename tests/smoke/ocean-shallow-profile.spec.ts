import { expect, test } from "./test";

test("A2 shallow profile: production GPU wave helpers calm the shelf and keep troughs above native bed", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__a2-profile-probe", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>A2 GPU probe</title>" }));
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.goto("/__a2-profile-probe");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/three/build/three.module.js", randomPath = "/engine/worldbuilder/randomWorld.ts";
    const briefPath = "/engine/worldbuilder/worldBrief.ts", groundPath = "/engine/worldbuilder/briefTerrain.ts";
    const coveragePath = "/engine/terrain/oceanCoverage.ts", fftPath = "/engine/render-three/ocean/oceanFft.ts", surfacePath = "/engine/render-three/ocean/oceanSurface.ts";
    const T = await import(threePath), R = await import(randomPath), B = await import(briefPath), G = await import(groundPath);
    const C = await import(coveragePath), F = await import(fftPath), S = await import(surfacePath);
    const renderer = new T.WebGLRenderer(); renderer.setSize(1, 1);
    const body = { schema: 1, kind: "ocean", coordinateSpace: "world", id: "probe", terrainRef: "terrain", name: "A2", bounds: { min: [-512, -512], max: [512, 512] },
      openEdges: ["west", "east", "north", "south"], surfaceLevel: 0, offshoreDepth: 40 };
    const world = B.normalizeWorldBrief(R.randomWorldBrief({ id: "probe", name: "Probe", seed: 11, size: "small", landform: "coast", seaSide: "west", mountainHeight: "medium", settlements: [], roads: "between" }).brief).brief;
    const camera = new T.PerspectiveCamera();
    const target = new T.WebGLRenderTarget(1, 1, { type: T.FloatType }), geometry = new T.PlaneGeometry(2, 2), rows = [];
    try {
      for (const label of ["before", "after"]) {
        const recipe = structuredClone(world); if (label === "before") delete recipe.ocean.shoreProfile;
        const ground = G.createBriefTerrain(recipe), shoreX = -ground.ocean.distance(0, 0);
        const coverage = await C.prepareOceanCoverage(body, 2, (x: number, z: number) => ground.height(x, z));
        const simulation = new F.OceanFft(renderer, body);
        const surface = new S.OceanSurface(coverage, simulation);
        // Compile the production coverage/displacement functions, without copying their GLSL.
        const source = surface.material.vertexShader;
        const helpers = source.slice(source.indexOf("uniform sampler2D coverageMap;"), source.indexOf("void main()"));
        const uniforms = { ...surface.material.uniforms, point: { value: new T.Vector2() } };
        const material = new T.ShaderMaterial({ glslVersion: T.GLSL3, uniforms,
          vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
          fragmentShader: helpers + "\nuniform vec2 point;out vec4 result;void main(){vec3 d=shallowDisplacement(point,1.);vec2 c=waterCoverage(point+d.xz);result=vec4(d.y,displacement(point,1.).y,waterCoverage(point).x,c.x+d.y);}" });
        const scene = new T.Scene(); scene.add(new T.Mesh(geometry, material));
        try {
          for (let frame = 0; frame < 24; frame++) {
            // Use the production FFT clock's accepted bounded step.
            simulation.update(frame === 0 ? 0 : .25);
            surface.updateView(camera);
            for (const distance of [2, 10, 20, 35, 50, 90, 150]) {
              uniforms.point.value.set(shoreX - distance, 0);
              renderer.setRenderTarget(target); renderer.render(scene, camera);
              const pixel = new Float32Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
              rows.push({ label, frame, distance, displacement: pixel[0]!, raw: pixel[1]!, depth: pixel[2]!, bedClearance: pixel[3]! });
            }
          }
        } finally { renderer.setRenderTarget(null); material.dispose(); surface.dispose(); simulation.dispose(); }
      }
      return { rows, glError: renderer.getContext().getError() };
    } finally { target.dispose(); geometry.dispose(); renderer.dispose(); }
  });
  await info.attach("shallow-gpu", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  for (const row of result.rows) {
    expect(row.depth).toBeGreaterThan(0);
    expect(row.bedClearance, JSON.stringify(row)).toBeGreaterThan(0);
  }
  const ratios: Record<string, number> = {};
  for (const label of ["before", "after"]) {
    const near = result.rows.filter(row => row.label === label && row.distance === 10);
    const rawEnergy = near.reduce((sum, row) => sum + row.raw ** 2, 0);
    expect(rawEnergy).toBeGreaterThan(.001);
    ratios[label] = Math.sqrt(near.reduce((sum, row) => sum + row.displacement ** 2, 0) / rawEnergy);
  }
  // Existing destination/bed clamps can reduce the old profile too. Compare
  // actual paired FFT responses instead of assuming old damping equals one.
  expect(ratios.after!).toBeLessThan(.03);
  expect(ratios.after!).toBeLessThan(ratios.before! * .1);
  await info.attach("shallow-response", { body: JSON.stringify(ratios), contentType: "application/json" });
  expect(result.glError).toBe(0); expect(errors).toEqual([]);
});
