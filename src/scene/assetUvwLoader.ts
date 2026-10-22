/**
 * Asset-level UVW projection sidecars (`*.uvw.json`).
 *
 * This is intentionally not an unwrap system: it projects UV coordinates from
 * mesh vertex positions using a simple planar/box/sphere/cylinder gizmo
 * transform, similar to a quick UVW Map modifier.
 */
import {
  BufferAttribute,
  Euler,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  RepeatWrapping,
  Texture,
  Vector3,
} from "three";
import type { BufferGeometry, Material, Object3D } from "three";

import type { Vec3 } from "@engine/scene/layout";
import { readOptionalSidecar } from "@/project/contentLoader";
import { ContentLoadError, requireSidecar, requireVec3 } from "@engine/assets/contentValidation";

export const UVW_MAP_TYPES = ["planar", "box", "sphere", "cylinder"] as const;
export type UvwMapType = (typeof UVW_MAP_TYPES)[number];

export interface AssetUvwDef {
  schema: 1;
  mapType: UvwMapType | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

type GeometryWithOriginalUv = BufferGeometry & {
  userData: BufferGeometry["userData"] & {
    forgeOriginalUv?: Float32Array | null;
  };
};

const scratchPosition = new Vector3();
const scratchNormal = new Vector3();
const scratchMapped = new Vector3();

export function uvwSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  return `${withoutExt}.uvw.json`;
}

export function defaultAssetUvw(): AssetUvwDef {
  return {
    schema: 1,
    mapType: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

export async function loadAssetUvw(modelPath: string): Promise<AssetUvwDef> {
  return readOptionalSidecar(uvwSidecarPath(modelPath), normalizeAssetUvw, defaultAssetUvw, (raw, path) => {
    const input = requireSidecar(raw, path);
    if (input.mapType !== undefined && input.mapType !== null && !UVW_MAP_TYPES.includes(input.mapType as UvwMapType)) {
      throw new ContentLoadError(`${path}.mapType`, "invalid-data", "unknown UVW map type");
    }
    for (const key of ["position", "rotation", "scale"]) {
      if (input[key] !== undefined) requireVec3(input[key], `${path}.${key}`);
    }
  });
}

export function normalizeAssetUvw(value: unknown): AssetUvwDef {
  if (!value || typeof value !== "object") return defaultAssetUvw();
  const input = value as Record<string, unknown>;
  const mapType = UVW_MAP_TYPES.includes(input.mapType as UvwMapType)
    ? (input.mapType as UvwMapType)
    : null;
  return {
    schema: 1,
    mapType,
    position: normalizeVec3(input.position, [0, 0, 0]),
    rotation: normalizeVec3(input.rotation, [0, 0, 0]),
    scale: normalizeVec3(input.scale, [1, 1, 1]).map((axis) =>
      Math.max(Math.abs(axis), 0.001),
    ) as Vec3,
  };
}

export function applyAssetUvwMapping(root: Object3D, def: AssetUvwDef): void {
  const uvw = normalizeAssetUvw(def);
  if (!uvw.mapType) {
    restoreAssetUvs(root);
    return;
  }
  const mapType = uvw.mapType;

  root.updateMatrixWorld(true);
  const rootToAsset = root.matrixWorld.clone().invert();
  const uvwMatrix = composeUvwMatrix(uvw).invert();
  const uvwRotation = new Quaternion().setFromEuler(
    new Euler(degToRad(uvw.rotation[0]), degToRad(uvw.rotation[1]), degToRad(uvw.rotation[2]), "XYZ"),
  );
  const inverseUvwRotation = uvwRotation.invert();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as GeometryWithOriginalUv;
    const position = geometry.getAttribute("position");
    if (!position) return;
    rememberOriginalUv(geometry);

    const sourceToAsset = rootToAsset.clone().multiply(object.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(sourceToAsset);
    const normals = geometry.getAttribute("normal");
    const uv = ensureUvAttribute(geometry, position.count);

    for (let index = 0; index < position.count; index += 1) {
      scratchPosition.fromBufferAttribute(position, index).applyMatrix4(sourceToAsset);
      scratchMapped.copy(scratchPosition).applyMatrix4(uvwMatrix);

      if (normals) {
        scratchNormal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix);
      } else {
        scratchNormal.copy(scratchMapped);
      }
      scratchNormal.applyQuaternion(inverseUvwRotation).normalize();

      const [u, v] = projectMappedUv(mapType, scratchMapped, scratchNormal);
      uv.setXY(index, u, v);
    }

    uv.needsUpdate = true;
    setMaterialTexturesToRepeat(object.material);
  });
}

export function restoreAssetUvs(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as GeometryWithOriginalUv;
    if (!("forgeOriginalUv" in geometry.userData)) return;
    const original = geometry.userData.forgeOriginalUv;
    if (original) {
      geometry.setAttribute("uv", new BufferAttribute(original.slice(), 2));
      geometry.getAttribute("uv").needsUpdate = true;
    } else {
      geometry.deleteAttribute("uv");
    }
  });
}

function normalizeVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((axis) => Number.isFinite(axis))
  ) {
    return [...fallback] as Vec3;
  }
  return value.map((axis) => Number(Number(axis).toFixed(4))) as Vec3;
}

function composeUvwMatrix(uvw: AssetUvwDef): Matrix4 {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(degToRad(uvw.rotation[0]), degToRad(uvw.rotation[1]), degToRad(uvw.rotation[2]), "XYZ"),
  );
  return new Matrix4().compose(
    new Vector3(uvw.position[0], uvw.position[1], uvw.position[2]),
    quaternion,
    new Vector3(
      Math.max(uvw.scale[0], 0.001),
      Math.max(uvw.scale[1], 0.001),
      Math.max(uvw.scale[2], 0.001),
    ),
  );
}

function projectMappedUv(type: UvwMapType, point: Vector3, normal: Vector3): [number, number] {
  if (type === "sphere") {
    const radius = Math.max(point.length(), 1e-6);
    return [
      0.5 + Math.atan2(point.z, point.x) / (Math.PI * 2),
      Math.acos(clamp(point.y / radius, -1, 1)) / Math.PI,
    ];
  }
  if (type === "cylinder") {
    return [0.5 + Math.atan2(point.z, point.x) / (Math.PI * 2), point.y + 0.5];
  }
  if (type === "box") {
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    if (ay >= ax && ay >= az) return [point.x + 0.5, point.z + 0.5];
    if (ax >= az) return [point.z + 0.5, point.y + 0.5];
    return [point.x + 0.5, point.y + 0.5];
  }
  return [point.x + 0.5, point.z + 0.5];
}

function rememberOriginalUv(geometry: GeometryWithOriginalUv): void {
  if ("forgeOriginalUv" in geometry.userData) return;
  const uv = geometry.getAttribute("uv");
  geometry.userData.forgeOriginalUv = uv
    ? new Float32Array((uv.array as ArrayLike<number>))
    : null;
}

function ensureUvAttribute(geometry: BufferGeometry, count: number): BufferAttribute {
  const existing = geometry.getAttribute("uv");
  if (existing instanceof BufferAttribute && existing.count === count) return existing;
  const uv = new BufferAttribute(new Float32Array(count * 2), 2);
  geometry.setAttribute("uv", uv);
  return uv;
}

function setMaterialTexturesToRepeat(material: Material | Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap", "aoMap"]) {
      const texture = (item as unknown as Record<string, unknown>)[key];
      if (!(texture instanceof Texture)) continue;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.needsUpdate = true;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
