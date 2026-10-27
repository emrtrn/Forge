import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ContentLoadError } from "../../engine/assets/contentValidation";
import { readRoomLayout } from "../../engine/scene/layoutValidation";
import { compareAssetHealthWarnings, readAssetManifest, validateAssetManifest } from "../../engine/assets/manifest";
import { levelTerrainPath } from "../../engine/terrain/terrainTypes";
import { loadActiveProject, readProjectManifest } from "../../src/project/ProjectSystem";
import { readContentJson } from "../../src/project/contentLoader";
import { loadRoomLayout } from "../../src/scene/roomLayout";
import { AssetLoader } from "../../src/scene/assetLoader";
import { loadAssetCollision } from "../../src/scene/assetCollisionLoader";
import { loadAssetUvw } from "../../src/scene/assetUvwLoader";
import { loadAssetSkeleton } from "../../src/scene/assetSkeletonLoader";
import { loadAssetMaterialSlots } from "../../src/scene/assetMaterialSlotsLoader";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const project = JSON.parse(readFileSync("public/project.3dgame.json", "utf8")) as unknown;
const level = () => ({ schema: 1, name: "test", loadGroups: [], instances: [], characters: [] });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const isFailure = (reason: string, path: string) => (error: unknown) =>
  error instanceof ContentLoadError && error.reason === reason && error.message.includes(path);

async function withFetch(fn: (url: string) => Response | Promise<Response>, run: () => Promise<void>): Promise<void> {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input) => fn(String(input))) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = previous; }
}

