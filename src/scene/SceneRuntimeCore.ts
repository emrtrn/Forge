import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
} from "three";
import type {
  BufferGeometry,
  DirectionalLight,
  InstancedMesh,
  Material,
  Object3D,
  PerspectiveCamera,
  WebGLRenderer,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { applyRootMotionToClip, type RootMotionClipSetting } from "@engine/render-three/rootMotion";

import { SceneShell, resizeSceneShellViewport } from "./SceneShell";
import {
  beginRenderStatsFrame,
  readRenderStats,
  readRenderMemory,
  type RenderMemoryStats,
} from "@engine/render-three/renderer";
import { composePlacementMatrix } from "@engine/render-three/transforms";
import {
  createCharacterSceneObject,
  createInstancedModelGroup,
  entityCharacterItem,
  entityInstanceItems,
} from "@engine/render-three/models";
import type { InstanceRenderItem } from "@engine/render-three/models";
import {
  createLightObject as createThreeLightObject,
  entityLightItem,
  type LightObjectRecord,
  type LightRenderItem,
} from "@engine/render-three/lights";
import {
  characterEntity,
  instanceEntitiesForAsset,
  lightEntity,
} from "@engine/scene/legacyRoomLayoutAdapter";
import { isProceduralAssetId } from "@engine/scene/shapes";
import {
  computeLandscapeSplineMeshInstances,
  resolveLandscapeSplineMeshChains,
  type LandscapeSplineMeshChain,
} from "@engine/scene/landscape";
import { createProceduralAssetGltf } from "./shapePrimitives";
import type {
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  LayoutSplineActor,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import {
  DEFAULT_SPLINE_GENERATOR_REGISTRY,
  generateSplineInstancePlacements,
  generateSplineRigidSegmentPlacements,
  resolveSplineInstanceGenerator,
  resolveSplineRigidSegmentGenerator,
  resolveSplineDeformMeshGenerator,
  type SplineGeneratorBuildContext,
  type SplineGeneratorRegistry,
} from "@engine/scene/splineGenerator";
import { cloneSplineActor } from "@engine/scene/splineActor";
import type { TerrainSplineMeshSource } from "@engine/terrain/terrainSplineMeshes";
import { buildSplineDeformMeshGroup, disposeSplineSharedMaterials } from "@engine/render-three/splineDeformMesh";
import { buildSplineCurveCache, type SplineCurveCache } from "@engine/scene/splineCurve";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";

export const SCENE_CAMERA_TARGET = new Vector3(0, 0.65, -0.2);
export const DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS = false;
export const DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS = true;
export const DEFAULT_SCENE_LIGHT_COLOR = "#ffffff";
export const DEFAULT_SCENE_SUN_ID = "sun";
export const DEFAULT_SCENE_BACKGROUND_COLOR = "#d7d7c7";
export const DEFAULT_SCENE_AMBIENT_COLOR = "#ffffff";
export const DEFAULT_SCENE_AMBIENT_INTENSITY = 0;
export const DEFAULT_SCENE_GRAVITY: Vec3 = [0, -9.81, 0];
export const DEFAULT_SCENE_KILL_Z = -20;

export interface SceneRuntimeCore {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export interface ResolvedSceneWorldSettings {
  staticObjectsCastShadow: boolean;
  staticObjectsReceiveShadow: boolean;
  backgroundColor: string;
  ambientColor: string;
  ambientIntensity: number;
  gravity: Vec3;
  killZ: number;
  /** Authored view distance (m), or `null` to keep each camera's own far clip. */
  viewDistance: number | null;
}

export function createSceneRuntimeCore(
  canvas: HTMLCanvasElement,
  options: { backgroundColor: string | number },
): SceneRuntimeCore {
  return new SceneShell(canvas, options);
}

export function applyEditorMatchedPlayLook(renderer: WebGLRenderer): void {
  // Match the editor's OutputPass: encode the linear-rendered scene to sRGB for
  // display. Play renders directly (no composer), so this is the only place the
  // sRGB transfer is applied — without it the image is rendered linear and looks
  // dark. (SRGBColorSpace is the renderer default; set explicitly to document it.)
  renderer.outputColorSpace = SRGBColorSpace;
}

/** Opens the frame whose draws `readSceneRuntimeStats` reports (shadow + post passes included). */
export function beginSceneRuntimeFrameStats(renderer: WebGLRenderer): void {
  beginRenderStatsFrame(renderer);
}

export function readSceneRuntimeStats(
  renderer: WebGLRenderer,
): { drawCalls: number; triangles: number } {
  return readRenderStats(renderer);
}

export function readSceneRuntimeMemory(renderer: WebGLRenderer): RenderMemoryStats {
  return readRenderMemory(renderer);
}

export function resizeSceneRuntimeViewport(options: {
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  width: number;
  height: number;
  viewTouched: boolean;
}): boolean {
  return resizeSceneShellViewport(options);
}

export function resolveSceneWorldSettings(
  layout: RoomLayout | null,
): ResolvedSceneWorldSettings {
  return {
    staticObjectsCastShadow:
      layout?.worldSettings?.staticObjectsCastShadow ??
      DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
    staticObjectsReceiveShadow:
      layout?.worldSettings?.staticObjectsReceiveShadow ??
      DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
    backgroundColor: layout?.worldSettings?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND_COLOR,
    ambientColor: layout?.worldSettings?.ambientColor ?? DEFAULT_SCENE_AMBIENT_COLOR,
    ambientIntensity: layout?.worldSettings?.ambientIntensity ?? DEFAULT_SCENE_AMBIENT_INTENSITY,
    gravity: layout?.worldSettings?.gravity ?? DEFAULT_SCENE_GRAVITY,
    killZ: layout?.worldSettings?.killZ ?? DEFAULT_SCENE_KILL_Z,
    viewDistance: layout?.worldSettings?.viewDistance ?? null,
  };
}

export function ensureDefaultSceneLights(layout: RoomLayout | null): void {
  if (!layout) return;
  if (layout.lights && layout.lights.length > 0) return;
  layout.lights = [
    {
      id: DEFAULT_SCENE_SUN_ID,
      type: "directional",
      name: "Sun",
      position: [3, 9, 4],
      rotation: [-55, 35, 0],
      color: DEFAULT_SCENE_LIGHT_COLOR,
      intensity: 2,
      castShadow: true,
    },
  ];
}

export function computeSceneRoomBounds(
  layout: RoomLayout | null,
  localBounds: ReadonlyMap<string, Box3>,
  options: { includeAsset?: (assetId: string) => boolean } = {},
): Box3 | null {
  if (!layout) return null;
  const box = new Box3();
  let found = false;
  for (const instance of layout.instances) {
    if (options.includeAsset && !options.includeAsset(instance.assetId)) continue;
    const bounds = localBounds.get(instance.assetId);
    if (!bounds) continue;
    for (const placement of instance.placements) {
      box.union(bounds.clone().applyMatrix4(composePlacementMatrix(placement)));
      found = true;
    }
  }
  return found ? box : null;
}

/** Slack added to the fitted depth range so a caster is never clipped at the plane. */
const SHADOW_FIT_DEPTH_MARGIN = 2;

// Scratch state: a caller may re-fit every frame, so this allocates nothing.
const shadowFitEye = new Vector3();
const shadowFitFocus = new Vector3();
const shadowFitView = new Matrix4();
const shadowFitCorner = new Vector3();

/**
 * Fits a directional light's shadow frustum around `room`.
 *
 * Three.js places the shadow camera *at the light* and aims it at the light's
 * target, so the covered slab is anchored to wherever the light actor happens to
 * sit — not to the world. A symmetric `±half` frustum therefore only covers the
 * map when the actor stands above its centre and high enough that nothing falls
 * behind `near`; an authored sun placed low and off to one side (LandscapeTest's
 * sits at y≈9 near the origin of a 1 km terrain) left most of the level outside
 * the frustum: no shadows at all, until the sun actor is dragged next to a caster.
 * (Ported from ThreeAges, where the same bug hid shadows across an RTS map.)
 *
 * So the box is fitted in the light's own view space and the *asymmetric* ortho
 * planes are used. `near` is allowed to go negative: an orthographic frustum can
 * reach behind its own camera, and refusing to do so is what dropped every caster
 * standing up-sun of a low light.
 */
export function fitDirectionalShadowToBounds(
  sun: DirectionalLight | null,
  room: Box3 | null,
  distanceScale = 1,
): void {
  if (!sun || !room || room.isEmpty()) return;
  sun.updateWorldMatrix(true, false);
  sun.target.updateWorldMatrix(true, false);
  shadowFitEye.setFromMatrixPosition(sun.matrixWorld);
  shadowFitFocus.setFromMatrixPosition(sun.target.matrixWorld);
  // A light aimed at its own position has no direction to fit along; leave the
  // frustum as it stands rather than deriving a basis from a zero vector.
  if (shadowFitEye.distanceToSquared(shadowFitFocus) < 1e-12) return;
  // The exact basis `LightShadow.updateMatrices` will build for this light —
  // `Matrix4.lookAt` with the shadow camera's own up vector, including its
  // degenerate-aim nudge — so the fit matches the frustum three actually renders.
  shadowFitView.identity().lookAt(shadowFitEye, shadowFitFocus, sun.shadow.camera.up);
  shadowFitView.setPosition(shadowFitEye);
  shadowFitView.invert();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    shadowFitCorner
      .set(
        corner & 1 ? room.max.x : room.min.x,
        corner & 2 ? room.max.y : room.min.y,
        corner & 4 ? room.max.z : room.min.z,
      )
      .applyMatrix4(shadowFitView);
    minX = Math.min(minX, shadowFitCorner.x);
    maxX = Math.max(maxX, shadowFitCorner.x);
    minY = Math.min(minY, shadowFitCorner.y);
    maxY = Math.max(maxY, shadowFitCorner.y);
    // View space looks down -Z, so distance in front of the light is -z.
    const depth = -shadowFitCorner.z;
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }

  // Quality shrinks the ground coverage around the fitted box's centre so a
  // fixed-resolution shadow map concentrates its texels. Only the extent scales —
  // the depth range is left intact, so shrinking coverage never clips a caster.
  const scale = distanceScale > 0 ? distanceScale : 1;
  const width = (maxX - minX) * scale;
  const height = (maxY - minY) * scale;
  const cam = sun.shadow.camera;
  // Snap the frustum centre to whole shadow-map texels. Without it a caller that
  // re-fits a moving box (e.g. one following the camera at reduced coverage) makes
  // every shadow edge crawl as the map slides under the texel grid. One texel of
  // padding absorbs the snap so the box never falls outside what it fitted.
  // The floor keeps a degenerate (flat) box from snapping through a zero divisor.
  const texelX = Math.max(width / Math.max(1, sun.shadow.mapSize.x), 1e-6);
  const texelY = Math.max(height / Math.max(1, sun.shadow.mapSize.y), 1e-6);
  const centerX = Math.round((minX + maxX) / 2 / texelX) * texelX;
  const centerY = Math.round((minY + maxY) / 2 / texelY) * texelY;
  cam.left = centerX - width / 2 - texelX;
  cam.right = centerX + width / 2 + texelX;
  cam.bottom = centerY - height / 2 - texelY;
  cam.top = centerY + height / 2 + texelY;
  cam.near = minDepth - SHADOW_FIT_DEPTH_MARGIN;
  cam.far = maxDepth + SHADOW_FIT_DEPTH_MARGIN;
  cam.updateProjectionMatrix();
}

/**
 * Force every material under `root` to relink its program, after the master
 * shadow toggle (`renderer.shadowMap.enabled`) has moved.
 *
 * three does not do this itself, and the failure is spectacular rather than
 * subtle. `WebGLRenderer`'s `needsProgramChange` watches the *lights state*
 * version, and flipping the master toggle changes neither the light count nor
 * the number of casters — so a material keeps a program compiled with
 * `USE_SHADOWMAP` while the renderer has stopped producing a shadow map. Its
 * `sampler2DShadow` then points at nothing, and every draw call using that
 * program fails with `GL_INVALID_OPERATION: Mismatch between texture format and
 * sampler type`. What the player sees is the whole lit scene disappearing —
 * terrain, buildings, characters — while unlit meshes and the sky keep drawing,
 * which reads as a rendering collapse rather than as a shader mismatch and sends
 * the search in entirely the wrong direction.
 *
 * Bumping `Material.version` is the documented remedy: it takes the renderer's
 * `material.version !== __version` branch, which relinks unconditionally. The
 * recompile is inherent — turning shadows off genuinely changes every lit shader
 * — and callers pay it only on the frame a profile actually crosses the toggle,
 * which is why they must track the previous value rather than call this on every
 * profile change.
 */
export function invalidateMaterialsForShadowToggle(root: Object3D): void {
  root.traverse((object) => {
    const material = (object as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) entry.needsUpdate = true;
  });
}

export function applySceneBackgroundAndAmbient(options: {
  scene: Scene;
  ambientLight: AmbientLight | null;
  settings: Pick<
    ResolvedSceneWorldSettings,
    "backgroundColor" | "ambientColor" | "ambientIntensity"
  >;
  ambientName?: string;
}): AmbientLight | null {
  options.scene.background = new Color(options.settings.backgroundColor);
  if (options.settings.ambientIntensity <= 0) {
    options.ambientLight?.removeFromParent();
    return null;
  }

  if (!options.ambientLight) {
    const ambientLight = new AmbientLight(
      new Color(options.settings.ambientColor),
      options.settings.ambientIntensity,
    );
    if (options.ambientName) ambientLight.name = options.ambientName;
    options.scene.add(ambientLight);
    return ambientLight;
  }

  options.ambientLight.color.set(options.settings.ambientColor);
  options.ambientLight.intensity = options.settings.ambientIntensity;
  return options.ambientLight;
}

/**
 * Build the instanced render group for one asset's placements. Derives the
 * placements into instance entities → render items (same matrices as the legacy
 * placement path) and hands them to the engine instanced-mesh builder. The
 * caller registers the returned group/meshes into its own bookkeeping maps.
 */
export function buildSceneInstancedModel(options: {
  assetId: string;
  gltf: GLTF;
  placements: LayoutPlacement[];
  castShadow: boolean;
  receiveShadow: boolean;
}): { group: Group; meshes: InstancedMesh[] } {
  const items = entityInstanceItems(
    instanceEntitiesForAsset(options.assetId, options.placements),
  );
  return createInstancedModelGroup({
    assetId: options.assetId,
    gltf: options.gltf,
    items,
    castShadow: options.castShadow,
    receiveShadow: options.receiveShadow,
  });
}

/**
 * Builds all enabled instanced generator outputs for one generic spline.
 * Output is deliberately one non-pickable group: generated meshes remain a
 * property of the spline actor, not thousands of editor-selectable actors.
 */
export function buildSplineInstanceGeneratorGroup(options: {
  actor: LayoutSplineActor;
  mode: "editor" | "runtime";
  /** Editor pointer drags can use a bounded frame cache; runtime is always full quality. */
  deformQuality?: "preview" | "full";
  models: ReadonlyMap<string, GLTF>;
  castShadow: boolean;
  receiveShadow: boolean;
  applyMaterialSlots?: (assetId: string, assetGroup: Group) => void;
  /** Game composition may supply plugin handlers; core built-ins remain registry-free. */
  generatorRegistry?: SplineGeneratorRegistry;
}): { group: Group | null; meshes: InstancedMesh[]; instanceCount: number; triangleCount: number; missingAssetIds: string[]; warnings: string[] } | null {
  const itemsByAsset = new Map<string, InstanceRenderItem[]>();
  const pluginDisposals: Array<() => void> = [];
  const generatorRegistry = options.generatorRegistry ?? DEFAULT_SPLINE_GENERATOR_REGISTRY;
  for (const definition of options.actor.generators ?? []) {
    const pluginDefinition = definition.type !== "instances" && definition.type !== "rigidSegments" && definition.type !== "deformMesh"
      ? { ...definition }
      : null;
    if (pluginDefinition?.settings) pluginDefinition.settings = { ...pluginDefinition.settings };
    const pluginContext: SplineGeneratorBuildContext | null = pluginDefinition
      ? { actor: cloneSplineActor(options.actor), definition: pluginDefinition, mode: options.mode }
      : null;
    const generated = definition.type === "instances" ? (() => {
      const generator = resolveSplineInstanceGenerator(definition);
      if (!generator.enabled || !generator.meshAsset) return [];
      if (options.mode === "editor" ? !generator.previewEnabled : !generator.runtimeEnabled) return [];
      return generateSplineInstancePlacements(options.actor, generator);
    })() : definition.type === "rigidSegments" ? (() => {
      const generator = resolveSplineRigidSegmentGenerator(definition);
      if (!generator.enabled || !generator.meshAsset) return [];
      if (options.mode === "editor" ? !generator.previewEnabled : !generator.runtimeEnabled) return [];
      return generateSplineRigidSegmentPlacements(options.actor, generator);
    })() : pluginContext ? generatorRegistry.build(pluginContext) : [];
    if (pluginContext) pluginDisposals.push(() => generatorRegistry.dispose(pluginContext));
    for (const instance of generated) {
      const items = itemsByAsset.get(instance.assetId) ?? [];
      items.push({
        matrix: new Matrix4().compose(
          new Vector3(...instance.position),
          new Quaternion(...instance.rotation),
          new Vector3(...instance.scale),
        ),
        hidden: options.actor.hidden ?? false,
      });
      itemsByAsset.set(instance.assetId, items);
    }
  }
  const group = new Group();
  group.name = `SplineGeneratedInstances:${options.actor.id}`;
  group.userData.splineActorId = options.actor.id;
  group.userData.splineGenerated = true;
  group.userData.splinePluginDisposals = pluginDisposals;
  const meshes: InstancedMesh[] = [];
  let instanceCount = 0;
  let triangleCount = 0;
  const missingAssetIds: string[] = [];
  const warnings: string[] = [];
  for (const [assetId, items] of itemsByAsset) {
    const gltf = options.models.get(assetId);
    instanceCount += items.length;
    if (!gltf) {
      missingAssetIds.push(assetId);
      continue;
    }
    const built = createInstancedModelGroup({
      assetId,
      gltf,
      items,
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
    });
    built.group.traverse((child) => { child.raycast = () => {}; });
    options.applyMaterialSlots?.(assetId, built.group);
    group.add(built.group);
    meshes.push(...built.meshes);
  }
  // One clone per source material for every chunk of this actor (owned by the
  // group, freed by disposeSplineGeneratedGroup), and the curve built once.
  const sharedMaterials = new Map<Material, Material>();
  group.userData.splineSharedMaterials = sharedMaterials;
  let curve: SplineCurveCache | undefined;
  for (const definition of options.actor.generators ?? []) {
    if (definition.type !== "deformMesh") continue;
    const generator = resolveSplineDeformMeshGenerator(definition);
    if (!generator.enabled || !generator.meshAsset) continue;
    if (options.mode === "editor" ? !generator.previewEnabled : !generator.runtimeEnabled) continue;
    const gltf = options.models.get(generator.meshAsset);
    if (!gltf) {
      missingAssetIds.push(generator.meshAsset);
      continue;
    }
    const deformDefinition = options.deformQuality === "preview"
      ? { ...generator, sampleSteps: Math.min(generator.sampleSteps, 4) }
      : generator;
    curve ??= buildSplineCurveCache(options.actor.spline);
    const segmentIndices = generator.geometryMode === "segments"
      ? curve.segments.map((segment) => segment.index)
      : [undefined];
    for (const segmentIndex of segmentIndices) {
      const built = buildSplineDeformMeshGroup({
        actor: options.actor,
        gltf,
        definition: deformDefinition,
        ...(segmentIndex === undefined ? {} : { segmentIndex }),
        castShadow: options.castShadow,
        receiveShadow: options.receiveShadow,
        cache: curve,
        sharedMaterials,
      });
      triangleCount += built.triangleCount;
      warnings.push(...built.warnings);
      if (!built.group) continue;
      built.group.traverse((child) => { child.raycast = () => {}; });
      options.applyMaterialSlots?.(generator.meshAsset, built.group);
      group.add(built.group);
    }
  }
  group.userData.splineWarnings = warnings;
  return { group: group.children.length > 0 ? group : null, meshes, instanceCount, triangleCount, missingAssetIds, warnings };
}

/** Releases only geometry/materials created by deformed spline generators. */
export function disposeSplineGeneratedGroup(group: Group): void {
  const pluginDisposals = group.userData.splinePluginDisposals as Array<() => void> | undefined;
  for (const dispose of pluginDisposals ?? []) dispose();
  delete group.userData.splinePluginDisposals;
  group.traverse((child) => {
    if (!(child instanceof Mesh) || !child.userData.splineGeneratedGeometry) return;
    child.geometry.dispose();
    if (child.userData.splineSharedMaterial) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
  disposeSplineSharedMaterials(group.userData.splineSharedMaterials as Map<Material, Material> | undefined);
  group.removeFromParent();
}

/**
 * Builds the instanced static-mesh group for a landscape's spline mesh segments
 * (Faz 6 Road Tool). Instances are landscape-local, so the returned group is
 * meant to be added as a child of the landscape object and inherit its transform.
 * Returns null when the landscape has no placeable spline meshes (or none of the
 * referenced assets are loaded). Assets absent from `models` are skipped.
 */
export function buildLandscapeSplineMeshGroup(options: {
  data: TerrainSplineMeshSource;
  models: ReadonlyMap<string, GLTF>;
  castShadow: boolean;
  receiveShadow: boolean;
  /**
   * Applies the asset's default material-slot overrides to its instanced
   * sub-group. Spline meshes share the raw GLTF material by default, so an asset
   * whose look comes from a `*.materials.json` slot assignment (e.g. an asphalt
   * road whose GLTF ships a plain white material) renders untextured unless the
   * host wires this to its material cache. Invoked once per asset sub-group.
   */
  applyMaterialSlots?: (assetId: string, assetGroup: Group) => void;
}): { group: Group; meshes: InstancedMesh[] } | null {
  const itemsByAsset = new Map<string, { assetId: string; collision: boolean; items: InstanceRenderItem[] }>();
  const deformChains: LandscapeSplineMeshChain[] = [];
  const meshForwardLengths = new Map<string, number>();
  for (const [assetId, gltf] of options.models) {
    gltf.scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(gltf.scene);
    const length = bounds.max.z - bounds.min.z;
    if (length > 1e-6) meshForwardLengths.set(assetId, length);
  }
  for (const spline of options.data.splines ?? []) {
    if (spline.hidden) continue;
    deformChains.push(...resolveLandscapeSplineMeshChains(spline, spline.smooth ? 32 : 1));
    for (const instance of computeLandscapeSplineMeshInstances(spline, {
      ...("normalAt" in options.data ? { normalAt: options.data.normalAt } : { landscape: options.data }), meshForwardLengths,
    })) {
      const key = `${instance.assetId}:${instance.collision}`;
      const batch = itemsByAsset.get(key) ?? { assetId: instance.assetId, collision: instance.collision, items: [] };
      batch.items.push({
        matrix: new Matrix4().compose(
          new Vector3(...instance.position),
          new Quaternion(...instance.orientation),
          new Vector3(...instance.scale),
        ),
        hidden: false,
      });
      itemsByAsset.set(key, batch);
    }
  }
  if (itemsByAsset.size === 0 && deformChains.length === 0) return null;

  const group = new Group();
  group.name = "LandscapeSplineMeshes";
  const meshes: InstancedMesh[] = [];
  for (const { assetId, collision, items } of itemsByAsset.values()) {
    const gltf = options.models.get(assetId);
    if (!gltf) continue;
    const built = createInstancedModelGroup({
      assetId,
      gltf,
      items,
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
    });
    options.applyMaterialSlots?.(assetId, built.group);
    built.group.traverse((child) => { child.userData.splineCollision = collision; child.userData.landscapeSplineMesh = true; });
    group.add(built.group);
    meshes.push(...built.meshes);
  }
  const deformedGroups = new Map<string, Group>();
  for (const [chainIndex, chain] of deformChains.entries()) {
    const gltf = options.models.get(chain.assetId);
    if (!gltf) continue;
    let assetGroup = deformedGroups.get(chain.assetId);
    if (!assetGroup) {
      assetGroup = new Group();
      assetGroup.name = `deformed-${chain.assetId}`;
      deformedGroups.set(chain.assetId, assetGroup);
      group.add(assetGroup);
    }
    // Closed chains keep their public point list de-duplicated, but the render
    // sampler needs the closing point to cover the final segment's distance.
    const chainPath = chain.closed ? [...chain.points, chain.points[0]!] : chain.points;
    let primitiveIndex = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometries: BufferGeometry[] = [];
      // A collision toggle must not split the visual chain's shared frames/UVs.
      // Only mixed chains need a separate CPU triangle subset before welding.
      const collisionSubset = chain.collision && chain.segments.some((segment) => !segment.collision)
        ? { vertices: [] as Vec3[], indices: [] as number[] } : null;
      for (const segment of chain.segments) {
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
        const deformed = deformSplineMeshGeometry(geometry, {
          ...chain,
          points: chainPath,
          distanceStart: segment.distanceStart,
          pathDistanceStart: segment.distanceStart,
          pathDistanceEnd: segment.distanceEnd,
          totalLength: chain.totalLength,
          recomputeNormals: false,
        }, options.data);
        if (!deformed) continue;
        // Normals/tangents from the source mesh are invalid after bending. Leave
        // normals to the welded result; standard materials derive tangents when
        // needed, avoiding a stale normal-map frame at a chain join.
        deformed.deleteAttribute("normal");
        deformed.deleteAttribute("tangent");
        if (collisionSubset && segment.collision) {
          const positions = deformed.getAttribute("position");
          const base = collisionSubset.vertices.length;
          for (let i = 0; i < positions.count; i++) collisionSubset.vertices.push([positions.getX(i), positions.getY(i), positions.getZ(i)]);
          const indices = deformed.index;
          for (let i = 0; i < (indices?.count ?? positions.count); i++) collisionSubset.indices.push(base + (indices ? indices.getX(i) : i));
        }
        geometries.push(deformed);
      }
      const deformed = mergeAndWeldSplineGeometries(geometries);
      if (!deformed) {
        primitiveIndex += 1;
        return;
      }
      const mesh = new Mesh(deformed, object.material);
      mesh.name = `${chain.assetId}-${object.name || `primitive-${primitiveIndex}`}-chain-${chainIndex}`;
      mesh.castShadow = options.castShadow;
      mesh.receiveShadow = options.receiveShadow;
      mesh.userData.assetId = chain.assetId;
      mesh.userData.splineCollision = chain.collision;
      if (collisionSubset) mesh.userData.splineCollisionSubset = collisionSubset;
      mesh.userData.landscapeSplineMesh = true;
      mesh.userData.landscapeSplineGeometry = true;
      assetGroup!.add(mesh);
      primitiveIndex += 1;
    });
  }
  for (const [assetId, assetGroup] of deformedGroups) {
    if (assetGroup.children.length === 0) {
      group.remove(assetGroup);
      continue;
    }
    options.applyMaterialSlots?.(assetId, assetGroup);
  }
  if (meshes.length === 0 && group.children.length === 0) return null;
  return { group, meshes };
}

/**
 * Landscape-local triangles of a built spline mesh group, for a static trimesh
 * collider. Without it a road is render-only: wheels and feet land on the
 * flattened heightfield below it and sink by the road mesh's offset +
 * thickness. The render geometry is the single source of truth, so collision
 * matches what is drawn. `collidable` filters by asset (the manifest's
 * `runtime.collision`); returns null when nothing collidable was built.
 */
export function landscapeSplineMeshColliderPrimitive(
  group: Group,
  collidable: (assetId: string) => boolean,
): { vertices: Vec3[]; indices: number[]; size: Vec3; center: Vec3 } | null {
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const point = new Vector3();
  const instanceMatrix = new Matrix4();
  const pushVertex = (point: Vector3): void => {
    vertices.push([point.x, point.y, point.z]);
    min[0] = Math.min(min[0], point.x); min[1] = Math.min(min[1], point.y); min[2] = Math.min(min[2], point.z);
    max[0] = Math.max(max[0], point.x); max[1] = Math.max(max[1], point.y); max[2] = Math.max(max[2], point.z);
  };
  const pushGeometry = (geometry: BufferGeometry, matrix: Matrix4 | null): void => {
    const position = geometry.getAttribute("position");
    if (!position) return;
    const offset = vertices.length;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index);
      if (matrix) point.applyMatrix4(matrix);
      pushVertex(point);
    }
    const source = geometry.index;
    const count = source ? source.count : position.count;
    for (let index = 0; index < count; index += 1) indices.push(offset + (source ? source.getX(index) : index));
  };
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const assetId = child.userData.assetId;
    if (typeof assetId !== "string" || child.userData.splineCollision === false || !collidable(assetId)) return;
    const subset = child.userData.splineCollisionSubset as { vertices: Vec3[]; indices: number[] } | undefined;
    if (subset) {
      const base = vertices.length;
      for (const vertex of subset.vertices) pushVertex(point.set(...vertex));
      for (const index of subset.indices) indices.push(base + index);
      return;
    }
    const instanced = child as Mesh & Partial<InstancedMesh>;
    if (instanced.isInstancedMesh) {
      for (let index = 0; index < instanced.count!; index += 1) {
        instanced.getMatrixAt!(index, instanceMatrix);
        pushGeometry(child.geometry, instanceMatrix);
      }
      return;
    }
    // Deformed chains are already baked in landscape-local space.
    pushGeometry(child.geometry, null);
  });
  if (indices.length < 3) return null;
  return {
    vertices,
    indices,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

/** Dispose owned bent geometry; rigid instances and source materials are shared. */
export function disposeLandscapeSplineMeshGroup(group: Group): void {
  group.removeFromParent();
  group.traverse((child) => {
    if (child instanceof Mesh && child.userData.landscapeSplineGeometry) child.geometry.dispose();
  });
}

export interface LandscapeSplineMeshDeformPath {
  assetId: string;
  points: readonly Vec3[];
  scale: Vec3;
  offset: Vec3;
  yawOffset: number;
  bank: number;
  alignToTerrain: boolean;
  /** Distance from the beginning of a welded chain; defaults to zero for one segment. */
  distanceStart?: number;
  /** Chain distance sampled by the source mesh's local beginning. */
  pathDistanceStart?: number;
  /** Chain distance sampled by the source mesh's local end. */
  pathDistanceEnd?: number;
  /** Total welded-chain arc length. Used only for introspection/future frame caching. */
  totalLength?: number;
  /** Recalculate normals immediately; false lets the caller weld first. */
  recomputeNormals?: boolean;
}

interface DeformPathSample {
  position: Vector3;
  tangent: Vector3;
}

/**
 * Bends a static mesh authored along local +Z through a sampled spline path.
 * The UV component that actually follows the source mesh's +Z span follows the
 * chain's cumulative arc length, while the cross-road component is preserved.
 * Callers building a chain may defer normal generation until after the pieces
 * have been welded.
 */
export function deformSplineMeshGeometry(
  geometry: BufferGeometry,
  path: LandscapeSplineMeshDeformPath,
  landscape: TerrainSplineMeshSource,
): BufferGeometry | null {
  const positions = geometry.getAttribute("position");
  if (!positions) return null;
  geometry.applyMatrix4(new Matrix4().makeRotationY((path.yawOffset * Math.PI) / 180));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;
  const sourceLength = bounds.max.z - bounds.min.z;
  const pathLengths = pathSegmentLengths(path.points);
  if (sourceLength <= 1e-6 || pathLengths.total <= 1e-6) return null;

  const source = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const uv = geometry.getAttribute("uv");
  const longitudinalUv = uv ? resolveLongitudinalSplineUvComponent(geometry, bounds) : null;
  const tileLength = sourceLength;
  const distanceStart = path.distanceStart ?? 0;
  const pathDistanceStart = path.pathDistanceStart ?? 0;
  const pathDistanceEnd = path.pathDistanceEnd ?? pathLengths.total;
  const pathDistanceSpan = pathDistanceEnd - pathDistanceStart;
  if (pathDistanceSpan <= 1e-6 || pathDistanceEnd > pathLengths.total + 1e-4) return null;
  for (let index = 0; index < positions.count; index += 1) {
    source.fromBufferAttribute(positions, index);
    // GLTF node rotations can leave a source end-ring's nominally identical Z
    // values a few floating-point ulps apart. Snap those values to the exact
    // path endpoint so every vertex in the ring receives the same chain frame.
    const rawSourceT = (source.z - bounds.min.z) / sourceLength;
    const sourceT = rawSourceT <= 1e-5 ? 0 : rawSourceT >= 1 - 1e-5 ? 1 : rawSourceT;
    const pathDistance = pathDistanceStart + Math.min(1, Math.max(0, sourceT)) * pathDistanceSpan;
    const sample = sampleDeformPathAtDistance(path.points, pathLengths.lengths, pathLengths.total, pathDistance);
    if (!sample) continue;
    const upHint = path.alignToTerrain
      ? terrainNormalAt(landscape, sample.position.x, sample.position.z)
      : new Vector3(0, 1, 0);
    right.crossVectors(upHint, sample.tangent).normalize();
    if (right.lengthSq() <= 1e-8) right.crossVectors(new Vector3(0, 0, 1), sample.tangent).normalize();
    up.crossVectors(sample.tangent, right).normalize();
    if (Math.abs(path.bank) > 1e-6) {
      const bankRadians = (path.bank * Math.PI) / 180;
      right.applyAxisAngle(sample.tangent, bankRadians);
      up.crossVectors(sample.tangent, right).normalize();
    }
    const x = source.x * path.scale[0];
    const y = source.y * path.scale[1];
    positions.setXYZ(
      index,
      sample.position.x + right.x * x + up.x * y + path.offset[0],
      sample.position.y + right.y * x + up.y * y + path.offset[1],
      sample.position.z + right.z * x + up.z * y + path.offset[2],
    );
    if (uv && longitudinalUv) {
      const distanceUv = (distanceStart + Math.min(1, Math.max(0, sourceT)) * pathDistanceSpan) / tileLength;
      if (longitudinalUv === "u") uv.setX(index, distanceUv);
      else uv.setY(index, distanceUv);
    }
  }
  positions.needsUpdate = true;
  if (uv) uv.needsUpdate = true;
  if (path.recomputeNormals !== false) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Determines whether `u` or `v` progresses along the geometry's deformed +Z
 * source span. Most road meshes use `v`, but imported meshes can carry a node
 * rotation that makes the source path run through `u` instead (SM_Asphalt).
 * A correlation score keeps the render path generic without adding per-asset
 * authoring metadata for an otherwise standard UV layout.
 */
function resolveLongitudinalSplineUvComponent(geometry: BufferGeometry, bounds: Box3): "u" | "v" {
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!positions || !uv || positions.count === 0 || uv.count !== positions.count) return "v";
  const sourceLength = bounds.max.z - bounds.min.z;
  if (sourceLength <= 1e-6) return "v";
  let count = 0;
  let sumT = 0;
  let sumU = 0;
  let sumV = 0;
  let sumTT = 0;
  let sumTU = 0;
  let sumTV = 0;
  let sumUU = 0;
  let sumVV = 0;
  for (let index = 0; index < positions.count; index += 1) {
    const t = (positions.getZ(index) - bounds.min.z) / sourceLength;
    const u = uv.getX(index);
    const v = uv.getY(index);
    count += 1;
    sumT += t;
    sumU += u;
    sumV += v;
    sumTT += t * t;
    sumTU += t * u;
    sumTV += t * v;
    sumUU += u * u;
    sumVV += v * v;
  }
  const covariance = (sumXY: number, sumX: number, sumY: number): number => sumXY - (sumX * sumY) / count;
  const varT = covariance(sumTT, sumT, sumT);
  const varU = covariance(sumUU, sumU, sumU);
  const varV = covariance(sumVV, sumV, sumV);
  const scoreU = varT > 1e-8 && varU > 1e-8 ? Math.abs(covariance(sumTU, sumT, sumU)) / Math.sqrt(varT * varU) : 0;
  const scoreV = varT > 1e-8 && varV > 1e-8 ? Math.abs(covariance(sumTV, sumT, sumV)) / Math.sqrt(varT * varV) : 0;
  return scoreU > scoreV ? "u" : "v";
}

function mergeAndWeldSplineGeometries(geometries: BufferGeometry[]): BufferGeometry | null {
  if (geometries.length === 0) return null;
  const merged = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false);
  if (!merged) {
    for (const geometry of geometries) geometry.dispose();
    return null;
  }
  if (geometries.length > 1) {
    for (const geometry of geometries) geometry.dispose();
  }
  const welded = mergeVertices(merged, 1e-5);
  if (welded !== merged) merged.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

function pathSegmentLengths(points: readonly Vec3[]): { lengths: number[]; total: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    lengths.push(length);
    total += length;
  }
  return { lengths, total };
}

