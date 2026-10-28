/**
 * Stable placement ids and semantic roles (World Builder v0.4 §13.4).
 *
 * Placements are grouped by asset and addressed by index, so neither survives
 * an asset swap. `LayoutPlacement.id` is the identity World Builder ownership
 * records point at; `LayoutPlacement.role` names what the object is
 * (`building.residential.detached`) so a region profile can pick its asset and
 * a missing asset can fall back to a placeholder. Dependency-free: shared by the
 * save validator, the editor and the generators.
 */
import type { RoomLayout } from "./layout";

export const PLACEMENT_ID_MAX_LENGTH = 128;
export const SEMANTIC_ROLE_MAX_LENGTH = 128;

/** Editor ids look like `plc-<base36>-<base36>`; anything path- and JSON-key-safe is accepted. */
const PLACEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** Dotted segments, each starting with a lowercase letter: `prop.sign.speedLimit`. */
const SEMANTIC_ROLE = /^[a-z][A-Za-z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)*$/;

export function isPlacementId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= PLACEMENT_ID_MAX_LENGTH &&
    PLACEMENT_ID.test(value)
  );
}

export function isSemanticRole(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= SEMANTIC_ROLE_MAX_LENGTH &&
    SEMANTIC_ROLE.test(value)
  );
}

/** Every placement id in the layout, for minting a fresh unique one. */
export function collectPlacementIds(layout: Pick<RoomLayout, "instances">): Set<string> {
  const ids = new Set<string>();
  for (const group of layout.instances) {
    for (const placement of group.placements) {
      if (placement.id !== undefined) ids.add(placement.id);
    }
  }
  return ids;
}

/** The first id that appears twice, or null. Ids are unique per layout. */
export function findDuplicatePlacementId(
  instances: ReadonlyArray<{ placements: ReadonlyArray<{ id?: unknown }> }>,
): string | null {
  const seen = new Set<string>();
  for (const group of instances) {
    for (const placement of group.placements) {
      if (typeof placement.id !== "string") continue;
      if (seen.has(placement.id)) return placement.id;
      seen.add(placement.id);
    }
  }
  return null;
}
