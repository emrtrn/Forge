import assert from "node:assert/strict";
import { TERRAIN_PHYSICS_FIELDS } from "../../engine/terrain/terrainPhysicalMaterial";
import type { LayoutLandscape } from "../../engine/scene/layout";
import { createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { applyTerrainLayerState, createTerrainLayerRemoval } from "../../engine/terrain/terrainLayers";
import { loadWorldTerrain, validateTerrainTile } from "../../engine/terrain/terrainLoader";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainGlobalMapPath, terrainTileHeightRange, terrainTileLayerWeight, terrainTilePath, type TerrainSpline } from "../../engine/terrain/terrainTypes";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import { captureWorldTerrainSave } from "../../engine/terrain/worldTerrainSave";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateSaveTerrainPayload, validateSaveTerrainTile } from "../../tools/saveValidator";
import { fetchTerrainActorDocument } from "../../src/scene/terrainDocument";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const path = "landscapes/test.terrain.json";
const actor: LayoutLandscape = { id: "l", name: "Terrain", position: [10, 2, -3], dataRef: path };

/** A one-tile World Terrain centred on `actor`, with a world-space road on it. */
function fixture() {
  const { def, tiles } = createFlatWorldTerrain({ name: "Terrain", tilesX: 1, tilesZ: 1, tileQuads: 64, spacing: 1, baseHeight: 2 });
  def.origin = [-22, 2, -35];
  const tile = tiles.get("0_0")!;
  tile.heights[0] = 3.25;
  const range = terrainTileHeightRange(tile);
  def.tiles = [{ key: "0_0", minHeight: range.min, maxHeight: range.max }];
  def.layers[1]!.physicalMaterial = "mud";
  def.splines = [{ id: "road", name: "Road", hidden: false, locked: false, smooth: true, smoothness: 0.25, coordinateSpace: "world",
    points: [{ id: "a", position: [10, 2, -3], width: 2, falloff: 1, arriveTangent: [1, 0, 0] },
      { id: "b", position: [14, 2, 1], width: 2, falloff: 1, leaveTangent: [1, 0, 0] }],
    segments: [{ id: "ab", startPointId: "a", endPointId: "b",
      deform: { enabled: true, raiseTerrain: true, lowerTerrain: false, flatten: false, targetOffset: 1 },
      paint: { enabled: true, layerId: "grass", strength: 0.8 },
      mesh: { enabled: true, assetId: "road", collision: true, spacing: 2, scale: [1, 1, 1], offset: [0, 0, 0],
        yawOffset: 0, fitToLength: true, alignToTerrain: true, bank: 2, deform: true } }],
  } as unknown as TerrainSpline];
  const bytes = encodeTerrainTile(tile, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: "f32" });
  return { def, tile, bytes, path };
}

