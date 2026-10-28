/**
 * Layer 2 capability: runtime tracks in soft terrain (TERRAIN_DEFORMATION Faz 2).
 *
 * Owns the CPU {@link DeformationField} — a toroidal window that follows the
 * player's vehicle — and stamps every vehicle wheel standing on a deformable
 * paint layer into it, then mirrors the changed cells into the terrain
 * material's track texture. Snow tracks refill at their layer's rate; mud ones
 * stay while the window holds them.
 *
 * It also hands physics the track depth under each wheel (Faz 3 sinkage): the
 * wheels settle into their ruts through shorter rest lengths, never through a
 * rebuilt terrain collider.
 *
 * Switching the module off removes persistent tracks; load sinkage, local digging, grip and drag come
 * from the paint layers' physical materials through the shell's surface
 * provider, which runs with or without this module. Nothing here is written to
 * the level; the field is runtime state only.
 *
 * Beside the field it keeps the wet tyre prints ({@link TerrainWetTrail}): a
 * tyre that stood in a Lake or on its wet shore (the surface host's
 * `wetTrailSourceAt`, with that Lake's trail settings) or in a rut puddle
 * wets the next few metres of ground it rolls over. Presentation only.
 */
import type { Subsystem } from "@engine/core/Subsystem";
import type { VehicleGroundSinkProvider } from "@engine/physics/surface/surfaceResponse";
import { wheelFootprintDepth } from "@engine/physics/surface/wheelSink";
import { rutSlopeAhead, WheelTrackStamper } from "@engine/physics/surface/wheelTracks";
import type { VehicleState } from "@engine/physics/vehicle/vehicleTypes";
import { sharedTerrainDeformation, type TerrainDeformationTexture } from "@engine/render-three/terrain/terrainDeformation";
import { DeformationField } from "@engine/scene/deformationField";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import type { TerrainWaterContact } from "@engine/render-three/terrain/terrainWaterState";
import { TerrainWetTrail, type TerrainWetTrailContact } from "@engine/render-three/terrain/terrainWetTrail";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  terrainDeformationService,
  terrainSurfaceHostService,
  vehicleHostService,
  type TerrainDeformationSnapshot,
} from "./runtimeServiceKeys";

export const TERRAIN_DEFORMATION_MODULE_ID = "terrain-deformation";

/** Profile wetness and rut depth (m) of a rut puddle that soaks a tyre (the puddle shading's thresholds). */
const PUDDLE_WETNESS = 0.4;
const PUDDLE_DEPTH = 0.03;

export interface TerrainDeformationModuleOptions {
  /** GPU mirror to drive (default: the page's shared texture every terrain material samples). */
  texture?: TerrainDeformationTexture;
  /** Window edge (m) and cell size (m); default 64 m at 12.5 cm. */
  windowSize?: number;
  cellSize?: number;
}

/** Ground centre of a vehicle: the mean of its wheels' world hard points. */
function vehicleCentre(state: VehicleState): [number, number] | null {
  let x = 0, z = 0, count = 0;
  for (const wheel of state.wheels) {
    if (!wheel.hardPoint) continue;
    x += wheel.hardPoint[0];
    z += wheel.hardPoint[2];
    count += 1;
  }
  return count > 0 ? [x / count, z / count] : null;
}

