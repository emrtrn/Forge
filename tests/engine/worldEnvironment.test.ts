/**
 * World Environment (WES) K1 — data contract (WES-002). The normalizer is the
 * single source of field shape: the loader repairs what it can with a warning,
 * and the save validator reuses it so nothing the runtime keeps is dropped on
 * save (ENV-09) and a level without the actor saves exactly as before (ENV-00).
 */
import assert from "node:assert/strict";

import {
  normalizeWorldEnvironment,
  resolveWorldEnvironment,
  WORLD_ENVIRONMENT_DEFAULTS,
} from "../../engine/environment/worldEnvironment";
import type { LayoutWorldEnvironment, RoomLayout } from "../../engine/scene/layout";
import { resolveEnvironment, stateFromDefaults } from "../../engine/environment/environmentResolve";
import { angleBetweenDeg, shouldRecapture } from "../../engine/environment/recapturePolicy";
import {
  deriveSunPathFromDirection,
  directionFromAngles,
  evaluateSunLight,
  initialWorldEnvironmentForSun,
  MIN_LIGHT_ELEVATION_DEG,
  sunAngles,
  sunDirectionFromRotation,
} from "../../engine/environment/sunPath";
import { weatherFactors, weatherPresetRequirements } from "../../engine/environment/weatherPresets";
import { clockHour, WorldClock, wrapHour } from "../../engine/environment/worldClock";
import { sunDirectionFromLightRotation } from "../../engine/render-three/skyAtmosphere";
import { resolveCloudLayer } from "../../engine/scene/cloudLayer";
import { resolveHeightFog } from "../../engine/scene/heightFog";
import type { Vec3 } from "../../engine/scene/layout";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateLayout, validateWorldEnvironment } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

/** Exercises every `LayoutWorldEnvironment` field. Extend it whenever the schema grows. */
export function maximalWorldEnvironment(): LayoutWorldEnvironment {
  return {
    name: "Valley Weather",
    hidden: true,
    time: { hour: 7.5, dayLengthMinutes: 24 },
    sunPath: { azimuthDeg: 135, noonElevationDeg: 48, sunriseHour: 5.5, sunsetHour: 19.25 },
    night: { moonIntensity: 0.12, moonColor: "#8899ff", ambientFloor: 0.2 },
    season: "winter",
    weather: { preset: "snow", intensity: 0.75 },
    surface: {
      snowCoverage: 0.4,
      wetness: 0.1,
      winterSnowCoverage: 0.7,
      snowColor: "#f0f4fa",
      snowSlopeStartDeg: 25,
      snowSlopeEndDeg: 50,
      snowMinAltitude: 120,
      snowAltitudeBlend: 15,
    },
  };
}

function levelWith(worldEnvironment?: unknown): Record<string, unknown> {
  const layout: Record<string, unknown> = {
    schema: 1,
    name: "WES",
    loadGroups: [],
    instances: [],
    characters: [],
    lights: [{ id: "sun", type: "directional", position: [0, 10, 0], rotation: [-45, 30, 0] }],
  };
  if (worldEnvironment !== undefined) layout.worldEnvironment = worldEnvironment;
  return layout;
}

