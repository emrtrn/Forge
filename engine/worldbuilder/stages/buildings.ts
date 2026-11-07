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
 * terrain, and it stays up to date with its own baked pads. Stages that read
 * the ground near them (sites, parcels, roads, streets) see the levelled ground
 * on a re-run, so Apply Pads is the finishing step. A placeholder keeps its
 * `id` and `role` when a model replaces it later (WB-17).
 *
 * Slopes (`terraces.ts`, v2): where the ground beside a pad is more than
 * `WALL_THRESHOLD` above or below it, a stone retaining wall holds it (an
 * opening at the street entrance, with steps when the entrance meets a height
 * difference), and the pad blends in over `WALL_FALLOFF` so the wall holds the
 * step. An open lot (a square) whose ground varies more than `TERRACE_STEP` is
 * split into terraces across its depth, joined by walls and steps. Walls, steps
 * and terraces are measured once and kept with the pads: while a lot keeps its
 * outline and level a re-run reuses them, so baking the pads changes nothing.
 * Walls and steps are `shape:cube` placeholders (`structure.retainingWall`,
 * `structure.stairs`).
 *
 * The report gives the buildings per land use, lots too small for their role,
 * pads that need much cut or fill, and the walls, steps and terraces. A
 * protected settlement keeps its buildings and pads.
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { FOUNDATION, planBuilding, type PlannedBuilding } from "../buildings";
import { roleLandUse } from "../landUse";
import type { WorldPoint } from "../normalize";
import { mulberry32, polygonsOverlap } from "../parcels";
import type { GeneratedPad, GeneratedParcel } from "../recipe";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";
import { retainPad, STEP_RISE, terracePad, WALL_FALLOFF, WALL_THICKNESS, type PadStair, type PadWall } from "../terraces";
import { LAND_USES, type LandUse } from "../vocabulary";
import { hashSeed } from "./parcels";

export const BUILDINGS_STAGE_ID = "buildings";

/** Placement id of the building on a host parcel. */
export function buildingPlacementId(parcelId: string): string {
  return `wb-building-${parcelId}`;
}

/** Cut or fill above this at a footprint corner is reported, metres. */
const GRADING_REPORT = 2;
/** Width of the opening at a lot's street entrance, metres (an open lot's is wider). */
const ENTRANCE_WIDTH = 3;
const OPEN_ENTRANCE_WIDTH = 6;
const WALL_COLOR = "#9a978e";
const STAIR_COLOR = "#b5afa2";
/** Mixed into the settlement seed so the building stream differs from the others. */
const SEED_SALT = 0x424c4447;

export const buildingsStage: WorldStage = {
  id: BUILDINGS_STAGE_ID,
  label: "Buildings",
  version: 2,
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
      const planned: Array<{ id: string; role: string; host: GeneratedParcel; building: PlannedBuilding }> = [];
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
        planned.push({ id: buildingPlacementId(host.id), role, host, building });
        counts.set(landUse, (counts.get(landUse) ?? 0) + 1);
        if (building.squeezed) squeezed.push(host.id);
        if (building.grading > GRADING_REPORT) graded.push(`${host.id} ${building.grading} m`);
      }
      const { count: shared, members: sharedPads } = levelOverlappingPads(planned.map((entry) => entry.building));
      let wallCount = 0, stairCount = 0, terraced = 0;
      planned.forEach(({ id, role, host, building }, index) => {
        const previous = recipe.generated.pads.filter((pad) => (pad.building ?? pad.id) === id);
        const ground = padsFor(id, settlement.id, building, !sharedPads.has(index), previous, input.sampleHeight);
        if (ground.length > 1) terraced += 1;
        if (building.storeys > 0 || ground.length === 1) {
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
        } else {
          // An open lot on terraces: one slab per terrace; the first keeps the building's id.
          ground.forEach((pad, k) => {
            const slab = terraceSlab(building, pad);
            if (!slab) return;
            const top = pad.height + building.height;
            const base = pad.height - FOUNDATION;
            const placement: LayoutPlacement & { id: string } = {
              id: k === 0 ? id : terraceId(id, k),
              role,
              name: k === 0 ? `${role} ${host.id}` : `${role} ${host.id} terrace ${k}`,
              position: [round(slab.center[0]), round((base + top) / 2), round(slab.center[1])],
              rotation: [0, building.yawDeg, 0],
              scale: [building.width / SHAPE_PRIMITIVE_SIZE, round((top - base) / SHAPE_PRIMITIVE_SIZE), round(slab.depth / SHAPE_PRIMITIVE_SIZE)],
              color: building.color,
            };
            placements.push({ assetId: shapeAssetId("cube"), placement });
          });
        }
        for (const pad of ground) {
          (pad.walls ?? []).forEach((wall, n) => placements.push(wallPlacement(`${pad.id}-wall-${n}`, `${role} ${host.id} wall`, wall)));
          (pad.stairs ?? []).forEach((stair, n) => placements.push(...stairPlacements(`${pad.id}-stairs-${n}`, `${role} ${host.id} steps`, stair)));
          wallCount += pad.walls?.length ?? 0;
          stairCount += pad.stairs?.length ?? 0;
        }
        pads.push(...ground);
        placementOf.set(host.id, id);
      });
      const split = LAND_USES.filter((landUse) => counts.has(landUse)).map((landUse) => `${counts.get(landUse)} ${landUse}`);
      warnings.push(`${name}: ${[...counts.values()].reduce((sum, count) => sum + count, 0)} buildings (${split.join(", ")})`);
      if (squeezed.length > 0) warnings.push(`${name}: ${squeezed.length} lots are smaller than their role's footprint; squeezed: ${squeezed.join(", ")}`);
      if (graded.length > 0) warnings.push(`${name}: ${graded.length} pads cut or fill more than ${GRADING_REPORT} m: ${graded.join(", ")}`);
      if (shared > 0) warnings.push(`${name}: ${shared} pads overlap a neighbour's and share its level`);
      if (wallCount + stairCount + terraced > 0) {
        warnings.push(`${name}: ${wallCount} retaining walls, ${stairCount} flights of steps, ${terraced} lots on terraces`);
      }
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

