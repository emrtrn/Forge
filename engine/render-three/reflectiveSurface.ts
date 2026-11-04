import {
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  Plane,
  PlaneGeometry,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type IUniform,
  type Material,
  type Scene,
  type WebGLRenderer,
} from "three";

import type { Vec3 } from "@engine/scene/layout";
import type { ResolvedReflectiveSurface } from "@engine/scene/reflectiveSurface";

export {
  resolveReflectiveSurface,
  REFLECTIVE_SURFACE_DEFAULTS,
  uniqueReflectiveSurfaceId,
  uniqueReflectiveSurfaceName,
  type ResolvedReflectiveSurface,
} from "@engine/scene/reflectiveSurface";

/**
 * Reflective Surface render binding — a textured, PBR planar reflection. Unlike the
 * pure mirror {@link import("./reflectionPlane")} (`Reflector`), this renders a flat
 * `MeshStandardMaterial` (albedo + normal map + roughness from a Forge material) and
 * composites a per-frame planar reflection into it via a fresnel-weighted blend, so
 * it reads as wet asphalt / polished marble / water — not chrome.
 *
 * The reflection is produced the same way `Reflector` does (render the scene from a
 * camera mirrored across the plane into a render target), but instead of displaying
 * that texture directly the surface's material is patched (`onBeforeCompile`) to
 * sample it in screen space — perturbed by the material's normal map, weighted by a
 * fresnel term and the material's own roughness. Resolution and material are baked at
 * construction (a change rebuilds the object); strength / fresnel / distortion / tint
 * are live uniforms (see {@link applyReflectiveSurfaceTransform}).
 */

/** `customProgramCacheKey` for reflection-patched materials, so they don't collide with stock programs. */
const REFLECTIVE_SURFACE_CACHE_KEY = "forge-reflective-surface";

/** The shader param object three.js hands `onBeforeCompile` (uniforms + GLSL sources). */
type ShaderPatch = Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];

/** Vertex anchor: present in every program; `transformed` + `modelMatrix` are in scope here. */
const VERTEX_ANCHOR = "#include <project_vertex>";
/** Fragment anchor: `outgoingLight`, `normal`, `vViewPosition`, `material.roughness` are all in scope just before it. */
const FRAGMENT_ANCHOR = "#include <opaque_fragment>";

// Projects the plane's LOCAL position into the reflection texture (screen-space) coord.
// `reflectionTextureMatrix` already bakes in the surface's world matrix (bias * proj *
// view * matrixWorld), exactly like three.js `Reflector`, so the shader must multiply by
// the local `transformed` position — applying `modelMatrix` here too would double the
// world transform and mis-project the reflection.
const VERTEX_PATCH = `${VERTEX_ANCHOR}\n\tvReflectionUv = reflectionTextureMatrix * vec4( transformed, 1.0 );`;

/**
 * Composites the planar reflection into `outgoingLight` before it is written/tone-mapped:
 * sample the (linear-HDR) reflection RT at the screen-projected coord, nudged by the
 * normal-map detail; weight by a fresnel term, the authored strength, and `(1 - roughness)`
 * so glossy reads as a sharp reflection and rough fades it out.
 *
 * The distortion is driven by `normal - normalize(vNormal)` — the normal MAP's deviation
 * from the flat geometric normal — not the full shading normal. A flat surface's view-space
 * normal is ~constant across the plane, so using it directly would shift the whole reflection
 * by a constant amount (it appears to sit too low); the deviation is zero where there's no
 * normal map, so a plain surface reflects with no offset and only map detail ripples it.
 */
const FRAGMENT_PATCH = `{
		vec2 reflProjUv = vReflectionUv.xy / max( vReflectionUv.w, 1e-4 );
		reflProjUv += ( normal - normalize( vNormal ) ).xy * reflectionDistortion;
		vec3 reflectionColor = texture2D( tReflection, reflProjUv ).rgb * reflectionTint;
		vec3 reflectionViewDir = normalize( vViewPosition );
		float reflectionFresnel = reflectionFresnelBias + ( 1.0 - reflectionFresnelBias ) *
			pow( 1.0 - clamp( dot( normal, reflectionViewDir ), 0.0, 1.0 ), reflectionFresnelPower );
		float reflectionAmount = clamp( reflectionStrength * reflectionFresnel * ( 1.0 - material.roughness ), 0.0, 1.0 );
		outgoingLight = mix( outgoingLight, reflectionColor, reflectionAmount );
	}
	${FRAGMENT_ANCHOR}`;

