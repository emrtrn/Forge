import { expect, test } from "./test";

test("editor authoring smoke: place, transform, undo, save, reload, play", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  const transformTools = page.locator(".editor-tools [data-tool]");
  await expect(transformTools).toHaveCount(4);
  const toolNames = ["select", "move", "rotate", "scale"] as const;
  for (const tool of toolNames) {
    const button = page.locator(`.editor-tools [data-tool="${tool}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    for (const otherTool of toolNames) {
      if (otherTool === tool) continue;
      await expect(page.locator(`.editor-tools [data-tool="${otherTool}"]`)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  }

  const rowCountBefore = await page.getByTestId("outliner-row").count();
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Shapes/ }).hover();
  await expect(page.getByTestId("add-shape-cube")).toBeVisible();
  await page.locator("#game-canvas").dispatchEvent("dragover", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    clientX: 420,
    clientY: 320,
  });
  await page.locator("#game-canvas").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData("application/x-3dgamedev-asset", "shape:cube");
      return data;
    }),
    clientX: 420,
    clientY: 320,
  });

  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore + 1);
  await expect(page.getByTestId("detail-px")).toBeVisible();

  const detailPxValue = () =>
    page.evaluate(() => {
      const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-testid="detail-px"]')];
      const input = inputs.find((candidate) => candidate.offsetParent !== null);
      if (!input) throw new Error("missing visible Location X input");
      return input.value;
    });

  const originalX = await detailPxValue();
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-testid="detail-px"]')];
    const input = inputs.find((candidate) => candidate.offsetParent !== null);
    if (!input) throw new Error("missing visible Location X input");
    input.value = "2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(detailPxValue).toBe("2");

  await page.getByTestId("editor-undo").click();
  await expect.poll(detailPxValue).toBe(originalX);

  await page.getByTestId("editor-undo").click();
  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore);

  await page.getByTestId("editor-redo").click();
  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore + 1);
  await page.getByTestId("editor-redo").click();
  await expect.poll(detailPxValue).toBe("2");
  expect(originalX).not.toBe("2");

  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });

  await page.goto(`/?editor&smokeReload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore + 1, {
    timeout: 30_000,
  });

  const [runtime] = await Promise.all([
    context.waitForEvent("page"),
    page.getByTestId("editor-play").click(),
  ]);
  await runtime.waitForLoadState("domcontentloaded");
  await expect(runtime.locator("#game-canvas")).toBeVisible();
  await expect(runtime.locator("#ui-overlay")).toBeVisible();
  await runtime.close();

  expect(pageErrors).toEqual([]);
});
