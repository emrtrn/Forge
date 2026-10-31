import { resolvePhysicalMaterial, type PhysicalMaterialDef } from "../scene/collision";

/** Shared editor controls and strict terrain save/runtime allowlist. Values use SI units. */
export const TERRAIN_PHYSICS_FIELDS = [
  { key: "tractionCoefficient", group: "vehicle", label: "Traction", min: 0, max: 10, step: 0.01, fallback: 1, advanced: false, hint: "Kuvvet / teker yükü. Yüksek değer motor kuvvetinin daha fazlasını zemine aktarır." },
  { key: "rollingResistance", group: "vehicle", label: "Rolling Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: false, hint: "Yüksek değer teker hareketine daha çok direnç gösterir." },
  { key: "maxDepth", group: "deformation", label: "Max Depth (m)", min: 0, max: 5, step: 0.01, fallback: 0, advanced: false, hint: "Yumuşak katman kalınlığı. 0 batmayı ve izleri kapatır." },
  { key: "digRate", group: "deformation", label: "Dig Rate (m/s)", min: 0, max: 5, step: 0.01, fallback: 0, advanced: false, hint: "Çekişli teker patinaj yaparken oluşan ek kazma." },
  { key: "frictionSlipScale", group: "vehicle", label: "Friction Slip Scale", min: 0, max: 10, step: 0.01, fallback: 1, advanced: true, hint: "Aracın teker sürtünme ayarına uygulanan çarpan." },
  { key: "sideFrictionScale", group: "vehicle", label: "Side Grip Scale", min: 0, max: 10, step: 0.01, fallback: 1, advanced: true, hint: "Tekerin yanal sertliğine uygulanan çarpan." },
  { key: "compaction", group: "deformation", label: "Compaction", min: 0, max: 1, step: 0.01, fallback: 0, advanced: true, hint: "Her geçişte ulaşılan hedef iz derinliği oranı." },
  { key: "sinkResistance", group: "deformation", label: "Belly Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Yumuşak zemin şasinin altına değdiğinde oluşan sürükleme." },
  { key: "ploughResistance", group: "deformation", label: "Plough Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Gömülü tekerin toprağı itmesinden doğan direnç." },
  { key: "ploughExponent", group: "deformation", label: "Plough Exponent", min: 1, max: 4, step: 0.1, fallback: 1, advanced: true, hint: "Pulluk direncinin gömülmeyle ne kadar hızlı arttığı." },
  { key: "rollingResistanceAtRest", group: "deformation", label: "Rolling Drag at Rest", min: 0, max: 1, step: 0.01, fallback: 1, advanced: true, hint: "Gömülü yuvarlanma sürüklemesinin sıfır hızda uygulanan payı." },
  { key: "highSpeedResistance", group: "deformation", label: "High Speed Resistance", min: 0, max: 10, step: 0.01, fallback: 0, advanced: true, hint: "Yüksek hızlarda ek toprak sürüklemesi." },
  { key: "resistanceSpeedMps", group: "deformation", label: "Drag Reference (m/s)", min: 0.1, max: 200, step: 0.1, fallback: 20 / 3.6, advanced: true, hint: "Yüksek hız sürüklemesi bu hızda tam değerine ulaşır, bu hızın yarısında başlar. Hız sınırı değildir." },
  { key: "recoveryRate", group: "deformation", label: "Track Refill (m/s)", min: 0, max: 5, step: 0.001, fallback: 0, advanced: true, hint: "İzlerin dolma hızı. 0 izleri korur." },
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
