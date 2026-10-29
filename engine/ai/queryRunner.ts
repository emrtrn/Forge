import type { Entity, EntityId } from "../scene/entity";
import type { Vec3 } from "../scene/layout";
import {
  readSmartObjectComponent,
  readScriptActorComponent,
  readScriptInterfacesComponent,
  readTransformComponent,
  type SmartObjectComponent,
  type SmartObjectSlot,
} from "../scene/components";
import type { NavAabb } from "../navigation/navigationTypes";
import type { AIController } from "./aiController";
import type { AiQueryAsset, AiQueryContextDef, AiQueryTestDef } from "./queryAsset";
import type { SmartObjectReservationQuery } from "./smartObjects";

export interface AiQueryCandidate {
  readonly id: string;
  readonly kind: "position" | "entity";
  readonly position: Vec3;
  readonly entityId?: EntityId;
  readonly smartObjectSlotId?: string;
  readonly score: number;
  readonly failedTests: readonly string[];
  readonly testResults?: readonly AiQueryTestResult[];
}

export interface AiQueryResult {
  readonly status: "success" | "failure";
  readonly candidates: readonly AiQueryCandidate[];
  readonly winner: AiQueryCandidate | null;
}

export interface AiQueryTestResult {
  readonly kind: string;
  readonly pass: boolean;
  readonly score: number;
  readonly reason?: string;
}

export interface AiQueryCandidateDebugSnapshot {
  readonly id: string;
  readonly entityId?: EntityId;
  readonly smartObjectSlotId?: string;
  readonly position: Vec3;
  readonly score: number;
  readonly failedTests: readonly string[];
  readonly tests: readonly AiQueryTestResult[];
}

export interface AiQueryDebugSnapshot {
  readonly query: string;
  readonly status: "success" | "failure";
  readonly candidateCount: number;
  readonly winner: AiQueryCandidateDebugSnapshot | null;
  readonly candidates: readonly AiQueryCandidateDebugSnapshot[];
  readonly failureReason: string | null;
}

export interface AiQueryRunContext {
  readonly controller: AIController;
  readonly entities: readonly Entity[];
  readonly blockers?: readonly NavAabb[];
  /**
   * Blockers intersecting the inclusive X/Z square around a point; preferred
   * over {@link blockers} when given. Line of sight asks for the square its
   * segment fits in.
   */
  readonly blockersNear?: (x: number, z: number, radius: number) => readonly NavAabb[];
  /**
   * Whether the querying pawn can walk from `from` to `to` on the nav mesh
   * (the host's Recast planner, with that pawn's agent profile). `"pending"`
   * means the tiles between them are not built yet; they are queued, and the
   * test fails this time. Without it every `navReachable` test fails.
   */
  readonly navReachable?: (from: Vec3, to: Vec3) => AiNavReachability;
  readonly smartObjects?: SmartObjectReservationQuery;
}

export type AiNavReachability = "reachable" | "unreachable" | "pending";

export function runAiQuery(asset: AiQueryAsset, context: AiQueryRunContext): AiQueryResult {
  const raw = generateCandidates(asset, context);
  const cap = Math.max(1, asset.maxCandidates ?? 64);
  const evaluated = raw.slice(0, cap).map((candidate) => evaluateCandidate(candidate, asset.tests ?? [], context));
  const passed = evaluated
    .filter((candidate) => candidate.failedTests.length === 0)
    .sort((a, b) => b.score - a.score || distanceToQuerier(a, context) - distanceToQuerier(b, context) || a.id.localeCompare(b.id));
  return {
    status: passed.length > 0 ? "success" : "failure",
    candidates: evaluated,
    winner: passed[0] ?? null,
  };
}