function sampleDeformPathAtDistance(
  points: readonly Vec3[],
  lengths: readonly number[],
  total: number,
  requestedDistance: number,
): DeformPathSample | null {
  const distance = Math.min(total, Math.max(0, requestedDistance));
  let consumed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (distance > consumed + length && index < lengths.length - 1) {
      consumed += length;
      continue;
    }
    if (length <= 1e-6) continue;
    const a = points[index]!;
    const b = points[index + 1]!;
    const local = (distance - consumed) / length;
    return {
      position: new Vector3(a[0], a[1], a[2]).lerp(new Vector3(b[0], b[1], b[2]), local),
      tangent: new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(),
    };
  }
  return null;
}

function terrainNormalAt(landscape: TerrainSplineMeshSource, x: number, z: number): Vector3 {
  return new Vector3(...landscape.normalAt(x, z));
}

/**
 * Build the scene object for a character placement. Routes the layout character
 * through the entity/component model (same transform round-trip as the legacy
 * placement path) before the engine builds the renderable object.
 */
export function buildSceneCharacterObject(
  gltf: GLTF,
  placement: LayoutCharacter,
  index: number,
): Object3D {
  return createCharacterSceneObject(
    gltf,
    entityCharacterItem(characterEntity(index, placement)),
  );
}