const FRAGMENT_DECLS =
  "uniform sampler2D tReflection;\n" +
  "uniform float reflectionStrength;\n" +
  "uniform float reflectionFresnelPower;\n" +
  "uniform float reflectionFresnelBias;\n" +
  "uniform float reflectionDistortion;\n" +
  "uniform vec3 reflectionTint;\n" +
  "varying vec4 vReflectionUv;\n";

const VERTEX_DECLS = "uniform mat4 reflectionTextureMatrix;\nvarying vec4 vReflectionUv;\n";

/** Live, per-surface reflection uniforms shared between the binding and its patched material. */
interface ReflectionUniforms {
  tReflection: IUniform;
  reflectionTextureMatrix: IUniform<Matrix4>;
  reflectionStrength: IUniform<number>;
  reflectionFresnelPower: IUniform<number>;
  reflectionFresnelBias: IUniform<number>;
  reflectionDistortion: IUniform<number>;
  reflectionTint: IUniform<Color>;
}

/** A flat reflective surface mesh: a `MeshStandardMaterial` plane with a self-updating planar reflection. */
export class ReflectiveSurface extends Mesh {
  readonly isReflectiveSurface = true;
  private readonly renderTarget: WebGLRenderTarget;
  private readonly textureMatrix = new Matrix4();
  private readonly reflectionCameras = new WeakMap<Camera, Camera>();
  private readonly uniforms: ReflectionUniforms;

  constructor(material: MeshStandardMaterial, resolution: number) {
    super(new PlaneGeometry(1, 1), material);
    this.renderTarget = new WebGLRenderTarget(resolution, resolution, {
      samples: 4,
      type: HalfFloatType,
    });
    this.uniforms = {
      tReflection: { value: this.renderTarget.texture },
      reflectionTextureMatrix: { value: this.textureMatrix },
      reflectionStrength: { value: 0 },
      reflectionFresnelPower: { value: 1 },
      reflectionFresnelBias: { value: 0 },
      reflectionDistortion: { value: 0 },
      reflectionTint: { value: new Color(0xffffff) },
    };
    this.installPatch(material);
    this.onBeforeRender = (renderer, scene, camera) => this.renderReflection(renderer, scene, camera);
  }

  /** Updates the live reflection uniforms (strength / fresnel / distortion / tint). */
  setReflectionParams(item: ResolvedReflectiveSurface): void {
    this.uniforms.reflectionStrength.value = item.reflectionStrength;
    this.uniforms.reflectionFresnelPower.value = item.fresnelPower;
    this.uniforms.reflectionFresnelBias.value = item.fresnelBias;
    this.uniforms.reflectionDistortion.value = item.distortion;
    this.uniforms.reflectionTint.value.set(item.tint);
  }

  override dispose(): void {
    this.renderTarget.dispose();
    this.geometry.dispose();
    (this.material as Material).dispose();
    super.dispose();
  }

  /** Patches the standard material to sample the planar reflection (shared live uniforms). */
  private installPatch(material: MeshStandardMaterial): void {
    material.onBeforeCompile = (shader: ShaderPatch) => {
      if (
        !shader.vertexShader.includes(VERTEX_ANCHOR) ||
        !shader.fragmentShader.includes(FRAGMENT_ANCHOR)
      ) {
        return;
      }
      shader.uniforms.tReflection = this.uniforms.tReflection;
      shader.uniforms.reflectionTextureMatrix = this.uniforms.reflectionTextureMatrix;
      shader.uniforms.reflectionStrength = this.uniforms.reflectionStrength;
      shader.uniforms.reflectionFresnelPower = this.uniforms.reflectionFresnelPower;
      shader.uniforms.reflectionFresnelBias = this.uniforms.reflectionFresnelBias;
      shader.uniforms.reflectionDistortion = this.uniforms.reflectionDistortion;
      shader.uniforms.reflectionTint = this.uniforms.reflectionTint;
      shader.vertexShader = `${VERTEX_DECLS}${shader.vertexShader.replace(VERTEX_ANCHOR, VERTEX_PATCH)}`;
      shader.fragmentShader = `${FRAGMENT_DECLS}${shader.fragmentShader.replace(
        FRAGMENT_ANCHOR,
        FRAGMENT_PATCH,
      )}`;
    };
    material.customProgramCacheKey = () => REFLECTIVE_SURFACE_CACHE_KEY;
    material.needsUpdate = true;
  }

