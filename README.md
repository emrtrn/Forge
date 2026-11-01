# Forge

**Forge** is a general-purpose, reusable [Three.js](https://threejs.org/) **game
template** with a built-in editor mode. The editor is not a separate tool — it is
a dev-only mode of the same runtime (`?editor`), so every game you build from
Forge ships its own authoring environment during development and a clean,
runtime-only bundle in production. Forge is not tied to any single game: each
concrete game supplies its own data, assets and rules. Existing games use a
fork with upstream updates; Ridgebound uses the shared Forge source directly.

## Proven vertical

The end-to-end path that is wired and tested today is a **single-player,
third-person 3D web game**:

- Game framework: Game Mode / PlayerController / PlayerState / Pawn.
- Character movement (walk / jump / slopes / step-up-down / moving platforms) and
  a spring-arm follow camera.
- Level travel between layouts, slot-based save/load
  ([save-game contract](docs/architecture/SAVE_GAME_CONTRACT.md)), and kill-Z
  respawn.
- Boot / loading UX, plus a win/lose + restart game-rules layer.

Other single-player 3D genres are feasible on the same generic core (a free-fly
camera mode also ships), but only the third-person vertical is proven end to end.

## Modes (routes)

Run the dev server, then open:

- **Game Mode** — `http://127.0.0.1:5173/` — runtime render, no editor UI.
- **Editor Mode** — `http://127.0.0.1:5173/?editor` — the same runtime plus the
  editor UI (viewport gizmos, outliner, details, content browser, undo/redo,
  Play). Dev-only; excluded from production builds.
- Add `?debug` to either route for the performance overlay.

## Quick start

```bash
npm install
npm run dev          # dev server (Game Mode + Editor Mode)
npm run build        # production build → dist/ (runtime only, no editor)
npm run build:verify # tsc + build + engine tests + strict dist scan
```

After editing TypeScript, run `npx tsc --noEmit` — the dev server does not
type-check.

## Product envelope

- **Primary target:** desktop browser; keyboard + mouse (pointer-look) is the
  first-class input path.
- **Secondary input (works, not first-class):** gamepad and touch /
  virtual-joystick.
- **Deliberate non-goals** (out of scope by design, not backlog): networked
  multiplayer / replication, VR / AR (WebXR), 2D / sprite engines, and native
  mobile packaging.

The full boundary contract and product envelope live in
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md).

## Making a game from Forge

For existing Model 1 games, a game is a **fork** of this repository, not a throwaway copy. The fork keeps all
game-specific code and data confined to `public/` + `src/game`, sets `upstream`
to Forge, and pulls platform improvements with
`git fetch upstream && git merge upstream/main`. See
[`docs/planned/FORGE_GAME_PROJECT_WORKFLOW.md`](docs/planned/FORGE_GAME_PROJECT_WORKFLOW.md) for the
full fork/sync workflow.

Ridgebound uses Model 2: engine/editor/tools stay in Forge; game code, catalog,
manifest, scenes and design documents stay in its own repository. From Ridgebound,
run `npm.cmd run check`, `npm.cmd run dev`, `npm.cmd run build`,
`npm.cmd run preview`, and `npm.cmd run verify:build`. `FORGE_ROOT` or
`forge.local.json` selects the local Forge source; `game.module` and
`game.editorCatalog` select game entries. Invalid explicit selections fail.
The `sync-forge-to-games` scripts are only for Model 1 forks with an upstream
remote; do not use them for Ridgebound. See the
[P2 acceptance report](docs/reports/RIDGEBOUND_P2_ACCEPTANCE_REPORT.md) for
technical evidence and the user's completed visual and usage acceptance.

## Documentation

- [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) —
  boundary contract, ownership rules, product envelope.
- [`docs/architecture/LAUNCH_WORKFLOW.md`](docs/architecture/LAUNCH_WORKFLOW.md) —
  practical VS Code and URL launch paths.
- [`docs/architecture/UNREAL_BASICS_LESSONS.md`](docs/architecture/UNREAL_BASICS_LESSONS.md) —
  the roadmap plus the Unreal-derived architecture lessons.
- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — agent working rules for
  this repo.