export function registerWorldEnvironmentTests(check: Check): void {
  check("world environment: an empty actor stays empty and resolves to the defaults", () => {
    const { environment, warnings } = normalizeWorldEnvironment({});
    assert.deepEqual(environment, {});
    assert.deepEqual(warnings, []);
    assert.deepEqual(resolveWorldEnvironment(environment), WORLD_ENVIRONMENT_DEFAULTS);
    assert.deepEqual(resolveWorldEnvironment(null), WORLD_ENVIRONMENT_DEFAULTS);
  });

  check("world environment: a maximal actor normalizes to itself without warnings", () => {
    const { environment, warnings } = normalizeWorldEnvironment(maximalWorldEnvironment());
    assert.deepEqual(warnings, []);
    assert.deepEqual(environment, maximalWorldEnvironment());
  });

  check("world environment: numbers clamp, unknown enums fall back, both with a warning", () => {
    const { environment, warnings } = normalizeWorldEnvironment({
      time: { hour: 30, dayLengthMinutes: -5 },
      sunPath: { noonElevationDeg: 120, azimuthDeg: -90 },
      night: { moonColor: "blue", ambientFloor: "x" },
      season: "monsoon",
      weather: { preset: "hail", intensity: 2 },
      surface: { snowCoverage: 1.5, snowMinAltitude: null },
    });
    assert.deepEqual(environment, {
      time: { hour: 0, dayLengthMinutes: 0 },
      sunPath: { azimuthDeg: 270, noonElevationDeg: 90 },
      weather: { intensity: 1 },
      surface: { snowCoverage: 1, snowMinAltitude: null },
    });
    for (const fragment of ["time.hour", "dayLengthMinutes", "noonElevationDeg", "moonColor", "ambientFloor", "season", "weather.preset", "weather.intensity", "snowCoverage"]) {
      assert.ok(warnings.some((warning) => warning.includes(fragment)), fragment);
    }
    assert.equal(resolveWorldEnvironment(environment).season, "summer");
    assert.equal(resolveWorldEnvironment(environment).weather.preset, "clear");
  });

  check("world environment: a sunset not after sunrise falls back to the default day", () => {
    const { environment, warnings } = normalizeWorldEnvironment({ sunPath: { sunriseHour: 18, sunsetHour: 6, azimuthDeg: 90 } });
    assert.deepEqual(environment, { sunPath: { azimuthDeg: 90 } });
    assert.equal(warnings.length, 1);
  });

  check("world environment: a non-object actor is rejected by the save, a broken group only warns", () => {
    assert.equal(normalizeWorldEnvironment("winter").environment, null);
    assert.throws(() => validateWorldEnvironment([]), /worldEnvironment must be an object/);
    const { environment, warnings } = normalizeWorldEnvironment({ time: 12, season: "autumn" });
    assert.deepEqual(environment, { season: "autumn" });
    assert.match(warnings[0]!, /time must be an object/);
  });

  check("world environment: the layout save round-trips every field and reports unknown ones (ENV-09)", () => {
    const layout = levelWith(maximalWorldEnvironment());
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.worldEnvironment, maximalWorldEnvironment());
    assert.deepEqual(collectDroppedFields(layout, saved, "layout").paths, []);

    const withUnknown = levelWith({ ...maximalWorldEnvironment(), rainbow: true, time: { hour: 3, speed: 2 } });
    assert.deepEqual(
      collectDroppedFields(withUnknown, validateLayout(withUnknown), "layout").paths,
      ["layout.worldEnvironment.time.speed", "layout.worldEnvironment.rainbow"],
    );
  });

  check("world environment: a placed actor at its defaults survives the save as {}", () => {
    const saved = validateLayout(levelWith({})) as RoomLayout;
    assert.deepEqual(saved.worldEnvironment, {});
  });

  check("world environment: a level without the actor saves byte-identically (ENV-00)", () => {
    const layout = levelWith();
    const saved = validateLayout(layout) as Record<string, unknown>;
    assert.equal("worldEnvironment" in saved, false);
    assert.equal(JSON.stringify(validateLayout(saved)), JSON.stringify(saved));
  });
}

