import assert from "node:assert/strict";
import { buildTerrainPuddle, type TerrainPuddleRegion } from "../../engine/terrain/terrainPuddle";
import { TerrainPuddleSurface } from "../../engine/render-three/terrain/terrainPuddleSurface";
import { DeformationField } from "../../engine/scene/deformationField";

export function registerTerrainPuddleTests(check: (name: string, fn: () => void) => void): void {
  const region: TerrainPuddleRegion = { minX: -4, minZ: -4, size: 8, cellSize: .125, level: 0, seed: [0, 0] };
  check("puddle: horizontal, clipped water covers only the connected basin and leaves islands dry", () => {
    const bed = (x: number, z: number) => Math.min((x + 1.6) ** 2 + z * z - 1,
      (x - 1.6) ** 2 + z * z - 1) + (Math.hypot(x + 1.6, z) < .3 ? 2 : 0);
    const data = buildTerrainPuddle({ ...region, seed: [-1.1, 0] }, bed);
    assert.equal(data.status, "ready"); assert.ok(data.area > 2 && data.area < 3.5);
    for (let i = 0; i < data.positions.length; i += 3) {
      assert.equal(data.positions[i + 1], 0);
      assert.ok(data.positions[i]! < 0, "disconnected right basin isn't filled");
      assert.ok(Math.hypot(data.positions[i]! + 1.6, data.positions[i + 2]!) > .2, "island stays dry");
      assert.ok(data.depths[i / 3]! >= 0);
    }
  });
  check("puddle: missing neighbours and open bounds are explicit and preserve the previous valid mesh", () => {
    const surface = new TerrainPuddleSurface();
    try {
      assert.ok(surface.rebuild(buildTerrainPuddle(region, (x, z) => x * x + z * z - 1)));
      const geometry = surface.geometry;
      const open = buildTerrainPuddle(region, () => -.1);
      assert.equal(open.status, "open-boundary"); assert.equal(surface.rebuild(open), false);
      const missing = buildTerrainPuddle(region, (x, z) => x > .5 ? null : x * x + z * z - 1);
      assert.equal(missing.status, "missing-terrain"); assert.equal(surface.rebuild(missing), false);
      assert.equal(surface.geometry, geometry); assert.equal(surface.visible, true);
      assert.ok(surface.rebuild(buildTerrainPuddle(region, () => 1))); assert.equal(surface.visible, false);
      assert.throws(() => buildTerrainPuddle({ ...region, cellSize: .001 }, () => 0), RangeError);
      assert.equal(buildTerrainPuddle(region, () => NaN).status, "missing-terrain");
    } finally { surface.dispose(); }
  });
  check("puddle: real wheel depth expands a shallow basin while water level stays fixed", () => {
    const field = new DeformationField({ windowSize: 16, cellSize: .125 });
    const bed = (x: number, z: number) => .025 * (x * x + z * z) - .015 - field.sample(x, z).depth;
    const before = buildTerrainPuddle(region, bed);
    field.stampWheel({ from: [0, 0], to: [0, 2], width: .5, contactLength: .5,
      targetDepth: .12, compaction: 1, disturbance: 255 });
    const after = buildTerrainPuddle(region, bed);
    assert.equal(before.status, "ready"); assert.equal(after.status, "ready");
    assert.ok(after.area > before.area + .3);
    assert.ok(field.sample(0, 1.5).depth > .05);
    assert.ok(after.depths.some(depth => depth > .1));
    for (let i = 1; i < after.positions.length; i += 3) assert.equal(after.positions[i], 0);
  });
}
