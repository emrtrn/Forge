import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from "three";

/**
 * Debug drawing of a Recast nav mesh (OPEN_WORLD_PLAN Faz 9, R4): the walkable
 * polygons as a translucent fill with their edges, plus an outline per loaded
 * tile — stale tiles (geometry changed, rebuild pending) in a warning colour.
 * The triangles come from the Detour mesh itself, so the overlay shows exactly
 * where an agent of that profile can stand. Shared by the runtime `?debug`
 * view and the editor's "Show > AI Navigation" preview; dispose it with
 * `disposeAiNavigationView`.
 */
export interface RecastNavMeshViewInput {
  /** Flat XYZ positions and triangle indices of the loaded polygons. */
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly tiles: readonly { readonly x: number; readonly z: number; readonly stale?: boolean }[];
  readonly tileSize: number;
  /** Lift above the polygons so the fill does not z-fight the floor. Default 0.05. */
  readonly lift?: number;
}

const FILL_COLOR = 0x35c46b;
const EDGE_COLOR = 0x9dffbf;
const TILE_COLOR = 0x4386ff;
const STALE_TILE_COLOR = 0xffa142;
const DEFAULT_LIFT = 0.05;

export function createRecastNavMeshView(input: RecastNavMeshViewInput): Group {
  const group = new Group();
  group.name = "ai-navmesh-debug-view";
  const lift = input.lift ?? DEFAULT_LIFT;
  const vertexCount = Math.floor(input.positions.length / 3);
  const positions = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    positions[index * 3] = input.positions[index * 3]!;
    positions[index * 3 + 1] = input.positions[index * 3 + 1]! + lift;
    positions[index * 3 + 2] = input.positions[index * 3 + 2]!;
  }
  const triangleIndices = validTriangles(input.indices, vertexCount);

  if (triangleIndices.length > 0) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(triangleIndices, 1));
    const fill = new Mesh(geometry, new MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    }));
    fill.name = "ai-navmesh-polygons";
    fill.renderOrder = 19;
    group.add(fill);

    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    edgeGeometry.setIndex(new BufferAttribute(uniqueEdges(triangleIndices), 1));
    group.add(lines("ai-navmesh-edges", edgeGeometry, EDGE_COLOR, 0.55));
  }

  const fresh: number[] = [];
  const stale: number[] = [];
  const heights = tileHeights(positions, input.tileSize);
  for (const tile of input.tiles) {
    // Heights come from the lifted positions; an empty tile sits at the datum.
    const y = heights.get(`${tile.x}_${tile.z}`) ?? lift;
    const minX = tile.x * input.tileSize;
    const minZ = tile.z * input.tileSize;
    const maxX = minX + input.tileSize;
    const maxZ = minZ + input.tileSize;
    (tile.stale ? stale : fresh).push(
      minX, y, minZ, maxX, y, minZ,
      maxX, y, minZ, maxX, y, maxZ,
      maxX, y, maxZ, minX, y, maxZ,
      minX, y, maxZ, minX, y, minZ,
    );
  }
  if (fresh.length > 0) group.add(lines("ai-navmesh-tiles", flatGeometry(fresh), TILE_COLOR, 0.7));
  if (stale.length > 0) group.add(lines("ai-navmesh-stale-tiles", flatGeometry(stale), STALE_TILE_COLOR, 1));
  return group;
}

/** Triangle indices that reference real vertices, as a typed index buffer. */
function validTriangles(indices: ArrayLike<number>, vertexCount: number): Uint32Array {
  const out: number[] = [];
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = indices[index]!;
    const b = indices[index + 1]!;
    const c = indices[index + 2]!;
    if (a < vertexCount && b < vertexCount && c < vertexCount) out.push(a, b, c);
  }
  return new Uint32Array(out);
}

/** Each triangle edge once, as line-segment index pairs. */
function uniqueEdges(triangles: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * 0x200000 + hi;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(lo, hi);
  };
  for (let index = 0; index < triangles.length; index += 3) {
    add(triangles[index]!, triangles[index + 1]!);
    add(triangles[index + 1]!, triangles[index + 2]!);
    add(triangles[index + 2]!, triangles[index]!);
  }
  return new Uint32Array(out);
}

/** Highest polygon vertex per tile, so its outline sits on top of what it holds. */
function tileHeights(positions: Float32Array, tileSize: number): Map<string, number> {
  const heights = new Map<string, number>();
  if (!(tileSize > 0)) return heights;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const key = `${Math.floor(positions[index]! / tileSize)}_${Math.floor(positions[index + 2]! / tileSize)}`;
    const y = positions[index + 1]!;
    if (y > (heights.get(key) ?? -Infinity)) heights.set(key, y);
  }
  return heights;
}

function flatGeometry(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
}

function lines(name: string, geometry: BufferGeometry, color: number, opacity: number): LineSegments {
  const segments = new LineSegments(geometry, new LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
  }));
  segments.name = name;
  segments.renderOrder = 20;
  return segments;
}
