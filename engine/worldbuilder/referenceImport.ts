/** T35: explicit, additive import of an external reference analysis. Pure; no I/O. */
import { isRecord, type WorldPoint } from "./normalize";
import { createWorldRecipe, normalizeWorldRecipe, WORLD_PLAN_KINDS,
  type WorldPlan, type WorldPlanKind, type WorldRecipe, type WorldReference } from "./recipe";
import { referenceToWorld } from "./reference";

export const MAX_REFERENCE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_REFERENCE_IMPORT_ELEMENTS = 5000;
export interface ReferenceImportChange {
  kind: WorldPlanKind; id: string; change: "added" | "updated" | "unchanged" | "kept";
  reason?: "manual" | "otherSource" | "protected" | "deletedByHand" | "missingDependency";
}
export interface ReferenceImportResult { recipe: WorldRecipe | null; changes: ReferenceImportChange[]; errors: string[] }

type Item = WorldPlan["settlements"][number] | WorldPlan["regions"][number] | WorldPlan["water"][number]
  | WorldPlan["landmarks"][number] | WorldPlan["roadGraph"]["nodes"][number] | WorldPlan["roadGraph"]["edges"][number];
function list(plan: WorldPlan, kind: WorldPlanKind): Item[] {
  return kind === "node" ? plan.roadGraph.nodes : kind === "edge" ? plan.roadGraph.edges
    : kind === "settlement" ? plan.settlements : kind === "water" ? plan.water
      : kind === "region" ? plan.regions : plan.landmarks;
}
function rawList(plan: Record<string, unknown>, kind: WorldPlanKind): unknown {
  if (kind === "node" || kind === "edge") {
    if (plan.roadGraph !== undefined && !isRecord(plan.roadGraph)) throw new Error("plan.roadGraph must be an object");
    return (plan.roadGraph as Record<string, unknown> | undefined)?.[kind === "node" ? "nodes" : "edges"];
  }
  return plan[kind === "settlement" ? "settlements" : kind === "region" ? "regions" : kind === "water" ? "water" : "landmarks"];
}
const fields: Record<WorldPlanKind, readonly string[]> = {
  settlement: ["center", "radius", "boundary", "type", "population", "economy", "regionProfile", "program", "seed"],
  node: ["position", "kind", "settlement"], edge: ["from", "to", "roadClass", "guide"],
  region: ["kind", "polygon"], water: ["kind", "path", "polygon"], landmark: ["kind", "position", "settlement"],
};
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string) {
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown) throw new Error(`${path}.${unknown}: unsupported field`);
}
function convert(entry: Record<string, unknown>, kind: WorldPlanKind, reference: WorldReference): Record<string, unknown> {
  onlyKeys(entry, ["id", "source", "observed", "confidence", ...fields[kind]], `${kind} ${String(entry.id)}`);
  if (entry.source !== "reference" || typeof entry.observed !== "boolean"
    || typeof entry.confidence !== "number" || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
    throw new Error(`${kind} ${String(entry.id)}: source must be reference, observed boolean and confidence 0..1`);
  }
  const point = (value: unknown): WorldPoint => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) {
      throw new Error(`${kind} ${String(entry.id)}: coordinates must be [u,v] in 0..1`);
    }
    return referenceToWorld(reference, value as WorldPoint);
  };
  const result = structuredClone(entry);
  for (const key of ["center", "position"]) if (result[key] !== undefined) result[key] = point(result[key]);
  for (const key of ["polygon", "path", "boundary", "guide"]) if (result[key] !== undefined) {
    if (!Array.isArray(result[key])) throw new Error(`${kind} ${String(entry.id)}.${key}: must be a point list`);
    result[key] = (result[key] as unknown[]).map(point);
  }
  if (kind === "settlement" && result.radius !== undefined) {
    if (typeof result.radius !== "number" || !Number.isFinite(result.radius) || result.radius <= 0 || result.radius > 1) {
      throw new Error(`settlement ${String(entry.id)}.radius: must be a fraction of image width in (0,1]`);
    }
    result.radius *= reference.size[0];
  }
  return result;
}

