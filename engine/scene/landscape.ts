import type { LayoutLandscape, Vec3 } from "./layout";
import { buildLandscapeSplineAdjacency, landscapeSplineSegmentSampler } from "./landscapeSplineAdapter";

/**
 * Render-agnostic Landscape model: resolved settings + defaults, the sidecar
 * height/layer data shape, and size presets — shared by the editor view-models
 * and the three.js render binding (`engine/render-three/landscape.ts`). Kept
 * free of three.js so editor core and the save validator can read it without
 * pulling in the renderer.
 *
 * A Landscape is the web/three counterpart to Unreal's Landscape actor: a
 * level-owned heightfield terrain. Faz 1 supports only a flat heightfield
 * (create + render + save/reload); sculpt (Faz 2) and layer paint (Faz 3)
 * write into the same sidecar shape without needing a migration.
 */
export interface ResolvedLandscape {
  name: string;
  hidden: boolean;
  /** Runtime collision. Rebuilt on Save/Play, not live during sculpt. */
  collision: boolean;
}

export const LANDSCAPE_DEFAULTS: ResolvedLandscape = {
  name: "Landscape",
  hidden: false,
  collision: true,
};

/** Fills every Landscape actor field with its default, decoupled from the layout. */
export function resolveLandscape(actor: LayoutLandscape | null | undefined): ResolvedLandscape {
  const defaults = LANDSCAPE_DEFAULTS;
  if (!actor) return { ...defaults };
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    collision: actor.collision ?? defaults.collision,
  };
}

/** A stable, collision-free id for a new landscape (`landscape-<n>`). */
export function uniqueLandscapeId(landscapes: LayoutLandscape[]): string {
  const existing = new Set(landscapes.map((landscape) => landscape.id));
  let index = 1;
  while (existing.has(`landscape-${index}`)) index += 1;
  return `landscape-${index}`;
}

