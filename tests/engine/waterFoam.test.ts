import { Group, Scene, Vector4 } from "three";
import { registerLakeShoreWetness, createTerrainShoreWetnessUniforms, terrainShoreWetnessAt, updateTerrainShoreWetness } from "../../engine/render-three/terrain/terrainShoreWetness";
import { registerLakeCaustics, createTerrainCausticsUniforms, updateTerrainCaustics } from "../../engine/render-three/terrain/terrainCaustics";
import type { TerrainUniforms } from "../../engine/render-three/terrain/terrainMaterial";
import type { DataArrayTexture } from "three";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createLakeFoamMask, createWaterShoreMask, riverContactSegments } from "../../engine/render-three/waterFoam";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { buildRiverWaterRibbon, riverFoamTrail, RIVER_FOAM_TRAIL_LENGTH, RiverWaterObject } from "../../engine/render-three/riverWater";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";
import { LAKE_SURFACE_WAVE_DEFAULTS, validateWaterBody, resolveLakeAppearance } from "../../engine/scene/waterBody";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { validateRiverWater } from "../../tools/saveValidator";
import { crestFoamSteepness, resolveWaterCrestFoam } from "../../engine/scene/waterCrestFoam";
import { FULL_LAKE_QUALITY } from "../../engine/perf/lakeQuality";
import { riverEffectFixture } from "./riverEffects.test";
import { defaultWaterContactFoam } from "../../engine/scene/waterContactFoam";
import { bakeRiverGeometryFoam } from "../../engine/render-three/lakeFoamBake";
import type { LakeFoamData } from "../../engine/scene/lakeFoamBake";
import type { ForgeLandscapeSpline } from "../../engine/scene/landscape";
import { lakeWaveParameters, LAKE_WAVE_COMPONENTS } from "../../engine/terrain/lakeWaves";

