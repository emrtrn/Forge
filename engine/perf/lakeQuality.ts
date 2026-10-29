import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeAppearance } from "../scene/waterBody";
import type { QualitySettings } from "./qualityProfiles";

export interface LakeQuality {
  causticsAllowed: boolean;
  foamAllowed: boolean;
  shoreWetnessAllowed: boolean;
  reflectionQuality: "off" | "medium" | "high";
  maxRipples: number;
}

/** Standalone render/editor callers retain authored appearance unless a profile is supplied. */
export const FULL_LAKE_QUALITY: Readonly<LakeQuality> = {
  causticsAllowed: true, foamAllowed: true, shoreWetnessAllowed: true, reflectionQuality: "high", maxRipples: 24,
};

export function lakeQuality(settings: QualitySettings): LakeQuality {
  return { causticsAllowed: settings.lakeCausticsAllowed, foamAllowed: settings.lakeFoamAllowed,
    shoreWetnessAllowed: settings.lakeShoreWetnessAllowed, reflectionQuality: settings.lakeReflectionQuality,
    maxRipples: Number.isFinite(settings.lakeMaxRipples) ? Math.max(0, Math.min(24, Math.floor(settings.lakeMaxRipples))) : 24 };
}

/** A transient copy for terrain registries. No saved field or authored object is changed. */
export function qualityLake(lake: LayoutLakeWaterBody, quality: LakeQuality): LayoutLakeWaterBody {
  const a = resolveLakeAppearance(lake);
  return { ...lake, appearance: { ...a,
    causticsEnabled: a.causticsEnabled && quality.causticsAllowed,
    foamEnabled: a.foamEnabled && quality.foamAllowed,
    shoreWetnessEnabled: a.shoreWetnessEnabled && quality.shoreWetnessAllowed,
    // A graphics-tier ceiling disables the extra planar capture, while an
    // authored Off still disables reflection altogether. Low borrows the sky.
    reflectionMode: a.reflectionMode,
    reflectionQuality: quality.reflectionQuality === "off" ? "low"
      : quality.reflectionQuality === "medium" && a.reflectionQuality === "high" ? "medium" : a.reflectionQuality,
  } };
}