/** A unique display name for a new landscape, suffixing on collision. */
export function uniqueLandscapeName(baseName: string, landscapes: LayoutLandscape[]): string {
  const existing = new Set(landscapes.map((landscape) => landscape.name ?? landscape.id));
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

// --- Grid size presets and paint layers --------------------------------------

/**
 * Preset sizes: `small`/`medium` are the safe range, `large` (exposed in the
 * editor as "High") is the upper bound the save validator accepts. Presets only
 * set vertex density — the terrain's world footprint is preserved on resample,
 * so `large` is how a wide level keeps a fine grid.
 */
export type LandscapeSizePreset = "small" | "medium" | "large";

export interface LandscapeSize {
  verticesX: number;
  verticesZ: number;
  spacing: number;
  heightScale: number;
}

const LANDSCAPE_SIZE_PRESETS: Record<LandscapeSizePreset, LandscapeSize> = {
  small: { verticesX: 65, verticesZ: 65, spacing: 1, heightScale: 1 },
  medium: { verticesX: 129, verticesZ: 129, spacing: 1, heightScale: 1 },
  large: { verticesX: 257, verticesZ: 257, spacing: 1, heightScale: 1 },
};

export function landscapeSizeForPreset(preset: LandscapeSizePreset): LandscapeSize {
  return { ...LANDSCAPE_SIZE_PRESETS[preset] };
}

export type LandscapeLayerId = "grass" | "dirt" | "rock" | "snow";

export interface LandscapeDefaultLayer {
  id: LandscapeLayerId;
  name: string;
  color: string;
}

export const LANDSCAPE_DEFAULT_LAYERS: readonly LandscapeDefaultLayer[] = [
  { id: "grass", name: "Grass", color: "#5f9449" },
  { id: "dirt", name: "Dirt", color: "#8a6441" },
  { id: "rock", name: "Rock", color: "#7f8485" },
  { id: "snow", name: "Snow", color: "#dce7ec" },
];

export interface ForgeLandscapeMaterialDef {
  schema: 1;
  type: "landscapeMaterial";
  name: string;
  layers: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

/** One editable control point in a Landscape road/spline. */
export interface ForgeLandscapeSplinePoint {
  id: string;
  position: Vec3;
  arriveTangent?: Vec3;
  leaveTangent?: Vec3;
  width: number;
  falloff: number;
}

/** A directed connection between two control points. Effects are applied explicitly. */
export interface ForgeLandscapeSplineSegment {
  id: string;
  startPointId: string;
  endPointId: string;
  deform?: {
    enabled: boolean;
    raiseTerrain: boolean;
    lowerTerrain: boolean;
    flatten: boolean;
    targetOffset?: number;
  };
  paint?: {
    enabled: boolean;
    layerId: string;
    strength: number;
  };
  mesh?: {
    enabled: boolean;
    assetId: string;
    spacing?: number;
    scale?: Vec3;
    offset?: Vec3;
    /**
     * Extra yaw (degrees) added to the tangent-aligned rotation. The base yaw
     * aligns the mesh's local +Z axis to the spline direction; author road/rail
     * meshes with their length along +Z, or set this to correct a mesh modelled
     * along another axis (e.g. 90 for a mesh whose length runs along X).
     */
    yawOffset?: number;
    /** Stretch the mesh's local +Z length to fill each resolved spline piece. Defaults to true. */
    fitToLength?: boolean;
    alignToTerrain?: boolean;
    /** Roll in degrees around the spline tangent, after terrain/world-up alignment. */
    bank?: number;
    /** Generates a unique curved geometry instead of rigid fitted instances. */
    deform?: boolean;
    collision?: boolean;
  };
}

/** Persisted, level-owned spline used by the Landscape Road Tool (Faz 6). */
export interface ForgeLandscapeSpline {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /**
   * When true (Faz 6.2a) segments are treated as a smooth Catmull-Rom curve auto-
   * derived from neighbour points; absent/false keeps the straight polyline. No
   * manual Bezier handles — `arriveTangent`/`leaveTangent` are unused in this mode.
   */
  smooth?: boolean;
  /**
   * Tangent scale for smooth spline corners. Absent preserves the historic 0.5
   * Catmull-Rom-style turn; 0 makes a smooth spline follow its straight pieces.
   */
  smoothness?: number;
  points: ForgeLandscapeSplinePoint[];
  segments: ForgeLandscapeSplineSegment[];
}

/** One resolved sub-point along a (possibly curved) spline segment. */
export interface LandscapeSplinePolylineSample {
  /** Landscape-local position (curve point); Y follows the interpolated height. */
  position: Vec3;
  width: number;
  falloff: number;
}

/**
 * One straight piece of a spline's resolved centerline. A straight spline yields
 * one sub-segment per authored segment; a smooth spline yields several per segment
 * (`LANDSCAPE_SPLINE_CURVE_SUBDIVISIONS`). `segment` is the owning authored segment
 * so effect config (deform/paint/mesh) still resolves per sub-segment.
 */
export interface LandscapeSplineSubSegment {
  segment: ForgeLandscapeSplineSegment;
  start: LandscapeSplinePolylineSample;
  end: LandscapeSplinePolylineSample;
}

/** Sub-points sampled per curved segment when a spline's `smooth` flag is on. */
export const LANDSCAPE_SPLINE_CURVE_SUBDIVISIONS = 8;

export const DEFAULT_LANDSCAPE_MATERIAL: ForgeLandscapeMaterialDef = {
  schema: 1,
  type: "landscapeMaterial",
  name: "Default Landscape",
  layers: LANDSCAPE_DEFAULT_LAYERS.map((layer) => ({ ...layer })),
};

/** One resolved static-mesh instance placed along a spline (landscape-local). */
export interface LandscapeSplineMeshInstance {
  assetId: string;
  collision: boolean;
  /** Landscape-local position (matches the height/point coordinate frame). */
  position: Vec3;
  /** Euler degrees retained for inspectability and legacy callers. */
  rotation: Vec3;
  /** Full orientation `[x, y, z, w]`; renderers must prefer this over `rotation`. */
  orientation: [number, number, number, number];
  scale: Vec3;
}

/** One authored spline segment, oriented as it appears in a weldable mesh chain. */
export interface LandscapeSplineMeshChainSegment {
  id: string;
  collision: boolean;
  /** Sampled landscape-local centerline, with its direction aligned to the chain. */
  points: Vec3[];
  /** Arc length at the beginning of this segment within its chain. */
  distanceStart: number;
  /** Arc length at the end of this segment within its chain. */
  distanceEnd: number;
}

/**
 * A non-branching run of compatible `mesh.deform` spline segments. Renderers
 * may deform each piece and weld the results without bridging a junction.
 */
export interface LandscapeSplineMeshChain {
  assetId: string;
  collision: boolean;
  scale: Vec3;
  offset: Vec3;
  yawOffset: number;
  bank: number;
  alignToTerrain: boolean;
  segments: LandscapeSplineMeshChainSegment[];
  /** De-duplicated, directionally ordered centerline samples for inspection/debugging. */
  points: Vec3[];
  totalLength: number;
  closed: boolean;
}

export interface ComputeLandscapeSplineMeshInstancesOptions {
  /** Exact normal in the same frame as the spline, for tiled terrain hosts. */
  normalAt?: (x: number, z: number) => Vec3;
  /** Base-model local +Z lengths, supplied by the render host from loaded bounds. */
  meshForwardLengths?: ReadonlyMap<string, number>;
}

interface DeformMeshCandidate {
  segment: ForgeLandscapeSplineSegment;
  points: Vec3[];
  compatibilityKey: string;
}

function meshDeformCompatibilityKey(segment: ForgeLandscapeSplineSegment): string | null {
  const mesh = segment.mesh;
  if (!mesh?.enabled || !mesh.assetId || mesh.deform !== true) return null;
  const vector = (value: Vec3 | undefined, fallback: Vec3): string => (value ?? fallback).join(",");
  // These values affect vertex positions/frame construction. Keep chains strict
  // so a visual setting change is always a deliberate chain boundary.
  return [
    mesh.assetId,
    vector(mesh.scale, [1, 1, 1]),
    vector(mesh.offset, [0, 0, 0]),
    mesh.yawOffset ?? 0,
    mesh.bank ?? 0,
    mesh.alignToTerrain === true,
  ].join("|");
}

function splinePathLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

/**
 * Finds compatible, non-branching `mesh.deform` runs in one spline. Point
 * degree is calculated from the authored graph, not only eligible mesh edges:
 * a T/X junction is consequently always a chain boundary even if one branch
 * happens to use a different material or has deformation disabled.
 */
export function resolveLandscapeSplineMeshChains(
  spline: ForgeLandscapeSpline,
  subdivisions: number = LANDSCAPE_SPLINE_CURVE_SUBDIVISIONS,
): LandscapeSplineMeshChain[] {
  const pointsBySegment = new Map<string, Vec3[]>();
  for (const sub of splineToPolyline(spline, subdivisions)) {
    const points = pointsBySegment.get(sub.segment.id);
    if (points) points.push(sub.end.position);
    else pointsBySegment.set(sub.segment.id, [sub.start.position, sub.end.position]);
  }
  const degree = new Map<string, number>();
  const addDegree = (id: string): void => {
    degree.set(id, (degree.get(id) ?? 0) + 1);
  };
  for (const segment of spline.segments) {
    if (!pointsBySegment.has(segment.id)) continue;
    addDegree(segment.startPointId);
    addDegree(segment.endPointId);
  }
  const candidates: DeformMeshCandidate[] = [];
  for (const segment of spline.segments) {
    const compatibilityKey = meshDeformCompatibilityKey(segment);
    const points = pointsBySegment.get(segment.id);
    if (!compatibilityKey || !points || points.length < 2 || splinePathLength(points) <= 1e-6) continue;
    candidates.push({ segment, points, compatibilityKey });
  }
  const candidatesByKey = new Map<string, DeformMeshCandidate[]>();
  for (const candidate of candidates) {
    const list = candidatesByKey.get(candidate.compatibilityKey);
    if (list) list.push(candidate);
    else candidatesByKey.set(candidate.compatibilityKey, [candidate]);
  }

  const chains: LandscapeSplineMeshChain[] = [];
  for (const candidatesForKey of candidatesByKey.values()) {
    const byPoint = new Map<string, DeformMeshCandidate[]>();
    for (const candidate of candidatesForKey) {
      for (const pointId of [candidate.segment.startPointId, candidate.segment.endPointId]) {
        const list = byPoint.get(pointId);
        if (list) list.push(candidate);
        else byPoint.set(pointId, [candidate]);
      }
    }
    const unused = new Set(candidatesForKey.map((candidate) => candidate.segment.id));
    const byId = new Map(candidatesForKey.map((candidate) => [candidate.segment.id, candidate] as const));
    while (unused.size > 0) {
      const seed = candidatesForKey.find(
        (candidate) => unused.has(candidate.segment.id) &&
          [candidate.segment.startPointId, candidate.segment.endPointId].some((pointId) => (degree.get(pointId) ?? 0) !== 2),
      ) ?? candidatesForKey.find((candidate) => unused.has(candidate.segment.id))!;
      const boundaryPoint = [seed.segment.startPointId, seed.segment.endPointId]
        .find((pointId) => (degree.get(pointId) ?? 0) !== 2);
      let currentPointId = boundaryPoint ?? seed.segment.startPointId;
      const chainStartPointId = currentPointId;
      const chainSegments: LandscapeSplineMeshChainSegment[] = [];
      const chainPoints: Vec3[] = [];
      let totalLength = 0;
      while (true) {
        const next = (byPoint.get(currentPointId) ?? []).find((candidate) => unused.has(candidate.segment.id));
        if (!next) break;
        unused.delete(next.segment.id);
        const forward = next.segment.startPointId === currentPointId;
        const oriented = forward ? [...next.points] : [...next.points].reverse();
        const length = splinePathLength(oriented);
        chainSegments.push({
          id: next.segment.id,
          collision: next.segment.mesh?.collision !== false,
          points: oriented,
          distanceStart: totalLength,
          distanceEnd: totalLength + length,
        });
        if (chainPoints.length === 0) chainPoints.push(...oriented);
        else chainPoints.push(...oriented.slice(1));
        totalLength += length;
        currentPointId = forward ? next.segment.endPointId : next.segment.startPointId;
        if ((degree.get(currentPointId) ?? 0) !== 2) break;
      }
      if (chainSegments.length === 0) continue;
      const mesh = byId.get(chainSegments[0]!.id)!.segment.mesh!;
      const closed = currentPointId === chainStartPointId;
      if (closed && chainPoints.length > 1) {
        const first = chainPoints[0]!;
        const last = chainPoints.at(-1)!;
        if (first[0] === last[0] && first[1] === last[1] && first[2] === last[2]) chainPoints.pop();
      }
      chains.push({
        assetId: mesh.assetId,
        collision: chainSegments.some((segment) => segment.collision),
        scale: mesh.scale ?? [1, 1, 1],
        offset: mesh.offset ?? [0, 0, 0],
        yawOffset: mesh.yawOffset ?? 0,
        bank: mesh.bank ?? 0,
        alignToTerrain: mesh.alignToTerrain === true,
        segments: chainSegments,
        points: chainPoints,
        totalLength,
        closed,
      });
    }
  }
  return chains;
}

/** Uniform Catmull-Rom interpolation of four control positions at `u` in [0,1]. */

/** Mirror a position across `pivot` — the phantom endpoint for open-chain tangents. */

/**
 * Resolves a spline's authored segments into straight centerline sub-segments
 * (Faz 6.2a). A straight spline (`smooth` off) returns one sub-segment per
 * authored segment — identical to the pre-6.2a behaviour. A smooth spline samples
 * each segment into `subdivisions` Catmull-Rom pieces whose tangents come from the
 * neighbouring control points (looked up through the shared-point adjacency, so
 * closed loops wrap and branches pick a deterministic neighbour); open-chain ends
 * use a mirrored phantom point. Width/falloff/height interpolate along each piece,
 * and every sub-segment keeps its owning authored `segment` for effect config.
 */
export function splineToPolyline(
  spline: ForgeLandscapeSpline,
  subdivisions: number = LANDSCAPE_SPLINE_CURVE_SUBDIVISIONS,
): LandscapeSplineSubSegment[] {
  const out: LandscapeSplineSubSegment[] = [];
  const smooth = spline.smooth === true;
  const steps = smooth ? Math.max(1, Math.floor(subdivisions)) : 1;
  // One shared curve context for the whole spline, and one sampler per segment:
  // resolving either per sample made this quadratic in segment count.
  const adjacency = buildLandscapeSplineAdjacency(spline);
  const pointById = adjacency.points;

  for (const segment of spline.segments) {
    const p1 = pointById.get(segment.startPointId);
    const p2 = pointById.get(segment.endPointId);
    if (!p1 || !p2) continue;
    if (!smooth) {
      out.push({
        segment,
        start: { position: p1.position, width: p1.width, falloff: p1.falloff },
        end: { position: p2.position, width: p2.width, falloff: p2.falloff },
      });
      continue;
    }
    const sampleAt = landscapeSplineSegmentSampler(spline, segment, adjacency);
    let prev: LandscapeSplinePolylineSample = { position: p1.position, width: p1.width, falloff: p1.falloff };
    for (let step = 1; step <= steps; step += 1) {
      const u = step / steps;
      const sample: LandscapeSplinePolylineSample = {
        position: sampleAt?.(u) ?? p2.position,
        width: p1.width + (p2.width - p1.width) * u,
        falloff: p1.falloff + (p2.falloff - p1.falloff) * u,
      };
      out.push({ segment, start: prev, end: sample });
      prev = sample;
    }
  }
  return out;
}

/**
 * Resolves one instanced static-mesh placement for every straight piece of a
 * mesh-enabled spline segment. The mesh's local +Z axis follows the full 3D
 * tangent; with `fitToLength` (the default) its +Z scale fills the piece exactly.
 * This is intentionally still instanced geometry, not true vertex deformation.
 */
export function computeLandscapeSplineMeshInstances(
  spline: ForgeLandscapeSpline,
  options: ComputeLandscapeSplineMeshInstancesOptions = {},
): LandscapeSplineMeshInstance[] {
  const subsBySegment = new Map<string, LandscapeSplineSubSegment[]>();
  for (const sub of splineToPolyline(spline)) {
    const list = subsBySegment.get(sub.segment.id);
    if (list) list.push(sub);
    else subsBySegment.set(sub.segment.id, [sub]);
  }
  const instances: LandscapeSplineMeshInstance[] = [];
  for (const segment of spline.segments) {
    const mesh = segment.mesh;
    if (!mesh || !mesh.enabled || !mesh.assetId || mesh.deform === true) continue;
    const subs = subsBySegment.get(segment.id);
    if (!subs || subs.length === 0) continue;
    const offset = mesh.offset ?? [0, 0, 0];
    const scale = mesh.scale ?? [1, 1, 1];
    const yawOffset = mesh.yawOffset ?? 0;
    const bank = mesh.bank ?? 0;
    const forwardLength = options.meshForwardLengths?.get(mesh.assetId);
    const fitToLength = mesh.fitToLength !== false && !!forwardLength && forwardLength > 1e-6;
    const spacing = Math.max(0.01, mesh.spacing ?? 2);
    for (const sub of subs) {
      const a = sub.start.position;
      const b = sub.end.position;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz);
      if (length <= 1e-6) continue;
      const pieces = fitToLength ? 1 : Math.max(1, Math.ceil(length / spacing));
      for (let piece = 0; piece < pieces; piece += 1) {
        const startT = piece / pieces;
        const endT = (piece + 1) / pieces;
        const start: Vec3 = [a[0] + dx * startT, a[1] + dy * startT, a[2] + dz * startT];
        const end: Vec3 = [a[0] + dx * endT, a[1] + dy * endT, a[2] + dz * endT];
        const pieceLength = length / pieces;
        const yawDeg = Number((((Math.atan2(dx, dz) * 180) / Math.PI) + yawOffset).toFixed(3));
        const pitchDeg = Number(((-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI).toFixed(3));
        const orientation = splineMeshOrientation(
          [dx / length, dy / length, dz / length],
          yawOffset,
          bank,
          mesh.alignToTerrain === true && options.normalAt
            ? options.normalAt((start[0] + end[0]) / 2, (start[2] + end[2]) / 2)
            : [0, 1, 0],
        );
        const fitScaleZ = fitToLength ? pieceLength / forwardLength! : 1;
        instances.push({
          assetId: mesh.assetId,
          collision: mesh.collision !== false,
          position: [
            Number(((start[0] + end[0]) / 2 + offset[0]).toFixed(3)),
            Number(((start[1] + end[1]) / 2 + offset[1]).toFixed(3)),
            Number(((start[2] + end[2]) / 2 + offset[2]).toFixed(3)),
          ],
          rotation: [pitchDeg, yawDeg, bank],
          orientation,
          scale: [scale[0], scale[1], Number((scale[2] * fitScaleZ).toFixed(6))],
        });
      }
    }
  }
  return instances;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > 1e-6 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [0, 1, 0];
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, degrees: number): Vec3 {
  if (Math.abs(degrees) <= 1e-6) return vector;
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const perpendicular = cross(axis, vector);
  return [
    vector[0] * cosine + perpendicular[0] * sine + axis[0] * dot * (1 - cosine),
    vector[1] * cosine + perpendicular[1] * sine + axis[1] * dot * (1 - cosine),
    vector[2] * cosine + perpendicular[2] * sine + axis[2] * dot * (1 - cosine),
  ];
}

/** Quaternion from a local frame whose columns are local +X, +Y, and +Z. */
function quaternionFromBasis(right: Vec3, up: Vec3, forward: Vec3): [number, number, number, number] {
  const m11 = right[0]; const m12 = up[0]; const m13 = forward[0];
  const m21 = right[1]; const m22 = up[1]; const m23 = forward[1];
  const m31 = right[2]; const m32 = up[2]; const m33 = forward[2];
  const trace = m11 + m22 + m33;
  let x: number; let y: number; let z: number; let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
  }
  return [x, y, z, w].map((value) => Number(value.toFixed(8))) as [number, number, number, number];
}

function splineMeshOrientation(forward: Vec3, yawOffset: number, bank: number, upHint: Vec3): [number, number, number, number] {
  let alignedForward = normalize(rotateAroundAxis(forward, normalize(upHint), yawOffset));
  let right = cross(normalize(upHint), alignedForward);
  if (Math.hypot(...right) <= 1e-6) right = cross([0, 0, 1], alignedForward);
  right = normalize(right);
  let up = normalize(cross(alignedForward, right));
  if (Math.abs(bank) > 1e-6) {
    right = normalize(rotateAroundAxis(right, alignedForward, bank));
    up = normalize(cross(alignedForward, right));
  }
  return quaternionFromBasis(right, up, alignedForward);
}

/** All static-mesh asset ids referenced by a landscape's spline mesh segments. */
export function landscapeSplineMeshAssetIds(data: { splines?: readonly ForgeLandscapeSpline[] | undefined }): string[] {
  const ids = new Set<string>();
  for (const spline of data.splines ?? []) {
    for (const segment of spline.segments) {
      if (segment.mesh?.enabled && segment.mesh.assetId) ids.add(segment.mesh.assetId);
    }
  }
  return [...ids];
}

/**
 * Resamples an RGBA heightmap into the landscape vertex grid. Pixel luminance
 * is interpreted as a normalized height (black = 0, white = `heightRange`).
 * Bilinear sampling keeps a source PNG independent of the current terrain
 * resolution, so imports never need to mutate the level's grid shape.
 */
export function resampleLandscapeHeightmap(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  target: Pick<LandscapeSize, "verticesX" | "verticesZ">,
  heightRange: number,
): number[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Heightmap image dimensions must be positive integers.");
  }
  if (rgba.length < width * height * 4) throw new Error("Heightmap pixel data is incomplete.");
  if (!Number.isFinite(heightRange) || heightRange < 0) {
    throw new Error("Heightmap height range must be a non-negative finite number.");
  }
  const luminanceAt = (x: number, z: number): number => {
    const offset = (z * width + x) * 4;
    return (0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0)) / 255;
  };
  const samples: number[] = [];
  for (let z = 0; z < target.verticesZ; z += 1) {
    const sourceZ = target.verticesZ <= 1 ? 0 : (z * (height - 1)) / (target.verticesZ - 1);
    const z0 = Math.floor(sourceZ);
    const z1 = Math.min(height - 1, z0 + 1);
    const tz = sourceZ - z0;
    for (let x = 0; x < target.verticesX; x += 1) {
      const sourceX = target.verticesX <= 1 ? 0 : (x * (width - 1)) / (target.verticesX - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = sourceX - x0;
      const top = luminanceAt(x0, z0) + (luminanceAt(x1, z0) - luminanceAt(x0, z0)) * tx;
      const bottom = luminanceAt(x0, z1) + (luminanceAt(x1, z1) - luminanceAt(x0, z1)) * tx;
      samples.push(Math.round((top + (bottom - top) * tz) * heightRange * 1_000_000) / 1_000_000);
    }
  }
  return samples;
}

