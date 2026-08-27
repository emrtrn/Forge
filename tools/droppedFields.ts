/**
 * Silent-data-loss detector for the dev save endpoints (plan invariant I5).
 *
 * Every `/__save-*` validator in `tools/saveValidator.ts` is an **allowlist**:
 * a field nobody copied through is simply not in the output, and until now that
 * loss was invisible — the save reported success and the value was gone. The
 * cheapest honest fix is not to rewrite sixty validators but to compare what was
 * sent with what survived: any key present in the input and absent from the
 * validated output is a field the save dropped.
 *
 * The comparison is deliberately one-directional and conservative, so the report
 * carries signal rather than normalization noise:
 *  - only *missing keys* are reported. Added defaults, coerced types, rounded
 *    numbers and re-ordered keys are what a normalizer is supposed to do.
 *  - arrays whose length changed report the count, not per-item diffs: a
 *    rejected item shifts every later index, and pairwise-comparing past that
 *    point would report the whole tail as dropped.
 *
 * Kept dependency-free (no vite/node) so `vite.config.ts` and the headless tests
 * can both import it.
 */

/** How many distinct paths one report lists before it stops collecting. */
export const DROPPED_FIELD_LIMIT = 40;

export interface DroppedFieldReport {
  /** Dot/bracket paths of the fields the validator did not copy through. */
  readonly paths: readonly string[];
  /** True when collection stopped at {@link DROPPED_FIELD_LIMIT}. */
  readonly truncated: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(path: string, key: string): string {
  if (!path) return key;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Lists the fields present in `input` that did not survive into `output`.
 *
 * `root` labels the top of the compared value in the reported paths (e.g.
 * `"layout"`), so a message reads `layout.instances[3].glow`.
 */
export function collectDroppedFields(
  input: unknown,
  output: unknown,
  root = "",
  limit: number = DROPPED_FIELD_LIMIT,
): DroppedFieldReport {
  const paths: string[] = [];
  let truncated = false;

  const record = (path: string): void => {
    if (paths.length >= limit) {
      truncated = true;
      return;
    }
    paths.push(path);
  };

  const walk = (left: unknown, right: unknown, path: string): void => {
    if (paths.length >= limit) return;
    if (Array.isArray(left)) {
      if (!Array.isArray(right)) return;
      if (left.length !== right.length) {
        record(`${path} (${left.length - right.length} of ${left.length} item(s) dropped)`);
        return;
      }
      for (let index = 0; index < left.length; index += 1) {
        walk(left[index], right[index], `${path}[${index}]`);
      }
      return;
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return;
    for (const [key, value] of Object.entries(left)) {
      // `undefined` never round-trips through JSON, so a key holding it was
      // never really sent and its absence downstream is not a loss.
      if (value === undefined) continue;
      if (!(key in right)) {
        record(joinPath(path, key));
        continue;
      }
      walk(value, right[key], joinPath(path, key));
    }
  };

  walk(input, output, root);
  return { paths, truncated };
}

/**
 * One-line warning for a dropped-field report, or null when nothing was lost.
 * Shared by the dev server (console) and the editor (save status), so both
 * phrase the same failure the same way.
 */
export function formatDroppedFieldWarning(
  report: DroppedFieldReport,
  subject: string,
): string | null {
  if (report.paths.length === 0) return null;
  const suffix = report.truncated ? ", …" : "";
  return `${subject}: ${report.paths.length} field(s) were dropped by the save validator — ${report.paths.join(", ")}${suffix}. Add them to tools/saveValidator.ts or they will not persist.`;
}
