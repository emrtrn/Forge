/**
 * Loads asset-level material slot assignments (`*.materials.json` sidecars).
 * Reads are plain static fetches from `public/`, so this is safe for runtime
 * and editor. Editor-only writes live in `assetMaterialSlotsStore`.
 */
import { readOptionalSidecar } from "@/project/contentLoader";
import { requireSidecar } from "@engine/assets/contentValidation";
import { Mesh, type Material, type Object3D } from "three";

export interface AssetMaterialSlotsDef {
  schema: 1;
  slots: string[];
}

export interface AssetMaterialElement {
  slotIndex: number;
  label: string;
  sourceMaterialName: string;
}

export function materialSlotsSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  return `${withoutExt}.materials.json`;
}

export function defaultAssetMaterialSlots(): AssetMaterialSlotsDef {
  return { schema: 1, slots: [] };
}

export async function loadAssetMaterialSlots(modelPath: string): Promise<AssetMaterialSlotsDef> {
  return readOptionalSidecar(materialSlotsSidecarPath(modelPath), normalizeAssetMaterialSlots,
    defaultAssetMaterialSlots, (raw, path) => requireSidecar(raw, path, ["slots"]));
}

export function normalizeAssetMaterialSlots(value: unknown): AssetMaterialSlotsDef {
  if (!value || typeof value !== "object") return defaultAssetMaterialSlots();
  const input = value as Record<string, unknown>;
  const rawSlots = Array.isArray(input.slots) ? input.slots : [];
  return {
    schema: 1,
    slots: rawSlots.map((slot) => (typeof slot === "string" ? slot : "")),
  };
}

export function hasAssignedMaterialSlots(slots: AssetMaterialSlotsDef | undefined): boolean {
  return Boolean(slots?.slots.some((slot) => slot.length > 0));
}

export function assignedMaterialSlotIds(slots: AssetMaterialSlotsDef | undefined): string[] {
  return slots?.slots.filter((slot) => slot.length > 0) ?? [];
}

export function collectAssetMaterialElements(root: Object3D): AssetMaterialElement[] {
  const materials = collectUniqueMaterials(root);
  const count = Math.max(1, materials.length);
  return Array.from({ length: count }, (_, slotIndex) => {
    const sourceMaterialName = materials[slotIndex]?.name || `Element ${slotIndex}`;
    return {
      slotIndex,
      label: `Element ${slotIndex}`,
      sourceMaterialName,
    };
  });
}

export function applyMaterialSlotOverrides(
  root: Object3D,
  slots: AssetMaterialSlotsDef | undefined,
  materialForSlot: (materialId: string) => Material | undefined,
  transformMaterial?: (material: Material) => Material,
): void {
  if (!hasAssignedMaterialSlots(slots)) return;
  const activeSlots = slots!;
  const slotByMaterial = new Map<Material, number>();
  collectUniqueMaterials(root).forEach((material, index) => slotByMaterial.set(material, index));
  const transform = transformMaterial ?? ((material: Material) => material);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = materialArray(object.material);
    const resolved = materials.map((material, localIndex) => {
      const slotIndex = slotByMaterial.get(material) ?? localIndex;
      const materialId = activeSlots.slots[slotIndex] ?? "";
      return transform((materialId ? materialForSlot(materialId) : undefined) ?? material);
    });
    object.material = Array.isArray(object.material) || resolved.length > 1 ? resolved : resolved[0]!;
  });
}

export function resolveMeshMaterialSlots(
  source: Material | Material[],
  slots: AssetMaterialSlotsDef | undefined,
  materialForSlot: (materialId: string) => Material | undefined,
  transformMaterial: (material: Material) => Material = (material) => material,
): Material | Material[] {
  if (!hasAssignedMaterialSlots(slots)) {
    return Array.isArray(source) ? source.map(transformMaterial) : transformMaterial(source);
  }
  const sourceMaterials = materialArray(source);
  const maxLength = Math.max(sourceMaterials.length, slots?.slots.length ?? 0);
  const resolved = Array.from({ length: maxLength }, (_, index) => {
    const original = sourceMaterials[index] ?? sourceMaterials[0]!;
    const materialId = slots?.slots[index] ?? "";
    const override = materialId ? materialForSlot(materialId) : undefined;
    return transformMaterial(override ?? original);
  });
  return Array.isArray(source) || resolved.length > 1 ? resolved : resolved[0]!;
}

function materialArray(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

function collectUniqueMaterials(root: Object3D): Material[] {
  const materials: Material[] = [];
  const seen = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of materialArray(object.material)) {
      if (seen.has(material)) continue;
      seen.add(material);
      materials.push(material);
    }
  });
  return materials;
}
