/**
 * Track step 2c: retaining walls, openings with steps, and terraces for open
 * pads (`engine/worldbuilder/terraces.ts`), and the buildings stage keeping them
 * with its pads so baking the pads changes nothing.
 */
import assert from "node:assert/strict";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import {
  frameCorners, retainPad, STEP_FREE, terracePad, TERRACE_STEP, WALL_FALLOFF, WALL_PARAPET, WALL_PROBE, WALL_THRESHOLD, type PadFrame,
} from "../../engine/worldbuilder/terraces";

type Check = (label: string, fn: () => void) => void;

// A 20 x 10 pad centred on the origin; z grows uphill at 20%.
const PAD: WorldPoint[] = [[-10, -5], [10, -5], [10, 5], [-10, 5]];
const slope = (_x: number, z: number): number => 100 + 0.2 * z;

export function registerTerraceTests(check: Check): void {
  check("terraces: a pad on a slope gets a cut wall uphill, a fill wall downhill, none across", () => {
    const { walls, stairs, maxCut, maxFill } = retainPad(PAD, 100, slope);
    // Ground read 3 m outside (past the 2 m blend): 0.2 * 8 = 1.6 m above and below the pad.
    assert.equal(maxCut, 1.6);
    assert.equal(maxFill, 1.6);
    assert.equal(stairs.length, 0);
    const uphill = walls.filter((wall) => wall.from[1] > 5);
    const downhill = walls.filter((wall) => wall.from[1] < -5);
    assert.equal(uphill.length, 1);
    assert.equal(downhill.length, 1);
    assert.deepEqual([uphill[0]!.bottom, uphill[0]!.top], [99.6, 101.6], "cut wall: from below the pad up to the ground");
    assert.deepEqual([downhill[0]!.bottom, downhill[0]!.top], [98, 100 + WALL_PARAPET], "fill wall: from the low ground to a parapet");
    // The wall covers the blend band: its inner face on the pad edge, its outer face a falloff out.
    assert.equal(uphill[0]!.from[1], 5 + WALL_FALLOFF / 2);
    // The side edges climb the slope: only their ends pass the threshold, and the runs there are short.
    assert.ok(walls.every((wall) => Math.abs(wall.from[1] - wall.to[1]) < 1e-9 || Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]) <= 10));
    // A pad on gentle ground needs no wall.
    assert.equal(retainPad(PAD, 100, (_x, z) => 100 + 0.05 * z).walls.length, 0);
    assert.ok(WALL_THRESHOLD < 1.6 && WALL_PROBE === WALL_FALLOFF + 1);
  });

  check("terraces: an opening splits the wall and gets steps on its low side", () => {
    // Entrance in the middle of the downhill (front) edge, 3 m wide.
    const { walls, stairs } = retainPad(PAD, 100, slope, [{ at: [0, -5], width: 3 }]);
    const downhill = walls.filter((wall) => wall.from[1] < -5);
    assert.equal(downhill.length, 2, "two wall pieces either side of the opening");
    assert.ok(downhill.every((wall) => Math.max(Math.abs(wall.from[0]), Math.abs(wall.to[0])) >= 1.5 - 1e-9 && Math.min(Math.abs(wall.from[0]), Math.abs(wall.to[0])) >= 1.5 - 1e-9));
    assert.equal(stairs.length, 1);
    const [stair] = stairs;
    // The ground outside is lower: the steps go down away from the pad.
    assert.deepEqual(stair!.head, [0, -5]);
    assert.ok(stair!.foot[1] < -5);
    assert.deepEqual([stair!.low, stair!.high], [98.4, 100]);
    assert.ok(1.6 > STEP_FREE);
    // An uphill entrance: the steps come down into the pad.
    const back = retainPad(PAD, 100, slope, [{ at: [0, 5], width: 3 }]).stairs[0]!;
    assert.ok(back.foot[1] < 5 && back.low === 100 && back.high === 101.6);
    // A skipped edge has no wall.
    assert.equal(retainPad(PAD, 100, slope, [], [0, 2]).walls.filter((wall) => Math.abs(wall.from[1]) > 5).length, 0);
  });

  check("terraces: an open pad on a steep slope splits across its depth, joined by walls and steps", () => {
    const frame: PadFrame = { center: [0, 0], along: [1, 0], inward: [0, 1], halfAlong: 30, front: 20, back: 20 };
    const steep = (_x: number, z: number): number => 50 + 0.15 * z;
    const result = terracePad(frame, steep)!;
    // 6 m over the 40 m depth: ceil(6 / 2.5) = 3 terraces.
    assert.equal(result.terraces.length, Math.ceil(6 / TERRACE_STEP));
    const levels = result.terraces.map((terrace) => terrace.level);
    assert.ok(levels[0]! < levels[1]! && levels[1]! < levels[2]!, "levels climb with the ground");
    // They tile the pad: the first front edge and the last back edge are the pad's.
    assert.deepEqual([result.terraces[0]!.polygon[0], result.terraces[0]!.polygon[1]], frameCorners(frame).slice(0, 2));
    assert.deepEqual([result.terraces[2]!.polygon[2], result.terraces[2]!.polygon[3]], frameCorners(frame).slice(2, 4));
    // At each boundary the lower terrace stops a falloff short of the upper one; the bake ramps the band.
    const depthOf = (p: WorldPoint) => p[1];
    assert.ok(Math.abs(depthOf(result.terraces[1]!.polygon[0]!) - depthOf(result.terraces[0]!.polygon[3]!) - WALL_FALLOFF) < 1e-6);
    // Two boundaries, each a wall split around a flight of steps.
    assert.deepEqual(result.walls.map((wall) => wall.boundary), [1, 1, 2, 2]);
    assert.deepEqual(result.stairs.map((stair) => stair.boundary), [1, 2]);
    assert.ok(result.stairs.every((stair) => stair.high > stair.low && stair.foot[1] < stair.head[1]), "steps run down onto the lower terrace");
    // Gentle ground: one terrace, nothing between.
    const gentle = terracePad(frame, (_x, z) => 50 + 0.02 * z)!;
    assert.equal(gentle.terraces.length, 1);
    assert.deepEqual([gentle.walls, gentle.stairs], [[], []]);
    assert.equal(terracePad(frame, () => null), null);
  });
}
