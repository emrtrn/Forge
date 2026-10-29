/**
 * Hand corrections to a World Builder recipe's plan (plan v0.4 §13.2 step 4,
 * T36): move, add and delete settlements, road nodes, road edges (and their
 * guide points), landmarks and protected regions. Pure functions over a recipe
 * copy; the session runs each as one undo step and checks the result with the
 * recipe normalizer.
 *
 * An element the user touched becomes theirs: `source` turns `manual` and the
 * reference's `observed` / `confidence` estimates are dropped (user decision
 * 2026-10-29), so a re-analysis leaves it alone and the layer stops drawing
 * it as inferred or low-confidence. Deleting an element also drops what names
 * it — a node's edges, an edge's parcel frontages and spline ownership links,
 * a settlement's generated sites, parcels and pads and the links of its nodes
 * and landmarks — so the recipe stays valid.
 */
import type { WorldPoint } from "@engine/worldbuilder/normalize";
import type {
  PlanLandmark,
  PlanProvenance,
  PlanSettlement,
  ProtectedRegion,
  RoadEdge,
  RoadNode,
  RoadNodeKind,
  WorldRecipe,
} from "@engine/worldbuilder/recipe";
import type { RoadClass } from "@engine/worldbuilder/vocabulary";

export const PLAN_ELEMENT_KINDS = ["settlement", "node", "edge", "landmark", "protected"] as const;
export type PlanElementKind = (typeof PLAN_ELEMENT_KINDS)[number];

/** One plan element (a protected region is an `ownership` entry, edited alongside the plan). */
export interface PlanRef {
  kind: PlanElementKind;
  id: string;
}

/** A point of the plan that can be moved. */
export type PlanPointRef =
  | { kind: "settlement" | "node" | "landmark"; id: string }
  | { kind: "guide"; id: string; index: number }
  | { kind: "protected"; id: string; corner: "min" | "max" };

export interface PlanPoint {
  ref: PlanPointRef;
  point: WorldPoint;
}

/** Fields the panel edits; each applies to the element kinds that carry it. */
export interface PlanElementFields {
  /** Settlement type, landmark kind or protected region kind. */
  kind?: string;
  population?: number | null;
  radius?: number | null;
  nodeKind?: RoadNodeKind;
  roadClass?: RoadClass;
  /** Settlement centre, node or landmark position. */
  position?: WorldPoint;
  min?: WorldPoint;
  max?: WorldPoint;
}

/** Size of a protected region added without one, metres. */
export const NEW_PROTECTED_SIZE = 32;

const ID_PREFIX: Record<PlanElementKind, string> = {
  settlement: "settlement",
  node: "node",
  edge: "edge",
  landmark: "landmark",
  protected: "protected",
};

/** Every movable plan point, in drawing order. */
export function planPoints(recipe: WorldRecipe): PlanPoint[] {
  const { plan } = recipe;
  const points: PlanPoint[] = [
    ...plan.settlements.map((entry): PlanPoint => ({ ref: { kind: "settlement", id: entry.id }, point: entry.center })),
    ...plan.roadGraph.nodes.map((entry): PlanPoint => ({ ref: { kind: "node", id: entry.id }, point: entry.position })),
    ...plan.landmarks.map((entry): PlanPoint => ({ ref: { kind: "landmark", id: entry.id }, point: entry.position })),
  ];
  for (const edge of plan.roadGraph.edges) {
    (edge.guide ?? []).forEach((point, index) => points.push({ ref: { kind: "guide", id: edge.id, index }, point }));
  }
  for (const region of recipe.ownership.protectedRegions) {
    points.push({ ref: { kind: "protected", id: region.id, corner: "min" }, point: region.min });
    points.push({ ref: { kind: "protected", id: region.id, corner: "max" }, point: region.max });
  }
  return points;
}

/** The element a point belongs to. */
export function pointElement(ref: PlanPointRef): PlanRef {
  return { kind: ref.kind === "guide" ? "edge" : ref.kind, id: ref.id };
}

