import { expect, test, type Locator, type Page } from "./test";

type Rect = { x: number; y: number; width: number; height: number };

function right(rect: Rect): number {
  return rect.x + rect.width;
}

function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

test("editor viewport panel owns the canvas and Stats across layout resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor&debug");

  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const host = page.locator("[data-viewport-host]");
  const canvas = page.locator("#game-canvas");
  const stats = page.locator("#debug-stats");
  const drawer = page.locator("[data-content-drawer]");
  const outliner = page.locator(".editor-outliner");
  const details = page.locator(".editor-details");

  await expect(host).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(stats).toBeVisible();
  await expect(stats).toContainText(/draw calls/, { timeout: 30_000 });
  await expect(stats).toHaveCSS("top", "8px");
  await expect(stats).toHaveCSS("left", "8px");
  await expect(host.locator("#game-canvas")).toHaveCount(1);
  await expect(host.locator("#debug-stats")).toHaveCount(1);

  const initial = await viewportRects({ host, canvas, stats, drawer, outliner, details });
  expect(initial.host.x).toBeGreaterThanOrEqual(right(initial.outliner) - 1);
  expect(right(initial.host)).toBeLessThanOrEqual(initial.details.x + 1);
  expect(bottom(initial.host)).toBeLessThanOrEqual(initial.drawer.y + 1);
  expect(initial.canvas.width).toBeCloseTo(initial.canvasClient.width, 0);
  expect(initial.canvas.height).toBeCloseTo(initial.canvasClient.height, 0);
  expect(initial.canvasBuffer.width / initial.canvasBuffer.height).toBeCloseTo(
    initial.canvasClient.width / initial.canvasClient.height,
    2,
  );
  expect(initial.stats.x).toBeGreaterThanOrEqual(initial.host.x);
  expect(initial.stats.y).toBeGreaterThanOrEqual(initial.host.y);
  expect(right(initial.stats)).toBeLessThanOrEqual(right(initial.host) + 1);
  expect(bottom(initial.stats)).toBeLessThanOrEqual(bottom(initial.host) + 1);

  await page.locator("[data-content-toggle]").click();
  await expect(page.getByTestId("forge-editor")).toHaveClass(/content-drawer-open/);
  await expect.poll(async () => (await host.boundingBox())?.height ?? 0).toBeLessThan(initial.host.height);

  const withDrawer = await viewportRects({ host, canvas, stats, drawer, outliner, details });
  expect(bottom(withDrawer.host)).toBeLessThanOrEqual(withDrawer.drawer.y + 1);
  expect(withDrawer.canvas.width).toBeCloseTo(withDrawer.canvasClient.width, 0);
  expect(withDrawer.canvas.height).toBeCloseTo(withDrawer.canvasClient.height, 0);
  expect(withDrawer.canvasBuffer.width / withDrawer.canvasBuffer.height).toBeCloseTo(
    withDrawer.canvasClient.width / withDrawer.canvasClient.height,
    2,
  );
  expect(withDrawer.stats.x).toBeGreaterThanOrEqual(withDrawer.host.x);
  expect(withDrawer.stats.y).toBeGreaterThanOrEqual(withDrawer.host.y);
  expect(right(withDrawer.stats)).toBeLessThanOrEqual(right(withDrawer.host) + 1);
  expect(bottom(withDrawer.stats)).toBeLessThanOrEqual(bottom(withDrawer.host) + 1);

  await page.setViewportSize({ width: 1440, height: 820 });
  await expect.poll(async () => (await host.boundingBox())?.width ?? 0).toBeLessThan(withDrawer.host.width);

  const resized = await viewportRects({ host, canvas, stats, drawer, outliner, details });
  expect(resized.canvas.width).toBeCloseTo(resized.canvasClient.width, 0);
  expect(resized.canvas.height).toBeCloseTo(resized.canvasClient.height, 0);
  expect(resized.canvasBuffer.width / resized.canvasBuffer.height).toBeCloseTo(
    resized.canvasClient.width / resized.canvasClient.height,
    2,
  );
  expect(bottom(resized.host)).toBeLessThanOrEqual(resized.drawer.y + 1);
  expect(right(resized.host)).toBeLessThanOrEqual(resized.details.x + 1);
  expect(right(resized.stats)).toBeLessThanOrEqual(right(resized.host) + 1);
  expect(bottom(resized.stats)).toBeLessThanOrEqual(bottom(resized.host) + 1);
});

