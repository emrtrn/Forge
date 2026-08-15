import { expect, test } from "@playwright/test";

test("Content Drawer exposes file Cut/Copy and enables Paste after copying", async ({ page }) => {
  const sourceDir = "assets/starter-content/Materials";
  const sourcePath = `${sourceDir}/M_Concrete.material.json`;
  const contentList = page.locator("[data-content-list]");

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-content-toggle]").click();

  const sourceTreeRow = page.locator(`button.folder-row[title="${sourceDir}"]`);
  await expect(sourceTreeRow).toBeVisible({ timeout: 30_000 });
  await sourceTreeRow.dispatchEvent("click");
  // Breadcrumb buttons carry their full path as `title`; the last is the folder.
  await expect(page.locator("[data-content-path] .content-breadcrumb").last()).toHaveAttribute(
    "title",
    sourceDir,
  );

  const sourceCard = page.locator(`[data-asset-path="${sourcePath}"]`);
  await expect(sourceCard).toBeVisible();
  await sourceCard.dispatchEvent("contextmenu");
  await expect(page.getByRole("button", { name: "Cut", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Copy", exact: true }).click();

  await contentList.dispatchEvent("contextmenu");
  await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");

  await sourceCard.dispatchEvent("contextmenu");
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(sourceCard).toHaveClass(/is-cut/);
});
