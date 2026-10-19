/**
 * Pure read-outs for the Vehicle asset editor (vehicle plan Faz 5): the
 * top-view wheel schematic, the torque/power graph, per-gear top speeds and
 * the diagnostics list. No DOM — strings and numbers only, so the engine tests
 * pin them headless and the editor just places the markup.
 *
 * Conventions follow `vehicleTypes.ts`: chassis-local, +Y up, +Z forward, the
 * car's right is -X. The top view looks down with the nose up the screen, so
 * +X (the car's left) is drawn on the left.
 */
import type {
  VehicleDefinition,
  VehicleDrivetrainDefinition,
  VehicleWheelDefinition,
} from "@engine/physics/vehicle/vehicleTypes";

const GRAVITY = 9.81;
const TYRE_WIDTH = 0.26;

/** Wheels the engine turns: the drivetrain's axle(s), else the legacy `drive` flags. */
export function drivenWheels(def: VehicleDefinition): VehicleWheelDefinition[] {
  const drivetrain = def.drivetrain;
  if (!drivetrain) return def.wheels.filter((wheel) => wheel.drive);
  const type = drivetrain.differential.driveType;
  if (type === "AWD") return [...def.wheels];
  const axle = type === "FWD" ? "front" : "rear";
  return def.wheels.filter((wheel) => wheel.axle === axle);
}

/** Torque (N·m) at an RPM, linear between curve points and held flat past the ends. */
export function torqueAtRpm(drivetrain: VehicleDrivetrainDefinition, rpm: number): number {
  const curve = drivetrain.engine.torqueCurve;
  if (curve.length === 0) return 0;
  if (rpm <= curve[0]!.rpm) return curve[0]!.torqueNm;
  for (let index = 1; index < curve.length; index += 1) {
    const a = curve[index - 1]!;
    const b = curve[index]!;
    if (rpm <= b.rpm) {
      const span = b.rpm - a.rpm;
      return span > 0 ? a.torqueNm + ((rpm - a.rpm) / span) * (b.torqueNm - a.torqueNm) : b.torqueNm;
    }
  }
  return curve[curve.length - 1]!.torqueNm;
}

export function powerKw(torqueNm: number, rpm: number): number {
  return (torqueNm * rpm) / 9549;
}

/**
 * Peak torque and peak power across idle..max RPM. The curve is piecewise
 * linear, so its own points are sampled exactly (the torque peak is always one
 * of them) alongside an even sweep for the power peak between points.
 */
export function enginePeaks(drivetrain: VehicleDrivetrainDefinition): {
  torqueNm: number; torqueRpm: number; powerKw: number; powerRpm: number;
} {
  const { idleRpm, maxRpm } = drivetrain.engine;
  let peaks = { torqueNm: 0, torqueRpm: idleRpm, powerKw: 0, powerRpm: idleRpm };
  const steps = 64;
  const samples = [
    ...Array.from({ length: steps + 1 }, (_, step) => idleRpm + ((maxRpm - idleRpm) * step) / steps),
    ...drivetrain.engine.torqueCurve.map((point) => point.rpm).filter((rpm) => rpm >= idleRpm && rpm <= maxRpm),
  ];
  for (const rpm of samples) {
    const torque = torqueAtRpm(drivetrain, rpm);
    const power = powerKw(torque, rpm);
    if (torque > peaks.torqueNm) peaks = { ...peaks, torqueNm: torque, torqueRpm: rpm };
    if (power > peaks.powerKw) peaks = { ...peaks, powerKw: power, powerRpm: rpm };
  }
  return peaks;
}

/**
 * Road speed (km/h) each forward gear reaches at the rev limiter, from the
 * driven wheels' mean radius — what a gear table is read for. Empty without a
 * drivetrain or driven wheels.
 */
export function gearTopSpeedsKmh(def: VehicleDefinition): number[] {
  const drivetrain = def.drivetrain;
  const driven = drivenWheels(def);
  if (!drivetrain || driven.length === 0) return [];
  const radius = driven.reduce((sum, wheel) => sum + wheel.radius, 0) / driven.length;
  const final = drivetrain.transmission.finalDriveRatio;
  return drivetrain.transmission.forwardRatios.map((ratio) => {
    const wheelRadPerSecond = ((drivetrain.engine.maxRpm / 60) * 2 * Math.PI) / (ratio * final);
    return wheelRadPerSecond * radius * 3.6;
  });
}

