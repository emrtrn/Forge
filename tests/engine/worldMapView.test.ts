import assert from "node:assert/strict";
import {
  mapPixelToWorld,
  shadeWorldMapHeights,
  worldMapFocusPosition,
  worldMapFrame,
  worldMapHeightAt,
  worldToMapPixel,
} from "../../engine/world/worldMapView";

type Check = (label: string, fn: () => void) => void;

const close = (actual: number, expected: number, label?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label ?? ""} ${actual} != ${expected}`);

/** OPEN_WORLD_PLAN Faz 8: World Partition panel map math. */
export function registerWorldMapViewTests(check: Check): void {
  check("world map view: the frame is a padded square around every rect, centred", () => {
    const frame = worldMapFrame([{ minX: -512, minZ: -256, maxX: 512, maxZ: 256 }, { minX: 500, minZ: 0, maxX: 640, maxZ: 128 }], 0);
    assert.deepEqual(frame, { minX: -512, minZ: -576, maxX: 640, maxZ: 576 }, "1152 m square centred on (64, 0)");
    const padded = worldMapFrame([{ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }], 0.1);
    close(padded.maxX - padded.minX, 120);
    close((padded.minX + padded.maxX) / 2, 50);
    assert.deepEqual(worldMapFrame([]), { minX: -128, minZ: -128, maxX: 128, maxZ: 128 });
    assert.deepEqual(worldMapFrame([{ minX: Number.NaN, minZ: 0, maxX: 1, maxZ: 1 }]), worldMapFrame([]), "non-finite rects are ignored");
  });

  check("world map view: world and map pixels convert both ways, +Z down", () => {
    const frame = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
    assert.deepEqual(worldToMapPixel(frame, 512, -100, -100), [0, 0]);
    assert.deepEqual(worldToMapPixel(frame, 512, 100, 100), [512, 512]);
    assert.deepEqual(worldToMapPixel(frame, 512, 0, 50), [256, 384]);
    const [x, z] = mapPixelToWorld(frame, 512, ...worldToMapPixel(frame, 512, 37.5, -12.25));
    close(x, 37.5);
    close(z, -12.25);
  });

  check("world map view: shading ramps by height, lights north-west slopes, leaves holes transparent", () => {
    // 3x3: a ramp rising to +X, with a hole in the corner.
    const heights = new Float32Array([0, 5, 10, 0, 5, 10, 0, 5, Number.NaN]);
    const pixels = shadeWorldMapHeights({ width: 3, height: 3, heights }, 10);
    assert.equal(pixels[8 * 4 + 3], 0, "hole is transparent");
    assert.ok([0, 1, 2, 3, 4, 5, 6, 7].every((index) => pixels[index * 4 + 3] === 255));
    // Brighter at the top of the ramp (colour ramp), same row.
    assert.ok(pixels[2 * 4]! > pixels[0]!);
    // A slope facing the light (rising to +X, so it faces −X, the north-west) is brighter than one facing away.
    const facing = shadeWorldMapHeights({ width: 3, height: 1, heights: new Float32Array([0, 0, 0]) }, 1);
    const toward = shadeWorldMapHeights({ width: 3, height: 1, heights: new Float32Array([0, 2, 4]) }, 1);
    const away = shadeWorldMapHeights({ width: 3, height: 1, heights: new Float32Array([4, 2, 0]) }, 1);
    // Same normalised height at the middle sample (t = 0.5), so only the shade differs.
    assert.ok(toward[4 + 1]! > away[4 + 1]!, `${toward[5]} > ${away[5]}`);
    assert.ok(facing.every((value, index) => index % 4 === 3 || value === facing[index % 4]), "flat ground is one colour");
    assert.ok(shadeWorldMapHeights({ width: 2, height: 1, heights: new Float32Array([Number.NaN, Number.NaN]) }, 1).every((value) => value === 0));
  });

  check("world map view: height lookup takes the nearest sample, null outside and on holes", () => {
    const map = { width: 3, height: 2, heights: new Float32Array([1, 2, 3, 4, Number.NaN, 6]) };
    const rect = { minX: 0, minZ: 0, maxX: 20, maxZ: 10 };
    assert.equal(worldMapHeightAt(map, rect, 0, 0), 1);
    assert.equal(worldMapHeightAt(map, rect, 19, 9), 6);
    assert.equal(worldMapHeightAt(map, rect, 10, 10), null, "hole");
    assert.equal(worldMapHeightAt(map, rect, 21, 0), null, "outside");
  });

  check("world map view: focus keeps the view direction and height above the ground, or pulls back from the horizon", () => {
    // 45° down along +X from 30 m above the ground: lands 30 m behind the target.
    const forward = [Math.SQRT1_2, -Math.SQRT1_2, 0] as const;
    const [x, y, z] = worldMapFocusPosition([0, 40, 0], forward, [500, 10, 200]);
    close(x, 470);
    close(y, 40);
    close(z, 200);
    // Looking at the horizon: 80 m back at 30°, along the view's heading.
    const [hx, hy, hz] = worldMapFocusPosition([0, 5, 0], [0, 0, 1], [0, 0, 0]);
    close(hx, 0);
    close(hy, 40);
    close(hz, -80 * Math.cos(Math.PI / 6));
    // Straight down keeps the camera over the target; never below 2 m above it.
    const [dx, dy, dz] = worldMapFocusPosition([0, -50, 0], [0, -1, 0], [10, 0, 20]);
    close(dx, 10);
    close(dy, 2);
    close(dz, 20);
  });
}
