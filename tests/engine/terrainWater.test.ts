import assert from "node:assert/strict";
import { TerrainWaterState, terrainWaterRenderDepth, TERRAIN_WATER_MAX_IMPULSES, TERRAIN_WATER_MAX_RIPPLES, TERRAIN_WATER_RIPPLE_LIFETIME, type TerrainWaterContact } from "../../engine/render-three/terrain/terrainWaterState";
import { TerrainWater, setTerrainWaterQuality } from "../../engine/render-three/terrain/terrainWater";
import { normalizeGraphicsPreferences, QUALITY_PROFILES } from "../../engine/perf/qualityProfiles";
import { BoxGeometry, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene, Vector4, WebGLRenderTarget, type WebGLRenderer } from "three";
import { applyPlanarObliqueClip, isPlanarReflectionCamera, PlanarReflectionSource } from "../../engine/render-three/planarReflectionSource";

const contact = (patch: Partial<TerrainWaterContact> = {}): TerrainWaterContact => ({ id: "wheel", x: 0, y: 3,
  z: 0, width: 0.3, rotation: 0, radius: 0.5, wetness: 0.9, ...patch });

export function registerTerrainWaterTests(check: (name: string, fn: () => void) => void): void {
  check("terrain water: planar clipping keeps the same half-space in standard and reversed depth for both camera types", () => {
    for (const camera of [new PerspectiveCamera(50, 1, 0.1, 100), new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)]) {
      for (const reversed of [false, true]) {
        (camera as unknown as { _reversedDepth: boolean })._reversedDepth = reversed;
        camera.updateProjectionMatrix();
        const projection = camera.projectionMatrix.clone();
        applyPlanarObliqueClip(projection, new Vector4(0, 0, -1, -2), reversed, 0);
        const ndc = (z: number) => { const p = new Vector4(0, 0, z, 1).applyMatrix4(projection); return p.z / p.w; };
        assert.ok(Math.abs(ndc(-2) - (reversed ? 1 : -1)) < 1e-6);
        assert.ok(reversed ? ndc(-1) > 1 : ndc(-1) < -1, "discarded side stays outside near plane");
        assert.ok(ndc(-4) < 1 && ndc(-4) > (reversed ? 0 : -1), "reflected objects stay inside clip range");
      }
    }
  });
  check("terrain water: reflection levels sample the filtered render field across negative-world storage seams", () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 0, 0, 255, 0]);
    assert.equal(terrainWaterRenderDepth(pixels, 2, 0.125, 0.3, 0.0625, 0.0625), 0.3);
    assert.equal(terrainWaterRenderDepth(pixels, 2, 0.125, 0.3, -0.0625, -0.0625), 0.3);
    assert.equal(terrainWaterRenderDepth(pixels, 2, 0.125, 0.3, 0, 0), 0.15);
  });
  check("terrain water: standing wheels settle, travel and wheelspin inject, dry and airborne contacts do not", () => {
    const state = new TerrainWaterState();
    state.advance(1 / 60, [contact()], [0, 0]);
    state.advance(1 / 60, [contact()], [0, 0]);
    assert.equal(state.impulses.length, 0);
    state.advance(1 / 60, [contact({ z: 0.2, rotation: 0.4 })], [0, 0]);
    assert.ok(state.impulses.length > 0);
    state.impulses.length = 0;
    state.advance(1 / 60, [contact({ z: 0.2, rotation: 0.8 })], [0, 0]);
    assert.ok(state.impulses.length > 0, "stationary wheelspin agitates water");
    state.impulses.length = 0;
    state.advance(1 / 60, [contact({ z: 0.4, rotation: 1.2, wetness: 0.1 })], [0, 0]);
    assert.equal(state.impulses.length, 0, "snow/dry material has no water impulses");
    state.advance(1 / 60, [], [0, 0]);
    state.advance(1 / 60, [contact({ z: 0.4, rotation: 100 })], [0, 0]);
    assert.equal(state.impulses.length, 0, "landing does not connect to old airborne history");
    state.advance(1 / 60, [contact({ x: 12, rotation: 102 })], [0, 0]);
    assert.equal(state.impulses.length, 0, "teleports don't draw a wake");
  });
  check("terrain water: masks retain world positions across seams and clear entering strips and level changes", () => {
    const state = new TerrainWaterState();
    const at = (x: number, z: number) => state.mask[((((Math.floor(z * 8) % 256) + 256) % 256) * 256 + ((Math.floor(x * 8) % 256 + 256) % 256)) * 4]!;
    state.advance(1 / 60, [contact()], [0, 0]);
    assert.ok(at(-0.0625, -0.0625) > 0.8 && at(0.0625, 0.0625) > 0.8);
    state.advance(1 / 60, [], [0.5, -0.5]);
    assert.ok(at(0.0625, 0.0625) > 0.8, "retained cell is world-anchored");
    state.advance(1 / 60, [], [32, 32]);
    assert.ok(state.mask.every((value) => value === 0));
    assert.equal(state.sites.size, 0);
    state.clear();
    assert.equal(state.previous.size, 0);
    assert.equal(state.seconds, 0);
  });
  check("terrain water: physics slip stirs a stationary wheel and authoritative zero ignores rotation resets", () => {
    const state = new TerrainWaterState();
    const step = (patch: Partial<TerrainWaterContact> = {}, dt = 1 / 60) => {
      state.impulses.length = 0;
      state.advance(dt, [contact({ tractionSlip: 0, ...patch })], [0, 0]);
      return state.impulses.reduce((sum, impulse) => sum + impulse.strength, 0);
    };
    step();
    assert.equal(step(), 0, "parked wheel stays calm");
    const spinning = step({ tractionSlip: 0.8 });
    assert.ok(spinning > 0, "unchanged position and rotation still stir from physics slip");
    assert.equal(step({ rotation: 100 }), 0, "physics zero overrides discontinuous rotation");
    assert.ok(step({ x: 0.1, rotation: 100 }) > 0, "a rolling tyre still leaves a wake with zero slip");
    assert.equal(step({ tractionSlip: 0.8, wetness: 0.1 }), 0, "dry slip never excites water");
    assert.equal(step({ tractionSlip: NaN }), 0);
    assert.equal(state.previous.size, 0, "invalid contacts lose their history");
    assert.equal(step({ tractionSlip: 0.8 }), 0, "returning contacts don't join invalid history");
    assert.ok(step({ tractionSlip: 0.8 }, 10) <= spinning * 4 + 1e-9, "stalls respect the GPU catch-up budget");
    state.advance(1 / 60, [], [0, 0]);
    assert.equal(step({ tractionSlip: 0.8 }), 0, "landing starts a fresh contact");
    assert.equal(step({ x: 10, tractionSlip: 0.8 }), 0, "teleport starts a fresh contact");
  });
  check("terrain water: stationary physics slip adds the same energy at 30, 60 and 144 Hz", () => {
    const energies = [30, 60, 144].map((hz) => {
      const state = new TerrainWaterState();
      state.advance(1 / hz, [contact({ tractionSlip: 0.7 })], [0, 0]);
      let energy = 0;
      for (let i = 0; i < hz; i++) {
        state.advance(1 / hz, [contact({ tractionSlip: 0.7 })], [0, 0]);
        energy += state.impulses.reduce((sum, impulse) => sum + impulse.strength, 0);
        state.impulses.length = 0;
      }
      return energy;
    });
    assert.ok(energies[0]! > 0);
    assert.ok(Math.max(...energies) - Math.min(...energies) < 1e-9);
  });
  check("terrain water: visible wavefronts stay anchored, stop emitting at rest and expire after contact loss", () => {
    const state = new TerrainWaterState();
    state.advance(1 / 60, [contact()], [0, 0]);
    state.advance(1 / 60, [contact({ tractionSlip: 0.8 })], [0, 0]);
    assert.equal(state.ripples.length, 1);
    const ripple = state.ripples[0]!;
    state.advance(1 / 60, [contact({ tractionSlip: 0.8 })], [0.5, -0.5]);
    assert.deepEqual([ripple.x, ripple.z], [0, 0], "moving the window doesn't drag the wavefront");
    assert.ok(ripple.age > 0);
    for (let i = 0; i < 12; i++) state.advance(1 / 60, [contact({ tractionSlip: 0 })], [0, 0]);
    assert.equal(state.ripples.length, 1, "rest does not seed more rings");
    state.advance(TERRAIN_WATER_RIPPLE_LIFETIME, [], [0, 0]);
    assert.equal(state.ripples.length, 0);
    state.advance(1 / 60, [contact({ tractionSlip: 0.8 })], [0, 0]);
    assert.equal(state.ripples.length, 0, "landing starts a fresh history");
    for (let i = 0; i < 120; i++) state.advance(1 / 60, [contact({ tractionSlip: 1 })], [0, 0]);
    assert.ok(state.ripples.length > 0 && state.ripples.length <= TERRAIN_WATER_MAX_RIPPLES);
    state.advance(1 / 60, [], [40, 0]);
    assert.equal(state.ripples.length, 0, "leaving the window releases old wavefronts");
    state.clear();
    assert.equal(state.ripples.length, 0);
  });
  check("terrain water: impulses are time-scaled, bounded, and water planes are grouped by level", () => {
    const energies: number[] = [];
    for (const hz of [30, 60, 144]) {
      const state = new TerrainWaterState();
      let energy = 0;
      state.advance(1 / hz, [contact()], [0, 0]);
      for (let i = 1; i <= hz; i++) {
        state.advance(1 / hz, [contact({ z: i / hz, rotation: i / hz * 2 })], [0, 0]);
        energy += state.impulses.reduce((sum, impulse) => sum + impulse.strength, 0);
        state.impulses.length = 0;
      }
      energies.push(energy);
    }
    assert.ok(Math.max(...energies) - Math.min(...energies) < 1e-6);
    const state = new TerrainWaterState();
    for (let i = 0; i < 300; i++) state.advance(1 / 60, [contact({ x: i % 4, rotation: i })], [0, 0]);
    assert.ok(state.impulses.length <= TERRAIN_WATER_MAX_IMPULSES);
    state.sites.clear();
    for (const [id, x, y] of [["a", 0, 0], ["b", 1, 0.01], ["c", 2, 1], ["d", 3, 2]] as const) state.sites.set(id, { x, y, z: 0 });
    const groups = state.groups(() => 0.15, 0, 0);
    assert.equal(groups.length, 2);
    assert.ok(Math.abs(groups[0]!.level + 0.15) < 1e-6);
    assert.equal(groups[0]!.maxX, 1.5, "coplanar films share their capture bounds");
    assert.ok(Math.abs(groups[1]!.level - 0.85) < 1e-6);
    assert.equal(state.groups(() => 0, 0, 0).length, 0, "no depth, no capture");
  });
  check("terrain water: quality ladder, custom normalization and unload keep GPU allocation lazy", () => {
    assert.deepEqual([QUALITY_PROFILES.low.terrainWaterQuality, QUALITY_PROFILES.medium.terrainWaterQuality,
      QUALITY_PROFILES.high.terrainWaterQuality], ["low", "medium", "high"]);
    const normalized = normalizeGraphicsPreferences({ selectedQualityLevel: "custom", customSettings: { terrainWaterQuality: "low" } });
    assert.equal(normalized.customSettings?.terrainWaterQuality, "low");
    assert.equal(normalizeGraphicsPreferences({ selectedQualityLevel: "custom", customSettings: { terrainWaterQuality: "bad" } }).customSettings?.terrainWaterQuality, undefined);
    const water = new TerrainWater();
    try {
      setTerrainWaterQuality("low");
      assert.equal(water.stats().quality, "low");
      assert.equal(water.stats().resolution, 0);
      water.state.advance(1 / 60, [contact()], [0, 0]);
      water.reset();
      assert.equal(water.state.sites.size, 0);
      assert.equal(water.stats().captures, 0);
    } finally { water.dispose(); setTerrainWaterQuality("high"); }
  });
  check("terrain water: shared planar capture tags nested cameras, restores render state and invalidates released images", () => {
    const source = new PlanarReflectionSource(0, "medium");
    const secondary = new PlanarReflectionSource(-5, "medium");
    const proxy = new Mesh(new BoxGeometry(8, 0.01, 8), new MeshBasicMaterial());
    const otherProxy = proxy.clone(); otherProxy.position.y = -5; otherProxy.updateMatrixWorld(true); secondary.addConsumer(otherProxy);
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 3, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    source.addConsumer(proxy); proxy.updateMatrixWorld(true);
    const target = new WebGLRenderTarget(1, 1);
    let current = target;
    let calls = 0;
    const fake = { xr: { enabled: true }, shadowMap: { autoUpdate: true }, toneMapping: 4, autoClear: true,
      getRenderTarget: () => current, setRenderTarget: (value: WebGLRenderTarget) => { current = value; },
      state: { buffers: { depth: { setMask: () => {} } } },
      render: (_scene: Scene, nested: PerspectiveCamera) => {
        calls++; assert.ok(isPlanarReflectionCamera(nested)); assert.equal(proxy.visible, false);
        assert.equal(nested.reversedDepth, camera.reversedDepth);
        if (calls === 1) secondary.update(fake, new Scene(), nested);
      },
    } as unknown as WebGLRenderer;
    try {
      assert.equal(source.hasCapture, false);
      source.update(fake, new Scene(), camera);
      assert.equal(calls, 1); assert.equal(source.hasCapture, true);
      assert.equal(proxy.visible, true); assert.equal(current, target);
      assert.equal(fake.xr.enabled, true); assert.equal(fake.shadowMap.autoUpdate, true); assert.equal(fake.toneMapping, 4);
      const image = source.binding.texture;
      source.setPlaneHeight(0.1);
      assert.equal(source.hasCapture, false); assert.equal(source.binding.texture, image, "elevation changes reuse the GPU target");
      source.update(fake, new Scene(), camera);
      assert.equal(source.hasCapture, true);
      (camera as unknown as { _reversedDepth: boolean })._reversedDepth = true; camera.updateProjectionMatrix();
      source.setPlaneHeight(0.2); source.update(fake, new Scene(), camera);
      assert.equal(source.hasCapture, true);
      source.setQuality(null); assert.equal(source.hasCapture, false);
      source.setQuality("high"); assert.equal(source.hasCapture, false);
      fake.render = () => { throw new Error("capture failed"); };
      assert.throws(() => source.update(fake, new Scene(), camera), /capture failed/);
      assert.equal(source.hasCapture, false); assert.equal(proxy.visible, true); assert.equal(current, target);
    } finally { source.dispose(); secondary.dispose(); proxy.geometry.dispose(); (proxy.material as MeshBasicMaterial).dispose(); target.dispose(); }
  });
}
