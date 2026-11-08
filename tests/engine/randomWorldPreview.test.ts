/**
 * Random world preview (RANDOM_WORLD_PLAN step 5,
 * `engine/worldbuilder/randomWorldPreview.ts`): the editor window's bird's-eye
 * picture comes from the same brief and ground the builder uses.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { normalizeGroundCover, type GroundCover } from "../../engine/worldbuilder/groundCover";
import { COVERS, randomWorldBrief, worldExtent, type CoverName, type RandomWorldOptions } from "../../engine/worldbuilder/randomWorld";
import { randomWorldPreview, PREVIEW_WATER_COLOR, type RandomWorldPreview } from "../../engine/worldbuilder/randomWorldPreview";
import { briefToWorld, briefWorldBounds, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";

type Check = (label: string, run: () => void) => void;

const OPTIONS: RandomWorldOptions = {
  id: "preview_test",
  name: "Preview Test",
  seed: 7,
  size: "small",
  landform: "hills",
  mountainHeight: "medium",
  settlements: [{ type: "village" }, { type: "hamlet" }],
  roads: "exits",
  cover: "forest",
};

function cover(name: CoverName): GroundCover {
  const { cover: loaded, issues } = normalizeGroundCover(JSON.parse(readFileSync(`public/${COVERS[name]}`, "utf8")));
  assert.deepEqual(issues, []);
  return loaded!;
}

function preview(options: Partial<RandomWorldOptions>, resolution = 64): RandomWorldPreview {
  const merged = { ...OPTIONS, ...options };
  return randomWorldPreview(merged, cover(merged.cover ?? "forest"), resolution);
}

function meanColor(world: RandomWorldPreview): [number, number, number] {
  const sum = [0, 0, 0];
  for (let k = 0; k < world.pixels.length; k += 4) for (let c = 0; c < 3; c += 1) sum[c]! += world.pixels[k + c]!;
  const count = world.pixels.length / 4;
  return [sum[0]! / count, sum[1]! / count, sum[2]! / count];
}

export function registerRandomWorldPreviewTests(check: Check): void {
  check("random world preview: same choices, same picture", () => {
    const a = preview({});
    const b = preview({});
    assert.equal(a.pixels.length, 64 * 64 * 4);
    assert.deepEqual(a.pixels, b.pixels);
    assert.deepEqual(a.settlements, b.settlements);
    assert.notDeepEqual(preview({ seed: 8 }).pixels, a.pixels);
    assert.equal(a.extent, worldExtent("small"));
  });

  check("random world preview: settlements and roads sit where the brief puts them", () => {
    const world = preview({});
    const { brief } = normalizeWorldBrief(structuredClone(randomWorldBrief(OPTIONS).brief));
    const typed = brief as WorldBrief;
    const { min, max } = briefWorldBounds(typed);
    assert.equal(world.settlements.length, typed.settlements.length);
    typed.settlements.forEach((settlement, index) => {
      const [x, z] = briefToWorld(typed, settlement.center);
      const [u, v] = world.settlements[index]!.at;
      assert.ok(Math.abs(u - (x - min[0]) / (max[0] - min[0])) < 1e-9);
      assert.ok(Math.abs(v - (z - min[1]) / (max[1] - min[1])) < 1e-9);
    });
    assert.equal(world.roads.length, typed.roads.edges.length);
    for (const road of world.roads) for (const value of [...road.from, ...road.to]) assert.ok(value >= 0 && value <= 1, road.id);
  });

  check("random world preview: rivers and lakes are the builder's water", () => {
    const options = { ...OPTIONS, rivers: 1, lakes: 1, seed: 21 };
    const world = preview(options, 96);
    const { brief } = normalizeWorldBrief(structuredClone(randomWorldBrief(options).brief));
    const terrain = createBriefTerrain(brief as WorldBrief);
    assert.equal(world.rivers.length, terrain.courses.length);
    assert.equal(world.lakes.length, terrain.lakes.length);
    assert.ok(world.lakes.length > 0, "seed 21 has a lake");
    let water = 0;
    for (let k = 0; k < world.pixels.length; k += 4) {
      if (world.pixels[k] === PREVIEW_WATER_COLOR[0] && world.pixels[k + 1] === PREVIEW_WATER_COLOR[1] && world.pixels[k + 2] === PREVIEW_WATER_COLOR[2]) water += 1;
    }
    assert.ok(water > 0, "the lake is filled in");
  });

  check("random world preview: landform and cover change the picture", () => {
    const plain = preview({ landform: "plain" });
    const mountains = preview({ landform: "mountains", mountainHeight: "high" });
    const span = (world: RandomWorldPreview): number => world.heightRange[1] - world.heightRange[0];
    assert.ok(span(mountains) > 3 * span(plain), `${span(mountains)} vs ${span(plain)}`);
    const [forest, desert] = [meanColor(preview({ cover: "forest" })), meanColor(preview({ cover: "desert" }))];
    // Desert ground is warmer and lighter than forest floor.
    assert.ok(desert[0] - desert[2] > forest[0] - forest[2] && desert[0] > forest[0], `${desert} vs ${forest}`);
  });
}
