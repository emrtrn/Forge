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
