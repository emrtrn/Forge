import { InstancedMesh, Matrix3, Matrix4, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Camera, Intersection, Mesh, Object3D, OrthographicCamera, PerspectiveCamera } from "three";

import {
  findParentActor,
  findParentAiNavigationVolume,
  findParentBlockingVolume,
  findParentCharacter,
  findParentInstancedMesh,
  findParentLight,
  findParentLandscape,
  findParentReflectionCapture,
  findParentReflectionPlane,
  findParentReflectiveSurface,
  findParentSpline,
  findParentTargetPoint,
  findParentWorldWidget,
} from "@engine/render-three/picking";
import type { InstanceSelection, Selection } from "@editor/core/selection";
import { pickGizmoHandle as pickGizmoHandleFromObjects } from "@editor/gizmos/interaction";
import type { GizmoHandle } from "@editor/gizmos/handles";

export interface LandscapeSurfaceHit {
  index: number;
  point: Vector3;
}

/** A Foliage Mode brush hit: world point + surface normal + classified target. */
export interface FoliageSurfacePick {
  point: Vector3;
  /** Unit world-space surface normal (world up when the face has no normal). */
  normal: Vector3;
  /** Landscape index when the hit landed on a Landscape actor, else null. */
  landscapeIndex: number | null;
  /** Static-mesh asset id when the hit landed on a placed instance, else null. */
  staticMeshAssetId: string | null;
}

/** A Mesh Paint Mode hit on a clone-backed placed mesh primitive. */
export interface MeshPaintSurfacePick {
  object: Mesh;
  point: Vector3;
  normal: Vector3;
  selection: InstanceSelection;
}

export interface ScenePickerOptions {
  camera: () => Camera;
  canvas: HTMLCanvasElement;
  /** All selectable scene objects: instanced meshes + characters + light roots. */
  pickables: () => Object3D[];
  /** Solid surfaces for placement raycasts: instanced meshes + characters. */
  surfacePickables: () => Object3D[];
  /** The transform gizmo group's visibility + its pickable handle meshes. */
  gizmo: () => { visible: boolean; pickables: Object3D[] };
  /**
   * True when a selection is locked in the outliner. Locked objects are
   * click-through for viewport picking (like Unreal): the pick falls through to
   * whatever solid geometry sits behind them, and they can only be re-selected
   * by unlocking them in the Scene Outliner. Optional — omitting it disables the
   * behavior (nothing is treated as locked).
   */
  isSelectionLocked?: (selection: Selection) => boolean;
}

/**
 * Editor viewport raycasting: maps pointer/client coordinates to scene
 * selections, gizmo handles, and floor/surface points. Owns its scratch
 * raycaster + NDC vector + floor plane; reads the live scene through the
 * supplier callbacks so it stays correct as the scene mutates. Editor-only.
 */
export class ScenePicker {
  private readonly getCamera: () => Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly getPickables: () => Object3D[];
  private readonly getSurfacePickables: () => Object3D[];
  private readonly getGizmo: () => { visible: boolean; pickables: Object3D[] };
  private readonly isSelectionLocked: ((selection: Selection) => boolean) | undefined;

  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly floorHit = new Vector3();
  private readonly worldPoint = new Vector3();
  /** Viewport height in CSS px (updated per pick) — feeds the screen-space line tolerance. */
  private viewportHeightPx = 1;

  /**
   * Clickable band around a wireframe edge, in **screen pixels**. Volume brushes
   * (blocking / AI-navigation) and other line helpers are picked by their edges,
   * so a fixed world-space `Line.threshold` reads as a fat tube that grows/shrinks
   * with zoom — it selects outside the volume and on faces near an edge. We instead
   * accept a line hit only when the edge is within this many pixels of the cursor
   * (see {@link isScreenFarLineHit}), so picking a volume means clicking on its line.
   */
  private static readonly LINE_PICK_PIXELS = 6;
  /**
   * Slack multiplier for the broad-phase `Line.threshold` used during the raycast.
   * The threshold is a world-space tube, so it is set generously (relative to the
   * farthest pickable's depth) to make sure every edge that is within
   * {@link LINE_PICK_PIXELS} on screen becomes a candidate; the exact per-hit pixel
   * test then rejects the rest. Overshooting only adds cheap candidates — it can
   * never cause a false selection — so a comfortable safety factor is intentional.
   */
  private static readonly LINE_THRESHOLD_SAFETY = 4;

