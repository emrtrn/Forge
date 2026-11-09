/**
 * `/__world-random` request allowlist (`tools/world/randomWorldRequest.ts`):
 * the World Builder window's choices pass as they are, anything else is refused.
 */
import assert from "node:assert/strict";
import { validateRandomWorldRequest } from "../../tools/world/randomWorldRequest";
import { WORLD_BUILD_STEPS } from "../../engine/worldbuilder/worldBrief";

type Check = (label: string, run: () => void) => void;

const VALID = {
  out: "assets/Worlds/My World.level.json",
  world: {
    seed: 48213, size: "medium", landform: "valley", mountainHeight: "high",
    settlements: [{ type: "village" }, { type: "town" }], roads: "exits", rivers: 2, lakes: 1,
    cover: "alpine", densities: { forest: "low", rocks: "high" },
  },
};

function refuses(change: (body: Record<string, any>) => void, pattern: RegExp): void {
  const body = structuredClone(VALID) as Record<string, any>;
  change(body);
  assert.throws(() => validateRandomWorldRequest(body), pattern);
}

export function registerRandomWorldRequestTests(check: Check): void {
  check("random world request: island budget and river-mouth limits reject before writing", () => {
    const island = { ...VALID, world: { ...VALID.world, landform: "island", size: "small", rivers: 0 } };
    assert.equal(validateRandomWorldRequest(island).world.landform, "island");
    for (const size of ["medium", "large"]) assert.throws(() => validateRandomWorldRequest({ ...island, world: { ...island.world, size } }), /Small worlds only/);
    assert.throws(() => validateRandomWorldRequest({ ...island, world: { ...island.world, rivers: 1 } }), /river-mouth/);
  });
  check("random world request: the window's choices pass unchanged", () => {
    const request = validateRandomWorldRequest(VALID);
    assert.equal(request.out, VALID.out);
    assert.equal(request.force, false);
    assert.deepEqual(request.world, VALID.world);
    assert.equal(validateRandomWorldRequest({ ...VALID, force: true }).force, true);
    assert.deepEqual(validateRandomWorldRequest({ ...VALID, out: "assets\\Worlds\\A.level.json" }).out, "assets/Worlds/A.level.json");
    const bare = validateRandomWorldRequest({ ...VALID, world: { ...VALID.world, rivers: undefined, lakes: undefined, densities: undefined } });
    assert.equal(bare.world.rivers, 0);
    assert.deepEqual(bare.world.densities, {});
  });

  check("random world request: levels stay under assets/ with plain names", () => {
    for (const out of [
      "layouts/A.level.json", "assets/../project.3dgame.json", "assets/a/../../b.level.json", "/assets/A.level.json",
      "assets/A.json", "assets/.level.json", "C:/x/A.level.json", "assets//A.level.json", "assets/A<b>.level.json", "assets/A .level.json ",
    ]) refuses((body) => { body.out = out; }, /out/);
  });

  check("random world request: only known choices", () => {
    refuses((body) => { body.extra = 1; }, /unknown field/);
    refuses((body) => { body.world.player = true; }, /unknown field/);
    refuses((body) => { body.world.size = "huge"; }, /world\.size/);
    refuses((body) => { body.world.landform = "canyon"; }, /world\.landform/);
    refuses((body) => { body.world.rivers = 4; }, /world\.rivers/);
    refuses((body) => { body.world.lakes = 1.5; }, /world\.lakes/);
    refuses((body) => { body.world.seed = -1; }, /world\.seed/);
    refuses((body) => { body.world.settlements = Array.from({ length: 9 }, () => ({ type: "hamlet" })); }, /settlements/);
    refuses((body) => { body.world.settlements = [{ type: "city" }]; }, /settlements\[0\]\.type/);
    refuses((body) => { body.world.settlements = [{ type: "village", population: 9000 }]; }, /unknown field/);
    refuses((body) => { body.world.densities = { trees: "high" }; }, /unknown field/);
    refuses((body) => { body.world.densities = { forest: "extreme" }; }, /densities\.forest/);
    refuses((body) => { body.force = "yes"; }, /force/);
  });

  check("random world request: build steps are reported in order", () => {
    assert.deepEqual([...WORLD_BUILD_STEPS], ["terrain", "paint", "settlements", "roads", "ground", "placements", "files"]);
  });
}

type AsyncCheck = (label: string, run: () => Promise<void>) => Promise<void>;

