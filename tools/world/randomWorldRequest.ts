/**
 * The editor's World Builder window asks the dev server for a random world
 * (`/__world-random`, RANDOM_WORLD_PLAN step 5). This is the request's
 * allowlist: every choice must be one the generator knows, and the level must
 * be a `.level.json` under `assets/` (generated levels live with the assets, so
 * the Content Browser shows them). Unknown fields reject the request.
 *
 * Pure; the dev server and `build-random-world.mjs --request` both run it.
 */
import { COVER_DENSITY_LEVELS } from "../../engine/worldbuilder/worldBrief";
import { MAX_RANDOM_WATER } from "../../engine/worldbuilder/randomWater";
import {
  COVERS,
  LANDFORMS,
  MOUNTAIN_HEIGHTS,
  ROAD_NETWORKS,
  SETTLEMENT_TYPES,
  WORLD_SIZES,
  type RandomWorldOptions,
} from "../../engine/worldbuilder/randomWorld";

/** Most settlements the window may ask for. */
export const MAX_RANDOM_SETTLEMENTS = 8;

export type RandomWorldChoices = Omit<RandomWorldOptions, "id" | "name" | "regionProfile" | "models">;

export interface RandomWorldRequest {
  /** Public-root-relative `assets/…/<Name>.level.json`. */
  out: string;
  /** Replace an existing level (and its brief). */
  force: boolean;
  world: RandomWorldChoices;
}

const WORLD_KEYS = ["seed", "size", "landform", "mountainHeight", "settlements", "roads", "rivers", "lakes", "cover", "densities"];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new Error(`${label}: unknown field(s) ${unknown.join(", ")}`);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function count(value: unknown, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} must be a whole number 0–${max}`);
  return value;
}

/** A public-root-relative level path under `assets/`, with plain folder and file names. */
export function validateRandomWorldLevelPath(value: unknown): string {
  if (typeof value !== "string") throw new Error("out must be a path");
  const path = value.replace(/\\/g, "/");
  const parts = path.split("/");
  if (parts[0] !== "assets" || parts.length < 2) throw new Error(`out must be under assets/: ${value}`);
  for (const part of parts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(part) || part.endsWith(".") || part.endsWith(" ")) {
      throw new Error(`out has an unusable folder or file name "${part}": letters, digits, space, _ . - only`);
    }
  }
  const file = parts[parts.length - 1]!;
  if (!/\.level\.json$/i.test(file) || file.length <= ".level.json".length) throw new Error(`out must be a .level.json file: ${value}`);
  return path;
}

export function validateRandomWorldRequest(body: unknown): RandomWorldRequest {
  const input = record(body, "request");
  onlyKeys(input, ["out", "force", "world"], "request");
  const out = validateRandomWorldLevelPath(input.out);
  if (input.force !== undefined && typeof input.force !== "boolean") throw new Error("force must be true or false");
  const world = record(input.world, "world");
  onlyKeys(world, WORLD_KEYS, "world");
  const seed = world.seed;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("world.seed must be a whole number 0–4294967295");
  if (!Array.isArray(world.settlements) || world.settlements.length > MAX_RANDOM_SETTLEMENTS) {
    throw new Error(`world.settlements must be a list of at most ${MAX_RANDOM_SETTLEMENTS}`);
  }
  const settlements = world.settlements.map((entry, index) => {
    const settlement = record(entry, `world.settlements[${index}]`);
    onlyKeys(settlement, ["type"], `world.settlements[${index}]`);
    return { type: oneOf(settlement.type, Object.keys(SETTLEMENT_TYPES) as Array<keyof typeof SETTLEMENT_TYPES>, `world.settlements[${index}].type`) };
  });
  const densities = world.densities === undefined ? {} : record(world.densities, "world.densities");
  onlyKeys(densities, ["forest", "rocks", "fields"], "world.densities");
  return {
    out,
    force: input.force === true,
    world: {
      seed,
      size: oneOf(world.size, Object.keys(WORLD_SIZES) as Array<keyof typeof WORLD_SIZES>, "world.size"),
      landform: oneOf(world.landform, LANDFORMS, "world.landform"),
      mountainHeight: oneOf(world.mountainHeight, MOUNTAIN_HEIGHTS, "world.mountainHeight"),
      settlements,
      roads: oneOf(world.roads, ROAD_NETWORKS, "world.roads"),
      rivers: count(world.rivers ?? 0, MAX_RANDOM_WATER, "world.rivers"),
      lakes: count(world.lakes ?? 0, MAX_RANDOM_WATER, "world.lakes"),
      cover: oneOf(world.cover, Object.keys(COVERS) as Array<keyof typeof COVERS>, "world.cover"),
      densities: Object.fromEntries(
        Object.entries(densities).map(([key, level]) => [key, oneOf(level, COVER_DENSITY_LEVELS, `world.densities.${key}`)]),
      ),
    },
  };
}
