import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFlatLandscapeData } from "../../engine/scene/landscape";
import type { LayoutLandscape } from "../../engine/scene/layout";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { captureTerrainSnapshot, landscapeLayersWithoutLayer, terrainDocumentToLandscape, terrainTransformNeedsSave } from "../../engine/terrain/terrainLandscapeBridge";
import { loadWorldTerrain, validateTerrainTile } from "../../engine/terrain/terrainLoader";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateSaveTerrainPayload, validateSaveTerrainTile } from "../../tools/saveValidator";
import { fetchTerrainActorDocument } from "../../src/scene/terrainDocument";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const actor: LayoutLandscape = { id: "l", name: "Terrain", position: [10, 2, -3], dataRef: "landscapes/test.landscape.json" };

function fixture() {
  const data = createFlatLandscapeData("small");
  data.heights[0] = 3.25;
  data.layers[1]!.physicalMaterial = "mud";
  data.splines = [{ id: "road", name: "Road", hidden: false, locked: false, smooth: true, smoothness: 0.25,
    points: [{ id: "a", position: [0, 0, 0], width: 2, falloff: 1, arriveTangent: [1, 0, 0] },
      { id: "b", position: [4, 0, 4], width: 2, falloff: 1, leaveTangent: [1, 0, 0] }],
    segments: [{ id: "ab", startPointId: "a", endPointId: "b",
      deform: { enabled: true, raiseTerrain: true, lowerTerrain: false, flatten: false, targetOffset: 1 },
      paint: { enabled: true, layerId: "grass", strength: 0.8 },
      mesh: { enabled: true, assetId: "road", collision: true, spacing: 2, scale: [1, 1, 1], offset: [0, 0, 0],
        yawOffset: 0, fitToLength: true, alignToTerrain: true, bank: 2, deform: true } }],
  }];
  return { data, ...captureTerrainSnapshot(actor, data) };
}

