/** Two overlapping advection windows. Speed changes how quickly a window runs,
 * never its travel distance. The resetting sample has zero weight, so bank/flow
 * gradients cannot accumulate shear for the lifetime of the scene. */
export const RIVER_FLOW_GLSL = /* glsl */ `
vec3 riverFlowPhases(float seconds, float speed, float travel) {
  float phase = fract(seconds * abs(speed) / max(travel, 0.0001));
  float other = fract(phase + 0.5);
  float weight = smoothstep(0.0, 1.0, 1.0 - abs(phase * 2.0 - 1.0));
  return vec3((phase - 0.5) * travel, (other - 0.5) * travel, weight);
}
`;
