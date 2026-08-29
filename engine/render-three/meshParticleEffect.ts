/**
 * CPU-simulated mesh particle effect. Source GLTF geometry/materials are shared;
 * only transform matrices are written per live particle through InstancedMesh.
 */
import {
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

import { isRenderableMesh } from "./materials";
import { ensureVertexNormals } from "./models";
import type { RuntimeParticleEffect, Vec3 } from "../vfx/particleEffectTypes";
import type { ParticleEffectOverrides } from "./particleEffect";

const HIDDEN_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);
const GRAVITY = 9.81;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface SourceMesh {
  readonly mesh: InstancedMesh;
  readonly sourceMatrix: Matrix4;
}

/** A mesh effect has the same lifecycle surface as the sprite `ParticleEffect`. */
export class MeshParticleEffect {
  readonly object3D = new Group();
  private readonly capacity: number;
  private readonly lifetime: number;
  private readonly rate: number;
  private loop: boolean;
  private startSize: number;
  private endSize: number;
  private velocity: Vec3;
  private spread: number;
  private readonly gravityScale: number;
  private readonly drag: number;
  private readonly acceleration: Vec3;
  private readonly rotationRange: readonly [number, number];
  private readonly angularVelocityRange: readonly [number, number];
  private readonly sources: SourceMesh[] = [];
  private readonly ownedMaterials: Material[] = [];
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly rotations: Float32Array;
  private readonly angularVelocities: Float32Array;
  private readonly scales: Float32Array;
  private readonly ages: Float32Array;
  private readonly sourceIndices: Int16Array;
  private readonly origin: [number, number, number] = [0, 0, 0];
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly matrix = new Matrix4();
  private elapsed = 0;
  private spawnAccumulator = 0;
  private densityScale = 1;
  /** Round-robin cursor for `modelSelection: "sequence"`; unused when random. */
  private nextSourceIndex = 0;
  /** Authored burst, or 0 particles for a pure rate emitter. */
  private readonly burstCount: number;
  private readonly burstDelay: number;
  /** Whether this play has already released its burst; cleared by {@link reset}. */
  private burstFired = false;

  constructor(
    private readonly definition: RuntimeParticleEffect,
    modelRoots: readonly Object3D[],
    overrides?: ParticleEffectOverrides,
  ) {
    this.burstCount = Math.max(0, Math.round(definition.burst?.count ?? 0));
    this.burstDelay = Math.max(0, definition.burst?.delay ?? 0);
    // The burst lands whole, so it counts toward what has to be alive at once —
    // a burst emitter carries no rate, and sizing on the rate alone would leave
    // capacity 4 for a fifty-piece blast. The authored caps below still win:
    // clipping to a budget the author set is a decision, clipping to zero is a bug.
    const naturalCapacity = Math.max(
      1,
      Math.ceil(definition.rate * definition.lifetime) + this.burstCount + 4,
    );
    this.capacity = Math.min(
      naturalCapacity,
      definition.maxParticles ?? naturalCapacity,
      definition.maxModelParticles ?? naturalCapacity,
    );
    this.lifetime = definition.lifetime;
    this.rate = definition.rate;
    this.loop = definition.loop;
    this.startSize = definition.startSize;
    this.endSize = definition.endSize;
    this.velocity = [...definition.velocity];
    this.spread = definition.spread;
    this.gravityScale = definition.gravityScale ?? 0;
    this.drag = definition.drag ?? 0;
    this.acceleration = definition.acceleration ?? [0, 0, 0];
    this.rotationRange = definition.rotation ?? [0, 0];
    this.angularVelocityRange = definition.angularVelocity ?? [0, 0];
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.rotations = new Float32Array(this.capacity * 3);
    this.angularVelocities = new Float32Array(this.capacity * 3);
    this.scales = new Float32Array(this.capacity);
    this.ages = new Float32Array(this.capacity).fill(-1);
    this.sourceIndices = new Int16Array(this.capacity).fill(-1);
    this.object3D.name = "mesh-particle-effect";
    this.buildSources(modelRoots);
    this.applyOverrides(overrides);
  }

