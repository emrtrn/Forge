/**
 * F3 of the `?debug` performance-instrument plan: the one-frame CPU capture.
 *
 * What is under test is the arithmetic that makes the table believable — the
 * residual rows, a decomposed group replaced by its children rather than listed
 * beside them, a region that did not run reported as absent rather than as zero,
 * and the window columns kept distinct from the captured frame.
 */
import assert from "node:assert/strict";

import { SubsystemProfiler } from "../../engine/core/subsystemProfiler";
import {
  buildFrameCapture,
  formatFrameCaptureText,
  frameCaptureTableView,
} from "../../engine/perf/frameCapture";

type Check = (label: string, fn: () => void) => void;

/** A profiler mid-frame: regions recorded, `endFrame` not yet called. */
function capturedFrame(): SubsystemProfiler {
  const profiler = new SubsystemProfiler(4);
  profiler.declareRegion({ id: "engine" });
  profiler.declareRegion({ id: "physics", parent: "engine" });
  profiler.declareRegion({ id: "ai", parent: "engine" });
  profiler.declareRegion({ id: "render" });
  profiler.declareRegion({ id: "debugWires", debugOnly: true });
  // A first frame, so the window has something the captured frame differs from.
  profiler.record("engine", 4);
  profiler.record("physics", 2);
  profiler.record("ai", 1);
  profiler.record("render", 2);
  profiler.record("debugWires", 1);
  profiler.recordFrame(10);
  profiler.endFrame();
  // The frame being captured: everything doubled except the AI, which does not
  // run this frame at all.
  profiler.record("engine", 8);
  profiler.record("physics", 4);
  profiler.record("render", 4);
  profiler.record("debugWires", 2);
  profiler.recordFrame(20);
  return profiler;
}

