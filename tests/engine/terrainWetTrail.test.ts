import assert from "node:assert/strict";
import type { Texture } from "three";
import { TerrainDeformationTexture } from "../../engine/render-three/terrain/terrainDeformation";
import {
  TerrainWetTrail,
  TERRAIN_WET_TRAIL_DRY_SECONDS,
  TERRAIN_WET_TRAIL_DRY_STEP_SECONDS,
  TERRAIN_WET_TRAIL_LENGTH,
  TERRAIN_WET_TRAIL_STRENGTH,
  type TerrainWetTrailContact,
} from "../../engine/render-three/terrain/terrainWetTrail";
import { DeformationField } from "../../engine/scene/deformationField";

type Check = (label: string, fn: () => void) => void;

const N = 128, CELL = 0.125, DT = 1 / 60;
const mod = (value: number) => ((value % N) + N) % N;
const wetAt = (trail: TerrainWetTrail, x: number, z: number) => trail.wet[mod(Math.floor(z / CELL)) * N + mod(Math.floor(x / CELL))]!;
const tyre = (patch: Partial<TerrainWetTrailContact> = {}): TerrainWetTrailContact => ({ id: "car:0", x: 0, z: 0.0625, width: 0.3, inWater: false, ...patch });

/** A tyre soaked at x = 0 rolls `metres` along +X at 0.1 m per fixed slice. */
function driveOut(trail: TerrainWetTrail, metres: number): void {
  trail.advance(DT, [tyre({ inWater: true })]);
  for (let x = 0.1; x <= metres + 1e-9; x += 0.1) trail.advance(DT, [tyre({ x })]);
}

export function registerTerrainWetTrailTests(check: Check): void {
  check("wet tyre trail: leaving water prints a band that fades out over the trail length", () => {
    const trail = new TerrainWetTrail(N, CELL);
    trail.setOrigin(-64, -64);
    driveOut(trail, TERRAIN_WET_TRAIL_LENGTH + 1);
    const near = wetAt(trail, 0.2, 0.0625), mid = wetAt(trail, TERRAIN_WET_TRAIL_LENGTH / 2, 0.0625);
    assert.ok(Math.abs(near - 255 * TERRAIN_WET_TRAIL_STRENGTH) < 20, `fresh print starts near full strength (${near})`);
    assert.ok(mid > 0 && mid < near, `fades along the path (${near} → ${mid})`);
    assert.equal(wetAt(trail, TERRAIN_WET_TRAIL_LENGTH + 0.3, 0.0625), 0, "dry past the trail length");
    assert.equal(wetAt(trail, 0.5, 0.0625 + 0.15 + 2 * CELL), 0, "no wider than the tyre plus one cell");
    assert.equal(wetAt(trail, -0.3, 0.0625), 0, "nothing printed while the tyre stood in water");
    const cells = trail.activeCellCount;
    for (let x = TERRAIN_WET_TRAIL_LENGTH + 1.1; x <= TERRAIN_WET_TRAIL_LENGTH + 3; x += 0.1) trail.advance(DT, [tyre({ x })]);
    assert.equal(trail.activeCellCount, cells, "a dried-out tyre prints nothing more");
  });

  check("wet tyre trail: dry tyres and teleports never print; an unseen tyre is forgotten", () => {
    const trail = new TerrainWetTrail(N, CELL);
    trail.setOrigin(-64, -64);
    for (let x = 0; x <= 2; x += 0.1) trail.advance(DT, [tyre({ x })]);
    assert.equal(trail.activeCellCount, 0, "a tyre that never touched water");
    trail.advance(DT, [tyre({ inWater: true })]);
    trail.advance(DT, [tyre({ x: 3 })]);
    assert.equal(trail.activeCellCount, 0, "a 3 m jump re-anchors instead of drawing a line");
    trail.advance(DT, [tyre({ x: 3.1 })]);
    assert.ok(trail.activeCellCount > 0, "it still carries its water after the jump");
    const before = trail.activeCellCount;
    trail.advance(2.5, []);
    trail.advance(DT, [tyre({ x: 3.2 })]);
    assert.equal(trail.activeCellCount, before, "forgotten after two unseen seconds");
  });

  check("wet tyre trail: prints dry in bounded steps and leave the window with it", () => {
    const trail = new TerrainWetTrail(N, CELL);
    trail.setOrigin(-64, -64);
    driveOut(trail, 2);
    trail.takeDirty();
    trail.advance(TERRAIN_WET_TRAIL_DRY_STEP_SECONDS / 2, []);
    assert.deepEqual(trail.takeDirty(), [], "no upload between drying steps");
    const before = wetAt(trail, 0.2, 0.0625);
    trail.advance(TERRAIN_WET_TRAIL_DRY_STEP_SECONDS / 2, []);
    assert.ok(trail.takeDirty().length > 0 && wetAt(trail, 0.2, 0.0625) < before, "one step dries and re-uploads");
    for (let t = 0; t < TERRAIN_WET_TRAIL_DRY_SECONDS + 1; t += 0.5) trail.advance(0.5, []);
    assert.equal(trail.activeCellCount, 0);
    assert.ok(trail.wet.every((value) => value === 0), "fully dry after the drying time");

    driveOut(trail, 1);
    assert.ok(trail.activeCellCount > 0);
    trail.setOrigin(200, 200);
    assert.equal(trail.activeCellCount, 0, "prints outside the moved window are dropped");
    assert.ok(trail.wet.every((value) => value === 0));
  });

  check("wet tyre trail: the track texture carries it filtered in its B channel", () => {
    const field = new DeformationField({ windowSize: N * CELL, cellSize: CELL });
    const trail = new TerrainWetTrail(N, CELL);
    trail.setOrigin(...field.originCell);
    const texture = new TerrainDeformationTexture();
    try {
      assert.throws(() => texture.attach(field, new TerrainWetTrail(N / 2, CELL * 2)), /share/);
      texture.attach(field, trail);
      const data = () => (texture.uniforms.uDeformTex!.value as Texture & { image: { data: Uint8Array } }).image.data;
      assert.equal(data().length, N * N * 4, "RGBA");
      driveOut(trail, 1);
      texture.update([...field.takeDirty(), ...trail.takeDirty()]);
      const index = (x: number, z: number) => (mod(Math.floor(z / CELL)) * N + mod(Math.floor(x / CELL))) * 4;
      assert.ok(Math.abs(data()[index(0.3, 0.0625) + 2]! - trail.wet[index(0.3, 0.0625) / 4]!) <= 40, "B mirrors the print (tent filtered)");
      assert.equal(data()[index(0.3, 0.0625)], 0, "no track depth from a wet print");
      assert.equal(data()[index(0.3, 1) + 2], 0, "dry beside it");
    } finally { texture.dispose(); }
  });
}
