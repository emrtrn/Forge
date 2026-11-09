import { expect, test } from "./test";
import type {} from "./pages/ocean-atlas";

test("ocean atlas: R32F band upload, all packed flags, exact heights, immutable binds and abort", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/tests/smoke/pages/ocean-atlas.html"); await page.waitForFunction(() => !!window.__oceanAtlas);
  const result = await page.evaluate(() => window.__oceanAtlas.probe());
  await info.attach("atlas-probe", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.samples).toBe(2097152); expect(result.mismatches).toBe(0); expect(result.uploadCalls).toBeGreaterThan(1);
  expect(result.repeatUploadCalls).toBe(0); expect(result.maxUploadBytes).toBeLessThanOrEqual(256 * 1024);
  expect(result.targetPreserved).toBe(true);
  expect(result.cancelled).toBe(true); expect(result.glError).toBe(0); expect(result.dimensions).toEqual([1025, 1153]);
  expect(errors).toEqual([]); await page.evaluate(() => window.__oceanAtlas.dispose());
});
