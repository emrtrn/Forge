/**
 * Selection highlight for the RTS Game Mode — the visible half of "click a unit
 * and see that it is picked".
 *
 * Deliberately the smallest thing that works: the picked entity's meshes get a
 * cloned, emissive-tinted copy of their material, and clearing puts the original
 * back and disposes the clone. Cloning matters — placed actors share their class'
 * materials, so tinting in place would light up every copy of that unit on the
 * map. A real game replaces this with its own affordance (decals, outlines, a
 * unit ring); what the plan needs proven is that a Game Mode can own selection
 * with nothing but the runtime's pick bridge.
 */
import { Mesh, type Material, type Object3D } from "three";

/** A material that can be emissively tinted (Standard/Physical/Lambert/Phong). */
type EmissiveMaterial = Material & {
  emissive?: { setHex(hex: number): void; getHex(): number };
  emissiveIntensity?: number;
};

interface TintedMesh {
  readonly mesh: Mesh;
  readonly original: Material | Material[];
  readonly clones: Material[];
}

/** Default highlight tint: a cool selection blue, bright enough to read at zoom. */
export const RTS_SELECTION_TINT = 0x3fa9ff;

function hasEmissive(material: Material): material is EmissiveMaterial {
  return typeof (material as EmissiveMaterial).emissive?.setHex === "function";
}

function tint(material: Material, hex: number): Material {
  const clone = material.clone();
  if (hasEmissive(clone)) {
    clone.emissive?.setHex(hex);
    clone.emissiveIntensity = 1;
  }
  return clone;
}

export class RtsSelectionHighlight {
  private entity: string | null = null;
  private tinted: TintedMesh[] = [];

  constructor(private readonly hex: number = RTS_SELECTION_TINT) {}

  /** Entity id currently selected, or null. */
  get selectedEntityId(): string | null {
    return this.entity;
  }

  /** Selects an entity and tints its meshes, replacing any previous selection. */
  select(entityId: string, object: Object3D): void {
    if (this.entity === entityId) return;
    this.clear();
    this.entity = entityId;
    object.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const original = node.material as Material | Material[];
      const clones = Array.isArray(original)
        ? original.map((material) => tint(material, this.hex))
        : [tint(original, this.hex)];
      node.material = Array.isArray(original) ? clones : clones[0]!;
      this.tinted.push({ mesh: node, original, clones });
    });
  }

  /** Clears the selection and restores every tinted mesh's own material. */
  clear(): void {
    for (const entry of this.tinted) {
      entry.mesh.material = entry.original;
      for (const clone of entry.clones) clone.dispose();
    }
    this.tinted = [];
    this.entity = null;
  }
}
