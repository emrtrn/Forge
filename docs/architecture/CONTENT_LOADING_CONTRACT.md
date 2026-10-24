# Runtime content loading

Checked against source on 22 October 2026. The runtime and editor share these
static-read contracts; save allowlists remain in `tools/saveValidator.ts`.

## World Terrain (Open World Phase 1)

Editor and runtime use `src/scene/terrainDocument.ts`. Legacy `.landscape.json`
reads convert through the pure 1×1 terrain model and the temporary mesh adapter;
absent/unreadable legacy sidecars retain the old flat fallback. Adaptations
(rotation, non-square/resampled grids) are reported and never silently persisted.

New `.terrain.json` files use the strict shared `normalizeWorldTerrain` allowlist.
`loadWorldTerrain` eagerly fetches each listed `<name>.tiles/x_z.tile.bin` through
`projectFileUrl`, validating headers, sample bounds, coordinates, dimensions and
layer count against the definition. Missing/corrupt new documents propagate an
error instead of becoming flat terrain. Tile holes remain holes in the engine
document rather than synthesized heightfields.

Editor Save writes binary tiles, then validates/publishes the definition, then
updates the level reference for a first migration; the old sidecar is retained.
Float32 heights preserve legacy vertex positions and RGBA8 weights are quantized.
The save batch is retryable, not a cross-file transaction. The release collector
includes implicit tile dependencies and requires provenance for every tile.

Multi-tile World Terrain (Phase 2+) loads through the same normalizer and tile
validation. A terrain over 6×6 tiles with a valid `<name>.global.bin` global map
streams: the runtime reads tiles around the pawn (`worldStreamingModule`, blocking
load behind the travel/loading overlay at boot, save-load and teleport) and the
editor streams them around its camera (`TerrainEditorStreaming`). A level with no
global map, or a small one, stays eager.

## World Partition levels (Open World Phase 5)

A level with `worldSettings.partition.enabled` is saved as a persistent level plus
`<Level>.cells/main/<x_z>.cell.json` files and a `worldCells` index. `loadRoomLayout`
fetches the indexed cell files and merges them back, so every consumer — editor,
asset-health, content collection — still reads one whole `RoomLayout`; a missing or
invalid cell file fails the level read like any other required document.

At runtime the whole layout is **built** eagerly except for Actor Script actors
(`layout.actors`) that are cell-assigned (`worldPartitionActorCells`, the same rule
the saver used). Those are activated and unloaded with their cell around the pawn:

- **What loads when.** Boot, level travel and save-load activate the cells in range
  of the spawn/pawn behind the loading overlay; afterwards the streamer activates at
  most two cells per frame and unloads cells past the 1.25× hysteresis ring.
  `spatiallyLoaded: false` actors stay persistent. Static meshes, lights, volumes,
  characters and splines are not cell-streamed; their instanced batches are built per
  level.
- **Assets (`AssetResidency`).** The mesh of a cell-streamed plain actor
  (`parentClass: "actor"`, no `Vehicle` component) is owned by its cell: it is
  fetched asynchronously when the cell enters the prefetch ring (1.5× the load
  range, released past 1.25× that), a cell activates only once its models are
  settled (a failed model leaves the actor mesh-less, as at boot), and a model no
  cell or other user holds is freed 30 s later (GPU resources disposed, loader cache
  dropped). Boot/travel/save-load wait for the in-range cells' models behind the
  loading overlay. Everything else is pinned for the level: `loadGroups`, statics,
  characters, spline/foliage meshes, persistent and runtime-spawned actors, VFX mesh
  effects, and the meshes of streamed pawns, characters and vehicles (they can
  outlive their cell or be boarded by a save restore before it loads). A model
  shared by a pinned user and a cell is never freed. Mid-play cell loads do not
  touch the loading bar.
- **Identity and lifecycle.** A streamed actor keeps its `actor:<layout index>` id,
  so messages, patrol references and persisted script state address it the same
  whether or not its cell is loaded. Activation runs BeginPlay on the next tick;
  unloading runs EndPlay with reason `"unloaded"`, keeps only `persist`ed script
  state and resets the rest. The possessed pawn and a driven vehicle are never
  unloaded.
