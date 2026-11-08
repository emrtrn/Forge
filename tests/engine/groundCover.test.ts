/**
 * Ground covers (RANDOM_WORLD_PLAN step 4, `engine/worldbuilder/groundCover.ts`):
 * the shipped covers are valid, the `forest` cover builds exactly what the
 * pilot's paint built, and each cover paints and plants what it says.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COVERS, randomWorldBrief, type CoverName, type RandomWorldOptions } from "../../engine/worldbuilder/randomWorld";
import { COVER_MAX_LAYERS, normalizeGroundCover, type GroundCover } from "../../engine/worldbuilder/groundCover";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { briefToWorld, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { buildWorldFromBrief, type WorldBriefBuild } from "../../tools/world/worldBriefBuild";

type Check = (label: string, run: () => void) => void;

const OPTIONS: RandomWorldOptions = {
  id: "cover_test",
  name: "Cover Test",
  seed: 21,
  size: "small",
  landform: "hills",
  mountainHeight: "medium",
  settlements: [{ type: "village" }, { type: "hamlet" }],
  roads: "between",
  rivers: 1,
};

function loadCover(file: string): GroundCover {
  const { cover, issues } = normalizeGroundCover(JSON.parse(readFileSync(`public/${file}`, "utf8")));
  assert.deepEqual(issues, [], file);
  return cover!;
}

function build(options: Partial<RandomWorldOptions>): WorldBriefBuild {
  const raw = randomWorldBrief({ ...OPTIONS, ...options }).brief;
  const { brief, issues } = normalizeWorldBrief(structuredClone(raw));
  assert.deepEqual(issues, []);
  const world = brief as WorldBrief;
  const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile;
  const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
  const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
  return buildWorldFromBrief({
    brief: world, levelPath: "assets/trial/Cover.level.json", profile,
    cover: world.cover ? loadCover(world.cover.file) : null,
    assetIdForFile: (file) => byPath.get(file) ?? null,
  });
}

/** Mean paint weight of each layer over the samples `keep` accepts, by layer id. */
function paintShare(world: WorldBriefBuild, keep: (x: number, z: number, height: number) => boolean): Record<string, number> {
  const { def } = world;
  const sums = new Array<number>(def.layers.length).fill(0);
  let count = 0;
  for (const tile of world.tiles.values()) {
    for (let j = 0; j < tile.size; j += 4) {
      for (let i = 0; i < tile.size; i += 4) {
        const index = j * tile.size + i;
        const x = def.origin[0] + (tile.x * def.tileQuads + i) * def.spacing;
        const z = def.origin[2] + (tile.z * def.tileQuads + j) * def.spacing;
        if (!keep(x, z, tile.heights[index]!)) continue;
        count += 1;
        for (let layer = 0; layer < def.layers.length; layer += 1) {
          sums[layer] += tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4]! / 255;
        }
      }
    }
  }
  return Object.fromEntries(def.layers.map((layer, index) => [layer.id, count ? sums[index]! / count : 0]));
}