/**
 * Create a playing animation mixer for a character if the named clip exists,
 * otherwise return null. The caller registers the mixer with its animation
 * subsystem.
 */
export function createSceneCharacterMixer(
  character: Object3D,
  gltf: GLTF,
  animationName: string | undefined,
  rootMotion?: readonly RootMotionClipSetting[],
): AnimationMixer | null {
  const clip = animationName
    ? gltf.animations.find((candidate) => candidate.name === animationName)
    : null;
  if (!clip) return null;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(applyRootMotionToClip(clip, rootMotion?.find((setting) => setting.clip === clip.name))).play();
  return mixer;
}

/**
 * Build the Three.js light record for a layout actor. Routes the actor through
 * the entity/component model (same light/transform round-trip as the legacy
 * actor path). The caller adds the record to the scene and tracks it.
 */
export function buildSceneLightObject(
  actor: LayoutLightActor,
  index: number,
  options: { gizmo?: boolean } = {},
): LightObjectRecord {
  return createThreeLightObject(
    entityLightItem(lightEntity(index, actor)),
    DEFAULT_SCENE_LIGHT_COLOR,
    options,
  );
}

/** The render item buildSceneLightObject builds a layout light from. */
export function sceneLightItem(actor: LayoutLightActor, index: number): LightRenderItem {
  return entityLightItem(lightEntity(index, actor));
}

