# Launch Workflow

Single codebase: one dev server, one app, two routes.

## URLs

- **Game:** `http://127.0.0.1:5173/`
- **Editor:** `http://127.0.0.1:5173/?editor` (add `&debug` for the perf overlay)

Start the dev server with `npm run dev` (LAN) or `npm run dev:local`
(`127.0.0.1:5173`, strict port).

## Play / Test (one server)

The game and the editor are the **same app** rendered by the same `SceneApp`, so
there is no second server to run. In the editor, **P** (or the toolbar **Play**
button) saves the current layout and opens the game route (`/`) in a new tab — the
game loads the layout you just saved, so you test exactly what you authored.

(A project can still point Play at an external runtime by setting
`editor.previewUrl` in `public/project.3dgame.json`; absent, Play opens `/`.)

## Authoring data

The editor reads and writes this repo's own `public/`:

- Layout: `public/<editor.defaultScene>` (e.g. `public/layouts/render-test-room.json`)
- Assets: `public/assets/manifest.json` + `public/assets/models/...`
- Manifest: `public/project.3dgame.json`

Saving is a localhost-only dev endpoint (`/__save-layout`); it does not exist in
the production build.

## Packaging

`npm run build` produces the game in `dist/`. The editor is a separate chunk that
the default (game) route never loads, and the dev middleware is dev-only — so the
package contains no editor UI or authoring server.

## Continuous Integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`. It is
the automated mirror of the local pre-`[x]` gate:

- `npm ci` on Node 24 (npm cache enabled via `actions/setup-node`).
- `npm run build:verify` — `tsc --noEmit` + `vite build` + `test:engine`
  (the engine test suite) + `verify:dist -- --strict` (production bundle must
  contain no editor/dev-endpoint strings).
- `npm run check:assets` — asset-manifest health.
- On success, uploads `dist/` as a 7-day artifact (proof packaging works).

Runs on the same ref cancel in-flight predecessors (`concurrency`). A deliberate
type error or a leaked editor string turns CI red; fixing it turns it green.
Deploy is intentionally **not** part of CI — each game fork picks its own deploy
target (see `docs/planned/FORGE_GAME_PROJECT_WORKFLOW.md`).

Locally you can run the identical gate any time with `npm run build:verify`
(add `npm run check:assets` for the asset check).

## Performance readout (`?debug`)

Add `?debug` to any route (`/?debug`, `/?editor&debug`) to show the perf overlay
(`#debug-stats`, top-left). It is `?debug`-only and never ships visible; the
subsystem profiler only runs when the overlay is on, so production pays nothing.

Reading it top-to-bottom:

- **`N fps` / `N draw calls` / `N tris`** — the frame rate and `renderer.info`
  render counts. Draw calls and triangles are the two cheapest levers on GPU
  cost: many small instanced meshes inflate draw calls; dense/unoptimized
  geometry inflates triangles.
- **`perf (avg/frame X.XXms)`** — per-subsystem tick timing, the three most
  expensive first, each `average (last / peak)` in milliseconds over a rolling
  60-frame window. This answers "it got slow — is it the CPU (a subsystem) or
  the GPU (render)?": if `perf` totals are small but fps is low, the cost is in
  rendering (see draw calls / tris); if one subsystem dominates (e.g. `physics`
  or `character-movement`), that is the CPU bottleneck.
- **`memory`** — `geo`/`tex`/`prog` are live GPU geometries, textures and shader
  programs from `renderer.info`; a steadily climbing count across play/level
  travel points at a leak. `heap` (Chrome-only; omitted elsewhere) is the JS
  heap used / limit.
- **`budget` (or `budget (OVER)`)** — each metric against a template threshold
  (`engine/perf/perfBudget.ts` `DEFAULT_PERF_BUDGET`). Over-budget rows are
  prefixed with `!`. The thresholds are **advisory, not enforced** — nothing
  fails a build; they just flag the likely cost so a slowdown is diagnosable
  from the overlay. A fork with heavier scenes raises `DEFAULT_PERF_BUDGET`.
- Below these come the existing game-mode, UI and script-message blocks.

**Budget philosophy:** budgets live in code as simple template defaults, not in
`project.3dgame.json`. They are a diagnostic aid, not a gate — the moment a
scene runs over, the overlay tells you *which* counter (draw calls, tris,
textures) is the suspect, and you decide whether that is a problem for your
game. Runtime LOD is deliberately out of scope until measured content pressure
justifies it (see archived completed doc PLATFORM_FOUNDATIONS_CHECKLIST.md in docs/COMPLETED_WORK_INDEX.md, P5).

## Offline asset report (`npm run perf:assets`)

`npm run perf:assets` walks `public/assets` and prints an offline cost report:
per-GLB triangle/vertex counts and byte size, standalone texture sizes and
resolutions, the ten heaviest of each, and advisory over-budget flags
(`tools/assetPerfReport.ts` `DEFAULT_ASSET_THRESHOLDS`). It is **informational**
— it never sets a failing exit code, so CI can run it as a non-gating step. Use
it to spot the assets worth optimizing (decimation, texture downscale, GLB
compression) before they show up as a live `budget (OVER)` in `?debug`.
