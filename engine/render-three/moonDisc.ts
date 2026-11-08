import { Color, MathUtils, Vector3 } from "three";
import type { Sky } from "three/examples/jsm/objects/Sky.js";
import type { ResolvedEnvironment } from "../environment/environmentResolve";

/**
 * A procedural full moon in the live sky's own background pass. No sprite,
 * texture fetch, new draw call, shadow or HDR hotspot in the IBL capture.
 * World-oriented coordinates keep its maria/craters stable when the camera
 * translates or rolls. Cloud/foreground occlusion follows the existing sky.
 */
const MOON_GLSL = /* glsl */ `
  uniform vec3 forgeMoonDirection;
  uniform vec3 forgeMoonColor;
  uniform float forgeMoonRadiusSin;
  uniform float forgeMoonBrightness;
  uniform float forgeMoonHaloIntensity;
  uniform float forgeMoonHaloSize;
  uniform float forgeMoonHaloOuterCos;

  vec2 forgeMoonHash(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  float forgeMoonNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(forgeMoonHash(cell).x, forgeMoonHash(cell + vec2(1,0)).x, f.x),
      mix(forgeMoonHash(cell + vec2(0,1)).x, forgeMoonHash(cell + vec2(1,1)).x, f.x), f.y);
  }
  float forgeMoonCraters(vec2 p, float scale) {
    vec2 q = p * scale, cell = floor(q);
    float relief = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 id = cell + vec2(float(x), float(y));
        vec2 seed = forgeMoonHash(id);
        vec2 delta = q - (id + 0.2 + 0.6 * seed);
        float radius = mix(0.12, 0.34, seed.x);
        float r = length(delta) / radius;
        float floorMask = 1.0 - smoothstep(0.65, 0.9, r);
        float rim = smoothstep(0.75, 0.93, r) * (1.0 - smoothstep(1.0, 1.2, r));
        relief += -0.16 * floorMask + 0.13 * rim * (0.6 + 0.4 * dot(normalize(delta + 0.0001), vec2(-0.6, 0.8)));
      }
    }
    return relief;
  }
  vec3 forgeMoon(vec3 viewDirection, vec3 skyColor) {
    if (forgeMoonBrightness <= 0.0 || dot(viewDirection, forgeMoonDirection) <= 0.0) return skyColor;
    float alignment = dot(viewDirection, forgeMoonDirection);
    // A separate low-energy glow, restricted to the moon's angular vicinity.
    // It never boosts the disc surface or changes the global solar bloom scale.
    vec3 halo = vec3(0.0);
    if (forgeMoonHaloIntensity > 0.0 && alignment > forgeMoonHaloOuterCos) {
      float angle = atan(length(cross(viewDirection, forgeMoonDirection)), alignment);
      float outside = max(0.0, angle / asin(forgeMoonRadiusSin) - 1.0);
      float falloff = exp(-3.0 * outside / forgeMoonHaloSize)
        * (1.0 - smoothstep(forgeMoonHaloSize * 0.7, forgeMoonHaloSize, outside));
      halo = mix(vec3(1.0), forgeMoonColor, 0.35) * forgeMoonHaloIntensity * falloff;
    }
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), forgeMoonDirection));
    vec3 north = cross(forgeMoonDirection, east);
    vec2 p = vec2(dot(viewDirection, east), dot(viewDirection, north)) / forgeMoonRadiusSin;
    float r2 = dot(p, p);
    // Only evaluate lunar detail on the tiny part of the sky containing the disc.
    if (r2 > 1.05) return skyColor + halo;
    float edge = max(fwidth(r2), 0.001);
    float mask = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r2);
    float z = sqrt(max(0.0, 1.0 - r2));
    vec2 surface = p / (0.65 + 0.35 * z);
    float maria = smoothstep(0.32, 0.7, forgeMoonNoise(surface * 3.2 + vec2(7.3, 2.1)));
    float grain = forgeMoonNoise(surface * 55.0);
    float albedo = 0.76 - 0.34 * maria + 0.08 * grain;
    albedo += forgeMoonCraters(surface, 5.5) + 0.5 * forgeMoonCraters(surface + 3.7, 15.0);
    float limb = 0.45 + 0.55 * pow(z, 0.3);
    // Calibrated for exposure 1 and the composited HDR/bloom path. The old
    // 18x radiance saturated the lunar surface as the twilight fade reached 1;
    // direct-to-canvas tests missed it because they used the sky's lower local
    // exposure, whereas the compositor tone-maps later in its OutputPass.
    vec3 lunarTint = mix(vec3(1.0), forgeMoonColor, 0.35);
    vec3 radiance = lunarTint * max(0.12, albedo) * limb * 2.0;
    return mix(skyColor, radiance, mask * clamp(forgeMoonBrightness, 0.0, 1.0))
      + radiance * mask * max(0.0, forgeMoonBrightness - 1.0) + halo * (1.0 - mask);
  }
`;

/** Install only on the live sky. reflection.ts deliberately captures a plain Sky without any celestial discs. */
export function installMoonDisc(sky: Sky): void {
  const uniforms = sky.material.uniforms;
  uniforms.forgeMoonDirection = { value: new Vector3(0, 0.5, -Math.sqrt(0.75)) };
  uniforms.forgeMoonColor = { value: new Color() };
  uniforms.forgeMoonRadiusSin = { value: Math.sin(MathUtils.degToRad(0.6)) };
  uniforms.forgeMoonBrightness = { value: 0 };
  uniforms.forgeMoonHaloIntensity = { value: 0 };
  uniforms.forgeMoonHaloSize = { value: 4 };
  uniforms.forgeMoonHaloOuterCos = { value: 1 };
  sky.material.fragmentShader = MOON_GLSL + sky.material.fragmentShader.replace(
    "#include <tonemapping_fragment>",
    "gl_FragColor.rgb = forgeMoon(normalize(vWorldPosition - cameraPosition), gl_FragColor.rgb);\n#include <tonemapping_fragment>",
  );
}

export function applyMoonDisc(sky: Sky, moon: ResolvedEnvironment["moon"] | null): void {
  const uniforms = sky.material.uniforms;
  uniforms.forgeMoonBrightness!.value = moon?.brightness ?? 0;
  uniforms.forgeMoonHaloIntensity!.value = moon?.haloIntensity ?? 0;
  if (!moon) return;
  (uniforms.forgeMoonDirection!.value as Vector3).set(...moon.direction);
  (uniforms.forgeMoonColor!.value as Color).setRGB(...moon.color);
  uniforms.forgeMoonRadiusSin!.value = Math.sin(MathUtils.degToRad(moon.angularDiameterDeg / 2));
  uniforms.forgeMoonHaloSize!.value = moon.haloSize;
  uniforms.forgeMoonHaloOuterCos!.value = Math.cos(MathUtils.degToRad(moon.angularDiameterDeg / 2 * (1 + moon.haloSize)));
}