/** Tag a light record's root + descendants with their light index for picking. */
export function tagSceneLightRecordIndex(record: LightObjectRecord, index: number): void {
  record.root.userData.lightIndex = index;
  record.root.traverse((child) => {
    child.userData.lightIndex = index;
  });
}

/**
 * Whether a newly added directional actor should become the scene sun: true when
 * no sun is tracked yet, or the actor is the canonical default-sun id.
 */
export function isSceneSunLight(
  actor: LayoutLightActor,
  currentSun: DirectionalLight | null,
): boolean {
  return (
    actor.type === "directional" &&
    (!currentSun || actor.id === DEFAULT_SCENE_SUN_ID)
  );
}

/**
 * Compute the local-space bounding box of every loaded model, keyed by asset id.
 * Mirrors the bounds both shells build before placing instances; the world
 * matrices are refreshed first so `setFromObject` sees the model's own geometry.
 */
export function computeModelLocalBounds(
  models: ReadonlyMap<string, GLTF>,
): Map<string, Box3> {
  const localBounds = new Map<string, Box3>();
  for (const [assetId, gltf] of models) {
    gltf.scene.updateMatrixWorld(true);
    localBounds.set(assetId, new Box3().setFromObject(gltf.scene));
  }
  return localBounds;
}

export interface AssetComplexCollisionMesh {
  vertices: Vec3[];
  indices: number[];
  size: Vec3;
  center: Vec3;
}

