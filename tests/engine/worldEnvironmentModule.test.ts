/**
 * World Environment K1 — the Play clock (WES-005). The capability starts from
 * the level defaults, advances on the simulation delta (so `TimeControl` pause
 * holders stop the day and time scale speeds it up), publishes the live state
 * as a service and drops it on Level Travel. Without an active actor there is
 * no state, which the shell renders as the authored look.
 */
import assert from "node:assert/strict";

import { TimeControl } from "../../engine/core/timeControl";
import { WorldEnvironmentController } from "../../engine/environment/worldEnvironmentController";
import type { RoomLayout } from "../../engine/scene/layout";
import { createWorldEnvironmentModule } from "../../src/scene/capabilities/worldEnvironmentModule";
import { worldEnvironmentService } from "../../src/scene/capabilities/runtimeServiceKeys";
import type { RuntimeServices } from "../../src/scene/capabilities/RuntimeServices";
import type { RuntimeContext } from "../../src/scene/capabilities/RuntimeContext";

type Check = (label: string, fn: () => void) => void;

function boot(worldEnvironment?: RoomLayout["worldEnvironment"]) {
  const module = createWorldEnvironmentModule();
  let controller: WorldEnvironmentController | null = null;
  module.onRuntimeStart?.({
    provide: (key: unknown, value: unknown) => {
      if (key === worldEnvironmentService) controller = value as WorldEnvironmentController;
    },
  } as unknown as RuntimeServices);
  const layout = { schema: 1, name: "wes", loadGroups: [], instances: [], characters: [], worldEnvironment } as RoomLayout;
  void module.onLevelLoaded?.({ layout } as unknown as RuntimeContext);
  assert.ok(controller, "the module publishes the world environment service");
  return { module, controller: controller as WorldEnvironmentController };
}

export function registerWorldEnvironmentModuleTests(check: Check): void {
  check("world environment module: Play starts from the level defaults and the clock runs on simulation time", () => {
    // 24 real minutes per day: one simulated minute is one game hour.
    const { module, controller } = boot({ time: { hour: 6, dayLengthMinutes: 24 }, weather: { preset: "rain", intensity: 0.5 } });
    assert.equal(controller.current()?.hour, 6);
    assert.deepEqual(controller.current()?.weather, { preset: "rain", intensity: 0.5 });
    const time = new TimeControl();
    for (let i = 0; i < 60; i += 1) module.update?.(time.simulationDelta(1));
    assert.ok(Math.abs(controller.current()!.hour - 7) < 1e-9);
  });

  check("world environment module: TimeControl pause holders stop the clock and time scale speeds it (ENV-06)", () => {
    const { module, controller } = boot({ time: { hour: 22, dayLengthMinutes: 24 } });
    const time = new TimeControl();
    time.pause("menu");
    for (let i = 0; i < 600; i += 1) module.update?.(time.simulationDelta(1 / 60));
    assert.equal(controller.current()!.hour, 22, "a paused game does not move the sun");
    time.resume("menu");
    time.setTimeScale(4);
    for (let i = 0; i < 60 * 30; i += 1) module.update?.(time.simulationDelta(1 / 60));
    // 30 s at 4x = 2 simulated minutes = 2 game hours, wrapped past midnight.
    assert.ok(Math.abs(controller.current()!.hour - 0) < 1e-6 || Math.abs(controller.current()!.hour - 24) < 1e-6);
    const revision = controller.revision;
    module.update?.(0);
    assert.equal(controller.revision, revision, "an idle frame is not a change");
  });

  check("world environment module: no actor, a hidden one or Level Travel leaves no state", () => {
    assert.equal(boot(undefined).controller.current(), null);
    assert.equal(boot({ hidden: true }).controller.current(), null);
    const { module, controller } = boot({ time: { hour: 9 } });
    assert.equal(controller.active, true);
    module.onLevelUnloaded?.();
    assert.equal(controller.current(), null);
    assert.throws(() => controller.getState(), /no active World Environment/);
  });

  check("world environment service: gameplay changes the state and listeners hear it", () => {
    const { controller } = boot({});
    const heard: string[] = [];
    const off = controller.onChanged((state) => heard.push(`${state.hour}:${state.season}:${state.weather.preset}`));
    controller.setHour(25);
    controller.setSeason("winter");
    controller.setWeather("snow", 3);
    controller.setSurface({ snowCoverage: 2, wetness: Number.NaN });
    controller.setSeason("monsoon" as never);
    off();
    controller.setHour(3);
    assert.deepEqual(heard, ["1:summer:clear", "1:winter:clear", "1:winter:snow", "1:winter:snow"]);
    assert.deepEqual(controller.getState().weather, { preset: "snow", intensity: 1 });
    assert.deepEqual(controller.getState().surface, { snowCoverage: 1, wetness: 0 });
    assert.equal(controller.getState().hour, 3);
  });
}
