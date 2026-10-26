# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terrain-spline-editor.spec.ts >> streamed river rejects an unreadable remote bed without invented water and rebuilds on retry
- Location: tests\smoke\terrain-spline-editor.spec.ts:183:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic:
    - generic:
      - banner [ref=e3]:
        - generic [ref=e4]:
          - generic [ref=e5]:
            - generic [ref=e6]: F
            - generic [ref=e7]:
              - strong [ref=e8]: Forge
              - 'generic "Active level: layouts/__playwright-spline-world.level.json" [ref=e9]': ·__playwright-spline-world
          - button "Menu" [ref=e10] [cursor=pointer]:
            - img
        - generic [ref=e11]:
          - generic [ref=e12]:
            - button "Save Layout" [ref=e13] [cursor=pointer]:
              - img
            - button "Undo Edit River Water" [ref=e14] [cursor=pointer]:
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
            - button "Graphics quality" [ref=e56] [cursor=pointer]:
              - text: "Quality:"
              - generic [ref=e57]: Auto
              - img [ref=e58]
            - button "Show flags" [ref=e61] [cursor=pointer]:
              - text: Show
              - img [ref=e62]
            - button "Play" [ref=e65] [cursor=pointer]:
              - img [ref=e66]
              - generic [ref=e68]: Play
      - complementary [ref=e69]:
        - tablist "Outliner panels" [ref=e70]:
          - tab "Scene Outliner" [selected] [ref=e71] [cursor=pointer]
        - tabpanel [ref=e72]:
          - generic [ref=e73]:
            - generic [ref=e74]:
              - img
              - searchbox "Search actors" [ref=e75]
            - button "Filter scene objects" [ref=e77] [cursor=pointer]:
              - img [ref=e78]
          - generic [ref=e80]:
            - generic [ref=e81] [cursor=pointer]:
              - img [ref=e83]
              - strong [ref=e87]: Player Start
              - generic [ref=e88]:
                - button "Hide object" [ref=e89]:
                  - img [ref=e90]
                - button "Lock object" [ref=e93]:
                  - img [ref=e94]
            - generic [ref=e97] [cursor=pointer]:
              - img [ref=e99]
              - strong [ref=e103]: sun
              - generic [ref=e104]:
                - button "Hide object" [ref=e105]:
                  - img [ref=e106]
                - button "Lock object" [ref=e109]:
                  - img [ref=e110]
            - generic [ref=e113] [cursor=pointer]:
              - img [ref=e115]
              - strong [ref=e118]: Spline World
              - generic [ref=e119]:
                - button "Hide object" [ref=e120]:
                  - img [ref=e121]
                - button "Lock object" [ref=e124]:
                  - img [ref=e125]
          - generic [ref=e128]: 3 actors (1 selected)
      - complementary [ref=e129]:
        - tablist "Inspector" [ref=e130]:
          - tab "Details" [selected] [ref=e131] [cursor=pointer]
          - tab "Mesh Paint" [ref=e132] [cursor=pointer]
          - tab "Foliage" [ref=e133] [cursor=pointer]
        - generic [ref=e135]:
          - generic [ref=e136]:
            - generic [ref=e137]: Name
            - textbox "Name Collapse all sections" [ref=e138]:
              - /placeholder: Landscape
              - text: Spline World
            - button "Collapse all sections" [ref=e139] [cursor=pointer]:
              - img [ref=e140]
          - generic [ref=e142]:
            - generic [ref=e143]: Location
            - generic [ref=e144]:
              - generic [ref=e145]:
                - generic [ref=e146]: X
                - spinbutton "X" [disabled] [ref=e147]: "0"
              - generic [ref=e148]:
                - generic [ref=e149]: "Y"
                - spinbutton "Y" [disabled] [ref=e150]: "5"
              - generic [ref=e151]:
                - generic [ref=e152]: Z
                - spinbutton "Z" [disabled] [ref=e153]: "-128"
          - generic [ref=e154]:
            - generic [ref=e155]: Rotation
            - generic [ref=e156]:
              - generic [ref=e157]:
                - generic [ref=e158]: X
                - spinbutton "X" [disabled] [ref=e159]: "0"
              - generic [ref=e160]:
                - generic [ref=e161]: "Y"
                - spinbutton "Y" [disabled] [ref=e162]: "0"
              - generic [ref=e163]:
                - generic [ref=e164]: Z
                - spinbutton "Z" [disabled] [ref=e165]: "0"
          - generic [ref=e166]:
            - button "Landscape Mode" [expanded] [ref=e168] [cursor=pointer]:
              - img [ref=e170]
              - generic [ref=e172]: Landscape Mode
            - generic [ref=e173]:
              - generic [ref=e174]:
                - generic [ref=e175]: Mode
                - combobox "Landscape edit mode" [ref=e176]:
                  - option "Sculpt"
                  - option "Paint"
                  - option "Splines" [selected]
              - generic [ref=e177]: Landscape Splines
              - group "Landscape spline tool" [ref=e178]:
                - button "Draw" [ref=e179] [cursor=pointer]
                - button "Edit Points" [ref=e180] [cursor=pointer]
              - generic [ref=e181]: "Draw: click the terrain to add connected control points. Click near an existing point to weld — close a loop (click the first point), branch (select a mid point, then click), or fork onto another spline's point (the two merge into one)."
              - button "spline-1 2 pts" [ref=e183] [cursor=pointer]:
                - generic [ref=e184]: spline-1
                - generic [ref=e185]: 2 pts
              - generic [ref=e186]:
                - button "New Spline" [ref=e187] [cursor=pointer]
                - button "Delete Spline" [ref=e188] [cursor=pointer]
                - button "Close Loop" [ref=e189] [cursor=pointer]
              - generic [ref=e190]:
                - generic [ref=e191]: Brush Size
                - spinbutton "Brush Size" [ref=e192]: "6"
              - generic [ref=e193]:
                - generic [ref=e194]: Strength
                - spinbutton "Strength" [ref=e195]: "0.25"
              - generic [ref=e196]:
                - generic [ref=e197]: Falloff
                - spinbutton "Falloff" [ref=e198]: "2"
              - generic [ref=e199]:
                - generic [ref=e200]: View
                - combobox "View" [ref=e201]:
                  - option "Lit" [selected]
                  - option "Height"
                  - option "Slope"
                  - option "Layer Weight"
          - generic [ref=e202]: Control points use world coordinates. Draw places points on the terrain. Apply changes the terrain; moving or deleting a spline keeps previously applied edits.
          - generic [ref=e203]:
            - button "Others" [expanded] [ref=e205] [cursor=pointer]:
              - img [ref=e207]
              - generic [ref=e209]: Others
            - generic [ref=e210]:
              - generic [ref=e211] [cursor=pointer]:
                - checkbox "Collision" [checked] [ref=e212]
                - generic [ref=e213]: Collision
              - generic [ref=e214] [cursor=pointer]:
                - checkbox "Lock Movement" [ref=e215]
                - generic [ref=e216]: Lock Movement
          - generic [ref=e217]:
            - button "River Water" [expanded] [ref=e219] [cursor=pointer]:
              - img [ref=e221]
              - generic [ref=e223]: River Water
            - generic [ref=e224]:
              - button "River Water 1 spline-1" [ref=e226] [cursor=pointer]:
                - generic [ref=e227]: River Water 1
                - generic [ref=e228]: spline-1
              - generic [ref=e229]: Water presentation is linked to this Landscape's spline; terrain shape remains authored by Landscape Splines.
              - button "Delete River Water" [ref=e231] [cursor=pointer]
              - generic [ref=e232]: Surface
              - generic [ref=e233]:
                - generic [ref=e234]: Water Height (World Y)
                - spinbutton "Water Height (World Y)" [ref=e235]: "7"
              - generic [ref=e236]: This is the horizontal water height in world space.
              - generic [ref=e237]:
                - generic [ref=e238]: Width Scale
                - spinbutton "Width Scale" [ref=e239]: "1"
              - generic [ref=e240]:
                - generic [ref=e241]: Deep Color
                - textbox "Deep Color" [ref=e242]: "#063447"
              - generic [ref=e243]:
                - generic [ref=e244]: Shallow Color
                - textbox "Shallow Color" [ref=e245]: "#2f8b91"
              - generic [ref=e246]:
                - generic [ref=e247]: Opacity
                - spinbutton "Opacity" [ref=e248]: "0.82"
              - generic [ref=e249]:
                - generic [ref=e250]: Bed Visibility
                - spinbutton "Bed Visibility" [ref=e251]: "0.05"
              - generic [ref=e252]:
                - generic [ref=e253]: Absorption Distance
                - spinbutton "Absorption Distance" [ref=e254]: "0.5"
              - generic [ref=e255]: Bed Visibility 0 hides the riverbed; 1 leaves it clear. Lower Absorption Distance makes deeper water opaque sooner.
              - generic [ref=e256]: Flow & Waves
              - generic [ref=e257]:
                - generic [ref=e258]: Flow Speed
                - spinbutton "Flow Speed" [ref=e259]: "0.35"
              - generic [ref=e260]:
                - generic [ref=e261]: Normal Scale
                - spinbutton "Normal Scale" [ref=e262]: "1"
              - generic [ref=e263]:
                - generic [ref=e264]: Wave Amplitude
                - spinbutton "Wave Amplitude" [ref=e265]: "0.04"
              - generic [ref=e266]:
                - generic [ref=e267]: Wave Length
                - spinbutton "Wave Length" [ref=e268]: "3.5"
              - generic [ref=e269]: Foam
              - generic [ref=e270]:
                - generic [ref=e271]: Foam Color
                - textbox "Foam Color" [ref=e272]: "#e8fff5"
              - generic [ref=e273]:
                - generic [ref=e274]: Foam Opacity
                - spinbutton "Foam Opacity" [ref=e275]: "0.92"
              - generic [ref=e276]:
                - generic [ref=e277]: Band Spacing
                - spinbutton "Band Spacing" [ref=e278]: "5"
              - generic [ref=e279]:
                - generic [ref=e280]: Inward Speed
                - spinbutton "Inward Speed" [ref=e281]: "0.34"
              - generic [ref=e282]:
                - generic [ref=e283]: Shore Wave Reach
                - spinbutton "Shore Wave Reach" [ref=e284]: "0.36"
              - generic [ref=e285]:
                - generic [ref=e286]: Breakup Scale
                - spinbutton "Breakup Scale" [ref=e287]: "1.25"
              - generic [ref=e288]: Radial Foam uses the same color, opacity, band spacing, speed, reach and breakup as shore waves.
              - button "+ Add Radial Foam" [ref=e290] [cursor=pointer]
              - generic [ref=e292]: Add Radial Foam for rocks and piers.
              - generic [ref=e293]: Reflection
              - generic [ref=e294]:
                - generic [ref=e295]: Mode
                - combobox "Mode" [ref=e296]:
                  - option "Off" [selected]
                  - option "Shared Planar"
              - generic [ref=e297]:
                - generic [ref=e298]: Group
                - textbox "Group" [ref=e299]:
                  - /placeholder: river
              - generic [ref=e300]:
                - generic [ref=e301]: Quality
                - combobox "Quality" [ref=e302]:
                  - option "low"
                  - option "medium" [selected]
                  - option "high"
              - generic [ref=e303]:
                - generic [ref=e304]: Strength
                - spinbutton "Strength" [ref=e305]: "0.34"
              - generic [ref=e306]: Quality only buys resolution and update rate. Strength is what makes the reflection visible; the surface still fades it in shallow water and under foam.
          - generic [ref=e307]:
            - button "Add River Water" [expanded] [ref=e309] [cursor=pointer]:
              - img [ref=e311]
              - generic [ref=e313]: Add River Water
            - generic [ref=e314]:
              - generic [ref=e315]:
                - generic [ref=e316]: Source Spline
                - combobox "Source Spline" [disabled] [ref=e317]:
                  - option "No completed unbound spline" [selected]
              - button "Create River Water" [disabled] [ref=e318]
              - generic [ref=e319]: A spline needs at least two connected control points. One water body can own each spline.
          - generic [ref=e321]:
            - generic [ref=e322]:
              - strong [ref=e323]: Göl
              - generic [ref=e324]: Göl ekle
            - generic [ref=e325]: Sculpt ile bir çukur hazırlayın. Çukurun içine tıklayarak su ekleyin; kıyıyı arazi şekli belirler.
            - button "Göl ekle" [ref=e326] [cursor=pointer]:
              - img [ref=e328]
              - generic [ref=e330]: Göl ekle
      - generic:
        - button [ref=e333] [cursor=pointer]:
          - img [ref=e335]
          - strong [ref=e337]: CONTENT DRAWER
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
  99  |     const status = page.getByTestId("editor-status");
  100 |     await expect(status).toContainText("Saved", { timeout: 30_000 });
  101 |     if (!(await status.innerText()).includes("pending")) return;
  102 |   }
  103 |   throw new Error("Sidecar edits remained pending after three Save actions");
  104 | }
  105 | const readDef = async (): Promise<WorldTerrainDef> => JSON.parse(await readFile(smokePublicPath(TERRAIN), "utf8"));
  106 | const readTile = async (key: string) => decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));
  107 | const riverSnapshot = (page: Page) => page.evaluate(() => (window as any).__riverQA.snapshot());
  108 | 
  109 | test("multi-tile river UI, exact sculpt depth, foam and flow survive undo, Save/Reload and runtime", async ({ page, request }, info) => {
  110 |   test.setTimeout(480_000);
  111 |   page.setDefaultTimeout(20_000);
  112 |   const { errors } = await setup(page, request, false, true, false, true);
  113 |   await page.locator('[data-landscape-spline="spline-1"]').click();
  114 |   await page.locator("[data-river-water-create]").click();
  115 |   await expect.poll(async () => (await riverSnapshot(page)).waters.length).toBe(1);
  116 |   await page.getByTestId("editor-undo").click();
  117 |   await expect.poll(async () => (await riverSnapshot(page)).waters.length).toBe(0);
  118 |   await page.getByTestId("editor-redo").click();
  119 |   const height = page.locator('[data-river-water-number="surfaceLevel"]');
  120 |   await height.fill("7"); await height.press("Enter");
  121 |   const flow = page.locator('[data-river-water-number="flowSpeed"]');
  122 |   await flow.fill("1.2"); await flow.press("Enter");
  123 |   await page.locator('[data-river-water-reflection="reflectionMode"]').selectOption("sharedPlanar");
  124 |   await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.samples[0]?.y).toBe(7);
  125 |   await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.reflection).toBeGreaterThan(0);
  126 |   const initial = (await riverSnapshot(page)).waters[0];
  127 |   expect(initial.position).toEqual([0, 5, 0]); expect(initial.flowSpeed).toBe(1.2);
  128 |   expect(initial.samples.every((sample: any) => sample.depth === 2 && sample.flow[0] === 1)).toBe(true);
  129 | 
  130 |   // The river bed uses the existing multi-tile patch/undo path.
  131 |   const offset = page.locator('[data-landscape-segment-number="deform.targetOffset"]');
  132 |   await offset.fill("-1"); await offset.press("Enter");
  133 |   await page.locator("[data-landscape-spline-apply-deform]").click();
  134 |   await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);
  135 |   await page.getByTestId("editor-undo").click();
  136 |   await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(2);
  137 |   await page.getByTestId("editor-redo").click();
  138 |   await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);
  139 | 
  140 |   // A real sculpt stroke must invalidate the cached bed too, without changing the water plane.
  141 |   await page.locator("[data-landscape-mode]").selectOption("sculpt");
  142 |   await page.locator('[data-landscape-tool="lower"]').click();
  143 |   const view = (await page.locator("[data-viewport-host]").boundingBox())!;
  144 |   await page.mouse.move(view.x + view.width * 0.5, view.y + view.height * 0.5);
  145 |   await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  146 |   await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBeGreaterThan(3);
  147 |   await page.getByTestId("editor-undo").click();
  148 |   await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);
  149 |   await page.locator("[data-landscape-mode]").selectOption("splines");
  150 |   await page.locator('[data-river-water-foam-add="ring"]').click();
  151 |   await page.mouse.click(view.x + view.width * 0.5, view.y + view.height * 0.5);
  152 |   await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.foam.length).toBe(1);
  153 |   const lock = page.locator('[data-detail-toggle="locked"]');
  154 |   await lock.check(); await expect(height).toBeDisabled();
  155 |   await lock.uncheck(); await expect(height).toBeEnabled();
  156 |   await save(page);
  157 |   const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  158 |   expect(saved.riverWaters[0].coordinateSpace).toBe("world"); expect(saved.riverWaters[0].surfaceLevel).toBe(7);
  159 |   const editor = (await riverSnapshot(page)).waters[0];
  160 |   expect(editor.foam[0].world[1]).toBeCloseTo(7.025, 5);
  161 |   const time = editor.time;
  162 |   await expect.poll(async () => (await riverSnapshot(page)).waters[0].time).toBeGreaterThan(time + 0.2);
  163 |   await page.screenshot({ path: info.outputPath("world-river-editor.png") });
  164 |   await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  165 |   await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  166 |   await page.locator("[data-landscape-mode]").selectOption("splines");
  167 |   await expect(height).toHaveValue("7"); await expect(flow).toHaveValue("1.2");
  168 |   await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.triangles).toBe(editor.triangles);
  169 |   await page.goto("/tests/smoke/pages/terrain-spline-runtime.html", { waitUntil: "domcontentloaded" });
  170 |   await expect.poll(async () => page.evaluate(() => Boolean((window as any).__riverQA)), { timeout: 90_000 }).toBe(true);
  171 |   const runtime = (await riverSnapshot(page)).waters[0];
  172 |   expect(runtime.samples).toEqual(editor.samples); expect(runtime.foam).toEqual(editor.foam);
  173 |   expect(runtime.position).toEqual(editor.position); expect(runtime.reflection).toBeGreaterThan(0);
  174 |   await page.evaluate(() => (window as any).__riverQA.frame());
  175 |   await page.screenshot({ path: info.outputPath("world-river-runtime.png") });
  176 |   await page.setViewportSize({ width: 1100, height: 720 });
  177 |   await page.evaluate(() => (window as any).__riverQA.frame());
  178 |   await page.screenshot({ path: info.outputPath("world-river-runtime-small.png") });
  179 |   await writeFile(info.outputPath("world-river.json"), JSON.stringify({ editor, runtime }, null, 2));
  180 |   expect(errors).toEqual([]);
  181 | });
  182 | 
  183 | test("streamed river rejects an unreadable remote bed without invented water and rebuilds on retry", async ({ page, request }, info) => {
  184 |   const { errors, def } = await setup(page, request, true, false, false, true);
  185 |   await expect.poll(async () => (await riverSnapshot(page)).streamingPending, { timeout: 60_000 }).toBe(0);
  186 |   const before = await riverSnapshot(page); expect(before.resident[0]).toBeLessThan(def.tiles.length);
  187 |   const writes: string[] = [];
  188 |   page.on("request", (req) => { if (req.url().includes("/__save-terrain-tile")) writes.push(req.url()); });
  189 |   await page.route("**/__playwright-spline-world.tiles/10_0.tile.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  190 |   const failedTile = page.waitForResponse((response) => response.url().endsWith("/__playwright-spline-world.tiles/10_0.tile.bin") && response.status() === 503);
  191 |   await page.locator("[data-river-water-create]").click();
  192 |   // Autosave may replace the transient status text before a polling assertion.
  193 |   // The controlled 503 and absent body are durable witnesses of the failure.
  194 |   expect((await failedTile).status()).toBe(503);
  195 |   expect((await riverSnapshot(page)).waters).toEqual([]); expect(writes).toEqual([]);
  196 |   await page.unroute("**/__playwright-spline-world.tiles/10_0.tile.bin");
  197 |   const height = page.locator('[data-river-water-number="surfaceLevel"]');
  198 |   await height.fill("7"); await height.press("Enter");
> 199 |   await expect.poll(async () => (await riverSnapshot(page)).waters.length, { timeout: 30_000 }).toBe(1);
      |                                                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  200 |   const snapshot = await riverSnapshot(page);
  201 |   expect(snapshot.resident).toEqual(before.resident);
  202 |   expect(snapshot.waters[0].samples.every((sample: any) => sample.y === 7 && sample.depth === 2)).toBe(true);
  203 |   expect(writes).toEqual([]);
  204 |   await page.screenshot({ path: info.outputPath("streamed-river-retry.png") });
  205 |   await writeFile(info.outputPath("streamed-river.json"), JSON.stringify(snapshot, null, 2));
  206 |   expect(errors).toEqual([expect.stringMatching(/503/)]);
  207 | });
  208 | 
  209 | test("multi-tile spline Draw, point gizmo and snap survive Save and reload", async ({ page, request }, info) => {
  210 |   const writes: string[] = [];
  211 |   page.on("request", (req) => { const key = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/); if (key) writes.push(key[1]!); });
  212 |   const { errors } = await setup(page, request);
  213 |   await page.locator("[data-landscape-spline-create]").click();
  214 |   const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  215 |   const first = { x: viewport.x + viewport.width * 0.37, y: viewport.y + viewport.height * 0.5 };
  216 |   await page.mouse.click(first.x, first.y);
  217 |   await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(1);
  218 |   await page.mouse.click(viewport.x + viewport.width * 0.63, first.y);
  219 |   await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(2);
  220 |   await expect(page.locator("[data-landscape-spline-segment]")).toHaveCount(1);
  221 |   await save(page);
  222 |   const initial = await readDef();
  223 |   expect(initial.splines![0]!.coordinateSpace).toBe("world");
  224 |   expect(initial.splines![0]!.points[0]!.position[0]).toBeLessThan(0);
  225 |   expect(initial.splines![0]!.points[1]!.position[0]).toBeGreaterThan(0);
  226 |   expect(initial.splines![0]!.points.map((point) => point.position[1])).toEqual([5, 5]);
  227 |   expect(writes, "point edits save only the definition/global map").toEqual([]);
  228 |   console.log("[spline-editor] authored points saved across the seam");
  229 | 
  230 |   await page.locator('[data-landscape-spline-tool="edit"]').click();
  231 |   await page.locator('[data-landscape-spline-point="point-1"]').click();
  232 |   const x = page.locator('[data-landscape-spline-point-axis="x"]');
  233 |   const beforeX = Number(await x.inputValue());
  234 |   await page.mouse.move(first.x, first.y);
  235 |   await expect.poll(() => page.locator("#game-canvas").evaluate((canvas) => canvas.style.cursor)).toBe("pointer");
  236 |   await page.mouse.down();
  237 |   await page.mouse.move(first.x + 34, first.y - 20, { steps: 8 });
  238 |   await page.mouse.up();
  239 |   await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Move Landscape Spline Point");
  240 |   expect(Number(await x.inputValue())).not.toBe(beforeX);
  241 |   const y = page.locator('[data-landscape-spline-point-axis="y"]');
  242 |   await y.fill("8"); await y.press("Enter");
  243 |   await page.locator("[data-landscape-spline-point-snap]").click();
  244 |   await expect(y).toHaveValue("5");
  245 |   const lock = page.locator('[data-detail-toggle="locked"]');
  246 |   await lock.check(); await expect(x).toBeDisabled();
  247 |   await lock.uncheck(); await expect(x).toBeEnabled();
  248 | 
  249 |   await save(page);
  250 |   const saved = await readDef();
  251 |   await page.screenshot({ path: info.outputPath("world-spline-edited.png") });
  252 |   await page.reload();
  253 |   await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  254 |   await page.locator("[data-landscape-mode]").selectOption("splines");
  255 |   await page.locator('[data-landscape-spline="spline-1"]').click();
  256 |   await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(2);
  257 |   await save(page);
  258 |   expect((await readDef()).splines).toEqual(saved.splines);
  259 |   expect(writes, "gizmo and snap still save no terrain tiles").toEqual([]);
  260 |   expect(errors).toEqual([]);
  261 | });
  262 | 
  263 | test("multi-tile spline seam bake supports exact undo/redo and persists after reload", async ({ page, request }, info) => {
  264 |   const writes: string[] = [];
  265 |   page.on("request", (req) => { const key = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/); if (key) writes.push(key[1]!); });
  266 |   const { errors } = await setup(page, request, false, true);
  267 |   await page.locator('[data-landscape-spline="spline-1"]').click();
  268 | 
  269 |   const flag = (key: string) => page.locator(`[data-landscape-segment-flag="${key}"]`);
  270 |   await flag("deform.enabled").check();
  271 |   const offset = page.locator('[data-landscape-segment-number="deform.targetOffset"]');
  272 |   await offset.fill("2"); await offset.press("Enter");
  273 |   await flag("paint.enabled").check();
  274 |   await page.locator("[data-landscape-segment-layer]").selectOption("rock");
  275 |   await page.locator("[data-landscape-spline-apply-deform]").click();
  276 |   await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Apply Spline Terrain Deform");
  277 |   await page.locator("[data-landscape-spline-apply-paint]").click();
  278 |   await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Apply Spline Layer Paint");
  279 |   await save(page);
  280 |   expect([...new Set(writes)].sort()).toEqual(["0_0", "1_0"]);
  281 |   console.log("[spline-editor] deform and paint saved to the two corridor tiles");
  282 |   const baked = await Promise.all([readTile("0_0"), readTile("1_0")]);
  283 |   expect(baked.every((tile) => tile.heights.some((height) => height > 1.9))).toBe(true);
  284 |   expect(baked.every((tile) => tile.weights.some((weight, index) => index % 4 === 1 && weight > 200))).toBe(true);
  285 |   for (let z = 0; z < 65; z++) {
  286 |     expect(baked[0]!.heights[z * 65 + 64]).toBe(baked[1]!.heights[z * 65]);
  287 |     for (let channel = 0; channel < 4; channel++) expect(baked[0]!.weights[(z * 65 + 64) * 4 + channel]).toBe(baked[1]!.weights[z * 65 * 4 + channel]);
  288 |   }
  289 |   await page.getByTestId("editor-undo").click();
  290 |   await page.getByTestId("editor-undo").click();
  291 |   await save(page);
  292 |   for (const key of ["0_0", "1_0"]) {
  293 |     const tile = await readTile(key);
  294 |     expect(tile.heights.every((height) => height === 0)).toBe(true);
  295 |     expect(tile.weights.every((weight, index) => weight === (index % 4 === 0 ? 255 : 0))).toBe(true);
  296 |   }
  297 |   await page.getByTestId("editor-redo").click(); await page.getByTestId("editor-redo").click();
  298 |   await save(page);
  299 |   for (let i = 0; i < 2; i++) {
```