/** Missing entries are retained. Stable (kind,id) identities are the merge key. */
export function previewReferenceImport(current: WorldRecipe, text: string): ReferenceImportResult {
  try {
    if (new TextEncoder().encode(text).length > MAX_REFERENCE_IMPORT_BYTES) throw new Error("Reference JSON exceeds 2 MiB");
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) throw new Error("Reference analysis must be an object");
    onlyKeys(value, ["schemaVersion", "coordinateSpace", "referenceImage", "plan"], "analysis");
    if (value.schemaVersion !== 1 || value.coordinateSpace !== "reference-normalized") throw new Error("Expected schemaVersion 1 and coordinateSpace reference-normalized");
    const reference = current.reference;
    if (!reference?.image || reference.view === "perspective") throw new Error("Set a top-down reference image and world extent before importing");
    if (value.referenceImage !== reference.image) throw new Error("referenceImage must match the current reference image path");
    if (!isRecord(value.plan)) throw new Error("analysis.plan must be an object");
    onlyKeys(value.plan, ["regions", "water", "landmarks", "settlements", "roadGraph"], "plan");
    if (isRecord(value.plan.roadGraph)) onlyKeys(value.plan.roadGraph, ["nodes", "edges"], "plan.roadGraph");
    const incoming = new Map<WorldPlanKind, Record<string, unknown>[]>();
    const validation = createWorldRecipe("reference_import");
    validation.plan = structuredClone(current.plan);
    let count = 0;
    for (const kind of WORLD_PLAN_KINDS) {
      const supplied = rawList(value.plan, kind);
      const raw = supplied === undefined ? [] : supplied;
      if (!Array.isArray(raw)) throw new Error(`${kind}: must be an array`);
      count += raw.length;
      if (count > MAX_REFERENCE_IMPORT_ELEMENTS) throw new Error("Reference analysis exceeds 5000 elements");
      const seen = new Set<string>();
      const converted = raw.map(entry => {
        if (!isRecord(entry) || typeof entry.id !== "string") throw new Error(`${kind}: every entry needs an id`);
        if (seen.has(entry.id)) throw new Error(`${kind}: duplicate id ${entry.id}`);
        seen.add(entry.id);
        return convert(entry, kind, reference);
      });
      incoming.set(kind, converted);
      const target = list(validation.plan, kind);
      for (const entry of converted) {
        const index = target.findIndex(item => item.id === entry.id);
        if (index < 0) target.push(entry as unknown as Item);
        else target[index] = entry as unknown as Item;
      }
    }
    const checked = normalizeWorldRecipe(validation);
    if (!checked.recipe || checked.issues.length) throw new Error(checked.issues[0] ?? "Invalid reference plan");
    const next = structuredClone(current);
    const changes: ReferenceImportChange[] = [];
    // Dependencies are merged first; rejected identities never cause dangling links.
    for (const kind of ["settlement", "region", "water", "node", "landmark", "edge"] as const) {
      const target = list(next.plan, kind);
      for (const raw of incoming.get(kind)!) {
        const entry = list(checked.recipe.plan, kind).find(item => item.id === raw.id)!;
        const index = target.findIndex(item => item.id === entry.id);
        const existing = target[index];
        let reason: ReferenceImportChange["reason"];
        if (current.ownership.deletedPlanElements?.some(item => item.kind === kind && item.id === entry.id)) reason = "deletedByHand";
        else if (existing?.source === "manual") reason = "manual";
        else if (existing && existing.source !== "reference") reason = "otherSource";
        else if (existing && "protected" in existing && existing.protected) reason = "protected";
        else if ("settlement" in entry && entry.settlement && !next.plan.settlements.some(item => item.id === entry.settlement)) reason = "missingDependency";
        else if (kind === "edge" && "from" in entry && (!next.plan.roadGraph.nodes.some(item => item.id === entry.from) || !next.plan.roadGraph.nodes.some(item => item.id === entry.to))) reason = "missingDependency";
        if (reason) { changes.push({ kind, id: entry.id, change: "kept", reason }); continue; }
        if (existing && JSON.stringify(existing) === JSON.stringify(entry)) { changes.push({ kind, id: entry.id, change: "unchanged" }); continue; }
        changes.push({ kind, id: entry.id, change: existing ? "updated" : "added" });
        if (index < 0) target.push(structuredClone(entry));
        else target[index] = structuredClone(entry);
      }
    }
    const final = normalizeWorldRecipe(next);
    if (!final.recipe || final.issues.length) throw new Error(final.issues[0] ?? "Merged plan would be invalid");
    return { recipe: final.recipe, changes, errors: [] };
  } catch (error) {
    return { recipe: null, changes: [], errors: [error instanceof Error ? error.message : "Invalid reference JSON"] };
  }
}
