/**
 * Chunk bit masks for the save-game (DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 5):
 * which chunks of a partly broken source still stand. A bake holds at most
 * {@link FRACTURE_MASK_MAX_CHUNKS} chunks (`cellCount` ≤ 64), so the mask is a
 * hex string, one digit per four chunks, chunk 0 in the lowest bit of the
 * last digit — a JSON-safe 64-bit field without BigInt.
 */

export const FRACTURE_MASK_MAX_CHUNKS = 64;

/** Hex digits a mask of `count` chunks has. */
export function chunkMaskLength(count: number): number {
  return Math.ceil(count / 4);
}

/** `flags[i]` → bit i; lower-case hex, `chunkMaskLength(flags.length)` digits. */
export function encodeChunkMask(flags: readonly boolean[]): string {
  let mask = "";
  for (let digit = chunkMaskLength(flags.length) - 1; digit >= 0; digit -= 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) if (flags[digit * 4 + bit]) value |= 1 << bit;
    mask += value.toString(16);
  }
  return mask;
}

/**
 * Inverse of {@link encodeChunkMask}; null unless `mask` is exactly the hex
 * digits `count` chunks need with no bit set past the last chunk.
 */
export function decodeChunkMask(mask: unknown, count: number): boolean[] | null {
  if (typeof mask !== "string" || !Number.isInteger(count) || count < 1 || count > FRACTURE_MASK_MAX_CHUNKS) return null;
  const length = chunkMaskLength(count);
  if (mask.length !== length || !/^[0-9a-f]+$/i.test(mask)) return null;
  const flags = Array<boolean>(count).fill(false);
  for (let index = 0; index < length; index += 1) {
    const digit = length - 1 - index;
    const value = Number.parseInt(mask[index]!, 16);
    for (let bit = 0; bit < 4; bit += 1) {
      if (!(value & (1 << bit))) continue;
      const chunk = digit * 4 + bit;
      if (chunk >= count) return null;
      flags[chunk] = true;
    }
  }
  return flags;
}