  constructor(options: ScenePickerOptions) {
    this.getCamera = options.camera;
    this.canvas = options.canvas;
    this.getPickables = options.pickables;
    this.getSurfacePickables = options.surfacePickables;
    this.getGizmo = options.gizmo;
    this.isSelectionLocked = options.isSelectionLocked;
  }

  pickGizmoHandle(clientX: number, clientY: number): GizmoHandle | null {
    const gizmo = this.getGizmo();
    if (!gizmo.visible || gizmo.pickables.length === 0) return null;
    this.setPointerNdc(clientX, clientY);
    const camera = this.getCamera();
    return pickGizmoHandleFromObjects(
      this.raycaster,
      camera,
      this.pointerNdc,
      gizmo.visible,
      gizmo.pickables,
    );
  }

  pickSelection(clientX: number, clientY: number): Selection | null {
    return this.pickSelectionHit(clientX, clientY)?.selection ?? null;
  }

  /** Allows separately rendered editor surfaces to participate in depth ordering. */
  pickSelectionHit(clientX: number, clientY: number): { selection: Selection; distance: number } | null {
    this.setPointerNdc(clientX, clientY);
    const camera = this.getCamera();
    this.raycaster.setFromCamera(this.pointerNdc, camera);

    const pickables = this.getPickables();
    // Broad-phase line tube: generous enough that any edge within the screen-space
    // pixel band is a candidate; the exact test below trims it back to those pixels.
    this.raycaster.params.Line.threshold = this.lineThresholdFor(pickables);
    const hits = this.visibleHits(this.raycaster.intersectObjects(pickables, true));
    for (const hit of hits) {
      // Wireframe helpers (volume brushes, etc.) are edge-picked: skip a line hit
      // whose edge is more than LINE_PICK_PIXELS from the cursor, so clicking the
      // translucent face or just outside the volume never selects it.
      if (this.isScreenFarLineHit(hit)) continue;

      const selection = this.resolveSelection(hit);
      if (!selection) continue;
      // Locked objects are click-through: fall through to whatever is behind them
      // so they can only be re-selected by unlocking in the Scene Outliner.
      if (this.isSelectionLocked?.(selection)) continue;
      return { selection, distance: hit.distance };
    }
    return null;
  }

