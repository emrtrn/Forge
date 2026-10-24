import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Object3D,
  PointLight,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { ColorRepresentation } from "three";

import type { Entity } from "@engine/scene/entity";
import { readLightComponent, readTransformComponent } from "@engine/scene/components";
import type { SceneLightType } from "@engine/scene/components";
import type { LayoutLightActor, Vec3 } from "@engine/scene/layout";
import { defaultLightIntensity } from "@engine/scene/lights";
import { degreesToRadians, readRotation } from "@engine/scene/transform";
import { applyEulerDegrees } from "./transforms";

const lightIconTextures = new Map<SceneLightType, CanvasTexture>();
const lightIconMaterials = new Map<SceneLightType, SpriteMaterial>();

export type ThreeLight = DirectionalLight | PointLight | SpotLight;

/**
 * Normalized light render input, decoupled from the layout format. Carries the
 * resolved display name plus every actor field the Three.js light binding reads
 * (`createLightObject`/`syncLightObject`/`buildLightGizmo` apply the same
 * defaults whether the source is a placement or a scene entity).
 */
export interface LightRenderItem {
  name: string;
  type: SceneLightType;
  position: Vec3;
  /** XYZ-order Euler rotation in degrees. */
  rotation: Vec3;
  hidden: boolean;
  color?: string;
  intensity?: number;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

/** Legacy builder: derives a light render item straight from a layout actor. */
export function actorLightItem(actor: LayoutLightActor): LightRenderItem {
  const item: LightRenderItem = {
    name: actor.name ?? actor.id,
    type: actor.type,
    position: [actor.position[0], actor.position[1], actor.position[2]],
    rotation: readRotation(actor),
    hidden: actor.hidden ?? false,
  };
  if (actor.color !== undefined) item.color = actor.color;
  if (actor.intensity !== undefined) item.intensity = actor.intensity;
  if (actor.castShadow !== undefined) item.castShadow = actor.castShadow;
  if (actor.distance !== undefined) item.distance = actor.distance;
  if (actor.angle !== undefined) item.angle = actor.angle;
  if (actor.penumbra !== undefined) item.penumbra = actor.penumbra;
  if (actor.decay !== undefined) item.decay = actor.decay;
  return item;
}

/**
 * Entity-driven builder: derives a light render item from a scene entity's
 * transform/light components and the `hidden` tag. Produces the same item as
 * `actorLightItem` because the adapter fills those components from the same
 * actor fields and resolves the display name into `entity.name`.
 */
export function entityLightItem(entity: Entity): LightRenderItem {
  const transform = readTransformComponent(entity);
  const light = readLightComponent(entity);
  const item: LightRenderItem = {
    name: entity.name ?? "Light",
    type: light?.type ?? "directional",
    position: transform ? [...transform.position] : [0, 0, 0],
    rotation: transform ? [...transform.rotation] : [0, 0, 0],
    hidden: entity.tags?.includes("hidden") ?? false,
  };
  if (light?.color !== undefined) item.color = light.color;
  if (light?.intensity !== undefined) item.intensity = light.intensity;
  if (light?.castShadow !== undefined) item.castShadow = light.castShadow;
  if (light?.distance !== undefined) item.distance = light.distance;
  if (light?.angle !== undefined) item.angle = light.angle;
  if (light?.penumbra !== undefined) item.penumbra = light.penumbra;
  if (light?.decay !== undefined) item.decay = light.decay;
  return item;
}

export interface LightObjectRecord {
  root: Object3D;
  light: ThreeLight;
  target?: Object3D;
  /** Wireframe representation (cone/sphere) + clickable icon; rebuilt on change. */
  gizmo: Object3D;
}

export function configureShadowCastingLight(
  light: DirectionalLight | PointLight | SpotLight,
): void {
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  if (light instanceof DirectionalLight) {
    const shadowCam = light.shadow.camera;
    shadowCam.near = 0.5;
    shadowCam.far = 60;
    shadowCam.left = -12;
    shadowCam.right = 12;
    shadowCam.top = 12;
    shadowCam.bottom = -12;
  }
}

/**
 * Apply an item's transform to a light record: root position/rotation/visibility
 * plus the directional/spot target placement (a directional light is lit by the
 * vector from its world position to its target, so the target must be positioned
 * or the light contributes no direction at all). Shared by `createLightObject`
 * and `syncLightObject` so a light is correctly aimed the moment it is built —
 * the runtime shell never calls `syncLightObject`, so creation must stand alone.
 */
function applyLightTransform(record: LightObjectRecord, item: LightRenderItem): void {
  record.root.position.set(...item.position);
  applyEulerDegrees(record.root, item.rotation);
  record.root.visible = !item.hidden;
  if (record.target) {
    const [rx, ry, rz] = item.rotation.map(degreesToRadians) as [number, number, number];
    const direction = new Vector3(0, 0, -1)
      .applyEuler(new Euler(rx, ry, rz))
      .normalize();
    record.target.position.copy(record.root.position).add(direction);
    record.target.updateMatrixWorld();
  }
}

export function createLightObject(
  item: LightRenderItem,
  defaultColor: ColorRepresentation,
  options: { gizmo?: boolean } = {},
): LightObjectRecord {
  const root = new Object3D();
  root.name = item.name;
  const color = new Color(item.color ?? defaultColor);
  const intensity = item.intensity ?? defaultLightIntensity(item.type);

  let light: ThreeLight;
  let target: Object3D | undefined;
  if (item.type === "point") {
    light = new PointLight(color, intensity, item.distance ?? 8, item.decay ?? 2);
  } else if (item.type === "spot") {
    light = new SpotLight(
      color,
      intensity,
      item.distance ?? 10,
      degreesToRadians(item.angle ?? 30),
      item.penumbra ?? 0.35,
      item.decay ?? 2,
    );
    target = light.target;
  } else {
    light = new DirectionalLight(color, intensity);
    target = light.target;
  }

  light.name = `${root.name} Light`;
  light.castShadow = item.castShadow ?? item.type === "directional";
  configureShadowCastingLight(light);
  root.add(light);
  // The gizmo (icon billboard + reach wireframe) needs a DOM canvas; skip it for
  // headless/non-editor lights (e.g. placed actor lights) via `gizmo: false`.
  const gizmo = options.gizmo === false ? new Object3D() : buildLightGizmo(item, color);
  root.add(gizmo);
  const record: LightObjectRecord = target
    ? { root, light, target, gizmo }
    : { root, light, gizmo };
  applyLightTransform(record, item);
  return record;
}

/** Where a parked pooled light waits: far below any level, and dark anyway. */
const POOLED_LIGHT_PARK_Y = -10000;

/**
 * A light for a runtime pool (World Partition streamed lights). It stays visible
 * for its whole life: the scene's light count per type (and shadow count) is
 * part of every lit material's program key, so adding or hiding lights while
 * playing would recompile them all. Parked, it is dark and its shadow map frozen.
 */
export function createPooledLightObject(type: "point" | "spot", castShadow: boolean, name: string): LightObjectRecord {
  const record = createLightObject({
    name, type, position: [0, POOLED_LIGHT_PARK_Y, 0], rotation: [0, 0, 0], hidden: false, intensity: 0, castShadow,
  }, 0xffffff, { gizmo: false });
  parkPooledLight(record);
  return record;
}

/** Shows `item` through a pooled light of its type, or parks the light for null/hidden. */
export function assignPooledLight(
  record: LightObjectRecord,
  item: LightRenderItem | null,
  defaultColor: ColorRepresentation,
): void {
  if (!item || item.hidden) {
    parkPooledLight(record);
    return;
  }
  applyLightTransform(record, { ...item, hidden: false });
  const light = record.light;
  light.color.set(item.color ?? defaultColor);
  light.intensity = item.intensity ?? defaultLightIntensity(item.type);
  if (light instanceof PointLight || light instanceof SpotLight) {
    light.distance = item.distance ?? (item.type === "point" ? 8 : 10);
    light.decay = item.decay ?? 2;
  }
  if (light instanceof SpotLight) {
    light.angle = degreesToRadians(item.angle ?? 30);
    light.penumbra = item.penumbra ?? 0.35;
  }
  if (light.castShadow) {
    light.shadow.autoUpdate = true;
    light.shadow.needsUpdate = true;
  }
}

function parkPooledLight(record: LightObjectRecord): void {
  record.root.position.set(0, POOLED_LIGHT_PARK_Y, 0);
  record.root.visible = true;
  record.light.intensity = 0;
  if (record.light.castShadow) {
    // One last render at the parked pose, then frozen: no per-frame shadow pass.
    record.light.shadow.autoUpdate = false;
    record.light.shadow.needsUpdate = true;
  }
}

export function syncLightObject(
  record: LightObjectRecord,
  item: LightRenderItem,
  options: { defaultColor: ColorRepresentation; selected: boolean },
): void {
  record.root.name = item.name;
  applyLightTransform(record, item);

  const color = new Color(item.color ?? options.defaultColor);
  record.light.color.copy(color);
  record.light.intensity = item.intensity ?? defaultLightIntensity(item.type);
  record.light.castShadow = item.castShadow ?? item.type === "directional";
  if (record.light instanceof PointLight || record.light instanceof SpotLight) {
    record.light.distance = item.distance ?? (item.type === "point" ? 8 : 10);
    record.light.decay = item.decay ?? 2;
  }
  if (record.light instanceof SpotLight) {
    record.light.angle = degreesToRadians(item.angle ?? 30);
    record.light.penumbra = item.penumbra ?? 0.35;
  }

  // Rebuild the wireframe so cone angle / sphere radius / color track the light.
  record.root.remove(record.gizmo);
  disposeLightGizmo(record.gizmo);
  record.gizmo = buildLightGizmo(item, color);
  record.root.add(record.gizmo);
  const wire = record.gizmo.getObjectByName("light-wire");
  if (wire) wire.visible = options.selected;
}

/** Unreal-style billboard icon (bulb for point/spot, sun for directional). */
export function createLightIcon(type: SceneLightType): Sprite {
  const sprite = new Sprite(lightIconMaterial(type));
  sprite.scale.set(0.55, 0.55, 0.55);
  sprite.name = "light-icon";
  return sprite;
}

function lightIconMaterial(type: SceneLightType): SpriteMaterial {
  let material = lightIconMaterials.get(type);
  if (material) return material;
  material = new SpriteMaterial({
    map: lightIconTexture(type),
    transparent: true,
    // Always visible (like Unreal's editor icons), even behind geometry.
    depthTest: false,
    depthWrite: false,
  });
  lightIconMaterials.set(type, material);
  return material;
}

function lightIconTexture(type: SceneLightType): CanvasTexture {
  let texture = lightIconTextures.get(type);
  if (texture) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) drawLightGlyph(ctx, type);
  texture = new CanvasTexture(canvas);
  lightIconTextures.set(type, texture);
  return texture;
}

