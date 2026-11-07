/**
 * The `world:brief` builder runs the whole settlement chain (RANDOM_WORLD_PLAN step 1):
 * a village in a brief gets its site, streets, parcels, land use, buildings on
 * levelled pads, street furniture and fences, with the road and street splines
 * and the pads baked into the terrain, and the furniture and fences standing on
 * that finished ground. Generic test data: a wide, gently falling valley.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHAPE_PRIMITIVE_SIZE } from "../../engine/scene/shapes";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { validateSaveWorldRecipePayload } from "../../tools/saveValidator";
import { buildWorldFromBrief, type WorldBriefBuild } from "../../tools/world/worldBriefBuild";
import { PILOT_TUNING } from "../../tools/world/worldBriefTemporarySteps";
import { PILOT_BRIEF } from "./worldBrief.test";

type Check = (label: string, run: () => void) => void;

const LEVEL = "assets/trial/Village.level.json";
const PROFILE = "assets/world-pilot/Levels/WbPilotValley.regionprofile.json";

export const VILLAGE_BRIEF = {
  schema: 1,
  type: "worldBrief",
  id: "village_test",
  seed: 7,
  frame: { east: 0, north: 0, elevation: 0 },
  area: { west: -500, east: 500, south: -500, north: 500 },
  terrain: { id: "ground", name: "Village Test", tileQuads: 128, spacing: 1, heightRange: [-50, 250] },
  regionProfile: PROFILE,
  valleys: [{
    id: "basin",
    axis: "northSouth",
    sections: [{ north: 500, floor: [-450, 450], rock: [-495, 495] }, { north: -500, floor: [-450, 450], rock: [-495, 495] }],
    floorProfile: [{ north: 500, elevation: 30 }, { north: -500, elevation: 0 }],
    sideSlopeDeg: 20,
    relief: { slopeFoot: 18, spurs: 0, ridges: 0, noise: 0 },
  }],
  regions: [],
  water: [],
  roads: {
    nodes: [{ id: "south", at: [0, -480], kind: "end" }, { id: "centre", at: [0, 0], kind: "junction" }, { id: "east", at: [470, 60], kind: "end" }],
    edges: [{ id: "south", from: "south", to: "centre", roadClass: "collector" }, { id: "east", from: "centre", to: "east", roadClass: "local" }],
  },
  landmarks: [],
  settlements: [{ id: "village", type: "village", center: [0, 0], radius: 200, population: 180 }],
  props: [],
  models: [],
};

function build(): WorldBriefBuild {
  // The temporary rock scatter (`worldBriefTemporarySteps.ts`) needs the pilot's model rows.
  const models = JSON.parse(readFileSync(PILOT_BRIEF, "utf8")).models;
  const { brief, issues } = normalizeWorldBrief({ ...structuredClone(VILLAGE_BRIEF), models });
  assert.deepEqual(issues, []);
  const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${PROFILE}`, "utf8"))).profile;
  const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
  const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
  return buildWorldFromBrief({ brief: brief as WorldBrief, levelPath: LEVEL, profile, assetIdForFile: (file) => byPath.get(file) ?? null });
}

export function registerWorldBriefSettlementTests(check: Check): void {
  let cached: WorldBriefBuild | undefined;
  const world = () => (cached ??= build());

  check("world brief village: the whole chain runs and builds a greybox village", () => {
    const { stages, layout, recipe } = world();
    assert.deepEqual(stages.map((plan) => plan.stageId), ["roads", "settlementSites", "streets", "parcels", "landUse", "buildings", "furniture", "fences"]);
    for (const plan of stages) assert.deepEqual(plan.errors, [], plan.stageId);
    const roles = new Map<string, number>();
    for (const group of layout.instances) for (const placement of group.placements) roles.set(placement.role ?? group.assetId, (roles.get(placement.role ?? group.assetId) ?? 0) + 1);
    const buildings = [...roles].filter(([role]) => role.startsWith("building.")).reduce((sum, [, count]) => sum + count, 0);
    assert.ok(buildings >= 20, `${buildings} buildings`);
    assert.equal(recipe.generated.pads.length >= buildings, true, "a pad under every building");
    assert.ok((roles.get("prop.fence.picket") ?? 0) > 100, "fences round the lots");
    assert.ok((roles.get("prop.light.street") ?? 0) > 0, "street lights");
    assert.equal(roles.get("marker.parcel"), undefined, "no parcel plates in a built scene");
    assert.ok(recipe.generated.parcels.length >= buildings);
  });

  check("world brief village: roads, streets and pads are baked; furniture and fences stand on the finished ground", () => {
    const { def, recipe, layout, sampleHeight } = world();
    const streets = (def.splines ?? []).filter((spline) => spline.id.startsWith("wb-street-"));
    assert.ok(streets.length > 0, "inner streets");
    for (const spline of def.splines ?? []) {
      for (const point of spline.points) {
        const [x, y, z] = point.position;
        // The spline bake follows the smoothed curve and its cross-section, a few decimetres at most from a control point.
        assert.ok(Math.abs(sampleHeight(x, z)! - y) < 0.3, `${spline.id} ${point.id} baked (${(sampleHeight(x, z)! - y).toFixed(3)})`);
      }
    }
    for (const pad of recipe.generated.pads) {
      const [cx, cz] = pad.polygon.reduce(([sx, sz], [x, z]) => [sx + x / pad.polygon.length, sz + z / pad.polygon.length], [0, 0]);
      assert.ok(Math.abs(sampleHeight(cx, cz)! - pad.height) < 0.02, `pad ${pad.id} level`);
    }
    const placed = (role: string) => layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role === role);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    // A street light stands on its road's designed height, which the bake follows within the spline tolerance.
    const lights = placed("prop.light.street").map(({ position }) => position[1]! - sampleHeight(position[0]!, position[2]!)!);
    assert.ok(lights.length > 0 && spread(lights) < 0.3, `street lights on the road (${Math.min(...lights).toFixed(3)}..${Math.max(...lights).toFixed(3)})`);
    // A fence piece is laid from the ground at its two ends: its top stands the same height
    // above their mean on the finished ground (on the unlevelled ground it would not).
    const tops = placed("prop.fence.picket").map(({ position, rotation, scale }) => {
      const yaw = (rotation![1]! * Math.PI) / 180;
      const half = (scale as number[])[0]! * SHAPE_PRIMITIVE_SIZE / 2;
      const [dx, dz] = [Math.cos(yaw) * half, -Math.sin(yaw) * half];
      const ends = (sampleHeight(position[0]! - dx, position[2]! - dz)! + sampleHeight(position[0]! + dx, position[2]! + dz)!) / 2;
      return position[1]! + (scale as number[])[1]! * SHAPE_PRIMITIVE_SIZE / 2 - ends;
    });
    assert.ok(tops.length > 100 && spread(tops) < 0.01, `fences on the finished ground (${Math.min(...tops).toFixed(3)}..${Math.max(...tops).toFixed(3)})`);
  });

  check("world brief village: plants cannot grow in a building or on the main road (settlement and road paint)", () => {
    const { def, tiles, recipe } = world();
    const weightAt = (layerId: string, x: number, z: number): number => {
      const layer = def.layers.findIndex((entry) => entry.id === layerId);
      const [i, j] = [Math.round((x - def.origin[0]) / def.spacing), Math.round((z - def.origin[2]) / def.spacing)];
      const tile = tiles.get(`${Math.min(def.tilesX - 1, Math.floor(i / def.tileQuads))}_${Math.min(def.tilesZ - 1, Math.floor(j / def.tileQuads))}`)!;
      const index = (j - tile.z * def.tileQuads) * tile.size + (i - tile.x * def.tileQuads);
      return tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4]! / 255;
    };
    const plantLayers = new Set(PILOT_TUNING.plantRules.map((rule) => rule.layerId));
    for (const pad of recipe.generated.pads) {
      const [cx, cz] = pad.polygon.reduce(([sx, sz], [x, z]) => [sx + x / pad.polygon.length, sz + z / pad.polygon.length], [0, 0]);
      assert.ok(weightAt("dirt", cx, cz) > 0.99, `pad ${pad.id} painted`);
      for (const layerId of plantLayers) assert.ok(weightAt(layerId, cx, cz) < 0.01, `no ${layerId} under ${pad.id}`);
    }
    const road = def.splines!.find((spline) => spline.id === "wb-road-south")!;
    const [x, , z] = road.points[Math.floor(road.points.length / 3)]!.position;
    assert.ok(weightAt("asphalt", x, z) > 0.9, "the collector road is asphalt");
  });

  check("world brief village: the build is deterministic and its recipe is save-canonical", () => {
    const again = build();
    assert.deepEqual([...again.files.keys()], [...world().files.keys()]);
    for (const [path, data] of world().files) assert.deepEqual(again.files.get(path), data, path);
    const recipePath = "assets/trial/Village.worldrecipe.json";
    const text = world().files.get(recipePath) as string;
    assert.equal(`${JSON.stringify(validateSaveWorldRecipePayload({ level: LEVEL, recipe: JSON.parse(text) }).recipe, null, 2)}\n`, text);
  });
}
