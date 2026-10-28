import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import type { LakeGeometry } from "../terrain/terrainLakeWater";

/** Bounded distance-to-real-shore field, including islands. Local coordinates
 * keep large origins out of the distance calculation. No per-frame generation. */
export function createLakeFoamMask(lake: LayoutLakeWaterBody, data: LakeGeometry, width: number) {
  const extent = [lake.bounds.max[0] - lake.bounds.min[0], lake.bounds.max[1] - lake.bounds.min[1]];
  if (!Number.isFinite(width) || width <= 0 || extent.some(v => !Number.isFinite(v) || v <= 0)) throw new Error("Invalid Lake foam dimensions");
  const nx = Math.ceil(extent[0]! / (width / 4)), nz = Math.ceil(extent[1]! / (width / 4));
  // Four texels across the authored band, at most 1 MiB per enabled Lake.
  // Refuse an undersampled band rather than silently widening the foam.
  if (nx < 1 || nz < 1 || nx > 1024 || nz > 1024) throw new Error("over-budget: Lake foam needs a wider band or smaller calculation bounds (1024 texels per axis)");
  const values = new Uint8Array(nx * nz); values.fill(255);
  const ox = lake.bounds.min[0] - data.position[0], oz = lake.bounds.min[1] - data.position[2];
  const sx = extent[0]! / nx, sz = extent[1]! / nz;
  for (let i = 0; i < data.shore.length; i += 4) {
    const ax = data.shore[i]!, az = data.shore[i + 1]!, bx = data.shore[i + 2]!, bz = data.shore[i + 3]!;
    const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - width - ox) / sx));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + width - ox) / sx));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - width - oz) / sz));
    const z1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + width - oz) / sz));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const px = ox + (x + 0.5) * sx - ax, pz = oz + (z + 0.5) * sz - az;
      const t = length2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / length2)) : 0;
      const value = Math.min(255, Math.round(Math.hypot(px - t * dx, pz - t * dz) / width * 255));
      const index = z * nx + x; values[index] = Math.min(values[index]!, value);
    }
  }
  const texture = new DataTexture(values, nx, nz, RedFormat, UnsignedByteType);
  texture.name = "LakeFoam.shoreDistance"; texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping; texture.generateMipmaps = false;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

/** Shared presentation kernel; callers provide valid contact coverage and light.
 * World-anchored, two-scale patches rather than complete white contour rings. */
export const WATER_FOAM_GLSL = /* glsl */ `
float waterFoamPatches(vec2 world, float distanceToShore, float time, float scale, float speed) {
  vec2 p = world / scale;
  vec2 drift = time * speed * vec2(0.11, -0.07);
  float broad = waterNoise(p + drift);
  float detail = waterNoise(p * 3.1 - drift * 1.7 + vec2(17.3, 9.2));
  float patches = smoothstep(0.43, 0.62, broad * 0.7 + detail * 0.3);
  // Small broken pores keep close views from reading as smooth white fog.
  float poreNoise = waterNoise(p * 11.0 + drift * 2.3);
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float pores = mix(smoothstep(0.38, 0.65, poreNoise), 0.5, smoothstep(0.025, 0.12, footprint));
  float band = 1.0 - smoothstep(0.45, 1.0, distanceToShore);
  return patches * pores * band;
}
`;
