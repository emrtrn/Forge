/**
 * `fences` stage: lot boundary fences for the roles whose region profile spec
 * has a `fence` (World Builder plan v0.4 §13.5 "L7 Donatı"; F1 step 13b).
 *
 * Runs last, after `furniture`, and, unlike the stages before it, after
 * Apply Pads: a fence follows the ground, and the pads change the ground at
 * the lot boundary (user decision, 2026-10-29). Run before the bake, it shows
 * updates after it — re-apply it then.
 *
 * Each role-holding lot whose role has a fence gets pieces along its outline
 * (`fences.ts`): `id` `wb-fence-<host parcel>-<n>`, the fence's `role`, a
 * `shape:cube` `thickness` deep in its `placeholderColor` or the role
 * family's colour, open at the entrance and wherever a road, building or
 * street furniture is; a boundary two fenced lots share gets one fence. A
 * protected settlement keeps its fences. No models yet: a modular fence
 * model would need tiling, a later step.
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { sourceDistance, type DistanceSource } from "../field";
import { FENCE_SINK, planFence, type FencePiece } from "../fences";
import { placementFootprint } from "../furniture";
import { mergedPolygon } from "../landUse";
import { streetLines, waterSources } from "../masks";
import type { WorldPoint } from "../normalize";
import { DEFAULT_FENCE_THICKNESS, type FenceSpec } from "../regionProfile";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";
import { BUILDINGS_STAGE_ID } from "./buildings";
import { FURNITURE_STAGE_ID, furnitureColor } from "./furniture";
import { protectedAreas } from "./parcels";

export const FENCES_STAGE_ID = "fences";

/** Placement id prefix of the fence round a host parcel's lot. */
export function fencePlacementPrefix(parcelId: string): string {
  return `wb-fence-${parcelId}`;
}

/** Fences keep this far from water, metres. */
const WATER_CLEARANCE = 1;

export const fencesStage: WorldStage = {
  id: FENCES_STAGE_ID,
  label: "Fences",
  version: 1,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    const placements: GeneratedPlacement[] = [];
    const fenced = Object.entries(profile?.roles ?? {}).filter(([, spec]) => spec.fence !== undefined);
    if (fenced.length === 0) {
      warnings.push(profile ? "no region profile role has a fence" : "no region profile; no fences");
      return { placements, warnings };
    }
    const hosts = recipe.generated.parcels.filter((parcel) => parcel.role !== undefined && parcel.partOf === undefined);
    if (hosts.length === 0) {
      warnings.push("no parcel has a role yet; run Land use first");
      return { placements, warnings };
    }
    if (recipe.generated.pads.length > 0) warnings.push("fences follow the ground: run this stage after Apply Pads");

    const roads: DistanceSource[] = streetLines(input).lines.map((line) => ({ kind: "polyline", points: line.points, radii: line.halfWidths }));
    const water = waterSources(input).sources;
    const { obstacles, entrances } = lotObstacles(input);
    const laid: FencePiece[] = [];

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const own = recipe.generated.parcels.filter((parcel) => parcel.settlement === settlement.id);
      const lots = own.filter((parcel) => parcel.role !== undefined && parcel.partOf === undefined && profile!.roles[parcel.role]?.fence);
      if (lots.length === 0) continue;
      if (settlement.protected) {
        placements.push(...keptFences(input, lots.map((lot) => lot.id)));
        continue;
      }
      const guarded = protectedAreas(recipe, settlement);
      const perRole = new Map<string, { lots: number; length: number; pieces: number; open: number }>();
      const skipped: string[] = [];
      for (const host of lots) {
        const spec = profile!.roles[host.role!]!.fence!;
        const outline = mergedPolygon(own.filter((parcel) => parcel.id === host.id || parcel.partOf === host.id));
        if (!outline || outline.length < 4 || outline.length % 2 !== 0) {
          skipped.push(host.id);
          continue;
        }
        const entrance = host.placement === undefined ? undefined : entrances.get(host.placement);
        const result = planFence({
          outline,
          spec,
          ...(entrance === undefined ? {} : { entrance }),
          roads,
          obstacles,
          laid,
          blockedAt: (point) => water.some((source) => sourceDistance(point, source) <= WATER_CLEARANCE) || guarded.some((test) => test(point)),
          sampleHeight: input.sampleHeight,
        });
        result.pieces.forEach((piece, index) => placements.push(piecePlacement(`${fencePlacementPrefix(host.id)}-${index + 1}`, host.id, spec, piece)));
        const tally = perRole.get(spec.role) ?? { lots: 0, length: 0, pieces: 0, open: 0 };
        perRole.set(spec.role, {
          lots: tally.lots + 1, length: tally.length + result.length, pieces: tally.pieces + result.pieces.length, open: tally.open + result.open,
        });
      }
      for (const [role, tally] of perRole) {
        warnings.push(`${name}: ${role} round ${tally.lots} lots, ${Math.round(tally.length)} m in ${tally.pieces} pieces${tally.open > 0 ? `; ${Math.round(tally.open)} m left open at roads, buildings, furniture or water` : ""}`);
      }
      if (skipped.length > 0) warnings.push(`${name}: ${skipped.length} lots are not one strip run and get no fence: ${skipped.join(", ")}`);
    }
    return { placements, warnings };
  },
};

