import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { PerspectiveCamera } from "three";
import { createLakeFixture } from "../engine/fixtures/lakeFixture";
import { createLakeBedFixture } from "../engine/fixtures/lakeBedFixture";
import { terrainGlobalMapPath, terrainTilePath, createFlatTerrainTile, tileKey } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page, type APIRequestContext } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { defaultUserSettings } from "../../engine/persistence/userSettingsStore";
import { SHAPE_PRIMITIVE_SIZE } from "../../engine/scene/shapes";

const LEVEL = "layouts/__playwright-lake-world.level.json", TERRAIN = "landscapes/__playwright-lake-world.terrain.json";
const snapshot = (page: Page) => page.evaluate(() => (window as any).__lakeQA.snapshot());
async function clickWorld(page: Page, point: number[]) {
  const p = await page.evaluate((p) => (window as any).__lakeQA.project(...p), point);
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  expect(p.x).toBeGreaterThan(viewport.x); expect(p.x).toBeLessThan(viewport.x + viewport.width);
  expect(p.y).toBeGreaterThan(viewport.y); expect(p.y).toBeLessThan(viewport.y + viewport.height);
  await page.mouse.click(p.x, p.y);
}
async function expandLake(page: Page, id = "advanced") {
  const section = page.locator(`[data-detail-section="lake-${id}"]`);
  if (await section.evaluate((e) => e.classList.contains("collapsed"))) await section.locator(".detail-section-toggle").click();
}
async function number(page: Page, key: string, value: number) {
  if (["minX", "minZ", "maxX", "maxZ", "width", "length", "seedX", "seedZ"].includes(key)) await expandLake(page);
  const field = page.locator(`[data-lake-number="${key}"]`); await field.fill(String(value)); await field.press("Tab");
}
async function setup(page: Page, request: APIRequestContext, seeded = false, streamed = false, bed = false, foreground = false, waterSystem = false, caustics = false, steep = false, wavePasses = false, foamRocks = false, qualityCase = false, riverSlope = false) {
  const doc = createLakeFixture();
  if (steep) for (const entry of doc.def.tiles) entry.maxHeight = 18;
  if (steep) for (const tile of doc.tiles.values()) {
    for (let i = 0; i < tile.heights.length; i++) tile.heights[i] = Math.max(0, 2 + (tile.heights[i]! - 2) * 4);
  }
  if (caustics) {
    doc.def.layers[0]!.material = "m-shallow-water-bed";
    doc.lake.appearance = { causticsEnabled: true, causticsStrength: 1.5, causticsScale: 1.5, causticsDepthFade: 6 };
  }
  if (qualityCase) doc.lake.appearance = { ...doc.lake.appearance, foamEnabled: true, shoreWetnessEnabled: true,
    reflectionMode: "sharedPlanar", reflectionQuality: "high", reflectionGroup: "quality" };
  if (waterSystem) doc.def.splines = [{ id: "water-path", coordinateSpace: "world", points: [
    { id: "a", position: [-20, 12, -12], width: 4, falloff: 2 },
    { id: "b", position: [20, 12, -12], width: 4, falloff: 2 },
  ], segments: [{ id: "ab", startPointId: "a", endPointId: "b" }] }];
  if(riverSlope&&doc.def.splines)doc.def.splines[0]!.points[1]!.position[1]=10;
  if (bed) doc.lake.bed = createLakeBedFixture().lake.bed!;
  if (streamed) {
    const original = new Map(doc.tiles); doc.def.tilesX = 12; doc.def.tilesZ = 4; doc.def.tiles = []; doc.tiles.clear();
    for (let z = 0; z < 4; z++) for (let x = 0; x < 12; x++) {
      const source = original.get(tileKey(x - 6, z)), tile = source ? { ...source, x, z } : createFlatTerrainTile(doc.def, x, z);
      if (!source) tile.heights.fill(6);
      const key = tileKey(x, z); doc.tiles.set(key, tile); doc.def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
    }
    doc.lake.seed[0] += 384; doc.lake.bounds.min[0] += 384; doc.lake.bounds.max[0] += 384;
    if (doc.lake.bed) for (const point of doc.lake.bed.points) point[0] += 384;
  }
  const write = async (path: string, data: string | Uint8Array) => { const p = smokePublicPath(path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data); };
  for (const [key, tile] of doc.tiles) await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  await write(TERRAIN, JSON.stringify(doc.def));
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(doc.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(doc.def, doc.tiles))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  if (wavePasses) level.postProcess = { ...level.postProcess, ao: { enabled: true, radius: 1, intensity: 1 }, dof: { enabled: true, focusDistance: 30, aperture: .01, maxBlur: .01 } };
  level.instances = level.instances.filter((g: { assetId: string }) => g.assetId === "marker:playerStart");
  level.instances[0].placements[0].position = [-20, 15, -12];
  if (foreground || caustics) level.instances.push({ assetId: "shape:cube", placements: [{ name: "Lake foreground cube", position: [-12, 17, -12], scale: [4, 4, 4] }] });
  if (caustics) { level.lights[0].castShadow = true; level.lights[0].cascadedShadows = true; }
  level.landscapes = [{ id: "terrain", name: "Lake QA Terrain", position: worldTerrainActorPosition(doc.def), dataRef: TERRAIN }];
  if(foamRocks) level.instances.push({assetId:"shape:cube",placements:[
    {name:"Foam Rock A",position:[-20,12,-12],scale:[4,4,4]},
    {name:"Foam Rock B",position:[-12,12,-18],scale:[6,3,2],rotation:[0,30,0]},
  ]});
  level.riverWaters = []; level.waterBodies = seeded ? [doc.lake] : [];
  level.actors = []; level.characters = [];
  await write(LEVEL, JSON.stringify(level)); expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  const camera = new PerspectiveCamera(); camera.position.set(0, 90, 85); camera.lookAt(0, 10, 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = defaultUserSettings();
  // These feature regressions inspect authored effects at Ultra. Quality changes
  // made through the UI must survive Reload/Play rather than being reset by QA.
  const preferences = JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), payload: { ...settings,
    graphics: { ...settings.graphics, selectedQualityLevel: "ultra", manuallySelected: true, adaptiveOptimizationEnabled: false } } });
  await page.addInitScript(({ key, pose, preferences }) => {
    if (!localStorage.getItem("forge.userSettings")) localStorage.setItem("forge.userSettings", preferences);
    localStorage.setItem(key, pose);
  }, {
    key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }),
    preferences,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/__project-dir/assets", (route) => route.fulfill({ json: { root: "assets", children: [] } }));
  await page.goto("/tests/smoke/pages/terrain-lake-editor.html?editor", { waitUntil: "domcontentloaded", timeout: caustics ? 180_000 : 90_000 });
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Lake QA Terrain" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("water");
  return { doc, errors };
}
async function terrainHash() {
  const hash = createHash("sha256"); hash.update(await readFile(smokePublicPath(TERRAIN)));
  for (const key of ["0_0", "1_0", "0_1", "1_1"]) hash.update(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));
  return hash.digest("hex");
}
async function ready(page: Page, timeout = 60_000) { await expect.poll(async () => (await snapshot(page)).results[0]?.status, { timeout }).toBe("ready"); }
async function save(page: Page) {
  const button = page.getByTestId("editor-save"); await expect(button).toBeEnabled({ timeout: 120_000 });
  const response = page.waitForResponse((r) => r.request().method()==="POST"&&(r.url().endsWith("/__save-layout")||(r.url().includes("/__save-lake-foam?")&&r.status()>=400)), { timeout: 120_000 });
  await button.click(); const saved=await response;expect(saved.ok(),await saved.text()).toBeTruthy(); await expect(button).toBeEnabled({ timeout: 120_000 });
}

test("Lake quality menu releases effects, preserves geometry and authored settings, and updates live Play", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true, false, false, false, true);
  await ready(page);
  const quality = (p: Page) => p.evaluate(() => (window as any).__lakeQA.quality());
  const before = await quality(page), terrainBefore = await terrainHash();
  const geometry = before.objects[0].geometry, authored = before.source;
  type Level = "Low" | "Medium" | "High" | "Ultra";
  const pick = async (label: Level) => {
    await page.getByTestId("quality-button").hover();
    await page.locator("[data-quality-popover] button", { hasText: label }).click();
    await expect(page.locator("[data-quality-label]")).toHaveText(label);
  };
  const verify = async (p: Page, level: Level) => {
    const [caustics, wetShore, foam, reflection, rippleCount] = {
      Low: [0, 0, false, 0, 8], Medium: [0, 1, true, 0, 12], High: [1, 1, true, 256, 24], Ultra: [1, 1, true, 512, 24],
    }[level]!;
    await expect.poll(async () => {
      const s = await quality(p);
      return { caustics: s.caustics, wetShore: s.wetShore, foam: s.objects[0]?.foam, reflection: s.objects[0]?.reflection, errors: s.errors };
    }, { timeout: 45_000 }).toEqual({ caustics, wetShore, foam, reflection, errors: [] });
    const s = await quality(p); expect(s.glError).toBe(0); expect(s.source).toEqual(authored);
    expect(s.objects[0]).toMatchObject({ normal: true, waveHeight: before.objects[0].waveHeight, shoreBlend: before.objects[0].shoreBlend,
      surfaceStrength: before.objects[0].surfaceStrength });
    // Read the cap synchronously, before the next real physics step ages the QA waves.
    expect(await p.evaluate(() => (window as any).__lakeQA.qualityRipples())).toEqual([rippleCount]);
    return s;
  };
  const records = [];
  for (const level of ["Ultra", "Low", "Medium", "High", "Ultra", "Low"] as const) {
    await pick(level); const s = await verify(page, level);
    expect(s.objects[0].geometry).toBe(geometry); records.push({ level, ...s });
    await page.screenshot({ path: info.outputPath(`lake-quality-editor-${level.toLowerCase()}.png`) });
  }
  await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance).toEqual(authored[0].appearance);
  expect(await terrainHash()).toBe(terrainBefore);
  const play = await page.context().newPage();
  const resume = async () => {
    const button = play.getByRole("button", { name: "Resume", exact: true });
    if (await button.isVisible()) await button.click();
  };
  play.on("pageerror", e => errors.push(e.message));
  play.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await play.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await play.waitForFunction(() => !!(window as any).__lakeQA, null, { timeout: 120_000 });
  await resume();
  await verify(play, "Low"); const runtimeGeometry = (await quality(play)).objects[0].geometry;
  for (const level of ["Medium", "High", "Ultra", "Low"] as const) {
    await page.bringToFront(); await pick(level); await play.bringToFront();
    await resume();
    const s = await verify(play, level); expect(s.objects[0].geometry).toBe(runtimeGeometry);
    records.push({ level: `Play ${level}`, ...s });
    await play.screenshot({ path: info.outputPath(`lake-quality-runtime-${level.toLowerCase()}.png`) });
  }
  await play.reload({ waitUntil: "domcontentloaded" });
  await play.waitForFunction(() => !!(window as any).__lakeQA, null, { timeout: 120_000 });
  await resume();
  await verify(play, "Low"); expect(errors).toEqual([]);
  await writeFile(info.outputPath("lake-quality.json"), JSON.stringify({ records, errors, authoredPreserved: true, terrainPreserved: true }, null, 2));
});

