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
  check("world environment binding: no actor or no state renders the authored look (ENV-00)", () => {
    const { env, sun, ambient, renderer, scene } = rig();
    const layout = layoutWith();
    env.applyFog(layout);
    const before = aim(sun);
    for (const [l, state] of [[layout, at(0, layoutWith({}))], [layoutWith({}), null], [layoutWith({ hidden: true }), at(0, layoutWith({}))]] as const) {
      const result = env.applyWorldEnvironment(l, { state, nowMs: 0, sun, ambient });
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
    const noon = env.applyWorldEnvironment(layout, { state: at(12, layout), nowMs: 0, sun, ambient });
    assert.deepEqual(noon, { active: true, sunMoved: true });
    const expected = evaluateSunLight(12, resolveWorldEnvironment(layout.worldEnvironment)).lightDirection;
    assert.ok(aim(sun).distanceTo(new Vector3(...expected).negate()) < 1e-9);
    // Noon on the default path is the authored light, exactly.
    assert.equal(sun.intensity, 3);
    assert.equal(sun.color.getHexString(), "ffeedd");
    assert.equal(ambient.intensity, 0.5);
    assert.equal(scene.fog, fog, "fog is updated in place, not reallocated");
    assert.equal((scene.fog as FogExp2).color.getHexString(), "445566");
    assert.equal(env.applyWorldEnvironment(layout, { state: at(12, layout), nowMs: 16, sun, ambient }).sunMoved, false);
    assert.deepEqual(layout, snapshot, "the layout actors are never written");
  });

  check("world environment binding: night dims to the moon, raises exposure and keeps an ambient floor", () => {
    const { env, sun, ambient, renderer } = rig();
    const layout = layoutWith({});
    env.applyWorldEnvironment(layout, { state: at(0, layout), nowMs: 0, sun, ambient });
    const night = resolveWorldEnvironment({}).night;
    assert.ok(Math.abs(sun.intensity - 3 * night.moonIntensity) < 1e-9);
    assert.ok(Math.abs(ambient.intensity - 0.5 * night.ambientFloor) < 1e-9);
    assert.ok(renderer.toneMappingExposure > 0.8);
    assert.ok(aim(sun).y < 0, "the moon shines from above");
    // Applying again does not compound the multipliers.
    env.applyWorldEnvironment(layout, { state: at(0, layout), nowMs: 16, sun, ambient });
    assert.ok(Math.abs(sun.intensity - 3 * night.moonIntensity) < 1e-9);
    assert.ok(Math.abs(ambient.intensity - 0.5 * night.ambientFloor) < 1e-9);
  });

  check("world environment binding: an owner edit while active becomes the new base", () => {
    const { env, sun, ambient } = rig();
    const layout = layoutWith({});
    env.applyWorldEnvironment(layout, { state: at(12, layout), nowMs: 0, sun, ambient });
    // The editor re-syncs the light from the layout after an edit.
    sun.intensity = 5;
    ambient.intensity = 0.25;
    env.applyWorldEnvironment(layout, { state: at(12, layout), nowMs: 16, sun, ambient });
    assert.equal(sun.intensity, 5);
    assert.equal(ambient.intensity, 0.25);
  });

  check("world environment binding: ending the override restores every value it changed", () => {
    const { env, sun, ambient, renderer, scene } = rig();
    const layout = layoutWith({ weather: { preset: "fog" } });
    env.applyFog(layout);
    const authoredAim = aim(sun);
    env.applyWorldEnvironment(layout, { state: at(20, layout), nowMs: 0, sun, ambient });
    assert.notEqual(sun.intensity, 3);
    assert.ok((scene.fog as FogExp2).density > 0.02);
    const ended = env.applyWorldEnvironment(layout, { state: null, nowMs: 16, sun, ambient });
    assert.deepEqual(ended, { active: false, sunMoved: true });
    assert.equal(sun.intensity, 3);
    assert.equal(sun.color.getHexString(), "ffeedd");
    assert.equal(ambient.intensity, 0.5);
    assert.equal(renderer.toneMappingExposure, 0.8);
    assert.ok(aim(sun).distanceTo(authoredAim) < 1e-9);
    assert.equal((scene.fog as FogExp2).density, 0.02);
  });
}
