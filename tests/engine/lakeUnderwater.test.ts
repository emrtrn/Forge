import assert from "node:assert/strict";
import { DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Vector3 } from "three";
import { lakeUnderwaterVolume, selectUnderwaterBody } from "../../engine/render-three/lakeUnderwaterVolume";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";
import { underwaterQuality } from "../../engine/render-three/lakeUnderwaterPass";
import { LAKE_UNDERWATER_DEFAULTS, resolveLakeUnderwater } from "../../engine/scene/lakeUnderwater";
import { validateWaterBody } from "../../engine/scene/waterBody";
import { QUALITY_PROFILES } from "../../engine/perf/qualityProfiles";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { validateLayout } from "../../tools/saveValidator";

export async function registerLakeUnderwaterTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("lake underwater: defaults, save allowlist and finite ranges preserve existing surface appearance", async () => {
    const f = createLakeFixture(), original = structuredClone(f.lake);
    assert.deepEqual(resolveLakeUnderwater(f.lake), LAKE_UNDERWATER_DEFAULTS);
    const settings = { enabled: false, fogDensity: 1.5, distortionStrength: .2, blurStrength: .1, particleDensity: .3 };
    assert.deepEqual(validateWaterBody({ ...f.lake, underwater: settings }).underwater, settings);
    const saved = validateLayout({ schema: 1, name: "underwater", loadGroups: [], instances: [], characters: [], waterBodies: [{ ...f.lake, underwater: settings }] }) as any;
    assert.deepEqual(saved.waterBodies[0].underwater, settings);
    for (const patch of [{ enabled: 1 }, { fogDensity: NaN }, { fogDensity: -1 }, { distortionStrength: 1.1 }, { blurStrength: "1" }, { particleDensity: Infinity }]) {
      assert.throws(() => validateWaterBody({ ...f.lake, underwater: patch }));
    }
    assert.deepEqual(f.lake, original);
    assert.equal(underwaterQuality(QUALITY_PROFILES.low).particles, 0);
    assert.equal(underwaterQuality({ ...QUALITY_PROFILES.low, dofAllowed: true }).blur, false, "Low also caps custom underwater blur");
    assert.equal(underwaterQuality(QUALITY_PROFILES.medium).level, "medium");
    assert.equal(underwaterQuality(QUALITY_PROFILES.high, true).blur, false, "global DoF must not be doubled");
    assert.equal(underwaterQuality(QUALITY_PROFILES.ultra).level, "high");
  });
  await check("lake underwater: volume is closed, outward oriented and follows the real wet bed", async () => {
    const f = createLakeFixture(), data = await buildLakeGeometry(await prepareLakeSnapshot(f, f.lake, async key => f.tiles.get(key)!));
    const geometry = lakeUnderwaterVolume(data), edges = new Map<string, number>(), indices = geometry.index!, p = geometry.getAttribute("position"), n = data.positions.length / 3;
    for (let i = 0; i < indices.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        const a = indices.getX(i + j), b = indices.getX(i + (j + 1) % 3), key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2));
    for (let i = 0; i < n; i++) assert.ok(Math.abs(p.getY(i + n) - (p.getY(i) - data.depths[i]!)) < 1e-6);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })); mesh.position.set(...data.position); mesh.updateMatrixWorld(true);
    const hits = new Raycaster(new Vector3(-20, 13, -12), new Vector3(0, -1, 0)).intersectObject(mesh);
    assert.ok(hits.length >= 2); assert.ok(Math.abs(hits[0]!.point.y - 12) < 1e-6); assert.ok(hits[0]!.face!.normal.y > .99);
    assert.ok(hits.at(-1)!.face!.normal.y < -.99);
    const island = new Raycaster(new Vector3(0, 11, 0), new Vector3(0, 1, 0)).intersectObject(mesh); assert.equal(island.length, 0);
    geometry.dispose(); mesh.material.dispose();
  });
  await check("lake underwater: camera and near plane select volume, reject islands/bed, and removal releases membership", async () => {
    const f = createLakeFixture(), data = await buildLakeGeometry(await prepareLakeSnapshot(f, f.lake, async key => f.tiles.get(key)!));
    const scene = new Scene(), object = new LakeWaterObject({ ...f.lake, appearance: { surfaceWavesEnabled: false } }, data, null);
    const camera = new PerspectiveCamera(60, 1, .1, 100); scene.add(object);
    const view = (x: number, y: number, z: number) => { camera.position.set(x, y, z); camera.lookAt(x, y, z - 20); camera.updateMatrixWorld(true); return selectUnderwaterBody(scene, camera); };
    assert.ok(view(-20, 11, -12)); assert.ok(view(-20, 12, -12));
    for (const p of [[-20, 13, -12], [0, 11, 0], [-20, 9, -12], [80, 11, 80]]) assert.equal(view(...p as [number, number, number]), null);
    object.visible = false; assert.equal(view(-20, 11, -12), null); object.visible = true;
    scene.remove(object); assert.equal(view(-20, 11, -12), null); object.dispose();
  });
}
