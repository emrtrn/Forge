import assert from "node:assert/strict";
import { createFlatLandscapeData, type ForgeLandscapeSpline } from "../../engine/scene/landscape";
import { buildRiverWaterRibbon } from "../../engine/render-three/riverWater";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { captureTerrainSnapshot, terrainDocumentToLandscape } from "../../engine/terrain/terrainLandscapeBridge";
import { loadWorldTerrain } from "../../engine/terrain/terrainLoader";
import { migrateTerrainSplineCoordinates, terrainSplineInLocalFrame, terrainSplineToWorld } from "../../engine/terrain/terrainSplineData";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { createFlatWorldTerrain, WORLD_TERRAIN_CREATE_DEFAULTS } from "../../engine/terrain/worldTerrainCreate";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";
import { WorldTerrainEditSession } from "../../src/editor/terrainStore";
import { fetchTerrainActorDocument } from "../../src/scene/terrainDocument";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateSaveTerrainPayload } from "../../tools/terrainSaveValidator";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const path = "landscapes/spline-data.terrain.json";
const actor = { id: "terrain", dataRef: path, position: [31, 7, -13] as [number, number, number] };

function spline(): ForgeLandscapeSpline {
  return { id: "river-road", name: "Road", smooth: true, smoothness: 0.6, hidden: false, locked: false,
    points: [
      { id: "a", position: [-8, -1.25, -4], arriveTangent: [1, 2, 3], width: 5, falloff: 2 },
      { id: "b", position: [8, -0.5, 4], leaveTangent: [4, 5, 6], width: 7, falloff: 3 },
    ],
    segments: [{ id: "ab", startPointId: "a", endPointId: "b",
      deform: { enabled: true, flatten: true, raiseTerrain: false, lowerTerrain: true, targetOffset: -1 },
      paint: { enabled: true, layerId: "dirt", strength: 0.5 },
      mesh: { enabled: true, assetId: "road", collision: true, deform: true, offset: [1, 2, 3], scale: [1, 1, 2] } }],
  };
}

function single() {
  const data = createFlatLandscapeData("small");
  data.splines = [spline()];
  return { data, snapshot: captureTerrainSnapshot(actor, data) };
}

function multi() {
  const created = createFlatWorldTerrain({ ...WORLD_TERRAIN_CREATE_DEFAULTS, tilesX: 2, tilesZ: 2, tileQuads: 64 });
  created.def.origin = [17.25, -5, -80.5];
  created.def.splines = [spline()];
  return createTerrainEditWorld(created.def, created.tiles.values());
}

