import assert from "node:assert/strict";
import { Document, NodeIO } from "@gltf-transform/core";
import { foliageDataPath } from "../../engine/scene/foliage";
import type { RoomLayout } from "../../engine/scene/layout";
import {
  HLOD_SCHEMA, averageLinearColor, hlodCellPath, hlodCellPlacements, hlodCellSourceHash,
  hlodIncludesPlacement, hlodIndexPath, normalizeHlodIndex, type HlodPlacementInput,
} from "../../engine/world/hlod";
import { normalizeWorldPartitionSettings, partitionLayout, worldCellPath } from "../../engine/world/worldPartition";
import { buildLevelHlod } from "../../tools/world/hlodBuild";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const LEVEL = "assets/Test/Levels/World.level.json";
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const input = (x = 0): HlodPlacementInput => ({
  assetId: "cube", position: [x, 0, 0], rotation: [0, 0, 0], scale: [3, 3, 3],
});

function layout(): RoomLayout {
  return {
    schema: 1, name: "HLOD fixture", loadGroups: [], characters: [],
    worldSettings: { partition: { enabled: true, grids: {
      main: { cellSize: 128, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 },
    } } },
    instances: [{ assetId: "cube", placements: [
      { position: [10, 0, 10], scale: 3 },
      { position: [20, 0, 10], scale: [3, 4, 3], rotationYDeg: 15 },
      { position: [266, 0, 10], scale: 3 },
    ] }],
  };
}

async function fixture(): Promise<Map<string, Uint8Array>> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]));
  const indices = doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]));
  const primitive = doc.createPrimitive().setAttribute("POSITION", positions).setIndices(indices)
    .setMaterial(doc.createMaterial("red").setBaseColorFactor([1, 0, 0, 1]));
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)));
  return new Map([
    ["assets/cube.glb", await new NodeIO().writeBinary(doc)],
    ["assets/manifest.json", encode({ version: 1, assets: [{ id: "cube", path: "assets/cube.glb" }] })],
    [LEVEL, encode(layout())],
  ]);
}

