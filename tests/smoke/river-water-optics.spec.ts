import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { OpticsOptions } from "./pages/river-water-optics";

type Snapshot = ReturnType<Window["__riverOptics"]["snapshot"]>;
const browserErrors = new WeakMap<Page, string[]>();
async function frame(page: Page, patch: Partial<OpticsOptions>) {
  return page.evaluate((options) => window.__riverOptics.frame(options), patch);
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const channel = (shot: Snapshot, c: number, edge = false) => mean((edge ? shot.edge : shot.centre).map((p) => p[c]!));
const contrast = (shot: Snapshot) => {
  const luminances = shot.centre.map((p) => mean(p));
  return Math.max(...luminances) - Math.min(...luminances);
};
async function evidence(info: TestInfo, name: string, data: unknown) {
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(data, null, 2));
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto("/tests/smoke/pages/river-water-optics.html");
  await page.waitForFunction(() => !!window.__riverOptics);
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test("water interface: clear river and lake preserve reflection energy through alpha blending", async ({ page }, info) => {
  const measurements = [];
  for (const kind of ["river", "lake"] as const) {
    const signals = [];
    for (const opacity of [1, 0]) {
      const red = await frame(page, { kind, isolateReflection: true, angle: "grazing", depth: 0.1,
        opacity, bedVisibility: 1, absorptionDistance: 100, reflection: "red", pipeline: "composer" });
      const blue = await frame(page, { reflection: "blue" });
      const signal = channel(red, 0) - channel(blue, 0);
      signals.push(signal); measurements.push({ kind, opacity, red, blue, signal });
    }
    // Black bed/body isolate interface energy from tint and output nonlinearity.
    // Clear water must retain the same reflected radiance as opaque water.
    expect(signals[0]!).toBeGreaterThan(15);
    expect(Math.abs(signals[1]! - signals[0]!)).toBeLessThan(3);
  }
  await evidence(info, "reflection-energy", measurements);
});

test("river optics: grazing reflection exceeds top-down, underside stays bounded", async ({ page }, info) => {
  const measurements: Record<string, unknown> = {};
  const signals: number[] = [];
  for (const angle of ["top", "grazing", "below"] as const) {
    const red = await frame(page, { angle, pipeline: "composer", depth: 2.2, opacity: 1, bedVisibility: 0, reflection: "red" });
    const blue = await frame(page, { reflection: "blue" });
    const signal = channel(red, 0) - channel(blue, 0);
    measurements[angle] = { red, blue, signal };
    signals.push(signal);
    await page.screenshot({ path: info.outputPath(`reflection-${angle}.png`) });
  }
  await evidence(info, "angle", measurements);
  expect(signals[0]!).toBeGreaterThanOrEqual(0);
  expect(signals[1]! - signals[0]!).toBeGreaterThan(15);
  expect(signals[2]!).toBeLessThan(3);
});

test("river optics: a 64px sphere capture blends with a 256px sky without new reflection targets", async ({ page }, info) => {
  const sky = await frame(page, { angle: "grazing", reflection: "red", bedVisibility: 0, opacity: 1, pipeline: "composer" });
  const probe = await frame(page, { localProbe: true });
  expect(channel(probe, 2) - channel(sky, 2)).toBeGreaterThan(10);
  expect(channel(sky, 0) - channel(probe, 0)).toBeGreaterThan(10);
  // First use can initialise a borrowed map. Rebinding must then stay stable.
  for (let i = 0; i < 4; i++) await frame(page, { localProbe: i % 2 === 0 });
  const rebound = await frame(page, { localProbe: true });
  expect(rebound.textures).toBe(probe.textures);
  await page.screenshot({ path: info.outputPath("sphere-capture.png") });
  await evidence(info, "sphere-capture", { sky, probe });
});

test("river optics: neutral direct and composer output agree at fixed exposure", async ({ page }, info) => {
  const shots = [];
  // Opaque isolates output conversion from screen-space alpha blending, which
  // naturally happens in different spaces on the two pipelines.
  for (const exposure of [0.2, 1]) {
    const direct = await frame(page, { calibration: true, opacity: 1, reflection: "off", exposure, pipeline: "direct" });
    const composer = await frame(page, { pipeline: "composer" });
    shots.push({ direct, composer });
    await frame(page, { pipeline: "direct" });
    await page.screenshot({ path: info.outputPath(`neutral-direct-${exposure}.png`) });
    await frame(page, { pipeline: "composer" });
    await page.screenshot({ path: info.outputPath(`neutral-composer-${exposure}.png`) });
  }
  await evidence(info, "output", shots);
  for (const { direct, composer } of shots) {
    expect(Math.max(...[0, 1, 2].map((c) => Math.abs(channel(direct, c) - channel(composer, c))))).toBeLessThan(3);
  }
});

test("river optics: sloped transformed surfaces preserve world-space optics and orthographic view", async ({ page }, info) => {
  const shots = [];
  for (const orthographic of [false, true]) {
    const base = await frame(page, { orthographic, slope: 0.12, normalMap: true,
      angle: "grazing", reflection: "red", opacity: 1, pipeline: "composer", transformed: false });
    const transformed = await frame(page, { transformed: true });
    shots.push({ base, transformed });
    expect(Math.max(...transformed.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - base.centre[i]![c]!))))).toBeLessThan(3);
    await page.screenshot({ path: info.outputPath(`sloped-${orthographic ? "ortho" : "perspective"}.png`) });
  }
  await evidence(info, "world-space", shots);
});

