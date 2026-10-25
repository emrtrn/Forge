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
- `docs/architecture/FORGE_LAYERED_RUNTIME_PLAN.md`: layered runtime rules
  (LevelRuntime, capability modules, game module); all phases closed, kept as
  the reference the starter templates point to.
- `docs/COMPLETED_WORK_INDEX.md`: index of completed plans archived outside the
  repo (e.g. `EDITOR_UI_SLICING_PLAN.md`).
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
- **Engine test levels.** `npm run test:engine` is the full suite.
  `npm run test:engine -- --filter <terms>` runs only checks whose label matches
  (comma-separated, case-insensitive, OR'd) — cheap while iterating, and it
  prints `PARTIAL … not a green build`, because it is not one; a filter that
  matches nothing exits 1 so a typo is never silent. `--timing` prints each
  check's duration, and `--slow` (or `npm run test:engine:slow`) adds any check
  tagged `checkSlow` — an *expensive tests* bucket, not an unimportant one.
  A filtered run always includes slow checks, so narrowing to a subject cannot
  hide that subject's expensive ones. Rationale and the split plan this belongs
  to: `docs/planned/ENGINE_TESTS_SPLIT_PLAN.md`.
- **CI** (`.github/workflows/ci.yml`) runs `build:verify`
  (`tsc --noEmit` + `vite build` + `test:engine:slow` + `verify:dist --strict` +
  `verify:world-data`, which fails when a shipped level references a missing
  World Partition cell, foliage cell, terrain definition or tile)
  and `check:assets` on every push/PR to `main` — the automated mirror of the
  local gate. CI never runs filtered or FAST. Keep both green; deploy stays out
  of CI (per-fork concern).
- **Save-validator safety net (Faz G):** every save now compares what was sent
  with what survived (`tools/droppedFields.ts`). A field the allowlist does not
  copy is reported — dev-server console `[save] …`, `dropped[]` in the response,
  and a **warning** save status in the editor instead of a clean "Saved" — and
  `tests/engine/droppedFields.test.ts` + `serializationDrift.test.ts` fail if a
  runtime-known field stops round-tripping. The allowlist rules below still
  apply: the net tells you a field was dropped, it does not add it for you.
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
  live in `applyTransformFields`. World Partition's `spatiallyLoaded` (only `false`
  is persisted) is copied by `applyTransformFields` and the actor, light,
  reflection-capture, blocking-volume, target-point and world-widget validators;
  `worldSettings.partition` goes through `normalizeWorldPartitionSettings`.
  (`LayoutCharacter` shares `applyTransformFields`
  plus explicit `assetId`/`position`/`animation`; all current fields are covered —
  character skeletal metadata is asset-level, not on the placement.)
  Physical material `vehicle`/`deformation` blocks are preset-only; saves carry only `physicalMaterialId` from the shared `PHYSICAL_MATERIAL_IDS` catalog.
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
- **Fourth allowlist surface — `*.vehicle.json` vehicle asset (schema 1):**
  `/__save-vehicle` validates through `validateSaveVehiclePayload`, reusing
  `normalizeVehicleAsset` / `normalizeVehicleDefinition`
  (`engine/physics/vehicle/vehicleTypes.ts`) as the runtime/save field allowlist.
  New vehicle or wheel fields must be added there or saving drops them (and
  reports them in `dropped[]`). Assets carry `assetType: "vehicle"`; a `Vehicle`
  component's `asset` is a public-root-relative `.vehicle.json` path. Inline
  scalar props override that asset; a valid inline wheels list replaces its
  whole wheel list. Missing/malformed assets fall back to inline/reference-car
  settings with a warning. Asset expansion is runtime-only; actor saves preserve
  the authored reference and inline props.
  A placed actor may carry level-owned `vehicleOverrides` (`asset`, the
  `VEHICLE_OVERRIDE_SCALAR_KEYS` scalars, `engineSound` loop or `null`), layered
  onto the class's Vehicle props before the asset resolves; new override keys go
  in `validateActorVehicleOverrides` (`tools/saveValidator.ts`) and
  `cloneActorInstance` too.
  The optional `drivetrain` block enables torque/RPM/gearing; missing/null keeps
  legacy flat-force behavior. Engine/transmission/differential inline objects
  merge field-by-field; authored curves/gear lists replace their base lists.
  Wheel `axle`, `width`, `steeringSpeedCurve`, `handbrakeSideFrictionMultiplier`,
  `aerodynamics` and `engineSound` use the same normalizer and must round-trip
  too. `engineSound` (a `sound`/`soundCue` id + pitch/volume/distance tuning)
  is presentation data the `vehicle` capability plays while the car is driven;
  inline fields override the asset's one by one and `null` silences the car.
  Wheel `visualNode` optionally names a mesh/group in the vehicle model. The
  vehicle capability animates that node around its centred physical axle,
  restores it on unload, and leaves model geometry/material ownership with the
  asset loader. Omitted/unusable nodes use the procedural wheel fallback.

