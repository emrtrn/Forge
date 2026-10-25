import {
  Color,
  DirectionalLight,
  Group,
  ShaderChunk,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";

import { computeSunCascades, sunCascadeNeedsUpdate, sunShadowFadeRange, SUN_CASCADE_MAX } from "@engine/world/sunCascades";
import { shadowDepthBias } from "./depthMode";

/**
 * Cascaded sun shadow for far view mode (OPEN_WORLD_PLAN Faz 7c2). three's `CSM`
 * addon is not used: it overwrites materials' `onBeforeCompile` (dropping
 * Forge's terrain, foliage-fade and world-mask patches), swaps a stale copy of
 * the global lighting chunk in for every material and breaks under reversed-Z.
 *
 * Instead N directional lights live in one group. Cascade 0 carries the sun's
 * colour and intensity; 1..N−1 are black helper lights that only own a shadow
 * map. The sun itself leaves the render (its layers are emptied, so its authored
 * `visible`/`castShadow` stay readable) and comes back on {@link deactivate}.
 * three puts shadow-casting lights first in scene order, so the cascades are
 * directional shadows 0..N−1.
 *
 * Every lit material in the scene gets a chained patch (prior patch and cache
 * key kept): the directional shadow line of three's *current*
 * `lights_fragment_begin` is replaced by a cascade pick from the shadow
 * coordinates — the first cascade that contains the fragment, blended into the
 * next across a 5 % edge band, the last one fading to unshadowed — and the
 * helper lights skip their BRDF. A shared uniform then fades shadows out over
 * `[0.85 D, D]` of camera distance, so the edge is a circle around the camera
 * rather than the last cascade's square. The patch is a no-op while inactive,
 * so small levels compile exactly what they did before.
 */

type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

const DIR_SHADOW_LINE =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
/** Fraction of a cascade's map, at its edge, blended into the next cascade. */
const EDGE_BAND = 0.05;
const FADE_UNIFORM = "forgeSunShadowFade";
const CACHE_KEY_TAG = "forge-sun-cascades";
/** World-space depth bias per cascade (three's bias is in shadow-depth units). */
const CASCADE_BIAS_METERS = 0.02;
/** Normal bias per cascade, in texels of that cascade. */
const CASCADE_NORMAL_BIAS_TEXELS = 0.75;

/**
 * One cascade of the pick. A fragment counts as inside only when its depth is in
 * the map's range too: a cascade box is square in light space but only a slice
 * sphere deep, and past its far plane three's test reads "shadowed" under
 * reversed-Z (z < 0 passes `z <= 1`) and "lit" under standard depth, where the
 * next cascade has the real answer.
 */
function cascadeStep(index: number): string {
  return `
  #if NUM_DIR_LIGHT_SHADOWS > ${index}
  if ( forgeRemaining > 0.0 ) {
    forgeCoord = vDirectionalShadowCoord[ ${index} ].xyz / vDirectionalShadowCoord[ ${index} ].w;
    forgeWeight = clamp( min( min( forgeCoord.x, 1.0 - forgeCoord.x ), min( forgeCoord.y, 1.0 - forgeCoord.y ) ) / ${EDGE_BAND.toFixed(4)}, 0.0, 1.0 );
    forgeWeight *= step( 0.0, forgeCoord.z ) * step( forgeCoord.z, 1.0 );
    if ( forgeWeight > 0.0 ) {
      forgeAccum += forgeRemaining * forgeWeight * getShadow( directionalShadowMap[ ${index} ], directionalLightShadows[ ${index} ].shadowMapSize, directionalLightShadows[ ${index} ].shadowIntensity, directionalLightShadows[ ${index} ].shadowBias, directionalLightShadows[ ${index} ].shadowRadius, vDirectionalShadowCoord[ ${index} ] );
      forgeRemaining *= 1.0 - forgeWeight;
    }
  }
  #endif`;
}

/**
 * The cascade version of `base` (three's `lights_fragment_begin`). Throws when
 * the directional shadow line it anchors on is missing — a three upgrade that
 * changes the chunk must fail the engine test, not silently drop shadows.
 */
export function createSunCascadeLightsChunk(base: string = ShaderChunk.lights_fragment_begin): string {
  const at = base.indexOf(DIR_SHADOW_LINE);
  if (at < 0) throw new Error("three lights_fragment_begin changed: directional shadow line not found");
  const direct = base.indexOf("RE_Direct(", at);
  const directEnd = direct < 0 ? -1 : base.indexOf(";", direct) + 1;
  if (direct < 0 || directEnd <= 0) throw new Error("three lights_fragment_begin changed: directional RE_Direct not found");
  const select = `
float forgeSunShadow = 1.0;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
{
  float forgeRemaining = 1.0;
  float forgeAccum = 0.0;
  vec3 forgeCoord;
  float forgeWeight;
  ${Array.from({ length: SUN_CASCADE_MAX }, (_, index) => cascadeStep(index)).join("\n")}
  forgeSunShadow = forgeAccum + forgeRemaining;
  forgeSunShadow = mix( forgeSunShadow, 1.0, smoothstep( ${FADE_UNIFORM}.x, ${FADE_UNIFORM}.y, length( vViewPosition ) ) );
}
#endif
`;
  return select + base.slice(0, at) + `
		#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? forgeSunShadow : 1.0;
		#endif` + base.slice(at + DIR_SHADOW_LINE.length, direct) + `#if ( UNROLLED_LOOP_INDEX == 0 ) || ( UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS )
		${base.slice(direct, directEnd)}
		#endif` + base.slice(directEnd);
}

const LIT_FLAGS = [
  "isMeshStandardMaterial",
  "isMeshPhysicalMaterial",
  "isMeshLambertMaterial",
  "isMeshPhongMaterial",
  "isMeshToonMaterial",
] as const;

function isLitMaterial(material: Material): boolean {
  const flags = material as unknown as Record<string, unknown>;
  return LIT_FLAGS.some((flag) => flags[flag] === true);
}

function isEffectivelyVisible(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export interface SunCascadeUpdate {
  /** The level's sun; its direction, colour and intensity are read every frame. */
  readonly sun: DirectionalLight;
  readonly camera: PerspectiveCamera;
  /** 2..4 cascades. */
  readonly count: number;
  readonly stagger: boolean;
  readonly mapSize: number;
  /** Shadow distance (metres): the last cascade's split. */
  readonly distance: number;
}

export class SunCascadeShadow {
  readonly group = new Group();
  /** Shared by every patched material: `[fade start, fade end]` in camera distance. */
  readonly fadeUniform = { value: new Vector2(1e9, 1e9) };
  private readonly scene: Object3D;
  private readonly chunk: string;
  private readonly patched = new WeakSet<Material>();
  private lights: DirectionalLight[] = [];
  private sun: DirectionalLight | null = null;
  private sunLayers = 0;
  private readonly mutedLights = new Set<DirectionalLight>();
  private warnedMutedLight = false;
  private frame = 0;
  private active = false;
  private readonly lightDirection = new Vector3();
  private readonly sunWorld = new Vector3();
  private readonly cameraWorld = new Vector3();
  private readonly cameraForward = new Vector3();

  constructor(scene: Object3D) {
    this.scene = scene;
    this.chunk = createSunCascadeLightsChunk();
    this.group.name = "forge-sun-cascades";
  }

  get isActive(): boolean {
    return this.active;
  }

  get cascadeLights(): readonly DirectionalLight[] {
    return this.lights;
  }

  /**
   * Fits the cascades to `camera` for this frame, entering cascade mode (or
   * switching sun / cascade count) as needed. Returns false, leaving cascade
   * mode, when the sun has no usable direction.
   */
  update(options: SunCascadeUpdate): boolean {
    const { sun, camera, stagger, mapSize, distance } = options;
    const count = Math.min(SUN_CASCADE_MAX, Math.max(1, Math.floor(options.count)));
    if (this.active && (this.sun !== sun || this.lights.length !== count)) this.deactivate();
    if (!this.active) this.activate(sun, count);
    this.registerScene();

    sun.updateWorldMatrix(true, false);
    sun.target.updateWorldMatrix(true, false);
    sun.getWorldPosition(this.sunWorld);
    sun.target.getWorldPosition(this.lightDirection).sub(this.sunWorld);
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.cameraWorld);
    camera.getWorldDirection(this.cameraForward);
    const cascades = computeSunCascades({
      lightDirection: [this.lightDirection.x, this.lightDirection.y, this.lightDirection.z],
      cameraPosition: [this.cameraWorld.x, this.cameraWorld.y, this.cameraWorld.z],
      cameraForward: [this.cameraForward.x, this.cameraForward.y, this.cameraForward.z],
      fovDeg: camera.fov,
      aspect: camera.aspect,
      count,
      distance,
      mapSize,
    });
    if (cascades.length !== count) {
      this.deactivate();
      return false;
    }

    const [fadeStart, fadeEnd] = sunShadowFadeRange(distance);
    this.fadeUniform.value.set(fadeStart, fadeEnd);
    this.group.visible = isEffectivelyVisible(sun);
    const biasSign = Math.sign(shadowDepthBias()) || 1;
    const frame = this.frame;
    this.frame += 1;
    this.lights.forEach((light, index) => {
      if (index === 0) {
        light.color.copy(sun.color);
        light.intensity = sun.intensity;
      }
      light.shadow.intensity = sun.shadow.intensity;
      light.shadow.radius = sun.shadow.radius;
      light.shadow.blurSamples = sun.shadow.blurSamples;
      if (light.shadow.mapSize.width !== mapSize) {
        light.shadow.mapSize.set(mapSize, mapSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
        light.shadow.needsUpdate = true;
      }
      const lazy = stagger && index >= 2;
      light.shadow.autoUpdate = !lazy;
      if (!sunCascadeNeedsUpdate(index, frame, stagger)) return;
      if (lazy) light.shadow.needsUpdate = true;
      const result = cascades[index]!.frame;
      light.position.set(...result.position);
      light.target.position.set(...result.target);
      light.updateMatrixWorld(true);
      light.target.updateMatrixWorld(true);
      const shadowCamera = light.shadow.camera;
      shadowCamera.left = result.left;
      shadowCamera.right = result.right;
      shadowCamera.top = result.top;
      shadowCamera.bottom = result.bottom;
      shadowCamera.near = result.near;
      shadowCamera.far = result.far;
      shadowCamera.updateProjectionMatrix();
      light.shadow.bias = (biasSign * CASCADE_BIAS_METERS) / result.far;
      light.shadow.normalBias = result.texelSize * CASCADE_NORMAL_BIAS_TEXELS;
    });
    return true;
  }

  /** Leaves cascade mode: the sun, muted lights and material programs return to normal. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.group.removeFromParent();
    for (const light of this.lights) {
      this.group.remove(light, light.target);
      light.dispose();
    }
    this.lights = [];
    if (this.sun) {
      this.sun.layers.mask = this.sunLayers;
      this.sun = null;
    }
    for (const light of this.mutedLights) light.castShadow = true;
    this.mutedLights.clear();
    this.fadeUniform.value.set(1e9, 1e9);
    this.markPatchedMaterials();
  }

  /** Forgets the sun without touching it — for a level teardown that already removed it. */
  dispose(): void {
    this.sun = null;
    this.mutedLights.clear();
    this.deactivate();
  }

  private activate(sun: DirectionalLight, count: number): void {
    this.active = true;
    this.frame = 0;
    this.sun = sun;
    this.sunLayers = sun.layers.mask;
    sun.layers.mask = 0;
    // The sun leaves the render: free its map rather than keep it resident.
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    for (let index = 0; index < count; index += 1) {
      const light = new DirectionalLight(index === 0 ? sun.color : new Color(0, 0, 0), index === 0 ? sun.intensity : 0);
      light.name = `forge-sun-cascade-${index}`;
      light.castShadow = true;
      this.group.add(light, light.target);
      this.lights.push(light);
    }
    this.scene.add(this.group);
    this.markPatchedMaterials();
  }

  /**
   * Patches lit materials that entered the scene since the last frame (cell
   * activation, foliage batches, HLOD proxies, actors) and mutes the shadow of
   * any other directional light: the shader counts every shadowed directional
   * light as a cascade.
   */
  private registerScene(): void {
    this.scene.traverse((object) => {
      const light = object as DirectionalLight;
      if (light.isDirectionalLight) {
        if (light.castShadow && light !== this.sun && light.parent !== this.group) {
          light.castShadow = false;
          this.mutedLights.add(light);
          if (!this.warnedMutedLight) {
            this.warnedMutedLight = true;
            console.warn(
              `[shadows] far view mode casts sun shadows through cascades; the shadow of directional light "${light.name || light.uuid}" is turned off`,
            );
          }
        }
        return;
      }
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      if (Array.isArray(material)) for (const entry of material) this.patchMaterial(entry);
      else this.patchMaterial(material);
    });
  }

  private patchMaterial(material: Material): void {
    if (this.patched.has(material) || !isLitMaterial(material)) return;
    this.patched.add(material);
    const own = (key: "onBeforeCompile" | "customProgramCacheKey") => Object.prototype.hasOwnProperty.call(material, key);
    const prior = own("onBeforeCompile") ? material.onBeforeCompile : null;
    const priorKey = own("customProgramCacheKey") ? material.customProgramCacheKey : null;
    material.onBeforeCompile = (shader: ShaderPatch, renderer: WebGLRenderer) => {
      prior?.call(material, shader, renderer);
      if (this.active) this.patchShader(shader);
    };
    material.customProgramCacheKey = () => {
      // three's default key is the patch's source; ours is the same for every
      // material, so the prior patch's source keeps distinct patches apart.
      const base = priorKey ? priorKey.call(material) : prior ? prior.toString() : "";
      return this.active ? `${base}|${CACHE_KEY_TAG}` : base;
    };
    material.needsUpdate = true;
  }

  private patchShader(shader: ShaderPatch): void {
    const source = shader.fragmentShader;
    // A clone that copied an already patched callback runs it twice; patch once.
    if (source.includes(FADE_UNIFORM)) return;
    if (!source.includes("#include <lights_fragment_begin>") || !source.includes("#include <lights_pars_begin>")) return;
    shader.uniforms[FADE_UNIFORM] = this.fadeUniform;
    shader.fragmentShader = source
      .replace("#include <lights_pars_begin>", `#include <lights_pars_begin>\nuniform vec2 ${FADE_UNIFORM};`)
      .replace("#include <lights_fragment_begin>", this.chunk);
  }

  private markPatchedMaterials(): void {
    this.scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (this.patched.has(entry)) entry.needsUpdate = true;
      }
    });
  }
}
