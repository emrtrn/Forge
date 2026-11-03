/** Persistent source parameters only; runtime water geometry is derived from terrain. */
export const PUDDLE_WHEEL_RIPPLE_DEFAULTS = {
  wheelRipplesEnabled: true, wheelRippleStrength: 1.5, wheelRippleSpeed: .65,
  wheelRippleWidth: .135, wheelRippleWavelength: .21, wheelRippleLifetime: 2, wheelRippleInterval: .14,
};
export const PUDDLE_WHEEL_RIPPLE_RANGES = {
  wheelRippleStrength: [0, 6], wheelRippleSpeed: [.1, 3], wheelRippleWidth: [.02, .6],
  wheelRippleWavelength: [.05, 1.5], wheelRippleLifetime: [.2, 4], wheelRippleInterval: [.04, .5],
} as const;
export type PuddleWheelRippleSettings = typeof PUDDLE_WHEEL_RIPPLE_DEFAULTS;
export const PUDDLE_WIND_DEFAULTS = {
  windRipplesEnabled: true, windNormalStrength: .16, windWorldScale: .7, windSpeedResponse: 1, windInfluence: 1.6,
};
export const PUDDLE_WIND_RANGES = {
  windNormalStrength: [0, .6], windWorldScale: [.1, 4], windSpeedResponse: [0, 3], windInfluence: [0, 4],
} as const;
export const PUDDLE_WIND_NORMAL = "t-water-n";
export type PuddleWindSettings = typeof PUDDLE_WIND_DEFAULTS;
export const PUDDLE_MUD_DEFAULTS = { mudDensity: 12, mudColor: "#695039" };
export interface PuddleWaterBody {
  schema: 1; kind: "puddle"; coordinateSpace: "world";
  id: string; terrainRef: string; name?: string; hidden?: boolean; locked?: boolean;
  seed: [number, number]; bounds: { min: [number, number]; max: [number, number] };
  surfaceLevel: number;
  appearance?: Partial<PuddleWheelRippleSettings & PuddleWindSettings & typeof PUDDLE_MUD_DEFAULTS> & { color?: string; opacity?: number; roughness?: number; reflectionStrength?: number;
    reflectionMode?: "environment" | "sharedPlanar"; reflectionQuality?: "low" | "medium" | "high"; planarReflectionStrength?: number };
}
export const PUDDLE_LIMITS = { bodies: 16, cells: 128 * 128, totalCells: 65536, tiles: 16, extent: 128 } as const;
export const PUDDLE_APPEARANCE = { color: "#504a35", opacity: .82, roughness: .13, reflectionStrength: 1.4,
  reflectionMode: "environment" as "environment" | "sharedPlanar", reflectionQuality: "medium" as "low" | "medium" | "high", planarReflectionStrength: 1, ...PUDDLE_WHEEL_RIPPLE_DEFAULTS, ...PUDDLE_WIND_DEFAULTS, ...PUDDLE_MUD_DEFAULTS };
export function resolvePuddleWheelRipples(body: PuddleWaterBody): PuddleWheelRippleSettings {
  const a = body.appearance;
  return Object.fromEntries(Object.entries(PUDDLE_WHEEL_RIPPLE_DEFAULTS).map(([key, value]) => [key, a?.[key as keyof PuddleWheelRippleSettings] ?? value])) as PuddleWheelRippleSettings;
}
/** Only new authored bodies opt into an extra render; old files retain environment reflection. */
export const NEW_PUDDLE_APPEARANCE = { ...PUDDLE_APPEARANCE, reflectionMode: "sharedPlanar" as const };