export function registerTerrainDocumentTests(check: Check): void {
  check("terrain definition: layer physics survives save and load; invalid overrides are rejected", () => {
    const { def, tile } = fixture();
    const overrides = Object.fromEntries(TERRAIN_PHYSICS_FIELDS.map((field) => [field.key, field.min + (field.max - field.min) / 2]));
    def.layers[1]!.physicalMaterialOverrides = overrides;
    const world = createTerrainEditWorld(def, [tile]);
    const snapshot = captureWorldTerrainSave(world, ["0_0"], new Map());
    const saved = validateSaveTerrainPayload({ path, terrain: snapshot.def }).terrain;
    const loaded = normalizeWorldTerrain(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(loaded.layers[1]!.physicalMaterialOverrides, overrides);
    assert.equal(loaded.layers[0]!.physicalMaterialOverrides, undefined);
    assert.deepEqual(collectDroppedFields(def, saved, "terrain").paths, []);
    for (const bad of [null, [], { maxDepth: -1 }, { maxDepth: Infinity }, { maxDepth: "0.2" }, { unexpected: 1 }, { compaction: 2 }, { ploughExponent: 0 }, { resistanceSpeedMps: 0 }]) {
      const invalid = { ...def, layers: def.layers.map((layer, index) => index === 1 ? { ...layer, physicalMaterialOverrides: bad } : layer) };
      assert.throws(() => validateSaveTerrainPayload({ path, terrain: invalid }));
    }
    for (const id of [null, "stone"]) {
      const invalid = { ...def, layers: def.layers.map((layer, index) => index === 1 ? { ...layer, physicalMaterial: id } : layer) };
      assert.throws(() => normalizeWorldTerrain(invalid));
    }
  });
  check("terrain definition: maximal runtime/save shape has no serialization drift and unknown keys are reported", () => {
    const { def, path } = fixture();
    const saved = validateSaveTerrainPayload({ path, terrain: def }).terrain;
    assert.deepEqual(saved, normalizeWorldTerrain(def));
    assert.deepEqual(collectDroppedFields(def, saved, "terrain").paths, []);
    assert.equal(saved.layers[1]?.physicalMaterial, "mud", "the definition carries the layer's physical material");
    const nulled = { ...def, layers: def.layers.map((layer, index) => index === 0 ? { ...layer, physicalMaterial: null } : layer) };
    assert.equal(normalizeWorldTerrain(nulled).layers[0]?.physicalMaterial, null);
    assert.deepEqual(saved.layers.map((layer) => layer.physicalMaterial ?? null), [null, "mud", null, null]);
    const extra = { ...def, secret: true, layers: def.layers.map((l) => ({ ...l, future: 1 })) };
    const report = collectDroppedFields(extra, normalizeWorldTerrain(extra), "terrain");
    assert.ok(report.paths.includes("terrain.secret"));
    assert.ok(report.paths.includes("terrain.layers[0].future"));
  });

  check("terrain definition: removing paint layers down to one has no serialization drift; tiles validate", () => {
    const { def, tile } = fixture();
    const world = createTerrainEditWorld(def, [tile]);
    for (const [id, count, blocks] of [["grass", 3, 1], ["snow", 2, 1], ["rock", 1, 1]] as const) {
      applyTerrainLayerState(world, createTerrainLayerRemoval(world, id).after);
      const snapshot = captureWorldTerrainSave(world, ["0_0"], new Map());
      const saved = validateSaveTerrainPayload({ path, terrain: snapshot.def }).terrain;
      assert.equal(saved.layers.length, count);
      assert.deepEqual(saved, normalizeWorldTerrain(snapshot.def));
      assert.deepEqual(collectDroppedFields(snapshot.def, saved, "terrain").paths, []);
      const saved0 = validateTerrainTile(saved, "0_0", snapshot.tiles[0]!.bytes);
      assert.equal(saved0.layerCount, count);
      assert.equal(saved0.weights.length, blocks * saved0.size * saved0.size * 4);
      assert.deepEqual(saved.layers.map((layer) => layer.physicalMaterial ?? null), world.def.layers.map((layer) => layer.physicalMaterial ?? null));
    }
    assert.deepEqual(world.def.layers.map((layer) => layer.id), ["dirt"]);
    assert.equal(world.def.layers[0]!.physicalMaterial, "mud");
    const last = world.tiles.get("0_0")!;
    for (let index = 0; index < last.size * last.size; index += 1) {
      assert.equal(terrainTileLayerWeight(last, 0, index), 1, "the last layer holds every vertex");
    }
  });

  check("terrain definition: malformed shape, bounds, layer IDs, keys and spline links are rejected", () => {
    const { def } = fixture();
    for (const patch of [
      { schema: 2 }, { tileQuads: 63 }, { spacing: 0 }, { tilesX: 33 }, { origin: [0, NaN, 0] },
      { heightMax: def.heightMin }, { heightMax: 1e300 }, { collision: "yes" },
      { layers: [...def.layers, def.layers[0]] }, { tiles: [def.tiles[0], def.tiles[0]] },
      { tiles: [{ ...def.tiles[0], key: "01_0" }] }, { tiles: [{ ...def.tiles[0], key: "1_0" }] },
      { tiles: [{ ...def.tiles[0], maxHeight: 10000 }] },
      { layers: [{ ...def.layers[0], physicalMaterial: "lava" }] }, { layers: [{ ...def.layers[0], physicalMaterial: 3 }] },
      { splines: [{ id: "x", points: [], segments: [{ id: "s", startPointId: "x", endPointId: "y" }] }] },
    ]) assert.throws(() => normalizeWorldTerrain({ ...def, ...patch }), JSON.stringify(patch));
  });

  check("terrain save: paths cannot escape public or redirect tile bytes to another kind of file", () => {
    const { def, bytes, path } = fixture();
    for (const invalid of ["../a.terrain.json", "a/../b.terrain.json", "/a.terrain.json", "C:/a.terrain.json",
      "a\\b.terrain.json", "a.terrain.json?x", "a%2fb.terrain.json", "a//b.terrain.json", "a.json"]) {
      assert.throws(() => validateSaveTerrainPayload({ path: invalid, terrain: def }), invalid);
    }
    assert.equal(validateSaveTerrainTile(path, "0_0", bytes), terrainTilePath(path, "0_0"));
    for (const key of ["../0_0", "00_0", "-1_0", "32_0", "1_0"]) assert.throws(() => validateSaveTerrainTile(path, key, bytes));
  });

  check("terrain save/load: corrupted, mismatched and non-finite binaries never pass validation", () => {
    const { def, bytes, path } = fixture();
    for (const offset of [0, 4, 6, 8, 10, 11, 20, 28]) {
      const broken = bytes.slice(); broken[offset] = 255;
      assert.throws(() => validateTerrainTile(def, "0_0", broken), `offset ${offset}`);
    }
    assert.throws(() => validateSaveTerrainTile(path, "0_0", bytes.subarray(0, 33)));
    const broken = bytes.slice(); new DataView(broken.buffer).setFloat32(32, NaN, true);
    assert.throws(() => validateSaveTerrainTile(path, "0_0", broken));
    const outOfRange = bytes.slice(); new DataView(outOfRange.buffer).setFloat32(32, 10000, true);
    assert.throws(() => validateSaveTerrainTile(path, "0_0", outOfRange));
    assert.throws(() => validateTerrainTile({ ...def, tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }] }, "0_0", bytes));
  });

}

export async function registerTerrainDocumentAsyncTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain loader: uses saved global map, or computes with one warning when missing, corrupt or stale", async () => {
    const { def: single, bytes, path } = fixture();
    // Two tiles wide with (1, 0) a hole: only multi-tile terrains read the sidecar.
    const def = normalizeWorldTerrain({ ...single, tilesX: 2 });
    const tile = validateTerrainTile(def, "0_0", bytes);
    const expected = buildTerrainGlobalAttributes(worldTerrainRenderSource(def, new Map([["0_0", tile]])));
    const global = encodeTerrainGlobalMap(def, expected);
    const saved = global.slice();
    saved[saved.length - 1] = 17;
    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      for (const kind of ["valid", "missing", "corrupt", "stale"] as const) {
        warnings.length = 0;
        const shape = kind === "stale" ? { ...def, tilesX: 3 } : def;
        const document = await loadWorldTerrain(path, shape, async (p) => {
          if (p === terrainGlobalMapPath(path)) {
            if (kind === "missing") throw new Error("HTTP 404");
            return kind === "corrupt" ? global.subarray(0, 35) : kind === "valid" ? saved : global;
          }
          assert.equal(p, terrainTilePath(path, "0_0"));
          return bytes;
        });
        assert.equal(warnings.length, kind === "valid" ? 0 : 1);
        if (warnings.length) assert.match(String(warnings[0]![0]), /^\[terrain\].*computing from tiles/);
        const expectedAttributes = kind === "stale"
          ? buildTerrainGlobalAttributes(worldTerrainRenderSource(document.def, document.tiles)) : structuredClone(expected);
        if (kind === "valid") expectedAttributes.weights[expectedAttributes.weights.length - 1] = 17;
        assert.deepEqual(document.globalAttributes, expectedAttributes);
        assert.equal(document.tiles.size, 1, "tiles still load eagerly");
      }
      // A single (0, 0) tile needs no global map: no sidecar request, no warning.
      warnings.length = 0;
      const read: string[] = [];
      const document = await loadWorldTerrain(path, single, async (p) => { read.push(p); return bytes; });
      assert.deepEqual(read, [terrainTilePath(path, "0_0")]);
      assert.equal(document.globalAttributes, undefined);
      assert.equal(warnings.length, 0);
    } finally { console.warn = original; }
  });

  await checkAsync("terrain loader: eagerly reads listed tiles, keeps holes and rejects missing/mismatched binaries", async () => {
    const { def, bytes, path } = fixture();
    const read: string[] = [];
    const document = await loadWorldTerrain(path, { ...def, tilesX: 2 }, async (p) => { read.push(p); return bytes; });
    assert.deepEqual(read, [terrainGlobalMapPath(path), terrainTilePath(path, "0_0")]);
    assert.equal(document.tiles.size, 1);
    await assert.rejects(loadWorldTerrain(path, def, async () => { throw new Error("missing tile"); }), /missing tile/);
    await assert.rejects(loadWorldTerrain(path, def, async () => bytes.subarray(0, 33)));
  });

  await checkAsync("terrain read path: a .terrain.json loads as a World Terrain; legacy sidecars and rotation are explicit errors", async () => {
    const { def, bytes } = fixture();
    const original = globalThis.fetch;
    const requests: string[] = [];
    try {
      globalThis.fetch = async (input) => {
        const url = String(input); requests.push(url);
        if (url.endsWith(".tile.bin")) return new Response(bytes.slice().buffer);
        return new Response(JSON.stringify(def));
      };
      const loaded = await fetchTerrainActorDocument(path, false, actor);
      assert.equal(loaded.kind, "world");
      assert.deepEqual(loaded.document.def.origin, [-22, 2, -35]);
      assert.equal(loaded.document.tiles.get("0_0")!.heights[0], 3.25);
      assert.ok(requests.some((p) => p.endsWith("test.tiles/0_0.tile.bin")));
      // The 1x1 .landscape.json sidecar is no longer read: no request, an explicit error.
      requests.length = 0;
      await assert.rejects(fetchTerrainActorDocument("landscapes/test.landscape.json", false, actor), /not supported/);
      assert.deepEqual(requests, []);
      // A World Terrain is world-aligned: a rotated actor is refused, never silently dropped.
      await assert.rejects(fetchTerrainActorDocument(path, false, { ...actor, rotation: [0, 15, 0] }), /rotated/);
      globalThis.fetch = async () => new Response("missing", { status: 404 });
      await assert.rejects(fetchTerrainActorDocument(path), /HTTP 404/);
    } finally { globalThis.fetch = original; }
  });
}