test("river optics: bed contrast decreases with depth and dry bed draws no water", async ({ page }, info) => {
  const shots: { depth: number; off: Snapshot; on: Snapshot; contrast: number }[] = [];
  for (const depth of [0, 0.1, 1, 2.2, 5]) {
    const off = await frame(page, { depth, visible: false, pipeline: "composer", reflection: "off" });
    const on = await frame(page, { visible: true });
    shots.push({ depth, off, on, contrast: contrast(on) });
    await page.screenshot({ path: info.outputPath(`depth-${depth}.png`) });
  }
  // The default nearly opaque preset must still meet the bed at a soft edge.
  const defaultShallow = await frame(page, { depth: 0.1, bedVisibility: 0.05, absorptionDistance: 0.5, opacity: 0.82 });
  await page.screenshot({ path: info.outputPath("default-shallow.png") });
  await evidence(info, "depth", { shots, defaultShallow });
  expect(contrast(shots[0]!.off)).toBeGreaterThan(50);
  expect(Math.max(...shots[0]!.on.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - shots[0]!.off.centre[i]![c]!))))).toBeLessThan(2);
  for (let i = 1; i < shots.length; i++) expect(shots[i]!.contrast).toBeLessThan(shots[i - 1]!.contrast - 2);
  expect(contrast(defaultShallow)).toBeGreaterThan(15);
});

test("river optics: deep ribbon edge has no false shallow colour or white foam outline", async ({ page }, info) => {
  const clear = await frame(page, { depth: 5, opacity: 1, foamOpacity: 0, pipeline: "composer", time: 2 });
  const foamy = await frame(page, { foamOpacity: 0.92 });
  await evidence(info, "edge", { clear, foamy });
  await page.screenshot({ path: info.outputPath("deep-edge.png") });
  for (const c of [0, 1, 2]) {
    expect(Math.abs(channel(clear, c, true) - channel(clear, c))).toBeLessThan(5);
    expect(Math.abs(channel(foamy, c, true) - channel(clear, c, true))).toBeLessThan(5);
  }
});