- **Moved bodies.** A physics-simulated body or car that left its authored pose is
  rebuilt where it was left (at rest) when its cell returns
  (`StreamedActorStateCache`, in memory for the level's lifetime). A static or
  script-moved actor returns at its authored pose.
- **AI navigation.** Streamed colliders enter and leave the physics static indexes
  incrementally; the nav grid cache keys on those lists, so a streamed wall blocks
  paths and an unloaded one stops blocking them.

## Required documents

`readContentJson` in `src/project/contentLoader.ts` reads through the shared
deployment-base URL helper. It throws `ContentLoadError`, containing the authored
path and a reason: `network`, `http`, `invalid-json`, `invalid-data`, or
`unsupported-version`. Required 404 responses are HTTP errors.

- `readProjectManifest` requires project schema 1, the project's name/type/version,
  entry/publicDir, editor defaultScene/assetManifest, scripts object and output
  distDir. Optional catalog/metadata/preview paths must be nonempty strings when
  present. Unknown project fields are preserved.
- `readAssetManifest` requires version 1 and uses the existing engine manifest
  validator without disk checks. Legacy `file`/`type` aliases remain accepted.
  Duplicate IDs and malformed entries reject the document. Preview information
  does not reject a runtime read or emit console messages.
- `readRoomLayout` requires schema 1, name, loadGroups, instances and characters.
  It checks collection/object shapes, asset/class references, finite placement
  transforms, actor IDs within their collections, light types and spline point
  positions. Existing scalar scale/rotationYDeg forms and unknown extension
  fields remain intact. Legacy reflection migration runs after this check.

These are structural guards, not a complete schema for every optional feature
parameter. Existing feature normalizers still own their enums/defaults. No
Node/dev validator is shipped in the browser to implement these checks.

Rejected project and asset-manifest reads are removed from their promise caches;
a later read can retry. Successful reads retain the existing cache behavior.
Runtime boot/travel errors show the path and reason in the existing loading
error screen. Retry reloads the page and rebuilds from authored content.
Loading releases pointer lock; clearing a menu during travel cannot re-acquire
it while the loading/error screen is visible. This keeps Retry clickable after
a failed travel without forced input in tests.
The editor shares the read errors; this slice does not add a new editor-specific
project-error dialog.

## Optional model sidecars

Collision, UVW, skeleton and material-slot loaders use `readOptionalSidecar`.

| Result | Behavior |
| --- | --- |
| HTTP 404 | Fresh defaults, no application warning |
| Network or other HTTP failure | Fresh defaults and a classified warning |
| Invalid JSON, root/container shape, or unsupported schema | Fresh defaults and a classified warning |
| Valid content | Existing normalizer, with no warning |

Schema 1 and versionless legacy sidecars are accepted. Collection containers and
their entry kinds are checked. Collision shape/size/transform and main enums,
plus UVW map type/transform, receive additional checks. Nested skeleton semantics
and animation/model compatibility remain with the existing normalizers/tools.
Malformed nested fields that those normalizers already sanitize are not all
diagnosed by this slice.

Warnings contain the sidecar path, failure classification and fallback choice.
Repeated identical failures at the same path produce one warning per page
session, including concurrent reads. A successful read or optional 404 re-arms
the warning. This is diagnostic deduplication, not a content-result cache.
Other asset/landscape/foliage/VFX loaders retain their existing contracts.

## Asset health and warning baseline

Run `npm.cmd run check:assets`. The command writes the complete structured report
to `builds/reports/asset-health.json` and compares actionable warnings with
[`tools/baselines/asset-health.json`](../../tools/baselines/asset-health.json).
Blocking errors or newly introduced warning identities fail the command. Resolved
warnings are reported and do not fail it. Review the actual file/cause before
editing the baseline; it is not automatically refreshed.

The lower-level command without a baseline is:

```powershell
node tools/run-asset-manifest-health.mjs
```

Missing manifest thumbnails are `info`, counted and summarized once because the
editor generates previews. Missing referenced thumbnail files remain warnings.
Automatic collision/material/UVW/vertex-color/skeleton sidecars do not require
separate manifest entries when their model is registered. Orphan companions and
unregistered UI assets remain warnings. The reviewed template baseline contains
only the existing unregistered `assets/starter-content/UI/SaveLoadMenu.ui.json`;
it does not register, delete, or alter that file.

`AssetManifestHealthReport` now includes `infoCount`, and issue levels include
`info`. Consumers comparing warnings must use the level rather than assuming
all non-errors are actionable warnings. The full JSON report retains preview
entries for tools that need their individual paths/IDs.

## Validation boundaries

Content regression tests run in the existing engine suite. Their TypeScript
scope, together with the asset-health tool, is checked by `verify:content-types`
inside `build:verify`. Critical Chromium includes content boot/travel/Retry
failures and collision fallback; production smoke checks the compiled starter at
root and subpath. Local gates do not establish remote CI, real network/disk
failure recovery, device acceptance, or a completed security review.