export function aiQueryDebugSnapshot(query: string, result: AiQueryResult, topN = 4): AiQueryDebugSnapshot {
  const candidates = result.candidates
    .slice(0, Math.max(0, topN))
    .map(candidateDebugSnapshot);
  const winner = result.winner ? candidateDebugSnapshot(result.winner) : null;
  return {
    query,
    status: result.status,
    candidateCount: result.candidates.length,
    winner,
    candidates,
    failureReason: result.status === "failure" ? queryFailureReason(result) : null,
  };
}

function generateCandidates(asset: AiQueryAsset, context: AiQueryRunContext): AiQueryCandidate[] {
  const candidates: AiQueryCandidate[] = [];
  const seen = new Set<string>();
  for (const generator of asset.generators) {
    switch (generator.kind) {
      case "pointsAroundQuerier": {
        const origin = contextPoint({ kind: "querier" }, context);
        if (!origin) break;
        const rings = Math.max(1, generator.rings ?? 1);
        for (let ring = 1; ring <= rings; ring += 1) {
          const radius = generator.radius * (ring / rings);
          for (let index = 0; index < generator.points; index += 1) {
            const angle = (Math.PI * 2 * index) / generator.points;
            addCandidate(candidates, seen, {
              id: `point:${ring}:${index}`,
              kind: "position",
              position: [
                round(origin[0] + Math.cos(angle) * radius),
                origin[1],
                round(origin[2] + Math.sin(angle) * radius),
              ],
              score: 0,
              failedTests: [],
            });
          }
        }
        break;
      }
      case "gridAroundContext": {
        const origins = contextPoints(generator.context ?? { kind: "querier" }, context);
        if (origins.length === 0) break;
        let ordinal = 0;
        for (let originIndex = 0; originIndex < origins.length; originIndex += 1) {
          const origin = origins[originIndex];
          if (!origin) continue;
          for (let x = -generator.radius; x <= generator.radius + 1e-9; x += generator.spacing) {
            for (let z = -generator.radius; z <= generator.radius + 1e-9; z += generator.spacing) {
              if (Math.hypot(x, z) > generator.radius + 1e-9) continue;
              addCandidate(candidates, seen, {
                id: `grid:${originIndex}:${ordinal}`,
                kind: "position",
                position: [round(origin[0] + x), origin[1], round(origin[2] + z)],
                score: 0,
                failedTests: [],
              });
              ordinal += 1;
            }
          }
        }
        break;
      }
      case "actorsByTag":
        for (const entity of context.entities) {
          if (!entity.tags?.includes(generator.tag)) continue;
          const transform = readTransformComponent(entity);
          if (!transform) continue;
          addCandidate(candidates, seen, {
            id: `entity:${entity.id}`,
            kind: "entity",
            entityId: entity.id,
            position: [transform.position[0], transform.position[1], transform.position[2]],
            score: 0,
            failedTests: [],
          });
        }
        break;
      case "actorsByInterface":
        for (const entity of context.entities) {
          const interfaces = readScriptInterfacesComponent(entity);
          if (!interfaces?.interfaces.includes(generator.interface)) continue;
          addEntityCandidate(candidates, seen, entity);
        }
        break;
      case "actorsByClassRef":
        for (const entity of context.entities) {
          const actor = readScriptActorComponent(entity);
          if (actor?.classRef !== generator.classRef) continue;
          addEntityCandidate(candidates, seen, entity);
        }
        break;
      case "smartObjectsByTag":
        for (const entity of context.entities) {
          const transform = readTransformComponent(entity);
          const smartObject = readSmartObjectComponent(entity);
          if (!transform || !smartObject || smartObject.enabled === false) continue;
          if (!smartObjectMatchesTag(smartObject, generator.tag)) continue;
          const querier = contextPoint({ kind: "querier" }, context);
          const slots = smartObject.slots.length > 0 ? smartObject.slots : [{ id: "" }];
          for (const slot of slots) {
            if (!smartObjectSlotMatchesTag(smartObject, slot, generator.tag)) continue;
            const position = addVec3(transform.position, slot.position ?? smartObject.interactionPosition ?? [0, 0, 0]);
            if (generator.radius !== undefined && querier && planarDistance(position, querier) > generator.radius) {
              continue;
            }
            addCandidate(candidates, seen, {
              id: `smart-object:${entity.id}:${slot.id}`,
              kind: "entity",
              entityId: entity.id,
              ...(slot.id ? { smartObjectSlotId: slot.id } : {}),
              position,
              score: 0,
              failedTests: [],
            });
          }
        }
        break;
    }
  }
  return candidates;
}

