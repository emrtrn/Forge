/** Shared spline allowlist for legacy Landscape and World Terrain documents. */
function isNumberTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function validateOptionalNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Number(number.toFixed(3));
}

function validateLandscapeSplineVec3(value: unknown, path: string): [number, number, number] {
  if (!isNumberTuple(value)) throw new Error(`${path} must be a finite [x, y, z] tuple`);
  return value.map((component) => Number(Number(component).toFixed(3))) as [number, number, number];
}

export function validateLandscapeSplines(value: unknown): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("landscape.splines must be an array");
  if (value.length > 64) throw new Error("landscape data supports at most 64 splines");

  const splineIds = new Set<string>();
  return value.map((rawSpline, splineIndex) => {
    const path = `landscape.splines[${splineIndex}]`;
    if (!rawSpline || typeof rawSpline !== "object" || Array.isArray(rawSpline)) {
      throw new Error(`${path} must be an object`);
    }
    const spline = rawSpline as Record<string, unknown>;
    if (typeof spline.id !== "string" || spline.id.length === 0 || splineIds.has(spline.id)) {
      throw new Error(`${path}.id must be a unique string`);
    }
    splineIds.add(spline.id);
    if (!Array.isArray(spline.points) || spline.points.length > 256) {
      throw new Error(`${path}.points must contain at most 256 points`);
    }
    const pointIds = new Set<string>();
    const points = spline.points.map((rawPoint, pointIndex) => {
      const pointPath = `${path}.points[${pointIndex}]`;
      if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) throw new Error(`${pointPath} must be an object`);
      const point = rawPoint as Record<string, unknown>;
      if (typeof point.id !== "string" || point.id.length === 0 || pointIds.has(point.id)) {
        throw new Error(`${pointPath}.id must be a unique string`);
      }
      pointIds.add(point.id);
      const width = validateOptionalNumber(point.width, `${pointPath}.width`, 0.1, 10000);
      const falloff = validateOptionalNumber(point.falloff, `${pointPath}.falloff`, 0, 10000);
      if (width === undefined || falloff === undefined) throw new Error(`${pointPath}.width and falloff are required`);
      const result: Record<string, unknown> = { id: point.id, position: validateLandscapeSplineVec3(point.position, `${pointPath}.position`), width, falloff };
      if (point.arriveTangent !== undefined) result.arriveTangent = validateLandscapeSplineVec3(point.arriveTangent, `${pointPath}.arriveTangent`);
      if (point.leaveTangent !== undefined) result.leaveTangent = validateLandscapeSplineVec3(point.leaveTangent, `${pointPath}.leaveTangent`);
      return result;
    });
    if (!Array.isArray(spline.segments) || spline.segments.length > 512) throw new Error(`${path}.segments must contain at most 512 segments`);
    const segmentIds = new Set<string>();
    const segments = spline.segments.map((rawSegment, segmentIndex) => {
      const segmentPath = `${path}.segments[${segmentIndex}]`;
      if (!rawSegment || typeof rawSegment !== "object" || Array.isArray(rawSegment)) throw new Error(`${segmentPath} must be an object`);
      const segment = rawSegment as Record<string, unknown>;
      if (typeof segment.id !== "string" || segment.id.length === 0 || segmentIds.has(segment.id)) throw new Error(`${segmentPath}.id must be a unique string`);
      if (typeof segment.startPointId !== "string" || !pointIds.has(segment.startPointId) || typeof segment.endPointId !== "string" || !pointIds.has(segment.endPointId) || segment.startPointId === segment.endPointId) {
        throw new Error(`${segmentPath} must reference two different points in its spline`);
      }
      segmentIds.add(segment.id);
      const result: Record<string, unknown> = { id: segment.id, startPointId: segment.startPointId, endPointId: segment.endPointId };
      if (segment.deform !== undefined) {
        if (!segment.deform || typeof segment.deform !== "object" || Array.isArray(segment.deform)) throw new Error(`${segmentPath}.deform must be an object`);
        const deform = segment.deform as Record<string, unknown>;
        if (![deform.enabled, deform.raiseTerrain, deform.lowerTerrain, deform.flatten].every((entry) => typeof entry === "boolean")) throw new Error(`${segmentPath}.deform flags must be booleans`);
        const targetOffset = validateOptionalNumber(deform.targetOffset, `${segmentPath}.deform.targetOffset`, -10000, 10000);
        result.deform = { enabled: deform.enabled, raiseTerrain: deform.raiseTerrain, lowerTerrain: deform.lowerTerrain, flatten: deform.flatten, ...(targetOffset === undefined ? {} : { targetOffset }) };
      }
      if (segment.paint !== undefined) {
        if (!segment.paint || typeof segment.paint !== "object" || Array.isArray(segment.paint)) throw new Error(`${segmentPath}.paint must be an object`);
        const paint = segment.paint as Record<string, unknown>;
        if (typeof paint.enabled !== "boolean" || typeof paint.layerId !== "string" || paint.layerId.length === 0) throw new Error(`${segmentPath}.paint requires enabled and layerId`);
        const strength = validateOptionalNumber(paint.strength, `${segmentPath}.paint.strength`, 0, 1);
        if (strength === undefined) throw new Error(`${segmentPath}.paint.strength is required`);
        result.paint = { enabled: paint.enabled, layerId: paint.layerId, strength };
      }
      if (segment.mesh !== undefined) {
        if (!segment.mesh || typeof segment.mesh !== "object" || Array.isArray(segment.mesh)) throw new Error(`${segmentPath}.mesh must be an object`);
        const mesh = segment.mesh as Record<string, unknown>;
        if (typeof mesh.enabled !== "boolean" || typeof mesh.assetId !== "string" || mesh.assetId.length === 0) throw new Error(`${segmentPath}.mesh requires enabled and assetId`);
        const spacing = validateOptionalNumber(mesh.spacing, `${segmentPath}.mesh.spacing`, 0.01, 10000);
        const meshResult: Record<string, unknown> = { enabled: mesh.enabled, assetId: mesh.assetId };
        if (spacing !== undefined) meshResult.spacing = spacing;
        const yawOffset = validateOptionalNumber(mesh.yawOffset, `${segmentPath}.mesh.yawOffset`, -360, 360);
        if (yawOffset !== undefined) meshResult.yawOffset = yawOffset;
        if (mesh.fitToLength !== undefined) {
          if (typeof mesh.fitToLength !== "boolean") throw new Error(`${segmentPath}.mesh.fitToLength must be a boolean`);
          meshResult.fitToLength = mesh.fitToLength;
        }
        if (mesh.scale !== undefined) meshResult.scale = validateLandscapeSplineVec3(mesh.scale, `${segmentPath}.mesh.scale`);
        if (mesh.offset !== undefined) meshResult.offset = validateLandscapeSplineVec3(mesh.offset, `${segmentPath}.mesh.offset`);
        if (mesh.alignToTerrain !== undefined) {
          if (typeof mesh.alignToTerrain !== "boolean") throw new Error(`${segmentPath}.mesh.alignToTerrain must be a boolean`);
          meshResult.alignToTerrain = mesh.alignToTerrain;
        }
        const bank = validateOptionalNumber(mesh.bank, `${segmentPath}.mesh.bank`, -360, 360);
        if (bank !== undefined) meshResult.bank = bank;
        if (mesh.deform !== undefined) {
          if (typeof mesh.deform !== "boolean") throw new Error(`${segmentPath}.mesh.deform must be a boolean`);
          meshResult.deform = mesh.deform;
        }
        if (mesh.collision !== undefined) {
          if (typeof mesh.collision !== "boolean") throw new Error(`${segmentPath}.mesh.collision must be a boolean`);
          meshResult.collision = mesh.collision;
        }
        result.mesh = meshResult;
      }
      return result;
    });
    const result: Record<string, unknown> = { id: spline.id, points, segments };
    if (typeof spline.name === "string" && spline.name.length > 0) result.name = spline.name;
    if (typeof spline.hidden === "boolean") result.hidden = spline.hidden;
    if (typeof spline.locked === "boolean") result.locked = spline.locked;
    if (typeof spline.smooth === "boolean") result.smooth = spline.smooth;
    const smoothness = validateOptionalNumber(spline.smoothness, `${path}.smoothness`, 0, 1);
    if (smoothness !== undefined) result.smoothness = smoothness;
    return result;
  });
}