function piecePlacement(id: string, hostId: string, spec: FenceSpec, piece: FencePiece): GeneratedPlacement {
  const along: WorldPoint = [piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]];
  const length = Math.hypot(along[0], along[1]);
  const bottom = Math.min(...piece.heights) - FENCE_SINK;
  const top = (piece.heights[0] + piece.heights[1]) / 2 + spec.height;
  const placement: LayoutPlacement & { id: string } = {
    id,
    role: spec.role,
    name: `${spec.role} ${hostId}`,
    position: [(piece.a[0] + piece.b[0]) / 2, (bottom + top) / 2, (piece.a[1] + piece.b[1]) / 2],
    // Local +X runs along the piece.
    rotation: [0, (Math.atan2(-along[1], along[0]) * 180) / Math.PI, 0],
    scale: [length / SHAPE_PRIMITIVE_SIZE, (top - bottom) / SHAPE_PRIMITIVE_SIZE, (spec.thickness ?? DEFAULT_FENCE_THICKNESS) / SHAPE_PRIMITIVE_SIZE],
    color: spec.placeholderColor ?? furnitureColor(spec.role),
  };
  return { assetId: shapeAssetId("cube"), placement };
}

/** Building and street furniture footprints, and where each building's entrance meets its lot front. */
function lotObstacles(input: StageInput): { obstacles: WorldPoint[][]; entrances: Map<string, WorldPoint> } {
  const obstacles: WorldPoint[][] = [];
  const entrances = new Map<string, WorldPoint>();
  const owned = input.recipe.ownership.placements;
  const sizes = new Map((input.profile?.streetFurniture ?? []).map((rule) => [rule.role, rule.size] as const));
  for (const group of input.layout.instances) {
    for (const placement of group.placements) {
      const stage = placement.id === undefined ? undefined : owned[placement.id]?.stage;
      if (stage === BUILDINGS_STAGE_ID) {
        const { center, face, footprint, halfDepth } = placementFootprint(placement);
        obstacles.push(footprint);
        entrances.set(placement.id!, [center[0] + face[0] * halfDepth, center[1] + face[1] * halfDepth]);
      } else if (stage === FURNITURE_STAGE_ID) {
        obstacles.push(placementFootprint(placement, placement.role === undefined ? undefined : sizes.get(placement.role)).footprint);
      }
    }
  }
  return { obstacles, entrances };
}

/** The fences of a protected settlement's lots as they are in the level. */
function keptFences(input: StageInput, hostIds: readonly string[]): GeneratedPlacement[] {
  const prefixes = hostIds.map((id) => `${fencePlacementPrefix(id)}-`);
  const kept: GeneratedPlacement[] = [];
  for (const group of input.layout.instances) {
    for (const placement of group.placements) {
      if (placement.id === undefined || input.recipe.ownership.placements[placement.id]?.stage !== FENCES_STAGE_ID) continue;
      if (prefixes.some((prefix) => placement.id!.startsWith(prefix))) {
        kept.push({ assetId: group.assetId, placement: structuredClone(placement) as LayoutPlacement & { id: string } });
      }
    }
  }
  return kept;
}
