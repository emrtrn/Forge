# Forge Architecture Contract

> Created: 2026-06-13 | Updated: 2026-07-04
> Scope: architecture-v2 migration workspace for the single-codebase template.
> Migration status: complete (phases 0-7 done); this file is the steady-state
> contract going forward.

This document is the working contract for future Codex/Claude tasks. If a task
conflicts with this file, update the contract first or call out the conflict
before changing code.

## Direction

**Forge** is a reusable, single-codebase Three.js game template. The
player-facing route and the editor viewport now use separate shells over shared
scene/runtime helpers:

- `RuntimeSceneApp` owns the Game Mode shell and must stay free of editor
  imports.
- `SceneApp` owns the Editor Mode viewport shell and hosts editor-only
  controllers through narrow scene callbacks.
- Shared render, scene-build, and subsystem concerns should move into explicit
  scene runtime helpers instead of being copied between the two shells.

- Default route `/` is Game Mode: runtime render, no editor UI.
- `/?editor` is Editor Mode: `SceneApp` plus `EditorUi`.
- `?debug` adds the perf overlay in either mode.
- A new game is produced by **forking** this repository (not a throwaway copy):
  the fork sets `upstream` to Forge, keeps all game-specific code and data
  confined to `public/` + `src/game`, and pulls platform improvements with
  `git fetch upstream && git merge upstream/main`. See
  `docs/planned/GAME_FORK_WORKFLOW.md` for the full fork/sync workflow.
- The editor travels with each game during development, but is gated behind the
  dev-only `?editor` dynamic import and is excluded from production builds.
- The stable reference repo is `C:\Users\emret\Desktop\3DGameDev`; use it to
  compare behavior if the migrated boundaries ever drift from it.
- `docs/architecture/ARCHITECTURE_PLAN_SOURCE.md` is the imported source plan.

### Product envelope

Forge's identity is a **reusable Three.js game template**, not a general 3D app
framework. The envelope it targets — and the boundaries it deliberately leaves
out — are declared here so a candidate game can be evaluated against Forge
without relying on tribal knowledge:

- **Proven vertical:** single-player, third-person 3D web game, wired end to end
  — Game Mode / PlayerController / PlayerState / Pawn, character movement, level
  travel, slot-based save-game, and boot/loading. Other single-player 3D genres
  are feasible on the same generic core (a free-fly camera mode also ships), but
  only the third-person vertical is proven end to end today.
- **Primary target:** desktop browser; keyboard + mouse (pointer-look) is the
  first-class input path.
- **Secondary input, not first-class:** gamepad and touch / virtual-joystick
  sources exist in `src/input/` and work, but are not the primary tuning target.
- **Explicit non-goals** (deliberately out of scope, not backlog): networked
  multiplayer / replication, VR / AR (WebXR), 2D / sprite engines, and native
  mobile packaging. Any of these is a fork's own concern, not a platform
  promise.

Removed architecture:

- Project Browser / launcher route.
- External project references in `projects/*.project-ref.json`.
- `studio` CLI and external-project packaging scripts.
- External-project dev middleware such as `/__project`, `/__project-file`,
  `/__recent-projects`, `/__studio/*`, and `/__select-directory`.

Kept dev middleware:

- `/__save-layout`: writes local authoring data under this repo's `public/`.
- `/__project-dir/<path>`: read-only Content Browser directory tree scoped to
  `public/`.
- Structured sidecar/content writes: `/__save-collision`, `/__save-actor`,
  `/__new-behavior`, `/__save-material-slots`, `/__save-skeleton`,
  `/__save-material`, `/__save-ui`, `/__save-soundcue`, `/__save-effect`,
  `/__save-dialogue-voice`, `/__save-dialogue-line`, `/__save-uvw`,
  `/__content-new`, `/__content-rename`, `/__content-delete`, `/__content-transfer`,
  `/__import-asset`, and `/__open-level`. These are Vite dev-server only; they
  are not production runtime APIs.

## Ownership Boundaries

Template/editor code lives in this repo:

- `src/scene/`: `RuntimeSceneApp`, editor `SceneApp`, shared scene runtime
  helpers for renderer/camera/world-lighting setup, scene loading, and save
  hooks.
