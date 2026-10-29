/**
 * `furniture` stage: street furniture for every sited settlement (World
 * Builder plan v0.4 §13.3 L7, §13.5 "L7 Donatı"; F1 step 13a).
 *
 * Runs last, after `buildings`, and reads the region profile's
 * `streetFurniture` rules: a name or speed sign at each entrance (`gate`),
 * a prop at each junction (`junction`) and lights along the roads
 * (`interval`), all inside the settlement's core (`furniture.ts`). Every prop
 * is a placement — `id` `wb-furniture-<settlement>-<role>-<n>`, the rule's
 * `role` — so a model can replace it later keeping its identity (WB-17): one
 * of the rule's `assetIds` (seeded, standing on its pivot), else a
 * `shape:cube` of the rule's `size` in its `placeholderColor` or the role
 * family's colour.
 *
 * Props keep off the roads, the buildings, their pads and the ground in front
 * of their entrances. Their level comes from the road spline, not the
 * ground, so they stay up to date after Apply Pads. The report gives, per
 * rule, how many spots got a prop and why the others did not. A protected
 * settlement keeps its furniture. Parcel boundary fences are a later slice
 * (13b).
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { sourceDistance } from "../field";
import { entranceZone, planFurniture, rectangle, type FurnitureBlock, type FurnitureLine, type RuleOutcome } from "../furniture";
import { streetLines, waterSources } from "../masks";
import type { WorldPoint } from "../normalize";
import { mulberry32 } from "../parcels";
import type { PlanSettlement, WorldRecipe } from "../recipe";
import type { StreetFurnitureRule } from "../regionProfile";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";
import { BUILDINGS_STAGE_ID } from "./buildings";
import { hashSeed, protectedAreas } from "./parcels";
import { STREETS_STAGE_ID } from "./streets";

export const FURNITURE_STAGE_ID = "furniture";

/** Placement id prefix of a settlement's furniture. */
export function furniturePlacementPrefix(settlementId: string): string {
  return `wb-furniture-${settlementId}`;
}

/** Placeholder colour by role family (§13.4: props yellow, vegetation green). */
export const FURNITURE_COLORS = { prop: "#f5cf3a", vegetation: "#4f9d45", other: "#b8bcc2" } as const;
/** A placeholder box reaches this far below the road level, so it never floats on a cross slope, metres. */
export const FURNITURE_SINK = 0.3;
/** Props keep this far from water, metres. */
const WATER_CLEARANCE = 1;
/** Mixed into the settlement seed so the furniture stream differs from the others. */
const SEED_SALT = 0x46524e54;

const BLOCK_TEXT: Record<FurnitureBlock, string> = {
  road: "road", building: "building", pad: "pad", entrance: "entrance", furniture: "other furniture",
  water: "water", protected: "protected", offTerrain: "off terrain",
};

export function furnitureColor(role: string): string {
  const family = role.split(".")[0];
  return family === "prop" ? FURNITURE_COLORS.prop : family === "vegetation" ? FURNITURE_COLORS.vegetation : FURNITURE_COLORS.other;
}

export const furnitureStage: WorldStage = {
  id: FURNITURE_STAGE_ID,
  label: "Street furniture",
  version: 1,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    const placements: GeneratedPlacement[] = [];
    if (recipe.plan.settlements.length > 0 && recipe.generated.sites.length === 0) {
      warnings.push("no settlement has a site yet; run Settlement sites first");
      return { placements, warnings };
    }
    const rules = profile?.streetFurniture ?? [];
    if (!profile) warnings.push("no region profile; no street furniture");
    else if (rules.length === 0) warnings.push("the region profile has no street furniture rules");
    if (recipe.generated.parcels.some((parcel) => parcel.role !== undefined) && recipe.generated.pads.length === 0) {
      warnings.push("no building pads yet; run Buildings first so furniture keeps clear of them");
    }

    // Inner streets carry no plan edge: they are local roads.
    const lines: FurnitureLine[] = streetLines(input).lines.map((line) =>
      line.roadClass === undefined && recipe.ownership.splines[line.id]?.stage === STREETS_STAGE_ID ? { ...line, roadClass: "local" } : line);
    const water = waterSources(input).sources;
    const obstacles = buildingObstacles(input, lines);

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const site = recipe.generated.sites.find((entry) => entry.settlement === settlement.id);
      if (!site) {
        warnings.push(`${name} has no site; no furniture`);
        continue;
      }
      if (settlement.protected) {
        placements.push(...keptFurniture(input, settlement.id));
        continue;
      }
      if (rules.length === 0) continue;
      for (const line of lines) {
        if (line.heights !== undefined || line.edge === undefined) continue;
        if (sourceDistance(site.center, { kind: "polyline", points: line.points }) <= site.coreRadius) {
          warnings.push(`${name}: road ${line.edge} has no spline yet and gets no furniture; run Roads first`);
        }
      }
      const guarded = protectedAreas(recipe, settlement);
      const result = planFurniture({
        rules,
        lines,
        center: site.center,
        coreRadius: site.coreRadius,
        gateNodes: recipe.plan.roadGraph.nodes
          .filter((node) => node.kind === "gate" && node.settlement === settlement.id)
          .map((node) => node.position),
        trafficSide: profile!.traffic.side,
        obstacles,
        blockedAt: (point) => water.some((source) => sourceDistance(point, source) <= WATER_CLEARANCE)
          ? "water"
          : guarded.some((test) => test(point)) ? "protected" : null,
        sampleHeight: input.sampleHeight,
      });

      const random = mulberry32(((seedOf(recipe, settlement)) ^ SEED_SALT) >>> 0);
      const numbers = new Map<string, number>();
      for (const prop of result.props) {
        const rule = rules[prop.rule]!;
        const n = (numbers.get(rule.role) ?? 0) + 1;
        numbers.set(rule.role, n);
        placements.push(propPlacement(`${furniturePlacementPrefix(settlement.id)}-${rule.role}-${n}`, settlement.id, rule, prop, random));
      }
      result.outcomes.forEach((outcome, index) => warnings.push(`${name}: ${outcomeText(rules[index]!, outcome)}`));
    }
    return { placements, warnings };
  },
};

