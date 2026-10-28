import { createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";
import { expect, test } from "./test";

/** A one-tile World Terrain's save snapshot, as the editor posts it. */
function terrainSnapshot() {
  const created = createFlatWorldTerrain({ name: "Validation", tilesX: 1, tilesZ: 1, tileQuads: 64, spacing: 1, baseHeight: 0 });
  const saved = captureWorldTerrainSave(createTerrainEditWorld(created.def, created.tiles.values()), ["0_0"], new Map([["0_0", "f32"]]));
  return { path: "landscapes/validation.terrain.json", def: saved.def, bytes: saved.tiles[0]!.bytes, global: saved.global };
}

test("terrain endpoints validate raw binaries, definitions and dropped fields", async ({ request }) => {
  const snapshot = terrainSnapshot();
  const url = `/__save-terrain-tile?path=${snapshot.path}&key=0_0`;
  const globalUrl = `/__save-terrain-global?path=${snapshot.path}`;
  expect((await request.get("/__save-terrain")).status()).toBe(405);
  expect((await request.get(globalUrl)).status()).toBe(405);
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post(url, { data: Buffer.from(snapshot.bytes.subarray(0, 40)) })).status()).toBe(400);
  expect((await request.post(url.replace("key=0_0", "key=1_0"), { data: Buffer.from(snapshot.bytes) })).status()).toBe(400);
  expect((await request.post(url, { data: Buffer.from(snapshot.bytes) })).ok()).toBeTruthy();
  expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global.subarray(0, 40)) })).status()).toBe(400);
  expect((await request.post("/__save-terrain-global?path=../escape.terrain.json", { data: Buffer.from(snapshot.global) })).status()).toBe(400);
  const mismatched = snapshot.global.slice();
  new DataView(mismatched.buffer).setUint16(26, snapshot.def.layers.length === 8 ? 7 : 8, true);
  expect((await request.post(globalUrl, { data: Buffer.from(mismatched) })).ok()).toBeTruthy();
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post(globalUrl, { data: Buffer.from(snapshot.global) })).ok()).toBeTruthy();
  const saved = await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, unsupported: 1 } } });
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).dropped).toEqual(["terrain.unsupported"]);
  const world = { ...snapshot.def, splines: [{ id: "world-road", coordinateSpace: "world",
    points: [{ id: "p", position: [23, 7, -17], width: 2, falloff: 1 }], segments: [] }] };
  const worldSave = await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: world } });
  expect(worldSave.ok()).toBeTruthy();
  expect((await worldSave.json()).dropped).toEqual([]);
  expect((await (await request.get(`/${snapshot.path}`)).json()).splines).toEqual(world.splines);
  const invalid = { ...world, splines: [{ ...world.splines[0], coordinateSpace: "invalid" }] };
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: invalid } })).status()).toBe(400);
  expect((await (await request.get(`/${snapshot.path}`)).json()).splines).toEqual(world.splines);
  expect((await request.post("/__save-terrain", { data: { path: "../escape.terrain.json", terrain: snapshot.def } })).status()).toBe(400);
  expect((await request.post("/__save-terrain", { data: { path: snapshot.path, terrain: { ...snapshot.def, tileQuads: 128 } } })).status()).toBe(400);
});