type Check = (label: string, run: () => Promise<void>) => Promise<void>;
export async function registerWaterFoamTests(check: Check): Promise<void> {
  await check("Water look: river foam trail decays downstream from rapids", async () => {
    assert.equal(RIVER_FOAM_TRAIL_LENGTH, 25);
    const distances = [0, 5, 10, 40, 41], rapidness = [0, 0.8, 0, 0, 0.3];
    const expected = [0, 0.8, 0.8 * Math.exp(-5 / 25), 0.8 * Math.exp(-35 / 25),
      Math.max(0.3, 0.8 * Math.exp(-35 / 25) * Math.exp(-1 / 25))];
    const trail = riverFoamTrail(distances, rapidness);
    assert.equal(trail.length, expected.length);
    trail.forEach((value, i) => {
      assert.ok(Math.abs(value - expected[i]!) < 1e-9, `trail sample ${i}: ${value} vs ${expected[i]}`);
      assert.ok(value >= rapidness[i]!, "carried foam never suppresses local rapids");
    });
    assert.equal(trail[0], rapidness[0], "the chain starts without inherited foam");
    assert.deepEqual(riverFoamTrail([100], [0.6]), [0.6], "a new chain starts at its own rapidness");
  });
  await check("Water look: ribbon carries trail and lateral offsets per vertex", async () => {
    const spline = (xs: number[]): ForgeLandscapeSpline => ({
      id: "foam-trail", points: xs.map((x, i) => ({
        id: String(i), position: [x, 0, 0], width: 3, falloff: 1,
      })), segments: xs.slice(1).map((_, i) => ({
        id: `s${i}`, startPointId: String(i), endPointId: String(i + 1),
      })),
    });
    const options = { surfaceLevel: 0, widthScale: 1, sampleSpacing: 1 };
    const straight = buildRiverWaterRibbon(spline([0, 48]), options);
    const profiled = buildRiverWaterRibbon(spline([0, 12, 48]), { ...options,
      segmentProfiles: [{ splineSegmentRef: "s0", rapidness: 0.8, flowSpeedMultiplier: 1 }],
    });
    // Without a terrain height query, ribbons have five lateral vertices per row.
    const columns = 5;
    for (const ribbon of [straight, profiled]) {
      const vertices = ribbon.positions.length / 3;
      assert.ok(vertices > columns);
      assert.equal(ribbon.foamMasks.length, vertices);
      assert.equal(ribbon.lateralOffsets.length, vertices);
      assert.equal(vertices % columns, 0);
      for (let row = 0; row < vertices / columns; row++) {
        const start = row * columns;
        assert.ok(ribbon.lateralOffsets[start]! < 0);
        assert.ok(Math.abs(ribbon.lateralOffsets[start + 2]!) < 1e-9, "centre is on the spline");
        for (let column = 0; column < columns; column++) {
          assert.ok(Math.abs(ribbon.lateralOffsets[start + column]!
            + ribbon.lateralOffsets[start + columns - 1 - column]!) < 1e-9, "lateral offsets are symmetric");
          assert.equal(ribbon.foamMasks[start + column], ribbon.foamMasks[start], "trail is constant across each row");
        }
      }
    }
    const downstream: number[] = [];
    for (let vertex = 2; vertex < profiled.foamMasks.length; vertex += columns) {
      const x = profiled.positions[vertex * 3]!;
      if (x > 0 && x <= 12) assert.equal(profiled.rapidness[vertex], 0.8);
      // The terminal sample creates its own geometric rapid; isolate calm
      // downstream samples between the authored rapid and that endpoint.
      if (x > 12 && x < 48) {
        assert.equal(profiled.rapidness[vertex], 0);
        downstream.push(profiled.foamMasks[vertex]!);
      }
    }
    assert.ok(downstream.length > 2, "exercise multiple samples after the rapid segment ends");
    downstream.forEach((value, i) => {
      assert.ok(value > 0, "foam survives beyond the rapid segment");
      if (i > 0) assert.ok(value < downstream[i - 1]!, "foam strictly decays through calm downstream samples");
    });
  });
  await check("Water look: crest foam steepness keeps calm swell clear", async () => {
    assert.equal(crestFoamSteepness(0), 0.02);
    assert.ok(Math.abs(crestFoamSteepness(1) - 0.12) < 1e-9);
    assert.ok(Math.abs(crestFoamSteepness(0.35) - 0.055) < 1e-9);
    assert.equal(crestFoamSteepness(-1), crestFoamSteepness(0));
    assert.equal(crestFoamSteepness(2), crestFoamSteepness(1));
    const gradientBound = (height: number) => {
      const parameters = lakeWaveParameters({ ...LAKE_SURFACE_WAVE_DEFAULTS,
        surfaceWaveHeight: height, surfaceWaveLength: 6 }, 0, 0);
      return parameters.height * parameters.components.reduce((sum, component, i) =>
        sum + LAKE_WAVE_COMPONENTS[i]![4] * Math.hypot(component[0], component[1]), 0);
    };
    assert.ok(gradientBound(0.04) < crestFoamSteepness(0.35), "4 cm swell remains below the whitecap slope");
    assert.ok(gradientBound(0.1) > crestFoamSteepness(0.35), "10 cm waves can exceed the whitecap slope");
  });
  await check("Water look: foam material texture is seamless, equalised and not an edge network", async () => {
    const png = readFileSync("engine/render-three/textures/water-foam.png");
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const idat: Buffer[] = [];
    let width = 0, height = 0, ended = false;
    for (let offset = 8; offset < png.length;) {
      assert.ok(offset + 12 <= png.length, "complete PNG chunk header and CRC");
      const length = png.readUInt32BE(offset), end = offset + 12 + length;
      assert.ok(end <= png.length, "complete PNG chunk data");
      const type = png.toString("ascii", offset + 4, offset + 8);
      const data = png.subarray(offset + 8, end - 4);
      if (type === "IHDR") {
        assert.equal(length, 13);
        width = data.readUInt32BE(0); height = data.readUInt32BE(4);
        assert.equal(width, 512); assert.equal(height, 512);
        assert.equal(data[8], 8, "RGBA8 bit depth");
        assert.equal(data[9], 6, "RGBA colour type");
        assert.deepEqual([...data.subarray(10)], [0, 0, 0], "standard compression/filtering, no interlace");
      } else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") { ended = true; break; }
      offset = end;
    }
    assert.equal(width, 512); assert.equal(height, 512);
    assert.ok(ended && idat.length > 0, "PNG contains image data and an end chunk");
    const stride = 1 + width * 4, rows = inflateSync(Buffer.concat(idat));
    assert.equal(rows.length, height * stride);
    const red = new Uint8Array(width * height), histogram = new Array<number>(8).fill(0);
    for (let y = 0; y < height; y++) {
      assert.equal(rows[y * stride], 0, `row ${y} uses PNG filter type 0`);
      for (let x = 0; x < width; x++) {
        const value = rows[y * stride + 1 + x * 4]!;
        red[y * width + x] = value;
        histogram[Math.floor(value / 32)]! += 1;
      }
    }
    const fractions = histogram.map(count => count / red.length);
    fractions.forEach((fraction, bin) => assert.ok(fraction >= 0.09 && fraction <= 0.16,
      `equalised R bin ${bin}: ${fraction * 100}%`));
    let interior = 0, topBottom = 0, leftRight = 0;
    for (let y = 0; y < height - 1; y++) for (let x = 0; x < width; x++) {
      interior += Math.abs(red[y * width + x]! - red[(y + 1) * width + x]!);
    }
    for (let x = 0; x < width; x++) topBottom += Math.abs(red[x]! - red[(height - 1) * width + x]!);
    for (let y = 0; y < height; y++) leftRight += Math.abs(red[y * width]! - red[y * width + width - 1]!);
    interior /= width * (height - 1); topBottom /= width; leftRight /= height;
    assert.ok(topBottom < 3 * interior, `top/bottom seam ${topBottom} vs interior ${interior}`);
    assert.ok(leftRight < 3 * interior, `left/right seam ${leftRight} vs interior ${interior}`);
    const foam = red.map(value => value / 255 >= 0.7 ? 1 : 0);
    const foamPixels = foam.reduce((sum, value) => sum + value, 0);
    assert.ok(foamPixels > 0 && foamPixels < red.length);
    const visited = new Uint8Array(red.length), queue = new Int32Array(red.length);
    let components = 0, largest = 0;
    for (let pixel = 0; pixel < foam.length; pixel++) {
      if (!foam[pixel] || visited[pixel]) continue;
      components++;
      let head = 0, tail = 1;
      queue[0] = pixel; visited[pixel] = 1;
      while (head < tail) {
        const current = queue[head++]!, x = current % width, y = Math.floor(current / width);
        const neighbours = [y * width + (x + width - 1) % width, y * width + (x + 1) % width,
          ((y + height - 1) % height) * width + x, ((y + 1) % height) * width + x];
        for (const neighbour of neighbours) if (foam[neighbour] && !visited[neighbour]) {
          visited[neighbour] = 1; queue[tail++] = neighbour;
        }
      }
      largest = Math.max(largest, tail);
    }
    const largestFraction = largest / foamPixels;
    // A Voronoi-edge network joins most foam into one giant component.
    assert.ok(largestFraction < 0.6, `largest wrapped component contains ${largestFraction * 100}% of foam`);
  });
  await check("Crest foam: shared strict read/save contract, omitted defaults and authored Off", async () => {
    const river = { id: "r", landscapeRef: "t", splineRef: "s" }, lake = createLakeFixture().lake;
    assert.equal(validateRiverWater(river).crestFoamEnabled, undefined);
    assert.equal(validateWaterBody(lake).appearance, undefined);
    assert.equal(resolveRiverWater(river).crestFoamEnabled, true);
    assert.equal(resolveLakeAppearance(lake).crestFoamEnabled, true);
    const settings = { crestFoamEnabled: false, crestFoamStrength: .6, crestFoamThreshold: .8 };
    assert.deepEqual(resolveWaterCrestFoam(settings), settings);
    const saved = validateRiverWater({ ...river, ...settings });
    for (const key of Object.keys(settings) as Array<keyof typeof settings>) assert.equal(saved[key], settings[key]);
    assert.deepEqual(validateWaterBody({ ...lake, appearance: settings }).appearance, settings);
    for (const bad of [{ crestFoamEnabled: 1 }, { crestFoamStrength: NaN }, { crestFoamStrength: -1 }, { crestFoamThreshold: 1.1 }, { crestFoamThreshold: "0.5" }]) {
      assert.throws(() => validateRiverWater({ ...river, ...bad }), /crest foam/);
      assert.throws(() => validateWaterBody({ ...lake, appearance: bad }), /crest foam/);
      assert.throws(() => resolveRiverWater({ ...river, ...bad } as never), /crest foam/);
      assert.throws(() => resolveLakeAppearance({ ...lake, appearance: bad } as never), /crest foam/);
    }
  });
  await check("Crest foam: River quality releases masks, preserves geometry and rejects late bake revival", async () => {
    const item = { ...riverEffectFixture(), contactFoam: { ...defaultWaterContactFoam(), enabled: true } }, scene = new Scene();
    const low = { ...FULL_LAKE_QUALITY, foamAllowed: false, causticsAllowed: false, shoreWetnessAllowed: false, reflectionQuality: "off" as const };
    let reads = 0, finish!: (value: LakeFoamData) => void;
    const river = new RiverWaterObject({ ...item, quality: low, loadBakedFoam: () => { reads++; return new Promise(resolve => { finish = resolve; }); } }, null);
    scene.add(river);
    const positions = river.geometry.getAttribute("position").array, before = JSON.stringify(item);
    const bake = await bakeRiverGeometryFoam(river.getSurface(), [], .4, "c".repeat(64), new AbortController().signal);
    assert.equal(river.material.uniforms.foamOpacity!.value, 0);
    assert.equal(river.material.uniforms.realShoreMask!.value, null);
    assert.equal(river.material.uniforms.crestFoamStrength!.value, 0);
    const pending = river.applyQuality(FULL_LAKE_QUALITY);
    assert.equal(reads, 1);
    assert.ok(river.material.uniforms.realShoreMask!.value);
    await river.applyQuality(low); finish(bake); await pending;
    assert.equal(river.material.uniforms.geometryFoamMask!.value, null);
    for (let i = 0; i < 5; i++) {
      const pending = river.applyQuality(FULL_LAKE_QUALITY);
      await river.applyQuality(low); finish(bake); await pending;
      assert.equal(river.geometry.getAttribute("position").array, positions);
      assert.equal(river.material.uniforms.realShoreMask!.value, null);
    }
    assert.equal(JSON.stringify(item), before);
    const restored = river.applyQuality(FULL_LAKE_QUALITY); finish(bake); await restored;
    assert.ok(river.material.uniforms.geometryFoamMask!.value);
    await river.applyQuality(low);
    const late = river.applyQuality(FULL_LAKE_QUALITY); river.dispose(); finish(bake); await late;
    await river.applyQuality(FULL_LAKE_QUALITY);
    assert.equal(river.material.uniforms.geometryFoamMask!.value, null);
    assert.equal(river.userData.riverRefractionBytes, undefined);
    const off = new RiverWaterObject({ ...item, crestFoamEnabled: false }, null);
    await off.applyQuality(low); await off.applyQuality(FULL_LAKE_QUALITY);
    assert.equal(off.material.uniforms.crestFoamStrength!.value, 0); off.dispose();
  });
  await check("Lake mask rebuild: stable layers reuse allocations and upload only the changed body's exact coverage", async () => {
    const doc = createLakeFixture(), geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const scene = new Scene(), a = new Group(), b = new Group(); scene.add(a, b);
    const lakeA = { ...doc.lake, id: "a", appearance: { shoreWetnessEnabled: true, causticsEnabled: true } };
    const lakeB = { ...lakeA, id: "b", surfaceLevel: 13 };
    const wet = createTerrainShoreWetnessUniforms(), light = createTerrainCausticsUniforms();
    const update = () => { updateTerrainShoreWetness(wet, scene); updateTerrainCaustics(light as unknown as TerrainUniforms, scene); };
    const textures = () => [wet.uShoreWetMask.value, light.uCausticMask.value] as unknown as DataArrayTexture[];
    const releaseB = [registerLakeShoreWetness(scene, lakeB, geometry, b), registerLakeCaustics(scene, lakeB, geometry, b)];
    let releaseA = [registerLakeShoreWetness(scene, lakeA, geometry, a), registerLakeCaustics(scene, lakeA, geometry, a)];
    update(); const original = textures(), bytes = original.map(t => (t.image.data as Uint8Array).slice());
    assert.equal(wet.uShoreWetParams.value[0]!.z, lakeA.surfaceLevel, "uniforms follow the same stable order as texture layers");
    assert.equal(wet.uShoreWetParams.value[1]!.z, lakeB.surfaceLevel);
    original.forEach(t => t.clearLayerUpdates());
    releaseA.forEach(release => release());
    const changed = { ...geometry, coverage: { ...geometry.coverage!, triangles: new Uint8Array(geometry.coverage!.triangles.length) } };
    releaseA = [registerLakeShoreWetness(scene, lakeA, changed, a), registerLakeCaustics(scene, lakeA, changed, a)];
    update();
    textures().forEach((texture, i) => {
      assert.equal(texture, original[i], "replacement keeps the texture and its CPU backing allocation");
      assert.deepEqual([...texture.layerUpdates], [0], "an unchanged second body is never uploaded again");
      const data = texture.image.data as Uint8Array, half = data.length / 2;
      assert.notDeepEqual(data.subarray(0, half), bytes[i]!.subarray(0, half), "connected-face changes reach the GPU layer");
      assert.deepEqual(data.subarray(half), bytes[i]!.subarray(half), "the unrelated layer stays byte-for-byte identical");
      texture.clearLayerUpdates();
    });
    update(); textures().forEach(t => assert.equal(t.layerUpdates.size, 0, "ordinary render passes do not repack/upload"));
    let disposed = 0; original.forEach(t => t.addEventListener("dispose", () => disposed++));
    releaseA.forEach(release => release()); update();
    assert.equal(disposed, 2, "a changed layer count releases old GPU storage");
    assert.equal(wet.uShoreWetParams.value[0]!.z, lakeB.surfaceLevel, "removal compacts uniforms and texture together");
    releaseB.forEach(release => release()); update();
    assert.equal(wet.uShoreWetMask.value, null); assert.equal(light.uCausticMask.value, null);
  });
  await check("River contact foam: real wet/dry contours, ribbon/hole exclusion and distance field", async () => {
    const positions = [0,2,0, 4,3,0, 0,2,4, 4,3,4], indices=[0,1,2,1,3,2];
    const depths=[1,-1,1,-1];
    const shore=riverContactSegments(positions,depths,indices);
    assert.equal(shore.length,8);
    for(let i=0;i<shore.length;i+=2) assert.equal(shore[i],2);
    assert.deepEqual(riverContactSegments(positions,[1,1,1,1],indices),[],"ribbon edges are not shores");
    assert.deepEqual(riverContactSegments(positions,depths,[]),[],"holes are not shores");
    const mask=createWaterShoreMask([0,0],[4,4],shore,.4);
    assert.equal(mask.image.width,40); assert.ok(mask.image.data.some(v=>v<64)); mask.dispose();
    const object=new RiverWaterObject({...resolveRiverWater({id:"river",landscapeRef:"terrain",splineRef:"spline",contactFoam:{enabled:true,shoreWidth:.6,scale:.8,speed:.3,obstacles:[]}}),
      spline:{id:"spline",points:[{id:"a",position:[0,0,0],width:4,falloff:1},{id:"b",position:[0,0,8],width:4,falloff:1}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]},
      position:[0,0,0],rotation:[0,0,0],foamNoiseMap:null,heightAt:x=>Math.abs(x)-2},null);
    const texture=object.material.uniforms.realShoreMask!.value;
    assert.ok(texture);let disposed=false;texture.addEventListener("dispose",()=>{disposed=true;});
    assert.equal(object.children.length,0,"shore foam adds no overlay meshes/draws");object.dispose();assert.equal(disposed,true);
  });
  await check("Lake wet shore: reversible scene ownership, visibility, terrain binding and unchanged terrain data", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { shoreWetnessEnabled: true };
    const before = [...doc.tiles.values()].map(tile => tile.heights.slice());
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const scene = new Scene(), object = new Group(); scene.add(object);
    const release = registerLakeShoreWetness(scene, doc.lake, geometry, object);
    const uniforms = createTerrainShoreWetnessUniforms();
    updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetCount.value, 1);
    assert.equal(uniforms.uShoreWetWidths.value[0], resolveLakeAppearance(doc.lake).shoreWetnessWidth, "puddle fade distance uses metres, independent of authored wet-shore width");
    const texture = uniforms.uShoreWetMask.value as unknown as import("three").DataArrayTexture;
    assert.equal(texture.image.data!.length, 1024 * 1024 * 2);
    assert.ok(texture.image.data!.some((v, i) => i % 2 === 0 && v < 255));
    const grid = uniforms.uShoreWetGrid.value[0]!;
    const connected = (x: number, z: number) => {
      const gx = (x - grid.x) * grid.z, gz = (z - grid.y) * grid.z;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      if (ix < 0 || iz < 0 || ix >= grid.w || iz >= uniforms.uShoreWetRows.value[0]!) return false;
      const flags = texture.image.data![(iz * grid.w + ix) * 2 + 1]!;
      return (flags & (gx - ix + gz - iz <= 1 ? 1 : 2)) !== 0;
    };
    assert.equal(connected(-20, -12), true, "deep connected bed is wet");
    assert.equal(connected(0, 0), false, "dry island is outside the connected water");
    assert.equal(connected(30, 0), false, "separate basin below water level stays dry");
    assert.equal(connected(-60, 0), false, "outside grid must not wrap");
    assert.equal((uniforms.uShoreWetBounds.value as Vector4[])[0]!.x, -49, "mask extends onto dry side of bounds");
    assert.ok(uniforms.uShoreWetParams.value[0]!.w > 0);
    // CPU mirror (wet tyre prints): on a shore point just above the level it
    // reads the full strength; farther, higher or below the level it is dry.
    const level = doc.lake.surfaceLevel, strength = resolveLakeAppearance(doc.lake).shoreWetnessStrength;
    const shoreX = geometry.shore[0]! + geometry.position[0], shoreZ = geometry.shore[1]! + geometry.position[2];
    assert.ok(Math.abs(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ) - strength) < 0.05, "shore line reads full strength");
    const raised = terrainShoreWetnessAt(scene, shoreX, level + 0.2, shoreZ);
    assert.ok(raised > 0 && Math.abs(raised - strength * 0.584) < 0.03, "the shader's height falloff (1 - smoothstep(0.08, 0.35, 0.2))");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.4, shoreZ), 0, "dry past the height band");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level - 0.1, shoreZ), 0, "below the level is the Lake's own query");
    assert.equal(terrainShoreWetnessAt(scene, 500, level, 500), 0, "outside the padded bounds");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ, "another-terrain"), 0, "bound to its terrain");
    object.visible = false; updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ), 0, "hidden Lake shows no wet shore");
    object.visible = true; updateTerrainShoreWetness(uniforms, scene, "another-terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    release(); release(); updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(disposed, true); assert.equal(uniforms.uShoreWetCount.value, 0); assert.equal(uniforms.uShoreWetMask.value, null);
    [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, before[i]));
    assert.equal(resolveLakeAppearance(createLakeFixture().lake).shoreWetnessEnabled, false);
  });
  await check("Lake foam: distance uses real shore/islands and is invariant at large origins", async () => {
    let baseline: Uint8Array | undefined;
    for (const offset of [0, 1_000_000]) {
      const doc = createLakeFixture([-64 + offset, 10, -64 + offset]);
      const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
      assert.equal(geometry.status, "ready");
      const mask = createLakeFoamMask(doc.lake, geometry, 1);
      const image = mask.image;
      const sample = (x: number, z: number) => image.data[Math.floor((z + 48) / 96 * image.height) * image.width + Math.floor((x + 48) / 96 * image.width)]!;
      assert.ok(sample(-31.9, 0) < 100, "outer shoreline must have contact distance");
      assert.ok(sample(6.2, 0) < 100, "island shoreline must have contact distance");
      assert.equal(sample(-20, 0), 255, "deep water away from shore must not get a foam band");
      if (baseline) assert.deepEqual(image.data, baseline);
      baseline = image.data.slice(); mask.dispose();
    }
  });
  await check("Lake foam: old defaults, strict shared appearance allowlist and sampling budget", async () => {
    const doc = createLakeFixture();
    assert.equal(resolveLakeAppearance(doc.lake).foamEnabled, false);
    const appearance = { foamEnabled: true, foamOpacity: 0.6, foamWidth: 1.2, foamScale: 0.5, foamSpeed: 0.3, shoreBlendDepth: 0.4, shoreWetnessEnabled: true, shoreWetnessWidth: 1.2, shoreWetnessStrength: 0.7, surfaceStrength: 1.1, surfaceRoughness: 0.2,
      wheelWetTrailEnabled: false, wheelWetTrailLength: 2.5, wheelWetTrailStrength: 0.6, wheelWetTrailDrySeconds: 90 };
    assert.deepEqual(validateWaterBody({ ...doc.lake, appearance }).appearance, appearance);
    for (const appearance of [{ surfaceStrength: 3 }, { surfaceRoughness: 0 }, { surfaceRoughness: NaN }, { shoreWetnessEnabled: 1 }, { shoreWetnessWidth: 0 },
      { wheelWetTrailEnabled: "no" }, { wheelWetTrailLength: 0.2 }, { wheelWetTrailLength: 11 }, { wheelWetTrailStrength: 1.2 }, { wheelWetTrailDrySeconds: 2 }, { wheelWetTrailDrySeconds: NaN }, { shoreWetnessStrength: 2 }, { shoreBlendDepth: -1 }, { shoreBlendDepth: 3 }, { shoreBlendDepth: NaN }, { foamEnabled: "yes" }, { foamWidth: 0 }, { foamWidth: 5 }, { foamOpacity: 1.1 }, { foamScale: Infinity }, { foamSpeed: -1 }]) {
      assert.throws(() => validateWaterBody({ ...doc.lake, appearance }), /Invalid Lake|finite/);
    }
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.throws(() => createLakeFoamMask(doc.lake, geometry, 0.2), /over-budget/);
    const object = new LakeWaterObject({ ...doc.lake, appearance }, geometry, null);
    const texture = object.material.uniforms.foamMask!.value;
    assert.ok(texture); assert.equal(object.receiveShadow, true);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    object.dispose(); assert.equal(disposed, true);
    const old = new LakeWaterObject(doc.lake, geometry, null);
    assert.equal(old.material.uniforms.surfaceStrength!.value, 1);
    assert.equal(old.material.uniforms.surfaceRoughness!.value, 0.22);
    assert.equal(old.receiveShadow, true);
    assert.equal(old.material.uniforms.foamMask!.value, null); old.dispose();
  });
}
