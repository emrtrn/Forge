import { resolvePhysicalMaterial, type PhysicalMaterialDef } from "../scene/collision";

/** Shared editor controls and strict terrain save/runtime allowlist. Values use SI units. */
export const TERRAIN_PHYSICS_FIELDS = [
  { key: "tractionCoefficient", group: "vehicle", label: "Traction", min: 0, max: 10, step: 0.01, fallback: 1, advanced: false, hint: "Force / wheel load. Higher values transfer more engine force to the ground." },
  { key: "rollingResistance", group: "vehicle", label: "Rolling Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: false, hint: "Higher values resist wheel movement." },
  { key: "maxDepth", group: "deformation", label: "Max Depth (m)", min: 0, max: 5, step: 0.01, fallback: 0, advanced: false, hint: "Soft layer thickness. Zero disables sinking and tracks." },
  { key: "digRate", group: "deformation", label: "Dig Rate (m/s)", min: 0, max: 5, step: 0.01, fallback: 0, advanced: false, hint: "Extra digging while a powered wheel slips." },
  { key: "frictionSlipScale", group: "vehicle", label: "Friction Slip Scale", min: 0, max: 10, step: 0.01, fallback: 1, advanced: true, hint: "Multiplier on the vehicle wheel friction setting." },
  { key: "sideFrictionScale", group: "vehicle", label: "Side Grip Scale", min: 0, max: 10, step: 0.01, fallback: 1, advanced: true, hint: "Multiplier on lateral wheel stiffness." },
  { key: "compaction", group: "deformation", label: "Compaction", min: 0, max: 1, step: 0.01, fallback: 0, advanced: true, hint: "Fraction of target track depth reached per pass." },
  { key: "sinkResistance", group: "deformation", label: "Belly Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Drag when soft ground reaches the chassis bottom." },
  { key: "ploughResistance", group: "deformation", label: "Plough Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Resistance from a buried wheel pushing through soil." },
  { key: "ploughExponent", group: "deformation", label: "Plough Exponent", min: 1, max: 4, step: 0.1, fallback: 1, advanced: true, hint: "How strongly plough resistance grows with burial." },
  { key: "rollingResistanceAtRest", group: "deformation", label: "Rolling Drag at Rest", min: 0, max: 1, step: 0.01, fallback: 1, advanced: true, hint: "Share of buried rolling drag applied at zero speed." },
  { key: "highSpeedResistance", group: "deformation", label: "High Speed Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Extra soil drag at higher speeds." },
  { key: "resistanceSpeedMps", group: "deformation", label: "Drag Reference (m/s)", min: 0.1, max: 200, step: 0.1, fallback: 20 / 3.6, advanced: true, hint: "Full high speed drag at this speed; starts at half this speed. Not a speed limit." },
  { key: "recoveryRate", group: "deformation", label: "Track Refill (m/s)", min: 0, max: 5, step: 0.001, fallback: 0, advanced: true, hint: "Track refill speed. Zero preserves tracks." },
] as const;

export type TerrainPhysicsKey = typeof TERRAIN_PHYSICS_FIELDS[number]["key"];
export type TerrainPhysicalMaterialOverrides = Partial<Record<TerrainPhysicsKey, number>>;

export function normalizeTerrainPhysicalOverrides(value: unknown): TerrainPhysicalMaterialOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid terrain physical material overrides");
  const input = value as Record<string, unknown>;
  const result: TerrainPhysicalMaterialOverrides = {};
  for (const key of Object.keys(input)) {
    const field = TERRAIN_PHYSICS_FIELDS.find((entry) => entry.key === key);
    const number = input[key];
    if (!field || typeof number !== "number" || !Number.isFinite(number) || number < field.min || number > field.max) {
      throw new Error(`invalid terrain physical material parameter: ${key}`);
    }
    result[field.key] = number;
  }
  return result;
}

/** Copy only the selected layer's supported blocks; never mutate shared presets. */
export function resolveTerrainPhysicalMaterial(id: string | null | undefined, overrides?: TerrainPhysicalMaterialOverrides): PhysicalMaterialDef {
  const preset = resolvePhysicalMaterial(id ?? undefined);
  const result = { ...preset, ...(preset.vehicle ? { vehicle: { ...preset.vehicle } } : {}),
    ...(preset.deformation ? { deformation: { ...preset.deformation } } : {}) };
  for (const field of TERRAIN_PHYSICS_FIELDS) {
    const value = overrides?.[field.key];
    const block = result[field.group] as Record<string, number> | undefined;
    if (block && value !== undefined) block[field.key] = value;
  }
  return result;
}

export function terrainPhysicsValue(profile: PhysicalMaterialDef, field: typeof TERRAIN_PHYSICS_FIELDS[number]): number {
  return (profile[field.group] as Record<string, number> | undefined)?.[field.key] ?? field.fallback;
}
