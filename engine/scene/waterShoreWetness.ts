/** Shared Lake/River presentation limits; no terrain paint or soil physics edits. */
export interface WaterShoreWetness { enabled: boolean; width: number; strength: number }
export const defaultWaterShoreWetness = (): WaterShoreWetness => ({ enabled: false, width: 1, strength: .65 });
export function validateWaterShoreWetness(value: unknown): WaterShoreWetness {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid water shore wetness");
  const v=value as Record<string,unknown>;
  if(typeof v.enabled!=="boolean"||typeof v.width!=="number"||!Number.isFinite(v.width)||v.width<.2||v.width>4||
    typeof v.strength!=="number"||!Number.isFinite(v.strength)||v.strength<0||v.strength>1)throw new Error("Invalid water shore wetness");
  return {enabled:v.enabled,width:v.width,strength:v.strength};
}
