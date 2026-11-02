import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WES_SCENARIOS, classifyGpu, distribution, measurementGate } from '../../tools/perf/wesAcceptanceProtocol.mjs';

const complete = () => ({ device: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, D3D11)', timerAvailable: true,
  cases: WES_SCENARIOS.map(({ id }) => ({ id, frames: { count: 900 }, gpuRender: { count: 900 }, disjoint: false })),
  ibl: { gpu: { count: 12 }, disjoint: false } });

test('WES gate rejects software even with an advertised GPU timer and otherwise complete data', () => {
  for (const device of ['ANGLE (Google, Vulkan SwiftShader Device)', 'Mesa llvmpipe (LLVM 15)', 'Microsoft Basic Render Driver']) {
    assert.equal(classifyGpu(device), 'software');
    const gate = measurementGate({ ...complete(), device });
    assert.equal(gate.measurementReady, false);
    assert.ok(gate.reasons.includes('Hardware GPU not verified'));
  }
});

test('WES gate treats redacted or unknown devices and absent/partial/disjoint timings as unverified', () => {
  assert.equal(classifyGpu(null), 'unknown');
  assert.equal(classifyGpu('WebKit WebGL'), 'unknown');
  for (const patch of [{ device: 'WebKit WebGL' }, { timerAvailable: false }, { cases: [] }, { ibl: null }]) {
    assert.equal(measurementGate({ ...complete(), ...patch }).measurementReady, false);
  }
  const partial = complete(); partial.cases[0].gpuRender.count = 3;
  assert.equal(measurementGate(partial).measurementReady, false);
  const disjoint = complete(); disjoint.cases[0].disjoint = true;
  assert.equal(measurementGate(disjoint).measurementReady, false);
});

test('WES complete hardware measurements never imply visual or product-budget acceptance', () => {
  assert.equal(classifyGpu('ANGLE (Intel, Intel UHD Graphics, D3D11)'), 'hardware');
  const gate = measurementGate(complete());
  assert.equal(gate.measurementReady, true);
  assert.equal(gate.visualAccepted, false);
  assert.equal(gate.budgetAccepted, false);
});

test('WES missing samples remain null; real zero timings are distinct from missing', () => {
  assert.deepEqual(distribution([NaN, Infinity]), { count: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null });
  assert.equal(distribution([0]).p50Ms, 0);
  assert.equal(distribution([3, 1, 2]).p50Ms, 2);
});
