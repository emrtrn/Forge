import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { REPO_ROOT, smokePublicPath } from "./smokeProject.mjs";
import { expect, test, type APIRequestContext, type Page } from "./test";
import { expectNoSidewaysOverflow, openWorldBuilder } from "./worldBuilder";

/**
 * World Builder window (RANDOM_WORLD_PLAN step 5): Add Actor → Terrain →
 * World Builder… opens the random world choices with a bird's-eye preview that
 * follows them. The world is built into the open level: a level outside
 * `assets/` cannot take one (Create is off and the window says why); in an
 * assets level Create asks first (No leaves the level as it is), then builds
 * through `/__world-random`, shows its progress and reloads the level looking
 * over it. A second level gets a world of its own and the first keeps its.
 */
const FOLDER = "assets/playwright-random";
const FIRST = `${FOLDER}/First.level.json`;
const SECOND = `${FOLDER}/Second.level.json`;

/** An empty level under assets/, opened in the editor. */
async function openNewLevel(page: Page, request: APIRequestContext, path: string): Promise<void> {
  const base = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  await mkdir(smokePublicPath(FOLDER), { recursive: true });
  await writeFile(smokePublicPath(path), JSON.stringify({ ...base, name: path.split("/").pop()!.replace(".level.json", "") }, null, 2));
  expect((await request.post("/__open-level", { data: { path } })).ok()).toBeTruthy();
  await page.goto(`/?editor&wbRandom=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
}

/** Create in the open World Builder window, Yes to its question, until the editor has reloaded. */
async function createWorld(page: Page, path: string): Promise<void> {
  const reloaded = page.waitForEvent("load", { timeout: 120_000 });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(path);
    void dialog.accept();
  });
  await page.getByTestId("random-world-create").click();
  await expect(page.getByTestId("random-world-progress")).toBeVisible();
  await reloaded;
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
}

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

test("World Builder window: random world choices, live preview, Create builds into the open level", async ({ page, request }) => {
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

    // Nothing spills sideways, also in a narrow browser window (the preview goes under the choices).
    await expectNoSidewaysOverflow(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await expectNoSidewaysOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });

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

    // The smoke level lives under layouts/: no world can be built into it, and the window says why.
    await expect(page.getByTestId("random-world-level")).toContainText("layouts/");
    await expect(page.getByTestId("random-world-create")).toBeDisabled();
    await expect(page.getByTestId("random-world-target-problem")).toContainText("public/assets altında değil");

    // An empty level under assets/: the window names it; No to the question leaves it as it is.
    await panel.locator('[data-choice="size"] button[data-value="small"]').click();
    await openNewLevel(page, request, FIRST);
    await openWorldBuilder(page);
    await nextPreview(page, 0);
    await expect(page.getByTestId("random-world-level")).toHaveText(FIRST);
    await expect(page.getByTestId("random-world-target-problem")).toBeHidden();
    const empty = await readFile(smokePublicPath(FIRST), "utf8");
    // The question opens inside the click, so it is answered by a handler set up before it.
    let question = "";
    page.once("dialog", (dialog) => {
      question = dialog.message();
      void dialog.dismiss();
    });
    await page.getByTestId("random-world-create").click();
    expect(question).toContain("yerini alacak");
    await expect(panel).toHaveAttribute("data-create-state", "cancelled");
    expect(await readFile(smokePublicPath(FIRST), "utf8")).toBe(empty);

    // Yes: the world is built into that level, which reloads looking over it.
    await createWorld(page, FIRST);
    const project = JSON.parse(await readFile(smokePublicPath("project.3dgame.json"), "utf8"));
    expect(project.editor.defaultScene).toBe(FIRST);
    const firstLevel = await readFile(smokePublicPath(FIRST), "utf8");
    expect(JSON.parse(firstLevel).landscapes?.length).toBe(1);
    expect(await exists(`${FOLDER}/First.worldbrief.json`)).toBe(true);
    const pose = await page.evaluate((path) => localStorage.getItem(`forge.editor.cameraPose.${encodeURIComponent(path)}`), FIRST);
    expect(JSON.parse(pose ?? "null")?.position?.[1]).toBeGreaterThan(300);

    // A second level gets a world of its own; the first keeps its.
    await openNewLevel(page, request, SECOND);
    await openWorldBuilder(page);
    await nextPreview(page, 0);
    await expect(page.getByTestId("random-world-level")).toHaveText(SECOND);
    await panel.locator("[data-roll]").click();
    await createWorld(page, SECOND);
    expect(JSON.parse(await readFile(smokePublicPath(SECOND), "utf8")).landscapes?.length).toBe(1);
    expect(await readFile(smokePublicPath(FIRST), "utf8")).toBe(firstLevel);

    expect(errors).toEqual([]);
  } finally {
    await rm(smokePublicPath(FOLDER), { recursive: true, force: true });
  }
});