export interface SplineCorridorSample {
  influence: number;
  /** Interpolation parameter along the winning sub-segment (0 at start, 1 at end). */
  t: number;
  segment: ForgeLandscapeSplineSegment;
  start: LandscapeSplinePolylineSample;
  end: LandscapeSplinePolylineSample;
}

/** Smoothstep corridor influence: 1 inside `halfWidth`, fading to 0 across `falloff`. */
function corridorInfluence(distance: number, halfWidth: number, falloff: number): number {
  if (distance <= halfWidth) return 1;
  if (falloff <= 0 || distance >= halfWidth + falloff) return 0;
  const f = 1 - (distance - halfWidth) / falloff;
  return f * f * (3 - 2 * f);
}

/** Landscape-local reach box of one sub-segment's corridor (centerline + falloff). */
function subSegmentReachBox(sub: LandscapeSplineSubSegment): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  const reach =
    Math.max(0, sub.start.width, sub.end.width) / 2 + Math.max(0, sub.start.falloff, sub.end.falloff);
  const ax = sub.start.position[0];
  const az = sub.start.position[2];
  const bx = sub.end.position[0];
  const bz = sub.end.position[2];
  return {
    minX: Math.min(ax, bx) - reach,
    minZ: Math.min(az, bz) - reach,
    maxX: Math.max(ax, bx) + reach,
    maxZ: Math.max(az, bz) + reach,
  };
}

