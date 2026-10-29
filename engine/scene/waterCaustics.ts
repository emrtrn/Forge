export interface WaterCaustics { enabled: boolean; strength: number; scale: number; speed: number; depthFade: number }
export const defaultWaterCaustics = (): WaterCaustics => ({ enabled: false, strength: 1, scale: 1.5, speed: .25, depthFade: 4 });
export function validateWaterCaustics(value: unknown): WaterCaustics {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid water caustics");
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean") throw new Error("Invalid water caustics enabled");
  const result = { enabled: input.enabled } as WaterCaustics;
  for (const [key, min, max] of [["strength",0,4],["scale",.1,20],["speed",0,3],["depthFade",.1,30]] as const) {
    const n=input[key]; if(typeof n!=="number"||!Number.isFinite(n)||n<min||n>max)throw new Error(`Invalid water caustics ${key}`);
    result[key]=n;
  }
  return result;
}
