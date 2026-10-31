import assert from "node:assert/strict";
import { BoxGeometry, Color, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Plane, Scene, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer } from "three";
import { riverReflectionPatches, type RiverReflectionMesh } from "../../engine/render-three/riverReflectionGeometry";
import { effectiveRiverReflectionQuality } from "../../engine/render-three/riverPlanarReflection";
import { PlanarReflectionSource } from "../../engine/render-three/planarReflectionSource";
import { WaterReflectionRegistry } from "../../engine/render-three/waterReflectionRegistry";
import { createRiverWaterObject } from "../../engine/render-three/riverWater";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { FULL_LAKE_QUALITY } from "../../engine/perf/lakeQuality";

type Check = (label: string, fn: () => Promise<void>) => Promise<void>;
function strip(heights: number[]): RiverReflectionMesh {
  const positions = heights.flatMap((y, x) => [x * 4, y, -2, x * 4, y, 2]);
  const indices: number[] = [];
  for (let row = 0; row < heights.length - 1; row++) { const i = row * 2; indices.push(i, i + 2, i + 1, i + 2, i + 3, i + 1); }
  return { positions, indices, bedDepths: Array(positions.length / 3).fill(1) };
}
function fakeRenderer(render: (scene: Scene, camera: PerspectiveCamera) => void) {
  let target: WebGLRenderTarget | null = null, clear = new Color(), alpha = 1;
  return { xr: { enabled: false }, shadowMap: { autoUpdate: true }, toneMapping: 0, autoClear: true,
    getRenderTarget: () => target, setRenderTarget: (value: WebGLRenderTarget | null) => { target = value; },
    getClearColor: (out: Color) => out.copy(clear), getClearAlpha: () => alpha,
    setClearColor: (value: Color | number, a: number) => { clear = new Color(value); alpha = a; },
    state: { buffers: { depth: { setMask() {} } } }, render,
  } as unknown as WebGLRenderer;
}

