import { Matrix4, Vector3 } from "three";
import { RiverSurfaceQuery } from "../terrain/riverSurface";
import type { WheelWaterSample } from "../terrain/waterWheelInteraction";
import type { RiverWaterRibbonData } from "./riverWater";

/** CPU twin of riverVertexWave, sampled at vertices before interpolation. */
export function riverWheelWave(data: RiverWaterRibbonData, vertex: number, time: number, speed: number, amplitude: number, wavelength: number): number {
  const phase = data.uvs[vertex * 2]! * 6.283185 / Math.max(wavelength, .01) - time * speed * data.flowSpeedMultipliers[vertex]! * 2;
  return (Math.sin(phase) + Math.sin(phase * 1.73 + data.uvs[vertex * 2 + 1]! * 5) * .35)
    * amplitude * Math.pow(Math.max(0, 1 - data.shoreDistances[vertex]!), 1.6) * (.65 + data.rapidness[vertex]! * .35);
}

/** Index the transformed base mesh only when its transform changes. Query the
 * displaced candidate triangles at each physics slice, never rebuild per step. */
export class RiverWheelSurface {
  private readonly matrix = new Matrix4().makeScale(0, 0, 0);
  private query: RiverSurfaceQuery | null = null;
  private clock = NaN;
  private readonly vertices = new Map<number, Vector3>();
  constructor(private readonly data: RiverWaterRibbonData, private readonly speed: number,
    private readonly amplitude: number, private readonly wavelength: number) {}
  update(matrix: Matrix4): void {
    if (this.query && matrix.equals(this.matrix)) return;
    this.matrix.copy(matrix); this.vertices.clear(); this.clock = NaN;
    const positions: number[] = [], flowDirections: number[] = [], p = new Vector3();
    for (let i = 0; i < this.data.positions.length; i += 3) {
      p.fromArray(this.data.positions, i).applyMatrix4(matrix); positions.push(p.x, p.y, p.z);
      p.set(this.data.flowDirections[i / 3 * 2]!, 0, this.data.flowDirections[i / 3 * 2 + 1]!).transformDirection(matrix);
      flowDirections.push(p.x, p.z);
    }
    this.query = new RiverSurfaceQuery({ ...this.data, positions, flowDirections });
  }
  sampleAt(x: number, z: number, time: number): WheelWaterSample | null {
    const q = this.query; if (!q || ![x, z, time].every(Number.isFinite)) return null;
    if (time !== this.clock) { this.clock = time; this.vertices.clear(); }
    const e = this.matrix.elements, marginX = Math.abs(e[4]!) * this.amplitude * 1.35, marginZ = Math.abs(e[6]!) * this.amplitude * 1.35;
    const vertex = (id: number) => {
      let p = this.vertices.get(id);
      if (!p) {
        p = new Vector3().fromArray(this.data.positions, id * 3);
        p.y += riverWheelWave(this.data, id, time, this.speed, this.amplitude, this.wavelength);
        p.applyMatrix4(this.matrix); this.vertices.set(id, p);
      }
      return p;
    };
    for (const t of q.candidates(x - marginX, z - marginZ, x + marginX, z + marginZ)) {
      const ids = [this.data.indices[t * 3]!, this.data.indices[t * 3 + 1]!, this.data.indices[t * 3 + 2]!] as const;
      const a = vertex(ids[0]), b = vertex(ids[1]), c = vertex(ids[2]);
      const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z, det = bx * cz - bz * cx;
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - a.x) * cz - (z - a.z) * cx) / det, v = (bx * (z - a.z) - bz * (x - a.x)) / det;
      if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
      const w = [1 - u - v, u, v];
      if (ids.reduce((sum, id, k) => sum + this.data.bedDepths[id]! * w[k]!, 0) <= 1e-5) continue;
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); if (normal.y < 0) normal.negate();
      return { level: a.y * w[0]! + b.y * u + c.y * v, normal: normal.toArray() as [number, number, number],
        flowX: ids.reduce((sum, id, k) => sum + q.data.flowDirections[id * 2]! * this.data.flowSpeedMultipliers[id]! * w[k]!, 0) * this.speed,
        flowZ: ids.reduce((sum, id, k) => sum + q.data.flowDirections[id * 2 + 1]! * this.data.flowSpeedMultipliers[id]! * w[k]!, 0) * this.speed };
    }
    return null;
  }
}
