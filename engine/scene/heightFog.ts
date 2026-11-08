import type { LayoutHeightFog } from "./layout";

/** Renderer-independent fog settings. Optional analytic height effects preserve legacy defaults. */
export type HeightFogMode = "exp" | "linear";

export interface ResolvedHeightFog {
  name: string;
  hidden: boolean;
  /** `exp` = FogExp2 (density), `linear` = Fog (start/end). */
  mode: HeightFogMode;
  /** Fog inscattering color (hex). */
  color: string;
  /** Exponential density (exp mode); tuned to the ~100u scene scale. */
  density: number;
  heightFalloff: number;
  baseHeight: number;
  startDistance: number;
  maxOpacity: number;
  sunColor: string;
  sunStrength: number;
  /** Linear fog near distance (linear mode). */
  start: number;
  /** Linear fog far distance (linear mode). */
  end: number;
}

export const HEIGHT_FOG_DEFAULTS: ResolvedHeightFog = {
  name: "Exponential Height Fog",
  hidden: false,
  mode: "exp",
  color: "#bcc6d1",
  density: 0.03,
  heightFalloff: 0,
  baseHeight: 0,
  startDistance: 0,
  maxOpacity: 1,
  sunColor: "#ffe2bd",
  sunStrength: 0,
  start: 5,
  end: 60,
};

/** Fills every Height Fog field with its default, decoupled from the layout. */
export function resolveHeightFog(
  actor: LayoutHeightFog | null | undefined,
): ResolvedHeightFog {
  const defaults = HEIGHT_FOG_DEFAULTS;
  if (!actor) return { ...defaults };
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    mode: actor.mode ?? defaults.mode,
    color: actor.color ?? defaults.color,
    density: actor.density ?? defaults.density,
    heightFalloff: actor.heightFalloff ?? defaults.heightFalloff,
    baseHeight: actor.baseHeight ?? defaults.baseHeight,
    startDistance: actor.startDistance ?? defaults.startDistance,
    maxOpacity: actor.maxOpacity ?? defaults.maxOpacity,
    sunColor: actor.sunColor ?? defaults.sunColor,
    sunStrength: actor.sunStrength ?? defaults.sunStrength,
    start: actor.start ?? defaults.start,
    end: actor.end ?? defaults.end,
  };
}
