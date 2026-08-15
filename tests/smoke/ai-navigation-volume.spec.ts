import { expect, test } from "@playwright/test";

test("editor AI Navigation Volume smoke: add, inspect, show, save, reload", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  const rowCountBefore = await page.getByTestId("outliner-row").count();
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Volumes/ }).hover();
  await page.getByRole("button", { name: "AI Navigation Volume" }).click();

  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore + 1);
  await expect(page.getByTestId("outliner-row").filter({ hasText: "AI Navigation Volume" }).last()).toBeVisible();
  // Type-specific controls identify the selection; the shared Details chrome
  // (`finalizeDetailsRender`) strips the `.detail-heading` the renderer emits.
  await expect(page.locator('[data-inspector-pane="details"] [data-ai-nav-size="0"]')).toBeVisible();
  await expect(page.locator('[data-ai-nav-size="0"]')).toHaveValue("10");
  await expect(page.locator('[data-ai-nav-size="1"]')).toHaveValue("4");
  await expect(page.locator('[data-ai-nav-size="2"]')).toHaveValue("10");
  await expect(page.locator('[data-ai-nav-agent="agentRadius"]')).toHaveValue("0.35");
  await expect(page.locator('[data-ai-nav-agent="clearancePadding"]')).toHaveValue("0.1");

  await page.locator('[data-ai-nav-size="0"]').fill("12");
  await page.locator('[data-ai-nav-size="0"]').dispatchEvent("change");
  await expect(page.locator('[data-ai-nav-size="0"]')).toHaveValue("12");
  await page.locator('[data-ai-nav-agent="agentRadius"]').fill("0.6");
  await page.locator('[data-ai-nav-agent="agentRadius"]').dispatchEvent("change");
  await page.locator('[data-ai-nav-agent="clearancePadding"]').fill("0.25");
  await page.locator('[data-ai-nav-agent="clearancePadding"]').dispatchEvent("change");
  await expect(page.locator('[data-ai-nav-agent="agentRadius"]')).toHaveValue("0.6");
  await expect(page.locator('[data-ai-nav-agent="clearancePadding"]')).toHaveValue("0.25");

  await page.getByRole("button", { name: "Show" }).hover();
  const aiNavToggle = page.locator('[data-show-flag="ai-navigation"]');
  await aiNavToggle.click();
  await expect(aiNavToggle).toHaveClass(/active/);

  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });

  await page.goto(`/?editor&aiNavVolumeSmokeReload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  const savedVolumeRow = page.getByTestId("outliner-row").filter({ hasText: "AI Navigation Volume" }).last();
  await expect(savedVolumeRow).toBeVisible({
    timeout: 30_000,
  });
  await savedVolumeRow.click();
  await expect(page.locator('[data-ai-nav-size="0"]')).toHaveValue("12");
  await expect(page.locator('[data-ai-nav-agent="agentRadius"]')).toHaveValue("0.6");
  await expect(page.locator('[data-ai-nav-agent="clearancePadding"]')).toHaveValue("0.25");

  expect(pageErrors).toEqual([]);
});
