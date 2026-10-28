/**
 * `planBlockout` stage: makes the recipe's plan visible in the level as
 * placeholder cubes — one per settlement centre, landmark and road node —
 * standing on the terrain (World Builder plan v0.4 §13.2 step 3: check what
 * the AI read from the reference before anything is generated from it).
 *
 * Ids are derived from plan ids, so a re-run updates the same cubes and a
 * removed plan element removes its cube. Roles name the marker kind; the
 * placeholder colour comes from the role later (T40).
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import type { WorldPoint } from "../normalize";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";

export const PLAN_BLOCKOUT_STAGE_ID = "planBlockout";

/** Marker box per plan element kind, `[width, height, depth]` in metres. */
const MARKER_SIZE = {
  settlement: [6, 12, 6],
  landmark: [3, 6, 3],
  roadNode: [1.5, 1.5, 1.5],
} as const satisfies Record<string, readonly [number, number, number]>;

export const planBlockoutStage: WorldStage = {
  id: PLAN_BLOCKOUT_STAGE_ID,
  label: "Plan blockout",
  version: 1,
  run(input: StageInput): StageOutput {
    const { plan } = input.recipe;
    const placements: GeneratedPlacement[] = [];
    const warnings: string[] = [];
    const marker = (
      kind: keyof typeof MARKER_SIZE,
      planId: string,
      point: WorldPoint,
      role: string,
    ): void => {
      const size = MARKER_SIZE[kind];
      const ground = input.sampleHeight(point[0], point[1]);
      if (ground === null) warnings.push(`${kind} ${planId} is off the terrain; its marker stands at y = 0`);
      const placement: LayoutPlacement & { id: string } = {
        id: `wb-blockout-${kind}-${planId}`,
        role,
        name: planId,
        position: [point[0], (ground ?? 0) + size[1] / 2, point[1]],
        scale: size.map((axis) => axis / SHAPE_PRIMITIVE_SIZE) as [number, number, number],
      };
      placements.push({ assetId: shapeAssetId("cube"), placement });
    };
    for (const settlement of plan.settlements) marker("settlement", settlement.id, settlement.center, "marker.settlement");
    for (const landmark of plan.landmarks) marker("landmark", landmark.id, landmark.position, "marker.landmark");
    for (const node of plan.roadGraph.nodes) marker("roadNode", node.id, node.position, "marker.roadNode");
    return { placements, warnings };
  },
};
