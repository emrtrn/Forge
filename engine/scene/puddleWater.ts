/** Persistent source parameters only; runtime water geometry is derived from terrain. */
export interface PuddleWaterBody {
  schema: 1; kind: "puddle"; coordinateSpace: "world";
  id: string; terrainRef: string; name?: string; hidden?: boolean; locked?: boolean;
  seed: [number, number]; bounds: { min: [number, number]; max: [number, number] };
  surfaceLevel: number;
  appearance?: { color?: string; opacity?: number; roughness?: number; reflectionStrength?: number;
    reflectionMode?: "environment" | "sharedPlanar"; reflectionQuality?: "low" | "medium" | "high"; planarReflectionStrength?: number };
}
export const PUDDLE_LIMITS = { bodies: 16, cells: 128 * 128, totalCells: 65536, tiles: 16, extent: 128 } as const;
export const PUDDLE_APPEARANCE = { color: "#504a35", opacity: .82, roughness: .13, reflectionStrength: 1.4,
  reflectionMode: "environment" as "environment" | "sharedPlanar", reflectionQuality: "medium" as "low" | "medium" | "high", planarReflectionStrength: 1 };
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
    if (source.roughness !== undefined) appearance.roughness = number(source.roughness, .04, 1);
    if (source.reflectionStrength !== undefined) appearance.reflectionStrength = number(source.reflectionStrength, 0, 3);
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