test("river optics: controls round-trip, animation survives, Off / Low stays target-free", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const first = await page.evaluate(() => window.__riverOptics.snapshot());
  await page.selectOption("#angle", "grazing");
  await expect(page.locator("#status")).toContainText("grazing");
  await page.selectOption("#pipeline", "composer");
  await page.selectOption("#depth", "5");
  await page.selectOption("#reflection", "red");
  await page.uncheck("#visible");
  expect((await page.evaluate(() => window.__riverOptics.snapshot())).options.visible).toBe(false);
  await page.check("#visible");
  await page.selectOption("#angle", "top");
  await page.selectOption("#pipeline", "direct");
  await page.selectOption("#depth", "1");
  await page.selectOption("#reflection", "off");
  const restored = await page.evaluate(() => window.__riverOptics.snapshot());
  expect(restored.centre).toEqual(first.centre);
  const calm = await frame(page, { normalMap: true, time: 0, opacity: 1, bedVisibility: 0,
    reflection: "red", angle: "grazing", exposure: 1, pipeline: "composer" });
  const flowing = await frame(page, { time: 2 });
  expect(Math.max(...flowing.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - calm.centre[i]![c]!))))).toBeGreaterThan(1);
  const stableTextures = flowing.textures;
  for (let i = 0; i < 8; i++) await frame(page, { depth: i % 2 ? 0.1 : 5 });
  const last = await frame(page, { depth: 1 });
  expect(last.textures).toBe(stableTextures);
  await page.setViewportSize({ width: 600, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("controls-small.png") });
  await evidence(info, "controls", { first, restored, calm, flowing, last, errors });
  expect(errors).toEqual([]);
});

test("lake optics: scene depth transmission preserves shallows, filters colour and releases copies", async ({ page }, info) => {
  const shots = [];
  for (const orthographic of [false, true]) {
    const off = await frame(page, { kind: "lake", sceneTransmission: true, pipeline: "composer",
      orthographic, depth: 0.1, visible: false, reflection: "off", opacity: 0, bedVisibility: 1, absorptionDistance: 3 });
    const shallow = await frame(page, { visible: true });
    expect(shallow.sceneTransmission).toBe(1);
    expect(shallow.glError).toBe(0);
    expect(contrast(shallow)).toBeGreaterThan(30);
    const deep = await frame(page, { depth: 5 });
    expect(deep.glError).toBe(0);
    expect(contrast(deep)).toBeLessThan(contrast(shallow) - 10);
    // A neutral bed becomes greener through spectral loss, rather than an
    // unfiltered checkerboard seen through a scalar alpha overlay.
    expect(channel(deep, 1) - channel(deep, 0)).toBeGreaterThan(3);
    // An oblique view can see a deep bed behind a shallow surface vertex.
    // Independently varying the actual bed catches using baked vertex depth
    // as if it were the screen ray's optical thickness.
    const realDeepBed = await frame(page, { depth: 0.1, sceneBedDepth: 5 });
    const bakedOnly = await frame(page, { sceneTransmission: false });
    expect(realDeepBed.sceneTransmission).toBe(1);
    expect(bakedOnly.sceneTransmission).toBe(0);
    expect(contrast(realDeepBed)).toBeLessThan(contrast(bakedOnly) - 10);
    // The alternate composer lazily initializes its own colour target. Warm
    // both pipelines before comparing repeated lake rebuild resource counts.
    const warmed = await frame(page, { sceneTransmission: true, sceneBedDepth: null, depth: 5 });
    const stableTextures = warmed.textures;
    for (let i = 0; i < 6; i++) await frame(page, { depth: i % 2 ? 0.1 : 5 });
    const rebuilt = await frame(page, { depth: 5 });
    expect(rebuilt.textures).toBe(stableTextures);
    const hidden = await frame(page, { visible: false });
    expect(hidden.textures).toBeLessThan(stableTextures);
    const restored = await frame(page, { visible: true });
    expect(restored.centre).toEqual(deep.centre);
    shots.push({ off, shallow, deep, realDeepBed, bakedOnly, warmed, rebuilt, hidden, restored });
    await page.screenshot({ path: info.outputPath(`lake-scene-depth-${orthographic ? "ortho" : "perspective"}.png`) });
  }
  await evidence(info, "lake-scene-depth", shots);
});

