import type { Vec3 } from "../scene/layout";

/**
 * When the World Environment re-captures the Sky Light (IBL) (WES v0.3 §6.4).
 * A capture renders the sky into a PMREM, so it never runs per frame: only when
 * the sun moved at least {@link RECAPTURE_MIN_ANGLE_DEG} or the weather/season
 * key changed, at most once per {@link RECAPTURE_MIN_INTERVAL_MS}, and never
 * while the editor clock is being scrubbed (one capture on release).
 */
export const RECAPTURE_MIN_ANGLE_DEG = 3;
export const RECAPTURE_MIN_INTERVAL_MS = 2000;

export interface CaptureRecord {
  sunDirection: Vec3;
  captureKey: string;
  timeMs: number;
}

export interface CaptureRequest {
  sunDirection: Vec3;
  captureKey: string;
  nowMs: number;
  /** The editor clock slider is being dragged. */
  scrubbing?: boolean;
  /** Ignore the interval (a scrub just ended, the level was just loaded). */
  immediate?: boolean;
}

export function shouldRecapture(last: CaptureRecord | null, request: CaptureRequest): boolean {
  if (request.scrubbing) return false;
  if (!last) return true;
  const changed = request.captureKey !== last.captureKey
    || angleBetweenDeg(last.sunDirection, request.sunDirection) >= RECAPTURE_MIN_ANGLE_DEG;
  if (!changed) return false;
  return request.immediate === true || request.nowMs - last.timeMs >= RECAPTURE_MIN_INTERVAL_MS;
}

export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a[0], a[1], a[2]) || 1;
  const lb = Math.hypot(b[0], b[1], b[2]) || 1;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}