export function validatePuddleWater(value: unknown): PuddleWaterBody {
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Puddle must be an object");
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, min = -1e6, max = 1e6): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("Invalid Puddle number");
    return v;
  };
  const pair = (v: unknown): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2) throw new Error("Puddle requires XZ pairs");
    return [number(v[0]), number(v[1])];
  };
  const input = record(value);
  if (input.schema !== 1 || input.kind !== "puddle" || input.coordinateSpace !== "world") throw new Error("Unsupported Puddle schema/kind/space");
  for (const key of ["id", "terrainRef"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 256) throw new Error(`Invalid Puddle ${key}`);
  }
  const bounds = record(input.bounds), min = pair(bounds.min), max = pair(bounds.max), seed = pair(input.seed);
  const width = max[0] - min[0], length = max[1] - min[1];
  if (!(width > 0 && width <= PUDDLE_LIMITS.extent) || Math.abs(width - length) > 1e-7
    || !(min[0] < seed[0] && seed[0] < max[0] && min[1] < seed[1] && seed[1] < max[1])) throw new Error("Invalid Puddle bounds/seed");
  const out: PuddleWaterBody = { schema: 1, kind: "puddle", coordinateSpace: "world", id: input.id as string,
    terrainRef: input.terrainRef as string, seed, bounds: { min, max }, surfaceLevel: number(input.surfaceLevel) };
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length > 256) throw new Error("Invalid Puddle name");
    out.name = input.name;
  }
  for (const key of ["hidden", "locked"] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== "boolean") throw new Error(`Invalid Puddle ${key}`);
    out[key] = input[key];
  }
  if (input.appearance !== undefined) {
    const source = record(input.appearance), appearance: NonNullable<PuddleWaterBody["appearance"]> = {};
    if (source.color !== undefined) {
      if (typeof source.color !== "string" || !/^#[\da-f]{6}$/i.test(source.color)) throw new Error("Invalid Puddle color");
      appearance.color = source.color;
    }
    if (source.opacity !== undefined) appearance.opacity = number(source.opacity, 0, 1);
    if (source.mudDensity !== undefined) appearance.mudDensity = number(source.mudDensity, 0, 80);
    if (source.mudColor !== undefined) {
      if (typeof source.mudColor !== "string" || !/^#[\da-f]{6}$/i.test(source.mudColor)) throw new Error("Invalid Puddle mud color");
      appearance.mudColor = source.mudColor;
    }
    if (source.roughness !== undefined) appearance.roughness = number(source.roughness, .04, 1);
    if (source.windRipplesEnabled !== undefined) {
      if (typeof source.windRipplesEnabled !== "boolean") throw new Error("Invalid Puddle Wind Ripples Enabled");
      appearance.windRipplesEnabled = source.windRipplesEnabled;
    }
    for (const key of Object.keys(PUDDLE_WIND_RANGES) as (keyof typeof PUDDLE_WIND_RANGES)[]) {
      const range = PUDDLE_WIND_RANGES[key];
      if (source[key] !== undefined) appearance[key] = number(source[key], range[0], range[1]);
    }
    if (source.reflectionStrength !== undefined) appearance.reflectionStrength = number(source.reflectionStrength, 0, 3);
    if (source.wheelRipplesEnabled !== undefined) {
      if (typeof source.wheelRipplesEnabled !== "boolean") throw new Error("Invalid Puddle Wheel Ripples Enabled");
      appearance.wheelRipplesEnabled = source.wheelRipplesEnabled;
    }
    for (const key of Object.keys(PUDDLE_WHEEL_RIPPLE_RANGES) as (keyof typeof PUDDLE_WHEEL_RIPPLE_RANGES)[]) {
      const range = PUDDLE_WHEEL_RIPPLE_RANGES[key];
      if (source[key] !== undefined) appearance[key] = number(source[key], range[0], range[1]);
    }
    if (source.planarReflectionStrength !== undefined) appearance.planarReflectionStrength = number(source.planarReflectionStrength, 0, 1);
    if (source.reflectionMode !== undefined) {
      if (source.reflectionMode !== "environment" && source.reflectionMode !== "sharedPlanar") throw new Error("Invalid Puddle reflection mode");
      appearance.reflectionMode = source.reflectionMode;
    }
    if (source.reflectionQuality !== undefined) {
      if (source.reflectionQuality !== "low" && source.reflectionQuality !== "medium" && source.reflectionQuality !== "high") throw new Error("Invalid Puddle reflection quality");
      appearance.reflectionQuality = source.reflectionQuality;
    }
    out.appearance = appearance;
  }
  return out;
}

export function validatePuddleWaters(value: unknown): PuddleWaterBody[] {
  if (!Array.isArray(value) || value.length > PUDDLE_LIMITS.bodies) throw new Error("puddleWaters must contain at most 16 Puddles");
  const ids = new Set<string>();
  return value.map(item => {
    const body = validatePuddleWater(item);
    if (ids.has(body.id)) throw new Error(`Duplicate Puddle id ${body.id}`);
    ids.add(body.id); return body;
  });
}
