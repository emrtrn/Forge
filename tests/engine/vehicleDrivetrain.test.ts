import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeVehicleDrive } from "../../engine/physics/vehicle/vehicleDrive";
import {
  computeVehicleAerodynamics, initialVehicleDrivetrainState, sampleTorqueCurve,
  sampleSteeringCurve, selectAutomaticGear,
} from "../../engine/physics/vehicle/vehicleDrivetrain";
import {
  NEUTRAL_VEHICLE_INPUT, normalizeVehicleAsset, normalizeVehicleDefinition,
  type VehicleDefinition, type VehicleDrivetrainState, type VehicleInput,
} from "../../engine/physics/vehicle/vehicleTypes";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateSaveVehiclePayload } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;
const PATH = "assets/starter-content/Gameplay/ReferenceCar.vehicle.json";
const fullThrottle: VehicleInput = { ...NEUTRAL_VEHICLE_INPUT, throttle: 1 };
const sumForce = (result: ReturnType<typeof computeVehicleDrive>): number =>
  result.wheels.reduce((sum, wheel) => sum + wheel.engineForce, 0);
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function torqueCar(driveType = "RWD"): VehicleDefinition {
  return normalizeVehicleDefinition({
    maxEngineForce: 100000,
    drivetrain: {
      engine: { torqueCurve: [{ rpm: 0, torqueNm: 200 }], engineBrakeTorqueNm: 60 },
      transmission: { forwardRatios: [2], reverseRatio: 2, finalDriveRatio: 3, efficiency: 1, shiftDurationSeconds: 0 },
      differential: { driveType, frontTorqueShare: 0.25 },
    },
  })!;
}

