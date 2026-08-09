import { Color, Scene, Vector3 } from "three";
import type { PerspectiveCamera, WebGLRenderer } from "three";

import { applyResponsiveCameraViewport, createSceneCamera } from "@engine/render-three/camera";
import { createSceneRenderer } from "@engine/render-three/renderer";

const MAX_PIXEL_RATIO = 2;

/** Shared default focus used when a shell has not yet received an authored view. */
export const SCENE_SHELL_CAMERA_TARGET = new Vector3(0, 0.65, -0.2);

export interface SceneShellOptions {
  readonly backgroundColor: string | number;
}

export interface SceneShellResizeOptions {
  readonly width: number;
  readonly height: number;
  readonly viewTouched: boolean;
}

export interface SceneShellViewportOptions extends SceneShellResizeOptions {
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
}

/** Shared resize policy retained as a function for legacy SceneRuntimeCore callers. */
export function resizeSceneShellViewport(options: SceneShellViewportOptions): boolean {
  const resetView = applyResponsiveCameraViewport(options.camera, {
    width: options.width,
    height: options.height,
    target: SCENE_SHELL_CAMERA_TARGET,
    viewTouched: options.viewTouched,
  });
  options.renderer.setSize(options.width, options.height, false);
  return resetView;
}

/**
 * Owns only the renderer, Three scene, camera, and responsive viewport policy.
 * Level loading and editor/runtime behavior deliberately remain outside this
 * class so both shells can share lifecycle infrastructure without acquiring
 * each other's scene orchestration.
 */
export class SceneShell {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, options: SceneShellOptions) {
    this.renderer = createSceneRenderer(canvas, MAX_PIXEL_RATIO);
    this.scene = new Scene();
    this.scene.background = new Color(options.backgroundColor);
    this.camera = createSceneCamera();
  }

  resize(options: SceneShellResizeOptions): boolean {
    return resizeSceneShellViewport({ ...options, camera: this.camera, renderer: this.renderer });
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