test("lake optics: the visible shoreline fades to the real bed despite deeper baked geometry", async ({ page }, info) => {
  const measurements = [];
  for (const orthographic of [false, true]) {
    const off = await frame(page, { kind: "lake", sceneTransmission: true, pipeline: "composer",
      orthographic, depth: 5, sceneBedDepth: 0, visible: false, reflection: "off",
      opacity: 0.35, bedVisibility: 0.9, absorptionDistance: 4 });
    const shots = [];
    for (const sceneBedDepth of [0, 0.005, 0.02, 0.1, 0.5, 2, 5]) {
      const on = await frame(page, { visible: true, sceneBedDepth });
      shots.push(on);
      expect(on.sceneTransmission).toBe(1);
      expect(on.glError).toBe(0);
    }
    const difference = (a: Snapshot, b: Snapshot) => Math.max(...a.centre.flatMap((p, i) => p.map((v, c) => Math.abs(v - b.centre[i]![c]!))));
    expect(difference(shots[0]!, off)).toBeLessThan(2);
    // Millimetres of water must not immediately acquire the deep mesh's colour
    // or opacity floor. The real bed can differ from the authored triangle.
    expect(difference(shots[1]!, off)).toBeLessThan(3);
    expect(contrast(shots[3]!)).toBeGreaterThan(contrast(shots[6]!) + 20);
    measurements.push({ orthographic, off, shots });
    await page.screenshot({ path: info.outputPath(`lake-shore-${orthographic ? "ortho" : "perspective"}.png`) });
  }
  await evidence(info, "lake-shore-thickness", measurements);
});


test("river sunlight: existing single/cascade shadows attenuate both sun terms, preserve IBL and fallback", async ({page}, info) => {
  const measurements = [];
  for (const shadowSystem of ["single", "cascade", "disabled"] as const) {
    for (const sunTerm of ["body", "glint", "ibl"] as const) {
      const clear = await frame(page, {sunTest:true, shadowSystem, sunTerm, shadowCaster:false,
        angle:"grazing", pipeline:"composer", depth:5, opacity:1, bedVisibility:0,
        normalMap:false, calibration:true, reflection:"red", exposure:1});
      const shadow = await frame(page, {shadowCaster:true});
      const differences = clear.centre.map((p,i) => mean(p)-mean(shadow.centre[i]!));
      measurements.push({shadowSystem,sunTerm,clear,shadow,differences});
      await evidence(info,"sun-shadow-progress",measurements);
      await page.screenshot({path:info.outputPath(`sun-${shadowSystem}-${sunTerm}.png`)});
      expect(shadow.glError).toBe(0);
      if (shadowSystem !== "disabled" && sunTerm !== "ibl") {
        expect(mean(differences.slice(0,3))).toBeGreaterThan(2);
        expect(Math.abs(mean(differences.slice(3)))).toBeLessThan(2);
      } else expect(Math.max(...differences.map(Math.abs))).toBeLessThan(2);
      await page.screenshot({path:info.outputPath(`sun-${shadowSystem}-${sunTerm}.png`)});
    }
  }
  await evidence(info,"sun-shadow",measurements);
});
test("River surface: flat interface matches Lake Fresnel energy at top and grazing angles", async ({ page }, info) => {
  const measurements = [];
  for (const angle of ["top", "grazing"] as const) {
    const signals: number[] = [];
    for (const kind of ["river", "lake"] as const) {
      const red = await frame(page, { kind, lakePlanar:false, surfaceStrength:0, surfaceRoughness:0.2,
        isolateReflection:true, angle, depth:2, opacity:0, bedVisibility:1, absorptionDistance:100,
        reflection:"red", pipeline:"composer", normalMap:false });
      const blue = await frame(page, {reflection:"blue"});
      signals.push(channel(red,0)-channel(blue,0)); measurements.push({kind,angle,red,blue});
      expect(red.glError).toBe(0);expect(blue.glError).toBe(0);
    }
    expect(signals[0]!).toBeGreaterThan(0);
    expect(Math.abs(signals[0]!-signals[1]!)).toBeLessThan(3);
  }
  await evidence(info,"lake-like-interface",measurements);
});