test("Lake geometry foam Calculate Recalculate undo and binary Save Reload Play",async({page,request},info)=>{
  test.setTimeout(300_000);
  const {errors}=await setup(page,request,true,false,false,false,false,false,false,false,true);
  const before=await terrainHash();await ready(page);await page.locator('[data-object-id="lake:0"]').click();
  const section=page.locator('[data-detail-section="lake-geometry-foam"]');
  if(await section.evaluate(e=>e.classList.contains("collapsed")))await section.locator('.detail-section-toggle').click();
  const calculate=page.locator('[data-geometry-foam-calculate]');
  await expect(calculate).toHaveText("Calculate");
  await expect(calculate).toHaveAttribute("title",/hesaplar/);
  let reject=true;
  await page.route("**/__save-lake-foam?*",route=>reject?route.fulfill({status:503,body:"test save retry"}):route.continue());
  await calculate.click();
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active,{timeout:90_000}).toBe(true);
  const original=(await snapshot(page)).source.geometryFoam.bake.manifest;
  await expect(calculate).toHaveText("Recalculate");
  const failed=page.waitForResponse(r=>r.url().includes("/__save-lake-foam?")&&r.status()===503);
  await page.getByTestId("editor-save").click();await failed;
  const failedLevel=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8"));
  expect(failedLevel.waterBodies[0].geometryFoam?.bake).toBeUndefined();
  reject=false;await save(page);
  const settings=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8")).waterBodies[0].geometryFoam;
  const manifest=JSON.parse(await readFile(smokePublicPath(settings.bake.manifest),"utf8"));
  const bytes=await readFile(smokePublicPath(manifest.dataPath));
  expect(manifest.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));expect(manifest.metadata.sources).toBe(2);
  const invalid=await request.post(`/__save-lake-foam?level=${encodeURIComponent(LEVEL)}&hash=${"a".repeat(64)}`,{data:bytes,headers:{"Content-Type":"application/octet-stream"}});expect(invalid.status()).toBe(400);
  await page.getByTestId("outliner-row").filter({hasText:"Foam Rock A"}).first().click();
  await page.getByTestId("detail-px").fill("-16");await page.getByTestId("detail-px").press("Tab");
  await page.locator('[data-object-id="lake:0"]').click();
  await expect(page.locator('[data-geometry-foam-status]')).toContainText("Recalculation required");
  expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(original);
  await calculate.click();
  await expect.poll(async()=>(await snapshot(page)).source.geometryFoam.bake.manifest,{timeout:90_000}).not.toBe(original);
  const updated=(await snapshot(page)).source.geometryFoam.bake.manifest;
  await page.getByTestId("editor-undo").click();await ready(page);
  expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(original);
  await page.getByTestId("editor-redo").click();await ready(page);
  expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(updated);
  await page.locator('[data-geometry-foam-clear]').click();await ready(page);
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(false);
  await page.getByTestId("editor-undo").click();await ready(page);
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);
  await save(page);await page.screenshot({path:info.outputPath("geometry-foam-editor.png")});
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);
  expect(await terrainHash()).toBe(before);
  let writes=0;page.on("request",r=>{if(r.url().includes("/__save-lake-foam"))writes++;});
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html",{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);expect(writes).toBe(0);
  await page.evaluate(()=>(window as any).__lakeQA.frame());await page.screenshot({path:info.outputPath("geometry-foam-runtime.png")});
  expect(errors.filter(error=>!error.includes("status of 503"))).toEqual([]);
});

test("River automatic geometry foam and caustics UI Save Reload Play; manual controls retired",async({page,request},info)=>{
  test.setTimeout(300_000);
  const {errors}=await setup(page,request,true,false,false,false,true,false,false,false,true,false,true);await ready(page);
  const before=await terrainHash();
  await page.evaluate(()=>(window as any).__lakeQA.holdRiverPreparation());
  await page.locator('[data-river-water-create]').click();
  await expect(page.locator('[data-contact-add]')).toHaveCount(0);await expect(page.locator('[data-river-water-foam-add]')).toHaveCount(0);
  const section=page.locator('[data-detail-section="lake-geometry-foam"]');
  const expand=async(locator:ReturnType<Page["locator"]>)=>{if(await locator.evaluate(e=>e.classList.contains("collapsed")))await locator.locator('.detail-section-toggle').click();};
  await expand(section);
  await expect.poll(()=>page.evaluate(()=>(window as any).__lakeQA.riverPreparationPending())).toBe(true);
  await expect(page.locator('[data-geometry-foam-calculate]')).toBeDisabled();
  await expect(page.locator('[data-geometry-foam-status]')).toHaveText('Preparing water surface');
  await page.evaluate(()=>(window as any).__lakeQA.releaseRiverPreparation());
  await expect(page.locator('[data-geometry-foam-calculate]')).toBeEnabled();
  await page.locator('[data-geometry-foam-calculate]').click();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active,{timeout:90_000}).toBe(true);
  const original=(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest;
  expect((await snapshot(page)).riverState[0].stale).toBe(false);
  await expect(page.locator('[data-geometry-foam-calculate]')).toHaveText("Recalculate");
  await expand(page.locator('[data-detail-section="river-caustics"]'));
  await page.getByRole('checkbox',{name:'River Caustics Enabled'}).check();
  await expect.poll(async()=>(await snapshot(page)).riverSource[0].caustics?.enabled).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  expect((await snapshot(page)).riverState[0].stale).toBe(false);
  await save(page);
  const level=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8")),manifest=JSON.parse(await readFile(smokePublicPath(original),"utf8"));
  expect(manifest.metadata.surface).toBe("river");expect(manifest.metadata.segments).toBeGreaterThan(0);expect(level.riverWaters[0].caustics.enabled).toBe(true);
  const binaryPath=smokePublicPath(manifest.dataPath),modified=(await stat(binaryPath)).mtimeMs,bytes=await readFile(binaryPath);
  const again=await request.post(`/__save-lake-foam?level=${encodeURIComponent(LEVEL)}&hash=${manifest.sha256}`,{data:bytes,headers:{"Content-Type":"application/octet-stream"}});
  expect(again.ok()).toBe(true);expect((await stat(binaryPath)).mtimeMs,"identical artifacts are reused without Windows rename").toBe(modified);
  await page.locator('[data-geometry-foam-clear]').click();await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(false);
  await page.getByTestId("editor-undo").click();await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  await save(page);await page.screenshot({path:info.outputPath("river-automatic-editor.png")});
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);expect(await terrainHash()).toBe(before);
  let writes=0;page.on("request",r=>{if(r.url().includes("/__save-lake-foam"))writes++;});
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html",{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);expect(writes).toBe(0);
  expect((await snapshot(page)).riverBaked[0].manual).toBe(0);
  const off=await page.evaluate(()=>(window as any).__lakeQA.causticsFrame(false,0));
  const capture=await page.evaluate(()=>(window as any).__lakeQA.causticsFrame(true,0));
  const moved=await page.evaluate(()=>(window as any).__lakeQA.causticsFrame(true,3));
  expect(capture.glError).toBe(0);expect(capture.count).toBeGreaterThan(0);
  expect(capture.samples.filter((v:number,i:number)=>Math.abs(v-off.samples[i])>3).length).toBeGreaterThan(30);
  expect(moved.samples.filter((v:number,i:number)=>Math.abs(v-capture.samples[i])>3).length).toBeGreaterThan(30);
  await page.screenshot({path:info.outputPath("river-automatic-runtime.png")});expect(errors).toEqual([]);
});