export function createTerrainDeformationModule(options: TerrainDeformationModuleOptions = {}): CapabilityModule {
  const texture = options.texture ?? sharedTerrainDeformation();
  let services: RuntimeServices | null = null;
  let field: DeformationField | null = null;
  let stamper: WheelTrackStamper | null = null;
  let trail: TerrainWetTrail | null = null;
  let stampedWheels = 0;
  let centre: [number, number] = [0, 0];
  let sinkInstalled = false;
  let unsubscribePhysics: (() => void) | null = null;

  /** Physics sees the CPU field stamped after the preceding fixed slice. */
  const groundSink: VehicleGroundSinkProvider = (query) => {
    const active = field;
    const surface = services?.resolve(terrainSurfaceHostService);
    if (!active || !surface || query.groundEntityId === null) return null;
    const [x, , z] = query.contactPoint;
    const depthAt = (sx: number, sz: number) => active.sample(sx, sz).depth;
    const depth = wheelFootprintDepth(depthAt, x, z, query.heading, query.width);
    if (depth <= 0) return null;
    const profile = surface.deformationAt(query.groundEntityId, query.contactPoint);
    if (!profile) return null;
    const slope = rutSlopeAhead(depthAt, x, z, query.heading, query.width, query.radius ?? 0, depth, query.travel ?? 0);
    return { depth, resistance: profile.sinkResistance, slope };
  };

  /** Created on the first frame a deformable terrain exists, so track-free levels never allocate it. */
  const ensureField = (): DeformationField => {
    if (!field) {
      field = new DeformationField({
        ...(options.windowSize === undefined ? {} : { windowSize: options.windowSize }),
        ...(options.cellSize === undefined ? {} : { cellSize: options.cellSize }),
      });
      stamper = new WheelTrackStamper(field);
      field.recenter(centre[0], centre[1]);
      trail = new TerrainWetTrail(field.cellsPerSide, field.cellSize);
      trail.setOrigin(...field.originCell);
      texture.attach(field, trail);
    }
    return field;
  };

  const release = (): void => {
    if (sinkInstalled) services?.resolve(vehicleHostService)?.setGroundSinkProvider?.(null);
    sinkInstalled = false;
    field = null;
    stamper = null;
    trail = null;
    stampedWheels = 0;
    texture.detach();
  };

  const tick = (deltaSeconds: number): void => {
    const surface = services?.resolve(terrainSurfaceHostService);
    const vehicles = services?.resolve(vehicleHostService);
    if (!surface || !vehicles || !surface.hasDeformableTerrain()) {
      if (field) release();
      return;
    }
    const active = ensureField();
    if (!sinkInstalled && vehicles.setGroundSinkProvider) {
      vehicles.setGroundSinkProvider(groundSink);
      sinkInstalled = true;
    }
    // The window follows the player's car; otherwise the first live vehicle.
    const ids = vehicles.vehicleIds();
    const possessed = vehicles.possessedEntityId();
    const focusId = possessed && ids.includes(possessed) ? possessed : ids[0];
    const focusState = focusId ? vehicles.vehicleState(focusId) : null;
    const focus = focusState ? vehicleCentre(focusState) : null;
    if (focus) {
      centre = focus;
      active.recenter(focus[0], focus[1]);
    }
    trail!.setOrigin(...active.originCell);
    stampedWheels = 0;
    const waterContacts: TerrainWaterContact[] = [];
    const trailContacts: TerrainWetTrailContact[] = [];
    for (const id of ids) {
      const state = vehicles.vehicleState(id);
      if (!state) {
        stamper!.forget(id);
        continue;
      }
      stampedWheels += stamper!.stampVehicle(
        id, state, vehicles.vehicleDefinition(id),
        (ground, point) => surface.deformationAt(ground, point), deltaSeconds,
      );
      const definition = vehicles.vehicleDefinition(id);
      state.wheels.forEach((wheel, index) => {
        if (!wheel.inContact || !wheel.contactPoint || wheel.groundEntityId === null) return;
        const profile = surface.deformationAt(wheel.groundEntityId, wheel.contactPoint);
        const [x, y, z] = wheel.contactPoint;
        const width = vehicleWheelWidth(definition?.wheels[index] ?? wheel);
        waterContacts.push({ id: `${id}:${index}`, x, y, z, radius: wheel.radius,
          rotation: wheel.rotation, tractionSlip: wheel.tractionSlip,
          width, wetness: profile?.wetness ?? 0 });
        const source = surface.wetTrailSourceAt?.(x, y, z) ?? null;
        const inPuddle = (profile?.wetness ?? 0) > PUDDLE_WETNESS && active.sample(x, z).depth > PUDDLE_DEPTH;
        trailContacts.push({ id: `${id}:${index}`, x, z, width, inWater: source !== null || inPuddle,
          settings: source ?? undefined });
      });
    }
    trail!.advance(deltaSeconds, trailContacts);
    texture.water.advance(deltaSeconds, waterContacts, centre, active);
    active.recover(deltaSeconds);
  };

  const subsystem: Subsystem = {
    id: "terrainDeformation",
    update: () => {
      // Rendering uploads only. No stamps, digging or recovery on render time.
      if (field) texture.update([...field.takeDirty(), ...(trail?.takeDirty() ?? [])]);
    },
  };

  return {
    id: TERRAIN_DEFORMATION_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      unsubscribePhysics = runtimeServices.resolve(vehicleHostService)?.onPhysicsStep?.(tick) ?? null;
      runtimeServices.addSubsystem("presentation", subsystem);
      runtimeServices.provide(terrainDeformationService, {
        stamp(worldX, worldZ, radius, depth) {
          if (!field) return;
          field.stampDisc([worldX, worldZ], radius, depth);
        },
        sample(worldX, worldZ) {
          return field ? field.sample(worldX, worldZ) : { depth: 0, disturbance: 0 };
        },
        snapshot(): TerrainDeformationSnapshot | null {
          if (!field) return null;
          const { activeCellCount, maxDepth } = field.stats();
          const { uploadedTexels, packMs } = texture.stats();
          return { activeCells: activeCellCount, maxDepth, stampedWheels, uploadedTexels, packMs, centre: [...centre],
            water: texture.water.stats(), wetTrailCells: trail?.activeCellCount ?? 0 };
        },
      });
    },

    onLevelUnloaded() {
      // Level Travel: tracks belong to the level that made them.
      release();
    },

    dispose() {
      unsubscribePhysics?.();
      unsubscribePhysics = null;
      release();
      services = null;
    },
  };
}