- `src/editor/`: editor UI, selection panels, authoring affordances.
- `src/project/`: local manifest loading and project public-path helpers.
- `public/project.3dgame.json`: this copy's project identity and editor settings.
- `public/layouts/`: local scene/layout data.
- `public/assets/`: local runtime assets and manifests.
- `tools/`: local dev-server helpers.
- `docs/`: current architecture and workflow notes.

Project-specific game work also lives in the copied repo:

- game rules, scoring, missions, save model, and runtime UI;
- GDD and design docs;
- project assets, layouts, prefabs, data, and metadata;
- production build output in `dist/`.

Final production output must contain only runtime game files:

- `index.html`;
- bundled runtime JS/CSS;
- runtime assets and public data required by the game.

Final output must not contain editor UI, authoring middleware, GDD, internal
docs, raw authoring assets, or local dev scripts.

## Dependency Rules

- Game Mode (`RuntimeSceneApp` and the `/` branch in `src/main.ts`) must not
  import `src/editor/*` or `editor/*`.
- `RuntimeSceneApp` must not import `src/game/*` either: which Game Modes,
  behaviors, AI tasks and gameplay rules exist is Layer 3 content, published by a
  `ForgeGameModule` (`src/game/gameModule.ts` in the template) that
  `src/main.ts` injects through `createForgeRuntime`. Both rules are enforced by
  `npm run verify:imports`.
- The `EditorUi` import must remain behind `?editor` and `import.meta.env.DEV`.
- Editor code may depend on shared scene/project APIs and editor-owned
  controller modules.
- Shared project/layout data must stay plain JSON or serializable TypeScript
  types; do not store Three.js objects in saved data.
- Runtime code should load project files through manifest-relative public URLs,
  not absolute local filesystem paths.
- Editor state such as selection, panel expansion, hover, and gizmo state must
  not be written into layout files.

Top-level migration dependency rules:

- `engine/*` must not import `editor/*`, `builder/*`, `game/*`, or `src/*` (the
  engine layer is self-contained: engine + externals only).
- `editor/*` may import `engine/*`, but must remain dev/editor-route owned and
  must not import `game/*` — the editor core stays generic. Game data the editor
  renders (Game Modes, behavior ids, montage/input bindings, the ragdoll driver)
  is injected via `@/editor/gameEditorRegistry`, wired by `src/main.ts`.
- `game/*` may import `engine/*`, but must not import `editor/*`.
- `builder/*` may read project/engine metadata and built output, but should not
  become runtime code.
- `project/*` is data/config ownership, not runtime implementation (currently
  `src/project` + `public/`; top-level `project/` is a reserved placeholder).
- `src/*` remains the active implementation; the `engine/*`, `editor/*`, and
  `builder/*` boundaries hold the extracted modules, while the game boundary
  stays in `src/game` (top-level `game/` is a reserved placeholder). The editor
  never imports `@/game`: game data the editor renders is injected at startup
  via `@/editor/gameEditorRegistry` (wired in `src/main.ts`).

These directions are enforced at the gate by `builder/web/verify-imports.mjs`
(`npm run verify:imports`, part of `build:verify`), a source-level scan that
fails on a forbidden cross-layer import.

Runtime command surfaces follow **engine-interface / host-implementation** (the
`AudioBus` and `TransformSink` precedent): the engine defines a typed interface,
the host (`RuntimeSceneApp` / editor `SceneApp` Play mode) implements it. The
generic actor commands (`ActorCommands` on `BehaviorContext.actor`:
`setVisibility`, `setCollisionEnabled`, `destroy`, `setLifeSpan`, `spawn`) are
queued by the `BehaviorSubsystem` during a tick and applied end-of-tick — the
subsystem does its own bookkeeping (drops a destroyed entity from its instance
set, world indexes and message subscriptions) and delivers render/physics
teardown to the host via an `ActorCommandSink` (`setCollisionEnabled` routes to
`PhysicsSubsystem.setEntityCollisionEnabled`, which drops the body from contact
generation and the movement blockers). Runtime visibility/collision/destroy state
is never written to layout files; opt-in `{ persist: true }` routes it through the
save-game snapshot
(`getPersistentStateSnapshot`) only. `Layout Data ≠ Save Game Data`. See
`docs/architecture/SAVE_GAME_CONTRACT.md` for the full envelope contract — what a
save stores, what it deliberately omits, the opt-in persistent-state pattern, and
the load → travel → restore sequence.

