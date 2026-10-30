import assert from "node:assert/strict";
import type { LayoutLakeWaterBody, LayoutRiverWater } from "../../engine/scene/layout";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { isZeroMove, moveWorldTerrain, worldTerrainMoveDelta } from "../../engine/terrain/worldTerrainMove";

type Check = (label: string, fn: () => void) => void;

const DEF = { origin: [-128, 2, -64] as [number, number, number], tileQuads: 64, spacing: 2, tilesX: 2, tilesZ: 1 };

function spline(id: string, world: boolean, position: [number, number, number]): TerrainSpline {
  return {
    id, closed: false, ...(world ? { coordinateSpace: "world" as const } : {}),
    points: [{ id: `${id}-p`, position, tangent: [1, 0, 0] }],
  } as unknown as TerrainSpline;
}

function lake(id: string, terrainRef: string): LayoutLakeWaterBody {
  return {
    schema: 1, kind: "lake", mode: "fillExisting", coordinateSpace: "world", id, terrainRef,
    seed: [10, 20], bounds: { min: [0, 0], max: [40, 50] }, surfaceLevel: 3.5,
    bed: { points: [[1, 2], [3, 4], [5, 6]], smooth: true, smoothness: 0.5, maxDepth: 2, shoreSlopeDegrees: 20, transitionWidth: 4 },
  };
}

/** OPEN_WORLD_PLAN Faz 8 bridge removal K1: moving a World Terrain. */
export function registerWorldTerrainMoveTests(check: Check): void {
  check("world terrain move: the delta is the actor's offset from the definition centre", () => {
    // 2x1 tiles of 64 quads at 2 m: 256 m x 128 m, centred at (0, 2, 0).
    assert.deepEqual(worldTerrainActorPosition(DEF), [0, 2, 0]);
    assert.deepEqual(worldTerrainMoveDelta(DEF, [0, 2, 0]), [0, 0, 0]);
    assert.ok(isZeroMove(worldTerrainMoveDelta(DEF, [0, 2, 0])));
    assert.deepEqual(worldTerrainMoveDelta(DEF, [10.5, 1, -3]), [10.5, -1, -3]);
    assert.equal(isZeroMove([0, 1e-6, 0]), false);
  });

  check("world terrain move: origin, world-frame splines and this terrain's lakes shift; nothing else does", () => {
    const splines = [spline("road", true, [1, 2, 3]), spline("legacy", false, [5, 6, 7])];
    const lakes = [lake("pond", "terrain"), lake("other", "elsewhere")];
    const before = structuredClone({ splines, lakes });
    const result = moveWorldTerrain({ origin: DEF.origin, splines }, "terrain", lakes, [10, -1, 0.1]);
    assert.deepEqual(result.origin, [-118, 1, -63.9]);
    assert.deepEqual(result.splines![0]!.points[0]!.position, [11, 1, 3.1], "world spline points move");
    assert.deepEqual(result.splines![0]!.points[0]!.tangent, [1, 0, 0], "tangents are directions");
    assert.deepEqual(result.splines![1]!.points[0]!.position, [5, 6, 7], "centre-local splines already follow the terrain");
    const pond = result.lakes[0]!;
    assert.deepEqual(pond.seed, [20, 20.1]);
    assert.deepEqual(pond.bounds, { min: [10, 0.1], max: [50, 50.1] });
    assert.equal(pond.surfaceLevel, 2.5);
    assert.deepEqual(pond.bed!.points, [[11, 2.1], [13, 4.1], [15, 6.1]]);
    assert.equal(result.lakes[1], lakes[1], "another terrain's lake is returned as is");
    assert.deepEqual({ splines, lakes }, before, "inputs are never mutated");
    assert.equal(moveWorldTerrain({ origin: DEF.origin }, "terrain", [], [1, 0, 0]).splines, undefined);
  });

  check("world terrain move: this terrain's world-frame River Waters shift surface height; local ones follow by themselves", () => {
    const river = (id: string, landscapeRef: string, world: boolean): LayoutRiverWater => ({
      id, landscapeRef, splineRef: "path", ...(world ? { coordinateSpace: "world" as const } : {}), surfaceLevel: 4,
    } as unknown as LayoutRiverWater);
    const rivers = [river("world", "terrain", true), river("local", "terrain", false), river("other", "elsewhere", true)];
    const result = moveWorldTerrain({ origin: [0, 0, 0] }, "terrain", [], [10, 2, -1], rivers);
    assert.equal(result.rivers[0]!.surfaceLevel, 6);
    assert.equal(result.rivers[1], rivers[1], "centre-local data already follows the terrain");
    assert.equal(result.rivers[2], rivers[2], "another terrain's river is untouched");
    assert.equal(rivers[0]!.surfaceLevel, 4, "inputs are never mutated");
  });

  check("world terrain move: moving back restores the exact values without float noise", () => {
    const lakes = [lake("pond", "terrain")];
    const there = moveWorldTerrain({ origin: [0.1, 0.2, 0.3], splines: [spline("road", true, [0.1, 0.2, 0.3])] }, "terrain", lakes, [0.2, 0.1, 0.7]);
    assert.deepEqual(there.origin, [0.3, 0.3, 1], "0.1 + 0.2 is stored as 0.3");
    const back = moveWorldTerrain({ origin: there.origin, splines: there.splines }, "terrain", there.lakes, [-0.2, -0.1, -0.7]);
    assert.deepEqual(back.origin, [0.1, 0.2, 0.3]);
    assert.deepEqual(back.splines![0]!.points[0]!.position, [0.1, 0.2, 0.3]);
    assert.deepEqual(back.lakes[0], lakes[0]);
    assert.throws(() => moveWorldTerrain({ origin: [Number.MAX_VALUE, 0, 0] }, "terrain", [], [Number.MAX_VALUE, 0, 0]), /overflow/);
  });
}
