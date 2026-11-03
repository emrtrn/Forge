/** Object-local vector used by the pure fracture geometry core. */
export type FractureVec3 = readonly [number, number, number];

/** Half-space dot(normal, p) <= offset, with a unit normal. */
export interface FracturePlane {
  readonly normal: FractureVec3;
  readonly offset: number;
  readonly neighbor?: number;
}

/** Polygon vertex attributes carried through clipping. */
export interface FractureVertex {
  readonly position: FractureVec3;
  readonly normal: FractureVec3;
  readonly uv: readonly [number, number];
}

/** Convex planar face, counter-clockwise when seen from outside. */
export interface FractureFace {
  readonly vertices: readonly FractureVertex[];
  readonly interior: boolean;
  readonly neighbor?: number;
}

/** Closed convex polyhedron represented by its boundary faces. */
export interface FracturePolyhedron {
  readonly faces: readonly FractureFace[];
}

/** Triangle mesh and per-vertex attributes in object-local space. */
export interface FractureSourceMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array | null;
  readonly indices: Uint32Array | null;
}

/** Deterministic sampling bounds and optional spherical densification. */
export interface FractureSeedOptions {
  readonly seed: number;
  readonly cellCount: number;
  readonly bounds: { readonly min: FractureVec3; readonly max: FractureVec3 };
  /** First round(share * cellCount) seeds come from this ball, then are clamped. */
  readonly focus?: { readonly point: FractureVec3; readonly radius: number; readonly share: number };
}

/** Samples mulberry32 seeds within bounds inset by one percent on each side. */
export function fractureSeeds(options: FractureSeedOptions): FractureVec3[] {
  if (!Number.isInteger(options.cellCount) || options.cellCount < 1) {
    throw new Error("Fracture cellCount must be an integer >= 1");
  }
  let state = options.seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const low = options.bounds.min.map((v, axis) => v + (options.bounds.max[axis]! - v) * 0.01);
  const high = options.bounds.max.map((v, axis) => v - (v - options.bounds.min[axis]!) * 0.01);
  const focus = options.focus;
  const focused = focus ? Math.round(Math.max(0, Math.min(1, focus.share)) * options.cellCount) : 0;
  const seeds: FractureVec3[] = [];
  for (let i = 0; i < options.cellCount; i += 1) {
    let point: FractureVec3;
    if (focus && i < focused) {
      const z = 2 * random() - 1;
      const angle = 2 * Math.PI * random();
      const radius = Math.cbrt(random()) * focus.radius;
      const ring = Math.sqrt(Math.max(0, 1 - z * z));
      point = [focus.point[0] + radius * ring * Math.cos(angle),
        focus.point[1] + radius * ring * Math.sin(angle), focus.point[2] + radius * z];
    } else {
      point = [low[0]! + random() * (high[0]! - low[0]!),
        low[1]! + random() * (high[1]! - low[1]!), low[2]! + random() * (high[2]! - low[2]!)];
    }
    const clamp = (axis: number): number => Math.max(low[axis]!, Math.min(high[axis]!, point[axis]!));
    seeds.push([clamp(0), clamp(1), clamp(2)]);
  }
  return seeds;
}

/**
 * Bisectors in seed order; distances below 1e-12 are treated as coincident.
 * `weights` measures distance as Σ wᵢ·Δᵢ² (anisotropic Voronoi): an axis with
 * a small weight counts less, so cells stretch along it — wood splinters along
 * the grain. The bisector is still a plane, normal w ⊙ (b − a) through the
 * midpoint, so clipping, hulls and mass stay convex and unchanged.
 */
export function voronoiCellPlanes(
  seeds: readonly FractureVec3[], index: number, weights: FractureVec3 = [1, 1, 1],
): FracturePlane[] {
  const seed = seeds[index];
  if (!seed) throw new Error("Fracture seed index is out of range");
  const planes: FracturePlane[] = [];
  for (let j = 0; j < seeds.length; j += 1) {
    if (j === index) continue;
    const other = seeds[j]!;
    const raw = subtract(other, seed);
    const delta: FractureVec3 = [raw[0] * weights[0], raw[1] * weights[1], raw[2] * weights[2]];
    const length = Math.hypot(...delta);
    if (length < 1e-12) continue;
    const normal = multiply(delta, 1 / length);
    planes.push({ normal, offset: dot(normal, multiply(add(seed, other), 0.5)), neighbor: j });
  }
  return planes;
}

