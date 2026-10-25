/** Cascaded sun shadow math + quality fields (OPEN_WORLD_PLAN Faz 7c2). */
import assert from "node:assert/strict";
import {
  cascadeSliceSphere,
  computeCascadeSplits,
  computeSunCascades,
  sunCascadeBudget,
  sunCascadeDistance,
  sunCascadeNeedsUpdate,
  sunShadowFadeRange,
  SUN_CASCADE_NEAR,
  SUN_CASCADE_SPLIT_LAMBDA,
  type SunCascade,
  type SunCascadeInput,
} from "../../engine/world/sunCascades";
import type { FollowShadowVec3 } from "../../engine/world/followShadow";
import {
  normalizeGraphicsPreferences,
  QUALITY_PROFILES,
  resolveQualitySettings,
} from "../../engine/perf/qualityProfiles";

type Check = (label: string, fn: () => void) => void;

const INPUT: SunCascadeInput = {
  lightDirection: [0.35, -0.8, 0.25],
  cameraPosition: [812.5, 46.25, -1290.75],
  cameraForward: [0.6, -0.25, -0.76],
  fovDeg: 60,
  aspect: 16 / 9,
  count: 4,
  distance: 200,
  mapSize: 2048,
};

function dot(a: FollowShadowVec3, b: FollowShadowVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: FollowShadowVec3): FollowShadowVec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: FollowShadowVec3, b: FollowShadowVec3): FollowShadowVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Eye + the four far corners of the camera frustum slice ending at `distance`. */
function slicePoints(input: SunCascadeInput, distance: number): FollowShadowVec3[] {
  const forward = normalize(input.cameraForward);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanV = Math.tan((input.fovDeg * Math.PI) / 360);
  const tanH = tanV * input.aspect;
  const [px, py, pz] = input.cameraPosition;
  const points: FollowShadowVec3[] = [[px, py, pz]];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      points.push([
        px + distance * (forward[0] + sx * tanH * right[0] + sy * tanV * up[0]),
        py + distance * (forward[1] + sx * tanH * right[1] + sy * tanV * up[1]),
        pz + distance * (forward[2] + sx * tanH * right[2] + sy * tanV * up[2]),
      ]);
    }
  }
  return points;
}

/**
 * True when `point` lies inside the cascade's orthographic shadow box. Texel
 * snapping moves the box by up to half a texel, so a point exactly on the slice
 * sphere may sit that far outside it.
 */
function insideCascade(cascade: SunCascade, point: FollowShadowVec3): boolean {
  const { frame } = cascade;
  const slack = frame.texelSize / 2 + 1e-9;
  const relative: FollowShadowVec3 = [
    point[0] - frame.target[0],
    point[1] - frame.target[1],
    point[2] - frame.target[2],
  ];
  const x = dot(relative, frame.axisX);
  const y = dot(relative, frame.axisY);
  // Light-space depth from the light position (axisZ points back at the light).
  const depth = dot([point[0] - frame.position[0], point[1] - frame.position[1], point[2] - frame.position[2]], frame.axisZ) * -1;
  return Math.abs(x) <= frame.right + slack && Math.abs(y) <= frame.top + slack && depth >= frame.near - slack && depth <= frame.far + slack;
}