test("River obstacle foam Recalculate follows moved rocks after reopening the Water panel",async({page,request},info)=>{
  test.setTimeout(180_000);
  const {errors}=await setup(page,request,true,false,false,false,true,false,false,false,true,false,true);await ready(page);
  const terrainBefore=await terrainHash();
  const expand=async()=>{
    const section=page.locator('[data-detail-section="lake-geometry-foam"]');
    if(await section.evaluate(e=>e.classList.contains("collapsed")))await section.locator('.detail-section-toggle').click();
  };
  await page.locator('[data-river-water-create]').click();await expand();
  const calculate=page.locator('[data-geometry-foam-calculate]');
  await expect(calculate).toBeEnabled();await calculate.click();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  const original=(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest;
  const points=[[-20+SHAPE_PRIMITIVE_SIZE*2+.2,-12],[-16+SHAPE_PRIMITIVE_SIZE*2+.2,-12]];
  const mask=()=>page.evaluate(points=>(window as any).__lakeQA.riverFoamSamples(points),points);
  expect((await mask())[0]).toBeLessThan(200);expect((await mask())[1]).toBe(255);
  await save(page);
  // Reload restores an existing river without a transient activeRiverWaterId.
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await page.getByTestId("outliner-row").filter({hasText:"Foam Rock A"}).first().click();
  await page.getByTestId("detail-px").fill("-16");await page.getByTestId("detail-px").press("Tab");
  await page.getByTestId("outliner-row").filter({hasText:"Lake QA Terrain"}).first().click();
  await page.locator('[data-landscape-mode]').selectOption("water");await expand();
  await expect(page.locator('[data-geometry-foam-status]')).toContainText("Recalculation required");
  await expect(calculate).toHaveText("Recalculate");await expect(calculate).toBeEnabled();await calculate.click();
  await expect.poll(async()=>(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest,{timeout:15_000}).not.toBe(original);
  await expect.poll(async()=>(await snapshot(page)).riverState[0].stale).toBe(false);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  expect(await mask()).toEqual([255,expect.any(Number)]);expect((await mask())[1]).toBeLessThan(200);
  const updated=(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest;
  await page.getByTestId("editor-undo").click();
  await expect.poll(async()=>(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest).toBe(original);
  await page.getByTestId("editor-redo").click();
  await expect.poll(async()=>(await snapshot(page)).riverSource[0].geometryFoam.bake.manifest).toBe(updated);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  await page.locator('[data-geometry-foam-clear]').click();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(false);
  await page.getByTestId("editor-undo").click();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  await save(page);
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  expect((await mask())[0]).toBe(255);expect((await mask())[1]).toBeLessThan(200);
  await page.screenshot({path:info.outputPath("river-recalculated-after-move.png")});
  expect(await terrainHash()).toBe(terrainBefore);expect(errors).toEqual([]);
});

test("River Wet Shore follows slope and survives settings undo Save Reload Play and quality changes",async({page,request},info)=>{
  test.setTimeout(240_000);
  const {errors}=await setup(page,request,true,false,false,false,true,false,false,false,false,false,true);await ready(page);
  const before=await terrainHash();await page.locator('[data-river-water-create]').click();
  const expand=async(key:string)=>{const section=page.locator(`[data-detail-section="${key}"]`);if(await section.evaluate(e=>e.classList.contains("collapsed")))await section.locator('.detail-section-toggle').click();};
  await expand("river-surface");
  const width=page.locator('[data-river-water-number="widthScale"]');await width.fill("10");await width.press("Tab");
  await expect.poll(async()=>(await snapshot(page)).riverState[0]?.ready).toBe(true);
  await expand("river-wet-shore");
  const toggle=page.getByRole("checkbox",{name:"River Wet Shore Enabled"});await expect(toggle).not.toBeChecked();await toggle.check();
  await expect.poll(async()=>(await snapshot(page)).riverSource[0].shoreWetness?.enabled).toBe(true);
  const field=page.locator('[data-river-wet-shore-number="width"]');await field.fill("1.5");await field.press("Tab");
  await expect.poll(async()=>(await snapshot(page)).riverState[0]?.ready).toBe(true);
  const frame=(wet:boolean)=>page.evaluate(wet=>(window as any).__lakeQA.causticsFrame(false,0,true,false,false,false,false,0,true,false,wet),wet);
  const off=await frame(false),on=await frame(true);
  expect(on.glError).toBe(0);expect(on.wetShoreActive).toBe(true);
  expect(on.samples.filter((v:number,i:number)=>Math.abs(v-off.samples[i])>3).length).toBeGreaterThan(50);
  expect((await snapshot(page)).riverSource[0].caustics?.enabled??false).toBe(false);
  await page.screenshot({path:info.outputPath("river-wet-shore.png")});
  const authored=(await snapshot(page)).riverSource[0].shoreWetness;
  for(const level of ["Low","Medium","Ultra"] as const) {
    await page.getByTestId("quality-button").hover();await page.locator("[data-quality-popover] button",{hasText:level}).click();
    await expect(page.locator("[data-quality-label]")).toHaveText(level);
    await expect.poll(async()=>(await frame(true)).wetShoreActive).toBe(level!=="Low");
    expect((await snapshot(page)).riverSource[0].shoreWetness).toEqual(authored);
  }
  await toggle.uncheck();await expect.poll(async()=>(await snapshot(page)).riverSource[0].shoreWetness.enabled).toBe(false);
  await page.getByTestId("editor-undo").click();await expect.poll(async()=>(await snapshot(page)).riverSource[0].shoreWetness.enabled).toBe(true);
  await save(page);
  const saved=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8"));expect(saved.riverWaters[0].shoreWetness).toEqual({enabled:true,width:1.5,strength:.65});
  await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).riverState[0]?.ready).toBe(true);expect((await frame(true)).wetShoreActive).toBe(true);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html",{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  await expect.poll(async()=>(await snapshot(page)).riverBaked.length).toBe(1);
  expect((await frame(true)).wetShoreActive).toBe(true);expect(await terrainHash()).toBe(before);expect(errors).toEqual([]);
});

test("Lake caustics and sandy pebble normals animate, persist through UI Save/Reload and render in runtime", async ({ page, request }, info) => {
  test.setTimeout(600_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 180_000);
  const capture = (enabled = true, time = 0, detail = true, night = false, close = false, wide = false) => page.evaluate(
    args => (window as any).__lakeQA.causticsFrame(...args), [enabled, time, detail, night, close, wide]);
  await expect.poll(async () => (await capture()).normalLayers, { timeout: 90_000 }).toBe(1);
  const off = await capture(false), on = await capture(true), moved = await capture(true, 6), flat = await capture(true, 0, false);
  const differences = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 3).length;
  const changes = { caustics: differences(off.samples, on.samples), animation: differences(on.samples, moved.samples), normals: differences(on.samples, flat.samples) };
  expect(changes.caustics).toBeGreaterThan(30); expect(changes.animation).toBeGreaterThan(30); expect(changes.normals).toBeGreaterThan(30);
  // Measure spatial contrast, not just changed pixels: a nearly uniform lift
  // passes the old existence check even when the light network has disappeared.
  const contrast = (baseline: number[], lit: number[]) => {
    const deltas = Array.from({ length: baseline.length / 3 }, (_, i) =>
      [0.2126, 0.7152, 0.0722].reduce((sum, weight, c) => sum + weight * (lit[i * 3 + c]! - baseline[i * 3 + c]!), 0));
    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    return Math.sqrt(deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length);
  };
  const closeOff = await capture(false, 0, true, false, true), closeOn = await capture(true, 0, true, false, true);
  const visibility = { overview: contrast(off.samples, on.samples), close: contrast(closeOff.samples, closeOn.samples) };
  expect(visibility.overview, "caustic network must remain readable from the overview camera").toBeGreaterThan(2.7);
  expect(visibility.close, "caustic network must remain readable at the shoreline").toBeGreaterThan(3);
  const nightOff = await capture(false, 0, true, true), nightOn = await capture(true, 0, true, true);
  expect(differences(nightOff.samples, nightOn.samples)).toBe(0);
  expect(on.calls).toBe(off.calls); expect(on.glError).toBe(0);
  expect(on.shadows.enabled).toBe(true); expect(on.shadows.cascades).toBeGreaterThan(0);
  await capture(false); await page.screenshot({ path: info.outputPath("lake-caustics-off.png") });
  await capture(true); await page.screenshot({ path: info.outputPath("lake-caustics-on.png") });
  await capture(true, 6); await page.screenshot({ path: info.outputPath("lake-caustics-moving.png") });
  await capture(true, 0, true, false, true); await page.screenshot({ path: info.outputPath("lake-bed-close.png") });
  const wideOff = await capture(false, 0, true, false, false, true), wideOn = await capture(true, 0, true, false, false, true);
  for (const key of ["dry", "island", "separate"]) {
    expect(wideOn.probes[key], `${key} must be in the wide camera`).not.toBeNull(); expect(wideOn.probes[key], key).toEqual(wideOff.probes[key]);
  }
  await page.screenshot({ path: info.outputPath("lake-caustics-island-dry-shore.png") });
  await capture();
  // Timing is a separate opt-in hardware pilot, not a prerequisite for visual
  // and persistence coverage on software-rendered CI/cloud browsers.
  const gpu = process.env.FORGE_CAUSTICS_GPU_PILOT === "1"
    ? await page.evaluate(() => (window as any).__lakeQA.causticsGpuPilot())
    : { available: false, reason: "Not requested; set FORGE_CAUSTICS_GPU_PILOT=1 on a hardware GPU" };
  await writeFile(info.outputPath("caustics-render.json"), JSON.stringify({ changes, visibility, gpu, calls: { off: off.calls, on: on.calls }, textures: on.textures, shadows: on.shadows, dryProbes: wideOn.probes, errors }, null, 2));
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "caustics");
  const toggle = page.locator("[data-lake-caustics]"); await expect(toggle).toBeChecked();
  await toggle.uncheck(); await expect.poll(async () => (await capture()).count).toBe(0);
  await page.getByTestId("editor-undo").click(); await expect.poll(async () => (await capture()).count).toBe(1);
  const size = page.locator('[data-lake-number="causticsScale"]'); await size.fill("1.8"); await size.press("Tab");
  await ready(page); await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance.causticsEnabled).toBe(true); expect(saved.waterBodies[0].appearance.causticsScale).toBe(1.8);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }); await ready(page, 180_000);
  await expect.poll(async () => (await capture()).count).toBe(1);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA), null, { timeout: 180_000 }); await ready(page, 180_000);
  await expect.poll(async () => (await capture()).normalLayers, { timeout: 90_000 }).toBe(1);
  const runtime = await capture(); expect(runtime.count).toBe(1); expect(runtime.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("lake-caustics-runtime.png") });
  await writeFile(info.outputPath("caustics.json"), JSON.stringify({ changes, visibility, calls: { off: off.calls, on: on.calls }, textures: on.textures, gpu, runtime: { count: runtime.count, normalLayers: runtime.normalLayers }, errors }, null, 2));
  expect(errors).toEqual([]);
});

