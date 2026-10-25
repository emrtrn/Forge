/** Per-wheel presentation ownership, independent of render objects and physics mutation. */
import type { AudioPlaybackHandle } from "@engine/audio/audioSubsystem";
import { Quaternion, Vector3 } from "three";
import {
  wheelSurfaceFxLevels,
  type WheelSurfaceFxInput,
  type WheelSurfaceFxLevels,
} from "@engine/physics/surface/wheelSurfaceFx";
import type { VehicleState } from "@engine/physics/vehicle/vehicleTypes";
import type { AudioCommands, VehicleHost, VfxCommands, VfxEffectHandle } from "./runtimeServiceKeys";

const SOUND_FADE_SECONDS = 0.2;
const VOLUME_RAMP_SECONDS = 0.08;

interface WheelPresentation {
  rotation: number;
  effect: string | undefined;
  sound: string | undefined;
  emitter: VfxEffectHandle | null;
  voice: AudioPlaybackHandle | null;
  generation: number;
  readonly position: [number, number, number];
  readonly direction: [number, number, number];
  travel: number;
  readonly input: WheelSurfaceFxInput;
  readonly levels: WheelSurfaceFxLevels;
}

export class WheelSurfacePresentation {
  private readonly wheels: WheelPresentation[] = [];
  private disposed = false;
  private readonly worldRotation = new Quaternion();
  private readonly forward = new Vector3();

  update(
    host: VehicleHost,
    entityId: string,
    state: VehicleState,
    deltaSeconds: number,
    vfx: VfxCommands | undefined,
    audio: AudioCommands | undefined,
  ): void {
    const object = host.actorObject(entityId);
    if (object) object.getWorldQuaternion(this.worldRotation);
    else this.worldRotation.identity();
    this.forward.set(0, 0, 1).applyQuaternion(this.worldRotation);
    const heading = Math.atan2(this.forward.x, this.forward.z);
    for (let index = state.wheels.length; index < this.wheels.length; index++) {
      this.release(this.wheels[index]!);
    }
    this.wheels.length = Math.min(this.wheels.length, state.wheels.length);
    for (let index = 0; index < state.wheels.length; index++) {
      const wheel = state.wheels[index]!;
      let slot = this.wheels[index];
      const previousRotation = slot?.rotation;
      if (!slot) {
        slot = {
          rotation: wheel.rotation, effect: undefined, sound: undefined, emitter: null, voice: null,
          generation: 0, position: [0, 0, 0], direction: [0, 0.6, -0.8], travel: 1,
          input: { inContact: false, wheelSpeed: 0, groundSpeed: 0, chassisSpeed: 0 },
          levels: { emissionRate: 0, soundVolume: 0, soundPitch: 0 },
        };
        this.wheels.push(slot);
      }
      slot.input.inContact = wheel.inContact && wheel.contactPoint !== null && Number.isFinite(deltaSeconds) && deltaSeconds > 0;
      slot.input.wheelSpeed = previousRotation === undefined ? state.forwardSpeed
        : deltaSeconds > 0 && Number.isFinite(deltaSeconds)
          ? (wheel.rotation - previousRotation) * wheel.radius / deltaSeconds : 0;
      slot.input.groundSpeed = state.forwardSpeed * Math.cos(wheel.steering);
      slot.input.chassisSpeed = state.forwardSpeed;
      slot.input.tractionSlip = wheel.tractionSlip;
      slot.rotation = wheel.rotation;
      wheelSurfaceFxLevels(slot.input, slot.levels);
      const travelSpeed = Math.abs(slot.input.wheelSpeed) > 0.05 ? slot.input.wheelSpeed : state.forwardSpeed;
      if (Math.abs(travelSpeed) > 0.05) slot.travel = Math.sign(travelSpeed);
      slot.direction[0] = -Math.sin(heading + wheel.steering) * slot.travel * 0.8;
      slot.direction[1] = 0.6;
      slot.direction[2] = -Math.cos(heading + wheel.steering) * slot.travel * 0.8;
      // Keep the current handles while airborne, idled at zero, rather than
      // reloading assets every time a suspension ray briefly loses contact.
      if (slot.input.inContact) {
        const point = wheel.contactPoint!;
        slot.position[0] = point[0];
        slot.position[1] = point[1] - (wheel.sinkDepth ?? 0);
        slot.position[2] = point[2];
        const material = host.surfaceMaterialForWheel?.(entityId, wheel);
        const effect = vfx ? material?.wheelEffect : undefined;
        const sound = audio ? material?.wheelSound : undefined;
        if (effect !== slot.effect) {
          // Stopped particles finish in the VFX runtime's own recycling pool.
          slot.emitter?.stop(true);
          slot.emitter = null;
          slot.effect = effect;
          slot.generation++;
          if (effect) this.createEmitter(slot, effect, vfx!);
        }
        if (sound !== slot.sound) {
          slot.voice?.stop(SOUND_FADE_SECONDS);
          slot.voice = null;
          slot.sound = sound;
          if (sound) {
            slot.voice = audio!.playLoop(sound, {
              spatial: true, position: slot.position, volume: slot.levels.soundVolume,
              pitch: slot.levels.soundPitch || 0.75, bus: "sfx",
            });
          }
        }
      }
      slot.emitter?.setTransform(slot.position, slot.direction);
      slot.emitter?.setEmissionRate(slot.levels.emissionRate);
      if (slot.voice && !slot.voice.stopped) {
        slot.voice.setPosition(slot.position);
        slot.voice.setVolume(slot.levels.soundVolume, VOLUME_RAMP_SECONDS);
        slot.voice.setPitch(slot.levels.soundPitch || 0.75);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.wheels) this.release(slot);
    this.wheels.length = 0;
  }

  private release(slot: WheelPresentation): void {
    slot.generation++;
    slot.emitter?.dispose();
    slot.emitter = null;
    slot.voice?.stop(0);
    slot.voice = null;
  }

  private createEmitter(slot: WheelPresentation, effect: string, vfx: VfxCommands): void {
    const generation = slot.generation;
    void vfx.createEffectEmitter(effect, { position: slot.position, direction: slot.direction }).then((handle) => {
      if (this.disposed || generation !== slot.generation) {
        handle?.dispose();
        return;
      }
      slot.emitter = handle;
      handle?.setTransform(slot.position, slot.direction);
      handle?.setEmissionRate(slot.levels.emissionRate);
    }).catch(() => {
      // A refused/missing effect stays parked until the surface changes, just
      // like a refused engine voice; never request it again every frame.
    });
  }
}