  /**
   * Renders the scene from a camera mirrored across this plane into the reflection RT
   * and refreshes the projection texture matrix. Adapted from three.js `Reflector`,
   * with tone mapping disabled so the RT holds linear HDR (the surface's own
   * `tonemapping_fragment` tone-maps the composited result exactly once).
   */
  private renderReflection(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const reflectionCamera = this.getReflectionCamera(camera);

    const reflectorWorldPosition = new Vector3().setFromMatrixPosition(this.matrixWorld);
    const cameraWorldPosition = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const rotationMatrix = new Matrix4().extractRotation(this.matrixWorld);

    const normal = new Vector3(0, 0, 1).applyMatrix4(rotationMatrix);
    const view = new Vector3().subVectors(reflectorWorldPosition, cameraWorldPosition);

    // Don't render (and don't show a wrong reflection) when looking at the back face.
    if (view.dot(normal) > 0) return;

    view.reflect(normal).negate().add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    const lookAtPosition = new Vector3(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraWorldPosition);
    const target = new Vector3()
      .subVectors(reflectorWorldPosition, lookAtPosition)
      .reflect(normal)
      .negate()
      .add(reflectorWorldPosition);

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

    // texture matrix maps the plane's clip-space position into [0,1] reflection-texture UV.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(perspective.projectionMatrix);
    this.textureMatrix.multiply(perspective.matrixWorldInverse);
    this.textureMatrix.multiply(this.matrixWorld);

    // Oblique near-plane clipping so geometry behind the mirror is not reflected.
    const reflectorPlane = new Plane().setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(perspective.matrixWorldInverse);
    const clipPlane = new Vector4(
      reflectorPlane.normal.x,
      reflectorPlane.normal.y,
      reflectorPlane.normal.z,
      reflectorPlane.constant,
    );
    const projectionMatrix = perspective.projectionMatrix;
    const q = new Vector4(
      (Math.sign(clipPlane.x) + projectionMatrix.elements[8]!) / projectionMatrix.elements[0]!,
      (Math.sign(clipPlane.y) + projectionMatrix.elements[9]!) / projectionMatrix.elements[5]!,
      -1,
      (1 + projectionMatrix.elements[10]!) / projectionMatrix.elements[14]!,
    );
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1 - 0.003;
    projectionMatrix.elements[14] = clipPlane.w;

    const previousVisible = this.visible;
    this.visible = false;
    const previousRenderTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousToneMapping = renderer.toneMapping;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousXrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = NoToneMapping;
    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, reflectionCamera);
    renderer.xr.enabled = previousXrEnabled;
    renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    renderer.toneMapping = previousToneMapping;
    renderer.setRenderTarget(previousRenderTarget, previousFace, previousMip);
    this.visible = previousVisible;
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

/** The three.js object backing a Reflective Surface actor. */
export type ReflectiveSurfaceObject = ReflectiveSurface;

/** Resolved settings + world transform the binding needs to build/sync a surface. */
export interface ReflectiveSurfaceRenderItem extends ResolvedReflectiveSurface {
  position: Vec3;
  /** XYZ-order Euler rotation in degrees. */
  rotation: Vec3;
  /** Per-axis scale (plane size; z unused by the flat plane but kept for the gizmo). */
  scale: Vec3;
}

/** Neutral dark-glossy fallback when the actor has no material assigned. */
function createDefaultReflectiveMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(0x202024), roughness: 0.2, metalness: 0 });
}

/**
 * Builds a reflective-surface mesh. The `material` should be the resolved Forge
 * material (a `MeshStandardMaterial`); a `null` or non-standard material falls back
 * to a built-in dark glossy default. Resolution + material are fixed here; transform
 * and live reflection params are pushed via {@link applyReflectiveSurfaceTransform}.
 */
export function createReflectiveSurfaceObject(
  item: ReflectiveSurfaceRenderItem,
  material: Material | null,
): ReflectiveSurfaceObject {
  const standard =
    material instanceof MeshStandardMaterial ? material : createDefaultReflectiveMaterial();
  const surface = new ReflectiveSurface(standard, item.resolution);
  surface.name = item.name;
  applyReflectiveSurfaceTransform(surface, item);
  return surface;
}

/** Pushes transform + visibility + live reflection params onto an existing surface. */
export function applyReflectiveSurfaceTransform(
  surface: ReflectiveSurfaceObject,
  item: ReflectiveSurfaceRenderItem,
): void {
  surface.position.set(item.position[0], item.position[1], item.position[2]);
  surface.rotation.set(
    (item.rotation[0] * Math.PI) / 180,
    (item.rotation[1] * Math.PI) / 180,
    (item.rotation[2] * Math.PI) / 180,
    "XYZ",
  );
  surface.scale.set(item.scale[0], item.scale[1], item.scale[2] || 1);
  surface.visible = !item.hidden;
  surface.setReflectionParams(item);
}

/** Frees the surface's render target, material, and geometry. */
export function disposeReflectiveSurfaceObject(surface: ReflectiveSurfaceObject): void {
  surface.dispose();
}
