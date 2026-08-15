import { expect, test } from "@playwright/test";

test.setTimeout(210_000);

test("editor Target Point smoke: add, inspect, edit, save, reload", async ({ page }) => {
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
  // Scope to the category submenu so the test remains independent of flat
  // search-result copies of the same actor action.
  const categories = page.locator("[data-add-categories]");
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Gameplay/ }).hover();
  await categories.getByRole("button", { name: "Target Point" }).click();
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Gameplay/ }).hover();
  await categories.getByRole("button", { name: "Target Point" }).click();

  await expect(page.getByTestId("outliner-row")).toHaveCount(rowCountBefore + 2);
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Target Point" }).first()).toBeVisible();
  await page.getByTestId("outliner-row").filter({ hasText: "Target Point" }).first().click();
  // The Details panel identifies the selection by its type-specific controls: the
  // shared chrome (`finalizeDetailsRender`) strips the `.detail-heading` each
  // renderer emits, so asserting on that heading only tested the chrome.
  await expect(
    page.locator('[data-inspector-pane="details"] [data-target-point-next]'),
  ).toBeVisible();
  await page.locator("[data-target-point-next]").selectOption("target-point-2");
  await expect(page.locator("[data-target-point-next]")).toHaveValue("target-point-2");

  await page.locator('[data-target-point-field="patrolTag"]').fill("outer");
  await page.locator('[data-target-point-field="patrolTag"]').dispatchEvent("change");
  await page.locator('[data-target-point-number="waitTime"]').fill("1.5");
  await page.locator('[data-target-point-number="waitTime"]').dispatchEvent("change");
  await page.locator('[data-target-point-number="acceptanceRadius"]').fill("0.75");
  await page.locator('[data-target-point-number="acceptanceRadius"]').dispatchEvent("change");

  await expect(page.locator('[data-target-point-field="patrolTag"]')).toHaveValue("outer");
  await expect(page.locator('[data-target-point-number="waitTime"]')).toHaveValue("1.5");
  await expect(page.locator('[data-target-point-number="acceptanceRadius"]')).toHaveValue("0.75");

  await expect(page.locator("[data-target-point-start]")).not.toBeChecked();
  await page.locator("[data-target-point-start]").check();
  await expect(page.locator("[data-target-point-start]")).toBeChecked();

  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });

  await page.goto(`/?editor&targetPointSmokeReload=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "Target Point" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("outliner-row").filter({ hasText: "Target Point" }).first().click();
  await expect(page.locator("[data-target-point-next]")).toHaveValue("target-point-2");
  await expect(page.locator('[data-target-point-field="patrolTag"]')).toHaveValue("outer");
  await expect(page.locator('[data-target-point-number="waitTime"]')).toHaveValue("1.5");
  await expect(page.locator('[data-target-point-number="acceptanceRadius"]')).toHaveValue("0.75");
  await expect(page.locator("[data-target-point-start]")).toBeChecked();

  expect(pageErrors).toEqual([]);
});