function drawLightGlyph(ctx: CanvasRenderingContext2D, type: SceneLightType): void {
  ctx.clearRect(0, 0, 64, 64);
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(25,20,8,0.92)";
  ctx.fillStyle = "#ffd76a";

  if (type === "directional") {
    const cx = 32;
    const cy = 32;
    const r = 11;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
      ctx.lineTo(cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  // Bulb for point + spot.
  const cx = 32;
  const cy = 25;
  const r = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#9a8a5a";
  ctx.beginPath();
  ctx.rect(cx - 7, cy + r - 3, 14, 13);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + r + 2);
  ctx.lineTo(cx + 7, cy + r + 2);
  ctx.moveTo(cx - 7, cy + r + 6);
  ctx.lineTo(cx + 7, cy + r + 6);
  ctx.stroke();
}

/**
 * Unreal-style wireframe light gizmo: a small solid icon (the click target) plus
 * a wireframe that represents the light's actual reach.
 */
export function buildLightGizmo(
  item: LightRenderItem,
  color: ColorRepresentation,
): Object3D {
  const group = new Group();
  group.name = "light-gizmo";
  group.add(createLightIcon(item.type));

  const lineMaterial = new LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  let wire: LineSegments;
  if (item.type === "spot") {
    const angle = degreesToRadians(item.angle ?? 30);
    const height = item.distance && item.distance > 0 ? item.distance : 10;
    const radius = Math.tan(angle) * height;
    wire = buildSpotConeWire(radius, height, lineMaterial);
  } else if (item.type === "point") {
    const radius = item.distance && item.distance > 0 ? item.distance : 1;
    wire = buildPointSphereWire(radius, lineMaterial);
  } else {
    wire = buildDirectionWire(lineMaterial);
  }
  wire.name = "light-wire";
  // Visual only: never a pick target (otherwise the whole cone/sphere selects).
  wire.raycast = () => {};
  // Shown only while the light is selected.
  wire.visible = false;
  group.add(wire);
  return group;
}

/** Cone wireframe: apex at origin (the light), opening down local -Z to z=-height. */
function buildSpotConeWire(
  radius: number,
  height: number,
  material: LineBasicMaterial,
): LineSegments {
  const segments = 24;
  const rim: Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    rim.push(new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, -height));
  }
  const points: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = rim[i]!;
    const b = rim[(i + 1) % segments]!;
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (let i = 0; i < 4; i += 1) {
    const p = rim[Math.floor((i / 4) * segments)]!;
    points.push(0, 0, 0, p.x, p.y, p.z);
  }
  return new LineSegments(bufferFromPoints(points), material);
}

