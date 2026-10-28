import type { Vec3 } from "./layout";

/** Authored waterline proxy, independent of collision and legacy foam stamps.
 * Positions follow the owning body's coordinate space. No automatic mesh scan. */
export interface WaterFoamObstacle {
  id: string;
  hidden?: boolean;
  kind: "ellipse" | "capsule";
  position: Vec3;
  radii: [number, number];
  rotation: number;
  halfHeight: number;
  width: number;
  strength: number;
  wakeLength: number;
}
export interface WaterContactFoam {
  enabled: boolean;
  shoreWidth: number;
  scale: number;
  speed: number;
  obstacles: WaterFoamObstacle[];
}
export const WATER_CONTACT_FOAM_LIMIT = 16;
export function defaultWaterContactFoam(): WaterContactFoam {
  return { enabled: false, shoreWidth: 0.6, scale: 0.8, speed: 0.3, obstacles: [] };
}
/** Shared runtime/save allowlist. Never silently truncate an over-budget list. */
export function validateWaterContactFoam(value: unknown): WaterContactFoam {
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid contact foam object");
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, min: number, max: number): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("Invalid contact foam number");
    return v;
  };
  const v = record(value);
  if (typeof v.enabled !== "boolean" || !Array.isArray(v.obstacles) || v.obstacles.length > WATER_CONTACT_FOAM_LIMIT) throw new Error("Invalid contact foam settings/budget");
  const ids = new Set<string>();
  return { enabled: v.enabled, shoreWidth: number(v.shoreWidth, 0.2, 4), scale: number(v.scale, 0.1, 10), speed: number(v.speed, 0, 3),
    obstacles: v.obstacles.map(entry => {
      const o = record(entry);
      if (typeof o.id !== "string" || !o.id.trim() || o.id.length > 128 || ids.has(o.id)) throw new Error("Invalid contact foam obstacle id");
      ids.add(o.id);
      if (o.kind !== "ellipse" && o.kind !== "capsule") throw new Error("Invalid contact foam shape");
      if (!Array.isArray(o.position) || o.position.length !== 3 || !Array.isArray(o.radii) || o.radii.length !== 2) throw new Error("Invalid contact foam coordinates");
      if (o.hidden !== undefined && typeof o.hidden !== "boolean") throw new Error("Invalid contact foam visibility");
      return { id: o.id, kind: o.kind, ...(o.hidden !== undefined ? { hidden: o.hidden } : {}),
        position: o.position.map(n => number(n, -1e9, 1e9)) as Vec3,
        radii: o.radii.map(n => number(n, 0.05, 100)) as [number, number],
        rotation: number(o.rotation, -360, 360), halfHeight: number(o.halfHeight, 0.05, 100),
        width: number(o.width, 0.1, 4), strength: number(o.strength, 0, 1), wakeLength: number(o.wakeLength, 0, 30) };
    }) };
}
