# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terrain-lake-editor.spec.ts >> Lake quality menu releases effects, preserves geometry and authored settings, and updates live Play
- Location: tests\smoke\terrain-lake-editor.spec.ts:146:1

# Error details

```
Test timeout of 300000ms exceeded.
```

```
Error: locator.click: Test timeout of 300000ms exceeded.
Call log:
  - waiting for locator('[data-quality-popover] button').filter({ hasText: 'Ultra' })
    - locator resolved to <button class="" type="button" data-quality-choice="ultra">Ultra</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic:
    - generic:
      - banner [ref=e3]:
        - generic [ref=e4]:
          - generic [ref=e5]:
            - generic [ref=e6]: F
            - generic [ref=e7]:
              - strong [ref=e8]: Forge
              - 'generic "Active level: layouts/__playwright-lake-world.level.json" [ref=e9]': ·__playwright-lake-world
          - button "Menu" [ref=e10] [cursor=pointer]:
            - img
        - generic [ref=e11]:
          - generic [ref=e12]:
            - button "Save Layout" [ref=e13] [cursor=pointer]:
              - img
            - button "Undo" [disabled] [ref=e14]:
              - img
            - button "Redo" [disabled] [ref=e15]:
              - img
            - button "Delete" [ref=e16] [cursor=pointer]:
              - img
          - button "Add actor" [ref=e19] [cursor=pointer]:
            - text: + Add Actor
            - img [ref=e20]
          - generic [ref=e22]:
            - button "Select" [ref=e23] [cursor=pointer]:
              - img
            - button "Move" [pressed] [ref=e24] [cursor=pointer]:
              - img
            - button "Rotate" [ref=e25] [cursor=pointer]:
              - img
            - button "Scale" [ref=e26] [cursor=pointer]:
              - img
            - button "World space" [ref=e27] [cursor=pointer]:
              - img
          - generic [ref=e28]:
            - generic [ref=e29] [cursor=pointer]:
              - checkbox "0.25"
              - generic [ref=e30]:
                - img
              - combobox "Move snap" [ref=e31]:
                - option "0.25" [selected]
                - option "0.5"
                - option "1"
            - generic [ref=e32] [cursor=pointer]:
              - checkbox "15°" [checked]
              - generic [ref=e33]:
                - img
              - combobox "Rotate snap" [ref=e34]:
                - option "5°"
                - option "10°"
                - option "15°" [selected]
                - option "30°"
                - option "45°"
                - option "90°"
            - generic [ref=e35] [cursor=pointer]:
              - checkbox "0.1" [checked]
              - generic [ref=e36]:
                - img
              - combobox "Scale snap" [ref=e37]:
                - option "0.05"
                - option "0.1" [selected]
                - option "0.25"
                - option "0.5"
                - option "1"
          - generic [ref=e38]:
            - button "Camera view" [ref=e40] [cursor=pointer]:
              - img [ref=e41]
              - generic [ref=e44]: Perspective
              - img [ref=e45]
            - button "View mode" [ref=e48] [cursor=pointer]:
              - img [ref=e49]
              - generic [ref=e52]: Lit
              - img [ref=e53]
            - generic [ref=e55]:
              - button "Graphics quality" [ref=e56] [cursor=pointer]:
                - text: "Quality:"
                - generic [ref=e57]: High
                - img [ref=e58]
              - generic [ref=e60]:
                - button "Auto" [ref=e61] [cursor=pointer]
                - button "Ultra" [ref=e62] [cursor=pointer]
                - button "High" [active] [ref=e63] [cursor=pointer]
                - button "Medium" [ref=e64] [cursor=pointer]
                - button "Low" [ref=e65] [cursor=pointer]
            - button "Show flags" [ref=e67] [cursor=pointer]:
              - text: Show
              - img [ref=e68]
            - button "Play" [ref=e71] [cursor=pointer]:
              - img [ref=e72]
              - generic [ref=e74]: Play
      - complementary [ref=e75]:
        - tablist "Outliner panels" [ref=e76]:
          - tab "Scene Outliner" [selected] [ref=e77] [cursor=pointer]
          - tab "World Partition" [ref=e78] [cursor=pointer]
          - tab "World Builder" [ref=e79] [cursor=pointer]
        - tabpanel [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - img
              - searchbox "Search actors" [ref=e83]
            - button "Filter scene objects" [ref=e85] [cursor=pointer]:
              - img [ref=e86]
          - generic [ref=e88]:
            - generic [ref=e89] [cursor=pointer]:
              - img [ref=e91]
              - strong [ref=e95]: Player Start
              - generic [ref=e96]:
                - button "Hide object" [ref=e97]:
                  - img [ref=e98]
                - button "Lock object" [ref=e101]:
                  - img [ref=e102]
            - generic [ref=e105] [cursor=pointer]:
              - img [ref=e107]
              - strong [ref=e111]: Lake foreground cube
              - generic [ref=e112]:
                - button "Hide object" [ref=e113]:
                  - img [ref=e114]
                - button "Lock object" [ref=e117]:
                  - img [ref=e118]
            - generic [ref=e121] [cursor=pointer]:
              - img [ref=e123]
              - strong [ref=e127]: sun
              - generic [ref=e128]:
                - button "Hide object" [ref=e129]:
                  - img [ref=e130]
                - button "Lock object" [ref=e133]:
                  - img [ref=e134]
            - generic [ref=e137] [cursor=pointer]:
              - img [ref=e139]
              - strong [ref=e143]: Lake QA
              - generic [ref=e144]:
                - button "Hide object" [ref=e145]:
                  - img [ref=e146]
                - button "Lock object" [ref=e149]:
                  - img [ref=e150]
            - generic [ref=e153] [cursor=pointer]:
              - img [ref=e155]
              - strong [ref=e158]: Lake QA Terrain
              - generic [ref=e159]:
                - button "Hide object" [ref=e160]:
                  - img [ref=e161]
                - button "Lock object" [ref=e164]:
                  - img [ref=e165]
          - generic [ref=e168]: 5 actors (1 selected)
      - complementary [ref=e169]:
        - tablist "Inspector" [ref=e170]:
          - tab "Details" [selected] [ref=e171] [cursor=pointer]
          - tab "Mesh Paint" [ref=e172] [cursor=pointer]
          - tab "Foliage" [ref=e173] [cursor=pointer]
        - generic [ref=e175]:
          - generic [ref=e176]:
            - button "Landscape Mode" [expanded] [ref=e178] [cursor=pointer]:
              - img [ref=e180]
              - generic [ref=e182]: Landscape Mode
            - generic [ref=e183]:
              - generic [ref=e184]:
                - generic [ref=e185]: Mode
                - combobox "Landscape edit mode" [ref=e186]:
                  - option "Sculpt"
                  - option "Paint"
                  - option "Splines"
                  - option "Water" [selected]
              - generic [ref=e187] [cursor=pointer]:
                - checkbox "Lock Movement" [ref=e188]
                - generic [ref=e189]: Lock Movement
          - generic [ref=e190]:
            - button "Water" [expanded] [ref=e192] [cursor=pointer]:
              - img [ref=e194]
              - generic [ref=e196]: Water
            - generic [ref=e197]:
              - generic "Nehir yüzeyinin izleyeceği, en az iki bağlı noktası olan spline. Her spline bir su kütlesine bağlanabilir." [ref=e198]:
                - generic [ref=e199]: Source Spline
                - combobox "Source Spline" [disabled] [ref=e200]:
                  - option "No completed unbound spline" [selected]
              - generic [ref=e201]:
                - button "Add River" [disabled] [ref=e202]
                - button "Add Lake" [ref=e203] [cursor=pointer]
              - button "Create Spline" [ref=e204] [cursor=pointer]
          - generic [ref=e205]:
            - button "Water Bodies" [expanded] [ref=e207] [cursor=pointer]:
              - img [ref=e209]
              - generic [ref=e211]: Water Bodies
            - button "Lake QA Lake" [ref=e214] [cursor=pointer]:
              - generic [ref=e215]: Lake QA
              - generic [ref=e216]: Lake
          - generic [ref=e217]:
            - button "River Water" [expanded] [ref=e219] [cursor=pointer]:
              - img [ref=e221]
              - generic [ref=e223]: River Water
            - generic [ref=e225]: Create a River Water Body from a completed Landscape spline. It will immediately use the spline's width and first control point height.
      - generic:
        - button [ref=e228] [cursor=pointer]:
          - img [ref=e230]
          - strong [ref=e232]: CONTENT DRAWER
        - navigation:
          - generic:
            - button:
              - generic: assets
        - generic:
          - generic:
            - generic: 0 items
          - generic:
            - strong: No matching content
            - generic: assets
```