/** Converts each source triangle into one exterior face without sharing vertices. */
export function polyhedronFromMesh(mesh: FractureSourceMesh): FracturePolyhedron {
  const count = mesh.indices?.length ?? mesh.positions.length / 3;
  const faces: FractureFace[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const vertices: FractureVertex[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices ? mesh.indices[i + corner]! : i + corner;
      vertices.push({
        position: read3(mesh.positions, index), normal: read3(mesh.normals, index),
        uv: mesh.uvs ? [mesh.uvs[index * 2]!, mesh.uvs[index * 2 + 1]!] : [0, 0],
      });
    }
    faces.push({ vertices, interior: false });
  }
  return { faces };
}

/**
 * Keeps the inside half and caps the cut with outward normals and box UVs.
 * With `grainAxis`, a cap that projects along a plane containing that axis
 * maps it to U — wood textures (the starter `T_Wood_Oak_D` too) draw the grain
 * horizontally — so the grain runs along every splinter.
 */
export function clipPolyhedron(
  poly: FracturePolyhedron, plane: FracturePlane,
  options: { epsilon: number; interiorUvScale: number; grainAxis?: 0 | 1 | 2 },
): FracturePolyhedron | null {
  const { epsilon, interiorUvScale, grainAxis } = options;
  const distance = (p: FractureVec3): number => dot(plane.normal, p) - plane.offset;
  let outside = false;
  let inside = false;
  for (const face of poly.faces) {
    for (const vertex of face.vertices) {
      const d = distance(vertex.position);
      outside ||= d > epsilon;
      inside ||= d < -epsilon;
    }
  }
  if (!outside) return poly.faces.length ? poly : null;
  if (!inside) return null;
  const faces: FractureFace[] = [];
  const cap: FractureVec3[] = [];
  for (const face of poly.faces) {
    const vertices: FractureVertex[] = [];
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i]!;
      const b = face.vertices[(i + 1) % face.vertices.length]!;
      const da = distance(a.position);
      const db = distance(b.position);
      const aIn = da <= epsilon;
      const bIn = db <= epsilon;
      if (aIn) vertices.push(a);
      if (Math.abs(da) <= epsilon) uniquePoint(cap, a.position, epsilon);
      // An on-plane endpoint is already kept: avoid an extrapolated crossing.
      if (aIn !== bIn && Math.abs(da) > epsilon && Math.abs(db) > epsilon) {
        const t = da / (da - db);
        const normal = lerp(a.normal, b.normal, t);
        const length = Math.hypot(...normal);
        const vertex: FractureVertex = {
          position: lerp(a.position, b.position, t),
          normal: length > 0 ? multiply(normal, 1 / length) : a.normal,
          uv: [a.uv[0] + t * (b.uv[0] - a.uv[0]), a.uv[1] + t * (b.uv[1] - a.uv[1])],
        };
        vertices.push(vertex);
        uniquePoint(cap, vertex.position, epsilon);
      }
    }
    const clean = vertices.filter((v, i) => !near(v.position, vertices[(i + vertices.length - 1) % vertices.length]!.position, epsilon));
    if (clean.length >= 3 && faceArea2(clean) > epsilon * epsilon) {
      faces.push({ vertices: clean, interior: face.interior,
        ...(face.neighbor !== undefined ? { neighbor: face.neighbor } : {}) });
    }
  }
  if (cap.length >= 3) {
    const center = multiply(cap.reduce(add, [0, 0, 0]), 1 / cap.length);
    const n = plane.normal;
    const axis: FractureVec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const uRaw = cross(axis, n);
    const u = multiply(uRaw, 1 / Math.hypot(...uRaw));
    const v = cross(n, u);
    const angle = (p: FractureVec3): number => Math.atan2(dot(subtract(p, center), v), dot(subtract(p, center), u));
    cap.sort((a, b) => angle(a) - angle(b));
    // Dominant-axis ties use X, then Y, then Z. Drop X -> YZ, Y -> XZ, Z -> XY.
    const dominant = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0
      : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
    const projected = dominant === 0 ? [1, 2] : dominant === 1 ? [0, 2] : [0, 1];
    const axes = grainAxis !== undefined && projected[1] === grainAxis ? [grainAxis, projected[0]!] : projected;
    const vertices = cap.map((position): FractureVertex => ({
      position, normal: n, uv: [position[axes[0]!]! / interiorUvScale, position[axes[1]!]! / interiorUvScale],
    }));
    if (faceArea2(vertices) > epsilon * epsilon) {
      faces.push({ vertices, interior: true,
        ...(plane.neighbor !== undefined ? { neighbor: plane.neighbor } : {}) });
    }
  }
  return faces.length ? { faces } : null;
}

/** Absolute signed volume from boundary fan triangles (divergence theorem). */
export function polyhedronVolume(poly: FracturePolyhedron): number {
  return Math.abs(measures(poly).volume);
}