export function registerTerrainSplineDataTests(check: Check): void {
  check("terrain spline data: world marker survives the runtime/save allowlist and unknown frames are rejected", () => {
    const { snapshot } = single();
    assert.equal(snapshot.def.splines![0]!.coordinateSpace, "world");
    const saved = validateSaveTerrainPayload({ path, terrain: snapshot.def }).terrain;
    assert.deepEqual(saved, normalizeWorldTerrain(snapshot.def));
    assert.deepEqual(collectDroppedFields(snapshot.def, saved, "terrain").paths, []);
    assert.deepEqual(saved.splines![0]!.points[0]!.position, [23, 5.75, -17]);
    assert.deepEqual(saved.splines![0]!.points[0]!.arriveTangent, [1, 2, 3]);
    for (const frame of [null, "local", "planet", false, 1]) {
      const invalid = { ...saved, splines: [{ ...saved.splines![0], coordinateSpace: frame }] };
      assert.throws(() => normalizeWorldTerrain(invalid), /coordinateSpace/);
      assert.throws(() => validateSaveTerrainPayload({ path, terrain: invalid }), /coordinateSpace/);
    }
  });

  check("terrain spline data: explicit mixed-frame migration is idempotent, keeps absent arrays and does not mutate", () => {
    const world = multi();
    const marked = terrainSplineToWorld(world.def, { ...spline(), id: "already-world" });
    world.def.splines!.push(marked);
    const before = structuredClone(world.def);
    const migrated = migrateTerrainSplineCoordinates(world.def);
    assert.deepEqual(world.def, before);
    assert.deepEqual(migrated.splines![1], marked);
    assert.deepEqual(migrateTerrainSplineCoordinates(migrated), migrated);
    assert.deepEqual(terrainSplineInLocalFrame(world.def, migrated.splines![0]!), spline());
    migrated.splines![1]!.points[0]!.position[0] = 999;
    assert.deepEqual(world.def, before, "the migration owns all nested objects");
    delete world.def.splines;
    assert.equal(Object.hasOwn(migrateTerrainSplineCoordinates(world.def), "splines"), false);
  });

  check("terrain spline data: 1x1 reload, repeat save and actor movement preserve local road and river geometry", () => {
    const { data, snapshot } = single();
    const bytes = snapshot.bytes.slice();
    let def = snapshot.def;
    for (let i = 0; i < 3; i++) {
      const loaded = terrainDocumentToLandscape({ def: normalizeWorldTerrain(def), tiles: new Map([["0_0", decodeTerrainTile(bytes)]]) });
      assert.deepEqual(loaded.splines, data.splines);
      assert.deepEqual(buildRiverWaterRibbon(loaded.splines![0]!, { surfaceLevel: 0, widthScale: 1, landscapeData: loaded }),
        buildRiverWaterRibbon(data.splines![0]!, { surfaceLevel: 0, widthScale: 1, landscapeData: data }));
      def = captureTerrainSnapshot(actor, loaded).def;
      assert.deepEqual(def, snapshot.def, "repeat save cannot apply the terrain offset twice");
    }
    const loaded = terrainDocumentToLandscape({ def, tiles: new Map([["0_0", decodeTerrainTile(bytes)]]) });
    const moved = { ...actor, position: [41, 10, -20] as [number, number, number] };
    const saved = captureTerrainSnapshot(moved, loaded);
    assert.deepEqual(saved.def.splines![0]!.points[0]!.position, [33, 8.75, -24]);
    assert.deepEqual(terrainDocumentToLandscape({ def: saved.def, tiles: new Map([["0_0", decodeTerrainTile(saved.bytes)]]) }).splines, data.splines);
  });

  check("terrain spline data: fractional origins reach a stable save representation within one millimetre", () => {
    const { data } = single();
    const fractional = { ...actor, position: [31.123456, 7.234567, -13.345678] as [number, number, number] };
    let snapshot = captureTerrainSnapshot(fractional, data);
    let saved = normalizeWorldTerrain(snapshot.def);
    for (let i = 0; i < 3; i++) {
      const loaded = terrainDocumentToLandscape({ def: saved, tiles: new Map([["0_0", decodeTerrainTile(snapshot.bytes)]]) });
      loaded.splines![0]!.points.forEach((point, index) => point.position.forEach((value, axis) =>
        assert.ok(Math.abs(value - data.splines![0]!.points[index]!.position[axis]!) < 0.001)));
      snapshot = captureTerrainSnapshot(fractional, loaded);
      const next = normalizeWorldTerrain(snapshot.def);
      assert.deepEqual(next, saved);
      saved = next;
    }
  });

  check("terrain spline data: decimal datum roundoff does not change unchanged legacy points on reload", () => {
    for (const datum of [-0.1, 19]) {
      const { data } = single();
      data.splines![0]!.points[0]!.position[1] = 0.15;
      const placed = { ...actor, position: [31, datum, -13] as [number, number, number] };
      const snapshot = captureTerrainSnapshot(placed, data);
      const def = normalizeWorldTerrain(snapshot.def);
      const loaded = terrainDocumentToLandscape({ def, tiles: new Map([["0_0", decodeTerrainTile(snapshot.bytes)]]) });
      assert.deepEqual(loaded.splines, data.splines);
      assert.deepEqual(normalizeWorldTerrain(captureTerrainSnapshot(placed, loaded).def), def);
    }
  });
}

export async function registerTerrainSplineDataAsyncTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain spline data: multi-tile snapshot and streaming/eager reload keep world coordinates and references", async () => {
    const world = multi();
    const before = structuredClone(world.def);
    const snapshot = captureWorldTerrainSave(world, world.tiles.keys(), new Map());
    const def = validateSaveTerrainPayload({ path, terrain: snapshot.def }).terrain;
    const files = new Map(snapshot.tiles.map(({ key, bytes }) => [terrainTilePath(path, key), bytes]));
    files.set(terrainGlobalMapPath(path), snapshot.global);
    for (const streaming of [true, false]) {
      const loaded = await loadWorldTerrain(path, JSON.parse(JSON.stringify(def)), async (file) => files.get(file)!, streaming);
      assert.equal(loaded.tiles.size, streaming ? 0 : 4);
      assert.deepEqual(loaded.def.splines, def.splines);
      assert.equal(loaded.def.splines![0]!.id, "river-road");
      assert.equal(loaded.def.splines![0]!.segments[0]!.id, "ab");
      assert.deepEqual(migrateTerrainSplineCoordinates(loaded.def), loaded.def);
    }
    assert.deepEqual(world.def, before);
  });

  await checkAsync("terrain spline data: real save session snapshots spline edits and keeps changes made while writing dirty", async () => {
    const world = multi();
    const session = new WorldTerrainEditSession(path, world, new Map());
    session.markDefinitionDirty();
    const original = globalThis.fetch;
    const bodies: ReturnType<typeof normalizeWorldTerrain>[] = [];
    let mutateDuringWrite = true;
    try {
      globalThis.fetch = async (input, init) => {
        if (String(input) === "/__save-terrain") {
          const payload = JSON.parse(String(init!.body));
          const validated = validateSaveTerrainPayload(payload).terrain;
          assert.deepEqual(collectDroppedFields(payload.terrain, validated, "terrain").paths, []);
          bodies.push(validated);
          if (mutateDuringWrite) {
            mutateDuringWrite = false;
            world.def.splines![0]!.points[0]!.position[0] += 2;
            session.markDefinitionDirty();
          }
        }
        return new Response(JSON.stringify({ dropped: [] }));
      };
      await session.capture()!.write();
      assert.equal(session.dirty, true);
      await session.capture()!.write();
      assert.equal(session.dirty, false);
      assert.equal(bodies[0]!.splines![0]!.coordinateSpace, "world");
      assert.equal(bodies[1]!.splines![0]!.points[0]!.position[0], bodies[0]!.splines![0]!.points[0]!.position[0]! + 2);
    } finally { globalThis.fetch = original; }
  });

  await checkAsync("terrain spline data: shared editor/runtime reader accepts world and unmarked definitions without writing", async () => {
    const { snapshot, data } = single();
    const original = globalThis.fetch;
    try {
      for (const marked of [false, true]) {
        const def = { ...snapshot.def, splines: marked ? snapshot.def.splines : data.splines };
        globalThis.fetch = async (input, init) => {
          assert.equal(init?.method, undefined, "loading must never migrate files on disk");
          return String(input).endsWith(".tile.bin") ? new Response(snapshot.bytes.slice().buffer) : new Response(JSON.stringify(def));
        };
        const loaded = await fetchTerrainActorDocument(path);
        assert.equal(loaded.kind, "landscape");
        if (loaded.kind === "landscape") assert.deepEqual(loaded.data.splines, data.splines);
      }
      let binaryRead = false;
      const invalid = { ...snapshot.def, splines: [{ ...snapshot.def.splines![0], coordinateSpace: "invalid" }] };
      await assert.rejects(loadWorldTerrain(path, invalid, async () => { binaryRead = true; return snapshot.bytes; }), /coordinateSpace/);
      assert.equal(binaryRead, false);
    } finally { globalThis.fetch = original; }
  });
}