export function registerFrameCaptureTests(check: Check): void {
  check("a captured frame's rows sum to the frame", () => {
    const capture = buildFrameCapture(capturedFrame().captureFrame(), { sceneSeconds: 12.5 });
    assert.equal(capture.totalMs, 20);
    // engine(8) decomposes into physics(4) + ai(absent) + engine (other)(4);
    // render 4, debugWires 2, and 6 ms of the frame nothing measured.
    assert.deepEqual(
      capture.rows.map((row) => [row.label, row.frameMs]),
      [
        ["unmeasured", 6],
        ["engine (other)", 4],
        ["physics", 4],
        ["render", 4],
        ["debugWires", 2],
        ["ai", null],
      ],
    );
    const total = capture.rows.reduce((sum, row) => sum + (row.frameMs ?? 0), 0);
    assert.equal(total, 20);
    // Shares are of the captured frame, and they add to one.
    assert.equal(
      capture.rows.reduce((sum, row) => sum + row.share, 0).toFixed(6),
      "1.000000",
    );
  });

  check("a decomposed group is replaced by its children, never listed beside them", () => {
    const capture = buildFrameCapture(capturedFrame().captureFrame(), { sceneSeconds: 0 });
    // Listing `engine` as well as its children would double 8 of the 20 ms and
    // quietly break every percentage in the table.
    assert.equal(capture.rows.some((row) => row.label === "engine"), false);
    const other = capture.rows.find((row) => row.label === "engine (other)")!;
    assert.equal(other.group, "engine");
    assert.equal(other.kind, "residual");
    // The residual's average is the group's average minus its children's, so it
    // is comparable with the frame column beside it…
    assert.equal(other.averageMs, (4 + 8) / 2 - ((2 + 4) / 2 + 1 / 1));
    // …but it carries no peak: the group's worst frame and the children's worst
    // frames are different frames, so subtracting them would invent a number.
    assert.equal(other.maxMs, 0);
  });

  check("a region that did not run reads as absent, not as zero", () => {
    const capture = buildFrameCapture(capturedFrame().captureFrame(), { sceneSeconds: 0 });
    const ai = capture.rows.find((row) => row.label === "ai")!;
    assert.equal(ai.frameMs, null);
    // Its window is still shown: a reader can see that the thing they expected
    // to be expensive simply did not happen in this frame.
    assert.equal(ai.averageMs, 1);
    const view = frameCaptureTableView(capture);
    const aiCells = view.rows.find((row) => row.cells[0] === "ai")!.cells;
    assert.equal(aiCells[2], "—");
    assert.equal(aiCells[4], "1.00");
    assert.ok(view.notes.some((note) => note.includes("did not run in this frame")));
  });

  check("the captured frame is shown beside the window it came from", () => {
    const capture = buildFrameCapture(capturedFrame().captureFrame(), { sceneSeconds: 12.5 });
    // The single frame is 20 ms; the two-frame window averages 15 and peaks 20.
    // Without the second half, "was this frame typical?" can only be guessed at.
    assert.equal(capture.averageTotalMs, 15);
    assert.equal(capture.maxTotalMs, 20);
    assert.equal(capture.windowFrames, 2);
    const view = frameCaptureTableView(capture);
    assert.equal(
      view.meta,
      "20.00 ms total · avg 15.00 · peak 20.00 (last 2 frames) · scene 12.5 s",
    );
    const render = view.rows.find((row) => row.cells[0] === "render")!.cells;
    assert.deepEqual(render, ["render", "—", "4.00", "20.0%", "3.00", "4.00"]);
    assert.ok(view.notes.some((note) => note.includes("rolling window, not this frame")));
    assert.ok(view.notes.some((note) => note.includes("their total is the frame")));
  });

  check("diagnostic-only rows stay marked in the table and in the pasted text", () => {
    const capture = buildFrameCapture(capturedFrame().captureFrame(), { sceneSeconds: 0 });
    const view = frameCaptureTableView(capture);
    const wires = view.rows.find((row) => row.kind === "debug")!;
    assert.equal(wires.cells[0], "debugWires *");
    assert.ok(view.notes.some((note) => note.includes("shipped build does not pay")));
    // The text form carries the same mark: a capture pasted into a bug report
    // must not read as though the shipped build spends those milliseconds.
    const text = formatFrameCaptureText(capture);
    assert.ok(text.includes("debugWires *"));
    assert.ok(text.endsWith("* diagnostic route only; the shipped build does not pay for it."));
  });

  check("a capture with no frame denominator says so instead of inventing shares", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.record("render", 4);
    const capture = buildFrameCapture(profiler.captureFrame(), { sceneSeconds: 3 });
    assert.equal(capture.totalMs, null);
    // No denominator, so no `unmeasured` row: there is no "rest of the frame" to
    // report, and inventing one would claim a coverage nothing supports.
    assert.deepEqual(capture.rows.map((row) => row.label), ["render"]);
    const view = frameCaptureTableView(capture);
    assert.equal(view.meta, "frame not measured · scene 3.0 s");
    assert.equal(view.rows[0]!.cells[3], "—");
    assert.ok(view.notes.some((note) => note.includes("no denominator")));
  });

  check("a capture records the time controls it was taken under", () => {
    // The context a number needs to be read: 8 ms of simulation at 4x is not the
    // same finding as 8 ms at normal speed, and a paused capture is a third.
    const frame = capturedFrame().captureFrame();
    const fast = buildFrameCapture(frame, { sceneSeconds: 30, timeScale: 4 });
    assert.equal(frameCaptureTableView(fast).meta.includes("· 4x ·"), true);
    const held = buildFrameCapture(frame, { sceneSeconds: 30, timeScale: 1, paused: true });
    assert.equal(frameCaptureTableView(held).meta.includes("· paused ·"), true);
    // Nothing is said when nothing is scaling time — an unremarkable default
    // does not deserve a word in the one context line the table gets.
    const plain = buildFrameCapture(frame, { sceneSeconds: 30 });
    assert.equal(frameCaptureTableView(plain).meta.includes("paused"), false);
    assert.equal(frameCaptureTableView(plain).meta.includes("1x"), false);
  });

  check("a group nothing measured cannot swallow its declared children", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "child", parent: "never-recorded" });
    profiler.record("child", 3);
    profiler.recordFrame(5);
    const capture = buildFrameCapture(profiler.captureFrame(), { sceneSeconds: 0 });
    // The child is top-level here, and the 2 ms it leaves is the frame's own
    // residual — not a hidden group's.
    assert.deepEqual(
      capture.rows.map((row) => [row.label, row.frameMs, row.group]),
      [
        ["child", 3, null],
        ["unmeasured", 2, null],
      ],
    );
  });

  check("the frame in progress sums a region entered more than once", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "spawn" });
    // Two spans under one id in one frame — the capture must report the frame's
    // total for it, not just the last span.
    profiler.record("spawn", 1.5);
    profiler.record("spawn", 2.5);
    profiler.recordFrame(6);
    const capture = buildFrameCapture(profiler.captureFrame(), { sceneSeconds: 0 });
    assert.equal(capture.rows.find((row) => row.label === "spawn")!.frameMs, 4);
    // The window still holds the two spans as two samples, so the average is of
    // spans and the frame column is of frames. Those are different questions.
    assert.equal(capture.rows.find((row) => row.label === "spawn")!.averageMs, 2);
  });

  check("endFrame clears the frame so the next capture is not the previous one", () => {
    const profiler = new SubsystemProfiler(4);
    profiler.declareRegion({ id: "render" });
    profiler.record("render", 4);
    profiler.recordFrame(10);
    profiler.endFrame();
    // A frame in which nothing was recorded: every region must read as absent
    // rather than repeating what it cost last time.
    profiler.recordFrame(10);
    const capture = buildFrameCapture(profiler.captureFrame(), { sceneSeconds: 0 });
    assert.equal(capture.rows.find((row) => row.label === "render")!.frameMs, null);
  });
}
