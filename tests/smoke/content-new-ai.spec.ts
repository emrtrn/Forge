import { expect, test } from "@playwright/test";

// Verifies the Content Browser "new content" menu exposes the AI asset kinds
// (Blackboard / Behavior Tree / EQS Query) wired to the `/__content-new` backend.
// Side-effect free: it only opens the create menu and asserts the entries — it
// never confirms creation, so no stub files are written and no cleanup is needed.
test("content browser create menu offers AI asset kinds", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  // Open the Content Browser drawer, then open the create menu on empty grid space.
  await page.locator("[data-content-toggle]").click();
  const contentList = page.locator("[data-content-list]");
  await expect(contentList).toBeVisible();
  await contentList.dispatchEvent("contextmenu");

  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  // The AI kinds moved under an "Artificial Intelligence" flyout, which opens on
  // hover — without it they are present in the DOM but hidden.
  await menu.getByText("Artificial Intelligence", { exact: true }).hover();
  await expect(menu.getByText("AI Blackboard", { exact: true })).toBeVisible();
  await expect(menu.getByText("AI Behavior Tree", { exact: true })).toBeVisible();
  await expect(menu.getByText("AI Query (EQS)", { exact: true })).toBeVisible();

  // Dismiss without creating anything.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