test("Lake shore foam follows real coast and islands, animates and survives Save/Reload/Play", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 180_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "foam");
  await expect(page.locator("[data-lake-foam]")).not.toBeChecked();
  await page.locator("[data-lake-foam]").check(); await ready(page);
  const capture = (enabled = true, time = 0, night = false, close = false, wide = false) => page.evaluate(
    args => (window as any).__lakeQA.causticsFrame(false, 0, true, args[2], args[3], args[4], args[0], args[1]), [enabled, time, night, close, wide]);
  const diff = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 3).length;
  await expect.poll(async () => (await capture()).foamActive, { timeout: 90_000 }).toBe(true);
  expect(errors).toEqual([]);
  const off = await capture(false), on = await capture(), moved = await capture(true, 5);
  expect(diff(off.samples, on.samples), "foam must be visible").toBeGreaterThan(30);
  expect(diff(on.samples, moved.samples), "foam patches must move").toBeGreaterThan(30);
  expect(on.calls).toBe(off.calls); expect(on.glError).toBe(0);
  expect(on.shadows.cascades).toBeGreaterThan(0);
  await capture(false); await page.screenshot({ path: info.outputPath("shore-foam-off.png") });
  await capture(); await page.screenshot({ path: info.outputPath("shore-foam-on.png") });
  await capture(true, 0, false, true); await page.screenshot({ path: info.outputPath("shore-foam-close.png") });
  // Compare the full water+foam composite, not just transparency: the snapshot
  // path already includes the opaque bed and needs radiance blending instead.
  const edgeFrame = (soft: boolean, foam: boolean, direct: boolean) => page.evaluate(
    ([soft, foam, direct]) => (window as any).__lakeQA.causticsFrame(false, 0, true, false, true, false, foam, 0, soft, direct), [soft, foam, direct]);
  for (const direct of [false, true]) for (const foam of [false, true]) {
    const hard = await edgeFrame(false, foam, direct), soft = await edgeFrame(true, foam, direct);
    await writeFile(info.outputPath(`edge-${direct}-${foam}.json`), JSON.stringify({ hard: { lakeDraws: hard.lakeDraws, snapshotUsed: hard.snapshotUsed, drawnMaterial: hard.drawnMaterial, override: hard.override, mean: hard.samples.reduce((a: number,b: number)=>a+b,0)/hard.samples.length, calls: hard.calls, error: hard.glError, probes: hard.shoreProbes }, soft: { lakeDraws: soft.lakeDraws, snapshotUsed: soft.snapshotUsed, drawnMaterial: soft.drawnMaterial, override: soft.override, mean: soft.samples.reduce((a: number,b: number)=>a+b,0)/soft.samples.length, calls: soft.calls, error: soft.glError, probes: soft.shoreProbes }, errors }, null, 2));
    // Offscreen fallback readback is linear RGB8, so its shallow-water
    // differences are smaller than the tone-mapped display path (often 1 LSB).
    const changed = direct ? hard.samples.filter((v: number, i: number) => v !== soft.samples[i]).length : diff(hard.samples, soft.samples);
    expect(changed, `shore blend must work: direct=${direct}, foam=${foam}`).toBeGreaterThan(20);
    expect(soft.glError).toBe(0); expect(soft.calls).toBe(hard.calls);
    if (direct) {
      expect(soft.shoreProbes.near).not.toBeNull(); expect(soft.shoreProbes.deep).not.toBeNull();
      expect(soft.shoreProbes.near).not.toEqual(hard.shoreProbes.near);
      expect(soft.shoreProbes.deep).toEqual(hard.shoreProbes.deep);
    }
  }
  await edgeFrame(false, true, false); await page.screenshot({ path: info.outputPath("shore-edge-hard.png") });
  await edgeFrame(true, true, false); await page.screenshot({ path: info.outputPath("shore-edge-soft.png") });
  const dryOff = await capture(false, 0, false, false, true), dryOn = await capture(true, 0, false, false, true);
  for (const key of ["dry", "island", "separate"]) expect(dryOn.probes[key], key).toEqual(dryOff.probes[key]);
  const nightOff = await capture(false, 0, true), nightOn = await capture(true, 0, true);
  const meanDelta = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.max(0, b[i]! - v), 0) / a.length;
  expect(meanDelta(nightOff.samples, nightOn.samples), "foam must not glow at night").toBeLessThan(meanDelta(off.samples, on.samples));
  await page.locator("[data-lake-foam]").uncheck(); await ready(page);
  await expect.poll(async () => (await capture()).foamActive).toBe(false);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect.poll(async () => (await capture()).foamActive).toBe(true);
  await number(page, "foamWidth", 0.2);
  await expect.poll(async () => (await snapshot(page)).results[0]?.status).toBe("over-budget");
  await number(page, "foamWidth", 1.2); await ready(page);
  await expandLake(page, "appearance"); await number(page, "shoreBlendDepth", 0.35); await ready(page); await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance.foamEnabled).toBe(true);
  expect(saved.waterBodies[0].appearance.foamWidth).toBe(1.2);
  expect(saved.waterBodies[0].appearance.shoreBlendDepth).toBe(0.35);
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 180_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "foam");
  await expect(page.locator("[data-lake-foam]")).toBeChecked();
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 180_000);
  const runtimeOff = await capture(false), runtimeOn = await capture();
  expect(diff(runtimeOff.samples, runtimeOn.samples)).toBeGreaterThan(30); expect(runtimeOn.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("shore-foam-runtime.png") });
  expect(errors).toEqual([]);
});

test("Lake shore blend also softens a steep bank without expanding onto land", async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const { errors } = await setup(page, request, true, false, false, false, false, false, true);
  await expect.poll(async () => { const r = (await snapshot(page)).results[0]; return r?.status === "ready" ? "ready" : JSON.stringify(r); }, { timeout: 20_000 }).toBe("ready");
  const frame = (soft: boolean, direct: boolean, wide = false) => page.evaluate(
    ([soft, direct, wide]) => (window as any).__lakeQA.causticsFrame(false, 0, true, false, !wide, wide, false, 0, soft, direct), [soft, direct, wide]);
  const difference = (a: number[], b: number[], threshold: number) => a.filter((v, i) => Math.abs(v - b[i]!) > threshold).length;
  for (const direct of [false, true]) {
    const hard = await frame(false, direct), soft = await frame(true, direct);
    expect(difference(hard.samples, soft.samples, direct ? 0 : 2)).toBeGreaterThan(10);
    expect(soft.calls).toBe(hard.calls); expect(soft.glError).toBe(0);
  }
  const hardWide = await frame(false, false, true), softWide = await frame(true, false, true);
  for (const key of ["dry", "island", "separate"]) expect(softWide.probes[key]).toEqual(hardWide.probes[key]);
  await frame(false, false); await page.screenshot({ path: info.outputPath("steep-edge-hard.png") });
  await frame(true, false); await page.screenshot({ path: info.outputPath("steep-edge-soft.png") });
  expect(errors).toEqual([]);
});

test("Lake wet shore includes the connected submerged bed and survives toggle undo Save/Reload/Play", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 120_000); const terrainBefore = await terrainHash();
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "wet-shore");
  await expect(page.locator("[data-lake-wet-shore]")).not.toBeChecked();
  await page.locator("[data-lake-wet-shore]").check(); await ready(page);
  const capture = (wet = true, close = false, wide = false) => page.evaluate(
    ([wet, close, wide]) => (window as any).__lakeQA.causticsFrame(false, 0, true, false, close, wide, false, 0, true, false, wet), [wet, close, wide]);
  await expect.poll(async () => (await capture()).wetShoreActive).toBe(true);
  const off = await capture(false, true), on = await capture(true, true);
  const changed = off.samples.filter((v: number, i: number) => Math.abs(v - on.samples[i]!) > 2).length;
  expect(changed, "wet shore must alter terrain shading").toBeGreaterThan(20);
  expect(on.calls).toBe(off.calls); expect(on.glError).toBe(0);
  await capture(false, true); await page.screenshot({ path: info.outputPath("wet-shore-off.png") });
  await capture(true, true); await page.screenshot({ path: info.outputPath("wet-shore-on.png") });
  const wideOff = await capture(false, false, true), wideOn = await capture(true, false, true);
  expect(wideOn.probes.wetBed).not.toBeNull();
  expect(wideOn.probes.wetBed, "the connected bed away from the shoreline must also become wet").not.toEqual(wideOff.probes.wetBed);
  for (const key of ["dry", "island", "separate"]) expect(wideOn.probes[key]).toEqual(wideOff.probes[key]);
  const wetOverview = await capture(true);
  const causticOverview = await page.evaluate(() => (window as any).__lakeQA.causticsFrame(true, 0, true, false, false, false, false, 0, true, false, true));
  expect(wetOverview.samples.filter((v: number, i: number) => Math.abs(v - causticOverview.samples[i]!) > 3).length,
    "caustics must remain visible on the wet submerged bed").toBeGreaterThan(30);
  await page.locator("[data-lake-wet-shore]").uncheck(); await ready(page);
  await expect.poll(async () => (await capture()).wetShoreActive).toBe(false);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect.poll(async () => (await capture()).wetShoreActive).toBe(true);
  await number(page, "shoreWetnessStrength", 0.8); await ready(page); await save(page);
  expect(await terrainHash()).toBe(terrainBefore);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance.shoreWetnessEnabled).toBe(true);
  expect(saved.waterBodies[0].appearance.shoreWetnessStrength).toBe(0.8);
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 120_000);
  await expect.poll(async () => (await capture()).wetShoreActive).toBe(true);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 120_000);
  await expect.poll(async () => (await capture()).wetShoreActive).toBe(true);
  const runtimeOff = await capture(false, true), runtimeOn = await capture(true, true);
  expect(runtimeOff.samples.filter((v: number, i: number) => Math.abs(v - runtimeOn.samples[i]!) > 2).length).toBeGreaterThan(20);
  expect(runtimeOn.glError).toBe(0); expect(errors).toEqual([]);
});

