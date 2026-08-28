import type { PerspectiveCamera } from "three";

/**
 * Editor viewport camera persistence.
 *
 * The editor is an authoring surface people reload constantly (asset re-export,
 * a code change, a manual refresh). Re-framing the viewport to the scene's
 * default 3/4 pose every time throws away where the user was working, so the
 * last viewport pose is remembered per level and restored on the next boot.
 *
 * Editor-only: `SceneApp` builds this behind `editorEnabled`, so the game bundle
 * never reaches it. The pose lives in `localStorage` (a per-machine authoring
 * preference), never in the layout file — reloading must not dirty the level.
 */

const STORAGE_PREFIX = "forge.editor.cameraPose.";
/** Throttle: fly navigation moves the camera every frame; storage doesn't need that. */
const SAVE_INTERVAL_MS = 700;

export interface EditorCameraPose {
  readonly position: [number, number, number];
  readonly quaternion: [number, number, number, number];
  readonly up: [number, number, number];
}

function isFiniteTuple(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function parsePose(raw: string): EditorCameraPose | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      isFiniteTuple((parsed as EditorCameraPose).position, 3) &&
      isFiniteTuple((parsed as EditorCameraPose).quaternion, 4) &&
      isFiniteTuple((parsed as EditorCameraPose).up, 3)
    ) {
      return parsed as EditorCameraPose;
    }
  } catch {
    // Corrupt JSON: fall back to the scene's default framing.
  }
  return null;
}

function readPose(camera: PerspectiveCamera): EditorCameraPose {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ],
    up: [camera.up.x, camera.up.y, camera.up.z],
  };
}

/**
 * Remembers the perspective viewport pose for one level. The orthographic
 * technical presets (Top/Front/Left) are transient view choices and are not
 * persisted — a reload always comes back in Perspective, at the last pose.
 */
export class EditorCameraPoseStore {
  private key: string | null = null;
  private lastSerialized: string | null = null;
  private lastWriteMs = Number.NEGATIVE_INFINITY;

  /** Binds the store to a level path; poses are remembered per level. */
  setScenePath(scenePath: string): void {
    this.key = scenePath ? `${STORAGE_PREFIX}${encodeURIComponent(scenePath)}` : null;
    this.lastSerialized = null;
    this.lastWriteMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Applies the remembered pose to `camera`. Returns false when there is nothing
   * stored (or storage is unavailable), leaving the default framing in place.
   */
  restore(camera: PerspectiveCamera): boolean {
    if (!this.key) return false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return false;
    }
    if (raw === null) return false;
    const pose = parsePose(raw);
    if (!pose) return false;
    camera.up.set(...pose.up);
    camera.position.set(...pose.position);
    camera.quaternion.set(...pose.quaternion);
    camera.updateMatrixWorld();
    this.lastSerialized = raw;
    return true;
  }

  /** Frame-loop hook: writes at most once per {@link SAVE_INTERVAL_MS}. */
  maybeSave(camera: PerspectiveCamera, nowMs: number): void {
    if (nowMs - this.lastWriteMs < SAVE_INTERVAL_MS) return;
    this.lastWriteMs = nowMs;
    this.save(camera);
  }

  /** Unthrottled write, for teardown/`pagehide` so the final pose is not lost. */
  save(camera: PerspectiveCamera): void {
    if (!this.key) return;
    const serialized = JSON.stringify(readPose(camera));
    if (serialized === this.lastSerialized) return;
    try {
      window.localStorage.setItem(this.key, serialized);
      this.lastSerialized = serialized;
    } catch {
      // Private mode / quota: editing continues, just without a remembered pose.
    }
  }
}