export async function registerContentLoadingTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("content: project schema and runtime paths fail before host access", () => {
    assert.equal(readProjectManifest(project).schema, 1);
    for (const raw of [null, [], {}, { ...readProjectManifest(project), editor: null }]) {
      assert.throws(() => readProjectManifest(raw), ContentLoadError);
    }
    assert.throws(() => readProjectManifest({ ...readProjectManifest(project), schema: 9 }), isFailure("unsupported-version", "schema"));
  });

  check("content: level structure, actor transforms and collections reject damaged data", () => {
    for (const raw of [null, [], { ...level(), actors: {} }, { ...level(), skyAtmosphere: [] },
      { ...level(), characters: [null] }, { ...level(), instances: [{ assetId: "cube", placements: [null] }] },
      { ...level(), characters: [{ assetId: "pawn", position: [0, Infinity, 0] }] }]) {
      assert.throws(() => readRoomLayout(raw, "bad.level.json"), isFailure("invalid-data", "bad.level.json"));
    }
    assert.throws(() => readRoomLayout({ ...level(), schema: 3 }, "future.level.json"), isFailure("unsupported-version", "future.level.json"));
    const legacy = { ...level(), characters: [{ assetId: "pawn", position: [0, 1, 2], rotationYDeg: 90, scale: 2 }], extension: { own: true } };
    assert.equal(readRoomLayout(legacy, "legacy.level.json"), legacy);
  });

  check("content: current public, starter and smoke level documents pass the structural contract", () => {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".level.json")) readRoomLayout(JSON.parse(readFileSync(path, "utf8")), path);
      }
    };
    for (const dir of ["public", "templates", "tests/smoke/fixtures"]) walk(dir);
  });

  check("content: river bodies load by landscape/spline references without a transform", () => {
    const water = { id: "river", landscapeRef: "land", splineRef: "spline", surfaceLevel: 1 };
    const raw = { ...level(), riverWaters: [water] };
    assert.equal(readRoomLayout(raw, "river.level.json"), raw);
    for (const malformed of [{ ...water, landscapeRef: "" }, { ...water, splineRef: null }]) {
      assert.throws(() => readRoomLayout({ ...level(), riverWaters: [malformed] }, "river.level.json"), ContentLoadError);
    }
  });

  check("content: asset manifest accepts legacy aliases and rejects bad version and duplicate ids", () => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
    assert.equal(readAssetManifest(manifest, "assets/manifest.json"), manifest);
    const first = manifest.assets[0];
    const { path, assetType, ...rest } = first;
    readAssetManifest({ ...manifest, assets: [{ ...rest, file: path, type: assetType }] }, "legacy.json");
    assert.throws(() => readAssetManifest({ ...manifest, version: 2 }, "future.json"), isFailure("unsupported-version", "future.json"));
    assert.equal(validateAssetManifest({ ...manifest, version: 2 }).valid, false);
    assert.throws(() => readAssetManifest({ ...manifest, assets: [first, first] }, "duplicate.json"), isFailure("invalid-data", first.id));
    assert.throws(() => readAssetManifest({ ...manifest, assets: [null] }, "bad.json"), ContentLoadError);
  });

  check("content: asset health separates generated previews, registered companions and real orphans", () => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
    const model = manifest.assets.find((asset: { path: string }) => /\.glb$/i.test(asset.path));
    const sidecar = model.path.replace(/\.glb$/i, ".skeleton.json");
    const report = validateAssetManifest({ ...manifest, assets: [{ ...model, thumbnail: undefined }] }, {
      publicFiles: [model.path, sidecar, "assets/orphan.skeleton.json"],
    });
    assert.equal(report.errorCount, 0);
    assert.equal(report.infoCount, 1);
    assert.equal(report.warningCount, 1);
    assert.equal(report.issues.find((issue) => issue.level === "warning")?.path, "assets/orphan.skeleton.json");
    const key = "asset-file-unregistered:assets/orphan.skeleton.json";
    assert.deepEqual(compareAssetHealthWarnings(report, []).added, [key]);
    assert.deepEqual(compareAssetHealthWarnings(report, [key]).added, []);
    assert.deepEqual(compareAssetHealthWarnings(validateAssetManifest({ ...manifest, assets: [] }), [key]).resolved, [key]);
  });

  check("content: asset health treats level-owned terrain as a companion of its registered level", () => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
    const levelAsset = manifest.assets.find((asset: { path: string }) => /\.level\.json$/i.test(asset.path));
    const terrain = levelTerrainPath(levelAsset.path, "landscape-1");
    const orphan = levelTerrainPath("assets/unregistered.level.json", "landscape-1");
    const report = validateAssetManifest({ ...manifest, assets: [levelAsset] }, {
      publicFiles: [levelAsset.path, terrain, orphan],
    });
    const unregistered = report.issues.filter((issue) => issue.code === "asset-file-unregistered").map((issue) => issue.path);
    assert.deepEqual(unregistered, [orphan]);
  });

  check("content: asset health treats painted foliage, mesh paint and cell files as companions of their registered level", () => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
    const levelAsset = manifest.assets.find((asset: { path: string }) => /\.level\.json$/i.test(asset.path));
    const stem = levelAsset.path.replace(/\.level\.json$/i, "");
    const owned = [`${stem}.foliage.json`, `${stem}.meshpaint.json`, `${stem}.cells/foliage/0_0.foliage.json`, `${stem}.cells/main/0_0.cell.json`];
    const orphans = ["assets/unregistered.foliage.json", "assets/unregistered.meshpaint.json", "assets/unregistered.cells/main/0_0.cell.json"];
    const report = validateAssetManifest({ ...manifest, assets: [levelAsset] }, {
      publicFiles: [levelAsset.path, ...owned, ...orphans],
    });
    assert.deepEqual(report.issues.filter((issue) => issue.code === "asset-file-unregistered").map((issue) => issue.path), orphans);
  });

  check("content: terrain global maps and tiles are companions; binaries without a definition stay visible", () => {
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8"));
    const level = manifest.assets.find((asset: { path: string }) => /\.level\.json$/i.test(asset.path));
    const terrain = levelTerrainPath(level.path, "landscape-1");
    const stem = terrain.replace(/\.terrain\.json$/, "");
    const report = validateAssetManifest({ ...manifest, assets: [level] }, {
      publicFiles: [level.path, terrain, `${stem}.global.bin`, `${stem}.tiles/0_0.tile.bin`,
        "assets/orphan.global.bin", "assets/orphan.tiles/0_0.tile.bin"],
    });
    assert.deepEqual(report.issues.filter((issue) => issue.code === "asset-file-unregistered").map((issue) => issue.path),
      ["assets/orphan.global.bin", "assets/orphan.tiles/0_0.tile.bin"]);
  });

  await checkAsync("content: required reads distinguish network, HTTP, JSON and structural failures", async () => {
    await withFetch(() => { throw new TypeError("offline"); }, async () => {
      await assert.rejects(readContentJson("offline.json"), isFailure("network", "offline.json"));
    });
    await withFetch(() => response({}, 503), async () => {
      await assert.rejects(readContentJson("http.json"), isFailure("http", "HTTP 503"));
    });
    await withFetch(() => new Response("<html>fallback</html>"), async () => {
      await assert.rejects(loadRoomLayout("broken.level.json"), isFailure("invalid-json", "broken.level.json"));
    });
    await withFetch(() => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("connection interrupted")); },
    })), async () => {
      await assert.rejects(readContentJson("interrupted.json"), isFailure("network", "interrupted.json"));
    });
    await withFetch(() => response({ ...level(), characters: "bad" }), async () => {
      await assert.rejects(loadRoomLayout("shape.level.json"), isFailure("invalid-data", "characters"));
    });
  });

  await checkAsync("content: project and asset manifest failures do not poison their read caches", async () => {
    let reads = 0;
    await withFetch(async () => { reads++; await Promise.resolve(); return reads === 1 ? response({}, 503) : response(project); }, async () => {
      const errors = await Promise.allSettled([loadActiveProject(), loadActiveProject()]);
      assert.equal(reads, 1);
      assert.ok(errors.every((result) => result.status === "rejected"));
      assert.equal((await loadActiveProject()).manifest.name, readProjectManifest(project).name);
      assert.equal(reads, 2);
    });
    const loader = new AssetLoader(readProjectManifest(project));
    reads = 0;
    await withFetch(() => ++reads === 1 ? response({ version: 1 }) : response({ version: 1, generated: "test", ktx2: false, assets: [] }), async () => {
      await assert.rejects(loader.loadManifest(), ContentLoadError);
      assert.deepEqual((await loader.loadManifest()).assets, []);
      assert.equal(reads, 2);
    });
  });

  const loaders = [
    ["collision", loadAssetCollision], ["uvw", loadAssetUvw],
    ["skeleton", loadAssetSkeleton], ["materials", loadAssetMaterialSlots],
  ] as const;
  for (const [kind, load] of loaders) {
    await checkAsync(`content: ${kind} sidecar 404 is silent, failures warn once, success re-arms diagnostics`, async () => {
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
      const path = `assets/content-test-${kind}.glb`;
      try {
        await withFetch(() => response({}, 404), async () => {
          const a = await load(path), b = await load(path);
          assert.deepEqual(a, b);
          assert.notEqual(a, b);
          assert.equal(warnings.length, 0);
        });
        for (const [reason, fetchResponse] of [
          ["http", () => response({}, 500)],
          ["network", () => { throw new TypeError("offline"); }],
          ["invalid-json", () => new Response("{")],
          ["invalid-data", () => response([])],
          ["unsupported-version", () => response({ schema: 2 })],
        ] as const) {
          warnings.length = 0;
          await withFetch(fetchResponse, async () => { await Promise.all([load(path), load(path)]); });
          assert.equal(warnings.length, 1, reason);
          assert.ok(warnings[0]?.includes(`[content:${reason}]`));
          assert.ok(warnings[0]?.includes(`content-test-${kind}.${kind}.json`));
        }
        await withFetch(() => response({}), async () => { await load(path); }); // versionless legacy
        warnings.length = 0;
        await withFetch(() => response({ schema: 2 }), async () => { await load(path); });
        assert.equal(warnings.length, 1);
      } finally { console.warn = original; }
    });
  }

  await checkAsync("content: legacy reflection migration still runs after validated loading", async () => {
    await withFetch(() => response({ ...level(), reflection: { intensity: 0.4 } }), async () => {
      const loaded = await loadRoomLayout("legacy.level.json");
      assert.equal(loaded.skyAtmosphere?.skyLightCapture?.intensity, 0.4);
      assert.equal("reflection" in loaded, false);
    });
  });
}
