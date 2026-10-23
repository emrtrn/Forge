/** Terrain deformation Faz 4: pure curves and vehicle presentation with recording services. */
import assert from "node:assert/strict";
import { Group } from "three";
import type { AudioPlaybackHandle, AudioPlayOptions } from "../../engine/audio/audioSubsystem";
import { wheelSurfaceFxLevels } from "../../engine/physics/surface/wheelSurfaceFx";
import type { VehicleState, VehicleWheelState } from "../../engine/physics/vehicle/vehicleTypes";
import { PHYSICAL_MATERIALS, type PhysicalMaterialDef } from "../../engine/scene/collision";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  audioCommandsService,
  vehicleHostService,
  vfxCommandsService,
  type AudioCommands,
  type VehicleHost,
  type VfxCommands,
  type VfxEffectHandle,
  type VfxSpawnOptions,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import { createVehicleModule } from "../../src/scene/capabilities/vehicleModule";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

class FakeEmitter implements VfxEffectHandle {
  rate = -1;
  position: number[] = [];
  readonly stops: boolean[] = [];
  disposed = false;
  setTransform(position: [number, number, number]): void { this.position = [...position]; }
  setEmissionRate(rate: number): void { this.rate = rate; }
  stop(fadeOut = true): void { this.stops.push(fadeOut); }
  dispose(): void { this.disposed = true; }
}

class FakeVoice implements AudioPlaybackHandle {
  stopped = false;
  volume = 0;
  pitch = 1;
  position: number[] = [];
  readonly stops: number[] = [];
  constructor(readonly clipId: string, options: AudioPlayOptions) {
    this.volume = options.volume ?? 1;
    this.pitch = options.pitch ?? 1;
    this.position = [...(options.position ?? [])];
  }
  stop(fadeSeconds = 0): void { this.stops.push(fadeSeconds); this.stopped = true; }
  setVolume(value: number): void { this.volume = value; }
  setPitch(value: number): void { this.pitch = value; }
  setPosition(position: readonly [number, number, number]): void { this.position = [...position]; }
  setPaused(): void {}
}

const EFFECT_SURFACE: PhysicalMaterialDef = {
  friction: 0.5, restitution: 0, wheelEffect: "Effects/spray.effect.json", wheelSound: "S_Tyre",
};

function harness(options: { deferred?: boolean; vfx?: boolean; audio?: boolean; lookup?: boolean } = {}) {
  const object = new Group();
  const ids = ["car"];
  const wheel = {
    position: [0, 0, 0] as [number, number, number], radius: 0.5, suspensionLength: 0.3,
    steering: 0, rotation: 0, inContact: true, groundEntityId: "ground" as string | null,
    contactPoint: [1, 2, 3] as [number, number, number] | null, hardPoint: null,
  };
  const state = { forwardSpeed: 5, engineLoad: 0, wheels: [wheel], drivetrain: null } satisfies VehicleState;
  const settings = { active: true, driven: false, possessed: null as string | null, available: true };
  const materials = new Map<string, PhysicalMaterialDef>([["ground", EFFECT_SURFACE]]);
  const requests: { effect: string; options: VfxSpawnOptions; handle: FakeEmitter }[] = [];
  const pending: { resolve: (handle: VfxEffectHandle | null) => void; reject: (error: Error) => void }[] = [];
  const voices: FakeVoice[] = [];
  let lookups = 0;
  const host: VehicleHost = {
    vehicleIds: () => ids,
    vehicleState: () => settings.available ? state : null,
    vehicleDefinition: () => null,
    actorObject: () => object,
    isDriven: () => settings.driven,
    possessedEntityId: () => settings.possessed,
    setVehicleInput: () => {},
    isSurfaceFxActive: () => settings.active,
    ...(options.lookup === false ? {} : {
      surfaceMaterialForWheel: (_id: string, contact: VehicleWheelState) => {
        lookups++;
        return materials.get(contact.groundEntityId ?? "") ?? null;
      },
    }),
  };
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  services.provide(vehicleHostService, host);
  if (options.vfx !== false) {
    services.provide(vfxCommandsService, {
      createEffectEmitter(effect: string, spawn: VfxSpawnOptions) {
        const handle = new FakeEmitter();
        requests.push({ effect, options: { position: [...spawn.position] }, handle });
        return options.deferred
          ? new Promise<VfxEffectHandle | null>((resolve, reject) => pending.push({ resolve, reject }))
          : Promise.resolve(handle);
      },
    } as unknown as VfxCommands);
  }
  if (options.audio !== false) {
    services.provide(audioCommandsService, {
      playLoop(sound: string, play: AudioPlayOptions) {
        const voice = new FakeVoice(sound, play);
        voices.push(voice);
        return voice;
      },
    } as unknown as AudioCommands);
  }
  const module = createVehicleModule();
  module.onRuntimeStart!(services);
  const tick = () => {
    for (const contact of state.wheels) contact.rotation += state.forwardSpeed / contact.radius / 60;
    module.update!(1 / 60);
  };
  return { module, tick, ids, wheel, state, settings, materials, requests, pending, voices, lookups: () => lookups };
}

