/** Runtime-safe read contracts. No Node or editor/save-validator dependency. */
export type ContentFailure = "network" | "http" | "invalid-json" | "invalid-data" | "unsupported-version";

export class ContentLoadError extends Error {
  constructor(
    readonly path: string,
    readonly reason: ContentFailure,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`${path}: ${detail}`, options);
    this.name = "ContentLoadError";
  }
}

export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContentLoadError(path, "invalid-data", "expected an object");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ContentLoadError(path, "invalid-data", "expected a non-empty string");
  }
  return value;
}

export function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ContentLoadError(path, "invalid-data", "expected an array");
  return value;
}

export function requireVec3(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new ContentLoadError(path, "invalid-data", "expected three finite numbers");
  }
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Versionless legacy documents remain readable only where explicitly allowed. */
export function requireVersion(value: unknown, supported: number, path: string, allowMissing = false): void {
  if (value === undefined && allowMissing) return;
  if (value !== supported) {
    throw new ContentLoadError(path, "unsupported-version", `unsupported version ${String(value)}; expected ${supported}`);
  }
}

/** Check top-level sidecar structure before its tolerant normalizer runs. */
export function requireSidecar(
  value: unknown,
  path: string,
  arrays: readonly string[] = [],
  records: readonly string[] = [],
): Record<string, unknown> {
  const input = requireRecord(value, path);
  requireVersion(input.schema, 1, `${path}.schema`, true);
  for (const key of arrays) {
    if (input[key] === undefined) continue;
    requireArray(input[key], `${path}.${key}`).forEach((entry, i) => {
      if (key === "slots") {
        if (typeof entry !== "string") throw new ContentLoadError(`${path}.${key}[${i}]`, "invalid-data", "expected a string");
      } else {
        requireRecord(entry, `${path}.${key}[${i}]`);
      }
    });
  }
  for (const key of records) if (input[key] !== undefined) requireRecord(input[key], `${path}.${key}`);
  return input;
}
