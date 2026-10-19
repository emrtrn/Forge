/**
 * Layer 2 capability: AI drivers for ray-cast vehicles (vehicle plan Faz 4).
 *
 * A `Vehicle` actor that also carries a `VehicleAiDriver` component is driven
 * along a Generic Spline by {@link stepVehicleRouteDriver}: pure-pursuit
 * steering, a cruise speed that eases off for bends, a stop at the end of an
 * open route. The driver produces the same pedals and steering a player does
 * and hands them to physics — the car is never moved by hand, so it collides,
 * can be shoved and recovers like any other car.
 *
 * It ticks in the `decision` slot, as AI does: physics is fixed-step, so the
 * input set here is what the next slices drive with, the same frame a player's
 * keys would land.
 *
 * The player outranks the AI. A car the player possesses is left alone, and
 * once the player has driven it the AI lets it go for good — as in Unreal,
 * possessing a pawn unpossesses its AI controller, and nothing hands it back.
 * A car whose spline is missing waits (and says so in `?debug`); a car whose
 * route ended parks on its handbrake.
 *
 * Switched off, AI cars are ordinary parked vehicles: still physical, still
 * enterable, just nobody at the wheel.
 */
import { Quaternion, Vector3 } from "three";

import {
  DEFAULT_VEHICLE_ROUTE_DRIVER,
  startVehicleRoute,
  stepVehicleRouteDriver,
  type VehicleRoute,
  type VehicleRouteDriverState,
} from "@engine/physics/vehicle/vehicleRouteDriver";
import { NEUTRAL_VEHICLE_INPUT } from "@engine/physics/vehicle/vehicleTypes";
import type { EngineUpdateContext, Subsystem } from "@engine/core/Subsystem";
import {
  readVehicleAiDriverComponent,
  type VehicleAiDriverComponent,
} from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { SplineQuery } from "@engine/scene/splineRegistry";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  splineRegistrySourceService,
  vehicleAiService,
  vehicleHostService,
  type VehicleAiDriverDebugState,
} from "./runtimeServiceKeys";

export const VEHICLE_AI_MODULE_ID = "vehicle-ai";

interface DriverRecord {
  readonly entityId: string;
  readonly component: VehicleAiDriverComponent;
  /** Progress along the route; null until the car first joins it. */
  state: VehicleRouteDriverState | null;
  /** The player took the wheel: the AI never drives this car again. */
  released: boolean;
  missingRoute: boolean;
  speedLimit: number;
  finished: boolean;
  /** Pressing the pedals this tick (false while waiting, released or switched off). */
  driving: boolean;
}

/** Adapts a spline query to the route the driver follows (world space). */
function splineRoute(query: SplineQuery, component: VehicleAiDriverComponent): VehicleRoute {
  return {
    length: query.getLength(),
    loop: component.wrapMode ? component.wrapMode === "loop" : query.isClosed(),
    locationAt: (distance) => query.getLocationAtDistance(distance, "world"),
    directionAt: (distance) => query.getDirectionAtDistance(distance, "world"),
    closestDistanceTo: (point) => query.getClosestDistanceToPoint(point, "world"),
  };
}

export function createVehicleAiModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  const drivers = new Map<string, DriverRecord>();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const forward = new Vector3();

  const setEntities = (entities: readonly Entity[]): void => {
    drivers.clear();
    for (const entity of entities) {
      const component = readVehicleAiDriverComponent(entity);
      if (!component) continue;
      drivers.set(entity.id, {
        entityId: entity.id,
        component,
        state: null,
        released: false,
        missingRoute: false,
        speedLimit: 0,
        finished: false,
        driving: false,
      });
    }
  };

  const drive = (record: DriverRecord): void => {
    record.driving = false;
    const host = services?.resolve(vehicleHostService);
    if (!host || record.released || !record.component.enabled) return;
    if (host.possessedEntityId() === record.entityId) {
      record.released = true;
      return;
    }
    if (!host.vehicleIds().includes(record.entityId)) return;
    const query = services?.resolve(splineRegistrySourceService)?.()?.getSplineById(record.component.splineId);
    record.missingRoute = !query;
    const definition = host.vehicleDefinition(record.entityId);
    const state = host.vehicleState(record.entityId);
    const object = host.actorObject(record.entityId);
    if (!query || !definition || !state || !object) return;

    object.getWorldPosition(position);
    object.getWorldQuaternion(quaternion);
    forward.set(0, 0, 1).applyQuaternion(quaternion);
    const flat = Math.hypot(forward.x, forward.z);
    if (!(flat > 1e-3)) return; // nose straight up/down: nothing sensible to steer
    const route = splineRoute(query, record.component);
    const at: [number, number, number] = [position.x, position.y, position.z];
    record.state ??= startVehicleRoute(route, at, record.component.entry);
    const step = stepVehicleRouteDriver(
      route,
      record.state,
      { position: at, heading: { x: forward.x / flat, z: forward.z / flat } },
      state.forwardSpeed,
      definition,
      {
        ...DEFAULT_VEHICLE_ROUTE_DRIVER,
        targetSpeed: record.component.targetSpeed,
        lookAheadDistance: record.component.lookAheadDistance,
      },
    );
    record.state = step.state;
    record.speedLimit = step.speedLimit;
    record.finished = step.finished;
    record.driving = !step.finished;
    host.setVehicleInput(record.entityId, step.input);
  };

  const subsystem: Subsystem = {
    id: "vehicleAi",
    update(_context: EngineUpdateContext) {
      for (const record of drivers.values()) drive(record);
    },
  };

  return {
    id: VEHICLE_AI_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      runtimeServices.addSubsystem("decision", subsystem);
      runtimeServices.addEntitySink({ setEntities });
      runtimeServices.provide(vehicleAiService, {
        isDriving: (entityId) => drivers.get(entityId)?.driving === true,
        drivers: (): VehicleAiDriverDebugState[] =>
          [...drivers.values()].map((record) => ({
            entityId: record.entityId,
            splineId: record.component.splineId,
            distance: record.state?.distance ?? 0,
            speedLimit: record.speedLimit,
            driving: record.driving,
            finished: record.finished,
            released: record.released,
            missingRoute: record.missingRoute,
          })),
      });
    },

    onLevelUnloaded() {
      // Leave the cars as they were found: nobody pressing the pedals.
      const host = services?.resolve(vehicleHostService);
      for (const record of drivers.values()) {
        if (record.driving) host?.setVehicleInput(record.entityId, NEUTRAL_VEHICLE_INPUT);
      }
      drivers.clear();
    },

    dispose() {
      drivers.clear();
      services = null;
    },
  };
}
