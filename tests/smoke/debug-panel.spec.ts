import { expect, test } from "@playwright/test";

/**
 * F6 of the `?debug` performance-instrument plan: the panel driven in a real
 * browser.
 *
 * Everything the panel is made of is unit-tested headlessly — the region
 * arithmetic, the capture decomposition, the sweep's bracketing, the table text.
 * What no unit test can reach is whether the thing is *usable*: that the control
 * strip renders, that arming a capture actually produces a table one frame
 * later, that the modal closes, and that the diagnostic pause releases its own
 * hold and leaves the scene running. Those are exactly the failures that would
 * survive a green suite, so they live here.
 *
 * The perf witness is checked in the same run, because the harness that reads it
 * (`npm run perf:quality`) is otherwise the only consumer and a silently absent
 * attribute would just look like a quiet machine.
 */
const DEBUG_URL = "/?debug";

test.setTimeout(180_000);

test("debug panel: the control strip captures a frame, shows a table and closes it", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  await context.addInitScript(() => {
    localStorage.clear();
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(DEBUG_URL, { waitUntil: "domcontentloaded" });
  await page.locator("#game-canvas").waitFor({ state: "visible", timeout: 60_000 });
  const loading = page.locator(".forge-loading");
  if (await loading.count()) {
    await loading.waitFor({ state: "hidden", timeout: 90_000 }).catch(() => undefined);
  }

  // The panel took over #debug-stats rather than adding a sibling, so the
  // element that carries the viewport-overlay CSS is the panel itself.
  const panel = page.locator("#debug-stats.forge-debug-panel");
  await expect(panel).toBeVisible();
  const readout = panel.locator(".forge-debug-panel-readout");
  await expect
    .poll(async () => (await readout.textContent())?.length ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  // The readout grew the F0/F1 lines, and the frame account replaced the old
  // top-3 subsystem listing.
  const text = (await readout.textContent()) ?? "";
  expect(text).toContain("stalls >33ms");
  expect(text).toContain("buffer ");
  expect(text).toContain("graph ");
  expect(text).toMatch(/frame \d+\.\d+ms .*measured \d+%/);

  // --- the machine-readable witness ----------------------------------------
  await expect
    .poll(async () => page.locator("#game-canvas").getAttribute("data-forge-perf"), {
      timeout: 20_000,
    })
    .not.toBeNull();
  const witness = JSON.parse(
    (await page.locator("#game-canvas").getAttribute("data-forge-perf")) ?? "null",
  );
  expect(witness.schema).toBe(1);
  expect(typeof witness.avgFrameMs).toBe("number");
  expect(typeof witness.drawCalls).toBe("number");
  expect(typeof witness.quality).toBe("string");

  // The runtime locks the pointer for mouse-look, and a locked pointer routes
  // every event to the canvas wherever the cursor is — so the panel is
  // unreachable until the lock is released, exactly as it is for a person.
  // Escape is the browser's own release, and the game mode opens its menu
  // screen on the same key; the panel has to stay reachable over that screen,
  // which is why it sits above the UI layers.
  if (await page.evaluate(() => document.pointerLockElement !== null)) {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.pointerLockElement === null, undefined, {
      timeout: 10_000,
    });
  }

  // --- the frame capture ----------------------------------------------------
  const modal = page.locator(".forge-debug-table");
  await expect(modal).toBeHidden();
  await page.locator('[data-forge-debug-action="frame-cost"]').click();
  // Armed for the *next* frame, so the table appears a frame later rather than
  // inside the click handler.
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(modal.locator("h2")).toHaveText("Frame cost (CPU)");
  const rows = modal.locator(".forge-debug-table-grid tbody tr");
  expect(await rows.count()).toBeGreaterThan(1);
  // The table says what it does not prove, in the table.
  await expect(modal.locator(".forge-debug-table-notes")).toContainText("their total is the frame");

  // Copy: the clipboard may be refused in a headless context, and the button
  // must say so rather than silently doing nothing.
  const copy = page.locator('[data-forge-debug-action="copy-table"]');
  await expect(copy).toHaveText("Copy to clipboard");
  await copy.click();
  await expect(copy).not.toHaveText("Copy to clipboard", { timeout: 5_000 });

  await page.locator('[data-forge-debug-action="close-table"]').click();
  await expect(modal).toBeHidden();

  // --- the diagnostic pause -------------------------------------------------
  const pause = page.locator('[data-forge-debug-action="toggle-pause"]');
  await expect(pause).toHaveText("Pause");
  await pause.click();
  await expect(pause).toHaveText("Resume");
  await expect(pause).toHaveAttribute("data-forge-debug-held", "self");
  // Rendering continues while the world is held — the GPU sweep depends on it,
  // and a frozen canvas would look identical to a crash.
  const framesWhilePaused = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0;
        const tick = () => {
          count += 1;
          if (count >= 5) resolve(count);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(framesWhilePaused).toBe(5);
  // The scene clock stops with the world, which is what "paused" has to mean.
  const heldWitness = JSON.parse(
    (await page.locator("#game-canvas").getAttribute("data-forge-perf")) ?? "null",
  );
  expect(heldWitness.paused).toBe(true);

  await pause.click();
  await expect(pause).toHaveText("Pause");
  await expect(pause).toHaveAttribute("data-forge-debug-held", "none");

  expect(pageErrors).toEqual([]);
});
