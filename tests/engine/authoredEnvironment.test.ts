/**
 * World Environment K1 — the render binding (WES-004). Headless three: the
 * override reaches the Sun's three light, ambient, exposure and fog, the layout
 * actors are never written (WES v0.3 §4.4), owner edits made while it is active
 * become the new base, and ending it restores the authored look (ENV-00).
 * The IBL capture needs a GL context, so these levels have no sky; the capture
 * cadence itself is pinned by the recapture policy tests.
 */
import assert from "node:assert/strict";
import { AmbientLight, DirectionalLight, FogExp2, Object3D, PerspectiveCamera, Scene, Vector3 } from "three";
import type { WebGLRenderer } from "three";

import { stateFromDefaults, type WorldEnvironmentState } from "../../engine/environment/environmentResolve";
import { evaluateSunLight } from "../../engine/environment/sunPath";
import { resolveWorldEnvironment } from "../../engine/environment/worldEnvironment";
import { AuthoredEnvironment } from "../../engine/render-three/authoredEnvironment";
import type { RoomLayout } from "../../engine/scene/layout";

type Check = (label: string, fn: () => void) => void;

function rig() {
  const scene = new Scene();
  const renderer = { toneMappingExposure: 0.8 } as unknown as WebGLRenderer;
  const env = new AuthoredEnvironment({
    scene,
    renderer,
    camera: () => new PerspectiveCamera(),
    resolveSunActor: () => null,
  });
  // Like the shells: the light sits under a root, its target directly in the scene.
  const root = new Object3D();
  root.position.set(4, 10, -2);
  const sun = new DirectionalLight(0xffeedd, 3);
  root.add(sun);
  scene.add(root, sun.target);
  sun.target.position.set(4, 9, -2); // straight down
  const ambient = new AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  return { scene, renderer, env, sun, ambient };
}

function layoutWith(worldEnvironment?: RoomLayout["worldEnvironment"]): RoomLayout {
  const layout: RoomLayout = {
    schema: 1, name: "wes", loadGroups: [], instances: [], characters: [],
    heightFog: { mode: "exp", color: "#445566", density: 0.02 },
  };
  if (worldEnvironment) layout.worldEnvironment = worldEnvironment;
  return layout;
}

function aim(sun: DirectionalLight): Vector3 {
  sun.updateWorldMatrix(true, false);
  return sun.target.getWorldPosition(new Vector3()).sub(sun.getWorldPosition(new Vector3())).normalize();
}

function at(hour: number, layout: RoomLayout): WorldEnvironmentState {
  return { ...stateFromDefaults(resolveWorldEnvironment(layout.worldEnvironment)), hour };
}