/**
 * Triangle data (render-mesh) for every model in `assetIds`, used by the
 * `complexAsSimple` collision complexity to build a static trimesh collider.
 * `assetIds` is required so we never pay the per-vertex flatten for models that
 * don't opt in (the common case).
 */
export function computeComplexCollisionMeshes(
  models: ReadonlyMap<string, GLTF>,
  assetIds: ReadonlySet<string>,
): Map<string, AssetComplexCollisionMesh> {
  const meshes = new Map<string, AssetComplexCollisionMesh>();
  for (const assetId of assetIds) {
    const gltf = models.get(assetId);
    if (!gltf) continue;
    const mesh = complexCollisionMeshFromGltf(gltf);
    if (mesh) meshes.set(assetId, mesh);
  }
  return meshes;
}

function complexCollisionMeshFromGltf(gltf: GLTF): AssetComplexCollisionMesh | null {
  gltf.scene.updateMatrixWorld(true);
  const vertices: Vec3[] = [];
  const indices: number[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (!geometry || typeof geometry.getAttribute !== "function") return;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const base = vertices.length;
    const vertex = new Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      vertices.push([vertex.x, vertex.y, vertex.z]);
    }
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      for (let index = 0; index < indexAttr.count; index += 3) {
        indices.push(
          base + indexAttr.getX(index),
          base + indexAttr.getX(index + 1),
          base + indexAttr.getX(index + 2),
        );
      }
    } else {
      for (let index = 0; index < position.count - 2; index += 3) {
        indices.push(base + index, base + index + 1, base + index + 2);
      }
    }
  });
  if (vertices.length < 3 || indices.length < 3) return null;
  const box = new Box3().setFromPoints(vertices.map((point) => new Vector3(point[0], point[1], point[2])));
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return {
    vertices,
    indices,
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  };
}

