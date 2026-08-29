/**
 * F0 of the `?debug` performance-instrument plan: the five readout lines the
 * overlay grew, plus the two things behind them that had no measurement at all
 * before — the scene-cost traversal and the audio voice budget.
 *
 * All of it is checked headlessly, which is the point of keeping the arithmetic
 * in pure functions: a readout that can only be verified by looking at a running
 * browser is a readout nobody verifies.
 */
import assert from "node:assert/strict";

import { AudioSubsystem, DEFAULT_MAX_VOICES } from "../../engine/audio/audioSubsystem";
import type { EngineUpdateContext } from "../../engine/core/Subsystem";
import {
  buildSceneCostSnapshot,
  SCENE_SOURCE_KEY,
  type SceneCostObject,
} from "../../src/scene/runtimeDebugSnapshot";
import {
  compactCount,
  formatAudioBudget,
  formatDrawingBuffer,
  formatFrameSpikes,
  formatSceneCost,
} from "../../src/scene/debugStats";

type Check = (label: string, fn: () => void) => void;

/** A visible mesh node for the traversal tests, with `triangles` worth of index. */
function mesh(options: {
  triangles: number;
  castShadow?: boolean;
  visible?: boolean;
  instances?: number;
  source?: string;
  name?: string;
}): SceneCostObject {
  return {
    type: "Mesh",
    name: options.name ?? "",
    isMesh: true,
    visible: options.visible ?? true,
    castShadow: options.castShadow ?? false,
    ...(options.instances !== undefined
      ? { isInstancedMesh: true, count: options.instances }
      : {}),
    ...(options.source !== undefined ? { userData: { [SCENE_SOURCE_KEY]: options.source } } : {}),
    geometry: { index: { count: options.triangles * 3 } },
  };
}

/** Links `children` back to their parent, as three does when you `add()` them. */
function group(
  name: string,
  children: SceneCostObject[],
  extra: Partial<SceneCostObject> = {},
): SceneCostObject {
  const node: SceneCostObject = { type: "Group", name, visible: true, children, ...extra };
  for (const child of children) (child as { parent?: SceneCostObject }).parent = node;
  return node;
}

function scene(children: SceneCostObject[]): SceneCostObject {
  const root: SceneCostObject = { type: "Scene", name: "", visible: true, children };
  for (const child of children) (child as { parent?: SceneCostObject }).parent = root;
  return root;
}