export async function registerHlodTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("hlod: paths follow foliage and main cell naming rules", () => {
    for (const level of [LEVEL, "layouts/old.layout.json", "layouts/old.json", "assets\\Test\\Levels\\World.level.json"]) {
      assert.equal(hlodIndexPath(level), foliageDataPath(level).replace(/\.foliage\.json$/, ".hlod.json"));
      assert.equal(hlodCellPath(level, "-2_3"), worldCellPath(level, "main", "-2_3")
        .replace("/main/", "/hlod/").replace(".cell.json", ".hlod.glb"));
    }
    assert.throws(() => hlodCellPath(LEVEL, "../escape"), /key/);
  });

  check("hlod: index validates fields, duplicates and numeric cell ordering", () => {
    const valid = { schema: HLOD_SCHEMA, type: "hlod", cellSize: 128,
      cells: [{ key: "2_0", triangles: 12, sourceHash: "abcd" }, { key: "-1_0", triangles: 0, sourceHash: "1234" }] };
    assert.deepEqual(normalizeHlodIndex(valid).cells.map((cell) => cell.key), ["-1_0", "2_0"]);
    assert.equal(valid.cells[0]!.key, "2_0");
    for (const [field, value] of [["schema", 2], ["type", "world"], ["cellSize", 0], ["cellSize", Infinity], ["cells", null]] as const) {
      assert.throws(() => normalizeHlodIndex({ ...valid, [field]: value }), new RegExp(field));
    }
    for (const [field, value] of [["key", "bad"], ["triangles", -1], ["triangles", 1.5], ["sourceHash", 42]] as const) {
      assert.throws(() => normalizeHlodIndex({ ...valid, cells: [{ ...valid.cells[0], [field]: value }] }), new RegExp(field));
    }
    assert.throws(() => normalizeHlodIndex({ ...valid, cells: [valid.cells[0], valid.cells[0]] }), /key/);
  });

  check("hlod: canonical transforms match runtime fallbacks and retain hidden inputs", () => {
    const source = layout();
    source.instances[0]!.placements = [
      { position: [1, 2, 3], rotationYDeg: 45, scale: 2, hidden: true },
      { position: [4, 5, 6], rotationYDeg: 90, rotation: [10, 20, 30], scale: [2, 3, 4], scaleLocked: true, materialSlot: "green" },
      { position: [0, 0, 0] },
    ];
    const placements = hlodCellPlacements(source, [0, 1, 2].map((placement) => ({ group: 0, placement })));
    assert.deepEqual(placements[0], { assetId: "cube", position: [1, 2, 3], rotation: [0, 45, 0], scale: [2, 2, 2], hidden: true });
    assert.deepEqual(placements[1], { assetId: "cube", position: [4, 5, 6], rotation: [10, 20, 30], scale: [2, 3, 4], materialSlot: "green" });
    assert.deepEqual(placements[2], { assetId: "cube", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    assert.equal(hlodCellSourceHash(placements), hlodCellSourceHash(placements.slice(1)));
    (placements[0]!.position as number[])[0] = 99;
    assert.equal(source.instances[0]!.placements[0]!.position[0], 1);
  });

  check("hlod: source hash ignores order, float noise and hidden placements", () => {
    assert.equal(hlodCellSourceHash([input(1), input(2)]), hlodCellSourceHash([input(2), input(1)]));
    assert.notEqual(hlodCellSourceHash([input(1)]), hlodCellSourceHash([input(1.01)]));
    assert.equal(hlodCellSourceHash([input(1)]), hlodCellSourceHash([input(1.000001)]));
    const hidden = { ...input(5), hidden: true };
    assert.equal(hlodCellSourceHash([input(1), hidden]), hlodCellSourceHash([input(1)]));
    assert.notEqual(hlodCellSourceHash([input(1)]), hlodCellSourceHash([{ ...input(1), materialSlot: "green" }]));
    assert.notEqual(hlodCellSourceHash([input(1)]), hlodCellSourceHash([input(1), input(1)]));
  });

  check("hlod: inclusion follows visibility, marker and scaled detail-cull rules", () => {
    assert.equal(hlodIncludesPlacement({ assetId: "cube", hidden: true }, 10, 1, 384), false);
    assert.equal(hlodIncludesPlacement({ assetId: "cube" }, 0.5, 1, 384), false);
    assert.equal(hlodIncludesPlacement({ assetId: "cube" }, 0.5, 10, 384), true);
    assert.equal(hlodIncludesPlacement({ assetId: "cube" }, 10, 1, 384), true);
    assert.equal(hlodIncludesPlacement({ assetId: "marker:playerStart" }, 10, 1, 384), false);
    assert.equal(hlodIncludesPlacement({ assetId: "marker:ambientSound" }, 10, 1, 384), false);
    assert.equal(hlodIncludesPlacement({ assetId: "cube" }, 0.5, 1, 100), false);
  });

  check("hlod: pixel averages decode sRGB and ignore nearly transparent pixels", () => {
    const grey = averageLinearColor(new Uint8Array([128, 128, 128]), 3);
    assert.ok(grey.every((channel) => Math.abs(channel - 0.2158) < 1e-3));
    assert.deepEqual(averageLinearColor(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 7]), 4), [1, 0, 0]);
    assert.deepEqual(averageLinearColor(new Uint8Array(), 4), [1, 1, 1]);
    assert.deepEqual(averageLinearColor(new Uint8Array([0, 0, 0, 0]), 4), [1, 1, 1]);
    assert.deepEqual(averageLinearColor(new Uint8Array([0, 0, 0, 255, 255, 255]), 3), [0.5, 0.5, 0.5]);
  });

  await checkAsync("hlod: in-memory build produces two world-space red proxies and an index", async () => {
    const source = await fixture();
    const reads = new Map<string, number>();
    const result = await buildLevelHlod(LEVEL, { async read(path) {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return source.get(path) ?? null;
    } });
    assert.deepEqual(result.index.cells.map((cell) => cell.key), ["0_0", "2_0"]);
    assert.equal(result.index.cellSize, 128);
    assert.equal(result.files.size, 3);
    assert.equal(reads.get("assets/cube.glb"), 1);
    assert.deepEqual(result.warnings, []);
    const serialized = new TextDecoder().decode(result.files.get(hlodIndexPath(LEVEL))!);
    assert.ok(serialized.endsWith("\n"));
    assert.deepEqual(normalizeHlodIndex(JSON.parse(serialized)), result.index);
    for (const cell of result.index.cells) {
      assert.ok(cell.triangles > 0);
      const doc = await new NodeIO().readBinary(result.files.get(hlodCellPath(LEVEL, cell.key))!);
      const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
      assert.equal(primitives.length, 1);
      const primitive = primitives[0]!;
      assert.equal(primitive.getIndices()!.getCount() / 3, cell.triangles);
      assert.equal(primitive.getIndices()!.getComponentType(), 5125);
      const colors = primitive.getAttribute("COLOR_0")!;
      assert.equal(colors.getType(), "VEC3");
      for (let index = 0; index < colors.getCount(); index += 1) {
        const color = colors.getElement(index, []);
        assert.ok(Math.abs(color[0]! - 1) < 1e-5 && Math.abs(color[1]!) < 1e-5 && Math.abs(color[2]!) < 1e-5);
      }
      assert.equal(primitive.getAttribute("NORMAL")!.getCount(), colors.getCount());
      assert.deepEqual(primitive.getMaterial()!.getBaseColorFactor(), [1, 1, 1, 1]);
      const xs = Array.from({ length: colors.getCount() }, (_, index) => primitive.getAttribute("POSITION")!.getElement(index, [])[0]!);
      assert.ok(Math.min(...xs) > (cell.key === "0_0" ? 8 : 264));
      assert.ok(Math.max(...xs) < (cell.key === "0_0" ? 24 : 268));
    }
  });

  await checkAsync("hlod: saved cell files merge identically and missing cells fail", async () => {
    const source = await fixture();
    const settings = normalizeWorldPartitionSettings(layout().worldSettings!.partition);
    const split = partitionLayout(layout(), settings);
    split.persistent.worldCells = [...split.cells.keys()];
    const before = await buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null }, { ratio: 1 });
    source.set(LEVEL, encode(split.persistent));
    for (const [key, cell] of split.cells) source.set(worldCellPath(LEVEL, "main", key), encode(cell));
    const after = await buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null }, { ratio: 1 });
    assert.deepEqual(after.index, before.index);
    source.delete(worldCellPath(LEVEL, "main", "2_0"));
    await assert.rejects(buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null }), /Missing public resource/);
  });

  await checkAsync("hlod: material slots and placement overrides bake Forge linear colour", async () => {
    const source = await fixture();
    const manifest = { version: 1, assets: [
      { id: "cube", path: "assets/cube.glb" }, { id: "grey", path: "assets/grey.material.json" },
      { id: "green", path: "assets/green.material.json" },
    ] };
    source.set("assets/manifest.json", encode(manifest));
    source.set("assets/cube.materials.json", encode({ slots: ["grey"] }));
    source.set("assets/grey.material.json", encode({ baseColor: "#808080" }));
    source.set("assets/green.material.json", encode({ baseColor: "#00ff00" }));
    const level = layout();
    level.instances[0]!.placements[2]!.materialSlot = "green";
    source.set(LEVEL, encode(level));
    const result = await buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null }, { ratio: 1 });
    for (const key of ["0_0", "2_0"]) {
      const doc = await new NodeIO().readBinary(result.files.get(hlodCellPath(LEVEL, key))!);
      const color = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("COLOR_0")!.getElement(0, []);
      const expected = key === "0_0" ? [0.21586, 0.21586, 0.21586] : [0, 1, 0];
      assert.ok(color.every((channel, index) => Math.abs(channel - expected[index]!) < 1e-4));
    }
  });

  await checkAsync("hlod: external GLTF resources use injected IO and retain node transforms", async () => {
    const source = await fixture();
    const nodeIO = new NodeIO();
    const doc = await nodeIO.readBinary(source.get("assets/cube.glb")!);
    const child = doc.getRoot().listScenes()[0]!.listChildren()[0]!;
    child.setTranslation([2, 1, 0]).setScale([1, 2, 1]);
    const gltf = await nodeIO.writeJSON(doc);
    source.set("assets/cube.gltf", encode(gltf.json));
    for (const [uri, bytes] of Object.entries(gltf.resources)) source.set(`assets/${uri}`, bytes);
    source.set("assets/manifest.json", encode({ version: 1, assets: [{ id: "cube", file: "assets/cube.gltf" }] }));
    const result = await buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null }, { ratio: 1 });
    assert.deepEqual(result.warnings, []);
    const proxy = await nodeIO.readBinary(result.files.get(hlodCellPath(LEVEL, "2_0"))!);
    const primitive = proxy.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const position = primitive.getAttribute("POSITION")!;
    const vertices = Array.from({ length: position.getCount() }, (_, index) => position.getElement(index, []));
    assert.ok(Math.abs(Math.min(...vertices.map((vertex) => vertex[0]!)) - 270.5) < 1e-4);
    assert.ok(Math.abs(Math.max(...vertices.map((vertex) => vertex[1]!)) - 6) < 1e-4);
  });

  await checkAsync("hlod: hidden and small placements leave an empty index; bad assets warn once", async () => {
    const source = await fixture();
    const level = layout();
    level.instances[0]!.placements = [{ position: [10, 0, 10], scale: 1 }, { position: [20, 0, 10], scale: 3, hidden: true }];
    level.instances.push({ assetId: "missing", placements: [{ position: [10, 0, 10] }, { position: [266, 0, 10] }] });
    source.set(LEVEL, encode(level));
    const result = await buildLevelHlod(LEVEL, { read: async (path) => source.get(path) ?? null });
    assert.deepEqual(result.index.cells, []);
    assert.equal(result.files.size, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /missing/);
  });

  await checkAsync("hlod: disabled partition and invalid build parameters reject", async () => {
    const source = await fixture();
    const io = { read: async (path: string) => source.get(path) ?? null };
    const level = layout();
    delete level.worldSettings;
    source.set(LEVEL, encode(level));
    await assert.rejects(buildLevelHlod(LEVEL, io), /World Partition is not enabled for/);
    await assert.rejects(buildLevelHlod(LEVEL, io, { ratio: 0 }), /ratio/);
    await assert.rejects(buildLevelHlod(LEVEL, io, { error: -1 }), /error/);
    await assert.rejects(buildLevelHlod("../outside.level.json", io), /escapes public/);
  });
}
