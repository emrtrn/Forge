# Forge

**Forge** is a general-purpose, reusable Three.js **game platform template**
whose editor is a built-in mode of the runtime (`?editor`), not a separate app.
It is not tied to any single project — each concrete project is a copy of this
template with its own data, assets, and game rules. One `SceneApp` renders both
the runtime and the editor viewport. The engine, editor, and builder boundaries
hold real extracted modules under `engine/`, `editor/`, and `builder/`; the
game/project boundary stays in `src/game` and `src/project` (top-level `game/`
and `project/` are reserved placeholders — game code lives in `src/game` so
forks own it there).
The architecture is Unreal-inspired (viewport gizmos, outliner, details,
content browser, undo/redo, snapping, Play mode) but web-first and lightweight.

Forge grew out of the earlier `3DGameDev` project (legacy name). The stable
reference repo is `C:\Users\emret\Desktop\3DGameDev`; do not edit it from this
workspace. Do not rewrite from scratch — preserve working behavior and move
code in small, build-passing steps.

Concrete projects are produced by copying this template and swapping the project
data (`project.3dgame.json`, layouts, assets, game rules/UI). Keep the template
generic — never hard-code rules or assumptions for one specific project into the
engine/editor.

## Modes (routes)

- **Game Mode**: `http://127.0.0.1:5173/` - runtime render, no editor UI.
- **Editor Mode**: `http://127.0.0.1:5173/?editor` (add `&debug` for the perf
  overlay) - same SceneApp + `EditorUi`, which is dynamically imported so the
  game bundle excludes it.
- `?debug`: perf overlay in either mode.

## Docs

- `docs/architecture/ARCHITECTURE.md`: boundary contract.
- `docs/architecture/ARCHITECTURE_PLAN_SOURCE.md`: imported source architecture plan.
- `docs/architecture/LAUNCH_WORKFLOW.md`: practical VS Code and URL launch path.
- `docs/planned/EDITOR_UI_SLICING_PLAN.md`: first extraction plan for keeping
  `EditorUi.ts` from growing as a monolith.
- `docs/architecture/UNREAL_BASICS_LESSONS.md`: the canonical roadmap. Top section is the
  **active execution track** (Gameplay/Runtime, G1–G6, with status legend +
  Progress Log); §1–§6 are the Unreal-derived architecture lessons (north star +
  backlog). The completed post-migration cleanup checklist
  (`IMPROVEMENT_CHECKLIST.md`) was removed; its history lives in git.

## Working Rules

- Keep the editor core generic; project-specific game rules live in game runtime
  code/data, not the editor.
- Keep the stable `C:\Users\emret\Desktop\3DGameDev` repo untouched from this
  workspace.
- The editor (`src/editor/`) must stay behind the dynamic `?editor` import so it
  is excluded from the game build.
- Project data is local: the game/editor read this repo's own `public/`
  (`public/project.3dgame.json`, `public/layouts/*.json`, `public/assets/*`).
  Manifest paths are relative to the public root.
- After editing TypeScript, run `npx tsc --noEmit`; the dev server skips
  type-checking.
- **CI** (`.github/workflows/ci.yml`) runs `build:verify`
  (`tsc --noEmit` + `vite build` + `test:engine` + `verify:dist --strict`) and
  `check:assets` on every push/PR to `main` — the automated mirror of the local
  gate. Keep both green; deploy stays out of CI (per-fork concern).
- **Save-validator allowlist gotcha:** any new `LayoutPlacement` /
  `LayoutCharacter` / `LayoutLightActor` / `LayoutReflectionPlane` /
  `LayoutBlockingVolume` field — or any new field on a singleton environment actor
  (`LayoutSkyAtmosphere`, `LayoutHeightFog`, `LayoutCloudLayer`, `LayoutReflection`,
  `LayoutPostProcess`) — must be added to the `tools/saveValidator.ts` allowlist
  (`applyTransformFields` / `validateLightActor` / `validateReflectionPlane` /
  `validateBlockingVolume` / `validateSkyAtmosphere` / `validateHeightFog` /
  `validateCloudLayer` / `validateReflection` / `validatePostProcess`, imported by
  `vite.config.ts`) or it is silently dropped on save. Current placement collision overrides
  (`collisionPreset`, `collisionEnabled`, `objectType`, `responses`,
  `physicalMaterialId`, `generateOverlapEvents`, `simulationGeneratesHitEvents`)
  live in `applyTransformFields`. (`LayoutCharacter` shares `applyTransformFields`
  plus explicit `assetId`/`position`/`animation`; all current fields are covered —
  character skeletal metadata is asset-level, not on the placement.)
