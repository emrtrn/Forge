/** Original periodic Voronoi light network + smooth domain-warp field.
 * Generated once, not every frame; both channels are linear shader data. */
let shared: Uint8Array | null = null;
export function terrainCausticPattern(): Uint8Array {
  if (shared) return shared;
  const side = 256, cells = 6, data = new Uint8Array(side * side * 2);
  const sites = Array.from({ length: cells * cells }, (_, i) => {
    const hash = (salt: number) => {
      let h = Math.imul(i + salt, 0x9e3779b1); h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
      return (h >>> 0) / 4294967296;
    };
    return [0.15 + 0.7 * hash(17), 0.15 + 0.7 * hash(491)] as const;
  });
  const wrap = (n: number) => ((n % cells) + cells) % cells;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const px = (x + 0.5) / side * cells, py = (y + 0.5) / side * cells;
    const ix = Math.floor(px), iy = Math.floor(py);
    let first = Infinity, second = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const site = sites[wrap(iy + dy) * cells + wrap(ix + dx)]!;
      const a = ix + dx + site[0] - px, b = iy + dy + site[1] - py, d = a * a + b * b;
      if (d < first) { second = first; first = d; } else if (d < second) second = d;
    }
    const distance = Math.sqrt(second) - Math.sqrt(first);
    const t = Math.max(0, Math.min(1, (distance - 0.015) / 0.09));
    const u = (x + 0.5) / side * Math.PI * 2, v = (y + 0.5) / side * Math.PI * 2;
    const offset = (y * side + x) * 2;
    data[offset] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
    data[offset + 1] = Math.round(255 * (0.5 + (Math.sin(u) + Math.sin(v * 2) + Math.sin(u + v)) / 6));
  }
  shared = data; return data;
}
