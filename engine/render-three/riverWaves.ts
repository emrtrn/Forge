import type { RiverWaterRibbonData } from "./riverWater";

/** Static UV derivative frames for continuous vertex shading. Positions and
 * wave displacement stay untouched. Each shared vertex owns one normal, even
 * when the two raster triangles have different displaced face normals.
 * 14 float attributes (56 bytes) per vertex; no per-frame CPU work or texture. */
export function riverWaveFrames(data: RiverWaterRibbonData) {
  const count = data.positions.length / 3;
  const du = new Float32Array(count * 3), dv = new Float32Array(count * 3);
  const waveDu = new Float32Array(count * 3), waveDv = new Float32Array(count * 3);
  const steps = new Float32Array(count * 2).fill(Infinity), weights = new Float32Array(count);
  const waveSources = [data.shoreDistances, data.rapidness, data.flowSpeedMultipliers];
  for (let t = 0; t < data.indices.length; t += 3) {
    const ids = [data.indices[t]!, data.indices[t + 1]!, data.indices[t + 2]!] as const;
    const [a,b,c] = ids;
    const u1 = data.uvs[b * 2]! - data.uvs[a * 2]!, v1 = data.uvs[b * 2 + 1]! - data.uvs[a * 2 + 1]!;
    const u2 = data.uvs[c * 2]! - data.uvs[a * 2]!, v2 = data.uvs[c * 2 + 1]! - data.uvs[a * 2 + 1]!;
    const determinant = u1 * v2 - v1 * u2;
    if (Math.abs(determinant) < 1e-12) continue;
    const e1 = [0,1,2].map(k => data.positions[b * 3 + k]! - data.positions[a * 3 + k]!);
    const e2 = [0,1,2].map(k => data.positions[c * 3 + k]! - data.positions[a * 3 + k]!);
    const area = Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    for (const id of ids) {
      weights[id] = weights[id]! + area;
      for (let k = 0; k < 3; k++) {
        const i = id * 3 + k;
        du[i] = du[i]! + (e1[k]! * v2 - e2[k]! * v1) / determinant * area;
        dv[i] = dv[i]! + (e2[k]! * u1 - e1[k]! * u2) / determinant * area;
        const values = waveSources[k]!;
        const d1 = values[b]! - values[a]!, d2 = values[c]! - values[a]!;
        waveDu[i] = waveDu[i]! + (d1 * v2 - d2 * v1) / determinant * area;
        waveDv[i] = waveDv[i]! + (d2 * u1 - d1 * u2) / determinant * area;
      }
      for (const other of ids) for (let axis = 0; axis < 2; axis++) {
        const delta = Math.abs(data.uvs[other * 2 + axis]! - data.uvs[id * 2 + axis]!);
        if (delta > 1e-6) steps[id * 2 + axis] = Math.min(steps[id * 2 + axis]!, delta);
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (weights[i]! > 1e-12) for (let k = 0; k < 3; k++) {
      const p = i * 3 + k;
      du[p] = du[p]! / weights[i]!; dv[p] = dv[p]! / weights[i]!;
      waveDu[p] = waveDu[p]! / weights[i]!; waveDv[p] = waveDv[p]! / weights[i]!;
    }
    for (let axis = 0; axis < 2; axis++) if (!Number.isFinite(steps[i * 2 + axis])) steps[i * 2 + axis] = 0.01;
  }
  return {du,dv,waveDu,waveDv,steps};
}

/** The existing River vertex wave, also evaluated at source triangle vertices
 * by refraction queries. No new displacement or CPU surface model. */
export const RIVER_WAVE_GLSL = /* glsl */ `
float riverVertexWave(vec2 uv, float shore, float rapid, float multiplier,
  float clock, float speed, float amplitude, float wavelength) {
  float centre = pow(max(0.0, 1.0 - shore), 1.6);
  float phase = uv.x * 6.283185 / max(wavelength, 0.01) - clock * speed * multiplier * 2.0;
  return (sin(phase) + sin(phase * 1.73 + uv.y * 5.0) * 0.35)
    * amplitude * centre * (0.65 + rapid * 0.35);
}
`;

export const RIVER_SHADING_NORMAL_GLSL = /* glsl */ `
attribute vec3 riverDu;
attribute vec3 riverDv;
attribute vec3 riverWaveDu;
attribute vec3 riverWaveDv;
attribute vec2 riverWaveSteps;
float riverShadingWave(vec2 p, vec3 inputs) {
  return riverVertexWave(p, clamp(inputs.x, 0.0, 1.0), clamp(inputs.y, 0.0, 1.0),
    max(inputs.z, 0.0), time, flowSpeed, waveAmplitude, waveLength);
}
vec3 riverShadingNormal(vec2 p, vec3 inputs) {
  vec2 stepSize = max(riverWaveSteps, vec2(0.0001));
  // Finite source-sized differences stay bounded even across authored speed
  // profiles: differentiating time*multiplier analytically would grow forever.
  float hu = (riverShadingWave(p + vec2(stepSize.x, 0.0), inputs + riverWaveDu * stepSize.x)
    - riverShadingWave(p - vec2(stepSize.x, 0.0), inputs - riverWaveDu * stepSize.x)) / (2.0 * stepSize.x);
  float hv = (riverShadingWave(p + vec2(0.0, stepSize.y), inputs + riverWaveDv * stepSize.y)
    - riverShadingWave(p - vec2(0.0, stepSize.y), inputs - riverWaveDv * stepSize.y)) / (2.0 * stepSize.y);
  vec3 u = riverDu + vec3(0.0, hu, 0.0), v = riverDv + vec3(0.0, hv, 0.0);
  vec3 n = cross(mat3(modelMatrix) * v, mat3(modelMatrix) * u);
  if (n.y < 0.0) n = -n;
  return length(n) > 0.000001 ? normalize(n) : vec3(0.0, 1.0, 0.0);
}
`;