/**
 * Pads that overlap (corner lots on two streets) would ask for two levels on
 * the same ground, and the bake would give the shared part to one of them.
 * Each overlapping group takes the mean of its pads' levels instead, so every
 * footprint corner ends up at its own pad's level and a re-run after the bake
 * computes the same levels. Rewrites the buildings in place; returns how many
 * pads share a level and which.
 */
function levelOverlappingPads(buildings: PlannedBuilding[]): { count: number; members: Set<number> } {
  const group = buildings.map((_, index) => index);
  const find = (index: number): number => (group[index] === index ? index : (group[index] = find(group[index]!)));
  for (let i = 0; i < buildings.length; i += 1) {
    for (let j = i + 1; j < buildings.length; j += 1) {
      if (polygonsOverlap(buildings[i]!.pad.polygon, buildings[j]!.pad.polygon)) group[find(j)] = find(i);
    }
  }
  const members = new Map<number, number[]>();
  buildings.forEach((_, index) => members.set(find(index), [...(members.get(find(index)) ?? []), index]));
  let shared = 0;
  const sharing = new Set<number>();
  for (const indices of members.values()) {
    if (indices.length < 2) continue;
    shared += indices.length;
    const level = Number((indices.reduce((sum, index) => sum + buildings[index]!.pad.height, 0) / indices.length).toFixed(2));
    for (const index of indices) {
      const building = buildings[index]!;
      building.pad.height = level;
      building.base = Number((level - FOUNDATION).toFixed(2));
      sharing.add(index);
    }
  }
  return { count: shared, members: sharing };
}

const terraceId = (id: string, k: number): string => `${id}-terrace-${k}`;

/**
 * The ground of one lot: its pad, or an open lot's terraces, with their walls and
 * steps. Reuses the previous run's pads while the lot keeps its outline (and, for
 * one pad, its level), so the walls do not follow the ground the bake changed.
 */
function padsFor(
  id: string,
  settlement: string,
  building: PlannedBuilding,
  mayTerrace: boolean,
  previous: readonly GeneratedPad[],
  sampleHeight: StageInput["sampleHeight"],
): GeneratedPad[] {
  if (previous.length > 0) {
    const first = previous[0]!;
    const last = previous[previous.length - 1]!;
    const outline = previous.length === 1 ? first.polygon : [first.polygon[0], first.polygon[1], last.polygon[2], last.polygon[3]];
    const sameLevel = previous.length > 1 || first.height === building.pad.height;
    if (sameLevel && JSON.stringify(outline) === JSON.stringify(building.pad.polygon)) return previous.map((pad) => structuredClone(pad));
  }
  const terraces = mayTerrace && building.storeys === 0 ? terracePad(building.frame, sampleHeight) : null;
  const split = terraces !== null && terraces.terraces.length > 1;
  const strips = split ? terraces.terraces : [{ polygon: building.pad.polygon, level: building.pad.height }];
  const last = strips.length - 1;
  return strips.map((strip, k) => {
    const openings = k === 0 ? [{ at: building.entrance, width: building.storeys === 0 ? OPEN_ENTRANCE_WIDTH : ENTRANCE_WIDTH }] : [];
    // Edges shared with a neighbouring terrace: the front (0) of every terrace but the first, the back (2) of every but the last.
    const skip = [...(k > 0 ? [0] : []), ...(k < last ? [2] : [])];
    const retained = retainPad(strip.polygon, strip.level, sampleHeight, openings, skip);
    // The wall pieces and steps between terrace k - 1 and k belong to terrace k.
    const walls = [...retained.walls, ...(split && k > 0 ? terraces.walls.filter((wall) => wall.boundary === k) : [])].map(({ from, to, bottom, top }) => ({ from, to, bottom, top }));
    const stairs = [...retained.stairs, ...(split && k > 0 ? terraces.stairs.filter((stair) => stair.boundary === k) : [])].map(({ foot, head, width, low, high }) => ({ foot, head, width, low, high }));
    const pad: GeneratedPad = { id: k === 0 ? id : terraceId(id, k), settlement, polygon: strip.polygon, height: strip.level };
    if (k > 0) pad.building = id;
    if (walls.length > 0 || split) pad.falloff = WALL_FALLOFF;
    if (walls.length > 0) pad.walls = walls;
    if (stairs.length > 0) pad.stairs = stairs;
    return pad;
  });
}