/** Volume centroid; zero-volume boundaries fall back to their vertex mean. */
export function polyhedronCentroid(poly: FracturePolyhedron): FractureVec3 {
  const measured = measures(poly);
  if (measured.volume !== 0) return multiply(measured.moment, 1 / measured.volume);
  const points = poly.faces.flatMap((face) => face.vertices.map((v) => v.position));
  return points.length ? multiply(points.reduce(add, [0, 0, 0]), 1 / points.length) : [0, 0, 0];
}

/** Welds positions within epsilon, keeping deterministic first-encounter order. */
export function polyhedronCorners(poly: FracturePolyhedron, epsilon: number): FractureVec3[] {
  const points: FractureVec3[] = [];
  for (const face of poly.faces) for (const vertex of face.vertices) uniquePoint(points, vertex.position, epsilon);
  return points;
}

/** Bounds of all source positions; an empty mesh has zero bounds. */
export function meshBounds(mesh: FractureSourceMesh): { min: FractureVec3; max: FractureVec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  if (!mesh.positions.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, mesh.positions[i + axis]!);
      max[axis] = Math.max(max[axis]!, mesh.positions[i + axis]!);
    }
  }
  return { min, max };
}

/** Checks welded edge incidence and outward triangle half-spaces for Faz 3. */
export function checkFractureSource(mesh: FractureSourceMesh, epsilon: number): { closed: boolean; convex: boolean } {
  const poly = polyhedronFromMesh(mesh);
  const points = polyhedronCorners(poly, epsilon);
  const edges = new Map<string, number>();
  let convex = poly.faces.length > 0;
  let valid = convex;
  for (const face of poly.faces) {
    const [a, b, c] = face.vertices.map((v) => v.position);
    const normal = cross(subtract(b!, a!), subtract(c!, a!));
    const length = Math.hypot(...normal);
    if (length <= epsilon * epsilon) { convex = false; valid = false; }
    for (const p of points) if (dot(normal, subtract(p, a!)) > epsilon * length) convex = false;
    const ids = face.vertices.map((v) => points.findIndex((p) => near(p, v.position, epsilon)));
    for (let i = 0; i < 3; i += 1) {
      const x = ids[i]!;
      const y = ids[(i + 1) % 3]!;
      if (x === y) valid = false;
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return { closed: valid && [...edges.values()].every((count) => count === 2), convex };
}

function measures(poly: FracturePolyhedron): { volume: number; moment: FractureVec3 } {
  // A nearby reference avoids cancellation for meshes translated far from the origin.
  const origin = poly.faces[0]?.vertices[0]?.position ?? [0, 0, 0];
  let volume = 0;
  let moment: FractureVec3 = [0, 0, 0];
  for (const face of poly.faces) {
    const a = face.vertices[0]?.position;
    if (!a) continue;
    for (let i = 1; i + 1 < face.vertices.length; i += 1) {
      const b = face.vertices[i]!.position;
      const c = face.vertices[i + 1]!.position;
      const v = dot(subtract(a, origin), cross(subtract(b, origin), subtract(c, origin))) / 6;
      volume += v;
      moment = add(moment, multiply(add(add(origin, a), add(b, c)), v / 4));
    }
  }
  return { volume, moment };
}

/** True polygon area from half the magnitude of its triangle cross-sum. */
export function faceArea(vertices: readonly FractureVertex[]): number {
  return vertices.length < 3 ? 0 : faceArea2(vertices) / 2;
}

function faceArea2(vertices: readonly FractureVertex[]): number {
  let area: FractureVec3 = [0, 0, 0];
  const origin = vertices[0]!.position;
  for (let i = 1; i + 1 < vertices.length; i += 1) {
    area = add(area, cross(subtract(vertices[i]!.position, origin), subtract(vertices[i + 1]!.position, origin)));
  }
  return Math.hypot(...area);
}

function uniquePoint(points: FractureVec3[], point: FractureVec3, epsilon: number): void {
  if (!points.some((p) => near(p, point, epsilon))) points.push(point);
}

function near(a: FractureVec3, b: FractureVec3, epsilon: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= epsilon;
}

function read3(values: Float32Array, index: number): FractureVec3 {
  return [values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!];
}

function dot(a: FractureVec3, b: FractureVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: FractureVec3, b: FractureVec3): FractureVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function add(a: FractureVec3, b: FractureVec3): FractureVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: FractureVec3, b: FractureVec3): FractureVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(a: FractureVec3, scale: number): FractureVec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function lerp(a: FractureVec3, b: FractureVec3, t: number): FractureVec3 {
  return add(a, multiply(subtract(b, a), t));
}
