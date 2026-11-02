/** Read-only geometry for site reviews. Coordinates/metres; no route, pad or building generation. */
export function rectangle(center, size, margin = 0) {
  return { min: [center[0] - size[0] / 2 - margin, center[1] - size[1] / 2 - margin],
    max: [center[0] + size[0] / 2 + margin, center[1] + size[1] / 2 + margin] };
}
export const rectangleCorners = box => [[box.min[0], box.min[1]], [box.max[0], box.min[1]],
  [box.max[0], box.max[1]], [box.min[0], box.max[1]]];
export const rectangleOverlap = (a, b) => Math.min(a.max[0], b.max[0]) > Math.max(a.min[0], b.min[0])
  && Math.min(a.max[1], b.max[1]) > Math.max(a.min[1], b.min[1]);

/** Segment inside a closed rectangle, including corner touches. */
export function clipSegment(a, b, box) {
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) { if (a[axis] < box.min[axis] || a[axis] > box.max[axis]) return null; }
    else {
      let t0 = (box.min[axis] - a[axis]) / delta, t1 = (box.max[axis] - a[axis]) / delta;
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
      if (lo > hi) return null;
    }
  }
  return { lo, hi, point: a.map((v, i) => v + (b[i] - v) * lo) };
}

export function pointOnSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return [a[0] + dx * t, a[1] + dy * t];
}
export function rectangleSegmentDistance(box, a, b) {
  const hit = clipSegment(a, b, box);
  if (hit) return { distance: 0, onFootprint: hit.point, onRoad: hit.point };
  const pairs = [a, b].map(p => ({ onRoad: p, onFootprint: p.map((v, i) => Math.max(box.min[i], Math.min(box.max[i], v))) }));
  pairs.push(...rectangleCorners(box).map(p => ({ onFootprint: p, onRoad: pointOnSegment(p, a, b) })));
  return pairs.map(p => ({ ...p, distance: Math.hypot(p.onRoad[0] - p.onFootprint[0], p.onRoad[1] - p.onFootprint[1]) }))
    .sort((p, q) => p.distance - q.distance)[0];
}

/** Clip height-bearing [x,y,height] vertices to a rectangle; heights stay on the triangle plane. */
export function clipHeightTriangle(vertices, box) {
  let polygon = vertices;
  for (const [axis, sign, value] of [[0, 1, box.min[0]], [0, -1, box.max[0]], [1, 1, box.min[1]], [1, -1, box.max[1]]]) {
    const next = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = (a[axis] - value) * sign >= 0, insideB = (b[axis] - value) * sign >= 0;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        next.push(a.map((v, j) => v + (b[j] - v) * t));
      }
    }
    polygon = next;
    if (!polygon.length) break;
  }
  return polygon;
}
export const polygonArea = vertices => Math.abs(vertices.reduce((sum, a, i) => {
  const b = vertices[(i + 1) % vertices.length]; return sum + a[0] * b[1] - b[0] * a[1];
}, 0)) / 2;

/** Exact extrema and maximum triangle grade across a rectangle on the piecewise-linear heightfield. */
export function terrainRectangleStats(box, grid) {
  if (box.min.some((v, i) => v < grid.min[i]) || box.max.some((v, i) => v > grid.max[i])) return null;
  const heights = [];
  let maxGradePercent = 0;
  const ix0 = Math.max(0, Math.floor((box.min[0] - grid.min[0]) / grid.spacing));
  const iy0 = Math.max(0, Math.floor((box.min[1] - grid.min[1]) / grid.spacing));
  const ix1 = Math.min(grid.width - 2, Math.floor((box.max[0] - grid.min[0]) / grid.spacing));
  const iy1 = Math.min(grid.height - 2, Math.floor((box.max[1] - grid.min[1]) / grid.spacing));
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
    const x = grid.min[0] + ix * grid.spacing, y = grid.min[1] + iy * grid.spacing, s = grid.spacing;
    const a = [x, y, grid.vertex(ix, iy)], b = [x + s, y, grid.vertex(ix + 1, iy)],
      c = [x, y + s, grid.vertex(ix, iy + 1)], d = [x + s, y + s, grid.vertex(ix + 1, iy + 1)];
    for (const [triangle, dx, dy] of [[[a, c, b], b[2] - a[2], c[2] - a[2]], [[b, c, d], d[2] - c[2], d[2] - b[2]]]) {
      const clipped = clipHeightTriangle(triangle, box);
      if (clipped.length >= 3 && polygonArea(clipped) > 1e-8) {
        heights.push(...clipped.map(p => p[2]));
        maxGradePercent = Math.max(maxGradePercent, Math.hypot(dx, dy) / s * 100);
      }
    }
  }
  if (!heights.length) return null;
  const minHeight = Math.min(...heights), maxHeight = Math.max(...heights), midrangeHeight = (minHeight + maxHeight) / 2;
  return { minHeight, maxHeight, heightSpread: maxHeight - minHeight, maxGradePercent,
    midrangeHeight, maxCutOrFillToMidrange: (maxHeight - minHeight) / 2 };
}

/** Exact grade along a straight diagnostic link: split at grid and collider-diagonal crossings. */
export function terrainSegmentProfile(a, b, grid, sample) {
  if ([a, b].some(p => p.some((v, i) => v < grid.min[i] || v > grid.max[i]))) return null;
  const delta = b.map((v, i) => v - a[i]), length = Math.hypot(...delta), times = [0, 1];
  for (const [start, change, origin] of [[a[0], delta[0], grid.min[0]], [a[1], delta[1], grid.min[1]],
    [a[0] + a[1], delta[0] + delta[1], grid.min[0] + grid.min[1]]]) {
    if (Math.abs(change) < 1e-12) continue;
    const end = start + change;
    for (let k = Math.ceil((Math.min(start, end) - origin) / grid.spacing); k <= Math.floor((Math.max(start, end) - origin) / grid.spacing); k++) {
      const t = (origin + k * grid.spacing - start) / change;
      if (t > 0 && t < 1) times.push(t);
    }
  }
  const unique = times.sort((x, y) => x - y).filter((t, i, list) => i === 0 || t - list[i - 1] > 1e-10);
  const heights = unique.map(t => sample(a[0] + delta[0] * t, a[1] + delta[1] * t));
  if (heights.some(h => h === null || !Number.isFinite(h))) return null;
  let maxGradePercent = 0;
  if (length > 1e-8) for (let i = 1; i < heights.length; i++) {
    maxGradePercent = Math.max(maxGradePercent, Math.abs(heights[i] - heights[i - 1]) / ((unique[i] - unique[i - 1]) * length) * 100);
  }
  return { horizontalLength: length, startHeight: heights[0], endHeight: heights.at(-1), maxGradePercent,
    note: "Straight diagnostic link on saved terrain, not an authored or traversable route" };
}
