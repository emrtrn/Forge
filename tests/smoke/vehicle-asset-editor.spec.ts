import { expect, test } from "@playwright/test";

/**
 * Vehicle plan Faz 5: the Vehicle asset editor opens from the Content Browser,
 * reads the Reference Car, edits it with undo, and saves what the form shows.
 *
 * The save endpoint is intercepted (and its payload asserted), so the committed
 * asset is never rewritten; the server half of `/__save-vehicle` is covered by
 * `vehicle.spec.ts` ("vehicle asset save endpoint …").
 */
test("vehicle asset editor edits the Reference Car with undo and saves the form's definition", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let saved: { path: string; vehicle: Record<string, any> } | null = null;
  await page.route("**/__save-vehicle", async (route) => {
    saved = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, json: { ok: true, path: saved!.path, changed: true, dropped: [] } });
  });
  await page.route("**/__save-layout**", (route) => route.fulfill({ status: 200, json: { ok: true } }));
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.getByRole("button", { name: "Gameplay", exact: true }).click();
  await drawer.getByRole("button", { name: /Reference Car File/ }).dblclick();

  const editor = page.locator("[data-vehicle-editor]");
  await expect(editor.locator("[data-vhe-status]")).toHaveText("Ready.", { timeout: 15_000 });
  await expect(editor.locator("[data-vhe-wheel]")).toHaveCount(4);
  await expect(editor.locator("[data-vhe-gear-speeds] tbody tr")).toHaveCount(5);
  await expect(editor.locator("[data-vhe-diag]")).toContainText("No problems found.");

  // The schematic selects a wheel: its card opens.
  await editor.locator('[data-vhe-wheel="2"]').click();
  await expect(editor.locator('[data-vhe-wheel-card="2"]')).toHaveAttribute("open", "");

  const mass = editor.locator('[data-path="massKg"]');
  await mass.fill("1500");
  await mass.press("Tab");
  await editor.locator('[data-vhe-op="add-gear"]').click();
  await expect(editor.locator("[data-vhe-gear-speeds] tbody tr")).toHaveCount(6);
  // Straight after a button that re-rendered the form: the shortcut still lands.
  await page.keyboard.press("Control+z");
  await expect(editor.locator("[data-vhe-gear-speeds] tbody tr")).toHaveCount(5);

  await editor.locator('[data-vhe-toggle="drivetrain"]').uncheck();
  await expect(editor.locator(".vhe-graph")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(editor.locator(".vhe-graph")).toHaveCount(1);

  await page.keyboard.press("Control+s");
  await expect(editor.locator("[data-vhe-status]")).toHaveText("Saved.");
  expect(saved!.path).toBe("assets/starter-content/Gameplay/ReferenceCar.vehicle.json");
  expect(saved!.vehicle.schema).toBe(1);
  expect(saved!.vehicle.type).toBe("vehicle");
  expect(saved!.vehicle.massKg).toBe(1500);
  expect(saved!.vehicle.drivetrain.transmission.forwardRatios).toHaveLength(5);
  expect(saved!.vehicle.wheels[0].visualNode).toBe("wheel-front-left");
  expect(errors).toEqual([]);
});