function addEntityCandidate(candidates: AiQueryCandidate[], seen: Set<string>, entity: Entity): void {
  const transform = readTransformComponent(entity);
  if (!transform) return;
  addCandidate(candidates, seen, {
    id: `entity:${entity.id}`,
    kind: "entity",
    entityId: entity.id,
    position: [transform.position[0], transform.position[1], transform.position[2]],
    score: 0,
    failedTests: [],
  });
}

function addCandidate(
  candidates: AiQueryCandidate[],
  seen: Set<string>,
  candidate: AiQueryCandidate,
): void {
  const key = candidate.id;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(candidate);
}

function evaluateCandidate(
  candidate: AiQueryCandidate,
  tests: readonly AiQueryTestDef[],
  context: AiQueryRunContext,
): AiQueryCandidate {
  let score = 0;
  const failedTests: string[] = [];
  const testResults: AiQueryTestResult[] = [];
  for (const test of tests) {
    if (test.kind === "reservationFree") {
      const result = evaluateTest(test, candidate, [], context);
      if (!result.pass) failedTests.push(test.kind);
      testResults.push({
        kind: test.kind,
        pass: result.pass,
        score: round(result.score * (test.weight ?? 1)),
        ...(result.reason ? { reason: result.reason } : {}),
      });
      score += result.score * (test.weight ?? 1);
      continue;
    }
    const references = contextPoints(test.context ?? { kind: "querier" }, context);
    if (references.length === 0) {
      failedTests.push(`${test.kind}:context`);
      testResults.push({ kind: test.kind, pass: false, score: 0, reason: "context" });
      continue;
    }
    const result = evaluateTest(test, candidate, references, context);
    if (!result.pass) failedTests.push(test.kind);
    testResults.push({
      kind: test.kind,
      pass: result.pass,
      score: round(result.score * (test.weight ?? 1)),
      ...(result.reason ? { reason: result.reason } : {}),
    });
    score += result.score * (test.weight ?? 1);
  }
  return { ...candidate, score: round(score), failedTests, testResults };
}

function evaluateTest(
  test: AiQueryTestDef,
  candidate: AiQueryCandidate,
  references: readonly Vec3[],
  context: AiQueryRunContext,
): { pass: boolean; score: number; reason?: string } {
  const position = candidate.position;
  switch (test.kind) {
    case "distance": {
      const distance = nearestPlanarDistance(position, references);
      if (test.min !== undefined && distance < test.min) return { pass: false, score: 0, reason: "below-min" };
      if (test.max !== undefined && distance > test.max) return { pass: false, score: 0, reason: "above-max" };
      return { pass: true, score: scoreDistance(distance, test.min ?? 0, test.max, test.score) };
    }
    case "lineOfSight": {
      const visible = references.some((reference) =>
        !segmentBlocked2d(reference, position, blockersAround(context, reference, position, 0)));
      return {
        pass: test.require === false ? true : visible,
        score: visible ? scoreForPass(test.score) : 0,
        ...(visible ? {} : { reason: "blocked" }),
      };
    }
    case "navReachable": {
      const navReachable = context.navReachable;
      if (!navReachable) return { pass: false, score: 0, reason: "no-navigation" };
      let pending = false;
      const reachable = references.some((reference) => {
        const answer = navReachable(reference, position);
        if (answer === "pending") pending = true;
        return answer === "reachable";
      });
      return {
        pass: reachable,
        score: reachable ? scoreForPass(test.score) : 0,
        ...(reachable ? {} : { reason: pending ? "nav-pending" : "unreachable" }),
      };
    }
    case "dot": {
      const forward = contextForward(context.controller);
      const dot = Math.max(
        ...references.map((reference) => {
          const toCandidate = normalize2d([position[0] - reference[0], position[2] - reference[2]]);
          return forward[0] * toCandidate[0] + forward[1] * toCandidate[1];
        }),
      );
      if (test.min !== undefined && dot < test.min) return { pass: false, score: 0, reason: "below-min" };
      return { pass: true, score: test.score === "none" ? 0 : (dot + 1) / 2 };
    }
    case "reservationFree":
      if (!candidate.entityId || !context.smartObjects) return { pass: true, score: scoreForPass(test.score) };
      if (context.smartObjects.isReserved(candidate.entityId, candidate.smartObjectSlotId ?? null, context.controller.pawnEntityId)) {
        return { pass: false, score: 0, reason: "reserved" };
      }
      return { pass: true, score: scoreForPass(test.score) };
  }
}

