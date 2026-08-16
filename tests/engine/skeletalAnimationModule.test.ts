/**
 * Phase E: the `*.skeleton.json` sidecar library is a Layer 2 capability.
 *
 * The checks drive it the way the shell does — resolve the library, ask for the
 * assets a level's characters use — and pin the three properties the shell
 * relies on: one fetch per asset no matter how many placements share it, a
 * missing sidecar resolving to the empty default rather than failing, and the
 * cache being per level so a re-authored asset is re-read.
 */
import assert from "node:assert/strict";

import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createSkeletalAnimationModule } from "../../src/scene/capabilities/skeletalAnimationModule";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  assetManifestService,
  skeletonLibraryService,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => void;

const MANIFEST = {
  assets: [
    { id: "SK_Hero", type: "model", path: "Characters/SK_Hero.glb" },
    { id: "SK_Extra", type: "model", path: "Characters/SK_Extra.glb" },
  ],
};

const HERO_SKELETON = {
  schema: 1,
  animationSet: { idle: "Idle", walk: "Walk" },
  blendSpaces: [],
  sockets: [],
};

/**
 * Serves only SK_Hero's sidecar and counts requests; SK_Extra 404s, which is the
 * ordinary case of a character asset nobody authored metadata for.
 */
async function withStubbedFetch(run: (urls: string[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (!url.includes("SK_Hero")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => HERO_SKELETON } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = original;
  }
}

function hostWithManifest(): RuntimeServiceHost {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  host.provide(assetManifestService, async () => MANIFEST as never);
  return host;
}

export async function registerSkeletalAnimationModuleTests(
  check: Check,
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("skeleton library dedupes per asset and defaults a missing sidecar", async () => {
    await withStubbedFetch(async (urls) => {
      const host = hostWithManifest();
      const registry = createCapabilityRegistry([createSkeletalAnimationModule()]);
      registry.runtimeStart(host);
      const library = host.resolve(skeletonLibraryService);
      assert.ok(library);

      // Four placements, two distinct assets → two sidecar requests.
      const loaded = await library.load(["SK_Hero", "SK_Extra", "SK_Hero", "SK_Hero"]);
      assert.equal(urls.length, 2);
      assert.deepEqual(loaded.get("SK_Hero")?.animationSet, { idle: "Idle", walk: "Walk" });
      // No sidecar authored: the safe empty default, so the caller can attach
      // the result unconditionally.
      assert.deepEqual(loaded.get("SK_Extra")?.animationSet, {});

      // A second load in the same level is served from the cache.
      await library.load(["SK_Hero", "SK_Extra"]);
      assert.equal(urls.length, 2);

      // The next level re-reads them: an asset may have been re-authored.
      registry.levelUnloaded();
      await library.load(["SK_Hero"]);
      assert.equal(urls.length, 3);

      // An asset the manifest does not list cannot be resolved to a path, and
      // still yields the default rather than throwing.
      const unknown = await library.load(["SK_Ghost"]);
      assert.deepEqual(unknown.get("SK_Ghost")?.blendSpaces, []);

      // A level with no characters asks for nothing at all.
      assert.equal((await library.load([])).size, 0);
      registry.dispose();
    });
  });

  await checkAsync("skeleton library falls back to defaults when no manifest is published", async () => {
    await withStubbedFetch(async (urls) => {
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      const registry = createCapabilityRegistry([createSkeletalAnimationModule()]);
      registry.runtimeStart(host);
      const loaded = await host.resolve(skeletonLibraryService)!.load(["SK_Hero"]);
      assert.equal(urls.length, 0, "no manifest means no sidecar path to fetch");
      assert.deepEqual(loaded.get("SK_Hero")?.animationSet, {});
    });
  });

  check("a runtime without the skeletal module resolves no library", () => {
    // The opt-out case (I3): the shell's attach step becomes a no-op and every
    // character keeps an absent skeleton — it still renders and animates.
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    createCapabilityRegistry([]).runtimeStart(host);
    assert.equal(host.resolve(skeletonLibraryService), undefined);
  });
}
