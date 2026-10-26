import assert from "node:assert/strict";
import type { Subsystem } from "../../engine/core/Subsystem";
import { nominalWheelLoad, sinkage } from "../../engine/physics/surface/sinkage";
import {
  frameCompaction, RUT_LOOKAHEAD_MARGIN, rutSlopeAhead, vehicleHeading, wheelContactLength, WheelTrackStamper,
  type WheelDeformationLookup,
} from "../../engine/physics/surface/wheelTracks";
import {
  createReferenceCarDefinition, type VehicleDefinition, type VehicleState, type VehicleWheelState,
} from "../../engine/physics/vehicle/vehicleTypes";
import {
  TerrainDeformationTexture, terrainDeformationLayerUniforms, TERRAIN_DEFORMATION_DEPTH_RANGE,
} from "../../engine/render-three/terrain/terrainDeformation";
import type { VehicleGroundSinkProvider } from "../../engine/physics/surface/surfaceResponse";
import { PHYSICAL_MATERIALS } from "../../engine/scene/collision";
import { DEFORMATION_DEPTH_SCALE, DEFORMATION_RECOVERY_STEP_SECONDS, DeformationField } from "../../engine/scene/deformationField";
import { TerrainSurfaceSampler, type SurfaceDeformationSample } from "../../engine/terrain/terrainSurface";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  terrainDeformationService, terrainSurfaceHostService, vehicleHostService, type VehicleHost,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import { createTerrainDeformationModule } from "../../src/scene/capabilities/terrainDeformationModule";
import { formatTerrainDeformationDebug } from "../../src/scene/debugStats";

type Check = (label: string, fn: () => void) => void;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

/**
 * TERRAIN_DEFORMATION Faz 2 wiring: wheels → field (per-cell recovery,
 * frame-rate-independent compaction, swept tracks) → GPU mirror, and the
 * capability module that runs it each frame.
 */

const MUD = PHYSICAL_MATERIALS.mud!.deformation!;
const SNOW = PHYSICAL_MATERIALS.snow!.deformation!;
const mud: SurfaceDeformationSample = {
  deformability: 1, maxDepth: MUD.maxDepth, compaction: MUD.compaction, digRate: MUD.digRate,
  recoveryRate: MUD.recoveryRate, sinkResistance: MUD.sinkResistance,
  wetness: MUD.wetness,
};
const snow: SurfaceDeformationSample = {
  deformability: 1, maxDepth: SNOW.maxDepth, compaction: SNOW.compaction, digRate: SNOW.digRate,
  recoveryRate: SNOW.recoveryRate, sinkResistance: SNOW.sinkResistance,
};

/** A reference car at (x, z) heading +Z, every wheel on `ground` with the static load. */
function carState(definition: VehicleDefinition, x: number, z: number, ground: string | null = "landscape:t:0_0", steering = 0): VehicleState {
  const load = nominalWheelLoad(definition);
  return {
    forwardSpeed: 0, engineLoad: 0, drivetrain: null,
    wheels: definition.wheels.map((wheel): VehicleWheelState => ({
      position: wheel.position, radius: wheel.radius, suspensionLength: wheel.suspensionRestLength, suspensionForce: load,
      steering: wheel.steer ? steering : 0, rotation: 0, inContact: ground !== null, groundEntityId: ground,
      contactPoint: ground === null ? null : [x + wheel.position[0], 0, z + wheel.position[2]],
      hardPoint: [x + wheel.position[0], wheel.position[1], z + wheel.position[2]],
    })),
  };
}

const onMud: WheelDeformationLookup = () => mud;

