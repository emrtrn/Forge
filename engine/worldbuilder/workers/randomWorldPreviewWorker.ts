/**
 * Draws the World Builder window's random world preview off the editor's main
 * thread (`randomWorldPreview`, a few hundred milliseconds per picture).
 * Each request carries its cover file as loaded JSON; the answer echoes the
 * request id, so the window keeps only the latest picture.
 */
import { normalizeGroundCover } from "../groundCover";
import type { RandomWorldOptions } from "../randomWorld";
import { randomWorldPreview, type RandomWorldPreview } from "../randomWorldPreview";

export interface RandomWorldPreviewRequest {
  id: number;
  options: RandomWorldOptions;
  /** The `options.cover` file, as fetched JSON. */
  cover: unknown;
  resolution?: number;
}

export type RandomWorldPreviewResponse =
  | { id: number; preview: RandomWorldPreview; milliseconds: number }
  | { id: number; error: string };

// A local scope type avoids mixing DOM and WebWorker library declarations.
const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<RandomWorldPreviewRequest>) => void): void;
  postMessage(message: RandomWorldPreviewResponse, transfer?: ArrayBuffer[]): void;
};

scope.addEventListener("message", ({ data }) => {
  const id = typeof data?.id === "number" ? data.id : -1;
  try {
    const started = performance.now();
    const { cover, issues } = normalizeGroundCover(data.cover);
    if (!cover) throw new Error(`ground cover: ${issues.join("; ")}`);
    const preview = randomWorldPreview(data.options, cover, data.resolution);
    scope.postMessage({ id, preview, milliseconds: Math.round(performance.now() - started) }, [preview.pixels.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
