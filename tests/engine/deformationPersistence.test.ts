import assert from "node:assert/strict";
import { DEFORMATION_DEPTH_SCALE, DeformationField, type DeformationSample } from "../../engine/scene/deformationField";
import { CoarseDeformationLayer, DEFORMATION_CHUNK_SIZE } from "../../engine/scene/deformationPersistence";
import {
  decodeDeformationState, encodeDeformationState, encodeDeformationStateWithinBudget, DEFORMATION_SAVE_BUDGET,
  type DeformationStateInput,
} from "../../engine/scene/deformationStateCodec";

type Check = (label: string, fn: () => void) => void;
const identity = { levelPath: "layouts/雪.level.json", terrainId: "terrain-1" };
const input = (): DeformationStateInput => ({ ...identity,
  window: new DeformationField({ windowSize: 8, cellSize: 0.5 }), coarse: new CoarseDeformationLayer() });
const close = (actual: number, expected: number, epsilon = 1 / DEFORMATION_DEPTH_SCALE): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const base64 = (...bytes: number[]): string => btoa(String.fromCharCode(...bytes));

export function registerDeformationPersistenceTests(check: Check): void {
  check("deformation persistence: recenter evicts only leaving active cells and max-pools both channels", () => {
    const coarse = new CoarseDeformationLayer();
    const calls: number[][] = [];
    const field = new DeformationField({ windowSize: 4, cellSize: 0.5,
      onEvictCell: (x, z, depth, disturbance) => {
        calls.push([x, z, depth, disturbance]);
        coarse.absorbCell(x, z, depth, disturbance);
      } });
    const pooled = new Map<string, { x: number; z: number; depth: number; disturbance: number }>();
    for (const [x, z] of [[0.5, 0], [0.5, -0.5], [-0.5, 0.5], [0, 0], [8, -8], [8, -8], [-8, 8]]) {
      const [minX, minZ] = field.originCell;
      for (let dz = 0; dz < 8; dz += 1) for (let dx = 0; dx < 8; dx += 1) {
        field.stampDisc([(minX + dx + 0.5) * 0.5, (minZ + dz + 0.5) * 0.5], 0.1,
          (dx + 1) / 100, 1, 200 - dx * 10);
      }
      const nextX = Math.floor(x! / 0.5) - 4;
      const nextZ = Math.floor(z! / 0.5) - 4;
      const expected: number[][] = [];
      field.forEachActiveCell((wx, wz, depth, disturbance) => {
        const cx = Math.floor(wx / 0.5);
        const cz = Math.floor(wz / 0.5);
        if (cx < nextX || cx >= nextX + 8 || cz < nextZ || cz >= nextZ + 8) {
          expected.push([wx, wz, depth, disturbance]);
          const key = `${Math.floor(wx)},${Math.floor(wz)}`;
          const previous = pooled.get(key);
          pooled.set(key, { x: wx, z: wz, depth: Math.max(previous?.depth ?? 0, depth),
            disturbance: Math.max(previous?.disturbance ?? 0, disturbance) });
        }
      });
      calls.length = 0;
      field.recenter(x!, z!);
      assert.deepEqual(calls, expected, "includes diagonal corners once and all cells on teleport");
      for (const value of pooled.values()) {
        assert.deepEqual(coarse.sample(value.x, value.z), { depth: value.depth, disturbance: value.disturbance });
      }
    }
  });

  check("deformation persistence: optional hook preserves recenter buffers dirty regions and recovery", () => {
    const coarse = new CoarseDeformationLayer();
    const plain = new DeformationField({ windowSize: 8, cellSize: 0.5 });
    const hooked = new DeformationField({ windowSize: 8, cellSize: 0.5, onEvictCell: coarse.absorbCell });
    const depthView = hooked.depth;
    for (const [x, z] of [[0, 0], [1, -1], [-1, 1], [-3, -2], [20, 30], [20, 30], [-20, -30]]) {
      for (const field of [plain, hooked]) {
        field.stampDisc([field.originCell[0] * 0.5 + 0.25, field.originCell[1] * 0.5 + 0.25], 1, 0.3);
        field.stampDisc([0.25, 0.25], 0.7, 0, 1, 100);
        field.decay(0.01, 0.0003);
        field.recenter(x!, z!);
        field.decay(0.1, 0.02);
      }
      assert.deepEqual(hooked.depth, plain.depth);
      assert.deepEqual(hooked.disturbance, plain.disturbance);
      assert.deepEqual(hooked.stats(), plain.stats());
      assert.deepEqual(hooked.takeDirty(), plain.takeDirty());
      assert.deepEqual(hooked.originCell, plain.originCell);
      assert.equal(hooked.depth, depthView);
    }
  });

  check("deformation persistence: coarse chunks are sparse world-aligned and snapshot-isolated", () => {
    const coarse = new CoarseDeformationLayer();
    assert.equal(coarse.cellSize, 1);
    assert.equal(coarse.chunkCount, 0);
    coarse.absorbCell(10_000, -10_000, 0, 0);
    coarse.absorbCell(NaN, 0, 1, 2);
    assert.equal(coarse.chunkCount, 0);
    coarse.absorbCell(-0.9, -0.9, 0.2, 100);
    coarse.absorbCell(-0.1, -0.1, 0.1, 200);
    assert.equal(coarse.chunkCount, 1);
    assert.deepEqual(coarse.sample(-0.001, -0.001), { depth: 0.2, disturbance: 200 });
    assert.deepEqual(coarse.sample(0, 0), { depth: 0, disturbance: 0 });
    const chunks = coarse.snapshotChunks();
    assert.equal(chunks[0]!.x, -1);
    assert.equal(chunks[0]!.z, -1);
    assert.equal(chunks[0]!.depth.length, DEFORMATION_CHUNK_SIZE ** 2);
    chunks[0]!.depth.fill(0);
    assert.equal(coarse.sample(-0.5, -0.5).depth, 0.2);
    coarse.absorbCell(100_000.5, 100_000.5, 0, 250);
    assert.equal(coarse.chunkCount, 2);
    assert.equal(coarse.sample(100_000.5, 100_000.5).disturbance, 250);
    assert.deepEqual(coarse.sample(Infinity, 0), { depth: 0, disturbance: 0 });
    assert.throws(() => new CoarseDeformationLayer(NaN), RangeError);
    assert.throws(() => new CoarseDeformationLayer(0.25).absorbWindow(input().window), RangeError);
  });

  check("deformation persistence: absorbWindow is idempotent and leaves live channels untouched", () => {
    const state = input();
    state.window.recenter(-2, 3);
    state.window.stampDisc([-1.75, 3.25], 0.1, 0.32, 1, 99);
    const before = state.window.depth.slice();
    state.coarse.absorbWindow(state.window);
    const chunks = state.coarse.snapshotChunks();
    state.coarse.absorbWindow(state.window);
    assert.deepEqual(state.coarse.snapshotChunks(), chunks);
    assert.deepEqual(state.window.depth, before);
    assert.deepEqual(state.coarse.sample(-1.1, 3.9), { depth: 0.32, disturbance: 99 });
  });

  check("deformation persistence: JSON round trip preserves logical window and coarse within depth precision", () => {
    const state = input();
    state.window.recenter(-3, 5);
    const [minX, minZ] = state.window.originCell;
    for (let z = 0; z < 16; z += 1) for (let x = 0; x < 16; x += 1) {
      state.window.stampDisc([(minX + x + 0.5) * 0.5, (minZ + z + 0.5) * 0.5], 0.1,
        (x * 16 + z) / 1000, 1, (x + z * 16) % 256);
    }
    state.coarse.absorbCell(-80, 90, 0.37, 255);
    const before = state.coarse.snapshotChunks();
    const payload = encodeDeformationState(state);
    assert.deepEqual(state.coarse.snapshotChunks(), before, "encoding is a pure snapshot");
    const decoded = decodeDeformationState(JSON.parse(JSON.stringify(payload)), identity);
    assert.equal(decoded.status, "ok");
    if (decoded.status !== "ok") return;
    assert.ok(decoded.window);
    assert.equal(decoded.window.minCellX, minX);
    assert.equal(decoded.window.minCellZ, minZ);
    assert.equal(decoded.window.cellSize, 0.5);
    const epsilon = payload.maxDepth / 510 + 0.00005;
    for (let z = 0; z < 16; z += 1) for (let x = 0; x < 16; x += 1) {
      const sample = state.window.sample((minX + x + 0.5) * 0.5, (minZ + z + 0.5) * 0.5);
      close(decoded.window.depth[z * 16 + x]! / DEFORMATION_DEPTH_SCALE, sample.depth, epsilon);
      assert.equal(decoded.window.disturbance[z * 16 + x], sample.disturbance);
    }
    const expectedCoarse = new CoarseDeformationLayer(state.coarse.cellSize, before);
    expectedCoarse.absorbWindow(state.window);
    for (const chunk of expectedCoarse.snapshotChunks()) for (let i = 0; i < 1024; i += 1) {
      const sample: DeformationSample = decoded.coarse.sample(chunk.x * 32 + i % 32 + 0.5, chunk.z * 32 + Math.floor(i / 32) + 0.5);
      close(sample.depth, chunk.depth[i]! / DEFORMATION_DEPTH_SCALE, epsilon);
      assert.equal(sample.disturbance, chunk.disturbance[i]);
    }
  });

  check("deformation persistence: empty and saturated channel round trips", () => {
    const state = input();
    assert.equal(decodeDeformationState(encodeDeformationState(state), identity).status, "ok");
    state.window.stampDisc([0.25, 0.25], 0.1, 6.5535, 1, 255);
    const decoded = decodeDeformationState(encodeDeformationState(state), identity);
    assert.equal(decoded.status, "ok");
    if (decoded.status === "ok") assert.deepEqual(decoded.coarse.sample(0.25, 0.25), { depth: 6.5535, disturbance: 255 });
  });

  check("deformation persistence: invalid version finite metadata sizes and duplicate chunks rejected", () => {
    const state = input();
    state.coarse.absorbCell(0, 0, 0.2, 100);
    const payload = encodeDeformationState(state);
    const bad: unknown[] = [null, [], {}, { ...payload, version: 2 }, { ...payload, levelPath: "" },
      { ...payload, terrainId: 1 }, { ...payload, maxDepth: NaN }, { ...payload, maxDepth: Infinity },
      { ...payload, maxDepth: 0 }, { ...payload, maxDepth: 7 }, { ...payload, window: undefined }];
    for (const patch of [{ cellSize: NaN }, { cellSize: Infinity }, { cellSize: 0 }, { cellSize: 2 },
      { cellsPerSide: 0 }, { cellsPerSide: 1.5 }, { cellsPerSide: 2049 }, { cellsPerSide: 15 },
      { minCellX: NaN }, { minCellZ: 0.1 }, { minCellX: Number.MAX_SAFE_INTEGER }]) {
      bad.push({ ...payload, window: { ...payload.window, ...patch } });
    }
    for (const cellSize of [NaN, Infinity, 0, -1]) bad.push({ ...payload, coarse: { ...payload.coarse, cellSize } });
    bad.push({ ...payload, coarse: { ...payload.coarse, chunks: [payload.coarse.chunks[0], payload.coarse.chunks[0]] } });
    bad.push({ ...payload, coarse: { ...payload.coarse, chunks: Array(4097).fill(payload.coarse.chunks[0]) } });
    bad.push({ ...payload, coarse: { ...payload.coarse, chunks: Array(4096).fill(payload.coarse.chunks[0]) } });
    for (const patch of [{ x: NaN }, { z: 0.1 }, { x: Number.MAX_SAFE_INTEGER }, { depthRle: base64(0, 1) }]) {
      bad.push({ ...payload, coarse: { ...payload.coarse, chunks: [{ ...payload.coarse.chunks[0], ...patch }] } });
    }
    for (const value of bad) assert.equal(decodeDeformationState(value, identity).status, "error");
    assert.throws(() => encodeDeformationState({ ...state, terrainId: "" }), RangeError);
  });

  check("deformation persistence: short overflowing malformed and noncanonical base64 RLE rejected", () => {
    const payload = encodeDeformationState(input());
    for (const rle of ["", "%%%?", "AAE", "AAF=", "AAE=\n", base64(0), base64(0, 0),
      base64(0, 1), base64(0, 129, 2), base64(0, 128), base64(0, 128, 0),
      base64(0, 128, 128, 128, 128, 1), base64(0, 128, 2, 1, 1)]) {
      for (const channel of ["depthRle", "disturbanceRle"]) {
        const decoded = decodeDeformationState({ ...payload, window: { ...payload.window, [channel]: rle } }, identity);
        assert.deepEqual(decoded, { status: "error", reason: "invalid-rle" }, rle);
      }
    }
  });

  check("deformation persistence: mismatched level or terrain ignored", () => {
    const payload = encodeDeformationState(input());
    assert.deepEqual(decodeDeformationState(payload, { ...identity, levelPath: "other.level.json" }),
      { status: "ignored", reason: "level-mismatch" });
    assert.deepEqual(decodeDeformationState(payload, { ...identity, terrainId: "other" }),
      { status: "ignored", reason: "terrain-mismatch" });
  });

  check("deformation persistence: byte budget drops window preserving current and old coarse tracks", () => {
    const state = input();
    state.coarse.absorbCell(-100, 200, 0.25, 180);
    state.window.stampDisc([0.25, 0.25], 0.1, 0.2, 1, 220);
    const full = encodeDeformationStateWithinBudget(state);
    assert.equal(full.mode, "window-and-coarse");
    assert.equal(full.withinBudget, true);
    assert.equal(full.byteLength, new TextEncoder().encode(JSON.stringify(full.payload)).byteLength);
    assert.equal(encodeDeformationStateWithinBudget(state, full.byteLength).mode, "window-and-coarse");
    const fallback = encodeDeformationStateWithinBudget(state, full.byteLength - 1);
    assert.equal(fallback.mode, "coarse-only");
    assert.equal(fallback.withinBudget, true);
    assert.equal(fallback.payload.window, null);
    const decoded = decodeDeformationState(fallback.payload, identity);
    assert.equal(decoded.status, "ok");
    if (decoded.status === "ok") {
      assert.equal(decoded.window, null);
      close(decoded.coarse.sample(0.25, 0.25).depth, 0.2, fallback.payload.maxDepth / 510 + 0.00005);
      close(decoded.coarse.sample(-100, 200).depth, 0.25);
      assert.equal(decoded.coarse.sample(0.25, 0.25).disturbance, 220);
    }
    const tooSmall = encodeDeformationStateWithinBudget(state, 1);
    assert.equal(tooSmall.mode, "coarse-only");
    assert.equal(tooSmall.withinBudget, false);
    for (const budget of [-1, NaN, 0.5]) assert.throws(() => encodeDeformationStateWithinBudget(state, budget), RangeError);

    const noisy = new DeformationField();
    for (let z = 0; z < 128; z += 1) for (let x = 0; x < 128; x += 1) {
      noisy.stampDisc([(x + 0.5) * 0.125, (z + 0.5) * 0.125], 0.04,
        (x + z) % 2 === 0 ? 0.1 : 0.2, 1, (x + z) % 2 === 0 ? 127 : 255);
    }
    const defaultFallback = encodeDeformationStateWithinBudget({ ...identity, window: noisy, coarse: new CoarseDeformationLayer() });
    assert.equal(defaultFallback.mode, "coarse-only", "default 64 KiB budget drops a noisy detailed window");
    assert.equal(defaultFallback.withinBudget, true);
  });

  check("deformation persistence: two kilometre four-wheel drive stays within 64 KiB", () => {
    const coarse = new CoarseDeformationLayer();
    const window = new DeformationField({ onEvictCell: coarse.absorbCell });
    // Gently winding route along Z, crossing chunk boundaries and negative X.
    for (let z = 0; z < 2000; z += 4) {
      window.recenter(10 * Math.sin(z / 100), z);
      for (const side of [-0.9, 0.9]) for (const axle of [-1.4, 1.4]) {
        window.stampWheel({ from: [10 * Math.sin(z / 100) + side, z + axle],
          to: [10 * Math.sin((z + 4) / 100) + side, z + 4 + axle],
          width: 0.3, contactLength: 0.4, targetDepth: 0.12 + 0.02 * Math.sin(z / 40),
          compaction: 0.5, disturbance: 180 + Math.floor(30 * Math.sin(z / 30)) });
      }
    }
    const encoded = encodeDeformationStateWithinBudget({ ...identity, window, coarse });
    assert.ok(coarse.chunkCount > 60, "history must span the entire route");
    assert.ok(encoded.byteLength <= DEFORMATION_SAVE_BUDGET, `${encoded.byteLength} bytes, ${encoded.mode}`);
    assert.equal(encoded.withinBudget, true);
    const decoded = decodeDeformationState(encoded.payload, identity);
    assert.equal(decoded.status, "ok");
    if (decoded.status === "ok") assert.ok(decoded.coarse.sample(0.9, 0).depth > 0);
  });
}