test("Lake multiscale surface animates reflected light, preserves shore and persists surface controls", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "appearance");
  await expandLake(page, "advanced");
  await page.locator("[data-lake-reflection]").selectOption("sharedPlanar"); await ready(page);
  const capture = (strength = 1, time = 0, night = false, view = 1, wide = false) => page.evaluate(
    ([strength, time, night, view, wide]) => (window as any).__lakeQA.causticsFrame(false, 0, true, night, false, wide, false, time, true, false, true, strength, wide ? 0 : view), [strength, time, night, view, wide]);
  const differences = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 3).length;
  const flat = await capture(0), on = await capture(), moved = await capture(1, 6);
  expect(differences(flat.samples, on.samples), "ripples must break up reflected light").toBeGreaterThan(30);
  expect(differences(on.samples, moved.samples), "surface must evolve over time").toBeGreaterThan(30);
  expect(on.glError).toBe(0); expect(on.calls).toBe(flat.calls);
  await capture(0); await page.screenshot({ path: info.outputPath("lake-surface-flat.png") });
  await capture(); await page.screenshot({ path: info.outputPath("lake-surface-ripples.png") });
  await capture(1, 6); await page.screenshot({ path: info.outputPath("lake-surface-moving.png") });
  const far = await capture(1, 0, false, 2); expect(far.glError).toBe(0);
  await page.screenshot({ path: info.outputPath("lake-surface-far.png") });
  const dryFlat = await capture(0, 0, false, 1, true), dryOn = await capture(1, 0, false, 1, true);
  for (const key of ["dry", "island", "separate"]) expect(dryOn.probes[key]).toEqual(dryFlat.probes[key]);
  const noMap = await page.evaluate(() => (window as any).__lakeQA.causticsFrame(false, 0, true, false, false, false, false, 0, true, false, true, 1, 1, false));
  const noMapMoved = await page.evaluate(() => (window as any).__lakeQA.causticsFrame(false, 0, true, false, false, false, false, 6, true, false, true, 1, 1, false));
  expect(differences(noMap.samples, noMapMoved.samples), "procedural ripples must survive a missing normal map").toBeGreaterThan(30);
  expect(noMap.glError).toBe(0);
  const night = await capture(1, 0, true);
  const mean = (a: number[]) => a.reduce((sum, v) => sum + v, 0) / a.length;
  expect(mean(night.samples)).toBeLessThan(mean(on.samples)); expect(night.glError).toBe(0);
  await number(page, "surfaceStrength", 0.8); await ready(page);
  await number(page, "surfaceRoughness", 0.28); await ready(page); await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance.surfaceStrength).toBe(0.8);
  expect(saved.waterBodies[0].appearance.surfaceRoughness).toBe(0.28);
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "appearance");
  await expect(page.locator('[data-lake-number="surfaceStrength"]')).toHaveValue("0.8");
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 120_000);
  const runtimeFlat = await capture(0), runtimeOn = await capture(0.8);
  expect(differences(runtimeFlat.samples, runtimeOn.samples)).toBeGreaterThan(30);
  expect(runtimeOn.glError).toBe(0); expect(errors).toEqual([]);
});

// L2 QA: no-contact tyre/plane intersection, stationary/air/submerged/island
// rejection, motion/slip wavefronts, ageing, snapshot/direct shader and unchanged terrain.
test("Lake wheel ripples spread and decay independently of mud and reject false surface contacts", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 120_000);
  const before = await terrainHash();
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 120_000);
  const frame = (mode: string, age = .15, direct = false) => page.evaluate(
    ([mode, age, direct]) => (window as any).__lakeQA.wheelFrame(mode, age, direct), [mode, age, direct]);
  const diff = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 2).length;
  const off = await frame("stopped"), on = await frame("moving"), aged = await frame("moving", .5);
  expect(off.ripples).toHaveLength(0); expect(on.ripples.length).toBeGreaterThan(0);
  expect(diff(off.samples, on.samples), "moving tyre waves must be visible").toBeGreaterThan(10);
  expect(diff(on.samples, aged.samples), "wavefronts must travel and decay").toBeGreaterThan(10);
  expect(on.calls).toBe(off.calls); expect(on.glError).toBe(0);
  await frame("stopped"); await page.screenshot({ path: info.outputPath("lake-wheel-still.png") });
  await frame("moving"); await page.screenshot({ path: info.outputPath("lake-wheel-waves.png") });
  await frame("moving", .5); await page.screenshot({ path: info.outputPath("lake-wheel-waves-aged.png") });
  for (const mode of ["air", "submerged", "dry"]) {
    const rejected = await frame(mode); expect(rejected.ripples, mode).toHaveLength(0);
    expect(rejected.samples, mode).toEqual(off.samples);
  }
  const slip = await frame("slip"); expect(slip.ripples.length).toBeGreaterThan(0);
  expect(diff(off.samples, slip.samples)).toBeGreaterThan(10);
  const expired = await frame("moving", 1.7); expect(expired.ripples).toHaveLength(0); expect(expired.samples).toEqual(off.samples);
  const directOff = await frame("stopped", .15, true), directOn = await frame("moving", .15, true);
  expect(diff(directOff.samples, directOn.samples)).toBeGreaterThan(10); expect(directOn.glError).toBe(0);
  expect(directOn.calls).toBe(directOff.calls);
  expect(await terrainHash()).toBe(before); expect(errors).toEqual([]);
});

// WPO QA: GPU height encoding versus triangle-interpolated CPU contact height;
// pinned shore/dry regions, zero/off, time, bounds, direct/AO and persistence.
test("Lake Surface Waves displace geometry with matching CPU heights and persist through UI Save Reload Play", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true, false, true);
  await ready(page, 120_000); const hash = await terrainHash();
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "surface-waves");
  const field = page.locator('[data-lake-number="surfaceWaveHeight"]');
  await expect(field).toHaveValue("2"); await expect(field).toHaveAttribute("title", /santimetre/);
  await page.locator('[data-detail-section="lake-surface-waves"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("lake-surface-wave-controls.png") });
  const frame = (time = 0, encoded = false, direct = false) => page.evaluate(
    ([time, encoded, direct]) => (window as any).__lakeQA.surfaceFrame(time, encoded, direct), [time, encoded, direct]);
  const diff = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 2).length;
  await expandLake(page, "advanced"); await page.locator("[data-lake-reflection]").selectOption("sharedPlanar"); await ready(page);
  await number(page, "surfaceWaveHeight", 0); await ready(page); const flat = await frame();
  await number(page, "surfaceWaveHeight", 6); await ready(page); const on = await frame(), moved = await frame(1.25);
  expect(diff(flat.samples, on.samples)).toBeGreaterThan(10); expect(diff(on.samples, moved.samples)).toBeGreaterThan(10);
  expect(on.calls).toBe(flat.calls); expect(on.glError).toBe(0); expect(on.waveHeight).toBe(.06);
  expect(on.overrideCount, "AO normal and DoF depth must compile the displacing variants").toBe(2);
  await frame(); await page.screenshot({ path: info.outputPath("lake-surface-wave-raised.png") });
  await frame(1.25); await page.screenshot({ path: info.outputPath("lake-surface-wave-moved.png") });
  for (const t of [0, 1.25]) {
    const gpu = await frame(t, true);
    for (const [key, pixels] of [["wetBed", gpu.probes.wetBed], ["deep", gpu.shoreProbes.deep]] as const) {
      expect(pixels).not.toBeNull(); const measuredHeight = (pixels[12] / 255 - .5) / 4;
      expect(Math.abs(measuredHeight - gpu.cpuHeights[key]), `${key} GPU height must match the CPU query`).toBeLessThan(.004);
    }
    expect(gpu.glError).toBe(0);
  }
  for (const key of ["dry", "island", "separate"]) expect(on.probes[key]).toEqual(flat.probes[key]);
  const directOn = await frame(0, false, true); expect(directOn.glError).toBe(0);
  const enabled = page.getByRole("checkbox", { name: "Surface Waves Enabled", exact: true });
  await enabled.uncheck(); await ready(page); const off = await frame(), offMoved = await frame(1.25);
  expect(off.waveHeight).toBe(0); expect(off.samples).toEqual(offMoved.samples);
  await page.getByTestId("editor-undo").click(); await ready(page); await expect(enabled).toBeChecked();
  await page.locator('[data-lake-reset-surface-waves]').click(); await ready(page); await expect(field).toHaveValue("2");
  await page.getByTestId("editor-undo").click(); await ready(page); await expect(field).toHaveValue("6");
  const settings = { surfaceWaveLength: 16, surfaceWavePeriod: 6, surfaceWaveDirection: 75, surfaceWaveShoreDepth: .8 };
  for (const [key, value] of Object.entries(settings)) { await number(page, key, value); await ready(page); }
  await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance).toMatchObject({ ...settings, surfaceWaveHeight: .06 });
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "surface-waves"); await expect(field).toHaveValue("6");
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 120_000);
  const runtime = await frame(); expect(runtime.waveHeight).toBe(.06); expect(runtime.glError).toBe(0);
  expect(diff(runtime.samples, (await frame(1.5)).samples)).toBeGreaterThan(10);
  expect(await terrainHash()).toBe(hash); expect(errors).toEqual([]);
  await writeFile(info.outputPath("surface-waves.json"), JSON.stringify({ on: { waveHeight: on.waveHeight, overrideCount: on.overrideCount }, errors }, null, 2));
});