  /** Maps a single raycast hit to the scene Selection it belongs to, or null. */
  private resolveSelection(hit: Intersection): Selection | null {
    const mesh = findParentInstancedMesh(hit.object);
    if (mesh) {
      const assetId = String(mesh.userData.assetId ?? "");
      if (!assetId || hit.instanceId == null) return null;
      return { kind: "instance", assetId, placementIndex: hit.instanceId };
    }

    const instance = findParentMaterialOverride(hit.object);
    if (instance) return instance;

    const character = findParentCharacter(hit.object);
    if (character) {
      const index = Number(character.userData.characterIndex);
      if (Number.isInteger(index)) return { kind: "character", index };
    }

    const actor = findParentActor(hit.object);
    if (actor) {
      const index = Number(actor.userData.actorIndex);
      if (Number.isInteger(index)) return { kind: "actor", index };
    }

    const light = findParentLight(hit.object);
    if (light) {
      const index = Number(light.userData.lightIndex);
      if (Number.isInteger(index)) return { kind: "light", index };
    }

    const reflectionPlane = findParentReflectionPlane(hit.object);
    if (reflectionPlane) {
      const index = Number(reflectionPlane.userData.reflectionPlaneIndex);
      if (Number.isInteger(index)) return { kind: "reflectionPlane", index };
    }

    const reflectiveSurface = findParentReflectiveSurface(hit.object);
    if (reflectiveSurface) {
      const index = Number(reflectiveSurface.userData.reflectiveSurfaceIndex);
      if (Number.isInteger(index)) return { kind: "reflectiveSurface", index };
    }

    const reflectionCapture = findParentReflectionCapture(hit.object);
    if (reflectionCapture) {
      const index = Number(reflectionCapture.userData.reflectionCaptureIndex);
      if (Number.isInteger(index)) return { kind: "reflectionCapture", index };
    }

    const blockingVolume = findParentBlockingVolume(hit.object);
    if (blockingVolume) {
      const index = Number(blockingVolume.userData.blockingVolumeIndex);
      if (Number.isInteger(index)) return { kind: "blockingVolume", index };
    }

    const aiNavigationVolume = findParentAiNavigationVolume(hit.object);
    if (aiNavigationVolume) {
      const index = Number(aiNavigationVolume.userData.aiNavigationVolumeIndex);
      if (Number.isInteger(index)) return { kind: "aiNavigationVolume", index };
    }

    const targetPoint = findParentTargetPoint(hit.object);
    if (targetPoint) {
      const index = Number(targetPoint.userData.targetPointIndex);
      if (Number.isInteger(index)) return { kind: "targetPoint", index };
    }

    const spline = findParentSpline(hit.object);
    if (spline) {
      const index = Number(spline.userData.splineIndex);
      if (Number.isInteger(index)) return { kind: "spline", index };
    }

    const worldWidget = findParentWorldWidget(hit.object);
    if (worldWidget) {
      const index = Number(worldWidget.userData.worldWidgetIndex);
      if (Number.isInteger(index)) return { kind: "worldWidget", index };
    }

    const landscape = findParentLandscape(hit.object);
    if (landscape) {
      const index = Number(landscape.userData.landscapeIndex);
      if (Number.isInteger(index)) return { kind: "landscape", index };
    }

    return null;
  }

  clientToFloor(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return hit ? this.floorHit.clone() : null;
  }

