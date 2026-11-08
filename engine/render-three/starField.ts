import { Vector3 } from "three";
import type { Sky } from "three/examples/jsm/objects/Sky.js";
import type { ResolvedEnvironment } from "../environment/environmentResolve";

// A cube-direction grid avoids longitude seams and polar pinching. Each star
// stays inside its cell even at maximum size; solid-angle weighting compensates
// for the cube projection's higher cell density towards its corners.
const STAR_GLSL = /* glsl */ `
  uniform float forgeStarBrightness;
  uniform float forgeStarDensity;
  uniform float forgeStarSize;
  uniform vec3 forgeStarMoonDirection;
  uniform float forgeStarMoonBrightness;

  vec3 forgeStarHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  vec3 forgeStars(vec3 direction, vec3 skyColor) {
    // Evaluate derivatives before non-uniform branches. Angular footprint keeps
    // sub-pixel stars antialiased without turning them into bright pixel noise.
    float footprint = max(length(fwidth(direction)) * 0.6, 0.00001);
    if (forgeStarBrightness <= 0.0 || forgeStarDensity <= 0.0 || direction.y <= 0.0) return skyColor;
    vec3 a = abs(direction);
    float face;
    vec2 uv;
    if (a.x >= a.y && a.x >= a.z) {
      face = direction.x > 0.0 ? 0.0 : 1.0;
      uv = direction.yz / a.x;
    } else if (a.y >= a.z) {
      face = direction.y > 0.0 ? 2.0 : 3.0;
      uv = direction.xz / a.y;
    } else {
      face = direction.z > 0.0 ? 4.0 : 5.0;
      uv = direction.xy / a.z;
    }
    vec2 cell = floor((uv + 1.0) * 48.0);
    vec3 seed = forgeStarHash(vec3(cell, face + 17.0));
    vec2 centerUV = (cell + 0.25 + 0.5 * seed.xy) / 48.0 - 1.0;
    float solidAngle = pow(1.0 + dot(centerUV, centerUV), -1.5);
    if (seed.z >= forgeStarDensity * 0.12 * solidAngle) return skyColor;
    vec3 center;
    if (face < 2.0) center = vec3(face < 1.0 ? 1.0 : -1.0, centerUV);
    else if (face < 4.0) center = vec3(centerUV.x, face < 3.0 ? 1.0 : -1.0, centerUV.y);
    else center = vec3(centerUV, face < 5.0 ? 1.0 : -1.0);
    center = normalize(center);
    vec3 variety = forgeStarHash(vec3(cell + 139.0, face + 91.0));
    float radius = mix(0.00032, 0.0007, variety.x) * forgeStarSize;
    float filteredRadius = max(radius, footprint);
    float distanceToStar = length(cross(direction, center));
    float disc = 1.0 - smoothstep(filteredRadius * 0.2, filteredRadius, distanceToStar);
    float energy = min(1.0, radius * radius / (filteredRadius * filteredRadius));
    float horizon = smoothstep(0.02, 0.25, direction.y);
    float moonSeparation = 1.0 - smoothstep(0.97, 1.0, dot(direction, forgeStarMoonDirection));
    float moonFade = mix(1.0, mix(0.2, 1.0, moonSeparation), clamp(forgeStarMoonBrightness, 0.0, 1.0));
    vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.89, 0.72), variety.y);
    float luminosity = mix(2.0, 12.0, pow(variety.z, 5.0));
    return skyColor + tint * luminosity * disc * energy * horizon * moonFade * forgeStarBrightness;
  }
`;

/** Live background only: reflection.ts keeps its own unmodified IBL sky. */
export function installStarField(sky: Sky): void {
  Object.assign(sky.material.uniforms, {
    forgeStarBrightness: { value: 0 },
    forgeStarDensity: { value: 0 },
    forgeStarSize: { value: 1 },
    forgeStarMoonDirection: { value: new Vector3(0, 1, 0) },
    forgeStarMoonBrightness: { value: 0 },
  });
  // Installed after the moon hook, but composited BEFORE it so the disc always
  // covers stars. Both still run before the existing tone mapping / bloom path.
  sky.material.fragmentShader = STAR_GLSL + sky.material.fragmentShader.replace(
    "gl_FragColor.rgb = forgeMoon(",
    "gl_FragColor.rgb = forgeStars(normalize(vWorldPosition - cameraPosition), gl_FragColor.rgb);\n gl_FragColor.rgb = forgeMoon(",
  );
}

export function applyStarField(sky: Sky, environment: ResolvedEnvironment | null): void {
  const u = sky.material.uniforms;
  u.forgeStarBrightness!.value = environment?.stars.brightness ?? 0;
  u.forgeStarDensity!.value = environment?.stars.density ?? 0;
  u.forgeStarSize!.value = environment?.stars.size ?? 1;
  u.forgeStarMoonBrightness!.value = environment?.moon.brightness ?? 0;
  if (environment) (u.forgeStarMoonDirection!.value as Vector3).set(...environment.moon.direction);
}