/** Flush emitter installation and its rejection handler without timers or browser services. */
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

export async function registerWheelSurfaceFxTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("wheel surface fx: airborne, stopped and invalid inputs produce zero output", () => {
    const zero = { emissionRate: 0, soundVolume: 0, soundPitch: 0 };
    const moving = { inContact: true, wheelSpeed: 12, groundSpeed: 5, chassisSpeed: 5 };
    assert.deepEqual(wheelSurfaceFxLevels({ ...moving, inContact: false }), zero);
    assert.deepEqual(wheelSurfaceFxLevels({ ...moving, wheelSpeed: 0, groundSpeed: 0, chassisSpeed: 0 }), zero);
    for (const key of ["wheelSpeed", "groundSpeed", "chassisSpeed"] as const) {
      for (const value of [NaN, Infinity, -Infinity]) {
        assert.deepEqual(wheelSurfaceFxLevels({ ...moving, [key]: value }), zero);
      }
    }
  });

  check("wheel surface fx: curves rise with speed and slip, clamp and mirror reverse", () => {
    const slow = wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 3, groundSpeed: 3, chassisSpeed: 3 });
    const fast = wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 12, groundSpeed: 12, chassisSpeed: 12 });
    const slip = wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 12, groundSpeed: 3, chassisSpeed: 12 });
    for (const key of ["emissionRate", "soundVolume", "soundPitch"] as const) {
      assert.ok(slow[key] < fast[key]);
      assert.ok(fast[key] < slip[key]);
    }
    assert.deepEqual(wheelSurfaceFxLevels({ inContact: true, wheelSpeed: -12, groundSpeed: -3, chassisSpeed: -12 }), slip);
    assert.deepEqual(wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 1e6, groundSpeed: 0, chassisSpeed: 0 }),
      { emissionRate: 1, soundVolume: 1, soundPitch: 2 });
    assert.deepEqual(wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 15, groundSpeed: -15, chassisSpeed: 15 }),
      { emissionRate: 1, soundVolume: 1, soundPitch: 2 });
  });

  check("wheel surface fx: documented rolling curve reuses caller output", () => {
    const out = { emissionRate: -1, soundVolume: -1, soundPitch: -1 };
    assert.equal(wheelSurfaceFxLevels({ inContact: true, wheelSpeed: 7.5, groundSpeed: 7.5, chassisSpeed: 7.5 }, out), out);
    assert.deepEqual(out, { emissionRate: 0.1, soundVolume: 0.15, soundPitch: 1.125 });
    wheelSurfaceFxLevels({ inContact: false, wheelSpeed: 7.5, groundSpeed: 7.5, chassisSpeed: 7.5 }, out);
    assert.deepEqual(out, { emissionRate: 0, soundVolume: 0, soundPitch: 0 });
  });

  check("wheel surface fx: built-in presets and absent lookup make no effect or sound calls", () => {
    const h = harness();
    for (const material of Object.values(PHYSICAL_MATERIALS)) {
      assert.equal(material.wheelEffect, undefined);
      assert.equal(material.wheelSound, undefined);
      h.materials.set("ground", material);
      h.tick();
    }
    assert.equal(h.requests.length, 0);
    assert.equal(h.voices.length, 0);
    h.module.dispose!();
    const absent = harness({ lookup: false });
    absent.tick();
    assert.equal(absent.requests.length + absent.voices.length, 0);
    absent.module.dispose!();
  });

  await checkAsync("wheel surface fx: one emitter and loop per wheel follow contacts and spin", async () => {
    const h = harness();
    h.state.wheels.push({ ...h.wheel, contactPoint: [4, 5, 6] });
    h.tick();
    await settle();
    assert.equal(h.requests.length, 2);
    assert.equal(h.voices.length, 2);
    assert.equal(h.requests[0]!.effect, EFFECT_SURFACE.wheelEffect);
    assert.equal(h.voices[0]!.clipId, EFFECT_SURFACE.wheelSound);
    const emitter = h.requests[0]!.handle;
    const rollingRate = emitter.rate;
    const rollingVolume = h.voices[0]!.volume;
    const rollingPitch = h.voices[0]!.pitch;
    h.wheel.contactPoint = [7, 8, 9];
    h.wheel.rotation += 1;
    h.tick();
    assert.deepEqual(emitter.position, [7, 8, 9]);
    assert.deepEqual(h.voices[0]!.position, [7, 8, 9]);
    assert.deepEqual(h.requests[1]!.handle.position, [4, 5, 6]);
    assert.ok(emitter.rate > rollingRate);
    assert.ok(h.voices[0]!.volume > rollingVolume);
    assert.ok(h.voices[0]!.pitch > rollingPitch);
    for (let frame = 0; frame < 20; frame++) h.tick();
    assert.equal(h.requests.length, 2);
    assert.equal(h.voices.length, 2);
    h.module.dispose!();
  });

  await checkAsync("wheel surface fx: surface switch fades old handles and keys each asset independently", async () => {
    const h = harness();
    h.tick();
    await settle();
    h.materials.set("other", { ...EFFECT_SURFACE, wheelEffect: "FX_Other", wheelSound: "Cue_Other" });
    h.wheel.groundEntityId = "other";
    h.tick();
    await settle();
    assert.deepEqual(h.requests[0]!.handle.stops, [true]);
    assert.deepEqual(h.voices[0]!.stops, [0.2]);
    assert.equal(h.requests[1]!.effect, "FX_Other");
    assert.equal(h.voices[1]!.clipId, "Cue_Other");
    h.materials.set("other", { ...EFFECT_SURFACE, wheelEffect: "FX_Other" });
    h.tick();
    assert.equal(h.requests.length, 2, "unchanged effect keeps its emitter");
    assert.equal(h.voices.length, 3);
    h.materials.set("other", PHYSICAL_MATERIALS.default!);
    h.tick();
    assert.deepEqual(h.requests[1]!.handle.stops, [true]);
    assert.equal(h.voices[2]!.stopped, true);
    h.tick();
    assert.equal(h.requests.length, 2);
    assert.equal(h.voices.length, 3);
    h.module.dispose!();
  });

  await checkAsync("wheel surface fx: airborne and stopped wheels idle without recreating handles", async () => {
    const h = harness();
    h.tick();
    await settle();
    const lookups = h.lookups();
    h.wheel.inContact = false;
    h.wheel.groundEntityId = null;
    h.wheel.contactPoint = null;
    h.tick();
    assert.equal(h.requests[0]!.handle.rate, 0);
    assert.equal(h.voices[0]!.volume, 0);
    assert.equal(h.lookups(), lookups);
    h.wheel.inContact = true;
    h.wheel.groundEntityId = "ground";
    h.wheel.contactPoint = [1, 2, 3];
    h.state.forwardSpeed = 0;
    h.tick();
    assert.equal(h.requests[0]!.handle.rate, 0);
    assert.equal(h.voices[0]!.volume, 0);
    h.state.forwardSpeed = 5;
    h.tick();
    assert.ok(h.requests[0]!.handle.rate > 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.voices.length, 1);
    h.module.dispose!();
  });

  await checkAsync("wheel surface fx: vehicle, level and module unload dispose every current handle", async () => {
    for (const unload of ["vehicle", "level", "module", "state", "wheel"] as const) {
      const h = harness();
      h.tick();
      await settle();
      if (unload === "vehicle") { h.ids.length = 0; h.tick(); }
      if (unload === "level") h.module.onLevelUnloaded!();
      if (unload === "module") h.module.dispose!();
      if (unload === "state") { h.settings.available = false; h.tick(); }
      if (unload === "wheel") { h.state.wheels.length = 0; h.tick(); }
      assert.equal(h.requests[0]!.handle.disposed, true, unload);
      assert.deepEqual(h.voices[0]!.stops, [0], unload);
      if (unload === "level") {
        h.tick();
        await settle();
        assert.equal(h.requests.length, 2, "new level gets fresh handles");
      }
      if (unload !== "module") h.module.dispose!();
    }
  });

  await checkAsync("wheel surface fx: active radius gates nearby cars but always includes driven or possessed cars", async () => {
    const h = harness();
    h.settings.active = false;
    h.tick();
    assert.equal(h.requests.length + h.voices.length, 0);
    h.settings.active = true;
    h.tick();
    await settle();
    h.settings.active = false;
    h.tick();
    assert.equal(h.requests[0]!.handle.disposed, true);
    assert.equal(h.voices[0]!.stopped, true);
    h.settings.driven = true;
    h.tick();
    await settle();
    assert.equal(h.requests.length, 2);
    h.settings.driven = false;
    h.settings.possessed = "car";
    h.tick();
    assert.equal(h.requests.length, 2);
    h.settings.possessed = null;
    h.tick();
    assert.equal(h.requests[1]!.handle.disposed, true);
    h.module.dispose!();
  });

  await checkAsync("wheel surface fx: delayed effects cannot survive surface switch or any unload", async () => {
    for (const unload of ["switch", "vehicle", "level", "module", "wheel"] as const) {
      const h = harness({ deferred: true });
      h.tick();
      if (unload === "switch") { h.materials.set("ground", PHYSICAL_MATERIALS.default!); h.tick(); }
      if (unload === "vehicle") { h.ids.length = 0; h.tick(); }
      if (unload === "level") h.module.onLevelUnloaded!();
      if (unload === "module") h.module.dispose!();
      if (unload === "wheel") { h.state.wheels.length = 0; h.tick(); }
      h.pending[0]!.resolve(h.requests[0]!.handle);
      await settle();
      assert.equal(h.requests[0]!.handle.disposed, true, unload);
      if (unload !== "module") h.module.dispose!();
    }
  });

  await checkAsync("wheel surface fx: delayed effect installs latest contact and airborne zero rate", async () => {
    const h = harness({ deferred: true });
    h.tick();
    h.wheel.contactPoint = [8, 7, 6];
    h.tick();
    h.wheel.inContact = false;
    h.tick();
    h.pending[0]!.resolve(h.requests[0]!.handle);
    await settle();
    assert.deepEqual(h.requests[0]!.handle.position, [8, 7, 6]);
    assert.equal(h.requests[0]!.handle.rate, 0);
    h.module.dispose!();
  });

  await checkAsync("wheel surface fx: missing or rejected effects and refused voices are not retried each frame", async () => {
    for (const rejected of [false, true]) {
      const h = harness({ deferred: true });
      h.tick();
      if (rejected) h.pending[0]!.reject(new Error("load failed"));
      else h.pending[0]!.resolve(null);
      await settle();
      h.voices[0]!.stopped = true;
      for (let frame = 0; frame < 10; frame++) h.tick();
      assert.equal(h.requests.length, 1);
      assert.equal(h.voices.length, 1);
      h.module.dispose!();
    }
  });

  await checkAsync("wheel surface fx: effect and sound opt in independently and tolerate absent capabilities", async () => {
    for (const mode of ["effect", "sound", "no-vfx", "no-audio", "neither"] as const) {
      const h = harness({ vfx: mode !== "no-vfx" && mode !== "neither", audio: mode !== "no-audio" && mode !== "neither" });
      if (mode === "effect") h.materials.set("ground", { friction: 0.5, restitution: 0, wheelEffect: "FX_Only" });
      if (mode === "sound") h.materials.set("ground", { friction: 0.5, restitution: 0, wheelSound: "S_Only" });
      h.tick();
      await settle();
      assert.equal(h.requests.length, mode === "effect" || mode === "no-audio" ? 1 : 0, mode);
      assert.equal(h.voices.length, mode === "sound" || mode === "no-vfx" ? 1 : 0, mode);
      h.module.dispose!();
    }
  });
}