/** A build that fails leaves the brief as it found it (`runRandomWorld`). */
export async function registerRandomWorldRunCleanupTests(checkAsync: AsyncCheck): Promise<void> {
  await checkAsync("random world run: a failed build restores the brief it replaced and removes a new one", async () => {
    const { mkdtemp, mkdir, readFile, rm, writeFile, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { runRandomWorld } = await import("../../tools/world/randomWorldRun");
    const root = await mkdtemp(join(tmpdir(), "forge-random-run-"));
    try {
      await mkdir(join(root, "assets/Worlds"), { recursive: true });
      // An existing level that is not JSON: the build stops before writing anything.
      await writeFile(join(root, "assets/Worlds/Broken.level.json"), "not json");
      const world = { seed: 3, size: "small", landform: "plain", mountainHeight: "low", settlements: [{ type: "hamlet" }], roads: "between" } as const;
      await writeFile(join(root, "assets/Worlds/Broken.worldbrief.json"), "previous brief");
      await assert.rejects(runRandomWorld({ root, out: "assets/Worlds/Broken.level.json", force: true, world: { ...world, settlements: [...world.settlements] } }), /not JSON/);
      assert.equal(await readFile(join(root, "assets/Worlds/Broken.worldbrief.json"), "utf8"), "previous brief");
      await rm(join(root, "assets/Worlds/Broken.worldbrief.json"));
      await assert.rejects(runRandomWorld({ root, out: "assets/Worlds/Broken.level.json", force: true, world: { ...world, settlements: [...world.settlements] } }), /not JSON/);
      await assert.rejects(access(join(root, "assets/Worlds/Broken.worldbrief.json")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

/** A profile naming an asset the manifest lacks would build a level Play cannot start: the build refuses (`runWorldBrief`). */
export async function registerWorldBriefMissingAssetTests(checkAsync: AsyncCheck): Promise<void> {
  await checkAsync("world brief run: a region profile naming an asset not in the manifest stops the build", async () => {
    const { mkdtemp, mkdir, readFile, rm, writeFile, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomWorldBrief, DEFAULT_REGION_PROFILE } = await import("../../engine/worldbuilder/randomWorld");
    const { regionProfileAssetIds, normalizeRegionProfile } = await import("../../engine/worldbuilder/regionProfile");
    const { runWorldBrief } = await import("../../tools/world/worldBriefRun");
    const shipped = JSON.parse(await readFile(join("public", DEFAULT_REGION_PROFILE), "utf8"));
    // The shipped profile only names assets the shipped manifest has.
    const manifest = JSON.parse(await readFile("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string }> };
    const known = new Set(manifest.assets.map((asset) => asset.id));
    const named = regionProfileAssetIds(normalizeRegionProfile(shipped).profile!);
    assert.ok(named.some(({ where }) => where === "roads.collector.meshAsset"));
    assert.deepEqual(named.filter(({ id }) => !known.has(id)), []);

    const root = await mkdtemp(join(tmpdir(), "forge-brief-assets-"));
    try {
      await mkdir(join(root, "assets/Worlds"), { recursive: true });
      shipped.roads.collector.meshAsset = "mesh:not-there";
      await writeFile(join(root, "assets/Worlds/p.regionprofile.json"), JSON.stringify(shipped));
      await writeFile(join(root, "project.3dgame.json"), JSON.stringify({ editor: { assetManifest: "assets/manifest.json" } }));
      await writeFile(join(root, "assets/manifest.json"), JSON.stringify({ assets: [] }));
      const { brief } = randomWorldBrief({
        id: "assets_test", name: "Assets Test", seed: 1, size: "small", landform: "plain", mountainHeight: "low",
        settlements: [{ type: "hamlet" }], roads: "between", regionProfile: "assets/Worlds/p.regionprofile.json",
      });
      await writeFile(join(root, "assets/Worlds/A.worldbrief.json"), JSON.stringify(brief));
      await assert.rejects(runWorldBrief({ root, brief: "assets/Worlds/A.worldbrief.json" }), /mesh:not-there \(roads\.collector\.meshAsset\)/);
      await assert.rejects(access(join(root, "assets/Worlds/A.level.json")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

/** Building into an existing level replaces it whole: its own terrains and mesh paint go too (`runWorldBrief`). */
export async function registerRandomWorldReplaceTests(checkAsync: AsyncCheck): Promise<void> {
  await checkAsync("random world run: building into an existing level removes its old terrains and mesh paint", async () => {
    const { mkdtemp, mkdir, readFile, rm, writeFile, access, copyFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { DEFAULT_REGION_PROFILE } = await import("../../engine/worldbuilder/randomWorld");
    const { runRandomWorld } = await import("../../tools/world/randomWorldRun");
    const root = await mkdtemp(join(tmpdir(), "forge-random-replace-"));
    try {
      for (const file of ["project.3dgame.json", "assets/manifest.json", DEFAULT_REGION_PROFILE]) {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await copyFile(join("public", file), join(root, file));
      }
      // A hand-made level with a terrain of its own and mesh paint, then a world built into it.
      const level = "assets/Levels/Mine.level.json";
      await mkdir(join(root, "assets/Levels/Mine.landscapes"), { recursive: true });
      await writeFile(join(root, level), JSON.stringify({ schema: 1, name: "Mine", instances: [] }));
      await writeFile(join(root, "assets/Levels/Mine.landscapes/landscape-1.terrain.json"), "{}");
      await writeFile(join(root, "assets/Levels/Mine.meshpaint.json"), "{}");
      const world = { seed: 9, size: "small", landform: "plain", mountainHeight: "low", settlements: [{ type: "hamlet" }], roads: "between" } as const;
      const result = await runRandomWorld({ root, out: level, force: true, world: { ...world, settlements: [...world.settlements] } });
      assert.equal(result.level, level);
      await assert.rejects(access(join(root, "assets/Levels/Mine.landscapes/landscape-1.terrain.json")));
      await assert.rejects(access(join(root, "assets/Levels/Mine.meshpaint.json")));
      const built = JSON.parse(await readFile(join(root, level), "utf8")) as { landscapes?: Array<{ dataRef: string }> };
      assert.equal(built.landscapes?.length, 1);
      await access(join(root, built.landscapes![0]!.dataRef));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