/** The part of an open lot's slab on one terrace: its centre and its depth across the street. */
function terraceSlab(building: PlannedBuilding, pad: GeneratedPad): { center: WorldPoint; depth: number } | null {
  const { center, inward } = building.frame;
  const depthAt = (p: WorldPoint): number => (p[0] - center[0]) * inward[0] + (p[1] - center[1]) * inward[1];
  const near = depthAt(pad.polygon[0]!);
  const far = depthAt(pad.polygon[3]!);
  const s0 = Math.max(-building.depth / 2, Math.min(near, far));
  const s1 = Math.min(building.depth / 2, Math.max(near, far));
  if (s1 - s0 < 0.5) return null;
  const mid = (s0 + s1) / 2;
  return { center: [center[0] + inward[0] * mid, center[1] + inward[1] * mid], depth: s1 - s0 };
}

function wallPlacement(id: string, name: string, wall: PadWall): GeneratedPlacement {
  const dx = wall.to[0] - wall.from[0];
  const dz = wall.to[1] - wall.from[1];
  const placement: LayoutPlacement & { id: string } = {
    id,
    role: "structure.retainingWall",
    name,
    position: [round((wall.from[0] + wall.to[0]) / 2), round((wall.bottom + wall.top) / 2), round((wall.from[1] + wall.to[1]) / 2)],
    // Local X runs along the wall.
    rotation: [0, round((Math.atan2(-dz, dx) * 180) / Math.PI), 0],
    scale: [round(Math.hypot(dx, dz) / SHAPE_PRIMITIVE_SIZE), round((wall.top - wall.bottom) / SHAPE_PRIMITIVE_SIZE), round(WALL_THICKNESS / SHAPE_PRIMITIVE_SIZE)],
    color: WALL_COLOR,
  };
  return { assetId: shapeAssetId("cube"), placement };
}

/** A solid flight: one block per step, each reaching from its tread to the head. */
function stairPlacements(id: string, name: string, stair: PadStair): GeneratedPlacement[] {
  const dx = stair.head[0] - stair.foot[0];
  const dz = stair.head[1] - stair.foot[1];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return [];
  const count = Math.max(1, Math.ceil((stair.high - stair.low) / STEP_RISE - 1e-9));
  // Local +Z runs up the flight.
  const yaw = round((Math.atan2(dx, dz) * 180) / Math.PI);
  return Array.from({ length: count }, (_, k): GeneratedPlacement => {
    const start = (run * k) / count;
    const along = (start + run) / 2;
    const bottom = stair.low - 0.1;
    const top = stair.low + ((stair.high - stair.low) * (k + 1)) / count;
    const placement: LayoutPlacement & { id: string } = {
      id: `${id}-${k}`,
      role: "structure.stairs",
      name,
      position: [round(stair.foot[0] + (dx / run) * along), round((bottom + top) / 2), round(stair.foot[1] + (dz / run) * along)],
      rotation: [0, yaw, 0],
      scale: [round(stair.width / SHAPE_PRIMITIVE_SIZE), round((top - bottom) / SHAPE_PRIMITIVE_SIZE), round((run - start) / SHAPE_PRIMITIVE_SIZE)],
      color: STAIR_COLOR,
    };
    return { assetId: shapeAssetId("cube"), placement };
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function findPlacement(input: StageInput, id: string): GeneratedPlacement | null {
  for (const group of input.layout.instances) {
    const placement = group.placements.find((entry) => entry.id === id);
    if (placement) return { assetId: group.assetId, placement: structuredClone(placement) as LayoutPlacement & { id: string } };
  }
  return null;
}