### Runtime features come as modules, not shell code

`RuntimeSceneApp` is the boot/lifecycle/render **composition shell**, not a
grab-bag for feature logic. A new runtime feature (a save/travel/spawn manager, a
new subsystem coordinator, a debug readout) is added as its own module under
`src/scene/` — not as more methods and fields piled onto `RuntimeSceneApp`. The
established shape is a small **coordinator** that owns its own state (store,
queue, latch) and reaches back to the shell for subsystem access and shared
lifecycle through a deliberately small **deps-callback interface**, so the scene
boundary (`RuntimeSceneApp` must never import `src/editor/*`) holds and the
dependency direction stays one-way shell → coordinator. Precedents:
`runtimeSaveCoordinator.ts` (slot save/load + pending-restore),
`runtimeTravelCoordinator.ts` (level-travel state machine + teardown/rebuild
loop), and the side-effect-free `runtimeDebugSnapshot.ts` builders. Pure
resolution/assembly logic (snapshot builders, state machines like `levelTravel.ts`)
should be a free function or plain module so it is unit-testable without a live
scene. Do not add a large renderer/manager directly to the shell.

### AI runtime / editor boundary

AI decision-making (`engine/ai`: `AISubsystem`, `AIController`, `Blackboard`, and
the later Behavior Tree / perception / navigation layers) is **runtime code**,
not editor code. It follows the same dual-host wiring as the other gameplay
subsystems: both `RuntimeSceneApp` and the editor `SceneApp` construct and
register the `AISubsystem`, and the editor gates it off (`setEnabled(false)`)
while editing so authored NPCs stay static until Play. The editor's only AI role
is **authoring** — creating and binding AI data assets (`*.blackboard.json`,
`*.behavior.json`, …) and the `AIController` component — never running decision
logic in the editor shell. Engine-level AI code carries no DOM / Three.js /
editor imports (its render/debug visualizers live in a separate layer), and AI
runtime state (blackboard values, active node, perception, paths) is never
written back to layout files — it is a debug-inspect / save-game concern only.
The completed AI plan is in `C:\Users\emret\Documents\Forge-Archive`; its
in-repo record is `docs/COMPLETED_WORK_INDEX.md`. For the active skeletal-facing
constraint and activation criteria, see
`docs/backlog/SKELETAL_FACING_OVERRIDE_BACKLOG.md`.

## Project Manifest

File:

```text
public/project.3dgame.json
```

Role: this copied game's local identity and editor/runtime configuration.

Current minimum shape:

```json
{
  "schema": 1,
  "name": "forge-template",
  "type": "three-game",
  "version": "0.1.0",
  "entry": "src/main.ts",
  "publicDir": "public",
  "editor": {
    "defaultScene": "layouts/render-test-room.json",
    "assetManifest": "assets/manifest.json",
    "metadataSchema": "assets/metadata-schema.json",
    "gridSize": 1,
    "gridEnabled": true,
    "snapRotationDeg": 15,
    "snapRotationEnabled": true,
    "snapScale": 0.1,
    "snapScaleEnabled": false
  },
  "scripts": {
    "preview": "npm run dev",
    "build": "npm run build",
    "package": "npm run build"
  },
  "output": {
    "distDir": "dist"
  }
}
```

Rules:

- Paths inside `editor` are relative to the public root.
- The manifest is small and hand-readable.
- Schema changes require an explicit migration note.
- `editor.previewUrl` may point Play/Test to an external runtime during a
  migration, but the default path is `/`.

## Authoring Files

### Runtime Asset Manifest

Suggested path:

```text
public/assets/manifest.json
```

Role: runtime and editor asset loading metadata.

Rules:

- Runtime loaders use this for final asset paths and IDs.
- Content Browser can derive placeable assets from it unless a richer catalog is
  added later.
