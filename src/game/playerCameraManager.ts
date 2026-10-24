import { Vector3, type PerspectiveCamera } from "three";
import type { Vec3 } from "@/game/followCamera";
import { cameraFarOverride } from "@engine/render-three/camera";

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

export interface CameraProjection {
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

export interface CameraViewTarget {
  readonly source: string;
  readonly pose: CameraPose;
  readonly projection?: CameraProjection;
}

export interface SetViewTargetOptions {
  readonly blendTimeSeconds?: number;
}

export interface GameplayCameraEffects {
  readonly fovOffset?: number;
  readonly shakeAmplitude?: number;
  readonly shakeFrequencyHz?: number;
}

interface CameraBlend {
  readonly from: CameraViewTarget;
  to: CameraViewTarget;
  elapsedSeconds: number;
  readonly durationSeconds: number;
}

interface ResolvedGameplayCameraEffects {
  fovOffset: number;
  shakeAmplitude: number;
  shakeFrequencyHz: number;
}

const EFFECT_BLEND_RATE = 8;
const DEFAULT_EFFECTS: ResolvedGameplayCameraEffects = {
  fovOffset: 0,
  shakeAmplitude: 0,
  shakeFrequencyHz: 0,
};

export class PlayerCameraManager {
  private current: CameraViewTarget | null = null;
  private blend: CameraBlend | null = null;
  private effectTarget: ResolvedGameplayCameraEffects = { ...DEFAULT_EFFECTS };
  private effects: ResolvedGameplayCameraEffects = { ...DEFAULT_EFFECTS };
  private effectTimeSeconds = 0;

  constructor(private readonly camera: PerspectiveCamera) {}

  get cameraSource(): string | null {
    return this.blend?.to.source ?? this.current?.source ?? null;
  }

  get gameplayEffects(): ResolvedGameplayCameraEffects {
    return { ...this.effects };
  }

  setViewTarget(target: CameraViewTarget, options: SetViewTargetOptions = {}): void {
    const next = cloneViewTarget(target);
    const blendTime = Math.max(0, options.blendTimeSeconds ?? 0);

    if (!this.current && !this.blend) {
      this.current = next;
      return;
    }

    if (this.blend) {
      if (this.blend.to.source === next.source) {
        this.blend.to = next;
        return;
      }
      this.current = snapshotCameraView(this.camera, this.cameraSource ?? "camera");
      this.blend = null;
    }

    const previous = this.current;
    if (previous && previous.source !== next.source && blendTime > 0) {
      this.blend = {
        from: cloneViewTarget(previous),
        to: next,
        elapsedSeconds: 0,
        durationSeconds: blendTime,
      };
      return;
    }

    this.current = next;
  }

  setGameplayEffects(effects: GameplayCameraEffects): void {
    this.effectTarget = {
      fovOffset: finiteOrZero(effects.fovOffset),
      shakeAmplitude: Math.max(0, finiteOrZero(effects.shakeAmplitude)),
      shakeFrequencyHz: Math.max(0, finiteOrZero(effects.shakeFrequencyHz)),
    };
  }

  update(deltaSeconds: number): void {
    this.updateEffects(deltaSeconds);
    const blend = this.blend;
    if (!blend) {
      if (this.current) this.applyView(this.current);
      return;
    }

    blend.elapsedSeconds += Math.max(0, deltaSeconds);
    const alpha = smoothStep(clamp01(blend.elapsedSeconds / blend.durationSeconds));
    const view = interpolateView(this.camera, blend.from, blend.to, alpha);
    this.applyView(view);
    if (alpha >= 1) {
      this.current = cloneViewTarget(blend.to);
      this.blend = null;
    }
  }

  private applyView(view: CameraViewTarget): void {
    const pose = this.poseWithShake(view.pose);
    const { position, target } = pose;
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
    if (view.projection) applyProjection(this.camera, this.projectionWithEffects(view.projection));
  }

  private updateEffects(deltaSeconds: number): void {
    const dt = Math.max(0, deltaSeconds);
    this.effectTimeSeconds += dt;
    const t = smoothingFactor(EFFECT_BLEND_RATE, dt);
    this.effects = {
      fovOffset: lerp(this.effects.fovOffset, this.effectTarget.fovOffset, t),
      shakeAmplitude: lerp(this.effects.shakeAmplitude, this.effectTarget.shakeAmplitude, t),
      shakeFrequencyHz: this.effectTarget.shakeFrequencyHz,
    };
  }

  private poseWithShake(pose: CameraPose): CameraPose {
    const amplitude = this.effects.shakeAmplitude;
    const frequency = this.effects.shakeFrequencyHz;
    if (!(amplitude > 0) || !(frequency > 0)) return pose;
    const phase = this.effectTimeSeconds * frequency * Math.PI * 2;
    const offset: Vec3 = [
      Math.sin(phase * 1.31) * amplitude,
      Math.sin(phase * 1.73 + 1.2) * amplitude * 0.55,
      Math.cos(phase * 1.11) * amplitude,
    ];
    return {
      position: addVec3(pose.position, offset),
      target: addVec3(pose.target, offset),
    };
  }

  private projectionWithEffects(projection: CameraProjection): CameraProjection {
    return {
      ...projection,
      fov: projection.fov + this.effects.fovOffset,
      far: cameraFarOverride(this.camera) ?? projection.far,
    };
  }
}

function cloneViewTarget(view: CameraViewTarget): CameraViewTarget {
  return {
    source: view.source,
    pose: {
      position: [...view.pose.position],
      target: [...view.pose.target],
    },
    ...(view.projection ? { projection: { ...view.projection } } : {}),
  };
}

function snapshotCameraView(camera: PerspectiveCamera, source: string): CameraViewTarget {
  const forward = camera.getWorldDirection(new Vector3());
  return {
    source,
    pose: {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [
        camera.position.x + forward.x,
        camera.position.y + forward.y,
        camera.position.z + forward.z,
      ],
    },
    projection: snapshotProjection(camera),
  };
}

function interpolateView(
  camera: PerspectiveCamera,
  from: CameraViewTarget,
  to: CameraViewTarget,
  alpha: number,
): CameraViewTarget {
  const fromProjection = from.projection ?? snapshotProjection(camera);
  const toProjection = to.projection ?? fromProjection;
  return {
    source: to.source,
    pose: {
      position: lerpVec3(from.pose.position, to.pose.position, alpha),
      target: lerpVec3(from.pose.target, to.pose.target, alpha),
    },
    projection: {
      fov: lerp(fromProjection.fov, toProjection.fov, alpha),
      near: lerp(fromProjection.near, toProjection.near, alpha),
      far: lerp(fromProjection.far, toProjection.far, alpha),
    },
  };
}

function snapshotProjection(camera: PerspectiveCamera): CameraProjection {
  return { fov: camera.fov, near: camera.near, far: camera.far };
}

function applyProjection(camera: PerspectiveCamera, projection: CameraProjection): void {
  if (
    camera.fov === projection.fov &&
    camera.near === projection.near &&
    camera.far === projection.far
  ) {
    return;
  }
  camera.fov = projection.fov;
  camera.near = projection.near;
  camera.far = projection.far;
  camera.updateProjectionMatrix();
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothingFactor(rate: number, dt: number): number {
  if (!(rate > 0) || !(dt > 0)) return 0;
  return 1 - Math.exp(-rate * dt);
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
