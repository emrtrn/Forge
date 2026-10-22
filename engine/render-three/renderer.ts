import { PCFSoftShadowMap, WebGLRenderer } from "three";

export interface RenderStats {
  drawCalls: number;
  triangles: number;
}

/** GPU resource counts from `renderer.info` (for the `?debug` memory readout). */
export interface RenderMemoryStats {
  /** Live geometries retained on the GPU. */
  geometries: number;
  /** Live textures retained on the GPU. */
  textures: number;
  /** Compiled shader programs. */
  programs: number;
}

export function createSceneRenderer(
  canvas: HTMLCanvasElement,
  maxPixelRatio: number,
): WebGLRenderer {
  if (!canvas.getContext("webgl2")) {
    throw new Error("WebGL2 is not supported on this device/browser.");
  }

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // Draw statistics are per frame, not per `render()` call: the frame owner
  // resets them with `beginRenderStatsFrame`. three's automatic reset runs at
  // the start of every `render()` and after its shadow pass, so a composer
  // frame (RenderPass + OutputPass) or a nested reflection render left only the
  // last call in `renderer.info` and shadow draws were never counted.
  renderer.info.autoReset = false;
  return renderer;
}

/** Starts a frame's draw statistics; call once per frame before anything renders. */
export function beginRenderStatsFrame(renderer: WebGLRenderer): void {
  renderer.info.reset();
}

/** Draw calls and triangles of every render since `beginRenderStatsFrame`. */
export function readRenderStats(renderer: WebGLRenderer): RenderStats {
  const { calls, triangles } = renderer.info.render;
  return { drawCalls: calls, triangles };
}

export function readRenderMemory(renderer: WebGLRenderer): RenderMemoryStats {
  const { memory, programs } = renderer.info;
  return {
    geometries: memory.geometries,
    textures: memory.textures,
    programs: programs?.length ?? 0,
  };
}
