import type { PhysicsSurfaceTriangle } from "../behavior/behaviorSubsystem";
import { collapseCoincidentFloors, findGroundLayersAt } from "../movement/characterCollision";
import { slopeCosFromDegrees, type GroundSurfaceSample } from "../movement/slopeSurface";
import type { NavAabb, NavAgent } from "./gridNavigation";

const AI_NAV_MIN_TOP_SUPPORT_RADIUS = 0.15;

/** Shared nav bake sampler; point samples replace the triangle list when supplied. */
export function navFloorSampler(
  blockers: readonly NavAabb[],
  surfaces: readonly PhysicsSurfaceTriangle[],
  bounds: readonly NavAabb[],
  agent: NavAgent,
  preferredFloorY: number,
  sampleSurfaces?: (x: number, z: number) => readonly GroundSurfaceSample[],
): (x: number, z: number) => readonly number[] | null {
  const footprintHalf: [number, number] = [Math.max(0, agent.radius), Math.max(0, agent.radius)];
  const maxSlopeCos = slopeCosFromDegrees(agent.maxSlopeAngleDeg ?? 50);
  return (x, z) => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const bound of bounds) {
      if (x < bound.min[0] || x > bound.max[0] || z < bound.min[2] || z > bound.max[2]) continue;
      minY = Math.min(minY, bound.min[1]);
      maxY = Math.max(maxY, bound.max[1]);
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY < minY) return null;
    const hits = findGroundLayersAt([x, maxY, z], blockers, {
      footprintHalf,
      maxStepUp: 0,
      maxStepDown: maxY - minY,
      ...(sampleSurfaces ? { surfaceSamples: sampleSurfaces(x, z) } : { surfaces }),
      maxSlopeCos,
      preferredFloorY,
      requiredSupportRadius: Math.min(Math.max(0, agent.radius), AI_NAV_MIN_TOP_SUPPORT_RADIUS),
      // Recast walkableHeight: reject floor cells with less than the agent's
      // height of clearance above them, so no nav floor is baked under a
      // ramp/stair (nor on a wedge's downward-facing underside).
      requiredHeadroom: Math.max(0, agent.height),
      respectNavigationRole: true,
    });
    // Collapse near-coincident walkable surfaces into a single navigable floor,
    // keeping the highest of each cluster. A solid floor mesh (`complexAsSimple`)
    // reports both its top face and its slab underside/thickness as walkable
    // layers a few centimetres apart; CharacterMovement grounds the pawn on the
    // highest one, but the multi-layer nav grid would otherwise keep the lower
    // phantom layer and route the path through it — leaving interior waypoints
    // below the walking pawn. The follower's tight vertical acceptance can't
    // clear that gap, so the agent stalls a few steps in. Surfaces within the
    // agent's step height are one floor it can freely traverse, so this matches
    // movement while leaving genuinely distinct floors (upper platforms) intact.
    const layers = collapseCoincidentFloors(
      hits.map((hit) => hit.floorY),
      Math.max(agent.stepHeight ?? 0, 1e-3),
    );
    return layers.length > 0 ? layers : null;
  };
}