// Controls QA: visible wave-strength/shape changes; toggle, reset, lock,
// undo/redo and each saved value in editor reload and runtime; no terrain writes.
test("Lake Wheel Ripples controls tune visible waves and persist through undo Save Reload and Play", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  const { errors } = await setup(page, request, true, false, false, false, false, true);
  await ready(page, 120_000); const before = await terrainHash();
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "wheel-ripples");
  const frame = (age = .15) => page.evaluate(age => (window as any).__lakeQA.wheelFrame("moving", age), age);
  const difference = (a: number[], b: number[]) => a.filter((v, i) => Math.abs(v - b[i]!) > 2).length;
  const enabled = page.getByRole("checkbox", { name: "Wheel Ripples Enabled", exact: true });
  await expect(enabled).toBeChecked();
  await expect(page.locator('[data-lake-number="wheelRippleStrength"]')).toHaveValue("2");
  await expect(page.locator('[data-lake-number="wheelRippleSpeed"]')).toHaveAttribute("title", /metre\/saniye/);
  await page.locator('[data-detail-section="lake-wheel-ripples"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("lake-wheel-controls.png") });
  const original = await frame();
  await number(page, "wheelRippleStrength", 0); await ready(page); const flat = await frame();
  expect(flat.ripples).toHaveLength(0); expect(difference(original.samples, flat.samples)).toBeGreaterThan(10);
  await number(page, "wheelRippleStrength", 3); await ready(page); const strong = await frame();
  expect(strong.waveParams[0]).toBe(3); expect(difference(strong.samples, flat.samples)).toBeGreaterThan(10);
  await page.locator("[data-lake-reset-wheel-ripples]").click(); await ready(page);
  await expect(page.locator('[data-lake-number="wheelRippleStrength"]')).toHaveValue("2");
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect(page.locator('[data-lake-number="wheelRippleStrength"]')).toHaveValue("3");
  let last = await frame();
  const values = { wheelRippleSpeed: 2.4, wheelRippleWidth: .7, wheelRippleWavelength: .5, wheelRippleLifetime: 2.5, wheelRippleInterval: .2 };
  for (const [key, value] of Object.entries(values)) {
    await number(page, key, value); await ready(page); const next = await frame();
    if (["wheelRippleSpeed", "wheelRippleWidth", "wheelRippleWavelength"].includes(key)) {
      expect(difference(last.samples, next.samples), key).toBeGreaterThan(10);
    }
    last = next;
  }
  expect((await frame(2)).ripples.length).toBeGreaterThan(0);
  await enabled.uncheck(); await ready(page); expect((await frame()).ripples).toHaveLength(0);
  await page.getByTestId("editor-undo").click(); await ready(page); await expect(enabled).toBeChecked();
  await page.getByTestId("editor-redo").click(); await ready(page); await expect(enabled).not.toBeChecked();
  await save(page);
  expect(JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")).waterBodies[0].appearance.wheelRipplesEnabled).toBe(false);
  await page.getByTestId("editor-undo").click(); await ready(page); await expect(enabled).toBeChecked();
  // Undo restores the old implicit true default. Author an explicit true as well.
  await enabled.uncheck(); await ready(page); await enabled.check(); await ready(page);
  await page.locator("[data-lake-locked]").check(); await ready(page);
  await expect(page.locator('[data-lake-number="wheelRippleStrength"]')).toBeDisabled(); await expect(enabled).toBeDisabled();
  await page.locator("[data-lake-locked]").uncheck(); await ready(page); await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.waterBodies[0].appearance).toMatchObject({ ...values, wheelRippleStrength: 3, wheelRipplesEnabled: true });
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "wheel-ripples");
  for (const [key, value] of Object.entries({ ...values, wheelRippleStrength: 3 })) await expect(page.locator(`[data-lake-number="${key}"]`)).toHaveValue(String(value));
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 120_000);
  const runtime = await frame(); expect(runtime.waveParams).toEqual([3, 2.4, .7, 2.5]); expect(runtime.wavelength).toBe(.5);
  expect(runtime.ripples.length).toBeGreaterThan(0); expect(runtime.glError).toBe(0);
  expect((await frame(2)).ripples.length).toBeGreaterThan(0);
  await frame(); await page.screenshot({ path: info.outputPath("lake-wheel-custom-waves.png") });
  expect(await terrainHash()).toBe(before); expect(errors).toEqual([]);
});

test("Lake Wheel Wet Trail controls persist through undo, Save and Reload", async ({ page, request }) => {
  test.setTimeout(240_000);
  const { errors } = await setup(page, request, true);
  await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "wheel-wet-trail");
  const enabled = page.getByRole("checkbox", { name: "Wheel Wet Trail Enabled", exact: true });
  await expect(enabled).toBeChecked();
  await expect(page.locator('[data-lake-number="wheelWetTrailLength"]')).toHaveValue("5");
  await expect(page.locator('[data-lake-number="wheelWetTrailDrySeconds"]')).toHaveAttribute("title", /saniye/);
  const values = { wheelWetTrailLength: 2.5, wheelWetTrailStrength: .6, wheelWetTrailDrySeconds: 90 };
  for (const [key, value] of Object.entries(values)) { await number(page, key, value); await ready(page); }
  await page.locator("[data-lake-reset-wet-trail]").click(); await ready(page);
  await expect(page.locator('[data-lake-number="wheelWetTrailLength"]')).toHaveValue("5");
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect(page.locator('[data-lake-number="wheelWetTrailLength"]')).toHaveValue("2.5");
  await enabled.uncheck(); await ready(page);
  await save(page);
  expect(JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")).waterBodies[0].appearance)
    .toMatchObject({ ...values, wheelWetTrailEnabled: false });
  await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 120_000);
  await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "wheel-wet-trail");
  for (const [key, value] of Object.entries(values)) await expect(page.locator(`[data-lake-number="${key}"]`)).toHaveValue(String(value));
  await expect(page.getByRole("checkbox", { name: "Wheel Wet Trail Enabled", exact: true })).not.toBeChecked();
  expect(errors).toEqual([]);
});

// QA inventory: click/create/cancel; world level, four bounds and drag handles;
// island/isolated basin + escape rejection; selection/flags/delete/undo;
// real Save/Reload/Play and unchanged terrain; sculpt and retry in separate cases.
test("Lake UI creates a connected two-seam lake, preserves terrain and survives undo, Save/Reload and Play", async ({ page, request }, info) => {
  test.setTimeout(480_000);
  const { errors } = await setup(page, request), hash = await terrainHash();
  await page.locator("[data-lake-begin]").click();
  await page.keyboard.press("Escape"); await expect(page.locator("[data-lake-begin]")).toBeEnabled();
  await page.locator("[data-lake-begin]").click(); await clickWorld(page, [-20, 10, -12]);
  await expect(page.locator("[data-lake-number=surfaceLevel]")).toBeVisible();
  const initialAppearance = await page.evaluate(() => (window as any).__lakeQA.snapshot().source.appearance);
  expect(initialAppearance).toMatchObject({ shoreWetnessEnabled: true, foamEnabled: true, causticsEnabled: true,
    absorptionDistance: 2, surfaceStrength: 2, surfaceRoughness: .2, normalScale: 1, rippleSpeed: 2,
    wheelRipplesEnabled: true, wheelRippleStrength: 3, wheelRippleSpeed: 1.8,
    wheelRippleWidth: 1, wheelRippleWavelength: .6, wheelRippleLifetime: 4, wheelRippleInterval: .12,
    foamScale: 2, foamSpeed: 2, causticsStrength: 1, causticsScale: 1, causticsSpeed: 2, causticsDepthFade: 1,
    reflectionMode: "sharedPlanar", reflectionQuality: "medium" });
  for (const [key, v] of [["minX", -48], ["minZ", -48], ["maxX", 48], ["maxZ", 48], ["surfaceLevel", 12]] as const) await number(page, key, v);
  await ready(page); await expect(page.locator("[data-lake-create]")).toBeEnabled();
  await page.locator("[data-lake-create]").click();
  await page.getByTestId("outliner-row").filter({ hasText: "Lake 1" }).first().click();
  await ready(page); const initial = (await snapshot(page)).results[0]; expect(initial.escape).toBe(15);
  await number(page, "surfaceLevel", 15); await expect(page.locator("[data-lake-status]")).toContainText("Area opens");
  expect((await snapshot(page)).objects).toBe(0);
  await page.getByTestId("editor-undo").click(); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.locator("[data-lake-locked]").check(); await expect(page.locator("[data-lake-number=surfaceLevel]")).toBeDisabled();
  await page.locator("[data-lake-locked]").uncheck(); await ready(page);
  await expandLake(page);
  await page.locator("[data-lake-reflection]").selectOption("sharedPlanar"); await ready(page);
  await page.locator("[data-lake-reflection]").selectOption("off"); await ready(page);
  await page.screenshot({ path: info.outputPath("lake-editor.png") });
  const button = page.getByTestId("editor-save"); await expect(button).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForResponse((r) => r.url().endsWith("/__save-layout") && r.request().method() === "POST");
  await button.click(); expect((await saved).ok()).toBeTruthy(); await expect(button).toBeEnabled({ timeout: 120_000 });
  expect(await terrainHash()).toBe(hash);
  const source = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")); expect(source.waterBodies[0].surfaceLevel).toBe(12);
  expect(source.waterBodies[0].appearance).toEqual({ ...initialAppearance, reflectionMode: "off" });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.getByTestId("outliner-row").filter({ hasText: "Lake 1" }).first().click(); await expandLake(page); await page.locator("[data-lake-delete]").click();
  await expect.poll(async () => (await snapshot(page)).objects).toBe(0);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await save(page);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__lakeQA)), { timeout: 90_000 }).toBe(true);
  await ready(page); const runtime = (await snapshot(page)).results[0]; expect(runtime.hash).toBe(initial.hash);
  await page.evaluate(() => (window as any).__lakeQA.frame()); await page.screenshot({ path: info.outputPath("lake-runtime.png") });
  await page.setViewportSize({ width: 1100, height: 720 }); await page.evaluate(() => (window as any).__lakeQA.frame(true));
  await page.screenshot({ path: info.outputPath("lake-runtime-top.png") });
  await writeFile(info.outputPath("lake.json"), JSON.stringify({ initial, runtime, errors }, null, 2)); expect(errors).toEqual([]);
});

