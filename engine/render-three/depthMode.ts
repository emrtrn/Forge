import type { Camera, Light, LightShadow, Object3D, WebGLRenderer } from "three";

/**
 * Scene depth mode (OPEN_WORLD_PLAN K7 / Faz 7b). `"reversed"` is reversed-Z
 * (EXT_clip_control, depth 1 at the near plane) and is only worth it with a
 * float32 depth buffer — the composer's {@link PostProcessPipeline} target in
 * far view mode. On the default 24-bit canvas it is worse than `"standard"`.
 */
export type SceneDepthMode = "standard" | "reversed";

/** Magnitude of the shadow depth bias every shadow-casting light uses. */
export const SHADOW_DEPTH_BIAS = 0.0005;

// Renderer-wide like three's own depth state: a page runs one scene renderer at
// a time (Play and the editor live in separate tabs; editor previews stay
// standard), so lights built after a switch read the active sign from here.
let activeMode: SceneDepthMode = "standard";

/** True when the GPU can run reversed-Z. */
export function reversedDepthSupported(renderer: WebGLRenderer): boolean {
  return renderer.extensions.has("EXT_clip_control");
}

/** The depth mode {@link setSceneDepthMode} last applied. */
export function activeSceneDepthMode(): SceneDepthMode {
  return activeMode;
}

/**
 * Shadow bias for the active mode: a negative bias pushes the comparison toward
 * the light in standard depth, but reversed depth flips the comparison, so the
 * same negative bias causes self-shadow acne on sun-facing surfaces (S5).
 */
export function shadowDepthBias(): number {
  return activeMode === "reversed" ? SHADOW_DEPTH_BIAS : -SHADOW_DEPTH_BIAS;
}

/**
 * Switches the renderer between standard and reversed depth and brings the
 * scene along: three only ever turns a camera's reversed projection ON, so every
 * camera is reset here; shadow maps fix their compare function when created, so
 * they are dropped and rebuilt; shadow bias signs follow the mode. Programs need
 * no help — three keys them on the depth state. Returns the mode actually in
 * effect (`"standard"` when reversed-Z is unsupported).
 */
export function setSceneDepthMode(
  renderer: WebGLRenderer,
  mode: SceneDepthMode,
  options: { scene: Object3D; cameras: readonly Camera[] },
): SceneDepthMode {
  const next: SceneDepthMode = mode === "reversed" && reversedDepthSupported(renderer) ? "reversed" : "standard";
  const reversed = next === "reversed";
  const depth = renderer.state.buffers.depth;
  if (depth.getReversed() === reversed && activeMode === next) return next;
  depth.setReversed(reversed);
  activeMode = next;

  const cameras = new Set<Camera>(options.cameras);
  options.scene.traverse((object) => {
    if ((object as Camera).isCamera) cameras.add(object as Camera);
    const light = object as Light & { shadow?: LightShadow };
    if (!light.isLight || !light.shadow) return;
    light.shadow.bias = shadowDepthBias();
    light.shadow.map?.dispose();
    light.shadow.map = null;
    light.shadow.needsUpdate = true;
  });
  for (const camera of cameras) {
    (camera as Camera & { _reversedDepth: boolean })._reversedDepth = reversed;
    (camera as Camera & { updateProjectionMatrix?: () => void }).updateProjectionMatrix?.();
  }
  return next;
}