export function registerSunCascadesTests(check: Check): void {
  check("sun cascades: practical splits match the approved profile table", () => {
    const four = computeCascadeSplits(4, SUN_CASCADE_NEAR, 200, SUN_CASCADE_SPLIT_LAMBDA);
    assert.deepEqual(four.map((split) => Math.round(split)), [16, 36, 77, 200]);
    const three = computeCascadeSplits(3, SUN_CASCADE_NEAR, 150, SUN_CASCADE_SPLIT_LAMBDA);
    assert.deepEqual(three.map((split) => Math.round(split)), [17, 46, 150]);
    const two = computeCascadeSplits(2, SUN_CASCADE_NEAR, 100, SUN_CASCADE_SPLIT_LAMBDA);
    assert.deepEqual(two.map((split) => Math.round(split)), [20, 100]);
    for (const splits of [four, three, two]) {
      for (let index = 1; index < splits.length; index += 1) assert.ok(splits[index]! > splits[index - 1]!);
    }
    assert.deepEqual(computeCascadeSplits(1, 1, 80, 0.75), [80]);
  });

  check("sun cascades: unusable split input yields no cascades", () => {
    assert.deepEqual(computeCascadeSplits(0, 1, 200, 0.75), []);
    assert.deepEqual(computeCascadeSplits(3, 0, 200, 0.75), []);
    assert.deepEqual(computeCascadeSplits(3, 5, 5, 0.75), []);
    assert.deepEqual(computeCascadeSplits(3, 1, Number.NaN, 0.75), []);
    assert.deepEqual(computeSunCascades({ ...INPUT, count: 5 }), []);
    assert.deepEqual(computeSunCascades({ ...INPUT, cameraForward: [0, 0, 0] }), []);
    assert.deepEqual(computeSunCascades({ ...INPUT, lightDirection: [0, 0, 0] }), []);
    assert.deepEqual(computeSunCascades({ ...INPUT, distance: 0 }), []);
  });

  check("sun cascades: slice sphere reaches the eye and the far corners exactly", () => {
    for (const [fov, aspect] of [[60, 16 / 9], [45, 1], [90, 2.4]] as const) {
      const distance = 77;
      const sphere = cascadeSliceSphere(fov, aspect, distance);
      const tanV = Math.tan((fov * Math.PI) / 360);
      const corner = distance * Math.hypot(tanV, tanV * aspect);
      assert.ok(Math.abs(sphere.center - sphere.radius) < 1e-9 || sphere.center === distance, `fov ${fov}: eye on the sphere`);
      assert.ok(sphere.radius + 1e-9 >= Math.hypot(distance - sphere.center, corner), `fov ${fov}: corner inside`);
      assert.ok(sphere.center <= distance);
    }
    // A very wide frustum clamps the centre to the far plane.
    const wide = cascadeSliceSphere(150, 3, 10);
    assert.equal(wide.center, 10);
    assert.ok(wide.radius >= 10);
  });

  check("sun cascades: each cascade box holds its whole frustum slice, and every nearer slice", () => {
    for (const forward of [INPUT.cameraForward, [-0.2, -0.9, 0.3], [0, 0, 1], [1, 0.4, 0]] as FollowShadowVec3[]) {
      const input = { ...INPUT, cameraForward: forward };
      const cascades = computeSunCascades(input);
      assert.equal(cascades.length, 4);
      cascades.forEach((cascade, index) => {
        for (let inner = 0; inner <= index; inner += 1) {
          for (const point of slicePoints(input, cascades[inner]!.split)) {
            assert.ok(insideCascade(cascade, point), `forward ${forward}: cascade ${index} misses slice ${inner}`);
          }
        }
      });
      assert.equal(cascades[3]!.split, 200);
    }
  });

  check("sun cascades: box size is constant under camera rotation and frames are texel-snapped", () => {
    const a = computeSunCascades(INPUT);
    const b = computeSunCascades({ ...INPUT, cameraForward: [-0.7, 0.1, 0.2] });
    a.forEach((cascade, index) => {
      assert.equal(cascade.frame.right, b[index]!.frame.right);
      assert.equal(cascade.frame.far, b[index]!.frame.far);
      const texel = cascade.frame.texelSize;
      assert.ok(Math.abs(texel - (2 * cascade.sphere.radius) / INPUT.mapSize) < 1e-12);
      for (const axis of [cascade.frame.axisX, cascade.frame.axisY]) {
        const cells = dot(cascade.frame.target, axis) / texel;
        assert.ok(Math.abs(cells - Math.round(cells)) < 1e-6, `cascade ${index}: target off the texel grid`);
      }
      const direction = normalize(INPUT.lightDirection);
      const lightAxis = cascade.frame.axisZ;
      assert.ok(Math.abs(dot(direction, lightAxis) + 1) < 1e-9, "cascade looks along the light");
    });
    // Moving the camera by far less than a texel keeps the box on the same texel grid
    // position (it may slide along the light axis, which does not move the map).
    const moved = computeSunCascades({ ...INPUT, cameraPosition: [INPUT.cameraPosition[0] + 1e-4, INPUT.cameraPosition[1], INPUT.cameraPosition[2]] });
    for (const axis of [a[0]!.frame.axisX, a[0]!.frame.axisY]) {
      assert.ok(Math.abs(dot(moved[0]!.frame.target, axis) - dot(a[0]!.frame.target, axis)) < 1e-9);
    }
  });

  check("sun cascades: distance and fade follow the quality distance scale", () => {
    assert.equal(sunCascadeDistance(1), 200);
    assert.equal(sunCascadeDistance(0.75), 150);
    assert.equal(sunCascadeDistance(0.5), 100);
    assert.ok(Math.abs(sunCascadeDistance(0.35) - 70) < 1e-9);
    assert.deepEqual(sunShadowFadeRange(200), [170, 200]);
  });

  check("sun cascades: staggered refresh alternates cascades 2+ and draws everything on frame 0", () => {
    for (let index = 0; index < 4; index += 1) assert.equal(sunCascadeNeedsUpdate(index, 0, true), true);
    const updates = (index: number) => Array.from({ length: 6 }, (_, frame) => sunCascadeNeedsUpdate(index, frame + 1, true));
    assert.deepEqual(updates(0), [true, true, true, true, true, true]);
    assert.deepEqual(updates(1), [true, true, true, true, true, true]);
    assert.deepEqual(updates(2), [false, true, false, true, false, true]);
    assert.deepEqual(updates(3), [true, false, true, false, true, false]);
    assert.deepEqual(Array.from({ length: 4 }, (_, frame) => sunCascadeNeedsUpdate(3, frame, false)), [true, true, true, true]);
  });

  check("sun cascades: the texture-unit budget caps the cascade count", () => {
    assert.equal(sunCascadeBudget(16, 14), 2);
    assert.equal(sunCascadeBudget(16, 15), 1);
    assert.equal(sunCascadeBudget(16, 17), 0);
    assert.equal(sunCascadeBudget(32, 14), 4, "never more than the shader unrolls");
    assert.equal(sunCascadeBudget(Number.NaN, 0), 0);
  });

  check("sun cascades: quality profiles carry the approved cascade counts", () => {
    assert.deepEqual(
      (["ultra", "high", "medium", "low"] as const).map((level) => [QUALITY_PROFILES[level].shadowCascades, QUALITY_PROFILES[level].shadowCascadeStagger]),
      [[4, true], [3, false], [2, false], [2, false]],
    );
    assert.deepEqual(
      (["ultra", "high", "medium", "low"] as const).map((level) => sunCascadeDistance(QUALITY_PROFILES[level].shadowDistanceScale)),
      [200, 150, 100, sunCascadeDistance(0.35)],
    );
    const prefs = normalizeGraphicsPreferences({
      selectedQualityLevel: "custom",
      customSettings: { shadowCascades: 3, shadowCascadeStagger: true },
    });
    assert.deepEqual(prefs.customSettings, { shadowCascades: 3, shadowCascadeStagger: true });
    const rejected = normalizeGraphicsPreferences({
      selectedQualityLevel: "custom",
      customSettings: { shadowCascades: 5, shadowCascadeStagger: "yes", renderScale: 0.9 },
    });
    assert.deepEqual(rejected.customSettings, { renderScale: 0.9 });
    const custom = resolveQualitySettings("custom", { shadowCascades: 1 }, "ultra");
    assert.equal(custom.shadowCascades, 1);
    assert.equal(custom.shadowCascadeStagger, true);
  });
}