test("Lake bounds drag and seed editing use undo; seam sculpt refreshes exact depth and undo restores it", async ({ page, request }, info) => {
  test.setTimeout(300_000); const { errors } = await setup(page, request, true); await ready(page);
  await page.locator('[data-object-id="lake:0"]').click();
  const initial = (await snapshot(page)).results[0];
  const points = await page.evaluate(() => ([ [0,12.1,-48], [0,12.1,-44] ]).map((p) => (window as any).__lakeQA.project(...p)));
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  expect(points[0].y).toBeGreaterThan(viewport.y); expect(points[0].y).toBeLessThan(viewport.y + viewport.height);
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-lake-number="minZ"]')).toHaveValue("-44"); await ready(page);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect(page.locator('[data-lake-number="minZ"]')).toHaveValue("-48");
  await page.locator("[data-lake-reseed]").click(); await clickWorld(page, [-16,10,-12]); await ready(page);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expandLake(page); await page.locator("[data-lake-terrain]").click();
  await page.locator("[data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-landscape-tool="lower"]').click();
  const brush = page.locator('[data-landscape-number="brushSize"]'); await brush.fill("5"); await brush.press("Enter");
  const point = await page.evaluate(() => (window as any).__lakeQA.project(0,10,-12));
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await ready(page); expect((await snapshot(page)).results[0].maxDepth).toBeGreaterThan(2);
  await page.getByTestId("editor-undo").click(); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.getByTestId("editor-redo").click(); await ready(page);
  expect((await snapshot(page)).results[0].maxDepth).toBeGreaterThan(2);
  await page.getByTestId("editor-undo").click(); await ready(page);
  const unchanged = (await snapshot(page)).results[0];
  await page.locator('[data-landscape-tool="flatten"]').click();
  await clickWorld(page, [0,10,-12]);
  expect((await snapshot(page)).results[0]?.hash).toBe(unchanged.hash);
  await page.locator('[data-landscape-tool="lower"]').click();
  await clickWorld(page, [0,16,-58]);
  const distant = (await snapshot(page)).results[0];
  expect(distant?.hash).toBe(unchanged.hash); expect(distant?.ms).toBe(unchanged.ms);
  await page.screenshot({ path: info.outputPath("lake-sculpt.png") }); expect(errors).toEqual([]);
});

test("Streamed Lake rejects a remote 503 and retries without activating or saving bed tiles", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  await page.route("**/__playwright-lake-world.tiles/7_0.tile.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const writes: string[] = []; page.on("request", (r) => { if (r.url().includes("/__save-terrain")) writes.push(r.url()); });
  const { errors, doc } = await setup(page, request, true, true);
  await page.locator('[data-object-id="lake:0"]').click();
  await expect(page.locator("[data-lake-status]")).toContainText("503", { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).streamingPending, { timeout: 60_000 }).toBe(0);
  const before = await snapshot(page); expect(before.objects).toBe(0); expect(before.resident[0].count).toBeLessThan(doc.def.tiles.length);
  await page.unroute("**/__playwright-lake-world.tiles/7_0.tile.bin"); await expandLake(page); await page.locator("[data-lake-retry]").click();
  await ready(page); const after = await snapshot(page); expect(after.objects).toBe(1);
  expect(after.resident).toEqual(before.resident); expect(writes).toEqual([]);
  await writeFile(info.outputPath("lake-streaming.json"), JSON.stringify({ before, after, writes }, null, 2));
  await page.screenshot({ path: info.outputPath("lake-streaming-retry.png") });
  expect(errors.every((e) => e.includes("503"))).toBe(true);
});

const editorSnapshot = (page: Page) => page.evaluate(() => (window as any).__lakeQA.editor());

// QA: shared River/Lake navigation, mode roundtrip, no sculpt in Water System,
// retained river accordions, no eligible spline, pick cancellation, compact fit.
test("Water System groups rivers and lakes and keeps terrain edits in Sculpt", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const { errors } = await setup(page, request, true, false, false, false, true);
  await ready(page);
  const terrain = (await editorSnapshot(page)).terrain;
  await expect(page.locator('[data-landscape-mode]')).toHaveValue("water");
  await expect(page.locator('[data-lake-begin]')).toHaveText("Add Lake");
  await expect(page.locator('[data-river-water-create]')).toHaveText("Add River");
  await expect(page.locator('[data-landscape-tool], [data-landscape-spline-tool]')).toHaveCount(0);
  await clickWorld(page, [0, 10, -12]);
  expect((await editorSnapshot(page)).terrain).toEqual(terrain);
  // Water System keeps ordinary picking: this click may select the existing Lake.
  await page.locator('[data-object-id="landscape:0"]').click();
  await page.locator('[data-river-water-create]').click();
  await expect(page.locator('[data-water-body][data-water-kind="river"]')).toHaveCount(1);
  await expect(page.locator('[data-water-body][data-water-kind="lake"]')).toHaveCount(1);
  await expect(page.locator('[data-river-water-create]')).toBeDisabled();
  await expect(page.locator('[data-landscape-mode] option:checked')).toHaveText("Water");
  const deleteRiver = page.locator('[data-river-water-delete]');
  await expect(deleteRiver).toHaveText("Delete River");
  expect(await deleteRiver.evaluate((e) => e.closest('.detail-section'))).toBeNull();
  await expect(page.locator('[data-river-water-number="surfaceLevel"]')).toHaveAttribute('title', /yüksekliği/);
  await expect(page.locator('[data-river-water-number="flowSpeed"]')).toHaveAttribute('title', /akış/);
  await page.screenshot({ path: info.outputPath("water-system-river-and-lake.png") });
  const surface = page.locator('[data-detail-section="river-surface"]');
  await surface.locator('.detail-section-toggle').click();
  const flow = page.locator('[data-river-water-number="flowSpeed"]');
  await flow.fill("1.4"); await flow.press("Tab");
  await expect(surface).toHaveClass(/collapsed/);
  await page.locator('[data-water-kind="lake"]').click();
  await expect(page.locator('[data-lake-number="surfaceLevel"]')).toBeVisible();
  await expect(page.locator('[data-landscape-mode]')).toHaveValue("water");
  await expect(page.locator('[data-water-kind="lake"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-lake-workflow], [data-lake-finish]')).toHaveCount(0);
  const deleteLake = page.locator('[data-lake-delete]');
  await expect(deleteLake).toHaveText('Delete Lake');
  expect(await deleteLake.evaluate((e) => e.closest('.detail-section'))).toBeNull();
  await expect(page.locator('[data-lake-number="surfaceLevel"]')).toHaveAttribute('title', /yüksekliği/);
  await expect(page.locator('[data-detail-section="lake-basic"] .detail-section-toggle')).toHaveText('Surface');
  await expandLake(page, 'appearance');
  await expect(page.locator('[data-lake-number="opacity"]')).toHaveAttribute('title', /opaklığı/);
  await expandLake(page);
  await expect(page.locator('[data-lake-reflection]')).toHaveAttribute('title', /yansımayı/i);
  await page.locator('[data-detail-section="lake-advanced"] .detail-section-toggle').click();
  await page.screenshot({ path: info.outputPath("water-system-lake-selected.png") });
  await page.locator('[data-water-kind="river"]').click();
  await expect(flow).toHaveValue("1.4");
  await expect(surface).toHaveClass(/collapsed/);
  await page.locator('[data-landscape-mode]').selectOption("sculpt");
  await expect(page.locator('[data-landscape-tool="raise"]')).toBeVisible();
  await expect(page.locator('[data-river-water-create], [data-lake-begin]')).toHaveCount(0);
  await page.locator('[data-landscape-mode]').selectOption("water");
  await page.locator('[data-lake-begin]').click();
  await expect(page.locator('[data-landscape-mode]')).toBeDisabled();
  await expect(page.locator('[data-water-body]').first()).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-lake-begin]')).toBeEnabled();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.locator('[data-lake-begin]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-river-water-create]')).toBeInViewport();
  await expect(page.locator('[data-lake-begin]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath("water-system-small.png") });
  await page.locator('[data-water-create-spline]').click();
  await expect(page.locator('[data-landscape-mode]')).toHaveValue("splines");
  await expect(page.locator('[data-landscape-spline-tool="draw"]')).toBeVisible();
  await expect(page.locator('[data-river-water-number]')).toHaveCount(0);
  expect((await editorSnapshot(page)).terrain).toEqual(terrain);
  expect(errors).toEqual([]);
});

async function draftLake(page: Page) {
  await page.locator("[data-landscape-mode]").selectOption("water");
  await page.locator("[data-lake-begin]").click(); await clickWorld(page, [-20, 10, -12]);
  for (const [key, value] of [["minX", -48], ["minZ", -48], ["maxX", 48], ["maxZ", 48], ["surfaceLevel", 12]] as const) await number(page, key, value);
  await ready(page);
}

