import { landscapeBrushFalloff, type LandscapeHeightBrushMode } from "../scene/landscapeBrush";

export type TerrainSculptTool = LandscapeHeightBrushMode | "noise" | "ramp" | "terrace" | "stamp";
export type TerrainStampShape = "hill" | "crater" | "ridge";

export interface TerrainSculptSettings {
  noiseScale: number;
  noiseSeed: number;
  terraceStep: number;
  terraceSmoothing: number;
  stampShape: TerrainStampShape;
  stampHeight: number;
  stampRotation: number;
  rampStartOffset: number;
  rampEndOffset: number;
}

export const DEFAULT_TERRAIN_SCULPT_SETTINGS: Readonly<TerrainSculptSettings> = {
  noiseScale: 4, noiseSeed: 1, terraceStep: 2, terraceSmoothing: 0.15,
  stampShape: "hill", stampHeight: 5, stampRotation: 0, rampStartOffset: 0, rampEndOffset: 0,
};

/** World X/Z and heights in metres relative to the terrain's origin Y. */
export interface TerrainRamp {
  start: { x: number; z: number; height: number };
  end: { x: number; z: number; height: number };
}

export function terrainSculptBounds(x: number, z: number, radius: number, ramp?: TerrainRamp) {
  return {
    minX: Math.min(ramp?.start.x ?? x, ramp?.end.x ?? x) - radius,
    maxX: Math.max(ramp?.start.x ?? x, ramp?.end.x ?? x) + radius,
    minZ: Math.min(ramp?.start.z ?? z, ramp?.end.z ?? z) - radius,
    maxZ: Math.max(ramp?.start.z ?? z, ramp?.end.z ?? z) + radius,
  };
}

function rampPosition(x: number, z: number, ramp: TerrainRamp): number {
  const dx = ramp.end.x - ramp.start.x;
  const dz = ramp.end.z - ramp.start.z;
  const length2 = dx * dx + dz * dz;
  return length2 > 1e-8 ? Math.max(0, Math.min(1, ((x - ramp.start.x) * dx + (z - ramp.start.z) * dz) / length2)) : 0;
}

export function terrainSculptInfluence(x: number, z: number, cx: number, cz: number, radius: number, falloff: number, ramp?: TerrainRamp): number {
  const t = ramp ? rampPosition(x, z, ramp) : 0;
  const px = ramp ? ramp.start.x + (ramp.end.x - ramp.start.x) * t : cx;
  const pz = ramp ? ramp.start.z + (ramp.end.z - ramp.start.z) * t : cz;
  return landscapeBrushFalloff(Math.hypot(x - px, z - pz), radius, falloff);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Stable spatial value noise: identical seeds/coordinates agree at tile seams. */
export function terrainSculptNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const tx = smooth(x - ix), tz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Extra sculpt tools; callers supply strength multiplied by the footprint falloff. */
export function nextTerrainSculptHeight(
  mode: "noise" | "ramp" | "terrace" | "stamp", current: number, amount: number,
  x: number, z: number, cx: number, cz: number, radius: number,
  settings: TerrainSculptSettings, ramp?: TerrainRamp,
): number {
  if (mode === "noise") return current + terrainSculptNoise(x / settings.noiseScale, z / settings.noiseScale, settings.noiseSeed) * amount;
  if (mode === "terrace") {
    const level = current / settings.terraceStep;
    const base = Math.floor(level);
    const fraction = level - base;
    const width = settings.terraceSmoothing;
    const step = width > 0 ? smooth(Math.max(0, Math.min(1, (fraction - 0.5) / width + 0.5))) : (fraction < 0.5 ? 0 : 1);
    return current + ((base + step) * settings.terraceStep - current) * Math.min(1, amount);
  }
  if (mode === "ramp") {
    if (!ramp) return current;
    const t = rampPosition(x, z, ramp);
    const start = ramp.start.height + settings.rampStartOffset;
    const end = ramp.end.height + settings.rampEndOffset;
    return current + (start + (end - start) * t - current) * Math.min(1, amount);
  }
  const angle = settings.stampRotation * Math.PI / 180;
  const dx = (x - cx) / radius, dz = (z - cz) / radius;
  const u = dx * Math.cos(angle) + dz * Math.sin(angle);
  const v = -dx * Math.sin(angle) + dz * Math.cos(angle);
  const r = Math.hypot(dx, dz);
  let profile: number;
  if (settings.stampShape === "crater") profile = -Math.exp(-r * r * 12) + 0.65 * Math.exp(-(((r - 0.65) / 0.14) ** 2));
  else if (settings.stampShape === "ridge") profile = Math.exp(-u * u * 24) * Math.max(0, 1 - v * v);
  else profile = Math.max(0, 1 - r * r) ** 2;
  return current + profile * settings.stampHeight * Math.min(1, amount);
}
