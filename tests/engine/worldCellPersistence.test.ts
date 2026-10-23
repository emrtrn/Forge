import assert from "node:assert/strict";
import type { RoomLayout } from "../../engine/scene/layout";
import { ContentLoadError } from "../../engine/assets/contentValidation";
import { compareWorldCellKeys, normalizeWorldPartitionSettings, type WorldCellDocument } from "../../engine/world/worldPartition";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateLayout, validateSaveWorldCellsPayload } from "../../tools/saveValidator";
import { loadRoomLayout } from "../../src/scene/roomLayout";
import { saveLayoutViaDevEndpoint } from "../../src/editor/layoutSaver";
import type { LayoutSavePayload } from "../../src/scene/SceneApp";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const level = (): RoomLayout => ({ schema: 1, name: "cells", loadGroups: [], instances: [], characters: [] });
const cell = (key = "0_0"): WorldCellDocument => ({
  schema: 1, type: "worldCell", grid: "main", key,
  instances: [{ assetId: "shape:cube", placements: [{ name: "Cube", position: [1, 0, 1] }] }],
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

export async function registerWorldCellPersistenceTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("world cells: index validation omits empty indices and uses numeric z then x ordering", () => {
    const keys = ["10_0", "2_0", "0_10", "0_-2", "-1_0"];
    const expected = ["0_-2", "-1_0", "2_0", "10_0", "0_10"];
    assert.deepEqual([...keys].sort(compareWorldCellKeys), expected);
    assert.deepEqual((validateLayout({ ...level(), worldCells: keys }) as RoomLayout).worldCells, expected);
    for (const index of [undefined, []]) {
      assert.equal("worldCells" in (validateLayout({ ...level(), worldCells: index }) as object), false);
    }
    for (const index of [null, {}, "0_0", ["0_0", "0_0"], ["../0_0"], ["1.5_0"], [1]]) {
      assert.throws(() => validateLayout({ ...level(), worldCells: index }), /worldCells/);
    }
  });

  check("world cells: save payload validates paths, keys, keep membership and duplicate writes", () => {
    const valid = { level: "layouts/Cells.level.json", cells: [cell()], keep: ["2_0", "0_0"] };
    assert.deepEqual(validateSaveWorldCellsPayload(valid), { ...valid, keep: ["0_0", "2_0"] });
    assert.deepEqual(validateSaveWorldCellsPayload({ ...valid, cells: [], keep: [] }), { ...valid, cells: [], keep: [] });
    // Without keep nothing is deleted, and a cell need not be listed anywhere yet.
    assert.deepEqual(validateSaveWorldCellsPayload({ level: valid.level, cells: [cell("1_0")] }).keep, null);
    for (const key of ["../0_0", "0/0", "1.5_0"]) {
      assert.throws(() => validateSaveWorldCellsPayload({ ...valid, cells: [cell(key)] }), /key/);
      assert.throws(() => validateSaveWorldCellsPayload({ ...valid, keep: [key] }), /key/);
    }
    assert.throws(() => validateSaveWorldCellsPayload({ ...valid, cells: [cell("1_0")] }), /key.*not in keep/);
    assert.throws(() => validateSaveWorldCellsPayload({ ...valid, cells: [cell(), cell()] }), /duplicate cell key/);
    assert.throws(() => validateSaveWorldCellsPayload({ ...valid, keep: ["0_0", "0_0"] }), /duplicate cell key/);
    for (const path of ["../Cells.level.json", "layouts/../Cells.json", "Cells.txt", ""]) {
      assert.throws(() => validateSaveWorldCellsPayload({ ...valid, level: path }));
    }
    assert.throws(() => validateSaveWorldCellsPayload({ ...valid, cells: [{ ...cell(), lights: [{ id: "bad", type: "point", position: "bad" }] }] }), /position/);
  });

  check("world cells: element allowlist and dropped-field reporting match layout saves", () => {
    const input = cell();
    Object.assign(input.instances![0]!.placements[0]!, { futureFeature: 42 });
    const submitted = { level: "layouts/Cells.level.json", cells: [input], keep: [input.key] };
    const saved = validateSaveWorldCellsPayload(submitted);
    const layout = { ...level(), instances: input.instances };
    const savedLayout = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.cells[0]!.instances, savedLayout.instances);
    assert.deepEqual(collectDroppedFields(submitted.cells, saved.cells, "cells").paths,
      ["cells[0].instances[0].placements[0].futureFeature"]);
    assert.deepEqual(collectDroppedFields(layout, savedLayout, "layout").paths,
      ["layout.instances[0].placements[0].futureFeature"]);
  });

  await checkAsync("world cells: shared loader merges cells and classifies missing, corrupt and mismatched cells by path", async () => {
    const previous = globalThis.fetch;
    const path = "layouts/Cells.cells/main/0_0.cell.json";
    try {
      let cellResponse = () => response(cell());
      globalThis.fetch = (async (url) => String(url).endsWith("Cells.level.json")
        ? response({ ...level(), worldCells: ["0_0"] }) : cellResponse()) as typeof fetch;
      const merged = await loadRoomLayout("layouts/Cells.level.json");
      assert.equal("worldCells" in merged, false);
      assert.deepEqual(merged.instances, cell().instances);
      for (const [reason, makeResponse] of [
        ["http", () => response({}, 404)],
        ["invalid-json", () => new Response("{")],
        ["invalid-data", () => response(cell("1_0"))],
        ["invalid-data", () => response({ ...cell(), schema: 2 })],
        ["invalid-data", () => response({ ...cell(), instances: [null] })],
      ] as const) {
        cellResponse = makeResponse;
        await assert.rejects(loadRoomLayout("layouts/Cells.level.json"), (error: unknown) =>
          error instanceof ContentLoadError && error.path.startsWith(path) && error.reason === reason);
      }
    } finally { globalThis.fetch = previous; }
  });

  await checkAsync("world cells: saver orders writes, sends changed cells only, keeps full index and clears stale cells on disable", async () => {
    const previous = globalThis.fetch;
    const calls: { url: string; data: Record<string, unknown> }[] = [];
    let failCells = false;
    try {
      globalThis.fetch = (async (url, init) => {
        calls.push({ url: String(url), data: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return response({ ok: !failCells, path: "saved", dropped: String(url).endsWith("world-cells") ? ["cells[0].unknown"] : [] });
      }) as typeof fetch;
      const payload: LayoutSavePayload = {
        scenePath: "layouts/CellSaveTest.level.json",
        layout: { ...level(), worldSettings: { partition: normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 16 } } }) },
          instances: [{ assetId: "shape:cube", placements: [
            { position: [1, 0, 1] }, { position: [17, 0, 1] },
          ] }], blockingVolumes: [{ id: "wide", position: [0, 0, 0], size: [32, 1, 1] }] },
        editor: { gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true },
      };
      const original = structuredClone(payload);
      const result = await saveLayoutViaDevEndpoint(payload);
      assert.deepEqual(payload, original);
      assert.equal(result.warnings?.length, 1);
      assert.deepEqual(result.dropped, ["cells[0].unknown"]);
      // Cells (no deletion), then the level that indexes them, then stale-cell cleanup.
      assert.deepEqual(calls.map((call) => call.url), ["/__save-world-cells", "/__save-layout", "/__save-world-cells"]);
      assert.equal("keep" in calls[0]!.data, false);
      assert.deepEqual(calls[2]!.data, { level: payload.scenePath, cells: [], keep: ["0_0", "1_0"] });
      assert.deepEqual((calls[1]!.data.layout as RoomLayout).worldCells, ["0_0", "1_0"]);
      assert.deepEqual((calls[1]!.data.layout as RoomLayout).instances[0]!.placements, []);
      calls.length = 0;
      payload.layout.instances[0]!.placements[0]!.position[1] = 2;
      await saveLayoutViaDevEndpoint(payload);
      assert.deepEqual((calls[0]!.data.cells as WorldCellDocument[]).map((item) => item.key), ["0_0"]);
      assert.deepEqual(calls[2]!.data.keep, ["0_0", "1_0"]);
      calls.length = 0;
      await saveLayoutViaDevEndpoint(payload);
      assert.deepEqual(calls.map((call) => call.url), ["/__save-layout", "/__save-world-cells"], "nothing changed: no cell write");
      calls.length = 0;
      await saveLayoutViaDevEndpoint({ ...payload, scenePath: "layouts/OtherCellSaveTest.level.json" });
      assert.equal((calls[0]!.data.cells as unknown[]).length, 2);
      calls.length = 0;
      payload.layout.instances[0]!.placements[0]!.position[1] = 3;
      failCells = true;
      await assert.rejects(saveLayoutViaDevEndpoint(payload));
      assert.equal(calls.length, 1);
      failCells = false;
      calls.length = 0;
      await saveLayoutViaDevEndpoint(payload);
      assert.equal((calls[0]!.data.cells as unknown[]).length, 1);
      calls.length = 0;
      payload.layout.instances[0]!.placements.pop();
      await saveLayoutViaDevEndpoint(payload);
      assert.deepEqual(calls.map((call) => call.url), ["/__save-layout", "/__save-world-cells"]);
      assert.deepEqual(calls[1]!.data.keep, ["0_0"]);
      calls.length = 0;
      payload.layout.worldSettings!.partition!.enabled = false;
      await saveLayoutViaDevEndpoint(payload);
      assert.deepEqual(calls.map((call) => call.url), ["/__save-layout", "/__save-world-cells"]);
      assert.deepEqual(calls[1]!.data, { level: payload.scenePath, cells: [], keep: [] });
      assert.equal("worldCells" in (calls[0]!.data.layout as RoomLayout), false);
      assert.deepEqual((calls[0]!.data.layout as RoomLayout).instances, payload.layout.instances);
    } finally { globalThis.fetch = previous; }
  });
}