test("viewport canvas keeps perspective and orthographic camera projections aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const canvas = page.locator("#game-canvas");
  const host = page.locator("[data-viewport-host]");
  const canvasBox = await requiredBox(canvas);

  const cameraButton = page.locator("[data-camera-button]");
  await cameraButton.hover();
  await page.locator('[data-camera-view="top"]').click();
  await expect(page.locator("[data-camera-label]")).toHaveText("Top");
  await expect(page.locator("[data-viewmode-label]")).toHaveText("Wireframe");
  await expectCanvasBufferAspect(canvas);

  await page.setViewportSize({ width: 1440, height: 820 });
  await expect.poll(async () => (await host.boundingBox())?.width ?? 0).toBeLessThan(canvasBox.width);
  await expectCanvasBufferAspect(canvas);

  await cameraButton.hover();
  await page.locator('[data-camera-view="perspective"]').click();
  await expect(page.locator("[data-camera-label]")).toHaveText("Perspective");
  await expect(page.locator("[data-viewmode-label]")).toHaveText("Lit");
  await expectCanvasBufferAspect(canvas);
});

test("viewport canvas accepts focused move and scale gizmo drags", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 120_000 });

  const canvas = page.locator("#game-canvas");
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 120_000 });
  const rowCount = await page.getByTestId("outliner-row").count();
  const canvasBox = await requiredBox(canvas);
  const drop = { x: canvasBox.x + canvasBox.width * 0.5, y: canvasBox.y + canvasBox.height * 0.55 };

  await canvas.dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData("application/x-3dgamedev-asset", "shape:cube");
      return data;
    }),
    clientX: drop.x,
    clientY: drop.y,
  });
  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCount + 1);
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("button", { name: "Move" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("KeyF");
  const centeredCanvas = await requiredBox(canvas);
  const handle = { x: centeredCanvas.x + centeredCanvas.width / 2, y: centeredCanvas.y + centeredCanvas.height / 2 };
  await page.mouse.move(handle.x, handle.y);
  await expect.poll(() => canvas.evaluate((element) => element.style.cursor)).toBe("pointer");

  const before = await transformPosition(page);
  await page.mouse.down();
  await page.mouse.move(handle.x + 72, handle.y - 48, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => transformPosition(page)).not.toEqual(before);

  await page.getByRole("button", { name: "Scale", exact: true }).click();
  await page.keyboard.press("KeyF");
  const scaledCanvas = await requiredBox(canvas);
  const scaleHandle = { x: scaledCanvas.x + scaledCanvas.width / 2, y: scaledCanvas.y + scaledCanvas.height / 2 };
  await page.mouse.move(scaleHandle.x, scaleHandle.y);
  await expect.poll(() => canvas.evaluate((element) => element.style.cursor)).toBe("pointer");

  const beforeScale = await transformScale(page);
  await page.mouse.down();
  await page.mouse.move(scaleHandle.x + 72, scaleHandle.y - 48, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => transformScale(page)).not.toEqual(beforeScale);

});

async function viewportRects(locators: {
  host: Locator;
  canvas: Locator;
  stats: Locator;
  drawer: Locator;
  outliner: Locator;
  details: Locator;
}): Promise<{
  host: Rect;
  canvas: Rect;
  canvasClient: { width: number; height: number };
  canvasBuffer: { width: number; height: number };
  stats: Rect;
  drawer: Rect;
  outliner: Rect;
  details: Rect;
}> {
  const [host, canvas, stats, drawer, outliner, details, canvasClient, canvasBuffer] = await Promise.all([
    requiredBox(locators.host),
    requiredBox(locators.canvas),
    requiredBox(locators.stats),
    requiredBox(locators.drawer),
    requiredBox(locators.outliner),
    requiredBox(locators.details),
    locators.canvas.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    })),
    locators.canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected the viewport canvas");
      return { width: element.width, height: element.height };
    }),
  ]);
  return { host, canvas, canvasClient, canvasBuffer, stats, drawer, outliner, details };
}

async function requiredBox(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Expected ${await locator.evaluate((element) => element.id || element.className)} to have a layout box`);
  return box;
}

async function expectCanvasBufferAspect(canvas: Locator): Promise<void> {
  await expect.poll(() => canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected the viewport canvas");
    const clientAspect = element.clientWidth / element.clientHeight;
    const bufferAspect = element.width / element.height;
    return Math.abs(bufferAspect - clientAspect) < 0.01;
  })).toBe(true);
}

async function transformPosition(page: Page): Promise<string[]> {
  const values = await transformValues(page);
  return values.slice(0, 3);
}

async function transformScale(page: Page): Promise<string[]> {
  const values = await transformValues(page);
  return values.slice(6, 9);
}

async function transformValues(page: Page): Promise<string[]> {
  return page.locator(".detail-section", { hasText: "Transform" }).first().locator('input[type="number"]').evaluateAll(
    (inputs) => inputs.map((input) => (input as HTMLInputElement).value),
  );
}
