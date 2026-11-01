import type { LayoutLakeWaterBody } from "./layout";

export interface LakeUnderwaterSettings {
  enabled?: boolean;
  fogDensity?: number;
  distortionStrength?: number;
  blurStrength?: number;
  particleDensity?: number;
}
export const LAKE_UNDERWATER_DEFAULTS = { enabled: true, fogDensity: 1, distortionStrength: .35, blurStrength: .2, particleDensity: .25 };
export const LAKE_UNDERWATER_RANGES = { fogDensity: [0, 3], distortionStrength: [0, 1], blurStrength: [0, 1], particleDensity: [0, 1] } as const;
export function resolveLakeUnderwater(lake: Pick<LayoutLakeWaterBody, "underwater">) { return { ...LAKE_UNDERWATER_DEFAULTS, ...lake.underwater }; }
export function validateLakeUnderwater(value: unknown): LakeUnderwaterSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Lake underwater settings");
  const source = value as Record<string, unknown>, out: LakeUnderwaterSettings = {};
  if (source.enabled !== undefined) {
    if (typeof source.enabled !== "boolean") throw new Error("Invalid Lake underwater enabled");
    out.enabled = source.enabled;
  }
  for (const key of Object.keys(LAKE_UNDERWATER_RANGES) as (keyof typeof LAKE_UNDERWATER_RANGES)[]) if (source[key] !== undefined) {
    const v = source[key], [min, max] = LAKE_UNDERWATER_RANGES[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid Lake underwater ${key}`);
    out[key] = v;
  }
  return out;
}
