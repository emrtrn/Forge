import { expect, test, type Page } from "@playwright/test";
import { Vector3 } from "three";

import {
  applyResponsiveCameraViewport,
  createSceneCamera,
} from "../../engine/render-three/camera";
import {
  DEFAULT_RTS_CAMERA_SETTINGS,
  rtsCameraPosition,
} from "../../src/game/gameModes/rtsCameraControl";

/**
 * Phase I, the RTS validation case: the app whose absence started the whole
 * layered-runtime plan.
 *
 * `templates/rts-starter` is the game that used to need a second runtime shell —
 * characterless, top-down, cursor-driven. Here it is the game-starter with a
 * shorter capability list (character movement, skeletal animation and AI
 * character animation dropped) and a game module whose entire content is one
 * Game Mode. This smoke is the proof that cost the scene nothing:
 *
 *   (1) the same parity level renders in full — terrain, meshes, materials,
 *       lights, environment, an auto-playing effect — with three capabilities
 *       switched off and no scene-setup code in the app (plan invariants I1/I3),
 *   (2) the RTS Game Mode really runs in a browser: it possesses nothing, a
 *       click selects the placed unit, the screen edge pans the map and the
 *       wheel zooms.
 *
 * If a scene feature ever needs a character capability (or a hand-written app
 * shell) to appear again, this is what fails.
 */
const STARTER_URL = "/templates/rts-starter/index.html";
const STARTER_LEVEL_LOADED = '"layout":"rts"';
/** The parity level's one placed Actor Script — the selectable "unit". */
const PARITY_PROP_ENTITY = "actor:0";
const PARITY_PROP_CENTRE = new Vector3(-2.5, 0.5, 2.5);

test.setTimeout(210_000);

interface RtsCameraState {
  readonly focusX: number;
  readonly focusZ: number;
  readonly zoom: number;
  readonly selected: string;
}

async function waitForConsoleText(
  page: Page,
  messages: readonly string[],
  text: string,
): Promise<void> {
  const seen = () => messages.some((message) => message.includes(text));
  if (seen()) return;
  await page.waitForEvent("console", { predicate: () => seen(), timeout: 60_000 });
}

/**
 * The RTS camera's whole state, read off the `?debug` overlay's `camera:` line.
 * The mode publishes its focus point and zoom there precisely so a camera that
 * will not pan can be told apart from one whose input never arrived.
 */
async function readCameraState(page: Page): Promise<RtsCameraState> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(
    /rts-top-down focus:(-?[\d.]+),(-?[\d.]+) zoom:([\d.]+) selected:(\S+)/,
  );
  if (!match) throw new Error(`no RTS camera readout in the overlay:\n${text}`);
  return {
    focusX: Number(match[1]),
    focusZ: Number(match[2]),
    zoom: Number(match[3]),
    selected: match[4]!,
  };
}

/**
 * Where a world point is on screen, for the camera the RTS mode has right now.
 *
 * The mode's camera is a pure function of its published focus point and zoom, so
 * the test can rebuild it exactly — with the runtime's own camera factory and
 * the mode's own placement function, not a copy of either — and ask Three.js to
 * project. That is what makes clicking a 1 m unit deterministic: no cursor
 * hunting, no timing-dependent panning to line it up.
 */
