import assert from "node:assert/strict";
import { designRoadNetwork, designRoadProfile } from "../../engine/worldbuilder/roadProfile";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";

const line = (count: number, step = 2): WorldPoint[] => Array.from({ length: count }, (_, i) => [i * step, 0]);
const grades = (heights: readonly number[], step = 2): number[] => heights.slice(1).map((h, i) => Math.abs(h - heights[i]!) / step);

export async function registerRoadProfileTests(check: (label: string, fn: () => Promise<void>) => Promise<void>) {
  await check("road profile: ground within the limit is kept exactly", async () => {
    const points = line(40);
    const ground = points.map(([x]) => 100 + 0.08 * x + 0.5 * Math.sin(x / 15));
    const profile = designRoadProfile(points, ground, 0.12);
    assert.deepEqual(profile.heights, ground);
    assert.equal(profile.maxCut, 0);
    assert.equal(profile.maxFill, 0);
    assert.equal(profile.overLimit, false);
  });

  await check("road profile: steeper ground is cut and filled to the grade limit", async () => {
    const points = line(100);
    // A 25% hill in the middle of flat ground.
    const ground = points.map(([x]) => 100 + Math.max(0, 20 - Math.abs(x - 100)) * 0.25 * 4);
    const profile = designRoadProfile(points, ground, 0.1);
    assert.ok(profile.maxGrade <= 0.1 + 1e-9, `max grade ${profile.maxGrade}`);
    assert.ok(profile.maxCut > 5, `cuts into the hill (${profile.maxCut})`);
    assert.ok(profile.maxFill >= 0);
    assert.equal(profile.heights[0], 100);
    assert.equal(profile.heights[99], 100);
  });

  await check("road profile: fixed heights hold; an impossible pair spreads its grade evenly", async () => {
    const points = line(51);
    const ground = points.map(() => 50);
    // 30 m over 100 m between the two fixes: 30%, three times the 10% limit.
    const profile = designRoadProfile(points, ground, 0.1, [{ index: 0, height: 50 }, { index: 50, height: 80 }]);
    assert.equal(profile.heights[0], 50);
    assert.equal(profile.heights[50], 80);
    assert.equal(profile.overLimit, true);
    const steps = grades(profile.heights);
    assert.ok(Math.max(...steps) < 0.31 && Math.min(...steps) > 0.29, "the 30% is spread, not piled on one step");
    assert.throws(() => designRoadProfile(points, ground, 0.1, [{ index: 51, height: 0 }]));
    assert.throws(() => designRoadProfile(points, ground.slice(1), 0.1));
    assert.throws(() => designRoadProfile(points, ground, 0));
  });

  await check("road network: later roads take earlier heights at joins and crossings", async () => {
    // Main road along X on a slope; a branch ending at its edge; a road crossing it.
    const main = line(51);
    const branch: WorldPoint[] = Array.from({ length: 21 }, (_, i) => [40, 3 + i * 2]);
    const cross: WorldPoint[] = Array.from({ length: 31 }, (_, i) => [70, -30 + i * 2]);
    const ground = (points: WorldPoint[]) => points.map(([x, z]) => 100 + 0.3 * x + 0.2 * z);
    const [mainProfile, branchProfile, crossProfile] = designRoadNetwork([
      { id: "main", points: main, ground: ground(main), maxGrade: 0.1, width: 6 },
      { id: "branch", points: branch, ground: ground(branch), maxGrade: 0.15, width: 4 },
      { id: "cross", points: cross, ground: ground(cross), maxGrade: 0.15, width: 4 },
    ]);
    assert.equal(mainProfile!.joins, 0);
    assert.ok(mainProfile!.maxGrade <= 0.1 + 1e-9);
    assert.equal(branchProfile!.heights[0], mainProfile!.heights[20], "branch end meets the main road at x = 40");
    const crossing = crossProfile!.heights[15]!;
    assert.ok(Math.abs(crossing - mainProfile!.heights[35]!) < 1e-9, "the crossing shares the main road's height at x = 70");
    assert.ok(branchProfile!.joins >= 1 && crossProfile!.joins >= 1);
    // Deterministic.
    assert.deepEqual(designRoadNetwork([{ id: "main", points: main, ground: ground(main), maxGrade: 0.1, width: 6 }])[0]!.heights, mainProfile!.heights);
  });
}