test("River surface: slope, transformed orthographic view, animation and strength-zero remain stable", async ({ page }, info) => {
  const measurements = [];
  for (const orthographic of [false,true]) {
    const base = await frame(page,{surfaceStrength:2,surfaceRoughness:0.2,
      isolateReflection:true,normalMap:true,slope:0.12,angle:"grazing",reflection:"red",opacity:1,pipeline:"composer",orthographic,time:0,transformed:false});
    const moved = await frame(page,{transformed:true});
    expect(Math.max(...moved.centre.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-base.centre[i]![c]!))))).toBeLessThan(3);
    const animated = await frame(page,{time:4,transformed:false});
    expect(Math.max(...animated.centre.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-base.centre[i]![c]!))))).toBeGreaterThan(0.2);
    const calm = await frame(page,{surfaceStrength:0,time:0});
    const later = await frame(page,{time:4});
    expect(later.centre).toEqual(calm.centre);
    expect(animated.glError).toBe(0);
    measurements.push({orthographic,base,moved,animated,calm,later});
  }
  await evidence(info,"lake-like-motion",measurements);
});



test("River surface: twenty quality switches retain borrowed resources", async ({page},info) => {
  await frame(page,{normalMap:true,reflection:"red",reflectionQuality:"high"});
  const warmed = await frame(page,{reflectionQuality:"low"});
  const samples = [];
  for(let cycle=0;cycle<20;cycle++) {
    const shot = await frame(page,{
      reflection:cycle%3 ? "red":"off", reflectionQuality:cycle%2 ? "low":"high"});
    expect(shot.textures).toBe(warmed.textures);
    expect(shot.glError).toBe(0);
    samples.push({cycle,textures:shot.textures});
  }
  await evidence(info,"lake-like-lifecycle",{warmed,samples});
});

test("River R2: actual bed depth controls spectral transmission on sloped and transformed surfaces", async ({page},info) => {
  const shots = [];
  for (const orthographic of [false,true]) {
    const shallow = await frame(page,{kind:"river",sceneTransmission:true,pipeline:"composer",
      orthographic,slope:0.12,depth:1,sceneBedDepth:0.1,opacity:0,bedVisibility:1,absorptionDistance:3,
      reflection:"off",surfaceStrength:0,transformed:false});
    const deep = await frame(page,{sceneBedDepth:5});
    expect(shallow.sceneTransmission).toBe(1);
    expect(deep.frameCopies).toBe(1);
    expect(deep.glError).toBe(0);
    expect(contrast(shallow)).toBeGreaterThan(contrast(deep)+10);
    expect(channel(deep,1)-channel(deep,0)).toBeGreaterThan(3);
    const moved = await frame(page,{transformed:true});
    expect(Math.max(...moved.centre.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-deep.centre[i]![c]!))))).toBeLessThan(3);
    const fallback = await frame(page,{sceneTransmission:false,transformed:false});
    expect(fallback.sceneTransmission).toBe(0);
    expect(contrast(fallback)).toBeGreaterThan(contrast(deep)+10);
    shots.push({orthographic,shallow,deep,moved,fallback});
    await frame(page,{sceneTransmission:true});
    await page.screenshot({path:info.outputPath(`river-r2-depth-${orthographic}.png`)});
  }
  await evidence(info,"river-r2-depth",shots);
});

test("River R2: visible dry shore fades water and foam despite a deep baked ribbon", async ({page},info) => {
  const shots = [];
  for (const orthographic of [false,true]) {
    const off = await frame(page,{sceneTransmission:true,pipeline:"composer",orthographic,
      slope:0.12,depth:5,sceneBedDepth:0,visible:false,reflection:"red",normalMap:true,
      surfaceStrength:2,foamOpacity:0.92,opacity:0.65});
    for (const sceneBedDepth of [0,0.005,0.02,0.1,1]) {
      const on = await frame(page,{visible:true,sceneBedDepth});
      expect(on.glError).toBe(0);
      if (sceneBedDepth <= 0.005) expect(Math.max(...on.centre.flatMap((p,i)=>p.map((v,c)=>Math.abs(v-off.centre[i]![c]!))))).toBeLessThan(3);
      shots.push({orthographic,sceneBedDepth,off,on});
    }
    await page.screenshot({path:info.outputPath(`river-r2-shore-${orthographic}.png`)});
  }
  await evidence(info,"river-r2-shore",shots);
});

