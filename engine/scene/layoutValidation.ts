import type { RoomLayout } from "./layout";
import {
  ContentLoadError, isFiniteNumber, requireArray, requireRecord,
  requireString, requireVec3, requireVersion,
} from "../assets/contentValidation";

/** Structural read guard; retains extension fields and legacy transform forms. */
export function readRoomLayout(value: unknown, path: string): RoomLayout {
  const input = requireRecord(value, path);
  requireVersion(input.schema, 1, `${path}.schema`);
  requireString(input.name, `${path}.name`);
  requireArray(input.loadGroups, `${path}.loadGroups`).forEach((group, i) =>
    requireString(group, `${path}.loadGroups[${i}]`));
  const instances = requireArray(input.instances, `${path}.instances`);
  const characters = requireArray(input.characters, `${path}.characters`);
  instances.forEach((value, i) => {
    const at = `${path}.instances[${i}]`;
    const group = requireRecord(value, at);
    requireString(group.assetId, `${at}.assetId`);
    requireArray(group.placements, `${at}.placements`).forEach((placement, j) =>
      readTransform(placement, `${at}.placements[${j}]`));
  });
  characters.forEach((value, i) => {
    const at = `${path}.characters[${i}]`;
    requireString(readTransform(value, at).assetId, `${at}.assetId`);
  });
  const collections = ["actors", "lights", "reflectionPlanes", "reflectiveSurfaces", "reflectionCaptures",
    "blockingVolumes", "aiNavigationVolumes", "targetPoints", "splines", "landscapes", "riverWaters"] as const;
  for (const key of collections) {
    if (input[key] === undefined) continue;
    const ids = new Set<string>();
    requireArray(input[key], `${path}.${key}`).forEach((value, i) => {
      const at = `${path}.${key}[${i}]`;
      // River bodies inherit their frame from a Landscape/spline; they have no position field.
      const item = key === "riverWaters" ? requireRecord(value, at) : readTransform(value, at);
      const id = requireString(item[key === "actors" ? "classRef" : "id"], `${at}.${key === "actors" ? "classRef" : "id"}`);
      if (key !== "actors") {
        if (ids.has(id)) throw new ContentLoadError(at, "invalid-data", `duplicate id ${id}`);
        ids.add(id);
      }
      if (key === "landscapes") requireString(item.dataRef, `${at}.dataRef`);
      if (key === "riverWaters") {
        requireString(item.landscapeRef, `${at}.landscapeRef`);
        requireString(item.splineRef, `${at}.splineRef`);
      }
      if (key === "lights" && !["directional", "point", "spot"].includes(String(item.type))) {
        throw new ContentLoadError(`${at}.type`, "invalid-data", "unknown light type");
      }
      if (key === "splines") {
        const spline = requireRecord(item.spline, `${at}.spline`);
        requireVersion(spline.schema, 1, `${at}.spline.schema`);
        requireArray(spline.points, `${at}.spline.points`).forEach((point, j) => {
          const pointPath = `${at}.spline.points[${j}]`;
          requireVec3(requireRecord(point, pointPath).position, `${pointPath}.position`);
        });
      }
    });
  }
  for (const key of ["worldSettings", "skyAtmosphere", "heightFog", "cloudLayer", "reflection", "postProcess"]) {
    if (input[key] !== undefined) requireRecord(input[key], `${path}.${key}`);
  }
  if (input.worldWidgets !== undefined) {
    requireArray(input.worldWidgets, `${path}.worldWidgets`).forEach((widget, i) =>
      requireRecord(widget, `${path}.worldWidgets[${i}]`));
  }
  // This guard protects document structure and transforms. Feature-specific
  // enums/defaults remain the responsibility of their existing normalizers.
  return input as unknown as RoomLayout;
}

function readTransform(value: unknown, path: string): Record<string, unknown> {
  const item = requireRecord(value, path);
  requireVec3(item.position, `${path}.position`);
  for (const key of ["rotation", "pivot", "size"]) {
    if (item[key] !== undefined) requireVec3(item[key], `${path}.${key}`);
  }
  if (item.rotationYDeg !== undefined && !isFiniteNumber(item.rotationYDeg)) {
    throw new ContentLoadError(`${path}.rotationYDeg`, "invalid-data", "expected a finite number");
  }
  if (item.scale !== undefined && !isFiniteNumber(item.scale)) requireVec3(item.scale, `${path}.scale`);
  return item;
}
