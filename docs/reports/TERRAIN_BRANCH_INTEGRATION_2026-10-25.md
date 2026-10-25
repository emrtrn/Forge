# Terrain branch integration — 2026-10-25

## Inputs and recovery points

- Shared base / initial `main`: `0a685babb86bcab9ac23c2f8607af52a197e589e`.
- Previously published local feature tip: `2e6bf2005430c03ea994f7dbdd81946f8bac89b8`
  (`feat/terrain-deformation`, 104 commits beyond `main`).
- Cloud tip: `58f05f6e2a04c0943fd9680b18bbfdc526033463`
  (`claude/zealous-brown-lfi5ti`, four commits beyond the shared base).
- Local code/content snapshot: `51b53b9` (38 files).
- Authored LandscapeTest snapshot: `e4463045` (19 files). Terrain definition,
  global map, all 16 tile binaries and level document are committed together.
- All 57 originally uncommitted files were copied and SHA-256 verified before
  staging. The machine-local copy and manifest are in the ignored directory
  `.dev-server/integration-backup-20261025/` in the original Forge checkout.
- Other pre-existing local feature branches are ancestors of `e4463045`.
  No additional local branch history was omitted.

Integration runs on `integration/terrain-sync-20261025` in a separate worktree.
The original feature branch remains a recovery point for the authored state.
The merge preserves both parents; it does not rewrite or squash either history.

## Resolution

Seven files conflicted: `CLAUDE.md`, `OPEN_WORLD_PLAN.md`, `landscape.ts`,
`terrainMaterial.ts`, `terrainRenderer.ts`, `terrainLod.ts` and
`terrainRenderSource.ts`. The two sides had independently implemented the
same initial GPU renderer, then the local branch had advanced through
multi-tile authoring, streaming, heightfield physics and deformation.

The active renderer therefore keeps the local source/material APIs, seam
normals, dirty-rectangle uploads, streaming/residency, track refinement,
eight textured paint layers, wet mud and displaced GTAO/DOF materials.
No authored level, terrain definition, tile or global-map data is changed
by the integration relative to `e4463045`.

Cloud contributions carried forward:

- Explicit authored extent clipping in `TerrainLodSelector`, connected to
  the active renderer and tested together with negative track-detail levels.
  Invalid non-finite extents are rejected.
- GPU terrain patches are skipped by editor outline proxy cloning; ordinary
  meshes such as spline geometry retain their proxies.
- The standalone `TerrainTexturePool` helper, with slot cache, eviction,
  dirty-region and unpainted-layer checks. The active renderer retains its
  existing richer texture manager with normals and partial GPU uploads.
- Cloud source, sparse-world, rotated-raycast, sculpt, bounds, material and
  binding test cases adapted to the retained APIs. Duplicate test registration
  names were resolved.
- Updated renderer status in `CLAUDE.md` and the open-world/deformation plans.

The cloud corner-paint case exposed a difference: legacy height padding
repeated edge samples but paint padding remained zero. Paint now repeats the
same authored edge, including after a partial corner edit.

The alternative cloud node-texture layout, per-draw camera selection and
fragment normal calculation do not replace the active renderer. Its older
visual parity measurements are not validation of this combined version.
Node frustum culling remains an open active-renderer item in the plan.

## Validation

- Initial local state: `npx.cmd tsc --noEmit` and 1,844 engine checks passed.
- Integrated state: `npx.cmd tsc --noEmit` passed.
- Integrated full `npm.cmd run test:engine`: 1,856 checks passed.
- Integrated `npm.cmd run build:verify`: passed, including slow engine checks,
  smoke/content/UI type contracts, import/release-tool checks, runtime-only
  dist verification and shipped world-data validation.
- Focused integration run: 29 passed; this partial run is supplementary to
  the full gates above.
- `npm.cmd run check:assets`: passed (901 assets, zero errors). One warning
  remains for the existing unregistered `SaveLoadMenu.ui.json` file.
- Visual review of editor Lit, displaced AO/DOF terrain and the multi-tile
  top view completed. The slot/global-map crack check found zero cracks
  across 74,142 checked pixels.
- Integrated Playwright run: 12/12 passed in 10.8 minutes. Coverage includes
  paint/save/reload, sculpt/save retry, wireframe/material rebuilds, editor
  streaming, multi-tile seam sculpt and collision, foliage save/reload/Play,
  non-square GPU terrain with AO/DOF, runtime streaming, vehicle surface and
  deformation behavior, slot/global-map seam rendering, wet-mud water pixels,
  and fifth-layer undo/redo/paint/save/reload.
- The reviewed wet-mud screenshot also shows the water-filled track floors.
- No authored `public/` data differs from `e4463045` after browser validation.

Engine/build execution required expanded Windows execution because the
restricted sandbox denied esbuild directory access. Blocked sandbox attempts
are not counted as successful validation.

Codex Security diff review of the full `main..integration` scope was suggested
because the accumulated history includes save/load endpoints. It was not run
without separate approval.
