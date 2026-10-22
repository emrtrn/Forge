/**
 * Loads asset-level collision definitions (`*.collision.json` sidecars). Reads
 * are plain static fetches of `public/`, so this module is safe for both the
 * game runtime and the editor (no dev-server / editor dependency). Writing the
 * sidecars lives in the editor-only `assetCollisionStore`.
 */
import {
  COLLISION_COMPLEXITY_VALUES,
  COLLISION_PRESET_IDS,
  COLLISION_PRIMITIVE_SHAPES,
  COLLISION_RESPONSE_VALUES,
  COLLISION_CHANNELS,
  NAVIGATION_ROLE_VALUES,
  defaultAssetCollisionDef,
  type AssetCollisionDef,
  type CollisionChannel,
  type CollisionComplexity,
  type CollisionPresetId,
  type CollisionPrimitive,
  type CollisionPrimitiveShape,
  type CollisionResponse,
  type CollisionResponseMap,
  type NavigationRole,
} from "@engine/scene/collision";
import type { Vec3 } from "@engine/scene/layout";
import { readOptionalSidecar } from "@/project/contentLoader";
import { ContentLoadError, requireSidecar, requireVec3 } from "@engine/assets/contentValidation";

/** Maps a model file path to its collision sidecar path. */
export function collisionSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  return `${withoutExt}.collision.json`;
}

/**
 * Missing optional sidecars use defaults silently; damaged/unreachable content
 * uses defaults with a classified, deduplicated warning containing its path.
 */
export async function loadAssetCollision(modelPath: string): Promise<AssetCollisionDef> {
  return readOptionalSidecar(collisionSidecarPath(modelPath), normalizeAssetCollisionDef,
    defaultAssetCollisionDef, (raw, path) => {
      const input = requireSidecar(raw, path, ["primitives"], ["responses"]);
      for (const [key, values] of [
        ["complexity", COLLISION_COMPLEXITY_VALUES], ["preset", COLLISION_PRESET_IDS],
        ["navigationRole", NAVIGATION_ROLE_VALUES],
      ] as const) {
        if (input[key] !== undefined && !(values as readonly unknown[]).includes(input[key])) {
          throw new ContentLoadError(`${path}.${key}`, "invalid-data", `unknown ${key}`);
        }
      }
      (input.primitives as Record<string, unknown>[] | undefined)?.forEach((primitive, i) => {
        const at = `${path}.primitives[${i}]`;
        if (!COLLISION_PRIMITIVE_SHAPES.includes(primitive.shape as CollisionPrimitiveShape)) {
          throw new ContentLoadError(`${at}.shape`, "invalid-data", "unknown collision shape");
        }
        requireVec3(primitive.size, `${at}.size`);
        for (const key of ["center", "rotation"]) if (primitive[key] !== undefined) requireVec3(primitive[key], `${at}.${key}`);
      });
    });
}

function asVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
  return [x, y, z];
}

function normalizePrimitive(value: unknown): CollisionPrimitive | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!COLLISION_PRIMITIVE_SHAPES.includes(input.shape as CollisionPrimitiveShape)) return null;
  const size = asVec3(input.size);
  if (!size) return null;
  const primitive: CollisionPrimitive = { shape: input.shape as CollisionPrimitiveShape, size };
  const center = asVec3(input.center);
  if (center) primitive.center = center;
  const rotation = asVec3(input.rotation);
  if (rotation) primitive.rotation = rotation;
  if (Array.isArray(input.points)) {
    const points = input.points.map(asVec3).filter((point): point is Vec3 => point !== undefined);
    if (points.length > 0) primitive.points = points;
  }
  return primitive;
}

function normalizeResponses(value: unknown): CollisionResponseMap | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const responses: CollisionResponseMap = {};
  for (const channel of COLLISION_CHANNELS) {
    const response = input[channel];
    if (COLLISION_RESPONSE_VALUES.includes(response as CollisionResponse)) {
      responses[channel as CollisionChannel] = response as CollisionResponse;
    }
  }
  return Object.keys(responses).length > 0 ? responses : undefined;
}

/** Coerces arbitrary parsed JSON into a valid `AssetCollisionDef`. */
export function normalizeAssetCollisionDef(value: unknown): AssetCollisionDef {
  const def = defaultAssetCollisionDef();
  if (!value || typeof value !== "object") return def;
  const input = value as Record<string, unknown>;
  if (COLLISION_COMPLEXITY_VALUES.includes(input.complexity as CollisionComplexity)) {
    def.complexity = input.complexity as CollisionComplexity;
  }
  if (COLLISION_PRESET_IDS.includes(input.preset as CollisionPresetId)) {
    def.preset = input.preset as CollisionPresetId;
  }
  if (Array.isArray(input.primitives)) {
    def.primitives = input.primitives
      .map(normalizePrimitive)
      .filter((primitive): primitive is CollisionPrimitive => primitive !== null);
  }
  if (
    NAVIGATION_ROLE_VALUES.includes(input.navigationRole as NavigationRole) &&
    input.navigationRole !== "auto"
  ) {
    def.navigationRole = input.navigationRole as NavigationRole;
  }
  const responses = normalizeResponses(input.responses);
  if (responses) def.responses = responses;
  if (typeof input.physicalMaterialId === "string" && input.physicalMaterialId.length > 0) {
    def.physicalMaterialId = input.physicalMaterialId;
  }
  if (input.doubleSided === true) def.doubleSided = true;
  if (input.generateOverlapEvents === false) def.generateOverlapEvents = false;
  if (input.simulationGeneratesHitEvents === false) def.simulationGeneratesHitEvents = false;
  return def;
}