- **Second allowlist surface — `*.skeleton.json` sidecar:** `/__save-skeleton`
  validates through `validateSaveSkeletonPayload` → `validateAssetSkeletonDef`
  (also in `tools/saveValidator.ts`, imported by `vite.config.ts`). Any new
  `AssetSkeletonDef` field — socket (`validateSkeletonSocket`), `animationSet`
  (`validateAnimationSet`), blend space (`validateBlendSpaces`), notify
  (`validateNotify` / `validateNotifies`), montage (`validateMontage` /
  `validateMontages`), or a top-level one (`upperBodyBone`, `preview`) — must be
  added to the matching `validate*` there, mirroring the loader's
  `normalizeAssetSkeleton` (`src/scene/assetSkeletonLoader.ts`), or it is silently
  dropped on save.
- **Third allowlist surface — `*.effect.json` particle effect (schema 2):**
  `/__save-effect` validates through `validateSaveEffectPayload` →
  `validateEffectAsset` (also in `tools/saveValidator.ts`, imported by
  `vite.config.ts`). `validateEffectAsset` reuses the runtime normalizer
  `normalizeEffectDefinition` (`engine/vfx/particleEffectParser.ts`) as the single
  source of field shape, so any new `ParticleEffectDefinition` field
  (`engine/vfx/particleEffectTypes.ts`) must be added to the matching `normalize*`
  block in the parser, or it is silently dropped on save. Effect assets carry
  `assetType: "effect"` in the manifest (`engine/assets/manifest.ts`); the runtime
  still falls back to the `.effect.json` suffix for older `prefab`-typed manifests.

## Codex Tooling Context

- This repository may also be worked on from Codex. Codex-specific tool guidance
  lives in `AGENTS.md`.
- If you are not running inside Codex, do not assume Codex Security, Codex
  plugins, or Codex skills are available in your own tool environment. Treat
  those notes as handoff context for the user or for a future Codex session.
- Normal code validation still starts with local commands (`npx tsc --noEmit`,
  `npm run test:engine`, and when appropriate `npm run build:verify`).

## Authoring Data Flow

- `/__save-layout` writes the active layout to `public/<defaultScene>` and snap
  settings to `public/project.3dgame.json`.
- `/__project-dir/<path>` is the read-only Content Browser directory tree,
  scoped to `public/`.
- Dev-only mutation endpoints are public-root or source-stub scoped and
  validator guarded where they write structured data:
  `/__save-collision`, `/__save-actor`, `/__new-behavior`,
  `/__save-material-slots`, `/__save-skeleton`, `/__save-material`,
  `/__save-ui`, `/__save-soundcue`, `/__save-effect`,
  `/__save-dialogue-voice`, `/__save-dialogue-line`, `/__save-uvw`,
  `/__content-new`, `/__content-rename`, `/__content-delete`,
  `/__import-asset`, and `/__open-level`.
- Editor Play is not an in-viewport PIE mode: the toolbar saves the layout,
  stores a temporary camera handoff, and opens the runtime route (`/`) in a new
  tab/window.
- These dev endpoints do not exist in the production build.

## Current Capabilities

- Viewport camera (MMB pan / orbit / dolly), transform gizmo
  (move/rotate/scale with dual-axis plane handles, hover highlight),
  world-space + local transform.
- Selection, multi-select, groups, parent/child hierarchy (outliner tree,
  drag-to-parent, cascade move/rotate/scale), pivot editing (numeric + presets
  + drag-in-viewport).
- Scene Outliner, Details panel (transform + schema-driven gameplay metadata),
  Content Browser, undo/redo command stack, World Settings (background/ambient).
  Dev authoring writes are explicit through Save Layout / Open Level / Content
  Browser actions; opening the editor dev server can still leave local layout
  files dirty after those actions, so fork/template hygiene starts with checking
  `git status`.

## Near-Term Order

1. ~~Split editor-only logic out of the main bundle.~~ **Done:** `SceneApp`,
   `EditorUi`, and the layout saver load only behind the dev-gated `?editor`
   dynamic import, so Vite DCEs them from the game build; `verify:dist --strict`
   passes with zero warnings, and a source-level `verify:imports` gate now
   enforces the module boundaries. (Numbering kept stable — later items are
   referenced by number.)
2. ~~Smoke tests around load/save and the game/editor mode split.~~ **Done:**
   `npm run smoke:browser` runs a Playwright Chromium smoke for `?editor` boot,
   shape placement, Details transform, undo/redo, Save Layout, clean editor
   reload, and runtime `/` boot. It uses a temporary copied layout so the
   template scene is restored after the run. **Smoke runs on port 5273
   (`npm run dev:smoke`), never the 5173 used by `npm run editor`, and never
   reuses an existing server:** a Forge fork is a copy of this repo, so a fork's
   dev server on the shared port answers every Forge route and silently becomes
   the system under test.
3. Improve asset catalog UI placement-rule affordances.
4. Later: a `tools/create-project.mjs` scaffold that stamps out a new project
   from the template (copy + rename + reset project data).
