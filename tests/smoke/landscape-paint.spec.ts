import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainTilePath } from "../../engine/terrain/terrainTypes";
import { addLandscapeFromMenu, readSavedTerrain } from "./terrain";
import { expect, test, type Page } from "./test";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";

// Paint, material, reload, fill, remove and undo each await their real save batch.
// Individual saves remain bounded below; the full workflow needs room for all of them.
test.setTimeout(360_000);

// Saves stay inside the per-run smoke project.

/** The saved 1×1 tile, straight from disk. */
async function savedTileBytes(): Promise<Buffer> {
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
  return readFile(smokePublicPath(terrainTilePath(level.landscapes[0].dataRef, "0_0")));
}

async function saveLayout(page: Page): Promise<void> {
  await page.getByTestId("editor-save").click();
  // A previous autosave can still say "Saved" while this manual save is queued.
  await expect(page.getByTestId("editor-save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
}

async function deleteExistingLandscape(page: Page): Promise<void> {
  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  if ((await landscapeRows.count()) === 0) return;
  await landscapeRows.first().click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Landscape" })).toHaveCount(0);
  await saveLayout(page);
}

test("editor Landscape paint smoke: paint layer, save, reload", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  await deleteExistingLandscape(page);
  await addLandscapeFromMenu(page);

  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  await expect(landscapeRows.first()).toBeVisible();
  await landscapeRows.first().click();
  // Type-specific controls identify the selection; the shared Details chrome
  // (`finalizeDetailsRender`) strips the `.detail-heading` the renderer emits.
  await expect(
    page.locator('[data-inspector-pane="details"] [data-landscape-mode]'),
  ).toBeVisible();

  await page.locator('[data-landscape-mode]').selectOption('paint');
  await expect(page.locator('[data-landscape-paint-tool="paint"]')).toBeVisible();
  await page.locator('[data-landscape-layer="dirt"]').click();
  await page.locator("[data-landscape-view]").selectOption("layer");
  await page.evaluate(() => {
    const setNumber = (key: string, value: string): void => {
      const input = document.querySelector<HTMLInputElement>(`[data-landscape-number="${key}"]`);
      if (!input) throw new Error(`missing landscape input: ${key}`);
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setNumber("brushSize", "10");
    setNumber("strength", "1");
  });

  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("missing canvas bounds");
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 3);
  await page.mouse.up();

  // Assign a material to the (active) dirt layer and switch back to lit so the
  // weight-blended splat material builds — a shader compile error would surface
  // as a console/page error and fail the final assertion.
  await page.locator("[data-landscape-view]").selectOption("lit");
  const layerMaterial = page.locator("[data-landscape-layer-material]");
  await expect(layerMaterial).toBeVisible();
  const assignedMaterial = await layerMaterial.evaluate((element) => {
    const select = element as HTMLSelectElement;
    const option = Array.from(select.options).find((entry) => entry.value.length > 0);
    if (!option) throw new Error("no material asset available to assign");
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { id: option.value, label: option.textContent ?? "" };
  });
  // The layer button now shows the material's name instead of "Dirt".
  await expect(
    page.locator('[data-landscape-layer="dirt"]'),
  ).toContainText(assignedMaterial.label.trim(), { timeout: 10_000 });
  // The dirt layer also becomes mud for vehicles (TERRAIN_DEFORMATION Faz 1b).
  await page.locator("[data-landscape-layer-physical-material]").selectOption("mud");
  await expect(page.locator("[data-landscape-layer-physical-material]")).toHaveValue("mud");
  await page.waitForTimeout(1500);

  await saveLayout(page);

  const landscapeData = await readSavedTerrain(page);
  const grass = landscapeData.layers.find((layer) => layer.id === "grass");
  const dirt = landscapeData.layers.find((layer) => layer.id === "dirt");
  expect(landscapeData.layers).toHaveLength(4);
  expect(dirt?.weights.some((weight) => weight > 0.05)).toBeTruthy();
  expect(grass?.weights.some((weight) => weight < 0.95)).toBeTruthy();
  // The assigned layer material persisted into the sidecar.
  expect(dirt?.material).toBe(assignedMaterial.id);
  expect(dirt?.physicalMaterial).toBe("mud");
  expect(grass?.physicalMaterial).toBeUndefined();

  await page.goto(`/?editor&landscapePaintReload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first().click();
  await page.locator('[data-landscape-mode]').selectOption('paint');
  await expect(page.locator('[data-landscape-layer="dirt"]')).toBeVisible();
  // Reload rebuilds the splat material from the sidecar's assigned material — wait
  // for it to settle so a load-time shader error would be caught below.
  await page.waitForTimeout(1500);
  const reloadedData = await readSavedTerrain(page);
  const reloadedDirt = reloadedData.layers.find((layer) => layer.id === "dirt");
  expect(reloadedDirt?.weights.some((weight) => weight > 0.05)).toBeTruthy();
  // A layer material persisted across reload (exact id can vary with the dev
  // server's demo-layout autosave; the pre-reload assertion pins the exact id).
  expect(typeof reloadedDirt?.material).toBe("string");
  expect((reloadedDirt?.material ?? "").length).toBeGreaterThan(0);
  expect(reloadedDirt?.physicalMaterial).toBe("mud");
  await page.locator('[data-landscape-layer="dirt"]').click();
  await expect(page.locator("[data-landscape-layer-physical-material]")).toHaveValue("mud");

  // Fill Layer goes through the shared tile editor: the active layer covers
  // every vertex, and undo puts the painted weights back exactly.
  await page.locator('[data-landscape-layer="snow"]').click();
  await page.locator("[data-landscape-fill]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Landscape Fill Layer");
  await saveLayout(page);
  const filled = await readSavedTerrain(page);
  expect(filled.layers.find((layer) => layer.id === "snow")?.weights.every((weight) => weight === 1)).toBe(true);
  expect(filled.layers.filter((layer) => layer.id !== "snow").every((layer) => layer.weights.every((weight) => weight === 0))).toBe(true);
  await page.getByTestId("editor-undo").click();
  await saveLayout(page);
  const unfilled = await readSavedTerrain(page);
  expect(unfilled.layers.map((layer) => layer.weights)).toEqual(reloadedData.layers.map((layer) => layer.weights));

  // Remove Layer: Add Layer first, so removing the painted dirt layer drops
  // five layers (two RGBA8 blocks) to four (one). Its weight goes to the other
  // layers, every vertex stays at 255, and undo restores the exact bytes.
  await page.locator("[data-landscape-add-layer]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Add Landscape Paint Layer");
  await saveLayout(page);
  const fiveLayers = await readSavedTerrain(page);
  expect(fiveLayers.layers.map((layer) => layer.id)).toEqual(["grass", "dirt", "rock", "snow", "layer-1"]);
  const beforeRemove = await savedTileBytes();
  const fiveTile = decodeTerrainTile(beforeRemove);
  expect(fiveTile.layerCount).toBe(5);
  await page.locator('[data-landscape-layer="dirt"]').click();
  await expect(page.locator("[data-landscape-remove-layer]")).toHaveAttribute("data-landscape-remove-layer", "dirt");
  await page.locator("[data-landscape-remove-layer]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Remove Landscape Paint Layer");
  await expect(page.locator('[data-landscape-layer="dirt"]')).toHaveCount(0);
  await expect(page.locator('[data-landscape-layer="grass"]')).toHaveClass(/active/);
  await expect(page.locator("[data-landscape-add-layer]")).toContainText("(4/8)");
  await saveLayout(page);
  const removed = await readSavedTerrain(page);
  expect(removed.layers.map((layer) => layer.id)).toEqual(["grass", "rock", "snow", "layer-1"]);
  const removedTile = decodeTerrainTile(await savedTileBytes());
  const count = removedTile.size * removedTile.size;
  expect(removedTile.layerCount).toBe(4);
  expect(removedTile.weights.length).toBe(count * 4);
  let spread = 0;
  // These are synchronous binary invariants, not browser assertions. Recording
  // two Playwright steps per vertex overwhelms tracing and stalls timeout handling.
  for (let index = 0; index < count; index += 1) {
    const now = Array.from(removedTile.weights.subarray(index * 4, index * 4 + 4));
    assert.equal(now.reduce((sum, value) => sum + value, 0), 255, `vertex ${index} sums to 255`);
    if (fiveTile.weights[index * 4 + 1]! > 0) {
      spread += 1;
      assert.ok(now[0]! >= fiveTile.weights[index * 4]!, `vertex ${index} retains its grass weight`);
    } else {
      assert.deepEqual(now, [0, 2, 3].map((layer) => fiveTile.weights[index * 4 + layer]!).concat(fiveTile.weights[count * 4 + index * 4]!), `vertex ${index} keeps untouched layers`);
    }
  }
  console.log(`[landscape-paint] Remove Layer spread dirt over ${spread} vertices`);
  expect(spread).toBeGreaterThan(0);
  await page.getByTestId("editor-undo").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Add Landscape Paint Layer");
  await expect(page.locator('[data-landscape-layer="dirt"]')).toHaveClass(/active/);
  await saveLayout(page);
  expect((await savedTileBytes()).equals(beforeRemove), "undo restores the five-layer tile bytes").toBe(true);
  const restored = await readSavedTerrain(page);
  expect(restored.layers.map((layer) => layer.id)).toEqual(["grass", "dirt", "rock", "snow", "layer-1"]);
  expect(restored.layers[1]!.material).toBe(fiveLayers.layers[1]!.material);
  expect(restored.layers[1]!.physicalMaterial).toBe("mud");

  expect(pageErrors).toEqual([]);
});
