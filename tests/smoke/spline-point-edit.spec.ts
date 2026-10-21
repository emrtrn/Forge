import { expect, test } from "./test";

test("editor exposes generic Spline Actor point editing controls", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?editor&splinePointSmoke=1");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const details = page.locator('[data-inspector-pane="details"]');
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: "Gameplay" }).hover();
  await page.locator('[data-add-categories] [data-add-key="spline"]').click();
  await expect(details.getByRole("heading", { name: "Spline" })).toBeVisible();
  const pointButtons = details.locator("[data-spline-point]");
  const initialCount = await pointButtons.count();
  expect(initialCount).toBeGreaterThanOrEqual(2);
  await details.locator("[data-spline-show-point-ids]").check();
  await expect(details.locator("[data-spline-show-point-ids]")).toBeChecked();

  await details.locator("[data-spline-point-add]").click();
  await expect(pointButtons).toHaveCount(initialCount + 1);
  await details.locator("[data-spline-point-type]").selectOption("curveCustom");
  await expect(details.locator("[data-spline-point-type]")).toHaveValue("curveCustom");
  await expect(details.locator("[data-spline-tangents-linked]")).toBeChecked();
  await details.locator("[data-spline-tangents-linked]").uncheck();
  await expect(details.locator("[data-spline-tangents-linked]")).not.toBeChecked();
  await details.locator("[data-spline-split]").first().click();
  await expect(pointButtons).toHaveCount(initialCount + 2);

  await details.locator("[data-spline-rigid-generator-add]").click();
  const rigidCard = details.locator('[data-spline-generator-card="rigid-segments"]');
  await expect(rigidCard).toBeVisible();
  await expect(details.getByText("Path settings")).toBeVisible();
  await expect(details.getByText("Control points", { exact: true })).toBeVisible();
  await expect(rigidCard.locator('[data-spline-rigid-number="segmentLength"]')).toHaveValue("2");

  expect(pageErrors).toEqual([]);
});
