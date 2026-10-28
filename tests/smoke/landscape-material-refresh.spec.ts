import { expect, test } from "./test";

test("material refresh reloads cached terrain layers even without mesh users", async ({ page }) => {
  await page.route("**/__material-refresh-probe", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body></body></html>",
  }));
  let color = "#554433";
  await page.route("**/__terrain-refresh.material.json", (route) => route.fulfill({
    json: { schema: 1, type: "material", materialType: "standard", name: "Refresh probe", baseColor: color },
  }));
  await page.goto("/__material-refresh-probe");
  await page.evaluate(async () => {
    const modulePath = "/src/scene/SceneApp.ts";
    const { SceneApp } = await import(modulePath);
    const app = Object.create(SceneApp.prototype);
    Object.assign(app, {
      layout: { instances: [], landscapes: [{ id: "terrain" }] },
      manifest: { assets: [{ id: "sand", name: "Sand", assetType: "material", path: "__terrain-refresh.material.json" }] },
      materialCache: new Map(), materialLoads: new Map(),
      landscapeLayerMaterialCache: new Map(),
      worldTerrains: new Map([["terrain", { def: { layers: [{ id: "sand-layer", material: "sand" }] } }]]),
      renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
      rebuildCount: 0,
      rebuildLandscapeObject() { this.rebuildCount++; },
    });
    await app.warmLandscapeLayerMaterials(0);
    (window as unknown as { materialRefreshProbe: typeof app }).materialRefreshProbe = app;
  });
  const read = () => page.evaluate(() => {
    const app = (window as unknown as { materialRefreshProbe: {
      landscapeLayerMaterialCache: Map<string, { baseColor: string }>; rebuildCount: number;
    } }).materialRefreshProbe;
    return { color: app.landscapeLayerMaterialCache.get("sand")?.baseColor, rebuilds: app.rebuildCount };
  });
  expect(await read()).toEqual({ color: "#554433", rebuilds: 1 });
  color = "#d8bb87";
  await page.evaluate(async () => {
    const app = (window as unknown as { materialRefreshProbe: { refreshMaterialAsset(id: string): Promise<void> } }).materialRefreshProbe;
    await app.refreshMaterialAsset("sand");
  });
  expect(await read()).toEqual({ color: "#d8bb87", rebuilds: 2 });
});
