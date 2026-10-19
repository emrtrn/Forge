/**
 * Vehicle plan Faz 5: the Actor Script Details forms for `Vehicle` and
 * `VehicleAiDriver`. The DOM wiring is the editor's; what is pinned here is
 * that every edit the form makes is one the runtime reads the intended way —
 * blank overrides inherit the asset, Silent really silences the car, and the AI
 * driver's implicit defaults stay implicit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cloneActorInstance } from "../../editor/core/layoutSnapshots";
import {
  applyVehicleOverrides,
  normalizeVehicleAsset,
  normalizeVehicleDefinition,
  vehicleDefinitionFromComponent,
  type VehicleDefinition,
} from "../../engine/physics/vehicle/vehicleTypes";
import { normalizeActorScriptDef } from "../../engine/scene/actorScript";
import { readVehicleAiDriverComponent } from "../../engine/scene/components";
import type { LayoutActorInstance } from "../../engine/scene/layout";
import type { Entity, SceneJsonValue } from "../../engine/scene/entity";
import {
  ENGINE_SOUND_INHERIT,
  ENGINE_SOUND_SILENT,
  setVehicleAiDriverChoice,
  setVehicleAsset,
  setVehicleEngineSound,
  setVehicleScalarOverride,
  vehicleAiDriverFields,
  vehicleComponentFields,
} from "../../src/editor/vehicleComponentFields";
import {
  drivenWheels,
  enginePeaks,
  gearTopSpeedsKmh,
  torqueAtRpm,
  torqueCurveSvg,
  vehicleDiagnostics,
  vehicleTopViewSvg,
} from "../../src/editor/vehicleAssetEditorModel";
import { withVehicleOverrides } from "../../src/scene/vehicleAssetLoader";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateActorInstance } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;
type Props = Record<string, SceneJsonValue>;

const ASSET_PATH = "assets/cars/Truck.vehicle.json";

function truck(): VehicleDefinition {
  return normalizeVehicleDefinition({
    massKg: 3000,
    maxEngineForce: 9000,
    wheels: [{ position: [1, 0, 2] }, { position: [-1, 0, 2] }, { position: [1, 0, -2] }, { position: [-1, 0, -2] }],
    engineSound: { sound: "diesel", idlePitch: 0.7 },
  })!;
}

export function registerVehicleEditorFieldsTests(check: Check): void {
  check("vehicle editor overrides: blank inherits the asset, a number overrides it, junk is refused", () => {
    const props: Props = {};
    setVehicleAsset(props, ASSET_PATH);
    assert.equal(props.asset, ASSET_PATH);
    assert.equal(setVehicleScalarOverride(props, "massKg", "1800"), true);
    assert.equal(vehicleDefinitionFromComponent(props, truck())!.massKg, 1800);
    assert.equal(setVehicleScalarOverride(props, "massKg", "abc"), false);
    assert.equal(props.massKg, 1800, "a rejected edit leaves the last good value");
    assert.equal(setVehicleScalarOverride(props, "massKg", "  "), true);
    assert.equal("massKg" in props, false);
    assert.equal(vehicleDefinitionFromComponent(props, truck())!.massKg, 3000, "back to the asset's value");
    setVehicleAsset(props, "");
    assert.equal("asset" in props, false);
  });

  check("vehicle editor engine sound: inherit, silent and a swapped loop all read back as meant", () => {
    const props: Props = { engineSound: { maxPitch: 3 } };
    setVehicleEngineSound(props, "v8");
    assert.deepEqual(props.engineSound, { maxPitch: 3, sound: "v8" }, "inline tuning survives the swap");
    const swapped = vehicleDefinitionFromComponent(props, truck())!.engineSound!;
    assert.equal(swapped.sound, "v8");
    assert.equal(swapped.maxPitch, 3);
    assert.equal(swapped.idlePitch, 0.7, "untouched fields still come from the asset");

    setVehicleEngineSound(props, ENGINE_SOUND_SILENT);
    assert.equal(props.engineSound, null);
    assert.equal(vehicleDefinitionFromComponent(props, truck())!.engineSound, null);

    setVehicleEngineSound(props, ENGINE_SOUND_INHERIT);
    assert.equal("engineSound" in props, false);
    assert.equal(vehicleDefinitionFromComponent(props, truck())!.engineSound!.sound, "diesel");
  });

  check("vehicle editor form shows inherited values as placeholders and keeps unknown references", () => {
    const html = vehicleComponentFields({ asset: "assets/missing.vehicle.json", maxEngineForce: 7000, engineSound: { sound: "ghost" } }, {
      vehicleAssets: [{ path: ASSET_PATH, name: "Truck" }],
      soundAssets: [{ id: "v8", name: "V8" }],
      inherited: truck(),
    });
    assert.match(html, /data-as-vehicle-num="massKg" value="" placeholder="3000"/);
    assert.match(html, /data-as-vehicle-num="maxEngineForce" value="7000" placeholder="9000"/);
    assert.match(html, /value="assets\/missing\.vehicle\.json" selected>assets\/missing\.vehicle\.json \(unknown\)/);
    assert.match(html, /value="ghost" selected>ghost \(unknown\)/);
    assert.match(html, /4 wheels from the asset/);
    assert.match(
      vehicleComponentFields({ asset: ASSET_PATH }, { vehicleAssets: [], soundAssets: [], inherited: undefined }),
      /Loading the vehicle asset/,
    );
    assert.match(
      vehicleComponentFields({ asset: ASSET_PATH }, { vehicleAssets: [], soundAssets: [], inherited: null }),
      /could not be read/,
    );
    assert.match(
      vehicleComponentFields({ engineSound: null, wheels: [{ position: [0, 0, 0] }] },
        { vehicleAssets: [], soundAssets: [], inherited: truck() }),
      /value="__silent" selected>Silent[\s\S]*1 inline wheel replace/,
    );
  });

  check("vehicle AI driver form writes only non-default choices and reads back through the runtime", () => {
    const props: Props = { splineId: "lap" };
    setVehicleAiDriverChoice(props, "entry", "start");
    setVehicleAiDriverChoice(props, "wrapMode", "clamp");
    const read = (data: Props) => readVehicleAiDriverComponent({ components: { VehicleAiDriver: data } } as unknown as Entity)!;
    assert.equal(read(props).entry, "start");
    assert.equal(read(props).wrapMode, "clamp");
    setVehicleAiDriverChoice(props, "entry", "nearest");
    setVehicleAiDriverChoice(props, "wrapMode", "");
    assert.deepEqual(props, { splineId: "lap" }, "defaults are not written");
    assert.equal(read(props).wrapMode, undefined);
    const html = vehicleAiDriverFields({ targetSpeed: 20, enabled: false });
    assert.match(html, /data-as-num="targetSpeed" value="20"/);
    assert.match(html, /data-as-num="lookAheadDistance" value="5"/);
    assert.doesNotMatch(html, /data-as-vehicle-ai-enabled checked/);
  });

  // Placement overrides: the level Details panel's layer on top of the class.
  check("vehicle placement overrides layer onto the class props before the asset resolves", () => {
    const classProps = { asset: ASSET_PATH, massKg: 2500, engineSound: { sound: "diesel", maxPitch: 1.8 } };
    const merged = applyVehicleOverrides(classProps, {
      asset: "assets/cars/Van.vehicle.json",
      maxEngineForce: 5000,
      engineSound: { sound: "v8" },
    });
    assert.equal(merged.asset, "assets/cars/Van.vehicle.json", "the placement's asset is the one loaded");
    assert.equal(merged.massKg, 2500, "untouched class overrides stay");
    assert.equal(merged.maxEngineForce, 5000);
    assert.deepEqual(merged.engineSound, { sound: "v8", maxPitch: 1.8 }, "the loop swaps, class tuning stays");
    assert.equal(applyVehicleOverrides(classProps, { engineSound: null }).engineSound, null);
    assert.deepEqual(classProps.engineSound, { sound: "diesel", maxPitch: 1.8 }, "the class is not mutated");

    const def = normalizeActorScriptDef({ components: [
      { id: "body", component: "Collider", props: { shape: "box" } },
      { id: "car", component: "Vehicle", props: classProps },
    ] });
    const placed = withVehicleOverrides(def, { massKg: 900 });
    assert.equal(placed.components[1]!.props.massKg, 900);
    assert.equal(def.components[1]!.props.massKg, 2500);
    assert.equal(placed.components[0], def.components[0], "other components are shared, not copied");
    const plain = normalizeActorScriptDef({ components: [{ id: "body", component: "Collider", props: {} }] });
    assert.equal(withVehicleOverrides(plain, { massKg: 900 }), plain, "a class without a Vehicle is left alone");
  });

  check("vehicle placement overrides round-trip the layout save allowlist and the undo clone", () => {
    const instance = {
      classRef: "assets/cars/Script_Car.actor.json",
      position: [1, 0, 2],
      vehicleOverrides: {
        asset: ASSET_PATH,
        massKg: 1500, maxEngineForce: 8000, maxReverseForce: 3000, maxBrakeForce: 9000,
        handbrakeForce: 4000, maxSteerAngleDeg: 30, steerSpeed: 2.5,
        engineSound: { sound: "v8" },
      },
    };
    const saved = validateActorInstance(instance);
    assert.deepEqual(collectDroppedFields(instance, saved).paths, [], "every override field survives a save");
    assert.deepEqual(validateActorInstance({ ...instance, vehicleOverrides: { engineSound: null } }).vehicleOverrides,
      { engineSound: null }, "Silent survives as null");
    assert.equal(validateActorInstance({ ...instance, vehicleOverrides: {} }).vehicleOverrides, undefined);
    const dropped = collectDroppedFields(
      { ...instance, vehicleOverrides: { massKg: 1, wheels: [] } },
      validateActorInstance({ ...instance, vehicleOverrides: { massKg: 1, wheels: [] } }),
    );
    assert.deepEqual(dropped.paths, ["vehicleOverrides.wheels"], "wheels belong to the asset, and the drop is reported");
    assert.throws(() => validateActorInstance({ ...instance, vehicleOverrides: { asset: "../x.vehicle.json" } }), /asset/);
    assert.throws(() => validateActorInstance({ ...instance, vehicleOverrides: { massKg: -1 } }), /non-negative/);
    assert.throws(() => validateActorInstance({ ...instance, vehicleOverrides: { engineSound: {} } }), /engineSound/);

    const layout = instance as unknown as LayoutActorInstance;
    const clone = cloneActorInstance(layout);
    assert.deepEqual(clone.vehicleOverrides, layout.vehicleOverrides);
    assert.notEqual(clone.vehicleOverrides, layout.vehicleOverrides);
    assert.notEqual(clone.vehicleOverrides!.engineSound, layout.vehicleOverrides!.engineSound);
  });

  check("vehicle Details form edits a placement's overrides with class values as placeholders", () => {
    const html = vehicleComponentFields({ maxEngineForce: 5000 }, {
      surface: "details",
      classAsset: ASSET_PATH,
      disabled: true,
      vehicleAssets: [{ path: ASSET_PATH, name: "Truck" }],
      soundAssets: [],
      inherited: truck(),
    });
    assert.match(html, /data-actor-vehicle-section/);
    assert.match(html, /<option value="" selected>Class default \(Truck\)<\/option>/);
    assert.match(html, /class="detail-row"[\s\S]*data-as-vehicle-num="maxEngineForce" value="5000" placeholder="9000"/);
    assert.match(html, /Class default \(diesel\)/);
    assert.match(html, /data-as-vehicle-num="massKg"[^>]*disabled/, "a locked placement is read-only");
    assert.doesNotMatch(html, /as-field/);
  });

  // The Vehicle asset editor's read-outs (top view, graph, gear table, diagnostics).
  const reference = (): VehicleDefinition => normalizeVehicleAsset(JSON.parse(readFileSync(
    "public/assets/starter-content/Gameplay/ReferenceCar.vehicle.json", "utf8")))!;

  check("vehicle asset editor model: driven axle, torque lookup, peaks and gear top speeds", () => {
    const car = reference();
    assert.deepEqual(drivenWheels(car).map((wheel) => wheel.axle), ["rear", "rear"], "RWD drives the rear axle");
    assert.equal(drivenWheels({ ...car, drivetrain: null }).length, 2, "flat force follows the Drive flags");
    const drivetrain = car.drivetrain!;
    assert.equal(torqueAtRpm(drivetrain, 3500), 280, "linear between 2500/260 and 4500/300");
    assert.equal(torqueAtRpm(drivetrain, 100), 160, "held flat below the curve");
    assert.equal(torqueAtRpm(drivetrain, 9000), 200, "held flat past the curve");
    const peaks = enginePeaks(drivetrain);
    assert.ok(Math.abs(peaks.torqueNm - 300) < 1e-9 && Math.abs(peaks.torqueRpm - 4500) < 60);
    assert.ok(peaks.powerKw > 130 && peaks.powerKw < 160, `peak power ${peaks.powerKw}`);
    const speeds = gearTopSpeedsKmh(car);
    assert.equal(speeds.length, 5);
    const top = ((6500 / 60) * 2 * Math.PI) / (0.8 * drivetrain.transmission.finalDriveRatio) * 0.48 * 3.6;
    assert.ok(Math.abs(speeds[4]! - top) < 1e-9);
    assert.ok(speeds.every((speed, index) => index === 0 || speed > speeds[index - 1]!), "each gear is taller");
    assert.deepEqual(gearTopSpeedsKmh({ ...car, drivetrain: null }), []);
  });

  check("vehicle asset editor diagnostics: the reference car is clean, broken setups are named", () => {
    const car = reference();
    assert.deepEqual(vehicleDiagnostics(car), []);
    assert.deepEqual(vehicleDiagnostics({ ...car, wheels: [] }), ["No wheels: the chassis has nothing to stand on."]);
    const front = car.wheels.map((wheel) => ({ ...wheel, steer: false, axle: "front" as const }));
    const issues = vehicleDiagnostics({ ...car, wheels: front });
    assert.ok(issues.includes("No wheel steers."));
    assert.ok(issues.includes("RWD: no wheel sits on the driven axle."));
    const soft = car.wheels.map((wheel) => ({ ...wheel, suspensionStiffness: 1 }));
    assert.match(vehicleDiagnostics({ ...car, wheels: soft }).join(" "), /Wheel 1: the spring is too soft/);
    const drivetrain = car.drivetrain!;
    const redline = { ...drivetrain, transmission: { ...drivetrain.transmission, upshiftRpm: drivetrain.engine.maxRpm } };
    assert.ok(vehicleDiagnostics({ ...car, drivetrain: redline }).some((issue) => issue.startsWith("Upshift RPM")));
  });

  check("vehicle asset editor schematics: one clickable tyre per wheel and a dot per torque point", () => {
    const car = reference();
    const top = vehicleTopViewSvg(car, 2);
    assert.equal(top.match(/data-vhe-wheel="/g)?.length, 4);
    assert.match(top, /class="vhe-wheel is-driven is-selected" data-vhe-wheel="2"/);
    assert.match(top, /class="vhe-wheel is-steer" data-vhe-wheel="0"/);
    assert.equal(top.match(/vhe-handbrake/g)?.length, 2);
    // +X is the car's left: wheel 1 (x = +0.68) is drawn left of wheel 2 (x = -0.68).
    const cx = (index: number) => Number(top.match(new RegExp(`data-vhe-wheel="${index}"><rect x="([0-9.]+)"`))![1]);
    assert.ok(cx(0) < cx(1));
    const graph = torqueCurveSvg(car.drivetrain!);
    assert.equal(graph.match(/data-vhe-torque-point=/g)?.length, 4);
    assert.match(graph, /class="vhe-shift-up"/);
    assert.doesNotMatch(graph, /NaN/);
  });
}