/** Static spring compression per wheel under the car's weight (m). */
export function staticSag(def: VehicleDefinition, wheel: VehicleWheelDefinition): number {
  const count = Math.max(1, def.wheels.length);
  return GRAVITY / (count * wheel.suspensionStiffness);
}

/** Authoring problems worth a warning; none of them stops a save. */
export function vehicleDiagnostics(def: VehicleDefinition): string[] {
  const out: string[] = [];
  if (def.wheels.length === 0) return ["No wheels: the chassis has nothing to stand on."];
  if (!def.wheels.some((wheel) => wheel.steer)) out.push("No wheel steers.");
  if (!def.wheels.some((wheel) => wheel.brake)) out.push("No wheel takes the foot brake.");
  if (drivenWheels(def).length === 0) {
    out.push(def.drivetrain
      ? `${def.drivetrain.differential.driveType}: no wheel sits on the driven axle.`
      : "No wheel is marked Drive: the car cannot move.");
  }
  def.wheels.forEach((wheel, index) => {
    const sag = staticSag(def, wheel);
    if (sag >= wheel.suspensionRestLength + wheel.suspensionMaxTravel) {
      out.push(`Wheel ${index + 1}: the spring is too soft to hold the car (sag ${sag.toFixed(2)} m).`);
    }
  });
  const drivetrain = def.drivetrain;
  if (drivetrain) {
    if (drivetrain.engine.torqueCurve.length < 2) out.push("The torque curve needs at least two points.");
    if (drivetrain.transmission.forwardRatios.length === 0) out.push("The gearbox has no forward gears.");
    if (drivetrain.transmission.upshiftRpm >= drivetrain.engine.maxRpm) {
      out.push("Upshift RPM is at the rev limiter: the box never changes up.");
    }
  }
  if (def.engineSound && !def.engineSound.sound.trim()) out.push("The engine sound has no sound asset.");
  return out;
}

const fmt = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * Top-down schematic: chassis outline around the wheels, each wheel a tyre
 * rectangle (steer = accent outline, driven = filled, handbrake = bar), the
 * centre of mass as a cross. `data-vhe-wheel` lets the editor select a wheel.
 */
export function vehicleTopViewSvg(def: VehicleDefinition, selectedWheel: number | null): string {
  const width = 220;
  const height = 260;
  const xs = def.wheels.map((wheel) => wheel.position[0]);
  const zs = def.wheels.map((wheel) => wheel.position[2]);
  const halfX = Math.max(1, ...xs.map(Math.abs)) + 0.4;
  const halfZ = Math.max(1.6, ...zs.map(Math.abs)) + 0.6;
  const scale = Math.min((width - 24) / (halfX * 2), (height - 24) / (halfZ * 2));
  const sx = (x: number): number => width / 2 - x * scale; // +X (car's left) → screen left
  const sz = (z: number): number => height / 2 - z * scale; // +Z (forward) → screen up
  const driven = new Set(drivenWheels(def));
  const body = `<rect class="vhe-chassis" x="${fmt(sx(halfX - 0.25))}" y="${fmt(sz(halfZ - 0.25))}" width="${fmt((halfX - 0.25) * 2 * scale)}" height="${fmt((halfZ - 0.25) * 2 * scale)}" rx="10"/>`;
  const nose = `<path class="vhe-nose" d="M${fmt(width / 2 - 7)} ${fmt(sz(halfZ - 0.25) + 12)} L${fmt(width / 2)} ${fmt(sz(halfZ - 0.25) + 4)} L${fmt(width / 2 + 7)} ${fmt(sz(halfZ - 0.25) + 12)}"/>`;
  const wheels = def.wheels.map((wheel, index) => {
    const w = TYRE_WIDTH * scale;
    const h = wheel.radius * 2 * scale;
    const classes = [
      "vhe-wheel",
      wheel.steer ? "is-steer" : "",
      driven.has(wheel) ? "is-driven" : "",
      index === selectedWheel ? "is-selected" : "",
    ].filter(Boolean).join(" ");
    const cx = sx(wheel.position[0]);
    const cy = sz(wheel.position[2]);
    const handbrake = wheel.handbrake
      ? `<line class="vhe-handbrake" x1="${fmt(cx - w)}" y1="${fmt(cy)}" x2="${fmt(cx + w)}" y2="${fmt(cy)}"/>`
      : "";
    return `<g class="${classes}" data-vhe-wheel="${index}"><rect x="${fmt(cx - w / 2)}" y="${fmt(cy - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="2"/>${handbrake}<text x="${fmt(cx)}" y="${fmt(cy - h / 2 - 4)}">${index + 1}</text></g>`;
  }).join("");
  const comX = sx(def.centerOfMassOffset[0]);
  const comY = sz(def.centerOfMassOffset[2]);
  const com = `<g class="vhe-com"><circle cx="${fmt(comX)}" cy="${fmt(comY)}" r="5"/><path d="M${fmt(comX - 8)} ${fmt(comY)}h16M${fmt(comX)} ${fmt(comY - 8)}v16"/></g>`;
  return `<svg class="vhe-topview" viewBox="0 0 ${width} ${height}" role="img" aria-label="Wheel layout, top view">${body}${nose}${wheels}${com}</svg>`;
}