/** Cap on index buckets, so a huge spline degrades to coarser cells, not to memory. */
const CORRIDOR_INDEX_MAX_BUCKETS = 1 << 18;

/**
 * Uniform-grid index over a spline's resolved sub-segments, so a corridor lookup
 * tests only the pieces that can actually reach the sampled vertex.
 * Coordinates may be landscape-local or world-space; samples and queries must
 * use the same frame. Shared by the legacy and World Terrain apply paths.
 *
 * This exists for cost, not for behaviour: an apply pass walks every vertex in the
 * corridor's bounding box, and scanning all sub-segments at each one made the pass
 * quadratic in network size — a runtime path painter that repaints its whole
 * network on every commit turned a large one into a multi-second freeze. A
 * sub-segment outside its own reach box contributes zero influence and could never
 * win the scan, so restricting candidates to the sampled vertex's bucket returns
 * the identical sample; ties still resolve to the earliest sub-segment because
 * buckets keep insertion (i.e. polyline) order.
 */
export class SplineCorridorIndex {
  private readonly buckets: (LandscapeSplineSubSegment[] | undefined)[];
  private readonly bucketSize: number;
  private readonly gridX: number;
  private readonly gridZ: number;
  private readonly minX: number;
  private readonly minZ: number;
  /** Landscape-local reach box of the whole corridor; null when it is empty. */
  readonly reach: { minX: number; minZ: number; maxX: number; maxZ: number } | null;