/**
 * Register synthetic procedural models for every `shape:<type>` instance in the
 * layout, mutating `models` + `localBounds` in place. Shape actors persist as
 * ordinary instances under a synthetic `shape:<type>` asset id that no loadGroup
 * provides, so both shells must build the primitive GLTF (and its bounds) before
 * the scene is constructed — otherwise the instanced-model builder throws on the
 * missing asset, aborting the rest of scene construction (lights, characters,
 * world settings included). Already-registered or non-shape ids are skipped.
 */
export function registerSceneShapeModels(
  layout: RoomLayout | null,
  models: Map<string, GLTF>,
  localBounds: Map<string, Box3>,
): void {
  for (const instance of layout?.instances ?? []) {
    const assetId = instance.assetId;
    if (models.has(assetId)) continue;
    const gltf = createProceduralAssetGltf(assetId);
    if (!gltf) continue;
    models.set(assetId, gltf);
    for (const [id, box] of computeModelLocalBounds(new Map([[assetId, gltf]]))) {
      localBounds.set(id, box);
    }
  }
}

/**
 * Model asset ids that the scene graph will instantiate. This includes authored
 * instances and characters, but excludes procedural `shape:<type>` ids because
 * those are registered locally instead of loaded from the asset manifest.
 */
export function sceneModelAssetIds(layout: RoomLayout | null): string[] {
  const ids = new Set<string>();
  for (const instance of layout?.instances ?? []) {
    if (!isProceduralAssetId(instance.assetId)) ids.add(instance.assetId);
  }
  for (const character of layout?.characters ?? []) {
    ids.add(character.assetId);
  }
  for (const spline of layout?.splines ?? []) {
    for (const generator of spline.generators ?? []) {
      if (generator.type === "instances") {
        const resolved = resolveSplineInstanceGenerator(generator);
        if (resolved.enabled && resolved.meshAsset && !isProceduralAssetId(resolved.meshAsset)) ids.add(resolved.meshAsset);
      } else if (generator.type === "rigidSegments") {
        const resolved = resolveSplineRigidSegmentGenerator(generator);
        if (resolved.enabled && resolved.meshAsset && !isProceduralAssetId(resolved.meshAsset)) ids.add(resolved.meshAsset);
        if (resolved.enabled && resolved.placePostsAtJoints && resolved.jointMeshAsset && !isProceduralAssetId(resolved.jointMeshAsset)) ids.add(resolved.jointMeshAsset);
      } else if (generator.type === "deformMesh") {
        const resolved = resolveSplineDeformMeshGenerator(generator);
        if (resolved.enabled && resolved.meshAsset && !isProceduralAssetId(resolved.meshAsset)) ids.add(resolved.meshAsset);
      }
    }
  }
  return [...ids];
}

