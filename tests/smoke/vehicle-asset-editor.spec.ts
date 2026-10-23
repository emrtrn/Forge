import { expect, test, type Locator } from "./test";
import sharp from "sharp";

/**
 * Vehicle plan Faz 5: the Vehicle asset editor opens from the Content Browser,
 * reads the Reference Car, edits it with undo, and saves what the form shows.
 *
 * The save endpoint is intercepted (and its payload asserted), so the committed
 * asset is never rewritten; the server half of `/__save-vehicle` is covered by
 * `vehicle.spec.ts` ("vehicle asset save endpoint …"). The second test drags
 * a wheel hard point in the Actor Script viewport, found by its cyan handle
 * pixels, and checks the edit lands in the asset rather than on the class.
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

/** Screen centroids of the cyan wheel hard-point handles in a viewport screenshot. */
async function wheelHandleCentroids(viewport: Locator): Promise<{ x: number; y: number }[]> {
  const box = (await viewport.boundingBox())!;
  const { data, info } = await sharp(await viewport.screenshot()).raw().toBuffer({ resolveWithObject: true });
  const clusters: { x: number; y: number; n: number }[] = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (!(data[i]! < 110 && data[i + 1]! > 170 && data[i + 2]! > 200)) continue;
      const cluster = clusters.find((c) => Math.hypot(c.x / c.n - x, c.y / c.n - y) < 12);
      if (cluster) {
        cluster.x += x;
        cluster.y += y;
        cluster.n += 1;
      } else {
        clusters.push({ x, y, n: 1 });
      }
    }
  }
  return clusters
    .filter((c) => c.n >= 6)
    .map((c) => ({ x: box.x + (c.x / c.n) * (box.width / info.width), y: box.y + (c.y / c.n) * (box.height / info.height) }));
}

test("Actor Script viewport drags a wheel hard point into the class's vehicle asset", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let savedActor: { actor?: { components: { component: string; props: Record<string, unknown> }[] } } | null = null;
  let savedVehicle: { path: string; vehicle: { wheels: { position: number[] }[] } } | null = null;
  await page.route("**/__save-actor", async (route) => {
    savedActor = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, json: { ok: true, changed: true } });
  });
  await page.route("**/__save-vehicle", async (route) => {
    savedVehicle = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, json: { ok: true, path: savedVehicle!.path, changed: true, dropped: [] } });
  });
  await page.route("**/__save-layout**", (route) => route.fulfill({ status: 200, json: { ok: true } }));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.getByRole("button", { name: "Gameplay", exact: true }).click();
  await drawer.getByRole("button", { name: "BP Script Reference Car.Actor Prefab" }).dblclick();

  // One handle per wheel of the referenced asset, drawn over the model.
  const viewport = page.locator("[data-as-viewport] canvas");
  await expect.poll(async () => (await wheelHandleCentroids(viewport)).length, { timeout: 20_000 }).toBe(4);
  const nearest = (await wheelHandleCentroids(viewport)).sort((a, b) => b.y - a.y)[0]!;
  await page.mouse.click(nearest.x, nearest.y);
  const status = page.locator("[data-as-status]");
  await expect(status).toContainText(/Wheel \d: drag to move its hard point\. Saved into .*ReferenceCar\.vehicle\.json/);

  // The Move gizmo sits on the handle; its centre moves freely in the view plane.
  await page.mouse.move(nearest.x, nearest.y);
  await page.mouse.move(nearest.x + 1, nearest.y + 1);
  await page.mouse.down();
  await page.mouse.move(nearest.x + 60, nearest.y - 10, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Control+s");
  await expect(status).toContainText("Wheel hard points saved to", { timeout: 10_000 });

  const original = [[0.68, 0.83, 1.056], [-0.68, 0.83, 1.056], [0.68, 0.83, -1.056], [-0.68, 0.83, -1.056]];
  const moved = savedVehicle!.vehicle.wheels.map((wheel) => wheel.position);
  expect(moved.filter((position, index) => JSON.stringify(position) !== JSON.stringify(original[index]))).toHaveLength(1);
  const vehicleProps = savedActor!.actor?.components.find((node) => node.component === "Vehicle")?.props;
  expect(vehicleProps).toEqual({ asset: "assets/starter-content/Gameplay/ReferenceCar.vehicle.json" });
  expect(errors).toEqual([]);
});