  /**
   * Resolves the cursor to a placement point: the nearest scene surface under
   * the cursor (so assets land on table/shelf tops), falling back to the floor
   * plane (y = 0) when no geometry is hit.
   */
  clientToSurface(clientX: number, clientY: number): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());

    const hits = this.visibleHits(this.raycaster.intersectObjects(this.getSurfacePickables(), true));
    if (hits[0]) return hits[0].point.clone();

    const floor = this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit);
    return floor ? this.floorHit.clone() : null;
  }

  clientToPlane(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    const target = new Vector3();
    return this.raycaster.ray.intersectPlane(plane, target) ? target : null;
  }

  pickLandscapeSurface(clientX: number, clientY: number): LandscapeSurfaceHit | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    const hits = this.visibleHits(this.raycaster.intersectObjects(this.getPickables(), true));
    for (const hit of hits) {
      const landscape = findParentLandscape(hit.object);
      if (!landscape) continue;
      const index = Number(landscape.userData.landscapeIndex);
      if (!Number.isInteger(index)) continue;
      return { index, point: hit.point.clone() };
    }
    return null;
  }

  /**
   * Resolves the cursor to a Foliage Mode brush hit: the nearest solid surface
   * that is a Landscape or a placed static-mesh instance, with the world-space
   * surface normal (instance matrix folded in for instanced meshes). Returns null
   * when the cursor is over empty space or a non-paintable surface.
   */
  pickFoliageSurface(clientX: number, clientY: number): FoliageSurfacePick | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    return this.classifyFoliageHits(this.raycaster.intersectObjects(this.getPickables(), true));
  }

  /**
   * Picks one exact placement clone for Mesh Paint Mode. Mesh Paint always edits
   * clone geometry (never an InstancedMesh's shared BufferGeometry), so an
   * instanced placement must first be promoted by SceneApp before this can hit.
   */
  pickMeshPaintSurface(
    clientX: number,
    clientY: number,
    expected: InstanceSelection,
  ): MeshPaintSurfacePick | null {
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    const hits = this.visibleHits(this.raycaster.intersectObjects(this.getPickables(), true));
    for (const hit of hits) {
      const selection = findParentMaterialOverride(hit.object);
      if (
        !selection ||
        selection.assetId !== expected.assetId ||
        selection.placementIndex !== expected.placementIndex ||
        !(hit.object as { isMesh?: boolean }).isMesh
      ) {
        continue;
      }
      const object = hit.object as Mesh;
      if (!object.geometry.getAttribute("position")) continue;
      return { object, point: hit.point.clone(), normal: this.worldFaceNormal(hit), selection };
    }
    return null;
  }

  /**
   * Samples the paintable surface directly below a world X/Z (foliage brush disk
   * samples): casts straight down from high above so every sample gets its own
   * surface point + normal, not just the pointer's centre hit.
   */
  raycastFoliageSurfaceDown(worldX: number, worldZ: number): FoliageSurfacePick | null {
    // Reuse the member raycaster (whose layers/params match the scene — a fresh
    // Raycaster silently missed the landscape) with a straight-down ray from above.
    const prevNear = this.raycaster.near;
    const prevFar = this.raycaster.far;
    this.raycaster.set(new Vector3(worldX, 1e4, worldZ), new Vector3(0, -1, 0));
    this.raycaster.near = 0;
    this.raycaster.far = 2e4;
    const hits = this.raycaster.intersectObjects(this.getPickables(), true);
    this.raycaster.near = prevNear;
    this.raycaster.far = prevFar;
    return this.classifyFoliageHits(hits);
  }

  /**
   * Raycasts the pointer against the given foliage InstancedMesh batches and
   * returns the nearest hit's group id + instance index. Foliage batches keep
   * their scene-wide raycast suppressed (they are decorative, not paint surfaces),
   * so this calls the InstancedMesh raycast directly on the passed meshes — used
   * only by Foliage Mode's Select tool. Returns null when no instance is under the
   * cursor.
   */
  pickFoliageInstance(
    clientX: number,
    clientY: number,
    meshes: readonly InstancedMesh[],
  ): { groupId: string; index: number } | null {
    if (meshes.length === 0) return null;
    this.setPointerNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.getCamera());
    const hits: Intersection[] = [];
    for (const mesh of meshes) {
      InstancedMesh.prototype.raycast.call(mesh, this.raycaster, hits);
    }
    hits.sort((a, b) => a.distance - b.distance);
    for (const hit of this.visibleHits(hits)) {
      if (hit.instanceId == null) continue;
      const groupId = foliageGroupIdOf(hit.object);
      if (groupId) return { groupId, index: foliageGlobalIndexOf(hit.object, hit.instanceId) };
    }
    return null;
  }

  private classifyFoliageHits(intersections: Intersection[]): FoliageSurfacePick | null {
    for (const hit of this.visibleHits(intersections)) {
      const landscape = findParentLandscape(hit.object);
      if (landscape) {
        const index = Number(landscape.userData.landscapeIndex);
        return {
          point: hit.point.clone(),
          normal: this.worldFaceNormal(hit),
          landscapeIndex: Number.isInteger(index) ? index : null,
          staticMeshAssetId: null,
        };
      }
      const instanced = findParentInstancedMesh(hit.object);
      if (instanced) {
        const assetId = String(instanced.userData.assetId ?? "");
        return {
          point: hit.point.clone(),
          normal: this.worldFaceNormal(hit),
          landscapeIndex: null,
          staticMeshAssetId: assetId.length > 0 ? assetId : null,
        };
      }
    }
    return null;
  }

  /** World-space normal of a hit face, folding in the per-instance matrix for instanced meshes. */
  private worldFaceNormal(hit: Intersection): Vector3 {
    if (!hit.face) return new Vector3(0, 1, 0);
    const matrix = new Matrix4().copy(hit.object.matrixWorld);
    if (hit.object instanceof InstancedMesh && typeof hit.instanceId === "number") {
      const instanceMatrix = new Matrix4();
      hit.object.getMatrixAt(hit.instanceId, instanceMatrix);
      matrix.multiply(instanceMatrix);
    }
    const normal = hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(matrix)).normalize();
    return normal.lengthSq() > 1e-8 ? normal : new Vector3(0, 1, 0);
  }

  /** Casts straight down from `origin`, ignoring the excluded selection's own
   *  geometry, and returns the first surface's y (or null when nothing solid). */
  raycastSurfaceBelow(origin: Vector3, exclude: Selection): number | null {
    const ray = new Raycaster(origin, new Vector3(0, -1, 0), 0, 1000);
    // Only solid meshes count as a surface — wireframe volume brushes must not act
    // as a phantom floor, so disable line hits for this drop-down cast.
    ray.params.Line.threshold = 0;
    const hits = this.visibleHits(ray.intersectObjects(this.getPickables(), true));
    for (const hit of hits) {
      if (this.isSelfHit(hit, exclude)) continue;
      return hit.point.y;
    }
    return null;
  }

  private isSelfHit(hit: Intersection, selection: Selection): boolean {
    if (selection.kind === "instance") {
      const mesh = findParentInstancedMesh(hit.object);
      const override = findParentMaterialOverride(hit.object);
      return Boolean(
        (mesh &&
          String(mesh.userData.assetId ?? "") === selection.assetId &&
          hit.instanceId === selection.placementIndex) ||
          (override &&
            override.assetId === selection.assetId &&
            override.placementIndex === selection.placementIndex),
      );
    }
    if (selection.kind === "actor") {
      const actor = findParentActor(hit.object);
      return actor ? Number(actor.userData.actorIndex) === selection.index : false;
    }
    if (selection.kind === "reflectionPlane") {
      const plane = findParentReflectionPlane(hit.object);
      return plane ? Number(plane.userData.reflectionPlaneIndex) === selection.index : false;
    }
    if (selection.kind === "reflectiveSurface") {
      const surface = findParentReflectiveSurface(hit.object);
      return surface ? Number(surface.userData.reflectiveSurfaceIndex) === selection.index : false;
    }
    if (selection.kind === "reflectionCapture") {
      const capture = findParentReflectionCapture(hit.object);
      return capture ? Number(capture.userData.reflectionCaptureIndex) === selection.index : false;
    }
    if (selection.kind === "blockingVolume") {
      const volume = findParentBlockingVolume(hit.object);
      return volume ? Number(volume.userData.blockingVolumeIndex) === selection.index : false;
    }
    if (selection.kind === "aiNavigationVolume") {
      const volume = findParentAiNavigationVolume(hit.object);
      return volume ? Number(volume.userData.aiNavigationVolumeIndex) === selection.index : false;
    }
    if (selection.kind === "targetPoint") {
      const point = findParentTargetPoint(hit.object);
      return point ? Number(point.userData.targetPointIndex) === selection.index : false;
    }
    if (selection.kind === "spline") {
      const spline = findParentSpline(hit.object);
      return spline ? Number(spline.userData.splineIndex) === selection.index : false;
    }
    if (selection.kind === "worldWidget") {
      const widget = findParentWorldWidget(hit.object);
      return widget ? Number(widget.userData.worldWidgetIndex) === selection.index : false;
    }
    if (selection.kind === "landscape") {
      const object = findParentLandscape(hit.object);
      return object ? Number(object.userData.landscapeIndex) === selection.index : false;
    }
    // Environment singletons have no pickable geometry.
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "post"
    ) {
      return false;
    }
    const character = findParentCharacter(hit.object);
    return character ? Number(character.userData.characterIndex) === selection.index : false;
  }

  private visibleHits(hits: Intersection[]): Intersection[] {
    return hits.filter((hit) => isVisibleInHierarchy(hit.object));
  }

  /** World-space size of one viewport pixel at `distance` from the active camera. */
  private worldUnitsPerPixel(distance: number): number {
    const camera = this.getCamera();
    if (isOrthographicCamera(camera)) {
      const viewHeight = (camera.top - camera.bottom) / Math.max(camera.zoom, 0.01);
      return viewHeight / Math.max(this.viewportHeightPx, 1);
    }
    const fovRadians = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const viewHeight = 2 * Math.tan(fovRadians / 2) * Math.max(distance, 0.01);
    return viewHeight / Math.max(this.viewportHeightPx, 1);
  }

  /**
   * Broad-phase world-space `Line.threshold` for the pick: the on-screen pixel band
   * converted to world units at the farthest pickable's depth (times a safety
   * factor). Sized so every edge within the pixel band is a raycast candidate; the
   * per-hit test in {@link isScreenFarLineHit} enforces the true pixel tolerance.
   */
  private lineThresholdFor(pickables: Object3D[]): number {
    const cameraPosition = this.getCamera().position;
    let maxDistance = 0.01;
    for (const object of pickables) {
      object.getWorldPosition(this.worldPoint);
      maxDistance = Math.max(maxDistance, cameraPosition.distanceTo(this.worldPoint));
    }
    return (
      this.worldUnitsPerPixel(maxDistance) *
      ScenePicker.LINE_PICK_PIXELS *
      ScenePicker.LINE_THRESHOLD_SAFETY
    );
  }

  /**
   * True when a hit is on a line/wireframe whose edge sits farther than
   * {@link LINE_PICK_PIXELS} from the cursor in screen space. `hit.point` is the
   * point on the edge; its perpendicular distance to the pick ray, compared against
   * the world size of the pixel band at that depth, gives a zoom-independent test.
   * Non-line hits (solid meshes) always pass.
   */
  private isScreenFarLineHit(hit: Intersection): boolean {
    const object = hit.object as Partial<{ isLine: boolean }>;
    if (!object.isLine) return false;
    const tolerance = this.worldUnitsPerPixel(hit.distance) * ScenePicker.LINE_PICK_PIXELS;
    return this.raycaster.ray.distanceToPoint(hit.point) > tolerance;
  }

  private setPointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.viewportHeightPx = rect.height;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }
}

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
  return (camera as OrthographicCamera).isOrthographicCamera === true;
}

