import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  type PerspectiveCamera,
} from "three";

import type { ResolvedCloudLayer } from "@engine/scene/cloudLayer";

export {
  resolveCloudLayer,
  CLOUD_LAYER_DEFAULTS,
  type ResolvedCloudLayer,
} from "@engine/scene/cloudLayer";

/**
 * Static Cloud Layer render binding — a procedural cloud dome backdrop, the
 * non-volumetric counterpart to Unreal's Volumetric Clouds. A camera-following
 * sphere (viewed from inside) is painted by an fBm-noise fragment shader: no
 * raymarching, no textures. It sits just inside the camera far plane so opaque
 * scene geometry occludes it via the depth buffer, while the open sky shows the
 * clouds blended over the Sky Atmosphere backdrop.
 *
 * The dome follows the camera ({@link followCameraWithClouds}) so it always fills
 * the (small, ~100u) frustum. {@link advanceCloudTime} drives the optional wind
 * drift; with `speed = 0` the wind vector is zero, so time has no visible effect
 * and the clouds stay frozen.
 */

/**
 * Sphere radius the camera sits inside. Smaller than the Sky's 100u backdrop and
 * the camera far plane so the clouds read as a distant layer that real geometry
 * (closer than this) occludes through the depth test.
 */
const CLOUD_DOME_RADIUS = 90;

/** Fraction of the camera far plane the dome is scaled out to (see {@link followCameraWithClouds}). */
const CLOUD_DOME_FAR_FRACTION = 0.9;

/** Fixed wind heading (xz) the drift scrolls along; `speed` scales its length. */
const WIND_DIRECTION = new Vector2(1, 0.35).normalize();
/**
 * The raw `1 / dir.y` sky-plane projection stretches too aggressively near the
 * horizon and makes the lower cloud edge read as if it is "falling". Blend the
 * projection toward a gentler scale as we approach the horizon.
 */
const HORIZON_BLEND_END = 0.45;
const HORIZON_PROJECTION_FLOOR = 0.35;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // The dome is never rotated, so the object-space direction equals the world
    // view direction from the (camera-centered) origin.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform float uCoverage;
  uniform float uDensity;
  uniform float uSoftness;
  uniform float uScale;
  uniform float uTime;
  uniform vec2 uWind;

  varying vec3 vDir;

  // 2D value noise + fBm, output roughly in [0, 1]. Cheap and texture-free.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    float sum = 0.0;
    for (int octave = 0; octave < 5; octave++) {
      total += valueNoise(p) * amplitude;
      sum += amplitude;
      p *= 2.0;
      amplitude *= 0.5;
    }
    return total / sum;
  }

  void main() {
    vec3 dir = normalize(vDir);

    // Fade out below + along the horizon so clouds stay in the upper hemisphere.
    float horizon = smoothstep(0.0, 0.18, dir.y);
    if (horizon <= 0.0) discard;

    // Sky-plane projection with a softened horizon remap so the lower cloud edge
    // does not look like it drops vertically toward the ground.
    float horizonBlend = smoothstep(0.0, ${HORIZON_BLEND_END.toFixed(2)}, dir.y);
    float projectionY = mix(${HORIZON_PROJECTION_FLOOR.toFixed(2)}, 1.0, horizonBlend);
    vec2 plane = dir.xz / projectionY;
    vec2 p = plane * uScale + uWind * uTime;

    float n = fbm(p);

    // Coverage lowers the threshold (more sky filled); softness widens the band.
    float threshold = 1.0 - uCoverage;
    float halfWidth = mix(0.02, 0.4, uSoftness);
    float cover = smoothstep(threshold - halfWidth, threshold + halfWidth, n);

    float alpha = cover * uDensity * horizon;
    if (alpha <= 0.003) discard;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** A cloud dome mesh whose uniforms still need {@link applyCloudUniforms}. */
export type CloudDome = Mesh<SphereGeometry, ShaderMaterial>;

/** Builds the cloud dome mesh (uniforms default until {@link applyCloudUniforms}). */
export function createCloudObject(): CloudDome {
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color("#ffffff") },
      uCoverage: { value: 0.5 },
      uDensity: { value: 0.85 },
      uSoftness: { value: 0.3 },
      uScale: { value: 2 },
      uTime: { value: 0 },
      uWind: { value: new Vector2(0, 0) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    // Backdrop: never writes depth, but DOES test it so closer opaque geometry
    // occludes the clouds. Viewed from inside the sphere (BackSide).
    depthWrite: false,
    side: BackSide,
  });

  const dome = new Mesh(new SphereGeometry(CLOUD_DOME_RADIUS, 32, 16), material);
  dome.name = "cloud-layer";
  dome.frustumCulled = false;
  // Background geometry is never a pick target.
  dome.raycast = () => {};
  return dome;
}

/** Keeps the dome centered on the camera so it always surrounds the view. */
export function followCameraWithClouds(dome: CloudDome, camera: PerspectiveCamera): void {
  dome.position.copy(camera.position);
  // Keep the dome just inside the far plane: geometry nearer than the dome hides
  // the clouds, so a dome inside a long view distance would paint clouds over far
  // terrain. The shader shades by view direction, so the radius never changes the look.
  dome.scale.setScalar(Math.max(CLOUD_DOME_RADIUS, camera.far * CLOUD_DOME_FAR_FRACTION) / CLOUD_DOME_RADIUS);
}

/**
 * Advances the drift clock. The wind vector is zero when `speed = 0`, so this is
 * a no-op on the look for static clouds; non-zero speeds scroll the noise.
 */
export function advanceCloudTime(dome: CloudDome, deltaSeconds: number): void {
  dome.material.uniforms.uTime!.value += deltaSeconds;
}

/** Pushes the resolved cloud settings onto the dome shader. */
export function applyCloudUniforms(dome: CloudDome, resolved: ResolvedCloudLayer): void {
  const uniforms = dome.material.uniforms;
  (uniforms.uColor!.value as Color).set(resolved.color);
  uniforms.uCoverage!.value = resolved.coverage;
  uniforms.uDensity!.value = resolved.density;
  uniforms.uSoftness!.value = resolved.softness;
  uniforms.uScale!.value = resolved.scale;
  (uniforms.uWind!.value as Vector2).copy(WIND_DIRECTION).multiplyScalar(resolved.speed);
  dome.visible = !resolved.hidden;
}