export function registerAuthoredEnvironmentTests(check: Check): void {
  check("world environment binding: visible moon follows preview and clears on disable without changing the authored sky", () => {
    const { env, sun, ambient } = rig();
    // Hidden sky avoids a GPU capture in this headless lifecycle test. The
    // browser test covers the visible sky and real shader rasterisation.
    const layout = layoutWith({ night: { moonAngularDiameterDeg: 2, moonBrightness: 0.8 } });
    layout.skyAtmosphere = { hidden: true };
    env.applySky(layout);
    const sky = env.sky!;
    const snapshot = structuredClone(layout);
    const u = sky.material.uniforms;
    assert.equal(u.forgeMoonBrightness!.value, 0);
    env.applyWorldEnvironment(layout, { state: at(0, layout), sun, ambient });
    assert.equal(u.forgeMoonBrightness!.value, 0.8);
    assert.deepEqual((u.forgeMoonDirection!.value as Vector3).toArray(), env.worldEnvironmentOverride!.light!.direction);
    assert.ok(Math.abs(u.forgeMoonRadiusSin!.value - Math.sin(Math.PI / 180)) < 1e-12);
    assert.equal(sky.visible, false, "a hidden sky never reveals the moon");
    env.applyWorldEnvironment(layout, { state: at(12, layout), sun, ambient });
    assert.equal(u.forgeMoonBrightness!.value, 0);
    env.applyWorldEnvironment(layout, { state: at(0, layout), sun, ambient });
    env.applyWorldEnvironment(layout, { state: null, sun, ambient });
    assert.equal(u.forgeMoonBrightness!.value, 0, "ending WES restores the original sky");
    assert.deepEqual(layout, snapshot);
    env.teardown();
    assert.equal(env.sky, null);
  });

  check("world environment binding: night fill works without authored lights, reuses one light and leaves no residue", () => {
    const { env, scene } = rig();
    const layout = layoutWith({ night: { ambientIntensity: 1.2, moonColor: "#8899ff" } });
    const snapshot = structuredClone(layout);
    const apply = (hour: number) => env.applyWorldEnvironment(layout, { state: at(hour, layout), sun: null, ambient: null });
    apply(0);
    const fill = scene.getObjectByName("world-environment-night-fill") as AmbientLight;
    assert.ok(fill instanceof AmbientLight);
    assert.equal(fill.intensity, 1.2);
    assert.equal(fill.color.getHexString(), "8899ff");
    assert.equal(fill.castShadow, false);
    for (const hour of [12, 0, 6, 18, 12, 0]) {
      apply(hour);
      assert.equal(scene.getObjectByName(fill.name), fill, "one light is reused through day/night cycles");
      assert.equal(scene.children.filter((child) => child.name === fill.name).length, 1);
      if (hour === 12) assert.equal(fill.intensity, 0, "no daytime fill");
    }
    assert.deepEqual(layout, snapshot);
    layout.worldEnvironment!.hidden = true;
    apply(0);
    assert.equal(fill.parent, null, "hiding the actor removes the contribution");
    layout.worldEnvironment!.hidden = false;
    apply(0);
    layout.worldEnvironment!.night!.ambientIntensity = 0;
    apply(0);
    assert.equal((scene.getObjectByName(fill.name) as AmbientLight).intensity, 0);
    env.applyWorldEnvironment(null, { state: null, sun: null, ambient: null });
    assert.equal(scene.getObjectByName(fill.name), undefined, "unloading removes the contribution");
    apply(0);
    env.teardown();
    env.teardown();
    assert.equal(scene.getObjectByName(fill.name), undefined, "teardown is idempotent");
  });

  check("world environment binding: no actor or no state renders the authored look (ENV-00)", () => {
    const { env, sun, ambient, renderer, scene } = rig();
    const layout = layoutWith();
    env.applyFog(layout);
    const before = aim(sun);
    for (const [l, state] of [[layout, at(0, layoutWith({}))], [layoutWith({}), null], [layoutWith({ hidden: true }), at(0, layoutWith({}))]] as const) {
      const result = env.applyWorldEnvironment(l, { state, sun, ambient });
      assert.deepEqual(result, { active: false, sunMoved: false });
    }
    assert.equal(sun.intensity, 3);
    assert.equal(ambient.intensity, 0.5);
    assert.equal(renderer.toneMappingExposure, 0.8);
    assert.ok(aim(sun).distanceTo(before) < 1e-9);
    assert.equal((scene.fog as FogExp2).color.getHexString(), "445566");
  });

  check("world environment binding: the clock aims the Sun's three light, never the layout (§4.4)", () => {
    const { env, sun, ambient, scene } = rig();
    const layout = layoutWith({ time: { hour: 12 } });
    env.applyFog(layout);
    const snapshot = structuredClone(layout);
    const fog = scene.fog;
    const noon = env.applyWorldEnvironment(layout, { state: at(12, layout), sun, ambient });
    assert.deepEqual(noon, { active: true, sunMoved: true });
    const expected = evaluateSunLight(12, resolveWorldEnvironment(layout.worldEnvironment)).lightDirection;
    assert.ok(aim(sun).distanceTo(new Vector3(...expected).negate()) < 1e-9);
    // Noon on the default path is the authored light, exactly.
    assert.equal(sun.intensity, 3);
    assert.equal(sun.color.getHexString(), "ffeedd");
    assert.equal(ambient.intensity, 0.5);
    assert.equal(scene.fog, fog, "fog is updated in place, not reallocated");
    assert.equal((scene.fog as FogExp2).color.getHexString(), "445566");
    assert.equal(env.applyWorldEnvironment(layout, { state: at(12, layout), sun, ambient }).sunMoved, false);
    assert.deepEqual(layout, snapshot, "the layout actors are never written");
  });

  check("world environment binding: night dims to the moon, raises exposure and keeps an ambient floor", () => {
    const { env, sun, ambient, renderer } = rig();
    const layout = layoutWith({});
    env.applyWorldEnvironment(layout, { state: at(0, layout), sun, ambient });
    const night = resolveWorldEnvironment({}).night;
    assert.ok(Math.abs(sun.intensity - 3 * night.moonIntensity) < 1e-9);
    assert.ok(Math.abs(ambient.intensity - 0.5 * night.ambientFloor) < 1e-9);
    assert.ok(renderer.toneMappingExposure > 0.8);
    assert.ok(aim(sun).y < 0, "the moon shines from above");
    // Applying again does not compound the multipliers.
    env.applyWorldEnvironment(layout, { state: at(0, layout), sun, ambient });
    assert.ok(Math.abs(sun.intensity - 3 * night.moonIntensity) < 1e-9);
    assert.ok(Math.abs(ambient.intensity - 0.5 * night.ambientFloor) < 1e-9);
  });

  check("world environment binding: an owner edit while active becomes the new base", () => {
    const { env, sun, ambient } = rig();
    const layout = layoutWith({});
    env.applyWorldEnvironment(layout, { state: at(12, layout), sun, ambient });
    // The editor re-syncs the light from the layout after an edit.
    sun.intensity = 5;
    ambient.intensity = 0.25;
    env.applyWorldEnvironment(layout, { state: at(12, layout), sun, ambient });
    assert.equal(sun.intensity, 5);
    assert.equal(ambient.intensity, 0.25);
  });

  check("world environment binding: ending the override restores every value it changed", () => {
    const { env, sun, ambient, renderer, scene } = rig();
    const layout = layoutWith({ weather: { preset: "fog" } });
    env.applyFog(layout);
    const authoredAim = aim(sun);
    env.applyWorldEnvironment(layout, { state: at(20, layout), sun, ambient });
    assert.notEqual(sun.intensity, 3);
    assert.ok((scene.fog as FogExp2).density > 0.02);
    const ended = env.applyWorldEnvironment(layout, { state: null, sun, ambient });
    assert.deepEqual(ended, { active: false, sunMoved: true });
    assert.equal(sun.intensity, 3);
    assert.equal(sun.color.getHexString(), "ffeedd");
    assert.equal(ambient.intensity, 0.5);
    assert.equal(renderer.toneMappingExposure, 0.8);
    assert.ok(aim(sun).distanceTo(authoredAim) < 1e-9);
    assert.equal((scene.fog as FogExp2).density, 0.02);
  });
}
