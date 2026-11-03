/**
 * Faz 6 global wind: the shared normalizer (WES group + World Settings), the
 * source order and the weather/season scaling. Visual-only data; see
 * DEFORMABLE_FRACTURABLE_WORK_PLAN.md K-06.
 */
import assert from "node:assert/strict";
import {
  normalizeLayoutWind,
  resolveWind,
  SEASON_WIND_MULTIPLIER,
  WIND_DEFAULTS,
  WIND_MAX_STRENGTH,
} from "../../engine/environment/wind";
import { normalizeWorldEnvironment } from "../../engine/environment/worldEnvironment";
import type { RoomLayout } from "../../engine/scene/layout";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateLayout } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

const near = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~ ${expected}`);

function level(worldSettings?: unknown): Record<string, unknown> {
  const layout: Record<string, unknown> = { schema: 1, name: "Wind", loadGroups: [], instances: [], characters: [] };
  if (worldSettings !== undefined) layout.worldSettings = worldSettings;
  return layout;
}

export function registerWindTests(check: Check): void {
  check("wind: the normalizer keeps authored fields, wraps direction and clamps with warnings", () => {
    const warnings: string[] = [];
    assert.deepEqual(normalizeLayoutWind({}, "wind", warnings), {});
    assert.deepEqual(normalizeLayoutWind({ directionDeg: -90, strength: 0.25 }, "wind", warnings), { directionDeg: 270, strength: 0.25 });
    assert.deepEqual(normalizeLayoutWind({ directionDeg: 360 }, "wind", warnings), { directionDeg: 0 });
    assert.deepEqual(warnings, []);

    assert.deepEqual(normalizeLayoutWind({ strength: 3, gust: "x", directionDeg: 12.34567 }, "wind", warnings), { directionDeg: 12.346, strength: 1 });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /wind\.strength: 3 clamped to 1/);
    assert.match(warnings[1]!, /wind\.gust: x is not a number/);
    assert.equal(normalizeLayoutWind(undefined, "wind", warnings), undefined);
    assert.equal(normalizeLayoutWind([1], "wind", warnings), undefined);
    assert.match(warnings.at(-1)!, /wind must be an object/);
  });

  check("wind: the World Environment group normalizes inside the actor; an empty group is dropped", () => {
    assert.deepEqual(normalizeWorldEnvironment({ wind: { strength: 0.5 } }).environment, { wind: { strength: 0.5 } });
    assert.deepEqual(normalizeWorldEnvironment({ wind: {} }).environment, {});
    const { environment, warnings } = normalizeWorldEnvironment({ wind: { gust: 2 } });
    assert.deepEqual(environment, { wind: { gust: 1 } });
    assert.match(warnings[0]!, /worldEnvironment\.wind\.gust: 2 clamped to 1/);
  });

  check("wind: worldSettings.wind round-trips the save and rejects a repair", () => {
    const layout = level({ wind: { directionDeg: 90, strength: 0.8, gust: 0.1 } });
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.worldSettings?.wind, { directionDeg: 90, strength: 0.8, gust: 0.1 });
    assert.deepEqual(collectDroppedFields(layout, saved, "layout").paths, []);
    assert.equal((validateLayout(level({ wind: {} })) as RoomLayout).worldSettings?.wind, undefined, "an empty group is not written");
    assert.throws(() => validateLayout(level({ wind: { strength: 2 } })), /worldSettings\.wind\.strength: 2 clamped to 1/);
    assert.throws(() => validateLayout(level({ wind: 5 })), /worldSettings\.wind must be an object/);
    const withUnknown = level({ wind: { strength: 0.5, turbulence: 1 } });
    assert.deepEqual(collectDroppedFields(withUnknown, validateLayout(withUnknown), "layout").paths, ["layout.worldSettings.wind.turbulence"]);
  });

  check("wind: source order is WES group, then World Settings, then the defaults, field by field", () => {
    const fallback = resolveWind(undefined, undefined, null);
    assert.equal(fallback.directionDeg, WIND_DEFAULTS.directionDeg);
    assert.equal(fallback.strength, WIND_DEFAULTS.strength);
    assert.equal(fallback.gust, WIND_DEFAULTS.gust);
    near(fallback.direction[0], Math.SQRT1_2);
    near(fallback.direction[1], Math.SQRT1_2);

    const settingsOnly = resolveWind(null, { directionDeg: 90, strength: 0.8 }, null);
    near(settingsOnly.direction[0], 1);
    near(settingsOnly.direction[1], 0);
    assert.equal(settingsOnly.strength, 0.8);
    assert.equal(settingsOnly.gust, WIND_DEFAULTS.gust);

    const both = resolveWind({ strength: 0.2 }, { directionDeg: 90, strength: 0.8, gust: 0.6 }, null);
    assert.equal(both.directionDeg, 90);
    assert.equal(both.strength, 0.2);
    assert.equal(both.gust, 0.6);
    const calm = resolveWind({ strength: 0 }, null, { season: "autumn", weather: { preset: "rain", intensity: 1 } });
    assert.equal(calm.strength, 0, "authored calm stays calm in a storm");
  });

  check("wind: clear summer is the identity; weather and season scale it within bounds", () => {
    const base = { directionDeg: 0, strength: 0.5, gust: 0.2 };
    const clear = resolveWind(base, null, { season: "summer", weather: { preset: "clear", intensity: 1 } });
    assert.deepEqual(clear, resolveWind(base, null, null));

    const rain = resolveWind(base, null, { season: "summer", weather: { preset: "rain", intensity: 1 } });
    near(rain.strength, 0.5 * 1.7);
    near(rain.gust, 0.45);
    const halfRain = resolveWind(base, null, { season: "summer", weather: { preset: "rain", intensity: 0.5 } });
    near(halfRain.strength, 0.5 * 1.35);
    const fog = resolveWind(base, null, { season: "summer", weather: { preset: "fog", intensity: 1 } });
    assert.ok(fog.strength < base.strength, "fog is still air");
    const autumn = resolveWind(base, null, { season: "autumn", weather: { preset: "clear", intensity: 1 } });
    near(autumn.strength, 0.5 * SEASON_WIND_MULTIPLIER.autumn);

    const storm = resolveWind({ strength: 1, gust: 1 }, null, { season: "autumn", weather: { preset: "rain", intensity: 1 } });
    assert.ok(storm.strength <= WIND_MAX_STRENGTH);
    assert.equal(storm.gust, 1);
  });
}
