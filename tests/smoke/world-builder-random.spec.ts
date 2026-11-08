import { access, readFile, rm } from "node:fs/promises";
import { smokePublicPath } from "./smokeProject.mjs";
import { expect, test, type Page } from "./test";
import { openWorldBuilder } from "./worldBuilder";

/**
 * World Builder window (RANDOM_WORLD_PLAN step 5): Add Actor → Terrain →
 * World Builder… opens the random world choices with a bird's-eye preview that
 * follows them; a bad level name shows the server's error in the window;
 * Create builds a small world through `/__world-random`, shows its progress
 * and opens the level looking over it; Create again on the same name asks
 * before replacing it.
 */
const FOLDER = "assets/playwright-random";
const LEVEL = `${FOLDER}/SmokeWorld.level.json`;

async function exists(path: string): Promise<boolean> {
  return access(smokePublicPath(path)).then(() => true, () => false);
}

/** A cheap fingerprint of the preview canvas, and how many distinct colours it has. */
async function canvasPrint(page: Page): Promise<{ hash: number; colours: number }> {
  return page.getByTestId("random-world-preview").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    const colours = new Set<number>();
    for (let k = 0; k < data.length; k += 4 * 37) {
      const colour = (data[k]! << 16) | (data[k + 1]! << 8) | data[k + 2]!;
      colours.add(colour);
      hash = (Math.imul(hash, 31) + colour) | 0;
    }
    return { hash, colours: colours.size };
  });
}

/** Waits for a preview newer than `after` (the panel's `data-preview-id`) and returns its id. */
async function nextPreview(page: Page, after: number): Promise<number> {
  const panel = page.getByTestId("random-world-panel");
  await expect.poll(async () => {
    const [state, id] = await Promise.all([panel.getAttribute("data-preview-state"), panel.getAttribute("data-preview-id")]);
    return state === "ready" ? Number(id) : 0;
  }, { timeout: 30_000 }).toBeGreaterThan(after);
  return Number(await panel.getAttribute("data-preview-id"));
}

test("World Builder window: random world choices, live preview, Create builds and opens the level", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await rm(smokePublicPath(FOLDER), { recursive: true, force: true });

  try {
    await page.goto(`/?editor&wbRandom=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await openWorldBuilder(page);
    const panel = page.getByTestId("random-world-panel");
    await expect(panel).toBeVisible();

    // The first preview: a picture, not a blank canvas, and its summary.
    let id = await nextPreview(page, 0);
    const first = await canvasPrint(page);
    expect(first.colours).toBeGreaterThan(20);
    await expect(page.getByTestId("random-world-summary")).toContainText("km");

    // Another landform redraws it.
    await panel.locator('[data-choice="landform"] button[data-value="mountains"]').click();
    await expect(panel.locator('[data-choice="landform"] button[data-value="mountains"]')).toHaveAttribute("aria-pressed", "true");
    id = await nextPreview(page, id);
    expect((await canvasPrint(page)).hash).not.toBe(first.hash);

    // Roll Dice picks another seed (and another picture).
    const seed = panel.locator("[data-seed]");
    const before = await seed.inputValue();
    await panel.locator("[data-roll]").click();
    await expect(seed).not.toHaveValue(before);
    id = await nextPreview(page, id);

    // Settlements: add one, remove it; the last one cannot be removed.
    const chips = page.getByTestId("random-world-settlement");
    const count = await chips.count();
    await panel.locator('[data-add-settlement="town"]').click();
    await expect(chips).toHaveCount(count + 1);
    await chips.last().getByRole("button").click();
    await expect(chips).toHaveCount(count);
    id = await nextPreview(page, id);

    // Rivers is a bounded number: slider + box, clamped to 0–3.
    const rivers = panel.locator('[data-count="rivers"]');
    await expect(panel.locator(".detail-row:has([data-count=rivers]) .param-slider")).toHaveCount(1);
    await rivers.fill("0");
    await rivers.dispatchEvent("change");
    id = await nextPreview(page, id);

    // A name the server refuses: its message shows in the window, nothing is built.
    await panel.locator('[data-choice="size"] button[data-value="small"]').click();
    await panel.locator("[data-folder]").fill(FOLDER);
    await panel.locator("[data-name]").fill("Bad<Name");
    await page.getByTestId("random-world-create").click();
    await expect(page.getByTestId("random-world-error")).toContainText("Dünya kurulamadı", { timeout: 15_000 });
    await expect(page.getByTestId("random-world-error")).toContainText("unusable");
    expect(await exists(FOLDER)).toBe(false);

    // Create: progress, then the editor reopens on the new level, looking over it.
    await panel.locator("[data-name]").fill("SmokeWorld");
    await expect(panel.locator("[data-level-path]")).toHaveText(LEVEL);
    const reloaded = page.waitForEvent("load", { timeout: 120_000 });
    await page.getByTestId("random-world-create").click();
    await expect(page.getByTestId("random-world-progress")).toBeVisible();
    await reloaded;
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    const project = JSON.parse(await readFile(smokePublicPath("project.3dgame.json"), "utf8"));
    expect(project.editor.defaultScene).toBe(LEVEL);
    expect(await exists(LEVEL)).toBe(true);
    expect(await exists(`${FOLDER}/SmokeWorld.worldbrief.json`)).toBe(true);
    const manifest = JSON.parse(await readFile(smokePublicPath("assets/manifest.json"), "utf8"));
    expect(manifest.assets.some((asset: { path: string; assetType: string }) => asset.path === LEVEL && asset.assetType === "level")).toBe(true);
    const pose = await page.evaluate((path) => localStorage.getItem(`forge.editor.cameraPose.${encodeURIComponent(path)}`), LEVEL);
    expect(JSON.parse(pose ?? "null")?.position?.[1]).toBeGreaterThan(300);
    const level = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
    expect(level.landscapes?.length).toBe(1);

    // The same name again: the window asks first; No leaves the level as it is.
    await openWorldBuilder(page);
    await nextPreview(page, 0);
    await expect(panel.locator("[data-level-path]")).toHaveText(LEVEL);
    const levelBefore = await readFile(smokePublicPath(LEVEL), "utf8");
    const asked = page.waitForEvent("dialog");
    await page.getByTestId("random-world-create").click();
    const dialog = await asked;
    expect(dialog.message()).toContain("zaten var");
    await dialog.dismiss();
    await expect(panel).toHaveAttribute("data-create-state", "cancelled");
    expect(await readFile(smokePublicPath(LEVEL), "utf8")).toBe(levelBefore);

    // Yes rebuilds it (another seed, another world) and opens it again.
    await panel.locator("[data-roll]").click();
    page.once("dialog", (next) => void next.accept());
    const again = page.waitForEvent("load", { timeout: 120_000 });
    await page.getByTestId("random-world-create").click();
    await again;
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    expect(await readFile(smokePublicPath(LEVEL), "utf8")).not.toBe(levelBefore);

    expect(errors).toEqual([]);
  } finally {
    await rm(smokePublicPath(FOLDER), { recursive: true, force: true });
  }
});