  constructor(private readonly subSegments: readonly LandscapeSplineSubSegment[], cellSize: number) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const boxes = subSegments.map((sub) => {
      const box = subSegmentReachBox(sub);
      minX = Math.min(minX, box.minX);
      minZ = Math.min(minZ, box.minZ);
      maxX = Math.max(maxX, box.maxX);
      maxZ = Math.max(maxZ, box.maxZ);
      return box;
    });
    if (boxes.length === 0 || !Number.isFinite(minX) || !Number.isFinite(minZ)) {
      this.reach = null;
      this.buckets = [];
      this.bucketSize = 1;
      this.gridX = 0;
      this.gridZ = 0;
      this.minX = 0;
      this.minZ = 0;
      return;
    }
    this.reach = { minX, minZ, maxX, maxZ };
    this.minX = minX;
    this.minZ = minZ;
    // Grow the cell until the grid fits the bucket cap, so a map-wide corridor
    // stays indexed (coarsely) instead of allocating an unbounded grid.
    let size = Math.max(cellSize, 1e-3);
    let gridX = Math.floor((maxX - minX) / size) + 1;
    let gridZ = Math.floor((maxZ - minZ) / size) + 1;
    while (gridX * gridZ > CORRIDOR_INDEX_MAX_BUCKETS) {
      size *= 2;
      gridX = Math.floor((maxX - minX) / size) + 1;
      gridZ = Math.floor((maxZ - minZ) / size) + 1;
    }
    this.bucketSize = size;
    this.gridX = gridX;
    this.gridZ = gridZ;
    this.buckets = new Array(gridX * gridZ);
    for (const [index, box] of boxes.entries()) {
      const sub = subSegments[index]!;
      const x0 = Math.max(0, Math.floor((box.minX - minX) / size));
      const x1 = Math.min(gridX - 1, Math.floor((box.maxX - minX) / size));
      const z0 = Math.max(0, Math.floor((box.minZ - minZ) / size));
      const z1 = Math.min(gridZ - 1, Math.floor((box.maxZ - minZ) / size));
      for (let z = z0; z <= z1; z += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const key = z * gridX + x;
          const bucket = this.buckets[key];
          if (bucket) bucket.push(sub);
          else this.buckets[key] = [sub];
        }
      }
    }
  }

  get empty(): boolean {
    return this.subSegments.length === 0;
  }

  /**
   * Finds the (sub-)segment whose corridor most strongly covers a landscape-local
   * X/Z (see {@link splineToPolyline}, which lets a smooth spline's corridor follow
   * its curve). Width/falloff interpolate along each sub-segment so a spline can
   * taper between control points.
   */
  sample(localX: number, localZ: number): SplineCorridorSample | null {
    if (!this.reach) return null;
    const bx = Math.floor((localX - this.minX) / this.bucketSize);
    const bz = Math.floor((localZ - this.minZ) / this.bucketSize);
    if (bx < 0 || bz < 0 || bx >= this.gridX || bz >= this.gridZ) return null;
    const candidates = this.buckets[bz * this.gridX + bx];
    if (!candidates) return null;
    let best: SplineCorridorSample | null = null;
    for (const { segment, start, end } of candidates) {
      const ax = start.position[0];
      const az = start.position[2];
      const dx = end.position[0] - ax;
      const dz = end.position[2] - az;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq <= 1e-9 ? 0 : Math.min(1, Math.max(0, ((localX - ax) * dx + (localZ - az) * dz) / lengthSq));
      const closestX = ax + dx * t;
      const closestZ = az + dz * t;
      const distance = Math.hypot(localX - closestX, localZ - closestZ);
      const halfWidth = (start.width + (end.width - start.width) * t) / 2;
      const falloff = start.falloff + (end.falloff - start.falloff) * t;
      const influence = corridorInfluence(distance, halfWidth, falloff);
      if (influence <= 0) continue;
      if (!best || influence > best.influence) best = { influence, t, segment, start, end };
    }
    return best;
  }
}