/** Three orthogonal great circles forming a wireframe sphere of the given radius. */
function buildPointSphereWire(radius: number, material: LineBasicMaterial): LineSegments {
  const segments = 32;
  const points: number[] = [];
  const onCircle = (axis: 0 | 1 | 2, t: number): Vector3 => {
    const c = Math.cos(t) * radius;
    const s = Math.sin(t) * radius;
    if (axis === 0) return new Vector3(0, c, s);
    if (axis === 1) return new Vector3(c, 0, s);
    return new Vector3(c, s, 0);
  };
  for (const axis of [0, 1, 2] as const) {
    for (let i = 0; i < segments; i += 1) {
      const u = onCircle(axis, (i / segments) * Math.PI * 2);
      const v = onCircle(axis, ((i + 1) / segments) * Math.PI * 2);
      points.push(u.x, u.y, u.z, v.x, v.y, v.z);
    }
  }
  return new LineSegments(bufferFromPoints(points), material);
}

/** A short line down local -Z indicating a directional light's aim. */
function buildDirectionWire(material: LineBasicMaterial): LineSegments {
  return new LineSegments(bufferFromPoints([0, 0, 0, 0, 0, -1.2]), material);
}

function bufferFromPoints(points: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
}

export function disposeLightGizmo(gizmo: Object3D): void {
  gizmo.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

/**
 * Attaches a Three.js light to a placed actor instance's host object when the
 * actor entity carries a Light component (returns false otherwise).
 *
 * The light is added at the host's *local* origin: the host (the actor's mesh,
 * or an empty group for a light-only actor) already sits at the instance world
 * transform, so the light — and, for directional/spot, its target — track the
 * actor as behaviors or the gizmo move it. The editor wireframe/icon gizmo is
 * discarded: a placed actor light illuminates the scene but shows no gizmo (the
 * host object is the pickable). Mirrors how layout lights are built, but sourced
 * from the entity's Light component instead of a `LayoutLightActor`.
 */
export function attachActorLight(host: Object3D, entity: Entity): boolean {
  const light = readLightComponent(entity);
  if (!light) return false;
  const item = entityLightItem(entity);
  // The host carries the instance world transform; build the light at identity.
  item.position = [0, 0, 0];
  item.rotation = [0, 0, 0];
  // No editor gizmo: a placed actor light illuminates but shows no wireframe/icon
  // (the host object is the pickable), and skipping it keeps this DOM-free.
  const record = createLightObject(item, item.color ?? "#ffffff", { gizmo: false });
  host.add(record.root);
  if (record.target) host.add(record.target);
  return true;
}
