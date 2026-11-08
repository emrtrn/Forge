/**
 * World brief schema (`engine/worldbuilder/worldBrief.ts`): the normalizer is
 * strict and stable, the frame maps north-up metres onto Forge XZ, and the
 * recipe a brief describes passes the recipe normalizer unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEASONS, WEATHER_PRESETS } from "../../engine/environment/worldEnvironment";
import { WORLD_TERRAIN_CREATE_TILE_QUADS } from "../../engine/terrain/worldTerrainCreate";
import { normalizeWorldRecipe } from "../../engine/worldbuilder/recipe";
import {
  BRIEF_SEASONS,
  BRIEF_TILE_QUADS,
  BRIEF_WEATHER_PRESETS,
  briefToWorld,
  briefWorldBounds,
  normalizeWorldBrief,
  worldBriefLevelPath,
  worldBriefPath,
  worldBriefRecipe,
} from "../../engine/worldbuilder/worldBrief";

type Check = (label: string, run: () => void) => void;

export const PILOT_BRIEF = "public/assets/world-builder/Levels/WbPilotValley.worldbrief.json";

function minimalBrief(): Record<string, unknown> {
  return {
    schema: 1,
    type: "worldBrief",
    id: "tiny",
    seed: 1,
    area: { west: 0, east: 200, south: 0, north: 100 },
    terrain: { id: "ground", name: "Ground", tileQuads: 64, spacing: 1, heightRange: [0, 50] },
  };
}

export function registerWorldBriefTests(check: Check): void {
  const pilot = JSON.parse(readFileSync(PILOT_BRIEF, "utf8")) as Record<string, unknown>;

  check("world brief: the pilot brief normalizes cleanly and stays the same when normalized again", () => {
    const { brief, issues } = normalizeWorldBrief(pilot);
    assert.deepEqual(issues, []);
    assert.ok(brief);
    assert.deepEqual(normalizeWorldBrief(JSON.parse(JSON.stringify(brief))).brief, brief);
    assert.equal(brief.valleys[0]!.sections.length, 21);
    assert.equal(brief.valleys[0]!.sections[0]!.north, 500, "sections run north to south");
  });

  check("world brief: north-up metres land on Forge XZ through the frame", () => {
    const brief = normalizeWorldBrief(pilot).brief!;
    assert.deepEqual(briefToWorld(brief, [-215, 227]), [-215, -227]);
    assert.deepEqual(briefWorldBounds(brief), { min: [-500, -500], max: [500, 500] });
    const shifted = normalizeWorldBrief({ ...minimalBrief(), frame: { east: 100, north: 50, elevation: 10 } }).brief!;
    assert.deepEqual(briefToWorld(shifted, [100, 50]), [0, 0]);
    assert.deepEqual(briefToWorld(shifted, [150, 80]), [50, -30], "north is -Z");
    assert.deepEqual(briefWorldBounds(shifted), { min: [-100, -50], max: [100, 50] });
  });

  check("world brief: the recipe it describes passes the recipe normalizer unchanged", () => {
    const recipe = worldBriefRecipe(normalizeWorldBrief(pilot).brief!);
    const normalized = normalizeWorldRecipe(JSON.parse(JSON.stringify(recipe)));
    assert.deepEqual(normalized.issues, []);
    assert.deepEqual(normalized.recipe, recipe);
    assert.deepEqual(recipe.plan.regions.map((region) => [region.id, region.kind]),
      [["valley-floor", "valley"], ["valley-west", "forest.conifer"], ["valley-east", "forest.conifer"]]);
    const climb = recipe.plan.roadGraph.edges.find((edge) => edge.id === "climb")!;
    assert.equal(climb.source, "manual");
    assert.equal(climb.guide, undefined);
    const valley = recipe.plan.roadGraph.edges.find((edge) => edge.id === "valley")!;
    assert.deepEqual(valley.guide![0], [-39, 401]);
    assert.equal(valley.confidence, 0.9);
    assert.deepEqual(recipe.reference, {
      image: "assets/world-builder/Levels/WbPilotValley.reference.png", origin: [-500, -500], size: [1000, 1000], view: "topDown",
    });
  });

  check("world brief: a minimal brief is valid and every list defaults to empty", () => {
    const { brief, issues } = normalizeWorldBrief(minimalBrief());
    assert.deepEqual(issues, []);
    assert.deepEqual(brief!.frame, { east: 0, north: 0, elevation: 0 });
    assert.deepEqual([brief!.valleys, brief!.water, brief!.landmarks, brief!.props, brief!.models], [[], [], [], [], []]);
    assert.deepEqual(brief!.roads, { nodes: [], edges: [] });
  });

  check("world brief: mistakes are reported, never dropped quietly", () => {
    const issuesOf = (patch: Record<string, unknown>): string[] => {
      const result = normalizeWorldBrief({ ...minimalBrief(), ...patch });
      assert.equal(result.brief, null, JSON.stringify(patch));
      return result.issues;
    };
    assert.match(issuesOf({ colour: "green" }).join(), /colour: is not a world brief field/);
    assert.match(issuesOf({ playerStart: [300, 20] }).join(), /playerStart: lies outside the area/);
    assert.match(issuesOf({ roads: { nodes: [{ id: "a", at: [10, 10] }], edges: [{ id: "e", from: "a", to: "b", roadClass: "local" }] } }).join(),
      /roads\.edges\[0\]\.to: must name a road node/);
    assert.match(issuesOf({ landmarks: [{ id: "x", role: "building.cabin", at: [10, 10], confidence: 0.5 }] }).join(),
      /confidence: is only kept for source "reference"/);
    assert.match(issuesOf({ environment: { season: "monsoon" } }).join(), /environment\.season/);
    assert.match(issuesOf({ models: [{ role: "prop.rock", source: "scan", file: "a.glb" }] }).join(), /models\[0\]\.source/);
    assert.match(issuesOf({
      valleys: [{ id: "v", axis: "northSouth", floorProfile: [{ north: 0, elevation: 10 }], sideSlopeDeg: 20,
        sections: [{ north: 0, floor: [-10, 10], rock: [-5, 40] }, { north: 50, floor: [-10, 10], rock: [-40, 40] }] }],
    }).join(), /rock: must lie outside the floor on both sides/);
    assert.match(issuesOf({ water: [{ id: "w", kind: "river", line: [[10, 10], [20, 20]], bedDepth: 1, surfaceDepth: 2 }] }).join(),
      /surfaceDepth: must be less than bedDepth/);
    assert.deepEqual(normalizeWorldBrief({ ...minimalBrief(), schema: 2 }).issues, ["schema must be 1"]);
  });

  check("world brief: it sits beside its level", () => {
    assert.equal(worldBriefPath("assets/a/Valley.level.json"), "assets/a/Valley.worldbrief.json");
    assert.equal(worldBriefLevelPath("assets/a/Valley.worldbrief.json"), "assets/a/Valley.level.json");
    assert.throws(() => worldBriefLevelPath("assets/a/Valley.json"), /\.worldbrief\.json/);
  });

  check("world brief: its tile sizes, seasons and weather are the engine's", () => {
    assert.deepEqual([...BRIEF_TILE_QUADS], [...WORLD_TERRAIN_CREATE_TILE_QUADS]);
    assert.deepEqual([...BRIEF_SEASONS], [...SEASONS]);
    assert.deepEqual([...BRIEF_WEATHER_PRESETS], [...WEATHER_PRESETS]);
  });
}