- Saved scenes reference asset IDs or manifest entries, not absolute paths.

### Level/Layout JSON

Suggested path:

```text
public/layouts/<name>.json
```

Role: scene object data authored by the editor and consumed by Game Mode.

Rules:

- Store stable IDs and transforms, not Three.js objects.
- Keep editor-only state out of layout files.
- Save through `/__save-layout` in dev; production builds have no write
  middleware.
- New saved fields must be allowlisted in the `vite.config.ts` save validator.

### Metadata Schema

Suggested path:

```text
public/assets/metadata-schema.json
```

Role: schema-driven gameplay metadata for the Details panel.

Rules:

- Gameplay metadata must stay serializable.
- Editor controls may expose fields, but game rules interpret them at runtime.

## Runtime Modes

### Game Mode

Purpose: player-facing game route.

Allowed:

- `RuntimeSceneApp` and shared scene runtime helpers;
- runtime assets and layout data;
- game UI and game systems;
- debug overlay only when explicitly requested.

Not allowed:

- editor panels;
- transform gizmo UI;
- authoring saves;
- dev-only directory/write middleware.

### Editor Mode

Purpose: local authoring in development.

Allowed:

- editor panels;
- selection and transform tools;
- gizmo rendering;
- authoring overlays;
- local save/load through dev middleware.

Not allowed:

- relying on editor code in production builds;
- writing outside the local copied repo's public data.

Editor Play is a route handoff, not an in-viewport PIE mode: the editor saves
the current layout, stores a temporary camera pose handoff, and opens the Game
Mode route (`/`) in a new tab/window.

### Package Mode

Purpose: produce static web output.

Current command:

```text
npm run build
```

Rules:

- Build output goes to `dist/`.
- The editor dynamic import is dev-gated and should not produce an editor chunk.
- Dev middleware is Vite-dev-only and must not exist in production output.

## Undo/Redo Command Model

Editor actions that mutate project files or editor-authored scene state should
use commands.

Command shape:

```ts
interface EditorCommand {
  id: string;
  label: string;
  do(): void | Promise<void>;
  undo(): void | Promise<void>;
}
```

Rules:

- Commands must capture enough previous state to undo deterministically.
- Continuous drags should collapse into one command at pointer-up.
- Save operations persist the current document state; they are not themselves
  undo history.
- File writes happen after command application through project-system APIs.

Initial command candidates:

- `AddObjectCommand`
- `DeleteObjectCommand`
- `TransformObjectCommand`
- `UpdatePropertyCommand`
- `RenameObjectCommand`
- `CreatePrefabCommand`

## Directory Intent

```text
Forge/
  builder/       build/package verification boundary
  docs/          current architecture, roadmap, and workflow notes
  editor/        future editor-only module boundary
  engine/        future runtime engine module boundary
  game/          future project-specific runtime code boundary
  project/       future project config/data boundary
  public/        local manifest, layouts, and runtime assets for this copy
  src/core/      shared utility/core code
  src/editor/    dev-only editor UI and authoring panels
  src/project/   local project manifest/path helpers
  src/scene/     RuntimeSceneApp, editor SceneApp, shared scene runtime helpers
  tools/         local dev-server helpers
  dist/          production build output
```

Package boundaries such as `engine/core`, `engine/scene`,
`engine/render-three`, `engine/assets`, `editor/core`, `editor/gizmos`,
`editor/inspector`, and `builder/web` now hold real extracted code. The
`game`/`project` boundary is **not** extracted to the top level: game code lives
in `src/game` and project ownership in `src/project` + `public/`, so downstream
forks own `src/game` without a disruptive move (top-level `game/` and `project/`
are reserved placeholders — see their READMEs). Keep new code inside the
boundary that owns it; do not introduce empty architecture for its own sake.

## Not In Scope Yet

- full pnpm/Turborepo migration;
- node editor;
- shader graph or material graph;
- full Unreal-style Material Instance stack; if material reuse needs it later,
  prefer Material Instance Lite / Material Variant: parent canonical material plus
  field overrides resolved to a normal Three.js material;
- physics editor;
- generic engine marketplace/plugin ecosystem;
- reviving the Project Browser / external-project system.
