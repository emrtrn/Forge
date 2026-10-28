/**
 * `buildings` stage: a role placeholder and a pad on every role-holding lot
 * (World Builder plan v0.4 §13.4, §13.5 L6; F1 step 12, T40 + T21 data).
 *
 * Reads the parcels the `landUse` stage gave roles (run it first) and writes
 * one `shape:cube` per lot — `id` `wb-building-<host parcel>`, the parcel's
 * `role`, the role's or land use's colour, entrance (+Z) facing the street —
 * plus the host parcel's `placement` and a pad per building in
 * `recipe.generated.pads`. Pads are data: the editor's Apply Pads bakes them
 * into the terrain as one undo step (decision 19); this stage never edits the
 * terrain. A placeholder keeps its `id` and `role` when a model replaces it
 * later (WB-17).
 *
 * The report gives the buildings per land use, lots too small for their role
 * and pads that need much cut or fill. A protected settlement keeps its
 * buildings and pads.
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { planBuilding } from "../buildings";
import { roleLandUse } from "../landUse";
import { mulberry32 } from "../parcels";
import type { GeneratedPad, GeneratedParcel } from "../recipe";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";
import { LAND_USES, type LandUse } from "../vocabulary";
import { hashSeed } from "./parcels";

export const BUILDINGS_STAGE_ID = "buildings";

/** Placement id of the building on a host parcel. */
export function buildingPlacementId(parcelId: string): string {
  return `wb-building-${parcelId}`;
}

/** Cut or fill above this at a footprint corner is reported, metres. */
const GRADING_REPORT = 2;
/** Mixed into the settlement seed so the building stream differs from the others. */
const SEED_SALT = 0x424c4447;

export const buildingsStage: WorldStage = {
  id: BUILDINGS_STAGE_ID,
  label: "Buildings",
  version: 1,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    const placements: GeneratedPlacement[] = [];
    const pads: GeneratedPad[] = [];
    if (recipe.plan.settlements.length > 0 && !recipe.generated.parcels.some((parcel) => parcel.role !== undefined)) {
      warnings.push("no parcel has a role yet; run Land use first");
      return { placements, warnings };
    }
    const placementOf = new Map<string, string>();

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const own = recipe.generated.parcels.filter((parcel) => parcel.settlement === settlement.id);
      const hosts = own.filter((parcel) => parcel.role !== undefined && parcel.partOf === undefined);
      if (hosts.length === 0) continue;
      if (settlement.protected) {
        for (const host of hosts) {
          if (host.placement === undefined) continue;
          const kept = findPlacement(input, host.placement);
          if (kept) placements.push(kept);
          placementOf.set(host.id, host.placement);
        }
        pads.push(...recipe.generated.pads.filter((pad) => pad.settlement === settlement.id));
        continue;
      }

      const random = mulberry32(((settlement.seed ?? hashSeed(recipe.seed, settlement.id)) ^ SEED_SALT) >>> 0);
      const counts = new Map<LandUse, number>();
      const squeezed: string[] = [];
      const graded: string[] = [];
      for (const host of hosts) {
        const role = host.role!;
        const spec = profile?.roles[role];
        const landUse = host.landUse ?? spec?.landUse ?? roleLandUse(role, "any", profile);
        const lot = own.filter((parcel) => parcel.id === host.id || parcel.partOf === host.id);
        const building = planBuilding({
          lot, landUse, spec, parcel: profile?.parcels[landUse], random, sampleHeight: input.sampleHeight,
        });
        if (!building) {
          warnings.push(`${name}: parcel ${host.id} (${role}) has no room for a building or is off the terrain; skipped`);
          continue;
        }
        const id = buildingPlacementId(host.id);
        const top = building.pad.height + building.height;
        const placement: LayoutPlacement & { id: string } = {
          id,
          role,
          name: `${role} ${host.id}`,
          position: [building.center[0], (building.base + top) / 2, building.center[1]],
          rotation: [0, building.yawDeg, 0],
          scale: [building.width / SHAPE_PRIMITIVE_SIZE, (top - building.base) / SHAPE_PRIMITIVE_SIZE, building.depth / SHAPE_PRIMITIVE_SIZE],
          color: building.color,
        };
        placements.push({ assetId: shapeAssetId("cube"), placement });
        pads.push({ id, settlement: settlement.id, polygon: building.pad.polygon, height: building.pad.height });
        placementOf.set(host.id, id);
        counts.set(landUse, (counts.get(landUse) ?? 0) + 1);
        if (building.squeezed) squeezed.push(host.id);
        if (building.grading > GRADING_REPORT) graded.push(`${host.id} ${building.grading} m`);
      }
      const split = LAND_USES.filter((landUse) => counts.has(landUse)).map((landUse) => `${counts.get(landUse)} ${landUse}`);
      warnings.push(`${name}: ${[...counts.values()].reduce((sum, count) => sum + count, 0)} buildings (${split.join(", ")})`);
      if (squeezed.length > 0) warnings.push(`${name}: ${squeezed.length} lots are smaller than their role's footprint; squeezed: ${squeezed.join(", ")}`);
      if (graded.length > 0) warnings.push(`${name}: ${graded.length} pads cut or fill more than ${GRADING_REPORT} m: ${graded.join(", ")}`);
    }

    const parcels = recipe.generated.parcels.map((parcel): GeneratedParcel => {
      const placement = placementOf.get(parcel.id);
      if (placement === parcel.placement) return parcel;
      // Field order matches the recipe normalizer's: `placement` is last.
      const { placement: _old, ...rest } = parcel;
      return placement === undefined ? rest : { ...rest, placement };
    });
    return { placements, generated: { parcels, pads }, warnings };
  },
};

function findPlacement(input: StageInput, id: string): GeneratedPlacement | null {
  for (const group of input.layout.instances) {
    const placement = group.placements.find((entry) => entry.id === id);
    if (placement) return { assetId: group.assetId, placement: structuredClone(placement) as LayoutPlacement & { id: string } };
  }
  return null;
}