const near = (actual: number, expected: number, epsilon = 1e-6, label = ""): void => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label} ${actual} !~ ${expected}`);
};
const nearVec = (actual: readonly number[], expected: readonly number[], epsilon = 1e-6, label = ""): void => {
  actual.forEach((value, i) => near(value, expected[i]!, epsilon, `${label}[${i}]`));
};

/** WES-003: the clock, the sun path, weather presets, resolve and the IBL policy. */
export function registerWorldEnvironmentTimeTests(check: Check): void {
  check("world environment clock: closed form, 24 h wrap, day length 0 stops it", () => {
    near(clockHour(23, 60, 24), 0); // 24 game hours per 24 real minutes: 60 s = 1 h
    near(clockHour(12, 30 * 60, 60), 0); // 30 of 60 minutes = half a day
    near(clockHour(6, 123456, 0), 6);
    near(wrapHour(-1), 23);
    const clock = new WorldClock(22, 24);
    clock.advance(3 * 60);
    near(clock.hour, 1);
    clock.advance(-50);
    clock.advance(Number.NaN);
    near(clock.hour, 1);
    clock.setDayLength(48);
    near(clock.hour, 1, 1e-9, "day length change keeps the hour");
    clock.advance(120);
    near(clock.hour, 2);
  });

  check("world environment clock: 30/60/144 Hz updates reach the same hour (ENV-14)", () => {
    const hours = [30, 60, 144].map((hz) => {
      const clock = new WorldClock(5.5, 7);
      for (let frame = 0; frame < hz * 90; frame += 1) clock.advance(1 / hz);
      return clock.hour;
    });
    near(hours[0]!, clockHour(5.5, 90, 7), 1e-9);
    near(hours[1]!, hours[0]!, 1e-9);
    near(hours[2]!, hours[0]!, 1e-9);
  });

  check("world environment sun path: 06/12/18 directions follow the art-directed path", () => {
    const path = WORLD_ENVIRONMENT_DEFAULTS.sunPath; // azimuth 180, noon 60, 6..18
    nearVec(directionFromAngles(sunAngles(12, path).azimuthDeg, sunAngles(12, path).elevationDeg),
      [0, Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)], 1e-9, "noon");
    const sunrise = sunAngles(6, path);
    near(sunrise.elevationDeg, 0, 1e-9);
    near(sunrise.azimuthDeg, 90, 1e-9);
    const sunset = sunAngles(18, path);
    near(sunset.elevationDeg, 0, 1e-9);
    near(sunset.azimuthDeg, 270, 1e-9);
    near(sunAngles(0, path).elevationDeg, -60, 1e-9, "midnight is the lowest point");
    near(sunAngles(9, path).elevationDeg, 60 * Math.sin(Math.PI / 4), 1e-9);
  });

  check("world environment sun path: nothing jumps at midnight or at the horizon", () => {
    const path = { azimuthDeg: 40, noonElevationDeg: 50, sunriseHour: 5, sunsetHour: 21 };
    const env = { ...WORLD_ENVIRONMENT_DEFAULTS, sunPath: path };
    for (const hour of [0, path.sunriseHour, path.sunsetHour]) {
      const before = sunAngles(hour - 1e-6, path);
      const after = sunAngles(hour + 1e-6, path);
      near(before.elevationDeg, after.elevationDeg, 1e-3, `elevation @${hour}`);
      near(angleBetweenDeg(directionFromAngles(before.azimuthDeg, 0), directionFromAngles(after.azimuthDeg, 0)), 0, 1e-3, `azimuth @${hour}`);
      // The light is dark exactly where it switches between sun and moon.
      if (hour !== 0) near(evaluateSunLight(hour, env).intensityFactor, 0, 1e-9, `dark @${hour}`);
    }
    const noon = evaluateSunLight(13, env);
    near(noon.intensityFactor, 1, 1e-9, "identity at a high sun");
    nearVec(noon.color, [1, 1, 1], 1e-9);
    assert.equal(noon.isMoon, false);
    const night = evaluateSunLight(1, env);
    assert.equal(night.isMoon, true);
    near(night.intensityFactor, env.night.moonIntensity, 1e-9);
    assert.ok(night.sunDirection[1] < 0, "the sky sees the sun below the horizon at night");
    assert.ok(night.lightDirection[1] > 0, "the moon light shines from above");
    const low = evaluateSunLight(5.2, env);
    assert.ok(low.lightDirection[1] >= Math.sin((MIN_LIGHT_ELEVATION_DEG * Math.PI) / 180) - 1e-9, "light never shadows from below 4°");
  });

  check("world environment sun path: the three-free Sun rotation matches three.js", () => {
    for (const rotation of [[-45, 30, 0], [-70, -120, 10], [-10, 200, 0], [20, 15, 30]] as Vec3[]) {
      const three = sunDirectionFromLightRotation(rotation);
      nearVec(sunDirectionFromRotation(rotation), [three.x, three.y, three.z], 1e-9, String(rotation));
    }
  });

  check("world environment sun path: the inverse from a Sun rotation round-trips (ENV-00b)", () => {
    for (const rotation of [[-45, 30, 0], [60, -120, 0], [20, 200, 0], [-89, 10, 0]] as Vec3[]) {
      const direction = sunDirectionFromRotation(rotation);
      const derived = deriveSunPathFromDirection(direction, WORLD_ENVIRONMENT_DEFAULTS.sunPath);
      const angles = sunAngles(derived.hour, derived.sunPath);
      nearVec(directionFromAngles(angles.azimuthDeg, angles.elevationDeg), direction, 1e-9, String(rotation));
      // What the editor stores (rounded like a save) still lands within a hundredth of a degree.
      const stored = resolveWorldEnvironment(initialWorldEnvironmentForSun(rotation));
      const storedAngles = sunAngles(stored.time.hour, stored.sunPath);
      assert.ok(angleBetweenDeg(directionFromAngles(storedAngles.azimuthDeg, storedAngles.elevationDeg), direction) < 0.01);
    }
    assert.deepEqual(initialWorldEnvironmentForSun(null), {});
    // A Sun below the horizon has no matching hour on the path; it is lifted to 1°.
    const below = deriveSunPathFromDirection(sunDirectionFromRotation([30, 0, 0]), WORLD_ENVIRONMENT_DEFAULTS.sunPath);
    near(sunAngles(below.hour, below.sunPath).elevationDeg, 1, 1e-9);
  });

  check("world environment weather: clear and intensity 0 are the identity", () => {
    const identity = weatherFactors("clear", 1);
    assert.deepEqual(weatherFactors("rain", 0), { ...identity, fogTint: weatherFactors("rain", 0).fogTint });
    assert.equal(identity.cloudCoverageMin, null);
    assert.equal(identity.fogDensityMultiplier, 1);
    assert.equal(identity.sunIntensityMultiplier, 1);
    assert.equal(identity.skyTurbidityAdd, 0);
    const half = weatherFactors("rain", 0.5);
    near(half.fogDensityMultiplier, 1.75);
    near(half.sunIntensityMultiplier, 0.675);
    assert.deepEqual(weatherPresetRequirements("cloudy"), ["cloudLayer", "heightFog", "skyAtmosphere"]);
    assert.deepEqual(weatherPresetRequirements("clear"), []);
  });

  check("world environment resolve: summer + clear at a high sun is the authored look", () => {
    const fog = resolveHeightFog({ color: "#445566", density: 0.02 });
    const cloud = resolveCloudLayer({ color: "#eeeeff", coverage: 0.3 });
    const authored = { sun: { color: "#ffffff", intensity: 3 }, sky: { turbidity: 2, hidden: false }, fog, cloud };
    const resolved = resolveEnvironment(authored, WORLD_ENVIRONMENT_DEFAULTS, stateFromDefaults(WORLD_ENVIRONMENT_DEFAULTS));
    assert.deepEqual(resolved.fog, fog);
    assert.deepEqual(resolved.cloud, cloud);
    assert.equal(resolved.skyTurbidity, 2);
    near(resolved.light!.intensity, 3);
    nearVec(resolved.light!.color, [1, 1, 1]);
    near(resolved.ambientMultiplier, 1);
    near(resolved.exposureMultiplier, 1);

    const noActors = resolveEnvironment({ sun: null, sky: null, fog: null, cloud: null }, WORLD_ENVIRONMENT_DEFAULTS, stateFromDefaults(WORLD_ENVIRONMENT_DEFAULTS));
    assert.equal(noActors.light, null);
    assert.equal(noActors.fog, null);
    assert.equal(noActors.cloud, null, "WES never invents a missing actor (§7.2)");
    assert.equal(noActors.skyTurbidity, null);
  });

  check("world environment resolve: night and weather adjust without touching the inputs", () => {
    const fog = resolveHeightFog({ color: "#445566", density: 0.02 });
    const cloud = resolveCloudLayer({ coverage: 0.3 });
    const authored = { sun: { color: "#ffffff", intensity: 3 }, sky: { turbidity: 2, hidden: false }, fog, cloud };
    const snapshot = structuredClone(authored);
    const night = resolveEnvironment(authored, WORLD_ENVIRONMENT_DEFAULTS, { ...stateFromDefaults(WORLD_ENVIRONMENT_DEFAULTS), hour: 0 });
    assert.equal(night.light!.isMoon, true);
    near(night.ambientMultiplier, WORLD_ENVIRONMENT_DEFAULTS.night.ambientFloor);
    assert.ok(night.exposureMultiplier > 1);
    assert.notEqual(night.fog!.color, fog.color);
    const rain = resolveEnvironment(authored, WORLD_ENVIRONMENT_DEFAULTS, {
      ...stateFromDefaults(WORLD_ENVIRONMENT_DEFAULTS), weather: { preset: "rain", intensity: 1 },
    });
    near(rain.cloud!.coverage, 0.9);
    near(rain.fog!.density, 0.05);
    near(rain.light!.intensity, 3 * 0.35);
    assert.equal(rain.skyTurbidity, 10);
    assert.notEqual(rain.captureKey, night.captureKey);
    assert.deepEqual(authored, snapshot);
  });

  check("world environment recapture: 3° or a new key, 2 s apart, never while scrubbing (ENV-18)", () => {
    const north: Vec3 = [0, 0.5, 0.866];
    const last = { sunDirection: north, captureKey: "clear:0:summer", timeMs: 1000 };
    const rotated = (deg: number): Vec3 => directionFromAngles(deg, 30);
    assert.equal(shouldRecapture(null, { sunDirection: north, captureKey: "k", nowMs: 0 }), true);
    assert.equal(shouldRecapture(last, { sunDirection: north, captureKey: "clear:0:summer", nowMs: 99999 }), false);
    assert.equal(shouldRecapture(last, { sunDirection: rotated(2), captureKey: "clear:0:summer", nowMs: 99999 }), false);
    assert.equal(shouldRecapture(last, { sunDirection: rotated(3.5), captureKey: "clear:0:summer", nowMs: 2500 }), false);
    assert.equal(shouldRecapture(last, { sunDirection: rotated(3.5), captureKey: "clear:0:summer", nowMs: 3000 }), true);
    assert.equal(shouldRecapture(last, { sunDirection: north, captureKey: "rain:1:summer", nowMs: 3000 }), true);
    assert.equal(shouldRecapture(last, { sunDirection: rotated(40), captureKey: "k", nowMs: 99999, scrubbing: true }), false);
    assert.equal(shouldRecapture(last, { sunDirection: rotated(40), captureKey: "k", nowMs: 1100, immediate: true }), true);
  });
}