export function registerGroundCoverTests(check: Check, checkSlow: Check): void {
  check("ground cover: every shipped cover is valid; unknown fields and bad layer names are reported", () => {
    for (const file of Object.values(COVERS)) {
      const cover = loadCover(file);
      assert.ok(cover.layers.length <= COVER_MAX_LAYERS);
      assert.ok(cover.layers.some((layer) => layer.id === cover.roles.road), `${file}: the road layer`);
    }
    const forest = JSON.parse(readFileSync(`public/${COVERS.forest}`, "utf8"));
    const issues = (patch: Record<string, unknown>): string => normalizeGroundCover({ ...structuredClone(forest), ...patch }).issues.join();
    assert.match(issues({ colour: "red" }), /colour: is not a ground cover field/);
    assert.match(issues({ roles: { ...forest.roles, open: "lawn" } }), /roles\.open: must name one of the cover's layers/);
    assert.match(issues({ snow: { quantile: 0.7, minAbove: 10, fade: 5, treeGap: 5 } }), /roles\.snow: is needed with snow/);
    assert.match(issues({ layers: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: "L", color: "#000000" })) }), /must list 1\.\.8 layers/);
  });

  check("ground cover: a brief names its cover file and densities; the brief rejects anything else", () => {
    const raw = randomWorldBrief({ ...OPTIONS, cover: "farmland", densities: { forest: "low", rocks: "medium", fields: "high" } }).brief;
    const { brief } = normalizeWorldBrief(structuredClone(raw));
    assert.deepEqual(brief!.cover, { file: COVERS.farmland, forest: "low", fields: "high" }, "medium is the default and not written");
    assert.equal(randomWorldBrief(OPTIONS).brief.cover, undefined, "no cover asked: none named");
    const issues = normalizeWorldBrief({ ...structuredClone(raw), cover: { file: "x.json", trees: "high", rocks: "lots" } }).issues.join();
    assert.match(issues, /cover\.file: must be a public-root-relative \*\.cover\.json/);
    assert.match(issues, /cover\.trees: is not a cover field/);
    assert.match(issues, /cover\.rocks: must be one of low, medium, high/);
  });

  checkSlow("ground cover: the forest cover builds exactly what the pilot's paint built", () => {
    const [before, after] = [build({}), build({ cover: "forest" })];
    assert.deepEqual(after.def.layers, before.def.layers);
    for (const [key, tile] of before.tiles) {
      const other = after.tiles.get(key)!;
      assert.deepEqual(other.heights, tile.heights, `heights ${key}`);
      assert.deepEqual(other.weights, tile.weights, `paint ${key}`);
    }
    assert.deepEqual(after.foliage, before.foliage, "the same plant rules");
    assert.deepEqual(after.layout, before.layout, "the same placements");
  });

  checkSlow("ground cover: each cover paints what it says", () => {
    const share = {} as Record<CoverName, { all: Record<string, number>; near: Record<string, number>; far: Record<string, number> }>;
    for (const name of Object.keys(COVERS) as CoverName[]) {
      // Snow needs mountains: on low hills the snow line (at least 60 m over the lowest ground) is never reached.
      const options: Partial<RandomWorldOptions> = { cover: name, ...(name === "alpine" ? { landform: "mountains" as const } : {}) };
      const world = build(options);
      for (const plan of world.stages) assert.deepEqual(plan.errors, [], `${name} ${plan.stageId}`);
      const brief = randomWorldBrief({ ...OPTIONS, ...options }).brief as unknown as WorldBrief;
      const centres = brief.settlements.map((settlement) => [...briefToWorld(brief, settlement.center), settlement.radius ?? 150] as const);
      const gap = (x: number, z: number): number => Math.min(...centres.map(([cx, cz, radius]) => Math.hypot(x - cx, z - cz) - radius));
      share[name] = {
        all: paintShare(world, () => true),
        near: paintShare(world, (x, z) => gap(x, z) > 0 && gap(x, z) < 200),
        far: paintShare(world, (x, z) => gap(x, z) > 350 && !world.ground.water(x, z)),
      };
    }
    assert.ok(share.forest.far.forest! > 0.6, `forest: woods away from the villages (${share.forest.far.forest!.toFixed(2)})`);
    assert.ok(share.meadow.far.forest! > 0.05 && share.meadow.far.forest! < 0.5, `meadow: groves (${share.meadow.far.forest!.toFixed(2)})`);
    const fields = share.farmland.near["field-gold"]! + share.farmland.near["field-green"]!;
    assert.ok(fields > 0.25, `farmland: plots round the villages (${fields.toFixed(2)})`);
    assert.ok(share.farmland.far["field-gold"]! < 0.05, "farmland: no plots far out");
    assert.ok(share.steppe.far.steppe! > 0.6 && share.steppe.far.forest! < 0.05, "steppe: dry grass, no woods away from water");
    assert.ok(share.desert.all.sand! > 0.6, `desert: sand (${share.desert.all.sand!.toFixed(2)})`);
    assert.ok(share.desert.all.meadow! > 0, "desert: green by the river");
    assert.equal(paintShare(build({ cover: "alpine" }), () => true).snow, 0, "alpine on low hills: no snow");
    assert.ok(share.alpine.all.snow! > 0.05 && share.alpine.near.snow! < share.alpine.all.snow!, `alpine: snow up high (${share.alpine.all.snow!.toFixed(2)})`);
  });

  checkSlow("ground cover: densities thin or thicken the forest and the rocks", () => {
    const rocks = (world: WorldBriefBuild): number => world.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role === "prop.rock").length;
    const forest = (world: WorldBriefBuild): number => paintShare(world, () => true).forest!;
    const [low, high] = [build({ cover: "meadow", densities: { forest: "low", rocks: "low" } }), build({ cover: "meadow", densities: { forest: "high", rocks: "high" } })];
    assert.ok(forest(low) < forest(high), `forest ${forest(low).toFixed(2)} < ${forest(high).toFixed(2)}`);
    assert.ok(rocks(low) < rocks(high), `rocks ${rocks(low)} < ${rocks(high)}`);
  });
}
