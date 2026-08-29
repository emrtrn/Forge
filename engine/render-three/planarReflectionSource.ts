import {
  Box3,
  HalfFloatType,
  Matrix4,
  NoToneMapping,
  Object3D,
  Plane,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";

/** Reserved opt-out layer for editor helpers, UI meshes and reflection-only FX. */
export const PLANAR_REFLECTION_EXCLUDED_LAYER = 31;

/** Keeps a source camera's normal visibility mask while removing the opt-out layer. */
export function planarReflectionLayerMask(mask: number): number {
  return mask & ~(1 << PLANAR_REFLECTION_EXCLUDED_LAYER);
}

/**
 * The one reflection texture/matrix a family of coplanar consumers samples. How
 * much of it a consumer blends in is deliberately not here: coplanar bodies share
 * the capture but each authors its own strength.
 */
export interface PlanarReflectionBinding {
  readonly texture: Texture;
  readonly textureMatrix: Matrix4;
}

/** A visible surface sampling a {@link PlanarReflectionSource}. */
interface PlanarReflectionConsumer extends Object3D {
  setPlanarReflectionBinding?(binding: PlanarReflectionBinding | null): void;
}

export type PlanarReflectionQuality = "medium" | "high";

const QUALITY_SETTINGS: Record<PlanarReflectionQuality, { resolution: number; minUpdateMs: number }> = {
  medium: { resolution: 256, minUpdateMs: 32 },
  high: { resolution: 512, minUpdateMs: 4 },
};

/**
 * Fraction of the viewport a group's water must cover before its reflection is
 * worth a whole extra scene render.
 *
 * There is a real measurement behind this number. A Level authored one river at
 * `sharedPlanar/high` and a strategic camera that barely showed it — often only
 * a sliver at the screen edge, and in game mode the reflection was not visible
 * at all. It still cost **7.3 ms of GPU and 8.7 ms of CPU per frame**, over half
 * the frame, because the only condition on the nested render was a 4 ms
 * interval. Turning it off halved the frame time.
 *
 * Frustum culling alone does not catch this: a river ribbon follows a long
 * spline, so its bounds stay on screen long after the water itself stops being
 * worth resolving. What the cost has to be gated on is how much of the screen
 * the result will actually occupy.
 */
export const PLANAR_REFLECTION_MIN_SCREEN_COVERAGE = 0.01;

/**
 * Fraction of the viewport `bounds` projects onto, clipped to the screen — or
 * `null` when it cannot be answered from a projection alone.
 *
 * `null` means "a corner is at or behind the eye", where the perspective divide
 * stops being meaningful and a box can wrap around the viewer. The caller must
 * read that as *render*, never as *skip*: a cheap gate is allowed to cost a
 * frame it did not have to, and is not allowed to drop one it did.
 *
 * The screen-aligned bound of a projected box overestimates a diagonal or curved
 * body, which errs the same way on purpose.
 */
export function planarReflectionScreenCoverage(bounds: Box3, viewProjection: Matrix4): number | null {
  if (bounds.isEmpty()) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corner = new Vector4();
  for (let index = 0; index < 8; index += 1) {
    corner.set(
      index & 1 ? bounds.max.x : bounds.min.x,
      index & 2 ? bounds.max.y : bounds.min.y,
      index & 4 ? bounds.max.z : bounds.min.z,
      1,
    );
    corner.applyMatrix4(viewProjection);
    if (corner.w <= 0) return null;
    const x = corner.x / corner.w;
    const y = corner.y / corner.w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Clipped against the [-1, 1] cube, so a body mostly off-screen is charged
  // only for the part of the screen it can actually reach.
  const width = Math.min(maxX, 1) - Math.max(minX, -1);
  const height = Math.min(maxY, 1) - Math.max(minY, -1);
  if (width <= 0 || height <= 0) return 0;
  // NDC spans 2×2, so that is the whole viewport.
  return (width * height) / 4;
}

/**
 * One horizontal planar-reflection render source shared by every consumer in a
 * River Water Body group. It intentionally owns no visible geometry: consumers
 * call {@link update} during their draw, while this source hides all consumers
 * for the nested scene render and restores them afterwards.
 */
export class PlanarReflectionSource {
  readonly textureMatrix = new Matrix4();
  /** Kept stable so a consumer can retain the matrix while the target changes. */
  readonly binding: PlanarReflectionBinding;
  private renderTarget: WebGLRenderTarget | null;
  private readonly planeY: number;
  private readonly reflectionCameras = new WeakMap<Camera, Camera>();
  private readonly consumers = new Set<PlanarReflectionConsumer>();
  private minUpdateMs = Infinity;
  private lastUpdateAt = -Infinity;
  private rendering = false;
  /** Scratch for the per-frame coverage gate, which must not allocate. */
  private readonly consumerBounds = new Box3();
  private readonly viewProjection = new Matrix4();

  constructor(planeY: number, quality: PlanarReflectionQuality) {
    const settings = QUALITY_SETTINGS[quality];
    this.planeY = planeY;
    this.minUpdateMs = settings.minUpdateMs;
    this.renderTarget = this.createRenderTarget(quality);
    this.binding = {
      texture: this.renderTarget.texture,
      textureMatrix: this.textureMatrix,
    };
  }

  private createRenderTarget(quality: PlanarReflectionQuality): WebGLRenderTarget {
    const settings = QUALITY_SETTINGS[quality];
    return new WebGLRenderTarget(settings.resolution, settings.resolution, {
      samples: quality === "high" ? 2 : 0,
      type: HalfFloatType,
    });
  }

  addConsumer(object: Object3D): void {
    const consumer = object as PlanarReflectionConsumer;
    this.consumers.add(consumer);
    consumer.setPlanarReflectionBinding?.(this.renderTarget ? this.binding : null);
  }

  removeConsumer(object: Object3D): void {
    this.consumers.delete(object);
  }

  dispose(): void {
    this.consumers.clear();
    this.renderTarget?.dispose();
    this.renderTarget = null;
  }

  /** Changes the runtime graphics tier without rebuilding the authored world. */
  setQuality(quality: PlanarReflectionQuality | null): void {
    const current = this.renderTarget;
    if (quality === null) {
      if (!current) return;
      current.dispose();
      this.renderTarget = null;
      this.notifyConsumers(null);
      return;
    }
    const settings = QUALITY_SETTINGS[quality];
    if (current && current.width === settings.resolution) {
      this.minUpdateMs = settings.minUpdateMs;
      return;
    }
    current?.dispose();
    this.renderTarget = this.createRenderTarget(quality);
    (this.binding as { texture: Texture }).texture = this.renderTarget.texture;
    this.minUpdateMs = settings.minUpdateMs;
    this.lastUpdateAt = -Infinity;
    this.notifyConsumers(this.binding);
  }

  private notifyConsumers(binding: PlanarReflectionBinding | null): void {
    for (const consumer of this.consumers) consumer.setPlanarReflectionBinding?.(binding);
  }

  /** Updates at most once per profile interval, even when several ribbons draw in one frame. */
  update(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (this.rendering || !this.renderTarget) return;
    // Before the interval check, and without stamping `lastUpdateAt`: a frame
    // skipped for being invisible must not also postpone the frame after it.
    const coverage = this.screenCoverage(camera);
    if (coverage !== null && coverage < PLANAR_REFLECTION_MIN_SCREEN_COVERAGE) return;
    const now = performance.now();
    if (now - this.lastUpdateAt < this.minUpdateMs) return;
    this.lastUpdateAt = now;
    this.rendering = true;
    try {
      this.renderReflection(renderer, scene, camera);
    } finally {
      this.rendering = false;
    }
  }

  /**
   * How much of the screen this group's water covers this frame.
   *
   * Runs before the reflection rather than after, so the frame that brings water
   * back on screen is the frame that refreshes it — there is no stale capture to
   * see on the way in. Hidden consumers are left out: a body that is not drawn
   * cannot show a reflection.
   */
  private screenCoverage(camera: Camera): number | null {
    const bounds = this.consumerBounds.makeEmpty();
    for (const consumer of this.consumers) {
      if (consumer.visible) bounds.expandByObject(consumer);
    }
    const viewProjection = this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    return planarReflectionScreenCoverage(bounds, viewProjection);
  }

  private renderReflection(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const reflectionCamera = this.getReflectionCamera(camera);
    const reflectorPosition = new Vector3(0, this.planeY, 0);
    const normal = new Vector3(0, 1, 0);
    const cameraPosition = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const view = new Vector3().subVectors(reflectorPosition, cameraPosition);
    if (view.dot(normal) > 0) return;

    view.reflect(normal).negate().add(reflectorPosition);
    const rotationMatrix = new Matrix4().extractRotation(camera.matrixWorld);
    const lookAtPosition = new Vector3(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraPosition);
    const target = new Vector3()
      .subVectors(reflectorPosition, lookAtPosition)
      .reflect(normal)
      .negate()
      .add(reflectorPosition);
    reflectionCamera.position.copy(view);
    reflectionCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
    reflectionCamera.lookAt(target);
    reflectionCamera.updateMatrixWorld();

    const perspective = reflectionCamera as Camera & {
      far: number;
      projectionMatrix: Matrix4;
      matrixWorldInverse: Matrix4;
    };
    const sourcePerspective = camera as Camera & { far: number; projectionMatrix: Matrix4 };
    perspective.far = sourcePerspective.far;
    perspective.projectionMatrix.copy(sourcePerspective.projectionMatrix);
    // Keep the caller's normal scene layers, but never render opt-out helpers
    // into water. Runtime UI is DOM-based today; this reserved Three layer covers
    // editor gizmos and any future world-space UI/FX explicitly placed on it.
    reflectionCamera.layers.mask = planarReflectionLayerMask(camera.layers.mask);

    // World-space projection: unlike a flat ReflectiveSurface plane, a ribbon
    // consumer has its own transform, so its shader multiplies this by modelMatrix.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(perspective.projectionMatrix);
    this.textureMatrix.multiply(perspective.matrixWorldInverse);

    const reflectorPlane = new Plane().setFromNormalAndCoplanarPoint(normal, reflectorPosition);
    reflectorPlane.applyMatrix4(perspective.matrixWorldInverse);
    const clipPlane = new Vector4(
      reflectorPlane.normal.x,
      reflectorPlane.normal.y,
      reflectorPlane.normal.z,
      reflectorPlane.constant,
    );
    const projection = perspective.projectionMatrix;
    const q = new Vector4(
      (Math.sign(clipPlane.x) + projection.elements[8]!) / projection.elements[0]!,
      (Math.sign(clipPlane.y) + projection.elements[9]!) / projection.elements[5]!,
      -1,
      (1 + projection.elements[10]!) / projection.elements[14]!,
    );
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    projection.elements[2] = clipPlane.x;
    projection.elements[6] = clipPlane.y;
    projection.elements[10] = clipPlane.z + 1 - 0.003;
    projection.elements[14] = clipPlane.w;

    const hidden = [...this.consumers].map((consumer) => [consumer, consumer.visible] as const);
    for (const [consumer] of hidden) consumer.visible = false;
    const previousTarget = renderer.getRenderTarget();
    const previousToneMapping = renderer.toneMapping;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousXrEnabled = renderer.xr.enabled;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.toneMapping = NoToneMapping;
      renderer.setRenderTarget(this.renderTarget);
      renderer.state.buffers.depth.setMask(true);
      if (renderer.autoClear === false) renderer.clear();
      renderer.render(scene, reflectionCamera);
    } finally {
      renderer.xr.enabled = previousXrEnabled;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.toneMapping = previousToneMapping;
      renderer.setRenderTarget(previousTarget);
      for (const [consumer, visible] of hidden) consumer.visible = visible;
    }
  }

  private getReflectionCamera(camera: Camera): Camera {
    let reflectionCamera = this.reflectionCameras.get(camera);
    if (!reflectionCamera) {
      reflectionCamera = camera.clone();
      this.reflectionCameras.set(camera, reflectionCamera);
    }
    return reflectionCamera;
  }
}
