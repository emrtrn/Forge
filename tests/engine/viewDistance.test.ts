import assert from "node:assert/strict";
import {
  effectiveViewDistance,
  exponentialFogDensityFor,
  exponentialFogOpacityAt,
  isFarViewMode,
  linearFogOpacityAt,
  VIEW_DISTANCE_FOG_OPACITY,
  VIEW_DISTANCE_MAX,
  VIEW_DISTANCE_MIN,
} from "../../engine/world/viewDistance";

type Check = (label: string, fn: () => void) => void;

export function registerViewDistanceTests(check: Check): void {
  check("view distance: quality multiplier scales the authored far plane", () => {
    assert.equal(effectiveViewDistance(3000, 0.5), 1500);
    for (const multiplier of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(effectiveViewDistance(3000, multiplier), 3000);
    }
  });

  check("view distance: effective far plane is clamped to authored limits", () => {
    assert.equal(VIEW_DISTANCE_MIN, 50);
    assert.equal(VIEW_DISTANCE_MAX, 20000);
    assert.equal(effectiveViewDistance(100, 0.25), 50);
    assert.equal(effectiveViewDistance(20000, 2), 20000);
    assert.equal(effectiveViewDistance(1, 1), 50);
    assert.equal(effectiveViewDistance(30000, 1), 20000);
  });

  check("view distance: absent or invalid authored distances keep camera defaults", () => {
    for (const distance of [undefined, NaN, 0, -1, Infinity, -Infinity]) {
      assert.equal(effectiveViewDistance(distance, 2), null);
    }
  });

  check("view distance: far view mode starts strictly beyond 1000 metres", () => {
    assert.equal(isFarViewMode(1000), false);
    assert.equal(isFarViewMode(1000.5), true);
    assert.equal(isFarViewMode(null), false);
  });

  check("view distance: exponential fog reaches the target opacity at the far plane", () => {
    assert.ok(Math.abs(exponentialFogDensityFor(1000) - 0.001977884) < 1e-9);
    assert.equal(VIEW_DISTANCE_FOG_OPACITY, 0.98);
    assert.ok(Math.abs(exponentialFogOpacityAt(exponentialFogDensityFor(2500), 2500) - 0.98) < 1e-12);
    assert.ok(Math.abs(exponentialFogOpacityAt(exponentialFogDensityFor(500, 0.5), 500) - 0.5) < 1e-12);
  });

  check("view distance: exponential fog rejects invalid distances and opacities", () => {
    for (const distance of [0, -1, NaN, Infinity, -Infinity]) {
      assert.equal(exponentialFogDensityFor(distance), 0);
    }
    for (const opacity of [0, 1, -0.5, 1.5, NaN, Infinity]) {
      assert.equal(exponentialFogDensityFor(1000, opacity), 0);
    }
    for (const density of [-1, NaN, Infinity, -Infinity]) {
      assert.equal(exponentialFogOpacityAt(density, 1000), 0);
    }
    for (const distance of [-1, NaN, Infinity, -Infinity]) {
      assert.equal(exponentialFogOpacityAt(0.01, distance), 0);
    }
    assert.equal(exponentialFogOpacityAt(0, 1000), 0);
    assert.equal(exponentialFogOpacityAt(0.01, 0), 0);
  });

  check("view distance: linear fog interpolates and clamps opacity", () => {
    assert.equal(linearFogOpacityAt(10, 110, 60), 0.5);
    assert.equal(linearFogOpacityAt(10, 110, 5), 0);
    assert.equal(linearFogOpacityAt(10, 110, 500), 1);
  });

  check("view distance: collapsed or reversed linear fog ranges step at the end", () => {
    assert.equal(linearFogOpacityAt(50, 50, 50), 1);
    assert.equal(linearFogOpacityAt(50, 50, 49), 0);
    assert.equal(linearFogOpacityAt(100, 50, 50), 1);
    assert.equal(linearFogOpacityAt(100, 50, 49), 0);
  });
}