  private buildSources(modelRoots: readonly Object3D[]): void {
    for (const root of modelRoots) {
      ensureVertexNormals(root);
      root.updateMatrixWorld(true);
      root.traverse((object) => {
        if (!isRenderableMesh(object)) return;
        const mesh = new InstancedMesh(object.geometry, this.materialForSource(object.material), this.capacity);
        mesh.name = `mesh-particle-${object.name || "source"}`;
        mesh.frustumCulled = false;
        mesh.castShadow = this.definition.castShadow ?? false;
        mesh.receiveShadow = this.definition.receiveShadow ?? true;
        for (let index = 0; index < this.capacity; index += 1) {
          mesh.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.object3D.add(mesh);
        this.sources.push({ mesh, sourceMatrix: object.matrixWorld.clone() });
      });
    }
  }

  private applyOverrides(overrides?: ParticleEffectOverrides): void {
    const scale =
      typeof overrides?.scale === "number" && Number.isFinite(overrides.scale) && overrides.scale > 0
        ? overrides.scale
        : 1;
    this.loop = overrides?.loop ?? this.definition.loop;
    this.startSize = this.definition.startSize * scale;
    this.endSize = this.definition.endSize * scale;
    this.velocity = [
      this.definition.velocity[0] * scale,
      this.definition.velocity[1] * scale,
      this.definition.velocity[2] * scale,
    ];
    this.spread = this.definition.spread * scale;
    const tint =
      typeof overrides?.tint === "string" && HEX_COLOR.test(overrides.tint)
        ? overrides.tint
        : this.definition.color;
    this.applyTint(tint);
  }

  reset(overrides?: ParticleEffectOverrides): void {
    this.applyOverrides(overrides);
    this.elapsed = 0;
    this.spawnAccumulator = 0;
    this.burstFired = false;
    // A pooled effect restarts its sequence, so every play reads the same way.
    this.nextSourceIndex = 0;
    this.positions.fill(0);
    this.velocities.fill(0);
    this.rotations.fill(0);
    this.angularVelocities.fill(0);
    this.scales.fill(0);
    this.ages.fill(-1);
    this.sourceIndices.fill(-1);
    for (const source of this.sources) {
      for (let index = 0; index < this.capacity; index += 1) {
        source.mesh.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
      }
      source.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setDensityScale(scale: number): void {
    this.densityScale = Number.isFinite(scale) && scale >= 0 ? scale : 1;
  }

  setOrigin(x: number, y: number, z: number): void {
    this.origin[0] = x;
    this.origin[1] = y;
    this.origin[2] = z;
  }

  update(dt: number): void {
    if (dt <= 0 || this.sources.length === 0) return;
    this.elapsed += dt;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.ages[index]! < 0) continue;
      const age = this.ages[index]! + dt;
      if (age >= this.lifetime) {
        this.hide(index);
        this.ages[index] = -1;
        this.sourceIndices[index] = -1;
        continue;
      }
      this.ages[index] = age;
      const base = index * 3;
      const dragFactor = Math.max(0, 1 - this.drag * dt);
      this.velocities[base] = (this.velocities[base]! + this.acceleration[0] * dt) * dragFactor;
      this.velocities[base + 1] =
        (this.velocities[base + 1]! + (this.acceleration[1] - GRAVITY * this.gravityScale) * dt) * dragFactor;
      this.velocities[base + 2] = (this.velocities[base + 2]! + this.acceleration[2] * dt) * dragFactor;
      this.positions[base] = this.positions[base]! + this.velocities[base]! * dt;
      this.positions[base + 1] = this.positions[base + 1]! + this.velocities[base + 1]! * dt;
      this.positions[base + 2] = this.positions[base + 2]! + this.velocities[base + 2]! * dt;
      this.rotations[base] = this.rotations[base]! + this.angularVelocities[base]! * dt;
      this.rotations[base + 1] = this.rotations[base + 1]! + this.angularVelocities[base + 1]! * dt;
      this.rotations[base + 2] = this.rotations[base + 2]! + this.angularVelocities[base + 2]! * dt;
      const lifeT = age / this.lifetime;
      this.scales[index] = this.startSize + (this.endSize - this.startSize) * lifeT;
      this.writeMatrix(index);
    }
    // Released whole on the first tick at or past its delay, so debris leaves the
    // wall on the blow rather than trickling off it afterwards.
    if (!this.burstFired && this.burstCount > 0 && this.elapsed >= this.burstDelay) {
      this.burstFired = true;
      const count = Math.round(this.burstCount * this.densityScale);
      for (let i = 0; i < count; i += 1) this.spawnParticle();
    }
    if (this.loop || this.elapsed <= this.lifetime) {
      this.spawnAccumulator += this.rate * this.densityScale * dt;
      while (this.spawnAccumulator >= 1) {
        this.spawnAccumulator -= 1;
        this.spawnParticle();
      }
    }
    for (const source of this.sources) source.mesh.instanceMatrix.needsUpdate = true;
  }

  isFinished(): boolean {
    if (this.loop) return false;
    // A burst still owed keeps the instance alive; see ParticleEffect.isFinished.
    if (!this.burstFired && this.burstCount > 0) return false;
    if (this.elapsed <= this.lifetime) return false;
    return this.aliveCount() === 0;
  }

  aliveCount(): number {
    let alive = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.ages[index]! >= 0) alive += 1;
    }
    return alive;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  dispose(): void {
    this.object3D.clear();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.length = 0;
    this.sources.length = 0;
  }

