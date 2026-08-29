/**
 * F6 of the `?debug` performance-instrument plan: the machine-readable witness.
 *
 * It is read by a process that is not this one, months after the run, so the
 * rules that matter are about what a field *means* when nobody is left to ask:
 * an unmeasured GPU is null and not zero, and a fork's extra fields can never
 * redefine a shared one.
 */
import assert from "node:assert/strict";

import { buildPerfWitness, serializePerfWitness } from "../../engine/perf/perfWitness";
import type { FrameMetrics } from "../../engine/perf/frameMetrics";

type Check = (label: string, fn: () => void) => void;

const METRICS: FrameMetrics = {
  frameTimeMs: 16.712,
  averageFrameTimeMs: 17.4567,
  p95FrameTimeMs: 24.339,
  spikeCount: 3,
  sampleWindowSeconds: 5,
  sampleCount: 288,
  estimatedRefreshIntervalMs: 16.7,
};

const BASE = {
  metrics: METRICS,
  spikes: { over33ms: 4, over50ms: 1, over100ms: 0 },
  gpu: null,
  drawCalls: 312,
  triangles: 1_240_000,
  geometries: 84,
  textures: 42,
  programs: 19,
  jsHeapBytes: 84_200_000,
  qualityLevel: "high",
  adaptiveEnabled: true,
  reductionDepth: 1,
  timeScale: 1,
  paused: false,
  sceneSeconds: 42.567,
};

export function registerPerfWitnessTests(check: Check): void {
  check("the witness rounds to two decimals and keeps the counts whole", () => {
    const witness = buildPerfWitness(BASE);
    assert.equal(witness.schema, 1);
    // Past two decimals it is timer quantisation dressed as precision.
    assert.equal(witness.avgFrameMs, 17.46);
    assert.equal(witness.p95FrameMs, 24.34);
    assert.equal(witness.sceneSeconds, 42.57);
    assert.equal(witness.drawCalls, 312);
    assert.equal(witness.over33ms, 4);
    assert.equal(witness.quality, "high");
    assert.equal(witness.reductionDepth, 1);
  });

  check("an unmeasured GPU is null in the witness, never a zero", () => {
    // A capture read six months later cannot ask which it was, and the two are
    // opposite findings: a scene that costs the GPU nothing, and a browser that
    // will not say.
    assert.equal(buildPerfWitness(BASE).gpuMs, null);
    const measured = buildPerfWitness({
      ...BASE,
      gpu: { lastMs: 7.4, averageMs: 6.8512, maxMs: 19.04, samples: 60 },
    });
    assert.equal(measured.gpuMs, 6.85);
  });

  check("fork fields ride along but can never redefine a shared one", () => {
    const witness = buildPerfWitness({
      ...BASE,
      extra: { units: 240, matchSeconds: 610, quality: "whatever-the-fork-means" },
    });
    assert.equal(witness.units, 240);
    assert.equal(witness.matchSeconds, 610);
    // A witness whose `quality` means something different per fork is a witness
    // nothing can compare across forks.
    assert.equal(witness.quality, "high");
  });

  check("the witness serialises to something a harness can parse back", () => {
    const witness = buildPerfWitness({ ...BASE, paused: true, timeScale: 4 });
    const parsed = JSON.parse(serializePerfWitness(witness));
    assert.equal(parsed.paused, true);
    assert.equal(parsed.timeScale, 4);
    assert.equal(parsed.gpuMs, null);
    // Small enough to write into a DOM attribute twice a second without the
    // observation becoming part of what is observed.
    assert.ok(serializePerfWitness(witness).length < 512);
  });
}
