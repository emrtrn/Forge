import { expect, test } from "./test";
import sharp from "sharp";

for (const mode of ["editor", "play"]) {
  test(`Actor Script second point light illuminates a receiver in ${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/layouts/__playwright-smoke.level.json*", (route) => route.fulfill({ json: {
      schema: 1, name: "Actor lights", loadGroups: [], instances: [], characters: [],
      worldSettings: { backgroundColor: "#111111", ambientColor: "#000000" }, lights: [],
      actors: [{ classRef: "assets/__actor-lights.actor.json", position: [0, 0, 0] }],
    } }));
    await page.route("**/assets/__actor-lights.actor.json*", (route) => route.fulfill({ json: {
      schema: 1, type: "actor", name: "Two lamps", components: [
        { id: "root", component: "Transform", props: {} },
        { id: "spot", parent: "root", component: "Light", props: { type: "spot", position: [-2, 2, 0], intensity: 10, distance: 5 } },
        { id: "point", parent: "root", component: "Light", props: { type: "point", position: [2, 2, 0], intensity: 10, distance: 5 } },
      ],
    } }));
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(`/tests/smoke/pages/actor-lights.html${mode === "editor" ? "?editor" : ""}`);
    const toggle = page.getByRole("button", { name: "Point light off" });
    await expect(toggle).toBeEnabled({ timeout: 45_000 });
    const status = JSON.parse(await page.locator("output").innerText());
    expect(status).toEqual({ spots: 1, points: 1, pointPosition: [2, 2, 0] });
    const canvas = page.locator("canvas");
    const on = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer();
    await toggle.click();
    const off = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer();
    let brighterPixels = 0;
    for (let i = 0; i < on.length; i += 3) {
      if (on[i]! + on[i + 1]! + on[i + 2]! > off[i]! + off[i + 1]! + off[i + 2]! + 60) brighterPixels++;
    }
    expect(brighterPixels).toBeGreaterThan(500);
    await page.getByRole("button", { name: "Point light on" }).click();
    await expect(toggle).toBeVisible();
    expect(errors).toEqual([]);
  });
}