// UX inventory: entry/pick/stop; draft/ready/error; Escape in a field and canvas;
// commit/discard/resume when leaving via viewport or Outliner; foreground picking;
// basic/appearance/advanced accordions + retained state; standard buttons/checks;
// smaller viewport fit; legacy metadata roundtrip; no terrain edits in any flow.
test("Lake UX preserves a draft on Escape and exits to normal viewport selection", async ({ page, request }, info) => {
  test.setTimeout(300_000); const { errors } = await setup(page, request, false, false, false, true), hash = await terrainHash();
  await expect(page.locator("[data-lake-begin]")).toHaveText("Add Lake");
  await expect(page.locator("[data-lake-bed-begin], [data-lake-bed-draw], [data-lake-bed-apply]")).toHaveCount(0);
  const foregroundPoint = [-12, 17, -12];
  // Leave Landscape's sculpt mode before checking ordinary object picking.
  await page.keyboard.press("Escape"); expect((await editorSnapshot(page)).selection).toBeNull();
  await clickWorld(page, foregroundPoint); expect((await editorSnapshot(page)).selection?.assetId).toBe("shape:cube");
  await page.locator('[data-object-id="landscape:0"]').click();
  await page.locator("[data-lake-begin]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("lake-entry.png") });
  await draftLake(page);
  const original = await editorSnapshot(page);
  await page.locator('[data-detail-section="lake-advanced"] .detail-section-toggle').click();
  await page.locator("[data-lake-workflow]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-lake-stage]")).toHaveText("Draft Preview");
  await expect(page.locator('[data-detail-section="lake-appearance"]')).toHaveClass(/collapsed/);
  await page.screenshot({ path: info.outputPath("lake-draft.png") });
  await page.locator('[data-lake-number="surfaceLevel"]').focus(); await page.keyboard.press("Escape");
  await expect(page.locator("[data-lake-resume]")).toBeInViewport();
  expect((await editorSnapshot(page)).state.source).toEqual(original.state.source);
  expect((await snapshot(page)).objects).toBe(1);
  await page.locator("[data-lake-resume]").click();
  await expect(page.locator("[data-lake-stage]")).toHaveText("Draft Preview");
  await page.locator("[data-lake-finish]").click();
  await expect(page.locator("[data-lake-create]")).toHaveText("Create Lake and Continue");
  await page.locator("[data-lake-create]").click(); await ready(page);
  expect((await editorSnapshot(page)).selection).toBeNull();
  await page.locator('[data-object-id="lake:0"]').click();
  await expect(page.locator("[data-lake-workflow]")).toHaveCount(0);
  await expect(page.locator("[data-lake-delete]")).toBeVisible();
  await page.keyboard.press("Escape");
  expect((await snapshot(page)).objects).toBe(1); expect((await editorSnapshot(page)).selection).toBeNull();
  // A mesh above the water must remain selectable in front of the Lake.
  await clickWorld(page, foregroundPoint);
  expect((await editorSnapshot(page)).selection?.assetId).toBe("shape:cube");
  await page.locator('[data-object-id="lake:0"]').click();
  await page.setViewportSize({ width: 1100, height: 720 });
  // The shared Water System navigation now precedes the Lake editor. Bring its
  // whole editing panel into view before checking the core controls together.
  await page.locator("[data-lake-panel]").scrollIntoViewIfNeeded();
  const fit = await page.locator("[data-lake-panel]").evaluate((panel) => {
    const controls = [...panel.querySelectorAll<HTMLElement>("[data-lake-workflow] button, [data-lake-locked], [data-lake-hidden]")];
    const bounds = panel.getBoundingClientRect();
    return { overflow: panel.scrollWidth > panel.clientWidth + 1,
      controlsFit: controls.every((c) => { const r = c.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right + 1 && r.top >= 0 && r.bottom <= innerHeight; }),
      checkboxWidth: panel.querySelector("[data-lake-locked]")!.getBoundingClientRect().width };
  });
  expect(fit).toEqual({ overflow: false, controlsFit: true, checkboxWidth: 14 });
  await page.screenshot({ path: info.outputPath("lake-compact.png") });
  await expandLake(page, "appearance"); await number(page, "opacity", 0.7); await ready(page);
  await number(page, "opacity", 0.82); await ready(page);
  await page.screenshot({ path: info.outputPath("lake-appearance.png") });
  await expandLake(page); await page.locator("[data-lake-group]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("lake-advanced.png") });
  await page.locator("[data-lake-delete]").focus(); await page.keyboard.press("Escape");
  expect((await editorSnapshot(page)).selection).toBeNull(); expect(await terrainHash()).toBe(hash);
  await save(page); expect(errors).toEqual([]);
});

test("Lake UX asks before leaving an invalid draft and never sculpts while selecting", async ({ page, request }, info) => {
  test.setTimeout(300_000); const { errors } = await setup(page, request);
  await page.locator("[data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-landscape-tool="lower"]').click();
  const terrain = (await editorSnapshot(page)).terrain, hash = await terrainHash();
  await draftLake(page); await number(page, "surfaceLevel", 15);
  await expect(page.locator("[data-lake-status]")).toContainText("Area opens");
  await page.locator('[data-object-id="landscape:0"]').click();
  await expect(page.locator("[data-lake-resume]")).toBeInViewport(); await expect(page.locator("[data-lake-create]")).toBeDisabled();
  await page.screenshot({ path: info.outputPath("lake-invalid-draft.png") });
  await page.locator("[data-lake-resume]").click(); await number(page, "surfaceLevel", 12); await ready(page);
  await page.locator("[data-lake-reseed]").click(); await page.keyboard.press("Escape");
  expect((await editorSnapshot(page)).state.draft).toBe(true); expect((await editorSnapshot(page)).state.picking).toBe(false);
  await clickWorld(page, [-40, 16, -40]);
  await expect(page.locator("[data-lake-resume]")).toBeInViewport();
  expect((await editorSnapshot(page)).terrain).toEqual(terrain);
  await page.locator("[data-lake-cancel]").click();
  await expect.poll(async () => (await snapshot(page)).objects).toBe(0);
  expect((await editorSnapshot(page)).state.draft).toBe(false);
  await expect(page.locator("[data-lake-begin]")).toBeEnabled(); expect(await terrainHash()).toBe(hash);
  expect(errors).toEqual([]);
});

test("Lake legacy bed metadata loads and saves without exposing terrain baking controls", async ({ page, request }) => {
  test.setTimeout(300_000); const { doc, errors } = await setup(page, request, true, false, true); await ready(page);
  const hash = await terrainHash(), terrain = (await editorSnapshot(page)).terrain;
  await page.locator('[data-object-id="lake:0"]').click();
  await expect(page.locator('[data-lake-panel]').getByRole("button", { name: /Draw|boundary|bed|yatak|Araziye uygula/i })).toHaveCount(0);
  await expect(page.locator('[data-lake-bed-panel], [data-lake-bed-draw], [data-lake-bed-apply]')).toHaveCount(0);
  await number(page, "surfaceLevel", 13); await ready(page); await expandLake(page); await page.locator("[data-lake-retry]").click(); await ready(page);
  expect((await editorSnapshot(page)).terrain).toEqual(terrain); await save(page); expect(await terrainHash()).toBe(hash);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")); expect(saved.waterBodies[0].bed).toEqual(doc.lake.bed);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }); await ready(page);
  expect(await terrainHash()).toBe(hash); expect(errors).toEqual([]);
});

test("Lake GPU pilot measures 300 paired baseline/surface frames", async ({ page, request }, info) => {
  test.setTimeout(360_000); await setup(page, request, true);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__lakeQA)), { timeout: 90_000 }).toBe(true);
  await ready(page); await page.evaluate(() => (window as any).__lakeQA.frame());
  const gpu = await page.evaluate(() => (window as any).__lakeQA.gpuPilot());
  await writeFile(info.outputPath("lake-gpu.json"), JSON.stringify(gpu, null, 2)); console.log("[lake-gpu]", JSON.stringify(gpu));
  test.skip(!gpu.available, gpu.reason ?? "GPU timer unavailable");
  expect(gpu.additionalCalls).toBe(1); expect(gpu.frames).toBe(300);
});


test("Water F4 hardware combined Lake River foam caustics and resource lifetime",async({page,request},info)=>{
  test.skip(!process.env.FORGE_WATER_F4,"Run using playwright.water.config.ts with FORGE_WATER_F4=1");
  test.setTimeout(600_000);
  const {errors}=await setup(page,request,true,false,false,false,true,true,false,true,true,false,true);await ready(page,180_000);
  const before=await terrainHash();
  const expand=async(id:string)=>{const section=page.locator(`[data-detail-section="${id}"]`);if(await section.evaluate(e=>e.classList.contains("collapsed")))await section.locator('.detail-section-toggle').click();};
  await page.locator('[data-object-id="lake:0"]').click();await expand("lake-geometry-foam");await page.locator('[data-geometry-foam-calculate]').click();
  await expect.poll(async()=>(await snapshot(page)).baked[0]?.active,{timeout:90_000}).toBe(true);
  await page.getByTestId("outliner-row").filter({hasText:"Lake QA Terrain"}).first().click();await page.locator('[data-river-water-create]').click();
  await expand("lake-geometry-foam");await page.locator('[data-geometry-foam-calculate]').click();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active,{timeout:90_000}).toBe(true);
  await expand("river-caustics");await page.getByRole('checkbox',{name:'River Caustics Enabled'}).check();
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
  const lifecycle=[];
  for(let i=0;i<20;i++) {
    await page.locator('[data-geometry-foam-clear]').click();await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(false);
    await page.getByTestId("editor-undo").click();await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);
    lifecycle.push(await page.evaluate(()=>(window as any).__lakeQA.resources()));
  }
  await save(page);expect(await terrainHash()).toBe(before);
  await page.setViewportSize({width:1920,height:1080});
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html",{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page,180_000);
  await expect.poll(async()=>(await snapshot(page)).riverBaked[0]?.active).toBe(true);await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);
  const frame=(reverse=false,enabled=true,time=0,night=false)=>page.evaluate(args=>(window as any).__lakeQA.effectsFrame(...args),[reverse,enabled,time,night]);
  const off=await frame(false,false),on=await frame();await page.screenshot({path:info.outputPath("water-f4-front.png")});
  const moved=await frame(false,true,4);await page.screenshot({path:info.outputPath("water-f4-motion.png")});
  await frame(true);await page.screenshot({path:info.outputPath("water-f4-reverse.png")});
  await frame(false,true,0,true);await page.screenshot({path:info.outputPath("water-f4-night.png")});await frame();
  expect(on.glError).toBe(0);expect(on.samples.filter((v:number,i:number)=>Math.abs(v-off.samples[i])>3).length).toBeGreaterThan(30);
  expect(moved.samples.filter((v:number,i:number)=>Math.abs(v-on.samples[i])>3).length).toBeGreaterThan(30);
  const gpu=[];for(const mode of ["caustics","foam","all"])gpu.push(await page.evaluate(mode=>(window as any).__lakeQA.effectsGpuPilot(mode),mode));
  const client=await page.context().newCDPSession(page);await client.send("HeapProfiler.collectGarbage");const heap=await client.send("Runtime.getHeapUsage");await client.detach();
  const report={capturedAt:new Date().toISOString(),browser:page.context().browser()?.version(),viewport:[1920,1080],lifecycle,gpu,heap,
    resources:await page.evaluate(()=>(window as any).__lakeQA.resources()),snapshot:await snapshot(page),errors,
    limitations:["Synthetic 2x2 terrain with one Lake and one sloped River; not large-world acceptance","GPU bytes count owned texture arrays plus mip estimates; not driver VRAM peak","Human desktop visual acceptance is separate"]};
  await writeFile(info.outputPath("water-f4.json"),JSON.stringify(report,null,2));
  expect(gpu.every(g=>g.available),"hardware timer required for F4").toBe(true);expect(errors).toEqual([]);
  expect(lifecycle.at(-1)!.gpuEffectWithMipsBytes).toBe(lifecycle[0]!.gpuEffectWithMipsBytes);
  expect(lifecycle.at(-1)!.textures).toBeLessThanOrEqual(lifecycle[0]!.textures);
});
