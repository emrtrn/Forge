/**
 * Normalizer primitives shared by World Builder documents (recipe, region
 * profile). Each helper either returns a canonical value or records an issue
 * with the value's path and returns null/undefined, so a document normalizes to
 * "what survived" plus "what was wrong and where". Dependency-free.
 */
import { isPlacementId, isSemanticRole } from "../scene/placementIdentity";

/** World coordinates beyond this are rejected: far outside any streamed world. */
export const WORLD_MAX_COORDINATE = 1_000_000;

/** `[x, z]` in world metres. */
export type WorldPoint = [number, number];

export interface Ctx {
  issues: string[];
}

export function issue(ctx: Ctx, path: string, message: string): void {
  ctx.issues.push(`${path}: ${message}`);
}

export function reject(ctx: Ctx, path: string, message: string): null {
  issue(ctx, path, message);
  return null;
}

/** Normalizes an array, dropping bad entries and later repeats of an id. */
export function uniqueEntries<T extends { id: string }>(
  ctx: Ctx,
  path: string,
  value: unknown,
  normalize: (ctx: Ctx, path: string, entry: Record<string, unknown>) => T | null,
): T[] {
  const seen = new Set<string>();
  return arrayOf(ctx, path, value, (c, p, entry) => {
    if (!isRecord(entry)) return reject(c, p, "must be an object");
    const result = normalize(c, p, entry);
    if (!result) return null;
    if (seen.has(result.id)) return reject(c, p, `repeats id "${result.id}"`);
    seen.add(result.id);
    return result;
  });
}

export function arrayOf<T>(
  ctx: Ctx,
  path: string,
  value: unknown,
  normalize: (ctx: Ctx, path: string, entry: unknown) => T | null,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issue(ctx, path, "must be an array");
    return [];
  }
  const result: T[] = [];
  value.forEach((entry, index) => {
    const normalized = normalize(ctx, `${path}[${index}]`, entry);
    if (normalized !== null) result.push(normalized);
  });
  return result;
}

/**
 * Normalizes an object keyed by an allowed key set, in sorted key order. Keys
 * outside `isKey` and values `normalize` rejects are dropped with an issue.
 */
export function keyedEntries<K extends string, T>(
  ctx: Ctx,
  path: string,
  value: unknown,
  isKey: (key: string) => key is K,
  keyRule: string,
  normalize: (ctx: Ctx, path: string, entry: unknown, key: K) => T | null,
): Partial<Record<K, T>> {
  const result: Partial<Record<K, T>> = {};
  if (value === undefined) return result;
  if (!isRecord(value)) {
    issue(ctx, path, "must be an object");
    return result;
  }
  for (const key of Object.keys(value).sort()) {
    const entryPath = `${path}.${key}`;
    if (!isKey(key)) {
      issue(ctx, entryPath, `key must be ${keyRule}`);
      continue;
    }
    const normalized = normalize(ctx, entryPath, value[key], key);
    if (normalized !== null) result[key] = normalized;
  }
  return result;
}

export function idSet(entries: ReadonlyArray<{ id: string }>): Set<string> {
  return new Set(entries.map((entry) => entry.id));
}

export function requireId(ctx: Ctx, path: string, value: unknown): string | null {
  return isPlacementId(value) ? value : reject(ctx, `${path}.id`, "must be an id");
}

export function requireToken(ctx: Ctx, path: string, value: unknown): string | null {
  return isSemanticRole(value) ? value : reject(ctx, path, "must be a lowercase dotted token");
}

export function optionalTokens(ctx: Ctx, path: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const tokens = arrayOf(ctx, path, value, (c, p, token) =>
    isSemanticRole(token) ? token : reject(c, p, "must be a lowercase dotted token"));
  return tokens.length > 0 ? [...new Set(tokens)] : undefined;
}

export function optionalReference(
  ctx: Ctx, path: string, value: unknown, ids: ReadonlySet<string>,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && ids.has(value)) return value;
  issue(ctx, path, "must name an existing element");
  return undefined;
}

export function optionalPositive(ctx: Ctx, path: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (isFiniteNumber(value) && value > 0) return round(value);
  issue(ctx, path, "must be a positive number");
  return undefined;
}

/** A number in `[min, max]`, rounded; records an issue otherwise. */
export function requireNumber(
  ctx: Ctx, path: string, value: unknown, min: number, max: number,
): number | null {
  if (isFiniteNumber(value) && value >= min && value <= max) return round(value);
  return reject(ctx, path, `must be a number ${min}..${max}`);
}

/** `[low, high]` with `min ≤ low ≤ high ≤ max`, rounded. */
export function requireRange(
  ctx: Ctx, path: string, value: unknown, min: number, max: number, integer = false,
): [number, number] | null {
  if (
    Array.isArray(value) && value.length === 2 &&
    value.every((item) => isFiniteNumber(item) && item >= min && item <= max && (!integer || Number.isInteger(item))) &&
    (value[0] as number) <= (value[1] as number)
  ) {
    return [round(value[0] as number), round(value[1] as number)];
  }
  const kind = integer ? "integers" : "numbers";
  return reject(ctx, path, `must be [low, high] ${kind} within ${min}..${max}, low ≤ high`);
}

export function requirePoint(ctx: Ctx, path: string, value: unknown): WorldPoint | null {
  const point = toPoint(value);
  return point ?? reject(ctx, path, `must be [x, z] within ±${WORLD_MAX_COORDINATE}`);
}

export function pointList(ctx: Ctx, path: string, value: unknown, minimum: number): WorldPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum) {
    return reject(ctx, path, `must list at least ${minimum} points`);
  }
  const points: WorldPoint[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const point = toPoint(value[index]);
    if (!point) return reject(ctx, `${path}[${index}]`, `must be [x, z] within ±${WORLD_MAX_COORDINATE}`);
    points.push(point);
  }
  return points;
}

export function requirePolygon(ctx: Ctx, path: string, value: unknown): WorldPoint[] | null {
  return pointList(ctx, path, value, 3);
}

export function optionalPolygon(ctx: Ctx, path: string, value: unknown): WorldPoint[] | undefined {
  if (value === undefined) return undefined;
  return requirePolygon(ctx, path, value) ?? undefined;
}

function toPoint(value: unknown): WorldPoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, z] = value;
  if (!isCoordinate(x) || !isCoordinate(z)) return null;
  return [round(x), round(z)];
}

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= WORLD_MAX_COORDINATE;
}

/** Public-root-relative, forward slashes, no `..`, optionally with a required suffix. */
export function normalizeAssetPath(value: unknown, suffix: string | null): string | null {
  if (typeof value !== "string") return null;
  const path = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => part === ".." || part === "")) return null;
  if (suffix && !path.endsWith(suffix)) return null;
  return path;
}

export function normalizeSeed(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
    ? (value as number)
    : null;
}

export function round(value: number): number {
  return Number(value.toFixed(3));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}