export function registerWheelTrackTests(check: Check): void {
  check("deformation field: per-cell recovery refills snow tracks and keeps mud ones", () => {
    const field = new DeformationField();
    field.stampDisc([2, 0], 0.5, 0.1);
    const stamp = { width: 0.5, contactLength: 0.5, targetDepth: 0.1, compaction: 1, disturbance: 200 };
    field.stampWheel({ ...stamp, from: [-2, 0], to: [-2, 0], recoveryRate: MUD.recoveryRate });
    field.stampWheel({ ...stamp, from: [0, 0], to: [0, 0], recoveryRate: SNOW.recoveryRate });
    // Under one step nothing moves; the leftover carries to the next call.
    assert.equal(field.recover(DEFORMATION_RECOVERY_STEP_SECONDS / 2), 0);
    field.recover(DEFORMATION_RECOVERY_STEP_SECONDS / 2);
    close(field.sample(0, 0).depth, 0.1 - SNOW.recoveryRate * DEFORMATION_RECOVERY_STEP_SECONDS, 1e-4);
    close(field.sample(-2, 0).depth, 0.1, 1e-4);
    close(field.sample(2, 0).depth, 0.1, 1e-4);
    // A long pause refills at most three steps at once, then the snow empties out.
    field.recover(100);
    close(field.sample(0, 0).depth, 0.1 - SNOW.recoveryRate * DEFORMATION_RECOVERY_STEP_SECONDS * 4, 1e-4);
    for (let index = 0; index < 40; index += 1) field.recover(DEFORMATION_RECOVERY_STEP_SECONDS);
    assert.equal(field.sample(0, 0).depth, 0);
    assert.equal(field.sample(0, 0).disturbance, 0, "tint clears with the depth");
    close(field.sample(-2, 0).depth, 0.1, 1e-4);
    assert.ok(field.recovery.some((rate) => rate === 0) && !field.recovery.some((rate) => rate === 10),
      "emptied snow cells drop their rate");
  });

  check("wheel tracks: compaction per frame is rescaled so 30 and 144 fps end equally deep", () => {
    close(frameCompaction(0.5, 1 / 60), 0.5);
    close(frameCompaction(0.5, 1 / 30), 0.75);
    close(frameCompaction(1, 1 / 30), 1);
    assert.equal(frameCompaction(0, 1 / 60), 0);
    assert.equal(frameCompaction(0.5, 0), 0);
    const depthAfter = (fps: number) => {
      const field = new DeformationField();
      for (let frame = 0; frame < fps / 2; frame += 1) {
        field.stampWheel({ from: [0, 0], to: [0, 0], width: 0.3, contactLength: 0.3, targetDepth: 0.2,
          compaction: frameCompaction(0.1, 1 / fps), disturbance: 255 });
      }
      return field.sample(0, 0).depth;
    };
    // Half a second either way. Each call floors to 0.1 mm, so the 72 calls at
    // 144 fps can lose up to one quantum each against the 15 at 30 fps.
    close(depthAfter(30), depthAfter(144), 72 / DEFORMATION_DEPTH_SCALE);
    assert.ok(wheelContactLength(0.35, 0) > 0 && wheelContactLength(0.35, 0.1) > wheelContactLength(0.35, 0.01));
  });

  check("wheel tracks: a car driving straight over mud leaves gapless ruts at sinkage depth, hard ground none", () => {
    const definition = createReferenceCarDefinition();
    const field = new DeformationField();
    const stamper = new WheelTrackStamper(field);
    assert.equal(vehicleHeading(carState(definition, 0, 0)), 0);
    close(vehicleHeading(carState(definition, 0, 0, "g", 0))!, 0);
    // 20 m/s at 30 fps: 0.67 m between calls, wider than a footprint.
    for (let frame = 0; frame <= 30; frame += 1) {
      field.recenter(0, frame * 0.67);
      stamper.stampVehicle("car", carState(definition, 0, frame * 0.67), definition, onMud, 1 / 30);
    }
    const expected = sinkage(mud, 1, { load: nominalWheelLoad(definition), nominalLoad: nominalWheelLoad(definition), width: 0.25 });
    const wheelX = definition.wheels[0]!.position[0];
    let shallowest = Infinity;
    for (let z = 3; z < 18; z += 0.05) shallowest = Math.min(shallowest, field.sample(wheelX, z).depth);
    assert.ok(shallowest > expected * 0.5, `rut never breaks: shallowest ${shallowest} vs target ${expected}`);
    assert.ok(field.stats().maxDepth <= expected + 1e-4, "never past the static sinkage");
    assert.equal(field.sample(0, 10).depth, 0, "between the wheels stays untouched");

    const hard = new DeformationField();
    const hardStamper = new WheelTrackStamper(hard);
    assert.equal(hardStamper.stampVehicle("car", carState(definition, 0, 0), definition, () => null, 1 / 60), 0);
    assert.equal(hardStamper.stampVehicle("car", carState(definition, 0, 0, null), definition, onMud, 1 / 60), 0);
    assert.equal(hard.stats().activeCellCount, 0);
  });

  check("wheel tracks: a teleport starts a new track instead of sweeping one across", () => {
    const definition = createReferenceCarDefinition();
    const field = new DeformationField();
    const stamper = new WheelTrackStamper(field);
    stamper.stampVehicle("car", carState(definition, 0, -10), definition, onMud, 1 / 60);
    stamper.stampVehicle("car", carState(definition, 0, 10), definition, onMud, 1 / 60);
    assert.equal(field.sample(definition.wheels[0]!.position[0], 0).depth, 0);
    stamper.forget("car");
    assert.equal(stamper.stampVehicle("car", carState(definition, 0, 12), definition, onMud, 1 / 60), 4);
  });

  check("wheel tracks: a heavier load presses deeper; the soft share scales depth and tint", () => {
    const definition = createReferenceCarDefinition();
    const depthWith = (load: number, surface: SurfaceDeformationSample) => {
      const field = new DeformationField();
      const state = carState(definition, 0, 0);
      const heavy = { ...state, wheels: state.wheels.map((wheel) => ({ ...wheel, suspensionForce: load })) };
      const stamper = new WheelTrackStamper(field);
      for (let frame = 0; frame < 120; frame += 1) stamper.stampVehicle("car", heavy, definition, () => surface, 1 / 60);
      return field.sample(definition.wheels[0]!.position[0], definition.wheels[0]!.position[2]);
    };
    const nominal = nominalWheelLoad(definition);
    assert.ok(depthWith(nominal * 2, mud).depth > depthWith(nominal, mud).depth + 0.02);
    const half = depthWith(nominal, { ...mud, deformability: 0.5 });
    close(half.depth, depthWith(nominal, mud).depth / 2, 2e-4);
    assert.ok(Math.abs(half.disturbance - 127) <= 1);
  });

  /** `carState` with every wheel reporting `slip` (undefined leaves the field off, as Faz 2 states do). */
  const slipping = (definition: VehicleDefinition, slip: number | undefined): VehicleState => {
    const state = carState(definition, 0, 0);
    return slip === undefined ? state : { ...state, wheels: state.wheels.map((wheel) => ({ ...wheel, tractionSlip: slip })) };
  };
  /** `seconds` at `fps` with `slip`, after `settle` seconds parked at 60 fps (the static rut converged). */
  const dig = (slip: number | undefined, seconds: number, fps = 60, surface: SurfaceDeformationSample = mud, settle = 0): DeformationField => {
    const definition = createReferenceCarDefinition();
    const field = new DeformationField();
    const stamper = new WheelTrackStamper(field);
    for (let frame = 0; frame < Math.round(settle * 60); frame += 1) {
      stamper.stampVehicle("car", slipping(definition, 0), definition, () => surface, 1 / 60);
    }
    const state = slipping(definition, slip);
    for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) {
      stamper.stampVehicle("car", state, definition, () => surface, 1 / fps);
    }
    return field;
  };
  const wheelDepth = (field: DeformationField): number => {
    const wheel = createReferenceCarDefinition().wheels[0]!;
    return field.sample(wheel.position[0], wheel.position[2]).depth;
  };

  check("wheel tracks: a spinning wheel digs below its static rut at digRate and never past the soft layer", () => {
    const parked = wheelDepth(dig(0, 1));
    const spun = wheelDepth(dig(1, 1));
    // One second of full slip on a rut already at its static depth: digRate deeper, less the 0.1 mm floor per call.
    assert.ok(spun > parked + MUD.digRate * 0.9 && spun <= parked + MUD.digRate + 1e-4, `parked ${parked}, spun ${spun}`);
    assert.ok(wheelDepth(dig(0.5, 1)) < spun, "half the slip digs less");
    const deep = dig(1, 10);
    close(wheelDepth(deep), MUD.maxDepth, 1e-4);
    assert.ok(deep.stats().maxDepth <= MUD.maxDepth + 1e-4, `cap: ${deep.stats().maxDepth}`);
    const half = dig(1, 10, 60, { ...mud, deformability: 0.5 });
    assert.ok(half.stats().maxDepth <= MUD.maxDepth / 2 + 1e-4 && wheelDepth(half) > MUD.maxDepth / 2 - 1e-3,
      `a half-soft blend caps at half the layer: ${half.stats().maxDepth}`);
    const disturbance = deep.sample(createReferenceCarDefinition().wheels[0]!.position[0], createReferenceCarDefinition().wheels[0]!.position[2]).disturbance;
    assert.equal(disturbance, 255, "dug mud is fully churned");
  });

  check("wheel tracks: without slip or digRate the field matches the Faz 2 stamps exactly", () => {
    const faz2 = dig(undefined, 2);
    for (const field of [dig(0, 2), dig(1, 2, 60, { ...mud, digRate: 0 })]) {
      assert.deepEqual(field.depth, faz2.depth);
      assert.deepEqual(field.disturbance, faz2.disturbance);
    }
  });

  check("wheel tracks: slip digging lands within a few mm at 30 and 144 fps, even below one quantum per frame", () => {
    for (const slip of [1, 0.1]) {
      const slow = wheelDepth(dig(slip, 0.5, 30, mud, 1));
      const fast = wheelDepth(dig(slip, 0.5, 144, mud, 1));
      const parked = wheelDepth(dig(0, 1));
      // 0.08 m/s × 0.1 slip at 144 fps is ~0.56 quanta per frame: without the carried remainder it would never dig.
      assert.ok(fast > parked + MUD.digRate * slip * 0.5 * 0.9, `slip ${slip} at 144 fps: ${fast} vs parked ${parked}`);
      assert.ok(Math.abs(slow - fast) < 0.003, `slip ${slip}: 30 fps ${slow} vs 144 fps ${fast}`);
    }
  });

  check("wheel tracks: rut steering reads the cross slope ahead of a rolling wheel, past its own fresh footprint", () => {
    // An old rut along +Z from z = 2 on, deepening toward +X across x ∈ [0, 0.3].
    const oldRut = (x: number, z: number) => (z >= 2 ? Math.max(0, Math.min(0.1, x / 3)) : 0);
    const reach = wheelContactLength(0.35, 0.05) / 2 + RUT_LOOKAHEAD_MARGIN;
    // Standing: nothing ahead to read.
    assert.equal(rutSlopeAhead(oldRut, 0.1, 2 - reach, 0, 0.25, 0.35, 0.05, 0), 0);
    // Rolling +Z: the point `reach` ahead is in the old rut, deeper toward +X (the axle's + side).
    close(rutSlopeAhead(oldRut, 0.1, 2 - reach + 1e-6, 0, 0.25, 0.35, 0.05, 1), 1 / 3, 1e-9);
    // Short of it, or reversing away from it: level ground ahead.
    assert.equal(rutSlopeAhead(oldRut, 0.1, 2 - reach - 0.01, 0, 0.25, 0.35, 0.05, 1), 0);
    assert.equal(rutSlopeAhead(oldRut, 0.1, 1.9, 0, 0.25, 0.35, 0.05, -1), 0);
    // Facing −Z and reversing toward +Z rolls into it; that axle's + side is −X, so the slope flips sign.
    close(rutSlopeAhead(oldRut, 0.1, 2.5, Math.PI, 0.25, 0.35, 0.05, -1), -1 / 3, 1e-9);
    // Reversing into it: heading +Z, travel −1 reads behind, where the rut is; same slope sign along the same axle.
    close(rutSlopeAhead(oldRut, 0.1, 2 + reach + 0.1, 0, 0.25, 0.35, 0.05, -1), 1 / 3, 1e-9);
    // A deeper own rut has a longer footprint: the read moves further ahead.
    assert.ok(wheelContactLength(0.35, 0.2) > wheelContactLength(0.35, 0.05));
    close(rutSlopeAhead(oldRut, 0.1, 2 - reach - 0.01, 0, 0.25, 0.35, 0.2, 1), 1 / 3, 1e-9);
    assert.equal(rutSlopeAhead(oldRut, 0.1, 2.5, Number.NaN, 0.25, 0.35, 0.05, 1), 0);
  });

  check("terrain surface: the deformation profile blends over soft layers only", () => {
    const source = { physicalMaterials: [null, "mud", "snow"], weightsAt: (_point: readonly number[], out: number[]) => {
      out.length = 3; out[0] = 0.5; out[1] = 0.25; out[2] = 0.25; return true;
    } };
    const sample = new TerrainSurfaceSampler(source).deformationAt([0, 0, 0])!;
    close(sample.deformability, 0.5);
    close(sample.maxDepth, (MUD.maxDepth + SNOW.maxDepth) / 2);
    close(sample.compaction, (MUD.compaction + SNOW.compaction) / 2);
    close(sample.digRate, (MUD.digRate + SNOW.digRate) / 2);
    close(sample.recoveryRate, (MUD.recoveryRate + SNOW.recoveryRate) / 2);
    close(sample.sinkResistance, (mud.sinkResistance + snow.sinkResistance) / 2);
    const grassOnly = { physicalMaterials: [null, "mud"], weightsAt: (_point: readonly number[], out: number[]) => {
      out.length = 2; out[0] = 1; out[1] = 0; return true;
    } };
    assert.equal(new TerrainSurfaceSampler(grassOnly).deformationAt([0, 0, 0]), null);
    assert.equal(new TerrainSurfaceSampler({ physicalMaterials: ["stone"], weightsAt: () => true }).deformable, false);
  });

  check("terrain deformation texture: full copy on attach, dirty rectangles after, window follows the field", () => {
    const field = new DeformationField({ windowSize: 8, cellSize: 0.5 });
    const texture = new TerrainDeformationTexture();
    assert.equal(texture.uniforms.uDeformActive!.value, 0);
    field.stampDisc([0.25, 0.25], 1, TERRAIN_DEFORMATION_DEPTH_RANGE / 2, 1, 100);
    texture.attach(field);
    assert.equal(texture.uniforms.uDeformActive!.value, 1);
    const tex = texture.uniforms.uDeformTex!.value as { image: { data: Uint8Array; width: number } };
    assert.equal(tex.image.width, 16);
    // Toroidal storage: world cell (x, z) lives at mod(z, N) * N + mod(x, N).
    const mod = (v: number) => ((v % 16) + 16) % 16;
    const index = (x: number, z: number) => mod(z) * 16 + mod(x);
    assert.ok(Math.abs(tex.image.data[index(0, 0) * 2]! - 128) <= 1, "half the range encodes as ~128");
    assert.equal(tex.image.data[index(0, 0) * 2 + 1], 100);
    field.takeDirty();
    field.recenter(3, -2);
    field.stampDisc([2.25, 0.25], 1, TERRAIN_DEFORMATION_DEPTH_RANGE * 2, 1, 255);
    texture.update(field.takeDirty());
    assert.equal(tex.image.data[index(4, 0) * 2], 255, "deeper than the range saturates");
    assert.ok(texture.stats().uploadedTexels > 0 && texture.stats().uploadedTexels < 2 * 16 * 16, "bounded dirty regions with filter halos");
    const window = texture.uniforms.uDeformWindow!.value as { x: number; y: number; z: number; w: number };
    assert.deepEqual([window.x, window.y, window.z, window.w], [field.originCell[0] * 0.5, field.originCell[1] * 0.5, 8, 0.5]);
    texture.detach();
    assert.equal(texture.uniforms.uDeformActive!.value, 0);
    texture.dispose();
    const layers = terrainDeformationLayerUniforms([null, "mud", "stone"]);
    const tints = layers.uDeformLayerTint!.value as { toArray(): number[] }[];
    assert.deepEqual(tints[0]!.toArray(), [0, 0, 0, 0]);
    assert.deepEqual(tints[1]!.toArray(), [...MUD.tint, MUD.tintStrength]);
    assert.deepEqual((layers.uDeformLayerWet!.value as number[]).slice(0, 3), [0, MUD.wetness, 0]);
  });

  check("terrain deformation module: stamps vehicles on soft terrain, follows the player, idles without one", () => {
    const definition = createReferenceCarDefinition();
    let z = 0;
    let soft = true;
    let tractionSlip = 0;
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    let groundSink: VehicleGroundSinkProvider | null = null;
    let physicsStep: ((dt: number) => void) | null = null;
    const vehicles: Pick<VehicleHost, "vehicleIds" | "vehicleState" | "vehicleDefinition" | "possessedEntityId" | "setGroundSinkProvider" | "onPhysicsStep"> = {
      vehicleIds: () => ["parked", "car"],
      vehicleState: (id) => {
        const state = carState(definition, id === "car" ? 0 : 200, id === "car" ? z : 0);
        return { ...state, wheels: state.wheels.map((wheel) => ({ ...wheel, tractionSlip })) };
      },
      vehicleDefinition: () => definition,
      possessedEntityId: () => "car",
      setGroundSinkProvider: (provider) => { groundSink = provider; },
      onPhysicsStep: (listener) => { physicsStep = listener; return () => { physicsStep = null; }; },
    };
    host.provide(vehicleHostService, vehicles as VehicleHost);
    host.provide(terrainSurfaceHostService, {
      deformationAt: () => mud,
      hasDeformableTerrain: () => soft,
    });
    const texture = new TerrainDeformationTexture();
    const module = createTerrainDeformationModule({ texture });
    module.onRuntimeStart!(host);
    const subsystems: Subsystem[] = [];
    host.installSubsystems((subsystem) => subsystems.push(subsystem));
    const render = () => subsystems[0]!.update!({ deltaSeconds: 1 / 60, elapsedSeconds: 0, frame: 0 });
    const tick = () => { physicsStep!(1 / 60); render(); };
    const commands = host.resolve(terrainDeformationService)!;
    render();
    assert.equal(commands.snapshot(), null, "render-only frames cannot create physical soil state");
    for (let frame = 0; frame < 60; frame += 1) {
      z += 0.1;
      tick();
    }
    const snapshot = commands.snapshot()!;
    assert.ok(snapshot.activeCells > 0 && snapshot.maxDepth > 0.05, JSON.stringify(snapshot));
    // Eight wheels stamp, but the parked car is 200 m away: outside the window, so it leaves no cells.
    assert.equal(snapshot.stampedWheels, 8);
    assert.ok(texture.water.state.sites.size > 0 && texture.water.state.impulses.length > 0, "wet wheel contacts feed the presentation field");
    assert.equal(texture.water.state.previous.size, definition.wheels.length, "distant vehicles do not consume the local water budget");
    texture.water.state.impulses.length = 0;
    tick();
    assert.equal(texture.water.state.impulses.length, 0, "stationary unpowered wheels leave the water calm");
    tractionSlip = 0.8;
    tick();
    assert.ok(texture.water.state.impulses.length > 0, "physics slip reaches water without position or rotation changes");
    assert.ok([...texture.water.state.previous.values()].every((wheel) => wheel.tractionSlip === 0.8));
    tractionSlip = 0;
    // The window centres on the mean hard point (the axles are not symmetric about the origin).
    const axleOffset = definition.wheels.reduce((sum, wheel) => sum + wheel.position[2], 0) / definition.wheels.length;
    close(snapshot.centre[1], z + axleOffset, 1e-9);
    assert.ok(commands.sample(definition.wheels[0]!.position[0], z - 1).depth > 0);
    assert.equal(commands.sample(200 + definition.wheels[0]!.position[0], 0).depth, 0);
    // Physics reads the ruts through the installed provider: depth, the mud's drag and the rut's cross slope.
    const wheelX = definition.wheels[0]!.position[0];
    const query = (x: number, travel = 1) => groundSink!({
      vehicleEntityId: "car", wheelIndex: 0, groundEntityId: "landscape:t:0_0", contactPoint: [x, 0, z - 1], heading: 0, width: 0.25,
      radius: definition.wheels[0]!.radius, travel,
    });
    const centred = query(wheelX, 0)!;
    assert.ok(centred.depth > 0.05 && centred.resistance === mud.sinkResistance && centred.slope === 0, JSON.stringify(centred));
    // Rolling +Z along the rut it left: the axle's + side is +X, so a tyre left of the rut (−X) sees the ground fall away toward +.
    assert.ok(query(wheelX - 0.15)!.slope! > 0.1 && query(wheelX + 0.15)!.slope! < -0.1);
    assert.equal(query(wheelX + 3), null, "off the rut: nothing to sink into");
    commands.stamp(0, z, 0.3, 0.05);
    assert.ok(commands.sample(0, z).depth > 0.04);
    assert.match(formatTerrainDeformationDebug(snapshot), /^terrain deformation: cells \d+ max 0\.\d{3} m wheels 8 upload \d+ texels \d+\.\d{2} ms$/);
    assert.equal(texture.uniforms.uDeformActive!.value, 1);
    soft = false;
    tick();
    assert.equal(commands.snapshot(), null, "no deformable terrain: the field is released");
    assert.equal(groundSink, null, "and the physics provider with it");
    assert.equal(texture.uniforms.uDeformActive!.value, 0);
    module.dispose!();
    assert.equal(physicsStep, null, "module disposal unsubscribes from physics");
  });
}
