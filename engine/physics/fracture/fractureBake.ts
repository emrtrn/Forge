import {
  clipPolyhedron, fractureSeeds, meshBounds, polyhedronCentroid, polyhedronCorners,
  polyhedronFromMesh, polyhedronVolume, voronoiCellPlanes,
  type FracturePolyhedron, type FractureSeedOptions, type FractureSourceMesh, type FractureVec3,
} from "./voronoiFracture";

/** Deterministic fracture sampling, volume threshold and mass settings. */
export interface FractureBakeOptions {
  readonly seed: number;
  readonly cellCount: number;
  readonly totalMass: number;
  readonly focus?: FractureSeedOptions["focus"];
  /** World units per interior UV unit, default 1. */
  readonly interiorUvScale?: number;
  /** Minimum share of source volume, default 0.002. */
  readonly minChunkVolumeFraction?: number;
  /**
   * Splinter pattern: cells are `stretch` times longer along `axis` (source
   * space), and cut-face UVs run U along it. Absent = uniform (stone) cells.
   */
  readonly grain?: { readonly axis: 0 | 1 | 2; readonly stretch: number };
}

/** Pivot-relative render buffers, with exterior indices before interior indices. */
export interface FractureChunkGeometry {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Material 0 is source exterior; material 1 is a cut surface. */
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: 0 | 1 }[];
}

/** One convex chunk with a source-local centroid and pivot-relative hull. */
export interface FractureChunk {
  readonly id: string;
  readonly pivot: FractureVec3;
  readonly volume: number;
  readonly mass: number;
  readonly hull: readonly FractureVec3[];
  readonly geometry: FractureChunkGeometry;
}

/** Final chunks and surviving seeds in matching order. */
export interface FractureBakeResult {
  readonly chunks: readonly FractureChunk[];
  readonly seeds: readonly FractureVec3[];
  readonly sourceVolume: number;
  /** Removed seeds whose neighbours absorbed their cells. */
  readonly mergedCells: number;
}

/** Bakes convex Voronoi chunks; non-closed/non-convex input is left to Faz 3 validation. */
export function bakeFracture(mesh: FractureSourceMesh, options: FractureBakeOptions): FractureBakeResult {
  if (!Number.isInteger(options.cellCount) || options.cellCount < 1) {
    throw new Error("Fracture cellCount must be an integer >= 1");
  }
  if (!Number.isFinite(options.totalMass)) throw new Error("Fracture totalMass must be finite");
  const interiorUvScale = options.interiorUvScale ?? 1;
  if (!(interiorUvScale > 0) || !Number.isFinite(interiorUvScale)) {
    throw new Error("Fracture interiorUvScale must be a finite number > 0");
  }
  const source = polyhedronFromMesh(mesh);
  if (!source.faces.length) throw new Error("Fracture source mesh must contain at least one triangle");
  const bounds = meshBounds(mesh);
  const epsilon = 1e-6 * Math.hypot(...bounds.max.map((v, axis) => v - bounds.min[axis]!));
  const sourceVolume = polyhedronVolume(source);
  const seeds = fractureSeeds({
    seed: options.seed, cellCount: options.cellCount, bounds,
    ...(options.focus ? { focus: options.focus } : {}),
  });
  const minimum = (options.minChunkVolumeFraction ?? 0.002) * sourceVolume;
  const grain = options.grain;
  if (grain && (!(grain.stretch >= 1) || !Number.isFinite(grain.stretch))) {
    throw new Error("Fracture grain stretch must be a finite number >= 1");
  }
  // Distance along the grain counts 1/stretch² as much: cells grow stretch× longer there.
  const weights: FractureVec3 = grain
    ? [0, 1, 2].map((axis) => axis === grain.axis ? 1 / (grain.stretch * grain.stretch) : 1) as unknown as FractureVec3
    : [1, 1, 1];
  const clipOptions = { epsilon, interiorUvScale, ...(grain ? { grainAxis: grain.axis } : {}) };
  let mergedCells = 0;
  let cells: (FracturePolyhedron | null)[];
  let volumes: number[];
  for (;;) {
    cells = seeds.map((_, index) => {
      let cell: FracturePolyhedron | null = source;
      for (const plane of voronoiCellPlanes(seeds, index, weights)) {
        cell = clipPolyhedron(cell, plane, clipOptions);
        if (!cell) break;
      }
      return cell;
    });
    volumes = cells.map((cell) => cell ? polyhedronVolume(cell) : 0);
    let smallest = -1;
    for (let i = 0; i < cells.length; i += 1) {
      if ((!cells[i] || volumes[i]! < minimum) && (smallest < 0 || volumes[i]! < volumes[smallest]!)) smallest = i;
    }
    if (smallest < 0 || seeds.length === 1) break;
    seeds.splice(smallest, 1);
    mergedCells += 1;
  }
  const sum = volumes.reduce((a, b) => a + b, 0);
  const chunks = cells.map((cell, index): FractureChunk => {
    const poly = cell ?? { faces: [] };
    const pivot = polyhedronCentroid(poly);
    const volume = volumes[index]!;
    return {
      id: `c${index}`, pivot, volume,
      // Zero-volume invalid sources still return finite data.
      mass: options.totalMass * (sum > 0 ? volume / sum : 1 / cells.length),
      hull: polyhedronCorners(poly, epsilon).map((point) => relative(point, pivot)),
      geometry: chunkGeometry(poly, pivot),
    };
  });
  return { chunks, seeds, sourceVolume, mergedCells };
}

function chunkGeometry(poly: FracturePolyhedron, pivot: FractureVec3): FractureChunkGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: { start: number; count: number; materialIndex: 0 | 1 }[] = [];
  for (const materialIndex of [0, 1] as const) {
    const start = indices.length;
    for (const face of poly.faces) {
      if (face.interior !== (materialIndex === 1)) continue;
      const base = positions.length / 3;
      for (const vertex of face.vertices) {
        positions.push(...relative(vertex.position, pivot));
        normals.push(...vertex.normal);
        uvs.push(...vertex.uv);
      }
      for (let i = 1; i + 1 < face.vertices.length; i += 1) indices.push(base, base + i, base + i + 1);
    }
    const count = indices.length - start;
    if (count > 0) groups.push({ start, count, materialIndex });
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), indices: new Uint32Array(indices), groups,
  };
}

function relative(point: FractureVec3, pivot: FractureVec3): FractureVec3 {
  return [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
}