export async function registerRiverPlanarReflectionTests(check: Check): Promise<void> {
  await check("river planar: flat, downhill, curved slopes, branches, dry mesh and transformed planes", async () => {
    assert.equal(riverReflectionPatches(strip([0, 0, 0])).length, 1);
    const downhill = strip([4, 2, 0]), matrix = new Matrix4().makeRotationY(0.7).premultiply(new Matrix4().makeTranslation(20, 7, -30));
    const [patch] = riverReflectionPatches(downhill, matrix);
    assert.ok(patch); assert.ok(patch.plane.normal.y < 0.99);
    for (let i = 0; i < downhill.positions.length; i += 3) assert.ok(Math.abs(patch.plane.distanceToPoint(new Vector3().fromArray(downhill.positions, i).applyMatrix4(matrix))) < 1e-8);
    const bent = riverReflectionPatches(strip([4, 2, 2, 0])); assert.equal(bent.length, 3);
    const totals = new Map<number, number>();
    for (const p of bent) for (const [v, w] of p.weights) totals.set(v, (totals.get(v) ?? 0) + w);
    for (const weight of totals.values()) assert.ok(Math.abs(weight - 1) < 1e-6, "seam weights conserve reflected energy");
    assert.ok(bent.some(p => [...p.weights.values()].some(w => w > 0 && w < 1)), "seams interpolate rather than switch abruptly");
    const branch = strip([0, 0]); const offset = branch.positions.length / 3;
    const separate = { positions: [...branch.positions, ...branch.positions.map((v, i) => i % 3 === 2 ? v + 10 : v)],
      indices: [...branch.indices, ...branch.indices.map(v => v + offset)], bedDepths: [...branch.bedDepths, ...branch.bedDepths] };
    assert.equal(riverReflectionPatches(separate).length, 2, "disconnected branches stay independent");
    assert.equal(riverReflectionPatches({ ...downhill, bedDepths: downhill.bedDepths.map(() => 0) }).length, 0);
  });
  await check("river planar: arbitrary-plane camera mirror and oblique clipping preserve both camera types and reversed Z", async () => {
    const plane = new Plane(new Vector3(0.5, 1, 0).normalize(), -1);
    for (const camera of [new PerspectiveCamera(60, 1, 0.1, 100), new OrthographicCamera(-10, 10, 10, -10, 0.1, 100)]) {
      for (const reversed of [false, true]) {
        (camera as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
        camera.updateProjectionMatrix(); camera.position.set(1, 6, 8); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
        const scene = new Scene(), water = new Mesh(new BoxGeometry(10, 0.01, 10), new MeshBasicMaterial());
        water.userData.waterSceneTransmission = true; scene.add(water); scene.updateMatrixWorld(true);
        let calls = 0;
        const renderer = fakeRenderer((_, reflected) => {
          calls++; assert.equal(water.visible, false);
          const expected = camera.position.clone().addScaledVector(plane.normal, -2 * plane.distanceToPoint(camera.position));
          assert.ok(reflected.position.distanceTo(expected) < 1e-6);
          assert.equal(reflected.reversedDepth, reversed);
          const above = plane.coplanarPoint(new Vector3()).addScaledVector(plane.normal, 0.5);
          const below = above.clone().addScaledVector(plane.normal, -1);
          const clip = (p: Vector3) => new Vector4(...p.toArray(), 1).applyMatrix4(reflected.matrixWorldInverse).applyMatrix4(reflected.projectionMatrix);
          const a = clip(above), b = clip(below);
          assert.ok((reversed ? a.w - a.z : a.w + a.z) > 0);
          assert.ok((reversed ? b.w - b.z : b.w + b.z) < 0, JSON.stringify({kind:camera.type,reversed,a:a.toArray(),b:b.toArray()}));
        });
        const source = new PlanarReflectionSource(plane, "high"); source.addConsumer(water);
        try { source.update(renderer, scene, camera); assert.equal(calls, 1); assert.equal(water.visible, true); }
        finally { source.dispose(); water.geometry.dispose(); water.material.dispose(); }
      }
    }
    const registry = new WaterReflectionRegistry(), a = registry.acquire("group", 1, "medium");
    const b = registry.acquire("group", new Plane(new Vector3(0, 1, 0), -1), "medium");
    const c = registry.acquire("group", plane, "medium");
    assert.equal(a, b); assert.notEqual(a, c); registry.release(a); registry.release(b); registry.release(c); assert.equal(registry.size, 0);
  });
  await check("river planar: scene budgets, oldest-first refresh, nested render guard, quality ceilings and disposal", async () => {
    const originalNow = performance.now; let now = 1000;
    Object.defineProperty(performance, "now", { configurable: true, value: () => now });
    const scene = new Scene(), before = scene.onBeforeRender;
    const registry = new WaterReflectionRegistry(), external = registry.acquire("qa", 0, "high");
    const camera = new PerspectiveCamera(60, 1, 0.1, 100); camera.position.set(0, 15, 25); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const rivers = Array.from({ length: 6 }, (_, i) => createRiverWaterObject({
      ...resolveRiverWater({ id: `r${i}`, landscapeRef: "l", splineRef: "s", surfaceLevel: i * 0.2, reflectionQuality: "high", reflectionGroup: "qa" }),
      spline: { id: "s", points: [{ id: "a", position: [-10, 0, 0], width: 6, falloff: 0 }, { id: "b", position: [10, 0, 0], width: 6, falloff: 0 }], segments: [{ id: "s", startPointId: "a", endPointId: "b" }] },
      position: [0, 0, 0], rotation: [0, 0, 0], foamNoiseMap: null, reflections: registry,
    }, null));
    let calls = 0; const seen = new Set<unknown>();
    const renderer = fakeRenderer((renderedScene, nested) => {
      calls++; seen.add(renderer.getRenderTarget()); assert.ok(rivers.every(r => !r.visible));
      renderedScene.onBeforeRender(renderer, renderedScene, nested, null!, null!, null!);
    });
    const draw = () => { scene.updateMatrixWorld(true); scene.onBeforeRender(renderer, scene, camera, null!, null!, null!); };
    try {
      scene.add(...rivers); draw(); assert.equal(calls, 2); assert.equal(rivers[0]!.userData.riverPlanarActive, 4);
      now += 16; calls = 0; draw(); assert.equal(calls, 2); assert.equal(seen.size, 4, "all selected planes refresh, including lower-priority ones");
      for (const river of rivers) await river.applyQuality({ ...FULL_LAKE_QUALITY, reflectionQuality: "medium" });
      calls = 0; now += 50; draw(); assert.equal(calls, 1); assert.equal(rivers[0]!.userData.riverPlanarActive, 2);
      for (const river of rivers) await river.applyQuality({ ...FULL_LAKE_QUALITY, reflectionQuality: "off" });
      calls = 0; draw(); assert.equal(calls, 0); assert.equal(rivers[0]!.userData.riverPlanarActive, 0);
      assert.equal(registry.size, 1, "a Lake/other consumer lease survives River quality changes");
      assert.ok(rivers.every(r => r.material.uniforms.riverPlanarTextures!.value.every((t: unknown) => t === null)));
      assert.equal(effectiveRiverReflectionQuality("low", "high"), null);
      assert.equal(effectiveRiverReflectionQuality("medium", "high"), "medium");
      assert.equal(effectiveRiverReflectionQuality("high", "medium"), "medium");
    } finally {
      for (const river of rivers) { scene.remove(river); river.dispose(); }
      assert.equal(scene.onBeforeRender, before);
      registry.release(external); assert.equal(registry.size, 0);
      Object.defineProperty(performance, "now", { configurable: true, value: originalNow });
    }
  });
}
