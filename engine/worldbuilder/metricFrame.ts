/** Local east/north/elevation metres to Forge X/Y/Z. No projection or scale change. */
import { WORLD_MAX_COORDINATE, isFiniteNumber, round, type WorldPoint } from "./normalize";

export interface MetricFrame {
  east: number;
  north: number;
  elevation: number;
}

function coordinate(value: unknown): number {
  if (!isFiniteNumber(value) || Math.abs(value) > WORLD_MAX_COORDINATE) {
    throw new Error(`Metric coordinates must be finite metres within ±${WORLD_MAX_COORDINATE}`);
  }
  return value;
}

export function metricToWorld(point: readonly [number, number], frame: MetricFrame): WorldPoint {
  return [round(coordinate(coordinate(point[0]) - coordinate(frame.east))),
    round(coordinate(coordinate(frame.north) - coordinate(point[1])))];
}

export function worldToMetric(point: readonly [number, number], frame: MetricFrame): WorldPoint {
  return [round(coordinate(coordinate(point[0]) + coordinate(frame.east))),
    round(coordinate(coordinate(frame.north) - coordinate(point[1])))];
}

export function metricElevationToWorld(elevation: number, frame: MetricFrame): number {
  return round(coordinate(coordinate(elevation) - coordinate(frame.elevation)));
}

/** Signed percent grade, not degrees. */
export function gradePercentToDegrees(percent: number): number {
  if (!isFiniteNumber(percent)) throw new Error("Grade percent must be finite");
  return Math.atan(percent / 100) * 180 / Math.PI;
}