/**
 * Torque (solid) and power (dashed) over idle..max RPM, with the curve's points
 * as dots and the shift points as verticals.
 */
export function torqueCurveSvg(drivetrain: VehicleDrivetrainDefinition): string {
  const width = 480;
  const height = 220;
  const pad = { left: 34, right: 34, top: 22, bottom: 26 };
  const { idleRpm, maxRpm, torqueCurve } = drivetrain.engine;
  const rpmMax = Math.max(maxRpm, ...torqueCurve.map((point) => point.rpm), 1);
  const peaks = enginePeaks(drivetrain);
  const torqueMax = Math.max(1, ...torqueCurve.map((point) => point.torqueNm)) * 1.15;
  const powerMax = Math.max(1, peaks.powerKw) * 1.15;
  const px = (rpm: number): number => pad.left + (rpm / rpmMax) * (width - pad.left - pad.right);
  const py = (value: number, max: number): number => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const samples = 48;
  const line = (value: (rpm: number) => number, max: number): string => {
    const points: string[] = [];
    for (let step = 0; step <= samples; step += 1) {
      const rpm = idleRpm + ((maxRpm - idleRpm) * step) / samples;
      points.push(`${fmt(px(rpm))},${fmt(py(value(rpm), max))}`);
    }
    return points.join(" ");
  };
  const torque = line((rpm) => torqueAtRpm(drivetrain, rpm), torqueMax);
  const power = line((rpm) => powerKw(torqueAtRpm(drivetrain, rpm), rpm), powerMax);
  const dots = torqueCurve
    .map((point, index) => `<circle class="vhe-curve-dot" data-vhe-torque-point="${index}" cx="${fmt(px(point.rpm))}" cy="${fmt(py(point.torqueNm, torqueMax))}" r="3.5"/>`)
    .join("");
  const vertical = (rpm: number, cls: string): string =>
    `<line class="${cls}" x1="${fmt(px(rpm))}" y1="${pad.top}" x2="${fmt(px(rpm))}" y2="${height - pad.bottom}"/>`;
  const shifts = vertical(drivetrain.transmission.upshiftRpm, "vhe-shift-up")
    + vertical(drivetrain.transmission.downshiftRpm, "vhe-shift-down");
  const axis = `<line class="vhe-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"/>`;
  const labels = [
    `<text class="vhe-label" x="${pad.left}" y="${height - 6}">0</text>`,
    `<text class="vhe-label" x="${width - pad.right}" y="${height - 6}" text-anchor="end">${Math.round(rpmMax)} rpm</text>`,
    `<text class="vhe-label vhe-torque-label" x="4" y="${pad.top + 4}">${Math.round(torqueMax / 1.15)} N·m</text>`,
    `<text class="vhe-label vhe-power-label" x="${width - 4}" y="${pad.top + 4}" text-anchor="end">${Math.round(peaks.powerKw)} kW</text>`,
  ].join("");
  return `<svg class="vhe-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="Torque and power curve">${axis}${shifts}<polyline class="vhe-power" points="${power}"/><polyline class="vhe-torque" points="${torque}"/>${dots}${labels}</svg>`;
}