export function registerPerfReadoutTests(check: Check): void {
  check("formatFrameSpikes keeps the three stall thresholds separate", () => {
    // Summed they would read as one number and hide the finding: a window with
    // four dropped frames and no stall is a different game from one with a
    // single 100 ms freeze, and the sum is 4 either way.
    assert.deepEqual(formatFrameSpikes({ over33ms: 4, over50ms: 1, over100ms: 0 }), [
      "stalls >33ms 4 >50ms 1 >100ms 0",
    ]);
    assert.deepEqual(formatFrameSpikes({ over33ms: 0, over50ms: 0, over100ms: 0 }), [
      "stalls >33ms 0 >50ms 0 >100ms 0",
    ]);
  });

  check("formatDrawingBuffer multiplies CSS size by the effective pixel ratio", () => {
    // 1280x720 at ratio 2 is a 2560x1440 buffer — four times the pixels of the
    // CSS size the window reports, which is the whole reason the line exists.
    assert.deepEqual(formatDrawingBuffer({ width: 1280, height: 720, pixelRatio: 2 }), [
      "buffer 2,560x1,440 ratio 2.00 3.69M px",
    ]);
    // A fractional ratio (a quality profile scaling the render target down)
    // rounds to whole pixels rather than printing a fraction of one.
    assert.deepEqual(formatDrawingBuffer({ width: 1920, height: 1080, pixelRatio: 0.75 }), [
      "buffer 1,440x810 ratio 0.75 1.17M px",
    ]);
  });

  check("compactCount stays readable across the count ranges it reports", () => {
    assert.equal(compactCount(812), "812");
    assert.equal(compactCount(9_999), "9,999");
    assert.equal(compactCount(540_000), "540K");
    assert.equal(compactCount(1_240_000), "1.24M");
    assert.equal(compactCount(Number.NaN), "NaN");
  });

  check("buildSceneCostSnapshot counts what a render pass walks, visible only", () => {
    const hidden = group("hidden-branch", [mesh({ triangles: 100 }), mesh({ triangles: 100 })], {
      visible: false,
    });
    const root = scene([
      group("props", [mesh({ triangles: 10 }), mesh({ triangles: 20 })]),
      hidden,
      mesh({ triangles: 5 }),
    ]);
    const snapshot = buildSceneCostSnapshot(root);
    // props group + its 2 meshes + the loose mesh; the invisible subtree costs
    // the renderer nothing below it and so is not counted at all.
    assert.deepEqual(snapshot.graph, { objects: 4, meshes: 3 });
    // Nothing casts a shadow, so there is no inventory rather than an empty one.
    assert.deepEqual(snapshot.shadows, []);
  });

  check("buildSceneCostSnapshot applies the InstancedMesh count to shadow casters", () => {
    const root = scene([
      mesh({ triangles: 500, castShadow: true, instances: 4_000, source: "foliage" }),
      mesh({ triangles: 1_200, castShadow: true, source: "landscape" }),
    ]);
    const snapshot = buildSceneCostSnapshot(root);
    // One graph node per InstancedMesh — that is what the traversal walks — but
    // 4,000 drawn copies of the geometry, which is what the shadow pass costs.
    assert.deepEqual(snapshot.graph, { objects: 2, meshes: 2 });
    assert.deepEqual(snapshot.shadows, [
      { source: "foliage", meshes: 4_000, triangles: 2_000_000 },
      { source: "landscape", meshes: 1, triangles: 1_200 },
    ]);
  });

  check("scene-cost buckets come from the scene, never from an engine table", () => {
    const tagged = group("whatever", [mesh({ triangles: 10, castShadow: true })], {
      userData: { [SCENE_SOURCE_KEY]: "landscape" },
    });
    const root = scene([
      tagged,
      // Untagged: the label falls back to the top-level scene child's name…
      group("splines", [mesh({ triangles: 40, castShadow: true })]),
      // …and to its type when even the name is empty.
      mesh({ triangles: 70, castShadow: true }),
    ]);
    const sources = buildSceneCostSnapshot(root).shadows.map((bucket) => bucket.source);
    assert.deepEqual(sources, ["Mesh", "splines", "landscape"]);
  });

  check("buildSceneCostSnapshot collapses the tail of the buckets into other", () => {
    const root = scene(
      [900, 800, 700, 600].map((triangles, index) =>
        mesh({ triangles, castShadow: true, source: `s${index}` }),
      ),
    );
    const snapshot = buildSceneCostSnapshot(root, { maxBuckets: 2 });
    assert.deepEqual(snapshot.shadows, [
      { source: "s0", meshes: 1, triangles: 900 },
      { source: "s1", meshes: 1, triangles: 800 },
      { source: "other", meshes: 2, triangles: 1_300 },
    ]);
    // maxBuckets 0 means "keep them all", not "keep none".
    assert.equal(buildSceneCostSnapshot(root, { maxBuckets: 0 }).shadows.length, 4);
  });

  check("formatSceneCost aligns the bucket column and omits an empty inventory", () => {
    assert.deepEqual(formatSceneCost({ graph: { objects: 4_210, meshes: 1_880 }, shadows: [] }), [
      "graph 4,210 nodes 1,880 meshes (walked per pass)",
    ]);
    assert.deepEqual(
      formatSceneCost({
        graph: { objects: 12, meshes: 3 },
        shadows: [
          { source: "foliage", meshes: 4_000, triangles: 2_000_000 },
          { source: "landscape", meshes: 1, triangles: 1_200 },
        ],
      }),
      [
        "graph 12 nodes 3 meshes (walked per pass)",
        "shadow casters",
        "  foliage   4,000 mesh 2.00M tris",
        "  landscape 1 mesh 1,200 tris",
      ],
    );
  });

  check("formatAudioBudget says nothing measured rather than reporting zeros", () => {
    // Principle §2.3: an unmeasured budget and an idle one must not read alike.
    assert.deepEqual(formatAudioBudget(null), ["audio - no voice budget reported"]);
  });

  check("formatAudioBudget reports the ceiling, the peak and the busy buses", () => {
    assert.deepEqual(
      formatAudioBudget({
        active: 3,
        peak: 11,
        limit: 64,
        budgetRefusals: 2,
        byBus: [
          { bus: "sfx", active: 2, peak: 9 },
          { bus: "music", active: 1, peak: 1 },
          // Never sounded: it is headroom, not a finding, so it is not listed.
          { bus: "voice", active: 0, peak: 0 },
        ],
      }),
      ["audio 3/64 voices peak 11 refused budget 2", "  sfx 2/9 music 1/1"],
    );
    // `eventRefusals` only appears where something measures it (a fork running
    // an AudioEventDirector) — absent is absent, not zero.
    const withEvents = formatAudioBudget({
      active: 0,
      peak: 0,
      limit: 24,
      budgetRefusals: 0,
      eventRefusals: 7,
      byBus: [],
    });
    assert.deepEqual(withEvents, ["audio 0/24 voices peak 0 refused budget 0 event 7"]);
  });

  check("AudioSubsystem tracks the voice budget per bus and refuses over the ceiling", () => {
    const audio = new AudioSubsystem({ backend: "none", maxVoices: 3 });
    assert.equal(audio.voiceStats().limit, 3);

    const a = audio.play("tone-a", { loop: true, bus: "sfx" });
    audio.play("tone-b", { loop: true, bus: "sfx" });
    audio.play("tone-c", { loop: true, bus: "music" });
    let stats = audio.voiceStats();
    assert.equal(stats.active, 3);
    assert.equal(stats.peak, 3);
    assert.deepEqual(stats.byBus, [
      { bus: "sfx", active: 2, peak: 2 },
      { bus: "music", active: 1, peak: 1 },
    ]);

    // The fourth play is refused, and gets back a handle that reads as stopped
    // rather than one that silently never sounds.
    const refused = audio.play("tone-d", { loop: true, bus: "sfx" });
    assert.equal(refused.stopped, true);
    assert.equal(audio.voiceStats().budgetRefusals, 1);
    assert.equal(audio.voiceStats().active, 3);

    // Stopping one returns its voice; the peak remembers the moment.
    a.stop();
    stats = audio.voiceStats();
    assert.equal(stats.active, 2);
    assert.equal(stats.peak, 3);
    assert.equal(stats.byBus.find((entry) => entry.bus === "sfx")?.active, 1);
    // Idempotent: a second stop must not double-refund the budget.
    a.stop();
    assert.equal(audio.voiceStats().active, 2);

    audio.resetVoiceStats();
    stats = audio.voiceStats();
    assert.equal(stats.peak, 2);
    assert.equal(stats.budgetRefusals, 0);
  });

  check("AudioSubsystem releases a finished one-shot's voice back to the budget", () => {
    const audio = new AudioSubsystem({ backend: "none" });
    assert.equal(audio.voiceStats().limit, DEFAULT_MAX_VOICES);
    audio.playOneShot("blip", { bus: "sfx" });
    assert.equal(audio.voiceStats().active, 1);
    // The headless backend finishes a non-looping play in the tick that starts
    // it; the budget must come back with it, or a busy scene starves itself.
    audio.update({ deltaSeconds: 0.016, elapsedSeconds: 0.016, frame: 1 } as EngineUpdateContext);
    assert.equal(audio.voiceStats().active, 0);
    assert.equal(audio.voiceStats().peak, 1);
  });
}