/**
 * Drive the shared scene-build iteration: instances, then characters, then
 * lights, in the exact order both shells use. The handlers stay in the shell so
 * each can apply its own per-entity policy (editor selection refresh, etc.).
 */
export function buildSceneEntities(
  layout: RoomLayout,
  handlers: {
    addInstance: (assetId: string, placements: LayoutPlacement[]) => void;
    addCharacter: (assetId: string, character: LayoutCharacter) => void;
    addLight: (light: LayoutLightActor) => void;
  },
): void {
  for (const instance of layout.instances) {
    handlers.addInstance(instance.assetId, instance.placements);
  }
  for (const character of layout.characters) {
    handlers.addCharacter(character.assetId, character);
  }
  for (const light of layout.lights ?? []) {
    handlers.addLight(light);
  }
}

/** Receives the derived entity set and optional incremental runtime changes. */
export interface SceneEntitySink {
  setEntities(entities: readonly Entity[]): void;
  /** Starts tracking one entity as setEntities would, without resetting any other entity's state. */
  addEntity?(entity: Entity): void;
  /** Stops tracking one entity and releases its held state; unknown ids are a no-op. */
  removeEntity?(entityId: string): void;
}

/** Engine-core spine brought online once the scene is fully built. */
export interface SceneEngineSpine {
  init(): Promise<void>;
  start(): Promise<void>;
}