function screenPointFor(
  state: RtsCameraState,
  world: Vector3,
  width: number,
  height: number,
): { x: number; y: number } {
  const camera = createSceneCamera();
  // viewTouched: the mode owns the camera, so this only applies fov + aspect.
  applyResponsiveCameraViewport(camera, {
    width,
    height,
    target: new Vector3(),
    viewTouched: true,
  });
  const focus = new Vector3(state.focusX, 0, state.focusZ);
  const position = rtsCameraPosition(focus, state.zoom, DEFAULT_RTS_CAMERA_SETTINGS);
  camera.position.set(position.x, position.y, position.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(focus);
  camera.updateMatrixWorld();

  const ndc = world.clone().project(camera);
  if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) {
    throw new Error(
      `world point ${world.toArray().join(",")} is off screen for focus ` +
        `(${state.focusX}, ${state.focusZ}) at zoom ${state.zoom}`,
    );
  }
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

/** Parks the cursor mid-canvas, where no edge band pans the map. */
async function restCursor(page: Page, width: number, height: number): Promise<void> {
  await page.mouse.move(width / 2, height / 2);
  await page.waitForTimeout(150);
}

test("rts-starter smoke: a characterless game renders the whole level and drives its own camera", async ({
  page,
  context,
}) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  await context.addInitScript(() => {
    localStorage.clear();
  });

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (message.type() === "error") pageErrors.push(text);
  });

  await page.goto(`${STARTER_URL}?debug&rtsSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, STARTER_LEVEL_LOADED);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const stats = page.locator("#debug-stats");
  // (1) The scene content, unchanged by dropping three capabilities.
  await expect(stats).toContainText(/[1-9]\d* draw calls/, { timeout: 30_000 });
  await expect(stats).toContainText(/[1-9]\d* tris/);
  await expect(stats).toContainText(/active:[1-9]/, { timeout: 30_000 });
  await expect(stats).toContainText(/alive:[1-9]/, { timeout: 30_000 });

  // The RTS mode is the session, and it possesses nothing: no pawn, no
  // character, no movement solver — the camera itself is the pawn.
  await expect(stats).toContainText("mode: RTS Camera");
  await expect(stats).toContainText("possessed: none");
  await expect(stats).toContainText("camera: rts-top-down", { timeout: 30_000 });

  // Dropping the character capabilities is silent here *because* the level
  // authors none of their data. Anything else would be a coverage-report bug.
  const characterWarnings = consoleMessages.filter(
    (message) =>
      message.includes("Unsupported runtime capability") &&
      /character-movement|skeletal-animation|ai-character-animation/.test(message),
  );
  expect(characterWarnings).toEqual([]);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("the smoke needs a sized viewport");
  const { width, height } = viewport;
  await restCursor(page, width, height);

  // (2a) Click selection, at the level's opening framing: the mode's own pick
  // bridge resolves the placed Actor Script under the cursor.
  const framing = await readCameraState(page);
  expect(framing.selected).toBe("none");
  const unitPoint = screenPointFor(framing, PARITY_PROP_CENTRE, width, height);
  await page.mouse.click(unitPoint.x, unitPoint.y, { delay: 120 });
  await expect
    .poll(async () => (await readCameraState(page)).selected, { timeout: 15_000 })
    .toBe(PARITY_PROP_ENTITY);

  // A click on empty terrain clears it: terrain and scenery are scene content,
  // never selectable units, so the pick bridge answers with nothing there.
  const groundPoint = screenPointFor(
    framing,
    new Vector3(framing.focusX + 4, 0, framing.focusZ),
    width,
    height,
  );
  await page.mouse.click(groundPoint.x, groundPoint.y, { delay: 120 });
  await expect
    .poll(async () => (await readCameraState(page)).selected, { timeout: 15_000 })
    .toBe("none");
  await restCursor(page, width, height);

  // (2b) Edge pan: the cursor in the right-hand band slides the map screen-right
  // (+x at this heading), and parking it mid-canvas stops the camera dead.
  const beforePan = await readCameraState(page);
  await page.mouse.move(width - 2, height / 2);
  await page.waitForTimeout(600);
  await restCursor(page, width, height);
  const afterPan = await readCameraState(page);
  expect(afterPan.focusX).toBeGreaterThan(beforePan.focusX + 1);

  const parked = await readCameraState(page);
  await page.waitForTimeout(400);
  const stillParked = await readCameraState(page);
  expect(stillParked.focusX).toBeCloseTo(parked.focusX, 1);

  // (2c) Wheel zoom, and its clamp: scrolling away pulls the camera out, and no
  // amount of spinning leaves the authored range.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const zoomedOut = await readCameraState(page);
  expect(zoomedOut.zoom).toBeGreaterThan(parked.zoom);

  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(200);
  const zoomedIn = await readCameraState(page);
  expect(zoomedIn.zoom).toBeLessThan(zoomedOut.zoom);
  expect(zoomedIn.zoom).toBeCloseTo(DEFAULT_RTS_CAMERA_SETTINGS.minDistance, 1);

  expect(pageErrors).toEqual([]);
});