function candidateDebugSnapshot(candidate: AiQueryCandidate): AiQueryCandidateDebugSnapshot {
  return {
    id: candidate.id,
    ...(candidate.entityId ? { entityId: candidate.entityId } : {}),
    ...(candidate.smartObjectSlotId ? { smartObjectSlotId: candidate.smartObjectSlotId } : {}),
    position: [candidate.position[0], candidate.position[1], candidate.position[2]],
    score: candidate.score,
    failedTests: [...candidate.failedTests],
    tests: [...(candidate.testResults ?? [])],
  };
}

function queryFailureReason(result: AiQueryResult): string {
  if (result.candidates.length === 0) return "no-candidates";
  const failed = new Map<string, number>();
  for (const candidate of result.candidates) {
    for (const test of candidate.failedTests) failed.set(test, (failed.get(test) ?? 0) + 1);
  }
  const top = [...failed.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? `${top[0]}:${top[1]}` : "no-passing-candidates";
}

function contextPoint(def: AiQueryContextDef, context: AiQueryRunContext): Vec3 | null {
  return contextPoints(def, context)[0] ?? null;
}

function contextPoints(def: AiQueryContextDef, context: AiQueryRunContext): Vec3[] {
  if (def.kind === "querier") {
    const position = entityPosition(context.controller.pawnEntityId, context.entities);
    return position ? [position] : [];
  }
  if (def.kind === "targetEntity") {
    const entityId = context.controller.blackboard.getEntity(def.key ?? "target");
    const position = entityId ? entityPosition(entityId, context.entities) : null;
    return position ? [position] : [];
  }
  if (def.kind === "allActorsWithTag") return entityPositionsByTag(def.tag, context.entities);
  if (def.kind === "allActorsWithInterface") return entityPositionsByInterface(def.interface, context.entities);
  if (!def.key) return [];
  if (def.kind === "blackboardPosition") {
    const value = context.controller.blackboard.get(def.key);
    const position = Array.isArray(value) && value.length === 3
      ? [value[0] as number, value[1] as number, value[2] as number] as Vec3
      : null;
    return position ? [position] : [];
  }
  const entityId = context.controller.blackboard.getEntity(def.key);
  const position = entityId ? entityPosition(entityId, context.entities) : null;
  return position ? [position] : [];
}

function entityPosition(entityId: EntityId, entities: readonly Entity[]): Vec3 | null {
  const entity = entities.find((candidate) => candidate.id === entityId);
  const transform = entity ? readTransformComponent(entity) : undefined;
  return transform ? [transform.position[0], transform.position[1], transform.position[2]] : null;
}

function entityPositionsByTag(tag: string | undefined, entities: readonly Entity[]): Vec3[] {
  if (!tag) return [];
  return entities
    .filter((entity) => entity.tags?.includes(tag))
    .map((entity) => entityPosition(entity.id, entities))
    .filter((position): position is Vec3 => position !== null);
}

function entityPositionsByInterface(interfaceName: string | undefined, entities: readonly Entity[]): Vec3[] {
  if (!interfaceName) return [];
  return entities
    .filter((entity) => readScriptInterfacesComponent(entity)?.interfaces.includes(interfaceName))
    .map((entity) => entityPosition(entity.id, entities))
    .filter((position): position is Vec3 => position !== null);
}

function smartObjectMatchesTag(smartObject: SmartObjectComponent, tag: string): boolean {
  return smartObject.tags.includes(tag) || smartObject.slots.some((slot) => slot.tags?.includes(tag));
}

function smartObjectSlotMatchesTag(
  smartObject: SmartObjectComponent,
  slot: Pick<SmartObjectSlot, "id" | "tags" | "position">,
  tag: string,
): boolean {
  return smartObject.tags.includes(tag) || slot.tags?.includes(tag) === true;
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [round(a[0] + b[0]), round(a[1] + b[1]), round(a[2] + b[2])];
}

function distanceToQuerier(candidate: AiQueryCandidate, context: AiQueryRunContext): number {
  const querier = contextPoint({ kind: "querier" }, context);
  return querier ? planarDistance(candidate.position, querier) : 0;
}

function scoreDistance(
  distance: number,
  min: number,
  max: number | undefined,
  mode: "none" | "linear" | "inverse" | undefined,
): number {
  if (!mode || mode === "none") return 0;
  const span = Math.max((max ?? Math.max(distance, min + 1)) - min, 1e-6);
  const normalized = Math.max(0, Math.min(1, (distance - min) / span));
  return mode === "inverse" ? 1 - normalized : normalized;
}

function scoreForPass(mode: "none" | "linear" | "inverse" | undefined): number {
  return mode && mode !== "none" ? 1 : 0;
}

/** Blockers touching the X/Z square around `a`–`b` grown by `margin`, or the context's full list. */
function blockersAround(context: AiQueryRunContext, a: Vec3, b: Vec3, margin: number): readonly NavAabb[] {
  if (!context.blockersNear) return context.blockers ?? [];
  const halfSpan = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[2] - a[2])) / 2;
  return context.blockersNear((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, halfSpan + margin);
}