test("River R2: volume sunlight respects single and cascade shadows", async ({page},info) => {
  const shots = [];
  for (const shadowSystem of ["single","cascade","disabled"] as const) {
    const clear = await frame(page,{sceneTransmission:true,pipeline:"composer",
      sunTest:true,sunTerm:"all",shadowSystem,shadowCaster:false,angle:"grazing",depth:5,
      absorptionDistance:0.5,opacity:1,bedVisibility:0,calibration:true,reflection:"off",surfaceStrength:0,exposure:1});
    const shadow = await frame(page,{shadowCaster:true});
    const differences = clear.centre.map((p,i)=>mean(p)-mean(shadow.centre[i]!));
    if (shadowSystem === "disabled") expect(Math.max(...differences.map(Math.abs))).toBeLessThan(2);
    else {
      expect(mean(differences.slice(0,3))).toBeGreaterThan(2);
      expect(Math.abs(mean(differences.slice(3)))).toBeLessThan(2);
    }
    expect(shadow.glError).toBe(0);
    shots.push({shadowSystem,clear,shadow,differences});
  }
  await evidence(info,"river-r2-shadow",shots);
});

test("River R2: shared copy excludes earlier water and releases on repeated consumer switches", async ({page},info) => {
  const shots = [];
  for (const kind of ["river","lake"] as const) {
    const base = await frame(page,{kind,sceneTransmission:true,pipeline:"composer",depth:2,
      opacity:0.35,bedVisibility:0.9,reflection:"off",surfaceStrength:0,companion:false,reverseOrder:false});
    const earlierWater = await frame(page,{companion:true,reverseOrder:true});
    expect(earlierWater.frameCopies).toBe(1);
    expect(earlierWater.centre).toEqual(base.centre);
    const glass = await frame(page,{companion:false,earlyGlass:true});
    expect(glass.centre).toEqual(base.centre);
    expect(glass.frameCopies).toBe(1);
    await frame(page,{earlyGlass:false,companion:true});
    const reverse = await frame(page,{reverseOrder:false});
    expect(reverse.frameCopies).toBe(1);
    expect(reverse.glError).toBe(0);
    shots.push({kind,base,earlierWater,glass,reverse});
  }
  // Normalize both composer attachments after the preceding Lake/companion
  // scenarios before measuring the River-only allocate/release cycle.
  await frame(page,{kind:"river",companion:false,visible:false});
  const warm = await frame(page,{visible:true});
  for (let cycle=0;cycle<20;cycle++) {
    const hidden = await frame(page,{visible:false});
    expect(hidden.sceneTransmission).toBe(0);
    expect(hidden.frameCopies).toBe(0);
    expect(hidden.textures).toBeLessThan(warm.textures);
    expect(hidden.drawCalls + 1).toBe(warm.drawCalls);
    const restored = await frame(page,{visible:true});
    expect(restored.textures).toBe(warm.textures);
    expect(restored.frameCopies).toBe(1);
    expect(restored.centre).toEqual(warm.centre);
    expect(restored.glError).toBe(0);
  }
  const direct = await frame(page,{pipeline:"direct"});
  expect(direct.sceneTransmission).toBe(0);
  expect(direct.glError).toBe(0);
  await evidence(info,"river-r2-shared-copy",{shots,warm,direct});
});

