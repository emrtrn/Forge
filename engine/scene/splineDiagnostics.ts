/**
 * Presentation-only spline performance warnings (Faz 12 hardening of
 * archived `FORGE_GENERIC_SPLINE_SYSTEM_RESEARCH_AND_PLAN.md` — see `docs/COMPLETED_WORK_INDEX.md`, §19.4).
 *
 * Pure and dependency-free: it never touches Three.js, the layout, or generator
 * state, so both the editor Details panel and headless engine checks feed it the
 * counts they already have. Thresholds are soft warnings, not hard limits — the
 * generator code keeps its own `SPLINE_GENERATOR_MAX_INSTANCES` cap. Real limits
 * are meant to be tuned against device benchmarks; these are the safe defaults
 * from the plan's §19.4 table.
 */

/** Control-point count that starts to make interactive editing heavy. */
export const SPLINE_WARN_POINT_COUNT = 1000;
/** Generated-instance count at (or above) which output is likely truncated/expensive. */
export const SPLINE_WARN_GENERATED_INSTANCES = 10000;
/** Deform-mesh chunk count that makes per-segment rebuilds expensive. */
export const SPLINE_WARN_DEFORM_SEGMENTS = 500;
/** Per-generator sample steps that make each deform rebuild expensive. */
export const SPLINE_WARN_SAMPLE_STEPS = 64;

export interface SplinePerformanceMetrics {
  /** Total control points on the spline. */
  pointCount: number;
  /** Combined instance/rigid-segment placements this actor generates. */
  generatedInstanceCount?: number;
  /** Largest per-generator deform-mesh chunk count (segment-mode meshes). */
  deformSegmentCount?: number;
  /** Largest deform-mesh sample-steps value across this actor's generators. */
  maxDeformSampleSteps?: number;
}

/**
 * Returns human-readable soft warnings for the supplied metrics. Never throws;
 * non-finite or missing metrics are ignored so partially-built actors are safe.
 */
export function splinePerformanceWarnings(metrics: SplinePerformanceMetrics): string[] {
  const warnings: string[] = [];
  if (atOrAbove(metrics.pointCount, SPLINE_WARN_POINT_COUNT)) {
    warnings.push(
      `This spline has ${Math.floor(metrics.pointCount)} control points; editing above ${SPLINE_WARN_POINT_COUNT} can feel sluggish.`,
    );
  }
  if (atOrAbove(metrics.generatedInstanceCount, SPLINE_WARN_GENERATED_INSTANCES)) {
    warnings.push(
      `Generators produce ${Math.floor(metrics.generatedInstanceCount!)}+ instances; output is capped at ${SPLINE_WARN_GENERATED_INSTANCES} and may be expensive.`,
    );
  }
  if (atOrAbove(metrics.deformSegmentCount, SPLINE_WARN_DEFORM_SEGMENTS)) {
    warnings.push(
      `A deformed mesh spans ${Math.floor(metrics.deformSegmentCount!)} segment chunks; rebuilds above ${SPLINE_WARN_DEFORM_SEGMENTS} can stall the editor.`,
    );
  }
  if (atOrAbove(metrics.maxDeformSampleSteps, SPLINE_WARN_SAMPLE_STEPS)) {
    warnings.push(
      `A deformed mesh uses ${Math.floor(metrics.maxDeformSampleSteps!)} sample steps; interactive rebuilds get expensive at ${SPLINE_WARN_SAMPLE_STEPS}+.`,
    );
  }
  return warnings;
}

function atOrAbove(value: number | undefined, threshold: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= threshold;
}