  private materialForSource(material: Material | Material[]): Material | Material[] {
    if (this.definition.meshMaterialMode !== "tint") return material;
    const clone = (source: Material): Material => {
      const result = source.clone();
      this.ownedMaterials.push(result);
      return result;
    };
    return Array.isArray(material) ? material.map(clone) : clone(material);
  }

  private applyTint(color: string): void {
    if (this.definition.meshMaterialMode !== "tint") return;
    for (const material of this.ownedMaterials) {
      const coloured = material as Material & { color?: { set(value: string): unknown } };
      coloured.color?.set(color);
    }
  }

  private spawnParticle(): void {
    let slot = -1;
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.ages[index]! < 0) {
        slot = index;
        break;
      }
    }
    if (slot < 0) return;
    const randomRange = (range: readonly [number, number]): number =>
      range[0] + Math.random() * (range[1] - range[0]);
    const jitter = (): number => (Math.random() * 2 - 1) * this.spread;
    const base = slot * 3;
    this.ages[slot] = 0;
    this.sourceIndices[slot] = this.pickSourceIndex();
    this.positions[base] = this.origin[0] + jitter() * 0.2;
    this.positions[base + 1] = this.origin[1];
    this.positions[base + 2] = this.origin[2] + jitter() * 0.2;
    this.velocities[base] = this.velocity[0] + jitter();
    this.velocities[base + 1] = this.velocity[1] + (Math.random() * 2 - 1) * this.spread * 0.3;
    this.velocities[base + 2] = this.velocity[2] + jitter();
    this.rotations[base] = randomRange(this.rotationRange) * (Math.PI / 180);
    this.rotations[base + 1] = randomRange(this.rotationRange) * (Math.PI / 180);
    this.rotations[base + 2] = randomRange(this.rotationRange) * (Math.PI / 180);
    this.angularVelocities[base] = randomRange(this.angularVelocityRange) * (Math.PI / 180);
    this.angularVelocities[base + 1] = randomRange(this.angularVelocityRange) * (Math.PI / 180);
    this.angularVelocities[base + 2] = randomRange(this.angularVelocityRange) * (Math.PI / 180);
    this.scales[slot] = this.startSize;
    this.writeMatrix(slot);
  }

  /**
   * Chooses which instanced source the next particle uses. `sequence` cycles the
   * sources in authored order (an even, readable mix for a small debris set);
   * the default `random` picks freely. Sources are per renderable primitive, per
   * the Faz 2 decision — a multi-primitive model contributes one source each.
   */
  private pickSourceIndex(): number {
    if (this.definition.meshModelSelection !== "sequence") {
      return Math.floor(Math.random() * this.sources.length);
    }
    const index = this.nextSourceIndex % this.sources.length;
    this.nextSourceIndex = (this.nextSourceIndex + 1) % this.sources.length;
    return index;
  }

  private hide(index: number): void {
    const source = this.sources[this.sourceIndices[index]!];
    if (!source) return;
    source.mesh.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
  }

  private writeMatrix(index: number): void {
    const source = this.sources[this.sourceIndices[index]!];
    if (!source) return;
    const base = index * 3;
    this.position.set(this.positions[base]!, this.positions[base + 1]!, this.positions[base + 2]!);
    const uniformScale = this.scales[index]!;
    this.scale.set(uniformScale, uniformScale, uniformScale);
    this.euler.set(this.rotations[base]!, this.rotations[base + 1]!, this.rotations[base + 2]!);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale).multiply(source.sourceMatrix);
    source.mesh.setMatrixAt(index, this.matrix);
  }
}