test("River R3: sloped refraction moves the bed, preserves transforms, zero/Low/direct release the atlas", async ({page},info) => {
  const measurements=[];
  const diff=(a:Snapshot,b:Snapshot)=>a.refractionSamples.reduce((sum,p,i)=>sum+p.reduce((n,v,c)=>n+Math.abs(v-b.refractionSamples[i]![c]!),0),0);
  for(const orthographic of [false,true]) {
    const off=await frame(page,{kind:"river",refractionQA:true,refractionStrength:0,sceneTransmission:true,pipeline:"composer",
      surfaceStrength:2,normalMap:true,slope:.12,depth:1,opacity:0,bedVisibility:1,absorptionDistance:8,orthographic,time:1});
    const on=await frame(page,{refractionStrength:1.5});
    await evidence(info,"river-r3-progress",{orthographic,off,on,difference:diff(on,off)});
    expect(on.refractionFallback).toBeNull();expect(on.refraction).toBe(1.5);
    expect(on.refractionBytes).toBeGreaterThan(0);expect(on.refractionBytes).toBeLessThanOrEqual(8*1024*1024);
    expect(diff(on,off)).toBeGreaterThan(10);expect(on.drawCalls).toBe(off.drawCalls);
    const moved=await frame(page,{transformed:true});
    expect(diff(moved,on)).toBeLessThan(20);
    const low=await frame(page,{transformed:false,reflectionQuality:"low"});
    expect(low.refraction).toBe(0);expect(low.refractionBytes).toBe(0);
    const direct=await frame(page,{reflectionQuality:"medium",pipeline:"direct"});
    expect(direct.refraction).toBe(0);
    const restored=await frame(page,{pipeline:"composer",refractionStrength:0});
    expect(restored.refractionSamples).toEqual(off.refractionSamples);
    measurements.push({orthographic,off,on,moved,low,direct,restored});
    await frame(page,{refractionStrength:1.5});
    await page.screenshot({path:info.outputPath(`river-r3-${orthographic}.png`)});
  }
  await evidence(info,"river-r3-motion",measurements);
});

test("River R3: foreground rock, real holes, dry bank and shallow edge cannot leak shifted colour", async ({page},info)=>{
  const shots=[];
  for(const patch of [{foreground:true,hole:false,dryBank:false,depth:1},
    {foreground:false,hole:true,dryBank:false,depth:1},
    {foreground:false,hole:false,dryBank:true,depth:1},
    {foreground:false,hole:false,dryBank:false,depth:.005}]) {
    const off=await frame(page,{refractionQA:true,sceneTransmission:true,pipeline:"composer",normalMap:true,
      surfaceStrength:2,refractionStrength:0,opacity:0,bedVisibility:1,absorptionDistance:8,time:2,...patch});
    const on=await frame(page,{refractionStrength:2});
    await evidence(info,"river-r3-guard-progress",{patch,off,on});
    expect(on.glError).toBe(0);expect(on.refractionFallback).toBeNull();
    if(patch.foreground) expect(on.redPixels).toBe(off.redPixels);
    if(patch.hole) expect(on.protectedSamples).toEqual(off.protectedSamples);
    if(patch.dryBank) expect(on.protectedSamples.filter((_,i)=>i%2===1)).toEqual(off.protectedSamples.filter((_,i)=>i%2===1));
    if(patch.depth<.02) expect(on.refractionSamples).toEqual(off.refractionSamples);
    shots.push({patch,off,on});
    await page.screenshot({path:info.outputPath(`river-r3-guard-${shots.length}.png`)});
  }
  await evidence(info,"river-r3-guards",shots);
});