export function registerTerrainDocumentTests(check: Check): void {
  check("terrain definition: maximal runtime/save shape has no serialization drift and unknown keys are reported", () => {
    const { def, path } = fixture();
    const saved = validateSaveTerrainPayload({ path, terrain: def }).terrain;
    assert.deepEqual(saved, normalizeWorldTerrain(def));
    assert.deepEqual(collectDroppedFields(def, saved, "terrain").paths, []);
    assert.equal(saved.layers[1]?.physicalMaterial, "mud", "the 1x1 adapter carries the layer's physical material");
    const nulled = { ...def, layers: def.layers.map((layer, index) => index === 0 ? { ...layer, physicalMaterial: null } : layer) };
    assert.equal(normalizeWorldTerrain(nulled).layers[0]?.physicalMaterial, null);
    const edited = terrainDocumentToLandscape({ def: saved, tiles: new Map([["0_0", decodeTerrainTile(fixture().bytes)]]) });
    assert.deepEqual(edited.layers.map((layer) => layer.physicalMaterial ?? null), [null, "mud", null, null]);
    const extra = { ...def, secret: true, layers: def.layers.map((l) => ({ ...l, future: 1 })) };
    const report = collectDroppedFields(extra, normalizeWorldTerrain(extra), "terrain");
    assert.ok(report.paths.includes("terrain.secret"));
    assert.ok(report.paths.includes("terrain.layers[0].future"));
  });

  check("terrain definition: removing paint layers down to one has no serialization drift; tiles validate", () => {
    const { data } = fixture();
    for (const [id, count, blocks] of [["grass", 3, 1], ["snow", 2, 1], ["rock", 1, 1]] as const) {
      data.layers = landscapeLayersWithoutLayer(data, id);
      const snapshot = captureTerrainSnapshot(actor, data);
      const saved = validateSaveTerrainPayload({ path: snapshot.path, terrain: snapshot.def }).terrain;
      assert.equal(saved.layers.length, count);
      assert.deepEqual(saved, normalizeWorldTerrain(snapshot.def));
      assert.deepEqual(collectDroppedFields(snapshot.def, saved, "terrain").paths, []);
      const tile = validateTerrainTile(saved, "0_0", snapshot.bytes);
      assert.equal(tile.layerCount, count);
      assert.equal(tile.weights.length, blocks * tile.size * tile.size * 4);
      assert.deepEqual(saved.layers.map((layer) => layer.physicalMaterial ?? null), data.layers.map((layer) => layer.physicalMaterial ?? null));
    }
    assert.deepEqual(data.layers.map((layer) => layer.id), ["dirt"]);
    assert.equal(data.layers[0]!.physicalMaterial, "mud");
    assert.ok(data.layers[0]!.weights.every((weight) => weight === 1), "the last layer holds every vertex");
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

  check("terrain migration: refuses silent rotation loss and snapshot survives later edits", () => {
    const { data, def, bytes } = fixture();
    assert.throws(() => captureTerrainSnapshot({ ...actor, rotation: [0, 10, 0] }, data), /explicit adaptation/);
    data.heights[0] = 100;
    data.splines![0]!.name = "changed";
    assert.equal(def.splines![0]!.name, "Road");
    assert.equal(validateTerrainTile(def, "0_0", bytes).heights[0], 3.25);
  });

  check("terrain fixture: migrated RuntimeParity has the same heights, materials and spline references as legacy", () => {
    const level = JSON.parse(readFileSync("public/layouts/RuntimeParity.level.json", "utf8"));
    const entry = level.landscapes[0] as LayoutLandscape;
    const definition = JSON.parse(readFileSync(`public/${entry.dataRef}`, "utf8"));
    const legacy = JSON.parse(readFileSync("public/landscapes/runtime-parity.landscape.json", "utf8"));
    const def = normalizeWorldTerrain(definition);
    const tile = validateTerrainTile(def, "0_0", readFileSync(`public/${terrainTilePath(entry.dataRef, "0_0")}`));
    const data = terrainDocumentToLandscape({ def, tiles: new Map([["0_0", tile]]) });
    assert.deepEqual(data.heights, legacy.heights.map((h: number) => Math.fround(h * legacy.size.heightScale)));
    assert.deepEqual(data.layers.map((l) => l.material), legacy.layers.map((l: { material?: string }) => l.material));
    assert.deepEqual(data.splines ?? [], legacy.splines ?? []);
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
      // A single (0, 0) tile goes through the 1x1 adapter: no sidecar request, no warning.
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
    assert.throws(() => terrainDocumentToLandscape(document), /Phase 2/);
    await assert.rejects(loadWorldTerrain(path, def, async () => { throw new Error("missing tile"); }), /missing tile/);
    await assert.rejects(loadWorldTerrain(path, def, async () => bytes.subarray(0, 33)));
  });

  await checkAsync("terrain read path: legacy and migrated sidecars load as the same World Terrain, new format errors propagate", async () => {
    const { def, bytes, path, data } = fixture();
    const original = globalThis.fetch;
    const requests: string[] = [];
    try {
      globalThis.fetch = async (input) => {
        const url = String(input); requests.push(url);
        if (url.endsWith(".tile.bin")) return new Response(bytes.slice().buffer);
        return new Response(JSON.stringify(url.endsWith(".terrain.json") ? def : data));
      };
      const legacy = await fetchTerrainActorDocument(actor.dataRef, false, actor);
      const loaded = await fetchTerrainActorDocument(path);
      assert.equal(legacy.kind, "world");
      assert.equal(loaded.kind, "world");
      if (legacy.kind !== "world" || loaded.kind !== "world") return;
      // The legacy sidecar is read in memory and names where the editor saves it.
      assert.deepEqual(legacy.legacySource, { path: actor.dataRef });
      assert.equal(loaded.legacySource, undefined);
      assert.deepEqual(legacy.document.def.origin, loaded.document.def.origin);
      assert.deepEqual(legacy.document.def.splines, loaded.document.def.splines, "legacy splines arrive in world space");
      assert.deepEqual(Array.from(legacy.document.tiles.get("0_0")!.heights), Array.from(loaded.document.tiles.get("0_0")!.heights));
      const migrated = terrainDocumentToLandscape(loaded.document);
      assert.equal(terrainTransformNeedsSave(actor, migrated), false);
      assert.equal(terrainTransformNeedsSave({ ...actor, position: [20, 2, -3] }, migrated), true);
      assert.equal(terrainTransformNeedsSave({ ...actor, collision: false }, migrated), true);
      assert.deepEqual(captureTerrainSnapshot({ ...actor, position: [20, 2, -3] }, migrated).def.origin, [-12, 2, -35]);
      assert.ok(requests.some((p) => p.endsWith("test.tiles/0_0.tile.bin")));
      // Retain authored encoding range and layer colors through the old editing adapter.
      def.heightMin = -100; def.heightMax = 100; def.layers[0]!.color = "#123456";
      const document = terrainDocumentToLandscape({ def, tiles: new Map([["0_0", validateTerrainTile(fixture().def, "0_0", bytes)]]) });
      const snapshot = captureTerrainSnapshot({ ...actor, dataRef: path }, document);
      assert.equal(snapshot.def.heightMin, -100);
      assert.equal(snapshot.def.layers[0]!.color, "#123456");
      // A legacy grid a tile cannot hold exactly is an explicit error, never a silent adaptation.
      await assert.rejects(fetchTerrainActorDocument(actor.dataRef, false, { ...actor, rotation: [0, 15, 0] }), /terrain:migrate/);
      globalThis.fetch = async () => new Response(JSON.stringify({ ...data, size: { ...data.size, verticesZ: 33 } }));
      await assert.rejects(fetchTerrainActorDocument(actor.dataRef, false, actor), /non-square .*terrain:migrate/);
      globalThis.fetch = async () => new Response("missing", { status: 404 });
      await assert.rejects(fetchTerrainActorDocument(path), /HTTP 404/);
      // A missing legacy sidecar stays a flat 128-quad Landscape, centred on its actor.
      const missing = await fetchTerrainActorDocument(actor.dataRef, false, actor);
      assert.equal(missing.kind, "world");
      if (missing.kind !== "world") return;
      assert.equal(missing.document.def.tileQuads, 128);
      assert.deepEqual(missing.document.def.origin, [-54, 2, -67]);
      assert.deepEqual(missing.legacySource, { path: actor.dataRef });
    } finally { globalThis.fetch = original; }
  });
}
