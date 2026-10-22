import * as THREE from "three";
import type { DynamicRayCastVehicleController, RigidBody } from "@dimforge/rapier3d-compat";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { createReferenceCarDefinition, NEUTRAL_VEHICLE_INPUT } from "../../engine/physics/vehicle/vehicleTypes";
import { createPhysicalMaterialSurfaceProvider, resolveSurfaceSample } from "../../engine/physics/surface/surfaceResponse";
import type { Entity } from "../../engine/scene/entity";

const STEP = 1 / 60;
const CAR = "car";
const SEED = 1337;
const out = document.querySelector<HTMLPreElement>("#out")!;
out.textContent = "";
const log = (line: string): void => { out.textContent += `${line}\n`; };
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const f = (n: number): string => n.toFixed(3);

function requireMeasurement(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function stats(values: readonly number[]) {
  if (values.length === 0) return { samples: 0, mean: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

function random(seed: number): () => number {
  let state = seed;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Spike-only access to the actual subsystem's live objects. No production API
// is added for this experiment. Hooks run AFTER engine drive commands, directly
// before its real controller.updateVehicle and world.step, never a parallel world.
interface PhysicsInternals {
  rapierBodies: Map<string, { body: RigidBody }>;
  vehicles: Map<string, { controller: DynamicRayCastVehicleController | null }>;
}

async function fixture(slopeDeg = 0) {
  const physics = new PhysicsSubsystem({ backend: "rapier", fixedTimestep: STEP });
  const angle = slopeDeg * Math.PI / 180;
  const tangent = { x: 0, y: Math.sin(angle), z: Math.cos(angle) };
  const entities: Entity[] = [
    {
      id: "ground",
      components: {
        Transform: { position: [0, -0.5 * Math.cos(angle), 0.5 * Math.sin(angle)], rotation: [-slopeDeg, 0, 0], scale: [1, 1, 1] },
        Collider: { shape: "box", size: [2048, 1, 2048], isStatic: true, isSensor: false, physicalMaterialId: "mud" },
      },
    },
    {
      id: CAR,
      components: {
        Transform: { position: [0, 1.1, 0], rotation: [-slopeDeg, 0, 0], scale: [1, 1, 1] },
        Collider: {
          shape: "box", size: [1.8, 0.6, 4.2], isStatic: false, isSensor: false,
          simulatePhysics: true, linearDamping: 0, angularDamping: 0,
        },
      },
    },
  ];
  physics.setEntities(entities);
  try {
    await physics.init();
    // Isolate the applied resistance: no built-in coasting brake, aerodynamic
    // drag, engine braking or body damping in any of the paired measurements.
    const definition = { ...createReferenceCarDefinition(), rollingResistanceForce: 0 };
    requireMeasurement(physics.createVehicle(CAR, definition), "reference car did not attach to Rapier");
    const internals = physics as unknown as PhysicsInternals;
    const body = internals.rapierBodies.get(CAR)!.body;
    const controller = internals.vehicles.get(CAR)!.controller!;
    const originalUpdate = controller.updateVehicle.bind(controller);
    let beforeStep = (): void => {};
    controller.updateVehicle = (...args: Parameters<typeof originalUpdate>): void => {
      beforeStep();
      originalUpdate(...args);
    };
    let frame = 0;
    const tick = (): void => {
      frame += 1;
      physics.update({ deltaSeconds: STEP, elapsedSeconds: frame * STEP, frame });
      requireMeasurement(physics.lastFrameStepCount() === 1, "expected exactly one 60 Hz slice");
      const p = body.translation();
      requireMeasurement(Number.isFinite(p.x + p.y + p.z) && Math.abs(p.z) < 1000 && Math.abs(p.x) < 1000 && p.y > -100,
        "chassis became non-finite or left the ground fixture");
    };
    physics.setVehicleInput(CAR, { ...NEUTRAL_VEHICLE_INPUT, handbrake: true });
    // Keep the solver live while settling. Rapier's vehicle controller can
    // change a sleeping body's reported linvel without moving its pose.
    let settledMinY = Infinity;
    let settledMaxY = -Infinity;
    for (let i = 0; i < 600; i += 1) {
      body.wakeUp();
      tick();
      if (i >= 480) {
        const p = body.translation();
        const normalHeight = p.y * Math.cos(angle) - p.z * Math.sin(angle);
        settledMinY = Math.min(settledMinY, normalHeight);
        settledMaxY = Math.max(settledMaxY, normalHeight);
      }
    }
    requireMeasurement(physics.vehicleState(CAR)!.wheels.every((wheel) => wheel.inContact), "car did not settle with four contacts");
    requireMeasurement(settledMaxY - settledMinY < 0.001, "ground-normal height did not settle within 1 mm over the last 2 s");
    return {
      physics, definition, body, controller, tangent, tick,
      hook(fn: () => void): void { beforeStep = fn; },
      speed(): number { const v = body.linvel(); return v.y * tangent.y + v.z * tangent.z; },
      release(speed = 0): void {
        physics.setVehicleInput(CAR, NEUTRAL_VEHICLE_INPUT);
        body.setLinvel({ x: 0, y: speed * tangent.y, z: speed * tangent.z }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
    };
  } catch (error) {
    physics.dispose();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function localRates(body: RigidBody): { pitch: number; roll: number } {
  if (body.isSleeping()) return { pitch: 0, roll: 0 };
  const { x, y, z, w } = body.rotation();
  const a = body.angvel();
  return {
    pitch: a.x * (1 - 2 * (y * y + z * z)) + a.y * 2 * (x * y + w * z) + a.z * 2 * (x * z - w * y),
    roll: a.x * 2 * (x * z + w * y) + a.y * 2 * (y * z - w * x) + a.z * (1 - 2 * (x * x + y * y)),
  };
}

// --- A. one-wheel rest length -------------------------------------------------------------

async function sleepProbe() {
  const car = await fixture();
  try {
    car.release();
    for (let i = 0; i < 300; i += 1) car.tick();
    const naturallySleeping = car.body.isSleeping();
    car.body.sleep();
    car.controller.setWheelSuspensionRestLength(0, car.definition.wheels[0]!.suspensionRestLength + 0.3);
    const wokeAfterSetter = !car.body.isSleeping();
    car.tick();
    const wokeAfterOneStep = !car.body.isSleeping();
    if (!wokeAfterOneStep) car.body.wakeUp();
    car.tick();
    return { naturallySleeping, forcedSleepForProbe: true, wokeAfterSetter, wokeAfterOneStep,
      explicitWakeUpCalled: !wokeAfterOneStep, awakeAfterFallback: !car.body.isSleeping() };
  } finally { car.physics.dispose(); }
}

async function restTrial(rateMps: number | "instant" | "baseline", initialSpeedMps: number) {
  const car = await fixture();
  try {
    car.release(initialSpeedMps);
    const initiallySleeping = car.body.isSleeping();
    const base = car.definition.wheels[0]!.suspensionRestLength;
    let length = base;
    let maxAppliedRateMps = 0;
    let minLength = base;
    let maxLength = base;
    let explicitWakeUpCalls = 0;
    let setterAutoWakeCount = 0;
    let sample = 0;
    car.hook(() => {
      const time = sample * STEP;
      const target = time >= 0.5 && time < 2.5 && rateMps !== "baseline" ? base + 0.3 : base;
      const limit = rateMps === "instant" ? 0.3 : rateMps === "baseline" ? 0 : rateMps * STEP;
      const next = length + Math.sign(target - length) * Math.min(Math.abs(target - length), limit);
      if (Math.abs(next - length) > 1e-10) {
        const wasSleeping = car.body.isSleeping();
        car.controller.setWheelSuspensionRestLength(0, next);
        if (wasSleeping && !car.body.isSleeping()) setterAutoWakeCount += 1;
        maxAppliedRateMps = Math.max(maxAppliedRateMps, Math.abs(next - length) / STEP);
      }
      // Isolate rate sensitivity from the sleep/wake experiment above: a
      // sleeping controller can accumulate unintegrated velocity. Keep these
      // traces live, including the matched no-change baseline.
      if (car.body.isSleeping()) { car.body.wakeUp(); explicitWakeUpCalls += 1; }
      length = next;
      minLength = Math.min(minLength, length);
      maxLength = Math.max(maxLength, length);
    });
    let previousY = car.body.translation().y;
    let previousVy = 0;
    let previousContacts = car.physics.vehicleState(CAR)!.wheels.map((wheel) => wheel.inContact);
    const contactLossByWheel = [0, 0, 0, 0];
    let airborneWheelSteps = 0;
    let accelerationPeakMps2 = 0;
    let accelerationSquared = 0;
    let pitchRatePeakRadps = 0;
    let rollRatePeakRadps = 0;
    let minSpeedMps = initialSpeedMps;
    let maxSpeedMps = initialSpeedMps;
    for (sample = 0; sample < 360; sample += 1) {
      car.tick();
      const y = car.body.translation().y;
      const vy = (y - previousY) / STEP;
      previousY = y;
      const acceleration = (vy - previousVy) / STEP;
      previousVy = vy;
      accelerationPeakMps2 = Math.max(accelerationPeakMps2, Math.abs(acceleration));
      accelerationSquared += acceleration * acceleration;
      const rates = localRates(car.body);
      pitchRatePeakRadps = Math.max(pitchRatePeakRadps, Math.abs(rates.pitch));
      rollRatePeakRadps = Math.max(rollRatePeakRadps, Math.abs(rates.roll));
      const contacts = car.physics.vehicleState(CAR)!.wheels.map((wheel) => wheel.inContact);
      contacts.forEach((contact, index) => {
        if (!contact) airborneWheelSteps += 1;
        if (!contact && previousContacts[index]) contactLossByWheel[index]! += 1;
      });
      previousContacts = contacts;
      minSpeedMps = Math.min(minSpeedMps, car.speed());
      maxSpeedMps = Math.max(maxSpeedMps, car.speed());
    }
    requireMeasurement(Math.abs(length - base) < 1e-8, "rest length did not return to base");
    requireMeasurement(rateMps === "baseline" || Math.abs(maxLength - base - 0.3) < 1e-8, "rest length never reached base + 0.3 m");
    return {
      rateMps, initialSpeedMps, durationSeconds: 6, minSpeedMps, maxSpeedMps,
      accelerationPeakMps2, accelerationRmsMps2: Math.sqrt(accelerationSquared / 360),
      pitchRatePeakRadps, rollRatePeakRadps, contactLossByWheel,
      contactLossCount: contactLossByWheel.reduce((a, b) => a + b, 0), airborneWheelSteps,
      minRestLengthM: minLength, maxRestLengthM: maxLength, finalRestLengthM: length, maxAppliedRateMps,
      initiallySleeping, keptAwakeForRateComparison: true, explicitWakeUpCalls, setterAutoWakeCount,
    };
  } finally { car.physics.dispose(); }
}

async function restLength() {
  log("A. Rest length: front wheel 0, +0.3 m at 0.5 s, back at 2.5 s; each trace is 6 s.");
  const sleeping = await sleepProbe();
  log(`   Sleep probe: ${JSON.stringify(sleeping)}`);
  const rows: Awaited<ReturnType<typeof restTrial>>[] = [];
  log("   speed | rate m/s | peak/RMS az m/s² | peak pitch/roll rad/s | contact losses | wakeUp calls");
  for (const speed of [0, 10]) {
    for (const rate of ["baseline", "instant", 3, 1, 0.3] as const) {
      const row = await restTrial(rate, speed);
      rows.push(row);
      log(`   ${speed} | ${rate} | ${f(row.accelerationPeakMps2)}/${f(row.accelerationRmsMps2)} | ` +
        `${f(row.pitchRatePeakRadps)}/${f(row.rollRatePeakRadps)} | ${row.contactLossCount} | ${row.explicitWakeUpCalls}`);
      await nextFrame();
    }
  }
  // Explicit exploratory comfort thresholds, not an engine/product acceptance
  // contract. Subtract matched no-change baseline noise before selecting a rate.
  const limits = { extraAccelerationPeakMps2: 3, extraAccelerationRmsMps2: 0.75, extraAngularRatePeakRadps: 0.5, contactLossCount: 0 };
  const assessments = rows.filter((row) => row.rateMps !== "baseline").map((row) => {
    const baseline = rows.find((r) => r.rateMps === "baseline" && r.initialSpeedMps === row.initialSpeedMps)!;
    const passes = baseline.contactLossCount === 0 && sleeping.awakeAfterFallback && row.contactLossCount === 0 &&
      row.accelerationPeakMps2 - baseline.accelerationPeakMps2 <= limits.extraAccelerationPeakMps2 &&
      row.accelerationRmsMps2 - baseline.accelerationRmsMps2 <= limits.extraAccelerationRmsMps2 &&
      row.pitchRatePeakRadps - baseline.pitchRatePeakRadps <= limits.extraAngularRatePeakRadps &&
      row.rollRatePeakRadps - baseline.rollRatePeakRadps <= limits.extraAngularRatePeakRadps;
    return { rateMps: row.rateMps, initialSpeedMps: row.initialSpeedMps, passes };
  });
  const recommendedMaxChangeRateMps = [3, 1, 0.3].find((rate) => assessments.filter((r) => r.rateMps === rate).every((r) => r.passes)) ?? null;
  log(`   Provisional max rate: ${recommendedMaxChangeRateMps === null ? "none passed; use visual-only fallback" : `${recommendedMaxChangeRateMps} m/s`}; heuristic limits ${JSON.stringify(limits)}`);
  return { sleeping, limits, verticalAccelerationMethod: "second finite difference of chassis translation.y at 60 Hz; avoids sleeping-controller linvel artifacts",
    recommendationBasis: "fastest tested finite rate passing both speeds against matched baseline; heuristic comfort limits",
    recommendedMaxChangeRateMps, assessments, rows };
}

// --- B. equivalent resistance, coast-down and released-handbrake ramp ----------------------

const RESISTANCE_PER_SECOND = 0.35;
type ResistanceMethod = "none" | "wheel-brake" | "chassis-impulse" | "provider-mud";

function resistance(car: Fixture, method: ResistanceMethod): { providerCalls: () => number } {
  let providerCalls = 0;
  if (method === "provider-mud") {
    const provider = createPhysicalMaterialSurfaceProvider((id) => car.physics.colliderPhysicalMaterialId(id));
    car.physics.setVehicleSurfaceProvider((...args) => { providerCalls += 1; return provider(...args); });
  }
  car.hook(() => {
    const speed = car.speed();
    if (method === "wheel-brake") {
      const count = car.definition.wheels.filter((_, i) => car.controller.wheelIsInContact(i)).length;
      const impulse = car.definition.massKg * RESISTANCE_PER_SECOND * Math.abs(speed) * STEP;
      car.definition.wheels.forEach((_, i) => car.controller.setWheelBrake(i,
        count > 0 && car.controller.wheelIsInContact(i) ? impulse / count : 0));
    } else if (method === "chassis-impulse") {
      if (car.definition.wheels.some((_, i) => car.controller.wheelIsInContact(i))) {
        const impulse = -car.definition.massKg * Math.min(1, RESISTANCE_PER_SECOND * STEP) * speed;
        car.body.applyImpulse({ x: 0, y: car.tangent.y * impulse, z: car.tangent.z * impulse }, false);
      }
    }
  });
  return { providerCalls: () => providerCalls };
}

async function coastTrial(method: ResistanceMethod) {
  const car = await fixture();
  try {
    car.release(15);
    const instrument = resistance(car, method);
    let distanceM = 0;
    let previous = car.body.translation();
    let belowStopSteps = 0;
    let candidateStopSeconds = 0;
    let candidateStopDistanceM = 0;
    let timeToStopSeconds: number | null = null;
    let distanceToStopM: number | null = null;
    let steps = 0;
    let observedSpeedMps = 15;
    for (steps = 1; steps <= 2400; steps += 1) {
      car.tick();
      const p = car.body.translation();
      distanceM += Math.hypot(p.x - previous.x, p.z - previous.z);
      observedSpeedMps = (p.z - previous.z) / STEP;
      previous = p;
      if (Math.abs(observedSpeedMps) < 0.1) {
        if (belowStopSteps === 0) { candidateStopSeconds = steps * STEP; candidateStopDistanceM = distanceM; }
        belowStopSteps += 1;
        if (belowStopSteps >= 60) {
          timeToStopSeconds = candidateStopSeconds;
          distanceToStopM = candidateStopDistanceM;
          break;
        }
      } else belowStopSteps = 0;
    }
    if (method === "provider-mud") requireMeasurement(instrument.providerCalls() > 0, "mud provider was not queried");
    return { method, initialSpeedMps: 15, distanceM, distanceToStopM, timeToStopSeconds,
      observedSeconds: Math.min(steps, 2400) * STEP, finalSpeedMps: observedSpeedMps, sleepingAtEnd: car.body.isSleeping(),
      censored: timeToStopSeconds === null, providerCalls: instrument.providerCalls() };
  } finally { car.physics.dispose(); }
}

async function rampTrial(method: ResistanceMethod) {
  const car = await fixture(8);
  try {
    car.release();
    const instrument = resistance(car, method);
    const start = car.body.translation();
    let previousPosition = start;
    let previousSpeed = 0;
    let previousVy = 0;
    let peakVerticalAccelerationMps2 = 0;
    let reversalCount = 0;
    let lastDirection = 0;
    const tailSpeeds: number[] = [];
    const tailDeltaSpeeds: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      car.tick();
      const p = car.body.translation();
      const speed = ((p.y - previousPosition.y) * car.tangent.y + (p.z - previousPosition.z) * car.tangent.z) / STEP;
      const vy = (p.y - previousPosition.y) / STEP;
      previousPosition = p;
      peakVerticalAccelerationMps2 = Math.max(peakVerticalAccelerationMps2, Math.abs(vy - previousVy) / STEP);
      previousVy = vy;
      if (i >= 480) {
        tailSpeeds.push(speed);
        tailDeltaSpeeds.push(speed - previousSpeed);
        const direction = Math.abs(speed) > 0.002 ? Math.sign(speed) : 0;
        if (direction !== 0 && lastDirection !== 0 && direction !== lastDirection) reversalCount += 1;
        if (direction !== 0) lastDirection = direction;
      }
      previousSpeed = speed;
    }
    const end = car.body.translation();
    const downhillDisplacementM = -(end.y - start.y) * car.tangent.y - (end.z - start.z) * car.tangent.z;
    const meanTailAbsSpeedMps = tailSpeeds.reduce((sum, v) => sum + Math.abs(v), 0) / tailSpeeds.length;
    const tailDeltaSpeedRmsMps = Math.sqrt(tailDeltaSpeeds.reduce((sum, v) => sum + v * v, 0) / tailDeltaSpeeds.length);
    const held = Math.abs(downhillDisplacementM) < 0.05 && meanTailAbsSpeedMps < 0.01;
    const jitterAtRest = meanTailAbsSpeedMps < 0.05 && (reversalCount >= 4 || tailDeltaSpeedRmsMps > 0.005);
    const stoppedAfterDrift = !held && meanTailAbsSpeedMps < 0.01 && !jitterAtRest;
    const behaviour = jitterAtRest ? "jitter at rest" : held ? "held" : stoppedAfterDrift ? "stopped after drift" : meanTailAbsSpeedMps < 0.25 ? "creep" : "rolls downhill";
    return { method, slopeDeg: 8, handbrake: false, durationSeconds: 10, downhillDisplacementM,
      finalSpeedMps: previousSpeed, meanTailAbsSpeedMps, tailDeltaSpeedRmsMps, sleepingAtEnd: car.body.isSleeping(),
      reversalCount, peakVerticalAccelerationMps2, held, stoppedAfterDrift, jitterAtRest, behaviour, providerCalls: instrument.providerCalls() };
  } finally { car.physics.dispose(); }
}

async function rollingResistance() {
  log("B. Resistance: brake impulse cap versus opposing chassis impulse, F = mass × 0.35/s × |ground-tangent speed|.");
  log("   Both vanish at rest. Built-in rolling brake/damping/aero are disabled. Mud is the actual preset, NOT force-matched.");
  const methods: ResistanceMethod[] = ["none", "wheel-brake", "chassis-impulse"];
  if (typeof PhysicsSubsystem.prototype.setVehicleSurfaceProvider === "function") methods.push("provider-mud");
  const coast: Awaited<ReturnType<typeof coastTrial>>[] = [];
  const ramp: Awaited<ReturnType<typeof rampTrial>>[] = [];
  for (const method of methods) {
    const c = await coastTrial(method);
    const r = await rampTrial(method);
    coast.push(c);
    ramp.push(r);
    log(`   ${method}: coast ${f(c.distanceM)} m; stop ${c.timeToStopSeconds === null ? "not reached within 40 s" : `${f(c.timeToStopSeconds)} s`}; ` +
      `8° ramp ${r.behaviour}, downhill ${f(r.downhillDisplacementM)} m, tail |v| ${f(r.meanTailAbsSpeedMps)} m/s, reversals ${r.reversalCount}`);
    await nextFrame();
  }
  const brakeWronglyHoldsRamp = ramp.find((r) => r.method === "none")!.behaviour === "rolls downhill" &&
    ramp.find((r) => r.method === "wheel-brake")!.held;
  return { resistancePerSecond: RESISTANCE_PER_SECOND, formula: "F = mass * k * abs(ground-tangent speed); brake = F * dt / contacting wheels; impulse = -mass * min(k * dt, 1) * tangentVelocity",
    measurementMethod: "reported speed/acceleration from pose differences (sleep-safe); resistance commands use solver velocity",
    stopCriterion: "abs(tangent speed) < 0.1 m/s sustained for 1 s; first qualifying time/distance; 40 s timeout is censored",
    rampCriteria: "last 2 s: held < 0.05 m displacement and < 0.01 m/s; creep < 0.25 m/s; jitter at rest < 0.05 m/s and >= 4 reversals (>0.002 m/s) or delta-speed RMS >0.005 m/s",
    mudSample: resolveSurfaceSample("mud"), mudForceMatched: false, brakeWronglyHoldsRamp, coast, ramp };
}

// --- C. R8 full upload versus one packed dirty-rectangle upload -----------------------------

interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

async function textureUpload() {
  const size = 512;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  document.querySelector("#texture")!.append(renderer.domElement);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  const data = new Uint8Array(size * size);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.internalFormat = "R8";
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { field: { value: texture } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D field; varying vec2 vUv; void main() { float v = texture2D(field, vUv).r; gl_FragColor = vec4(v, v, v, 1.0); }",
    depthTest: false, depthWrite: false,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const results = [];
  log(`C. 512² R8: 300 frames per variant, seeded 8–64 px rectangles; GPU ${gpu}; timer ${ext ? "available" : "unavailable"}.`);
  // r184 WebGLTextures.updateTexture hardcodes componentStride=4 (RGBA only).
  // R8 addUpdateRange would address the wrong pixels; use a packed rectangle
  // and the actual renderer-owned WebGLTexture via its state binding cache.
  try {
    for (const variant of ["full", "partial"] as const) {
      data.fill(0);
      texture.needsUpdate = true;
      renderer.render(scene, camera);
      const handle = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
      requireMeasurement(!!handle, "Three did not allocate the R8 WebGLTexture");
      for (let warm = 0; warm < 30; warm += 1) {
        await nextFrame();
        texture.needsUpdate = true;
        renderer.render(scene, camera);
      }
      const rand = random(SEED);
      const renderCpu: number[] = [];
      const uploadRenderCpu: number[] = [];
      const mutationCpu: number[] = [];
      const gpuMs: number[] = [];
      const pending: WebGLQuery[] = [];
      const dirtyAreas: number[] = [];
      let disjoint = false;
      let queryFailures = 0;
      const poll = (): void => {
        if (!ext) return;
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true;
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          const query = pending[i]!;
          if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
          gpuMs.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
          gl.deleteQuery(query);
          pending.splice(i, 1);
        }
      };
      try {
        for (let frame = 0; frame < 300; frame += 1) {
          await nextFrame();
          requireMeasurement(!renderer.getContext().isContextLost(), "WebGL context lost");
          poll();
          const width = 8 + Math.floor(rand() * 57);
          const height = 8 + Math.floor(rand() * 57);
          const x = Math.floor(rand() * (size - width + 1));
          const y = Math.floor(rand() * (size - height + 1));
          const mutationStart = performance.now();
          for (let row = y; row < y + height; row += 1) {
            for (let col = x; col < x + width; col += 1) data[row * size + col] = Math.floor(rand() * 256);
          }
          mutationCpu.push(performance.now() - mutationStart);
          dirtyAreas.push(width * height);
          const query = ext ? gl.createQuery() : null;
          if (ext && !query) queryFailures += 1;
          const uploadStart = performance.now();
          let packed: Uint8Array | null = null;
          if (variant === "partial") {
            packed = new Uint8Array(width * height);
            for (let row = 0; row < height; row += 1) {
              packed.set(data.subarray((y + row) * size + x, (y + row) * size + x + width), row * width);
            }
          }
          if (query && ext) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          if (variant === "full") texture.needsUpdate = true;
          else {
            renderer.state.activeTexture(gl.TEXTURE0);
            renderer.state.bindTexture(gl.TEXTURE_2D, handle!, gl.TEXTURE0);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RED, gl.UNSIGNED_BYTE, packed);
          }
          const renderStart = performance.now();
          renderer.render(scene, camera);
          const renderEnd = performance.now();
          if (query && ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
          renderCpu.push(renderEnd - renderStart);
          uploadRenderCpu.push(renderEnd - uploadStart);
        }
        // Poll asynchronously; never gl.finish or synchronously wait for a query.
        for (let drain = 0; pending.length > 0 && drain < 120; drain += 1) { await nextFrame(); poll(); }
        // Outside timed regions: verify the sampled quad against the CPU bytes,
        // catching bad format, stale binding, row stride and flipped coordinates.
        renderer.render(scene, camera);
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let mismatches = 0;
        let checksum = 2166136261;
        for (let i = 0; i < data.length; i += 1) {
          if (Math.abs(pixels[i * 4]! - data[i]!) > 1) mismatches += 1;
          checksum = Math.imul(checksum ^ data[i]!, 16777619) >>> 0;
        }
        const glError = gl.getError();
        requireMeasurement(glError === gl.NO_ERROR, `WebGL error ${glError} during ${variant} upload`);
        requireMeasurement(mismatches === 0, `${variant} R8 readback mismatches: ${mismatches}`);
        const row = { variant, frames: 300, warmupFrames: 30, renderCpuMs: stats(renderCpu),
          uploadAndRenderCpuMs: stats(uploadRenderCpu), mutationCpuMs: stats(mutationCpu),
          gpuUploadAndRenderMs: stats(disjoint ? [] : gpuMs),
          gpuStatus: !ext ? "unsupported" : disjoint ? "disjoint; all samples discarded" : pending.length || queryFailures ? "incomplete" : "complete",
          pendingQueries: pending.length, queryFailures, dirtyAreaPixels: stats(dirtyAreas), checksum, readbackMismatches: mismatches };
        results.push(row);
        log(`   ${variant}: render CPU mean/p95 ${f(row.renderCpuMs.mean!)}/${f(row.renderCpuMs.p95!)} ms; ` +
          `upload+render CPU ${f(row.uploadAndRenderCpuMs.mean!)}/${f(row.uploadAndRenderCpuMs.p95!)} ms; ` +
          `GPU ${row.gpuUploadAndRenderMs.mean === null ? row.gpuStatus : `${f(row.gpuUploadAndRenderMs.mean)}/${f(row.gpuUploadAndRenderMs.p95!)} ms (${row.gpuStatus})`}`);
      } finally { pending.forEach((query) => gl.deleteQuery(query)); }
    }
    requireMeasurement(results[0]!.checksum === results[1]!.checksum, "full/partial did not replay identical mutations");
    return { threeRevision: THREE.REVISION, size, format: "R8 / RedFormat / UnsignedByteType", gpu,
      timerExtensionAvailable: !!ext, seed: SEED, partialMethod: "packed dirty rectangle + renderer.state.bindTexture + gl.texSubImage2D",
      updateRangeFinding: "installed r184 WebGLTextures.updateTexture hardcodes componentStride=4; addUpdateRange is unsuitable for R8",
      timingScope: "render CPU only excludes explicit partial upload; upload+render CPU includes partial packing/allocation; GPU covers upload+draw, not mutation or CPU packing; no finish; disjoint invalidates entire variant",
      order: "full then partial; 30 warm-up frames each; identical 300 seeded mutations; 512x512 framebuffer, DPR 1, no MSAA/mipmaps",
      results };
  } finally { texture.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); }
}

async function run(): Promise<void> {
  const report: Record<string, unknown> = {
    spike: "terrain-deformation", status: "running", seed: SEED, fixedTimestepSeconds: STEP,
    userAgent: navigator.userAgent, startedAt: new Date().toISOString(),
    physicsSetup: "real PhysicsSubsystem and createReferenceCarDefinition; 2048 m box ground; zero body damping, rollingResistanceForce=0; reference defaults have no drivetrain or aerodynamic drag; 10 s handbrake settling per fixture",
    scope: "Faz 0 rest length, resistance, texture upload only; terrain recognition deferred to OPEN_WORLD Faz 3",
  };
  const errors: string[] = [];
  for (const [name, experiment] of [["restLength", restLength], ["rollingResistance", rollingResistance], ["textureUpload", textureUpload]] as const) {
    try { report[name] = await experiment(); }
    catch (error: unknown) {
      const message = `${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
      errors.push(message);
      log(`FAILED ${message}`);
    }
    await nextFrame();
  }
  report.status = errors.length ? "failed" : "complete";
  report.errors = errors;
  document.querySelector("#report")!.textContent = JSON.stringify(report, null, 2);
  (window as Window & { __spikeReport?: unknown }).__spikeReport = report;
  log(`Done: ${report.status}. JSON is in window.__spikeReport.`);
}

void run();
