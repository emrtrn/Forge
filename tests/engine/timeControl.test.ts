/**
 * F4 of the `?debug` performance-instrument plan: pause holders and time scale.
 *
 * The two rules under test are the ones that decide whether a diagnostic can be
 * trusted with the world's clock: a hold releases only itself (so a diagnostic
 * leaves the scene exactly as it found it), and the scale never leaks into the
 * measurement of real time.
 */
import assert from "node:assert/strict";

import {
  DIAGNOSTIC_TIME_HOLDER,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
  TimeControl,
} from "../../engine/core/timeControl";
import { FrameMetricsMonitor } from "../../engine/perf/frameMetrics";

type Check = (label: string, fn: () => void) => void;

export function registerTimeControlTests(check: Check): void {
  check("a pause is held, so releasing one hold never resumes someone else's", () => {
    const time = new TimeControl();
    assert.equal(time.paused, false);

    // The game pauses for a menu; then a diagnostic pauses to read a table.
    time.pause("menu");
    time.pause(DIAGNOSTIC_TIME_HOLDER);
    assert.equal(time.paused, true);
    assert.deepEqual(time.pausedBy(), ["menu", DIAGNOSTIC_TIME_HOLDER]);

    // Closing the diagnostic must leave the world exactly as it found it — with
    // a boolean here, this release would silently un-pause the player's menu.
    time.resume(DIAGNOSTIC_TIME_HOLDER);
    assert.equal(time.paused, true);
    assert.equal(time.heldBy(DIAGNOSTIC_TIME_HOLDER), false);
    assert.equal(time.heldBy("menu"), true);

    time.resume("menu");
    assert.equal(time.paused, false);
    // Releasing a hold you never took is a no-op, not an error: a diagnostic
    // that closes twice must not throw at the player.
    time.resume(DIAGNOSTIC_TIME_HOLDER);
    assert.equal(time.paused, false);
    // And taking the same hold twice still holds once.
    time.pause("menu");
    time.pause("menu");
    time.resume("menu");
    assert.equal(time.paused, false);
  });

  check("time scale survives a pause instead of collapsing into it", () => {
    const time = new TimeControl();
    time.setTimeScale(4);
    time.pause(DIAGNOSTIC_TIME_HOLDER);
    // Paused means the world does not advance; it does not mean "1x".
    assert.equal(time.simulationDelta(16), 0);
    assert.equal(time.timeScale, 4);
    time.resume(DIAGNOSTIC_TIME_HOLDER);
    // …so resuming gives back the speed you had, not a snap to normal.
    assert.equal(time.simulationDelta(16), 64);
  });

  check("time scale clamps, and refuses a value that would poison every delta", () => {
    const time = new TimeControl();
    assert.equal(time.setTimeScale(100), MAX_TIME_SCALE);
    assert.equal(time.setTimeScale(0), MIN_TIME_SCALE);
    assert.equal(time.setTimeScale(-3), MIN_TIME_SCALE);
    // A zero scale would be a second, untracked way to stop the world that
    // nothing could tell apart from a very slow one; that is what pause is for.
    assert.ok(MIN_TIME_SCALE > 0);
    // One NaN would turn every downstream delta into NaN for the rest of the
    // session, with nothing left to point at.
    time.setTimeScale(2);
    assert.equal(time.setTimeScale(Number.NaN), 2);
    assert.equal(time.setTimeScale(Number.POSITIVE_INFINITY), 2);
    assert.equal(time.timeScale, 2);
  });

  check("frame metrics keep reading real time whatever the simulation is told", () => {
    // The failure this prevents: at 4x, a stall measured on the scaled delta
    // reports a quarter of the milliseconds, and a paused game looks like it has
    // never dropped a frame in its life.
    const time = new TimeControl();
    time.setTimeScale(4);
    const metrics = new FrameMetricsMonitor();
    const rawFrames = [16, 16, 120, 16];
    for (const raw of rawFrames) {
      metrics.record(raw); // raw, always — the loop does exactly this
      time.simulationDelta(raw); // and the simulation gets its own number
    }
    const snapshot = metrics.metrics();
    assert.equal(snapshot.sampleCount, 4);
    assert.equal(metrics.spikeCounts().over100ms, 1);
    assert.equal(snapshot.averageFrameTimeMs, (16 + 16 + 120 + 16) / 4);

    // Same again while paused: the display still stalled, and it still counts.
    time.pause(DIAGNOSTIC_TIME_HOLDER);
    const held = new FrameMetricsMonitor();
    held.record(150);
    assert.equal(time.simulationDelta(150), 0);
    assert.equal(held.spikeCounts().over100ms, 1);
  });

  check("resumeAll is for teardown, and a scale of 1 is the identity", () => {
    const time = new TimeControl();
    time.pause("menu");
    time.pause("cutscene");
    time.resumeAll();
    assert.equal(time.paused, false);
    assert.deepEqual(time.pausedBy(), []);
    assert.equal(time.simulationDelta(16.7), 16.7);
  });
}