test("River R3: vertex waves, mixed water levels and twenty quality ceilings keep one snapshot and bounded resources", async({page},info)=>{
  test.setTimeout(240_000);
  const shots=[];
  for(const time of [1,4]) {
    const off=await frame(page,{refractionQA:true,refractionStrength:0,sceneTransmission:true,pipeline:"composer",normalMap:true,
      surfaceStrength:2,waveAmplitude:.1,time,depth:1,opacity:0,bedVisibility:1,absorptionDistance:8});
    const on=await frame(page,{refractionStrength:1.5});
    expect(on.refraction).toBe(1.5);expect(on.glError).toBe(0);
    expect(on.refractionSamples).not.toEqual(off.refractionSamples);
    for(const companionHeight of [-.4,.4]) {
      const mixed=await frame(page,{companion:true,companionKind:"lake",companionHeight,reverseOrder:true});
      expect(mixed.refractionSamples).toEqual(on.refractionSamples);
      expect(mixed.frameCopies).toBe(1);expect(mixed.glError).toBe(0);
      const reverse=await frame(page,{reverseOrder:false});
      expect(reverse.frameCopies).toBe(1);expect(reverse.glError).toBe(0);
      shots.push({time,off,on,mixed,reverse});
      await frame(page,{companion:false});
    }
  }
  await frame(page,{refractionAllowed:false,companion:false});
  const warm=await frame(page,{refractionAllowed:true});
  const cycles=[];
  for(let cycle=0;cycle<20;cycle++) {
    const low=await frame(page,{refractionAllowed:false});
    expect(low.refraction).toBe(0);expect(low.refractionBytes).toBe(0);
    expect(low.textures).toBe(warm.textures-1);
    const restored=await frame(page,{refractionAllowed:true});
    expect(restored.refraction).toBe(1.5);expect(restored.textures).toBe(warm.textures);
    expect(restored.refractionSamples).toEqual(warm.refractionSamples);
    expect(restored.frameCopies).toBe(1);expect(restored.glError).toBe(0);
    cycles.push({cycle,textures:restored.textures,bytes:restored.refractionBytes});
  }
  await evidence(info,"river-r3-mixed-lifecycle",{shots,warm,cycles});
});

test("River flow regression: high speed retains 2D normals after minutes and hours without accumulating shear",async({page},info)=>{
  const shots=[];
  for(const flowSpeed of [1,5])for(const time of [60,3600]) {
    const before=await frame(page,{normalDiagnostic:"optical",realNormalMap:true,normalMap:true,unboundedFlow:true,
      surfaceStrength:2,waveAmplitude:0,flowSpeed,time,sampleSpacing:1,depth:2,opacity:1,pipeline:"direct"});
    const after=await frame(page,{unboundedFlow:false});
    shots.push({flowSpeed,time,before,after});await evidence(info,"river-flow-progress",shots);
    expect(after.glError).toBe(0);expect(after.normalStats!.along).toBeGreaterThan(100);
    expect(after.normalStats!.anisotropy).toBeLessThan(3);
    if(time===60) expect(before.normalStats!.anisotropy).toBeGreaterThan(after.normalStats!.anisotropy*1.5);
  }
  await evidence(info,"river-flow-bounded",shots);
});

test("River sun regression: shared-vertex wave normals remove diagonal jumps under HDR sun and bloom",async({page},info)=>{
  const face=await frame(page,{normalDiagnostic:"geometric",waveAmplitude:.1,sampleSpacing:1,surfaceStrength:0,
    flowSpeed:1,time:60,depth:2,opacity:1,pipeline:"direct"});
  const smooth=await frame(page,{normalDiagnostic:"smooth"});
  await evidence(info,"river-normal-edges",{face,smooth});
  expect(face.normalStats!.edgeCount).toBeGreaterThan(100);
  expect(face.normalStats!.edgeP95).toBeGreaterThan(2);
  expect(smooth.normalStats!.edgeP95).toBeLessThan(face.normalStats!.edgeP95*.7);
  const before=await frame(page,{normalDiagnostic:"beauty",hdrSun:true,bloom:true,faceShading:true,unboundedFlow:true,
    realNormalMap:true,normalMap:true,surfaceStrength:2,surfaceRoughness:.2,angle:"grazing",pipeline:"composer",flowSpeed:1,time:60});
  await page.screenshot({path:info.outputPath("river-hdr-before.png")});
  const after=await frame(page,{faceShading:false,unboundedFlow:false});
  await page.screenshot({path:info.outputPath("river-hdr-after.png")});
  expect(after.sunDiscRadiance[0]).toBeGreaterThan(1000);expect(after.glError).toBe(0);
  expect(after.drawCalls).toBe(before.drawCalls);
  await evidence(info,"river-hdr-sun",{before,after});
});
