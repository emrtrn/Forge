import { ContentLoadError } from "@engine/assets/contentValidation";
import { publicFileUrl } from "./publicUrl";

/** Required content fails with its authored path and a classified reason. */
export async function readContentJson(path: string, optional = false): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(publicFileUrl(path, import.meta.env?.BASE_URL ?? "/"), { cache: "no-cache" });
  } catch (cause) {
    throw new ContentLoadError(path, "network", "network request failed", { cause });
  }
  if (optional && response.status === 404) return undefined;
  if (!response.ok) {
    throw new ContentLoadError(path, "http", `HTTP ${response.status} ${response.statusText}`.trim());
  }
  try {
    return await response.json() as unknown;
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new ContentLoadError(path, "invalid-json", "invalid JSON", { cause });
    }
    throw new ContentLoadError(path, "network", "response body could not be read", { cause });
  }
}

/** One warning per failed path/reason in this page session; success re-arms it. */
const warned = new Map<string, string>();

export async function readOptionalSidecar<T>(
  path: string,
  normalize: (value: unknown) => T,
  defaults: () => T,
  validate: (value: unknown, path: string) => unknown,
): Promise<T> {
  try {
    const raw = await readContentJson(path, true);
    if (raw === undefined) {
      warned.delete(path);
      return defaults();
    }
    validate(raw, path);
    const result = normalize(raw);
    warned.delete(path);
    return result;
  } catch (error) {
    const failure = error instanceof ContentLoadError ? error.reason : "invalid-data";
    const message = error instanceof Error ? error.message : String(error);
    const signature = `${failure}:${message}`;
    if (warned.get(path) !== signature) {
      warned.set(path, signature);
      console.warn(`[content:${failure}] ${path}; using defaults. ${message}`);
    }
    return defaults();
  }
}