function propPlacement(
  id: string,
  settlementId: string,
  rule: StreetFurnitureRule,
  prop: { center: WorldPoint; yawDeg: number; base: number },
  random: () => number,
): GeneratedPlacement {
  const [width, height, depth] = rule.size;
  const assetId = rule.assetIds && rule.assetIds.length > 0
    ? rule.assetIds[Math.min(rule.assetIds.length - 1, Math.floor(random() * rule.assetIds.length))]!
    : null;
  const common = { id, role: rule.role, name: `${rule.role} ${settlementId}`, rotation: [0, prop.yawDeg, 0] as [number, number, number] };
  if (assetId !== null) {
    // An imported model stands on its pivot (bottom centre, plan §13.7).
    return { assetId, placement: { ...common, position: [prop.center[0], prop.base, prop.center[1]] } };
  }
  const tall = height + FURNITURE_SINK;
  const placement: LayoutPlacement & { id: string } = {
    ...common,
    position: [prop.center[0], prop.base - FURNITURE_SINK + tall / 2, prop.center[1]],
    scale: [width / SHAPE_PRIMITIVE_SIZE, tall / SHAPE_PRIMITIVE_SIZE, depth / SHAPE_PRIMITIVE_SIZE],
    color: rule.placeholderColor ?? furnitureColor(rule.role),
  };
  return { assetId: shapeAssetId("cube"), placement };
}

function outcomeText(rule: StreetFurnitureRule, outcome: RuleOutcome): string {
  const label = `${rule.role} (${rule.placement})`;
  const classes = rule.roadClasses.join(", ");
  if (outcome.spots === 0) {
    const where = rule.placement === "gate"
      ? `no ${classes} road enters its core`
      : rule.placement === "junction" ? `no junction with a ${classes} road in its core` : `no ${classes} road in its core`;
    return `${label}: none; ${where}`;
  }
  const blocked = Object.entries(outcome.blocked) as Array<[FurnitureBlock, number]>;
  const total = blocked.reduce((sum, [, count]) => sum + count, 0);
  const why = blocked.map(([reason, count]) => `${count} ${BLOCK_TEXT[reason]}`).join(", ");
  return `${label}: ${outcome.placed} of ${outcome.spots} spots${total > 0 ? `; ${total} blocked (${why})` : ""}`;
}

/** Footprints, pads and the ground in front of the entrances of the buildings stage's placements. */
function buildingObstacles(input: StageInput, lines: readonly FurnitureLine[]) {
  const buildings: WorldPoint[][] = [];
  const entrances: WorldPoint[][] = [];
  const owned = input.recipe.ownership.placements;
  for (const group of input.layout.instances) {
    for (const placement of group.placements) {
      if (placement.id === undefined || owned[placement.id]?.stage !== BUILDINGS_STAGE_ID) continue;
      const yaw = ((placement.rotation?.[1] ?? placement.rotationYDeg ?? 0) * Math.PI) / 180;
      const face: WorldPoint = [Math.sin(yaw), Math.cos(yaw)];
      const scale = typeof placement.scale === "number" ? [placement.scale, placement.scale, placement.scale] : placement.scale ?? [1, 1, 1];
      const halfWidth = (scale[0]! * SHAPE_PRIMITIVE_SIZE) / 2;
      const halfDepth = (scale[2]! * SHAPE_PRIMITIVE_SIZE) / 2;
      const center: WorldPoint = [placement.position[0], placement.position[2]];
      buildings.push(rectangle(center, face, halfWidth, halfDepth));
      entrances.push(entranceZone([center[0] + face[0] * halfDepth, center[1] + face[1] * halfDepth], face, lines));
    }
  }
  return { buildings, pads: input.recipe.generated.pads.map((pad) => pad.polygon), entrances };
}

/** A protected settlement's furniture as it is in the level. */
function keptFurniture(input: StageInput, settlementId: string): GeneratedPlacement[] {
  const prefix = `${furniturePlacementPrefix(settlementId)}-`;
  const kept: GeneratedPlacement[] = [];
  for (const group of input.layout.instances) {
    for (const placement of group.placements) {
      if (placement.id?.startsWith(prefix) && input.recipe.ownership.placements[placement.id]?.stage === FURNITURE_STAGE_ID) {
        kept.push({ assetId: group.assetId, placement: structuredClone(placement) as LayoutPlacement & { id: string } });
      }
    }
  }
  return kept;
}

function seedOf(recipe: WorldRecipe, settlement: PlanSettlement): number {
  return settlement.seed ?? hashSeed(recipe.seed, settlement.id);
}