function segmentBlocked2d(start: Vec3, end: Vec3, blockers: readonly NavAabb[]): boolean {
  return blockers.some((blocker) => segmentIntersectsAabb2d(start, end, blocker));
}

function segmentIntersectsAabb2d(start: Vec3, end: Vec3, blocker: NavAabb): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes = [
    { s: start[0], d: end[0] - start[0], min: blocker.min[0], max: blocker.max[0] },
    { s: start[2], d: end[2] - start[2], min: blocker.min[2], max: blocker.max[2] },
  ];
  for (const axis of axes) {
    if (Math.abs(axis.d) < 1e-9) {
      if (axis.s < axis.min || axis.s > axis.max) return false;
      continue;
    }
    const a = (axis.min - axis.s) / axis.d;
    const b = (axis.max - axis.s) / axis.d;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
    if (tMin > tMax) return false;
  }
  return true;
}

function contextForward(controller: AIController): [number, number] {
  const snapshot = controller.getDebugSnapshot();
  const forward = snapshot.forward;
  return forward ? normalize2d([forward[0], forward[2]]) : [0, 1];
}

function normalize2d(value: [number, number]): [number, number] {
  const length = Math.hypot(value[0], value[1]);
  return length > 1e-6 ? [value[0] / length, value[1] / length] : [0, 1];
}

function planarDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

function nearestPlanarDistance(position: Vec3, references: readonly Vec3[]): number {
  return references.reduce((best, reference) => Math.min(best, planarDistance(position, reference)), Infinity);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