# Test source

```ts
  56  |       if (!source) tile.heights.fill(6);
  57  |       const key = tileKey(x, z); doc.tiles.set(key, tile); doc.def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
  58  |     }
  59  |     doc.lake.seed[0] += 384; doc.lake.bounds.min[0] += 384; doc.lake.bounds.max[0] += 384;
  60  |     if (doc.lake.bed) for (const point of doc.lake.bed.points) point[0] += 384;
  61  |   }
  62  |   const write = async (path: string, data: string | Uint8Array) => { const p = smokePublicPath(path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data); };
  63  |   for (const [key, tile] of doc.tiles) await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  64  |   await write(TERRAIN, JSON.stringify(doc.def));
  65  |   await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(doc.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(doc.def, doc.tiles))));
  66  |   const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  67  |   if (wavePasses) level.postProcess = { ...level.postProcess, ao: { enabled: true, radius: 1, intensity: 1 }, dof: { enabled: true, focusDistance: 30, aperture: .01, maxBlur: .01 } };
  68  |   // Runtime creates its snapshot path only when post-processing is enabled.
  69  |   // Zero bloom strength retains neutral pixels while exercising that path.
  70  |   if (refractionCase) level.postProcess = { ...level.postProcess,
  71  |     bloom: { enabled: true, intensity: 0, threshold: 1, radius: 0 } };
  72  |   level.instances = level.instances.filter((g: { assetId: string }) => g.assetId === "marker:playerStart");
  73  |   level.instances[0].placements[0].position = [-20, 15, -12];
  74  |   if (foreground || caustics) level.instances.push({ assetId: "shape:cube", placements: [{ name: "Lake foreground cube", position: [-12, 17, -12], scale: [4, 4, 4] }] });
  75  |   if (caustics) { level.lights[0].castShadow = true; level.lights[0].cascadedShadows = true; }
  76  |   level.landscapes = [{ id: "terrain", name: "Lake QA Terrain", position: worldTerrainActorPosition(doc.def), dataRef: TERRAIN }];
  77  |   if(foamRocks) level.instances.push({assetId:"shape:cube",placements:[
  78  |     {name:"Foam Rock A",position:[-20,12,-12],scale:[4,4,4]},
  79  |     {name:"Foam Rock B",position:[-12,12,-18],scale:[6,3,2],rotation:[0,30,0]},
  80  |   ]});
  81  |   level.riverWaters = []; level.waterBodies = seeded ? [doc.lake] : [];
  82  |   level.actors = []; level.characters = [];
  83  |   await write(LEVEL, JSON.stringify(level)); expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  84  |   const camera = new PerspectiveCamera(); camera.position.set(0, 90, 85); camera.lookAt(0, 10, 0);
  85  |   await page.setViewportSize({ width: 1440, height: 900 });
  86  |   const settings = defaultUserSettings();
  87  |   // These feature regressions inspect authored effects at Ultra. Quality changes
  88  |   // made through the UI must survive Reload/Play rather than being reset by QA.
  89  |   const preferences = JSON.stringify({ schema: 1, updatedAt: new Date().toISOString(), payload: { ...settings,
  90  |     graphics: { ...settings.graphics, selectedQualityLevel: "ultra", manuallySelected: true, adaptiveOptimizationEnabled: false } } });
  91  |   await page.addInitScript(({ key, pose, preferences }) => {
  92  |     if (!localStorage.getItem("forge.userSettings")) localStorage.setItem("forge.userSettings", preferences);
  93  |     localStorage.setItem(key, pose);
  94  |   }, {
  95  |     key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }),
  96  |     preferences,
  97  |   });
  98  |   const errors: string[] = [];
  99  |   page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  100 |   await page.route("**/__project-dir/assets", (route) => route.fulfill({ json: { root: "assets", children: [] } }));
  101 |   await page.goto("/tests/smoke/pages/terrain-lake-editor.html?editor", { waitUntil: "domcontentloaded", timeout: caustics ? 180_000 : 90_000 });
  102 |   await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  103 |   await page.getByTestId("outliner-row").filter({ hasText: "Lake QA Terrain" }).first().click();
  104 |   await page.locator("[data-landscape-mode]").selectOption("water");
  105 |   return { doc, errors };
  106 | }
  107 | async function terrainHash() {
  108 |   const hash = createHash("sha256"); hash.update(await readFile(smokePublicPath(TERRAIN)));
  109 |   for (const key of ["0_0", "1_0", "0_1", "1_1"]) hash.update(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));
  110 |   return hash.digest("hex");
  111 | }
  112 | async function ready(page: Page, timeout = 60_000) { await expect.poll(async () => (await snapshot(page)).results[0]?.status, { timeout }).toBe("ready"); }
  113 | async function save(page: Page) {
  114 |   const button = page.getByTestId("editor-save"); await expect(button).toBeEnabled({ timeout: 120_000 });
  115 |   const response = page.waitForResponse((r) => r.request().method()==="POST"&&(r.url().endsWith("/__save-layout")||(r.url().includes("/__save-lake-foam?")&&r.status()>=400)), { timeout: 120_000 });
  116 |   await button.click(); const saved=await response;expect(saved.ok(),await saved.text()).toBeTruthy(); await expect(button).toBeEnabled({ timeout: 120_000 });
  117 | }
  118 |
  119 | test("Lake crest foam controls survive undo Save Reload and runtime", async ({ page, request }, info) => {
  120 |   test.setTimeout(240_000);
  121 |   const { errors } = await setup(page, request, true);
  122 |   await ready(page, 180_000);
  123 |   await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "crest-foam");
  124 |   const enabled = page.getByRole("checkbox", { name: "Lake Crest Foam Enabled" });
  125 |   await expect(enabled).toBeChecked();
  126 |   await number(page, "crestFoamStrength", .6); await number(page, "crestFoamThreshold", .5);
  127 |   await enabled.uncheck(); await page.getByTestId("editor-undo").click(); await expect(enabled).toBeChecked();
  128 |   await page.getByTestId("editor-redo").click(); await expect(enabled).not.toBeChecked();
  129 |   await ready(page); await save(page);
  130 |   const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  131 |   expect(saved.waterBodies[0].appearance).toMatchObject({ crestFoamEnabled: false, crestFoamStrength: .6, crestFoamThreshold: .5 });
  132 |   await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, 180_000);
  133 |   await page.locator('[data-object-id="lake:0"]').click(); await expandLake(page, "crest-foam");
  134 |   await expect(enabled).not.toBeChecked();
  135 |   await expect(page.locator('[data-lake-number="crestFoamStrength"]')).toHaveValue("0.6");
  136 |   await expect(page.locator('[data-lake-number="crestFoamThreshold"]')).toHaveValue("0.5");
  137 |   await enabled.scrollIntoViewIfNeeded();
  138 |   await page.screenshot({ path: info.outputPath("lake-crest-controls.png") });
  139 |   await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded" });
  140 |   await page.waitForFunction(() => Boolean((window as any).__lakeQA)); await ready(page, 180_000);
  141 |   const runtime = await snapshot(page);
  142 |   expect(runtime.source.appearance).toMatchObject({ crestFoamEnabled: false, crestFoamStrength: .6, crestFoamThreshold: .5 });
  143 |   expect(runtime.crestFoam[0]).toEqual({ strength: 0, threshold: .5 });
  144 |   expect(errors).toEqual([]);
  145 | });
  146 |
  147 | test("Lake quality menu releases effects, preserves geometry and authored settings, and updates live Play", async ({ page, request }, info) => {
  148 |   test.setTimeout(300_000);
  149 |   const { errors } = await setup(page, request, true, false, false, false, false, true, false, false, false, true);
  150 |   await ready(page);
  151 |   const quality = (p: Page) => p.evaluate(() => (window as any).__lakeQA.quality());
  152 |   const before = await quality(page), terrainBefore = await terrainHash();
  153 |   const geometry = before.objects[0].geometry, authored = before.source;
  154 |   type Level = "Low" | "Medium" | "High" | "Ultra";
  155 |   const pick = async (label: Level) => {
> 156 |     await page.getByTestId("quality-button").hover();
      |                                                                             ^ Error: locator.click: Test timeout of 300000ms exceeded.
  157 |     await page.locator("[data-quality-popover] button", { hasText: label }).click();
  158 |     await expect(page.locator("[data-quality-label]")).toHaveText(label);
  159 |   };
  160 |   const verify = async (p: Page, level: Level) => {
  161 |     const [caustics, wetShore, foam, reflection, rippleCount] = {
  162 |       Low: [0, 0, false, 0, 8], Medium: [0, 1, true, 0, 12], High: [1, 1, true, 256, 24], Ultra: [1, 1, true, 512, 24],
  163 |     }[level]!;
  164 |     await expect.poll(async () => {
  165 |       const s = await quality(p);
  166 |       return { caustics: s.caustics, wetShore: s.wetShore, foam: s.objects[0]?.foam, reflection: s.objects[0]?.reflection, errors: s.errors };
  167 |     }, { timeout: 45_000 }).toEqual({ caustics, wetShore, foam, reflection, errors: [] });
  168 |     const s = await quality(p); expect(s.glError).toBe(0); expect(s.source).toEqual(authored);
  169 |     expect(s.objects[0]).toMatchObject({ normal: true, waveHeight: before.objects[0].waveHeight, shoreBlend: before.objects[0].shoreBlend,
  170 |       surfaceStrength: before.objects[0].surfaceStrength });
  171 |     // Read the cap synchronously, before the next real physics step ages the QA waves.
  172 |     expect(await p.evaluate(() => (window as any).__lakeQA.qualityRipples())).toEqual([rippleCount]);
  173 |     return s;
  174 |   };
  175 |   const records = [];
  176 |   for (const level of ["Ultra", "Low", "Medium", "High", "Ultra", "Low"] as const) {
  177 |     await pick(level); const s = await verify(page, level);
  178 |     expect(s.objects[0].geometry).toBe(geometry); records.push({ level, ...s });
  179 |     await page.screenshot({ path: info.outputPath(`lake-quality-editor-${level.toLowerCase()}.png`) });
  180 |   }
  181 |   await save(page);
  182 |   const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  183 |   expect(saved.waterBodies[0].appearance).toEqual(authored[0].appearance);
  184 |   expect(await terrainHash()).toBe(terrainBefore);
  185 |   const play = await page.context().newPage();
  186 |   const resume = async () => {
  187 |     const button = play.getByRole("button", { name: "Resume", exact: true });
  188 |     if (await button.isVisible()) await button.click();
  189 |   };
  190 |   play.on("pageerror", e => errors.push(e.message));
  191 |   play.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  192 |   await play.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 120_000 });
  193 |   await play.waitForFunction(() => !!(window as any).__lakeQA, null, { timeout: 120_000 });
  194 |   await resume();
  195 |   await verify(play, "Low"); const runtimeGeometry = (await quality(play)).objects[0].geometry;
  196 |   for (const level of ["Medium", "High", "Ultra", "Low"] as const) {
  197 |     await page.bringToFront(); await pick(level); await play.bringToFront();
  198 |     await resume();
  199 |     const s = await verify(play, level); expect(s.objects[0].geometry).toBe(runtimeGeometry);
  200 |     records.push({ level: `Play ${level}`, ...s });
  201 |     await play.screenshot({ path: info.outputPath(`lake-quality-runtime-${level.toLowerCase()}.png`) });
  202 |   }
  203 |   await play.reload({ waitUntil: "domcontentloaded" });
  204 |   await play.waitForFunction(() => !!(window as any).__lakeQA, null, { timeout: 120_000 });
  205 |   await resume();
  206 |   await verify(play, "Low"); expect(errors).toEqual([]);
  207 |   await writeFile(info.outputPath("lake-quality.json"), JSON.stringify({ records, errors, authoredPreserved: true, terrainPreserved: true }, null, 2));
  208 | });
  209 |
  210 | test("Lake geometry foam Calculate Recalculate undo and binary Save Reload Play",async({page,request},info)=>{
  211 |   test.setTimeout(300_000);
  212 |   const {errors}=await setup(page,request,true,false,false,false,false,false,false,false,true);
  213 |   const before=await terrainHash();await ready(page);await page.locator('[data-object-id="lake:0"]').click();
  214 |   const section=page.locator('[data-detail-section="lake-geometry-foam"]');
  215 |   if(await section.evaluate(e=>e.classList.contains("collapsed")))await section.locator('.detail-section-toggle').click();
  216 |   const calculate=page.locator('[data-geometry-foam-calculate]');
  217 |   await expect(calculate).toHaveText("Calculate");
  218 |   await expect(calculate).toHaveAttribute("title",/hesaplar/);
  219 |   let reject=true;
  220 |   await page.route("**/__save-lake-foam?*",route=>reject?route.fulfill({status:503,body:"test save retry"}):route.continue());
  221 |   await calculate.click();
  222 |   await expect.poll(async()=>(await snapshot(page)).baked[0]?.active,{timeout:90_000}).toBe(true);
  223 |   const original=(await snapshot(page)).source.geometryFoam.bake.manifest;
  224 |   await expect(calculate).toHaveText("Recalculate");
  225 |   const failed=page.waitForResponse(r=>r.url().includes("/__save-lake-foam?")&&r.status()===503);
  226 |   await page.getByTestId("editor-save").click();await failed;
  227 |   const failedLevel=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8"));
  228 |   expect(failedLevel.waterBodies[0].geometryFoam?.bake).toBeUndefined();
  229 |   reject=false;await save(page);
  230 |   const settings=JSON.parse(await readFile(smokePublicPath(LEVEL),"utf8")).waterBodies[0].geometryFoam;
  231 |   const manifest=JSON.parse(await readFile(smokePublicPath(settings.bake.manifest),"utf8"));
  232 |   const bytes=await readFile(smokePublicPath(manifest.dataPath));
  233 |   expect(manifest.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));expect(manifest.metadata.sources).toBe(2);
  234 |   const invalid=await request.post(`/__save-lake-foam?level=${encodeURIComponent(LEVEL)}&hash=${"a".repeat(64)}`,{data:bytes,headers:{"Content-Type":"application/octet-stream"}});expect(invalid.status()).toBe(400);
  235 |   await page.getByTestId("outliner-row").filter({hasText:"Foam Rock A"}).first().click();
  236 |   await page.getByTestId("detail-px").fill("-16");await page.getByTestId("detail-px").press("Tab");
  237 |   await page.locator('[data-object-id="lake:0"]').click();
  238 |   await expect(page.locator('[data-geometry-foam-status]')).toContainText("Recalculation required");
  239 |   expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(original);
  240 |   await calculate.click();
  241 |   await expect.poll(async()=>(await snapshot(page)).source.geometryFoam.bake.manifest,{timeout:90_000}).not.toBe(original);
  242 |   const updated=(await snapshot(page)).source.geometryFoam.bake.manifest;
  243 |   await page.getByTestId("editor-undo").click();await ready(page);
  244 |   expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(original);
  245 |   await page.getByTestId("editor-redo").click();await ready(page);
  246 |   expect((await snapshot(page)).source.geometryFoam.bake.manifest).toBe(updated);
  247 |   await page.locator('[data-geometry-foam-clear]').click();await ready(page);
  248 |   await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(false);
  249 |   await page.getByTestId("editor-undo").click();await ready(page);
  250 |   await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);
  251 |   await save(page);await page.screenshot({path:info.outputPath("geometry-foam-editor.png")});
  252 |   await page.reload({waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
  253 |   await expect.poll(async()=>(await snapshot(page)).baked[0]?.active).toBe(true);
  254 |   expect(await terrainHash()).toBe(before);
  255 |   let writes=0;page.on("request",r=>{if(r.url().includes("/__save-lake-foam"))writes++;});
  256 |   await page.goto("/tests/smoke/pages/terrain-lake-runtime.html",{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!(window as any).__lakeQA);await ready(page);
```