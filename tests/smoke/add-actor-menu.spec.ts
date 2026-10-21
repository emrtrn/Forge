import { expect, test } from "./test";

test("Add Actor menu uses a flat hover-only category list", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".editor-topbar [title], .editor-topbar [data-tip]")).toHaveCount(0);

  const trigger = page.getByTestId("add-actor-button");
  const popover = page.locator("[data-add-actor-popover]");
  await expect(trigger).not.toHaveAttribute("title");
  await trigger.hover();
  await expect(popover).toBeVisible();

  await expect(popover.locator("[data-add-recent], .add-actor-section-title")).toHaveCount(0);
  const category = popover.getByRole("button", { name: /^Lights/ });
  await expect(category).toBeVisible();
  await expect(category).toHaveCSS("border-top-width", "0px");
  await expect(category).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const shapes = popover.getByRole("button", { name: /^Shapes/ });
  const volumes = popover.getByRole("button", { name: /^Volumes/ });
  expect(await shapes.locator("svg").innerHTML()).not.toBe(await volumes.locator("svg").innerHTML());

  await shapes.hover();
  const shapeRows = popover.locator('.add-actor-item[data-add-key^="shape:"]');
  await expect(shapeRows).toHaveCount(5);
  const shapeIcons = await shapeRows.locator("svg").evaluateAll((icons) =>
    icons.map((icon) => icon.innerHTML),
  );
  expect(new Set(shapeIcons).size).toBe(5);

  const gameplay = popover.getByRole("button", { name: /^Gameplay/ });
  await gameplay.hover();
  const targetPoint = popover.getByRole("button", { name: "Target Point" });
  const spline = popover.getByRole("button", { name: "Spline" });
  await expect(targetPoint).toBeVisible();
  await expect(spline).toBeVisible();
  expect(await targetPoint.locator("svg").innerHTML()).not.toBe(await spline.locator("svg").innerHTML());

  await page.mouse.move(900, 700);
  await expect(popover).toBeHidden();
});

test("Camera, view mode, and Show menus use flat rows", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  const cameraMenu = page.locator("[data-camera-popover]");
  await page.locator("[data-camera-button]").hover();
  await expect(cameraMenu).toBeVisible();
  await expect(cameraMenu.locator('[data-camera-view="perspective"]')).toHaveCSS(
    "border-top-width",
    "0px",
  );

  const viewModeMenu = page.locator("[data-viewmode-popover]");
  await page.locator("[data-viewmode-button]").hover();
  await expect(viewModeMenu).toBeVisible();
  await expect(viewModeMenu.locator('[data-view-mode="lit"]')).toHaveCSS(
    "border-top-width",
    "0px",
  );

  const showMenu = page.locator("[data-show-popover]");
  await page.locator("[data-show-button]").hover();
  await expect(showMenu).toBeVisible();
  await expect(showMenu.locator('[data-show-flag="collision"]')).toHaveCSS(
    "border-top-width",
    "0px",
  );
});

test("Add Actor Vehicles lists the project's vehicle classes and places one on click", async ({ page }) => {
  // Placing marks the layout dirty; never let the autosave write the smoke layout.
  await page.route("**/__save-layout**", (route) => route.fulfill({ status: 200, json: { ok: true } }));
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  const actorCount = async (): Promise<number> => {
    const text = (await page.getByText(/^\d+ actors/).first().textContent()) ?? "";
    return Number(text.match(/^(\d+)/)?.[1] ?? -1);
  };
  await expect.poll(actorCount, { timeout: 30_000 }).toBeGreaterThan(0);

  const popover = page.locator("[data-add-actor-popover]");
  await page.getByTestId("add-actor-button").hover();
  await popover.getByRole("button", { name: /^Vehicles/ }).hover();
  // Vehicles are project classes found by the Content Browser scan, not built-ins.
  const car = popover.locator(
    '[data-add-key="vehicle:assets/starter-content/Gameplay/Script_ReferenceCar.actor.json"]',
  );
  await expect(car).toBeVisible({ timeout: 30_000 });
  await expect(car).toHaveAttribute("draggable", "true");

  const before = await actorCount();
  await car.click();
  await expect.poll(actorCount).toBe(before + 1);
  await expect(page.locator("[data-actor-vehicle-section]")).toBeVisible();
  await page.getByRole("button", { name: "Undo Place Script_ReferenceCar" }).click();
  await expect.poll(actorCount).toBe(before);
});