export function registerVehicleDrivetrainTests(check: Check): void {
  check("vehicle drivetrain torque curve interpolates and clamps outside authored RPM points", () => {
    const curve = [{ rpm: 1000, torqueNm: 100 }, { rpm: 3000, torqueNm: 300 }, { rpm: 6000, torqueNm: 150 }];
    close(sampleTorqueCurve(curve, 500), 100);
    close(sampleTorqueCurve(curve, 2000), 200);
    close(sampleTorqueCurve(curve, 4500), 225);
    close(sampleTorqueCurve(curve, 8000), 150);
  });

  check("vehicle drivetrain normalizer sorts curves and enforces usable RPM and gearbox ranges", () => {
    const def = normalizeVehicleDefinition({
      drivetrain: {
        engine: { idleRpm: 8000, maxRpm: 1000, torqueCurve: [
          null, { rpm: 2000, torqueNm: 100 }, { rpm: -1, torqueNm: 2 },
          { rpm: 900, torqueNm: 60 }, { rpm: 2000, torqueNm: 200 },
        ] },
        transmission: { forwardRatios: [1, -1, 3, 2, 2, 0, Number.NaN], downshiftRpm: 99999, upshiftRpm: 1, efficiency: 4 },
        differential: { driveType: "tank", frontTorqueShare: -1 },
      },
      steeringSpeedCurve: [{ speedMps: 10, scale: 0.4 }, { speedMps: 0, scale: 2 }, { speedMps: 10, scale: 0.5 }],
    })!;
    const { engine, transmission, differential } = def.drivetrain!;
    assert.ok(engine.maxRpm > engine.idleRpm);
    assert.ok(transmission.downshiftRpm < transmission.upshiftRpm);
    assert.ok(transmission.upshiftRpm <= engine.maxRpm);
    assert.deepEqual(transmission.forwardRatios, [3, 2, 1]);
    assert.equal(transmission.efficiency, 1);
    assert.equal(differential.driveType, "RWD");
    assert.equal(differential.frontTorqueShare, 0);
    assert.deepEqual(engine.torqueCurve, [{ rpm: 900, torqueNm: 60 }, { rpm: 2000, torqueNm: 200 }]);
    assert.deepEqual(def.steeringSpeedCurve, [{ speedMps: 0, scale: 1 }, { speedMps: 10, scale: 0.5 }]);
  });

  check("vehicle drivetrain nested inline overrides preserve asset fields and all fields survive saves", () => {
    const asset = normalizeVehicleAsset(JSON.parse(readFileSync(`public/${PATH}`, "utf8")))!;
    const overridden = normalizeVehicleDefinition({
      drivetrain: { engine: { idleRpm: 1000 } }, aerodynamics: { dragCoefficient: 0.75 },
    }, asset)!;
    assert.equal(overridden.drivetrain!.engine.idleRpm, 1000);
    assert.deepEqual(overridden.drivetrain!.engine.torqueCurve, asset.drivetrain!.engine.torqueCurve);
    assert.deepEqual(overridden.drivetrain!.transmission, asset.drivetrain!.transmission);
    assert.equal(overridden.aerodynamics.downforceCoefficient, asset.aerodynamics.downforceCoefficient);
    const shape = { schema: 1, type: "vehicle", ...overridden };
    const saved = validateSaveVehiclePayload({ path: PATH, vehicle: shape });
    assert.deepEqual(saved.vehicle, shape);
    assert.deepEqual(collectDroppedFields(shape, saved.vehicle).paths, []);
    assert.deepEqual(normalizeVehicleAsset(JSON.parse(JSON.stringify(saved.vehicle))), shape);
    assert.equal(normalizeVehicleDefinition({ drivetrain: null }, asset)!.drivetrain, null);
  });

  check("vehicle drivetrain automatic gears shift with hysteresis and respect both end gears", () => {
    const transmission = normalizeVehicleDefinition({ drivetrain: {
      transmission: { forwardRatios: [3, 2, 1], upshiftRpm: 5000, downshiftRpm: 1500 },
    } })!.drivetrain!.transmission;
    assert.equal(selectAutomaticGear(transmission, 1, 5000), 2);
    assert.equal(selectAutomaticGear(transmission, 2, 1500), 1);
    assert.equal(selectAutomaticGear(transmission, 2, 3000), 2);
    assert.equal(selectAutomaticGear(transmission, 3, 6000), 3);
    assert.equal(selectAutomaticGear(transmission, 1, 900), 1);
    assert.equal(selectAutomaticGear(transmission, -1, 6000), -1);
    const gap = { ...transmission, forwardRatios: [4, 0.4] };
    assert.equal(selectAutomaticGear(gap, 1, 5000), 1, "avoid immediately downshifting after an upshift");
  });

  check("vehicle drivetrain shift duration disconnects torque and reconnects at the slice boundary", () => {
    const def = normalizeVehicleDefinition({ drivetrain: {} })!;
    const transmission = def.drivetrain!.transmission;
    const speed = 5600 * 2 * Math.PI * 0.35 / (60 * transmission.forwardRatios[0]! * transmission.finalDriveRatio);
    let result = computeVehicleDrive(def, fullThrottle, speed, 0, 0.05, initialVehicleDrivetrainState(def));
    assert.equal(result.drivetrain!.gear, 2);
    close(result.drivetrain!.shiftTimeRemaining, 0.15);
    close(sumForce(result), 0);
    result = computeVehicleDrive(def, fullThrottle, speed, 0, 0.1, result.drivetrain);
    close(result.drivetrain!.shiftTimeRemaining, 0.05);
    close(sumForce(result), 0);
    result = computeVehicleDrive(def, fullThrottle, speed, 0, 0.1, result.drivetrain);
    close(result.drivetrain!.shiftTimeRemaining, 0);
    const full = computeVehicleDrive(def, fullThrottle, speed, 0, 0.1, result.drivetrain);
    close(sumForce(result) * 2, sumForce(full));
  });

  check("vehicle drivetrain FWD RWD and AWD split torque by axle independently of legacy drive flags", () => {
    for (const mode of ["FWD", "RWD", "AWD"]) {
      const def = torqueCar(mode);
      const result = computeVehicleDrive(def, fullThrottle, 0, 0, 1 / 60);
      const torques = result.wheels.map((wheel, i) => wheel.engineForce * def.wheels[i]!.radius);
      const front = torques[0]! + torques[1]!;
      const rear = torques[2]! + torques[3]!;
      close(front, mode === "FWD" ? 1200 : mode === "AWD" ? 300 : 0);
      close(rear, mode === "RWD" ? 1200 : mode === "AWD" ? 900 : 0);
    }
    const def = torqueCar("AWD");
    const oneAxle = normalizeVehicleDefinition({ wheels: [def.wheels[0], def.wheels[1]] }, def)!;
    close(sumForce(computeVehicleDrive(oneAxle, fullThrottle, 0, 0, 1 / 60)), 1200 / 0.35);
  });

  check("vehicle drivetrain converts wheel torque by radius and preserves the total force cap", () => {
    const def = torqueCar("FWD");
    const mixed = normalizeVehicleDefinition({ wheels: [
      { position: [1, 0, 1], radius: 0.5 }, { position: [-1, 0, 1], radius: 1 },
    ] }, def)!;
    const result = computeVehicleDrive(mixed, fullThrottle, 0, 0, 1 / 60);
    close(result.wheels[0]!.engineForce, 1200);
    close(result.wheels[1]!.engineForce, 600);
    const capped = normalizeVehicleDefinition({ maxEngineForce: 100 }, mixed)!;
    close(sumForce(computeVehicleDrive(capped, fullThrottle, 0, 0, 1 / 60)), 100);
  });

  check("vehicle drivetrain enforces idle RPM rev limit and brakes before changing direction", () => {
    const def = torqueCar();
    const idle = computeVehicleDrive(def, NEUTRAL_VEHICLE_INPUT, 0, 0, 1 / 60);
    assert.equal(idle.drivetrain!.engineRpm, def.drivetrain!.engine.idleRpm);
    const fast = computeVehicleDrive(def, fullThrottle, 100, 0, 1 / 60);
    assert.equal(fast.drivetrain!.engineRpm, def.drivetrain!.engine.maxRpm);
    close(sumForce(fast), 0);
    const brake = { ...NEUTRAL_VEHICLE_INPUT, brake: 1 };
    const slowing = computeVehicleDrive(def, brake, 5, 0, 1 / 60);
    assert.equal(slowing.drivetrain!.gear, 1);
    close(sumForce(slowing), 0);
    assert.ok(slowing.wheels.every((wheel) => wheel.brakeForce > 0));
    const reversing = computeVehicleDrive(def, brake, 0, 0, 1 / 60, slowing.drivetrain);
    assert.equal(reversing.drivetrain!.gear, -1);
    assert.ok(sumForce(reversing) < 0);
    const reverseState: VehicleDrivetrainState = { ...reversing.drivetrain!, gear: -1 };
    const recover = computeVehicleDrive(def, fullThrottle, -5, 0, 1 / 60, reverseState);
    assert.equal(recover.drivetrain!.gear, -1);
    close(sumForce(recover), 0);
  });

  check("vehicle drivetrain engine braking resists coasting in forward and reverse without propelling at rest", () => {
    const def = torqueCar();
    for (const speed of [10, -10]) {
      const state = { engineRpm: 2000, gear: speed > 0 ? 1 : -1, shiftTimeRemaining: 0 };
      const result = computeVehicleDrive(def, NEUTRAL_VEHICLE_INPUT, speed, 0, 1 / 60, state);
      close(sumForce(result), 0);
      assert.ok(result.wheels[2]!.brakeForce > def.rollingResistanceForce / 4);
    }
    const rest = computeVehicleDrive(def, NEUTRAL_VEHICLE_INPUT, 0, 0, 1 / 60);
    close(rest.wheels[2]!.brakeForce, def.rollingResistanceForce / 4);
  });

  check("vehicle drivetrain speed steering curve reduces both forward and reverse lock and handbrake grip restores", () => {
    const def = normalizeVehicleDefinition({
      steeringSpeedCurve: [{ speedMps: 0, scale: 1 }, { speedMps: 20, scale: 0.2 }],
      handbrakeSideFrictionMultiplier: 0.25,
    })!;
    close(sampleSteeringCurve(def.steeringSpeedCurve, -10), 0.6);
    const input = { ...fullThrottle, steer: 1, handbrake: true };
    const slow = computeVehicleDrive(def, input, 0, 1, 1 / 60);
    const fast = computeVehicleDrive(def, input, 20, 1, 1 / 60);
    close(fast.wheels[0]!.steering, slow.wheels[0]!.steering * 0.2);
    close(fast.wheels[0]!.sideFrictionStiffness, 1);
    close(fast.wheels[2]!.sideFrictionStiffness, 0.25);
    const released = computeVehicleDrive(def, fullThrottle, 20, 1, 1 / 60);
    close(released.wheels[2]!.sideFrictionStiffness, 1);
  });

  check("vehicle aerodynamics are quadratic drag opposes velocity and downforce is downward", () => {
    const def = normalizeVehicleDefinition({ aerodynamics: { dragCoefficient: 2, downforceCoefficient: 3 } })!;
    const low = computeVehicleAerodynamics(def, [0, 0, 10]);
    close(low[0], 0);
    close(low[1], -300);
    close(low[2], -200);
    const force = computeVehicleAerodynamics(def, [0, 0, 20]);
    close(force[2], -800);
    close(force[1], -1200);
    const reverse = computeVehicleAerodynamics(def, [0, 0, -10]);
    close(reverse[2], 200);
    const vertical = computeVehicleAerodynamics(def, [0, -10, 0]);
    close(vertical[1], 200);
  });
}