/**
 * Bring the engine-core spine online once the scene graph is built: hand the
 * derived entity set to physics + behavior, then init and start the engine.
 * The order is a shared contract — physics relies on `setEntities()` running
 * before `init()` to decide whether to load Rapier (see PhysicsSubsystem).
 */
export async function startSceneRuntime(options: {
  sceneDocument: SceneDocument;
  /** Streamed physics resources must not be retained by persistent module/behavior contexts. */
  additionalPhysicsEntities?: readonly Entity[];
  physics: SceneEntitySink;
  behavior: SceneEntitySink;
  characterMovement?: SceneEntitySink;
  /**
   * Sinks contributed by Layer 2 capability modules (moving platforms, spline
   * followers…), fed in module-registration order. They see the entity set
   * after physics and before the shell's remaining subsystems, which is where
   * the subsystems they replaced used to be seeded.
   */
  moduleSinks?: readonly SceneEntitySink[];
  ai?: SceneEntitySink;
  engineApp: SceneEngineSpine;
}): Promise<void> {
  options.physics.setEntities(options.additionalPhysicsEntities?.length
    ? [...options.sceneDocument.entities, ...options.additionalPhysicsEntities]
    : options.sceneDocument.entities);
  for (const sink of options.moduleSinks ?? []) sink.setEntities(options.sceneDocument.entities);
  options.characterMovement?.setEntities(options.sceneDocument.entities);
  options.ai?.setEntities(options.sceneDocument.entities);
  options.behavior.setEntities(options.sceneDocument.entities);
  await options.engineApp.init();
  await options.engineApp.start();
}
