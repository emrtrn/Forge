import { createLakeFixture } from "./lakeFixture";
import type { Vec3 } from "../../../engine/scene/layout";

/** Flat, independent two-seam test bed; source scenes are never read or changed. */
export function createLakeBedFixture(origin: Vec3 = [-64, 10, -64]) {
  const doc = createLakeFixture(origin), dx = origin[0] + 64, dz = origin[2] + 64;
  doc.def.layers.push({ id: "shore", name: "Shore", color: "#c0a070" });
  for (const [key, tile] of doc.tiles) {
    tile.heights.fill(6); tile.layerCount = 2;
    const summary = doc.def.tiles.find((s) => s.key === key)!; summary.minHeight = summary.maxHeight = 6;
  }
  doc.lake.seed = [dx, dz]; doc.lake.surfaceLevel = origin[1] + 4;
  doc.lake.bed = { points: [[-28 + dx, -24 + dz], [28 + dx, -24 + dz], [28 + dx, 24 + dz], [-28 + dx, 24 + dz]],
    smooth: false, smoothness: 0.5, maxDepth: 3, shoreSlopeDegrees: 30, transitionWidth: 4 };
  return doc;
}