export function samePlanRef(a: PlanRef | null, b: PlanRef | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

/** True when the recipe still has the element. */
export function hasPlanElement(recipe: WorldRecipe, ref: PlanRef): boolean {
  return findElement(recipe, ref) !== null;
}

/**
 * Moves one plan point; null when the point is gone. A settlement's boundary
 * moves with its centre. A protected corner moved past the opposite one swaps
 * them, so the box stays min-below-max.
 */
export function movePlanPoint(recipe: WorldRecipe, ref: PlanPointRef, point: WorldPoint): WorldRecipe | null {
  const next = structuredClone(recipe);
  const to: WorldPoint = [point[0], point[1]];
  if (ref.kind === "settlement") {
    const settlement = next.plan.settlements.find((entry) => entry.id === ref.id);
    if (!settlement) return null;
    const dx = to[0] - settlement.center[0];
    const dz = to[1] - settlement.center[1];
    settlement.center = to;
    if (settlement.boundary) settlement.boundary = settlement.boundary.map(([x, z]): WorldPoint => [x + dx, z + dz]);
    markManual(settlement);
  } else if (ref.kind === "node" || ref.kind === "landmark") {
    const element = ref.kind === "node"
      ? next.plan.roadGraph.nodes.find((entry) => entry.id === ref.id)
      : next.plan.landmarks.find((entry) => entry.id === ref.id);
    if (!element) return null;
    element.position = to;
    markManual(element);
  } else if (ref.kind === "guide") {
    const edge = next.plan.roadGraph.edges.find((entry) => entry.id === ref.id);
    if (!edge?.guide || ref.index < 0 || ref.index >= edge.guide.length) return null;
    edge.guide[ref.index] = to;
    markManual(edge);
  } else if ("corner" in ref) {
    const region = next.ownership.protectedRegions.find((entry) => entry.id === ref.id);
    if (!region) return null;
    const other = ref.corner === "min" ? region.max : region.min;
    region.min = [Math.min(to[0], other[0]), Math.min(to[1], other[1])];
    region.max = [Math.max(to[0], other[0]), Math.max(to[1], other[1])];
  }
  return next;
}

/**
 * Adds an element at `at` and returns it with the recipe. An edge needs
 * `from` and `to` nodes; a node or landmark inside a settlement's search
 * radius is not linked to it (the user links by editing).
 */
export function addPlanElement(
  recipe: WorldRecipe,
  kind: PlanElementKind,
  at: WorldPoint,
  link: { from?: string; to?: string; roadClass?: RoadClass } = {},
): { recipe: WorldRecipe; ref: PlanRef } | null {
  const next = structuredClone(recipe);
  const id = nextPlanId(recipe, kind);
  const point: WorldPoint = [at[0], at[1]];
  if (kind === "settlement") {
    const settlement: PlanSettlement = { id, source: "manual", center: point, type: "village" };
    next.plan.settlements.push(settlement);
  } else if (kind === "node") {
    const node: RoadNode = { id, source: "manual", position: point, kind: "end" };
    next.plan.roadGraph.nodes.push(node);
  } else if (kind === "landmark") {
    const landmark: PlanLandmark = { id, source: "manual", kind: "viewpoint", position: point };
    next.plan.landmarks.push(landmark);
  } else if (kind === "edge") {
    const nodes = new Set(next.plan.roadGraph.nodes.map((entry) => entry.id));
    if (!link.from || !link.to || link.from === link.to || !nodes.has(link.from) || !nodes.has(link.to)) return null;
    const edge: RoadEdge = { id, source: "manual", from: link.from, to: link.to, roadClass: link.roadClass ?? "local" };
    next.plan.roadGraph.edges.push(edge);
  } else {
    const half = NEW_PROTECTED_SIZE / 2;
    const region: ProtectedRegion = { id, kind: "manual", min: [point[0] - half, point[1] - half], max: [point[0] + half, point[1] + half] };
    next.ownership.protectedRegions.push(region);
  }
  return { recipe: next, ref: { kind, id } };
}

/** Removes an element and everything that names it; null when it is gone. */
export function deletePlanElement(recipe: WorldRecipe, ref: PlanRef): WorldRecipe | null {
  if (!hasPlanElement(recipe, ref)) return null;
  const next = structuredClone(recipe);
  const { plan } = next;
  if (ref.kind === "settlement") {
    plan.settlements = plan.settlements.filter((entry) => entry.id !== ref.id);
    for (const element of [...plan.roadGraph.nodes, ...plan.landmarks]) {
      if (element.settlement === ref.id) delete element.settlement;
    }
    next.generated.sites = next.generated.sites.filter((entry) => entry.settlement !== ref.id);
    next.generated.parcels = next.generated.parcels.filter((entry) => entry.settlement !== ref.id);
    next.generated.pads = next.generated.pads.filter((entry) => entry.settlement !== ref.id);
  } else if (ref.kind === "node") {
    plan.roadGraph.nodes = plan.roadGraph.nodes.filter((entry) => entry.id !== ref.id);
    const gone = plan.roadGraph.edges.filter((entry) => entry.from === ref.id || entry.to === ref.id).map((entry) => entry.id);
    for (const edge of gone) dropEdge(next, edge);
  } else if (ref.kind === "edge") {
    dropEdge(next, ref.id);
  } else if (ref.kind === "landmark") {
    plan.landmarks = plan.landmarks.filter((entry) => entry.id !== ref.id);
  } else {
    next.ownership.protectedRegions = next.ownership.protectedRegions.filter((entry) => entry.id !== ref.id);
  }
  return next;
}

/**
 * Adds a guide point to an edge: the first two split it in thirds (a guide
 * lists at least two points), later ones halve the longest span.
 */
export function addGuidePoint(recipe: WorldRecipe, edgeId: string): { recipe: WorldRecipe; index: number } | null {
  const next = structuredClone(recipe);
  const edge = next.plan.roadGraph.edges.find((entry) => entry.id === edgeId);
  const nodes = new Map(next.plan.roadGraph.nodes.map((entry) => [entry.id, entry.position] as const));
  const from = edge ? nodes.get(edge.from) : undefined;
  const to = edge ? nodes.get(edge.to) : undefined;
  if (!edge || !from || !to) return null;
  markManual(edge);
  if (!edge.guide || edge.guide.length < 2) {
    edge.guide = [lerp(from, to, 1 / 3), lerp(from, to, 2 / 3)];
    return { recipe: next, index: 0 };
  }
  const line = [from, ...edge.guide, to];
  let longest = 0;
  for (let index = 1; index < line.length - 1; index += 1) {
    if (span(line[index]!, line[index + 1]!) > span(line[longest]!, line[longest + 1]!)) longest = index;
  }
  edge.guide.splice(longest, 0, lerp(line[longest]!, line[longest + 1]!, 0.5));
  return { recipe: next, index: longest };
}

/** Removes one guide point; a guide left with one point is dropped (the edge runs straight). */
export function deleteGuidePoint(recipe: WorldRecipe, edgeId: string, index: number): WorldRecipe | null {
  const next = structuredClone(recipe);
  const edge = next.plan.roadGraph.edges.find((entry) => entry.id === edgeId);
  if (!edge?.guide || index < 0 || index >= edge.guide.length) return null;
  edge.guide.splice(index, 1);
  if (edge.guide.length < 2) delete edge.guide;
  markManual(edge);
  return next;
}

/** Sets the panel's fields on one element; null when it is gone. Unknown-to-kind fields are ignored. */
export function updatePlanElement(recipe: WorldRecipe, ref: PlanRef, fields: PlanElementFields): WorldRecipe | null {
  const next = structuredClone(recipe);
  const element = findElement(next, ref);
  if (!element) return null;
  if (fields.position && ref.kind !== "edge" && ref.kind !== "protected") {
    const { position, ...rest } = fields;
    return updatePlanElement(movePlanPoint(next, { kind: ref.kind, id: ref.id }, position)!, ref, rest);
  }
  if (ref.kind === "settlement") {
    const settlement = element as PlanSettlement;
    if (fields.kind !== undefined) settlement.type = fields.kind;
    if (fields.population !== undefined) setOptional(settlement, "population", fields.population);
    if (fields.radius !== undefined) setOptional(settlement, "radius", fields.radius);
  } else if (ref.kind === "node") {
    if (fields.nodeKind !== undefined) (element as RoadNode).kind = fields.nodeKind;
  } else if (ref.kind === "edge") {
    if (fields.roadClass !== undefined) (element as RoadEdge).roadClass = fields.roadClass;
  } else if (ref.kind === "landmark") {
    if (fields.kind !== undefined) (element as PlanLandmark).kind = fields.kind;
  } else {
    const region = element as ProtectedRegion;
    if (fields.kind !== undefined) region.kind = fields.kind;
    if (fields.min) region.min = [fields.min[0], fields.min[1]];
    if (fields.max) region.max = [fields.max[0], fields.max[1]];
    return next;
  }
  markManual(element as PlanProvenance);
  return next;
}

/** `<kind>-<n>` with the lowest n no plan element or protected region uses. */
export function nextPlanId(recipe: WorldRecipe, kind: PlanElementKind): string {
  const { plan } = recipe;
  const used = new Set([
    ...plan.settlements, ...plan.landmarks, ...plan.regions, ...plan.water,
    ...plan.roadGraph.nodes, ...plan.roadGraph.edges, ...recipe.ownership.protectedRegions,
  ].map((entry) => entry.id));
  for (let index = 1; ; index += 1) {
    const id = `${ID_PREFIX[kind]}-${index}`;
    if (!used.has(id)) return id;
  }
}

/** The user's now: a re-analysis leaves it alone, and the reference's estimates no longer apply. */
export function markManual(element: PlanProvenance): void {
  element.source = "manual";
  delete element.observed;
  delete element.confidence;
}

function findElement(recipe: WorldRecipe, ref: PlanRef): PlanProvenance | ProtectedRegion | null {
  const { plan } = recipe;
  const list: ReadonlyArray<{ id: string }> = ref.kind === "settlement" ? plan.settlements
    : ref.kind === "node" ? plan.roadGraph.nodes
      : ref.kind === "edge" ? plan.roadGraph.edges
        : ref.kind === "landmark" ? plan.landmarks
          : recipe.ownership.protectedRegions;
  return (list.find((entry) => entry.id === ref.id) as PlanProvenance | ProtectedRegion | undefined) ?? null;
}

/** Removes an edge and the links to it: parcel frontages and the spline ownership entry's edge. */
function dropEdge(recipe: WorldRecipe, edgeId: string): void {
  recipe.plan.roadGraph.edges = recipe.plan.roadGraph.edges.filter((entry) => entry.id !== edgeId);
  for (const parcel of recipe.generated.parcels) if (parcel.frontage === edgeId) delete parcel.frontage;
  for (const entry of Object.values(recipe.ownership.splines)) if (entry.edge === edgeId) delete entry.edge;
}

function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value === null) delete target[key];
  else target[key] = value;
}

function lerp(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function span(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