- **World Partition cell files:** with `worldSettings.partition.enabled`, the
  editor saves a level as a persistent level (`worldCells` index) plus
  `<Level>.cells/main/<x_z>.cell.json` (`engine/world/worldPartition.ts`).
  `/__save-world-cells` validates each cell by running its arrays through
  `validateLayout`, so cell elements share the layout allowlists above; it only
  writes the open level's cells. Save order is changed cells (no deletion) →
  level → cleanup with the full `keep` index, so a failed step never leaves the
  level pointing at a deleted cell. `loadRoomLayout` merges the cells back; the
  editor works on the whole level, and the runtime streams only Actor Script
  actors (`layout.actors`) by cell around the pawn (`worldPartitionModule`;
  EndPlay reason `"unloaded"`, only `persist`ed state survives an unload) while
  every other element is still built eagerly.
  Painted foliage of a partitioned level is an index `<Level>.foliage.json`
  (`foliageCells` keys, groups without instances) plus
  `<Level>.cells/foliage/<x_z>.foliage.json` (`engine/world/foliageCells.ts`,
  `grids.foliage`, 64 m). `/__save-foliage-cells` validates through
  `validateSaveFoliageCellsPayload` (instances via `normalizeFoliageInstance`);
  the editor save order is cells → index → prune, and it re-partitions whenever
  the files do not match the level's partition settings, edit or not. The
  editor merges every cell (an unreadable one fails the load); Play streams them
  around the camera (`src/scene/foliageCellStreaming.ts`).
- **Fifth allowlist surface — World Terrain:** `*.terrain.json` definitions
  use `normalizeWorldTerrain` (`engine/terrain/terrainDefinition.ts`) on read
  and through `validateSaveTerrainPayload` re-exported by `tools/saveValidator.ts`.
  Spline fields share `engine/scene/landscapeSplineValidation.ts` with legacy
  Landscape. `/__save-terrain-tile?path=<definition>&key=<x_z>` accepts a raw
  binary body, validates its size/header/coordinates/finite heights, and derives
  `<name>.tiles/<x_z>.tile.bin`; `/__save-terrain` cross-checks every listed
  binary before writing the definition and returns `dropped[]` for unknown keys.
  `/__save-terrain-global?path=<definition>` validates the binary global map and derives its sibling `<name>.global.bin` path; it uses the same privileged local-only middleware, and definition commits cross-check its shape when present.
  These endpoints use the privileged local-only middleware. Add new definition
  fields to the shared normalizer and terrain serialization-drift tests.
  A paint layer's `physicalMaterial` (a `PHYSICAL_MATERIAL_IDS` preset or
  `null`; an unknown id rejects the terrain) drives vehicle surface response
  (`engine/terrain/terrainSurface.ts`); the 1×1 path carries it on
  `LandscapeLayerWeights` through the bridge, legacy conversion and clones.
  Editor saves migrate legacy sidecars tile → global map → definition → level reference,
  preserving the old file. Landscapes render through the GPU CDLOD renderer
  (`engine/render-three/terrain/`, wrapped by `engine/render-three/landscape.ts`);
  picking raycasts the CPU heightfield. Multi-tile World Terrain supports
  sculpt/paint, heightfield collision, and editor/runtime streaming. The 1×1
  legacy adapter remains available for existing Landscape authoring data.
  A tile rewritten after its definition was committed (overlapping saves) leaves
  the `minHeight..maxHeight` summary stale and the editor refuses to load the level
  (`terrain tile K samples … exceed declared bounds`, shown as an editor toast).
  `npm run terrain:repair -- <path under public/>` reports it; add `--write` to
  recompute the summaries (and rebuild the global map) from the tiles, which stay
  as authored, or `--check` for a non-zero exit in scripts.
  A World Terrain over 6×6 tiles with a valid global map streams in the editor
  (`TerrainEditorStreaming`): Save then writes the renderer's live global map
  instead of rebuilding it, and a widened height range re-encodes unloaded
  tiles from disk; tiles edited this session stay resident until the level
  closes.
  Rotation/non-square/resampling adaptations require explicit resolution rather
  than silently changing an authored scene during Save.

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
  `/__save-terrain`, `/__save-terrain-tile`, `/__save-terrain-global`,
  `/__save-world-cells`, `/__save-foliage-cells`,
  `/__save-ui`, `/__save-soundcue`, `/__save-effect`, `/__save-vehicle`,
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
   from the template (copy + rename + reset project data). Its starting point
   already exists: `templates/game-starter/` is a zero-gameplay app
   (`createForgeRuntime` → `loadLevel` → `start`, no scene setup code) whose
   level is the `public/layouts/RuntimeParity.level.json` fixture — terrain,
   meshes + a material override, lights, the environment stack, VFX and a
   collidable Actor Script. `tests/smoke/game-starter.spec.ts` opens it at
   `/templates/game-starter/index.html?debug` and is the proof that a fork needs
   no scene-building code of its own.
