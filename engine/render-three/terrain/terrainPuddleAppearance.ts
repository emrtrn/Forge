/** Shared by the visible puddle and wave connectivity passes. World anchored:
 * camera movement, simulation recentering and time never move the dry gaps. */
export const TERRAIN_PUDDLE_PATTERN = /* glsl */ `
float forgePuddleHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float forgePuddleNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(forgePuddleHash(cell), forgePuddleHash(cell + vec2(1.,0.)), f.x),
    mix(forgePuddleHash(cell + vec2(0.,1.)), forgePuddleHash(cell + vec2(1.)), f.x), f.y);
}
float forgePuddlePatch(vec2 world, float depth) {
  float n = .75 * forgePuddleNoise(world * 2.8) + .25 * forgePuddleNoise(world * 7.1 + 17.);
  float threshold = mix(.66, .51, smoothstep(.02, .14, depth));
  return smoothstep(threshold - .06, threshold + .06, n);
}
`;

/** Two slowly travelling micro-normal bands; no extra texture or capture.
 * Added to wheel waves, never to the patch mask or surface elevation. */
export const TERRAIN_PUDDLE_MOTION = /* glsl */ `
vec2 forgePuddleMicroGradient(vec2 world, float seconds) {
  float a = dot(world, vec2(19., 13.)) + seconds * .55;
  float b = dot(world, vec2(-11., 23.)) - seconds * .37;
  return vec2(.018, .012) * cos(a) + vec2(-.010, .020) * cos(b);
}
`;
