/** Shared by W1 and W2: cancelled queued work must not acquire a decode slot. */
let active = 0;
const waiting = new Set<() => void>();
export async function readLakeTile<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  while (active >= 4) {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { waiting.delete(wake); reject(new DOMException("Lake cancelled", "AbortError")); };
      const wake = () => { waiting.delete(wake); signal?.removeEventListener("abort", cancel); resolve(); };
      if (signal?.aborted) { cancel(); return; }
      waiting.add(wake); signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  if (signal?.aborted) throw new DOMException("Lake cancelled", "AbortError");
  active++;
  try { return await read(); }
  finally { active--; for (const wake of [...waiting]) wake(); }
}
