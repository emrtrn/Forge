import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import {
  computeFollowShadowFrame,
  type FollowShadowFrame,
  type FollowShadowInput,
  type FollowShadowVec3,
} from "../../engine/world/followShadow";

type Check = (label: string, fn: () => void) => void;

const INPUT: FollowShadowInput = {
  lightDirection: [0.4, -0.8, 0.3],
  focus: [123.4, 35.6, -78.9],
  halfExtent: 60,
  mapSize: 2048,
  depthAbove: 120,
  depthBelow: 80,
};

function frame(overrides: Partial<FollowShadowInput> = {}): FollowShadowFrame {
  const result = computeFollowShadowFrame({ ...INPUT, ...overrides });
  assert.ok(result);
  return result;
}

function dot(a: FollowShadowVec3, b: FollowShadowVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function difference(a: FollowShadowVec3, b: FollowShadowVec3): FollowShadowVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled(a: FollowShadowVec3, b: FollowShadowVec3, scale: number): FollowShadowVec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function assertClose(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

function assertVectorClose(actual: FollowShadowVec3, expected: FollowShadowVec3, tolerance = 1e-9): void {
  for (const index of [0, 1, 2] as const) assertClose(actual[index], expected[index], tolerance);
}

export function registerFollowShadowTests(check: Check): void {
  const directions: readonly FollowShadowVec3[] = [[0.4, -0.8, 0.3], [0, -1, 0], [0, 1, 0]];
  for (const lightDirection of directions) {
    check(`follow shadow: orthonormal basis for direction ${lightDirection.join(", ")}`, () => {
      const { axisX, axisY, axisZ } = frame({ lightDirection });
      for (const axis of [axisX, axisY, axisZ]) assertClose(Math.hypot(...axis), 1);
      assertClose(dot(axisX, axisY), 0);
      assertClose(dot(axisX, axisZ), 0);
      assertClose(dot(axisY, axisZ), 0);
    });

    check(`follow shadow: basis matches three lookAt for direction ${lightDirection.join(", ")}`, () => {
      const result = frame({ lightDirection });
      const matrix = new Matrix4().lookAt(
        new Vector3(...result.position),
        new Vector3(...result.target),
        new Vector3(0, 1, 0),
      );
      [result.axisX, result.axisY, result.axisZ].forEach((axis, column) => {
        const expected = new Vector3().setFromMatrixColumn(matrix, column);
        assertVectorClose(axis, [expected.x, expected.y, expected.z]);
      });

      // Also exercise three's parallel-up branch directly from the original direction.
      const reference = new Matrix4().lookAt(
        new Vector3(...lightDirection).negate(),
        new Vector3(),
        new Vector3(0, 1, 0),
      );
      [result.axisX, result.axisY, result.axisZ].forEach((axis, column) => {
        const expected = new Vector3().setFromMatrixColumn(reference, column);
        assertVectorClose(axis, [expected.x, expected.y, expected.z]);
      });
    });

    check(`follow shadow: target snaps laterally and preserves depth for direction ${lightDirection.join(", ")}`, () => {
      const { target, texelSize, axisX, axisY, axisZ } = frame({ lightDirection });
      const offset = difference(target, INPUT.focus);
      for (const axis of [axisX, axisY]) {
        const coordinate = dot(target, axis) / texelSize;
        assertClose(coordinate, Math.round(coordinate), 1e-6);
        assert.ok(Math.abs(dot(offset, axis)) <= texelSize / 2 + 1e-9);
      }
      assertClose(dot(offset, axisZ), 0);
    });
  }

  check("follow shadow: sub-texel motion inside a rounding boundary keeps the target stable", () => {
    const initial = frame();
    const focusA = initial.target;
    const focusB = addScaled(focusA, initial.axisX, 0.1 * initial.texelSize);
    const a = frame({ focus: focusA });
    const b = frame({ focus: focusB });
    // Basis projection and reconstruction can differ by floating-point roundoff.
    assertVectorClose(a.target, initial.target);
    assertVectorClose(b.target, a.target);
  });

  check("follow shadow: a one-texel focus move advances the target by one texel", () => {
    const initial = frame();
    const a = frame({ focus: initial.target });
    const b = frame({ focus: addScaled(initial.target, initial.axisX, initial.texelSize) });
    assertVectorClose(
      difference(b.target, a.target),
      addScaled([0, 0, 0], initial.axisX, initial.texelSize),
      1e-6,
    );
    assertClose(dot(difference(b.target, a.target), initial.axisX), initial.texelSize, 1e-6);
  });

  check("follow shadow: frustum and light position cover the requested extent and depth", () => {
    const result = frame();
    assertVectorClose(difference(result.position, result.target), addScaled([0, 0, 0], result.axisZ, INPUT.depthAbove));
    assert.equal(result.left, -60);
    assert.equal(result.right, 60);
    assert.equal(result.top, 60);
    assert.equal(result.bottom, -60);
    assert.equal(result.near, 0);
    assert.equal(result.far, 200);
    assert.equal(result.texelSize, 0.05859375);
  });

  check("follow shadow: direction magnitude does not change the frame", () => {
    const a = frame();
    const b = frame({ lightDirection: [4, -8, 3] });
    assertVectorClose(a.axisX, b.axisX);
    assertVectorClose(a.axisY, b.axisY);
    assertVectorClose(a.axisZ, b.axisZ);
    assertVectorClose(a.target, b.target);
    assertVectorClose(a.position, b.position);
  });

  check("follow shadow: zero depths remain valid", () => {
    const result = frame({ depthAbove: 0, depthBelow: 0 });
    assert.deepEqual(result.position, result.target);
    assert.equal(result.far, 0);
  });

  check("follow shadow: invalid direction, extent, map size or depth returns null", () => {
    const invalid: Partial<FollowShadowInput>[] = [
      { lightDirection: [0, 0, 0] },
      { halfExtent: 0 },
      { halfExtent: -1 },
      { mapSize: 0 },
      { mapSize: -1 },
      { depthAbove: -1 },
      { depthBelow: -1 },
    ];
    for (const overrides of invalid) assert.equal(computeFollowShadowFrame({ ...INPUT, ...overrides }), null);
  });

  check("follow shadow: non-finite vector components and scalars return null", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const key of ["focus", "lightDirection"] as const) {
        for (const index of [0, 1, 2] as const) {
          const vector: [number, number, number] = [...INPUT[key]];
          vector[index] = value;
          assert.equal(computeFollowShadowFrame({ ...INPUT, [key]: vector }), null);
        }
      }
      for (const key of ["halfExtent", "mapSize", "depthAbove", "depthBelow"] as const) {
        assert.equal(computeFollowShadowFrame({ ...INPUT, [key]: value }), null);
      }
    }
  });
}