function isVisibleInHierarchy(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/** Walks up to the foliage batch group tagged with its group id (Foliage Mode selection). */
function foliageGroupIdOf(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const groupId = current.userData.foliageGroupId;
    if (typeof groupId === "string" && groupId.length > 0) return groupId;
    current = current.parent;
  }
  return null;
}

/**
 * Maps a chunk-local InstancedMesh instance id back to its group-global instance
 * index via the chunk's `foliageIndexMap` tag (render chunking splits a group into
 * per-cell batches, so a mesh's local id is not the group index). Falls back to the
 * local id when no map is present (unchunked/legacy batches).
 */
function foliageGlobalIndexOf(object: Object3D, localId: number): number {
  let current: Object3D | null = object;
  while (current) {
    const map = current.userData.foliageIndexMap;
    if (Array.isArray(map)) {
      const global = map[localId];
      return typeof global === "number" ? global : localId;
    }
    current = current.parent;
  }
  return localId;
}

function findParentMaterialOverride(object: Object3D): InstanceSelection | null {
  let current: Object3D | null = object;
  while (current) {
    const assetId = current.userData.assetId;
    const placementIndex = current.userData.placementIndex;
    if (typeof assetId === "string" && Number.isInteger(placementIndex)) {
      return { kind: "instance", assetId, placementIndex };
    }
    current = current.parent;
  }
  return null;
}
