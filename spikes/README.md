# spikes/

Throwaway measurement pages for `docs/planned/OPEN_WORLD_PLAN.md`. They are not
part of the app build, the root `tsc --noEmit` or `verify:imports`, and the whole
folder is deleted before `feat/terrain-renderer` merges to `main`. Results go into
the plan.

Type-check: `npx tsc -p spikes`.

## cell-activation (Faz 5 option 2, S0)

What activating and unloading one dense World Partition cell of static meshes
costs on the main thread, phase by phase, with the runtime's own code paths:
`roomLayoutToSceneDocument` (entity derivation), `buildSceneInstancedModel`
(cell × asset batches), `PhysicsSubsystem.addEntities` (Rapier bodies + static
index), the first static queries after the invalidation, the first draw (GPU
upload, forced with a pixel read), one physics step, and the removal.

```
npm run dev:smoke            # or any Vite server; pass the port to the runner
node spikes/cell-activation/run.mjs 5274
```

URL knobs: `counts` (placements per cell, default `100,250,500,1000`),
`iterations` (default 8), `cell` (cell size in metres, default 128),
`complex` (share of complex-as-simple trimesh placements, default 0.15).

## grass-ring (Faz 6, G0)

Procedural grass costs: (a) generating one 32 m cell on a synthetic 2×2-tile
World Terrain through today's helpers (`rollFoliageInstance` →
`foliageInstanceFromRoll` → `composeTransformMatrix`) and through a direct
packed-matrix path; (b) the GPU frame cost of a 96 m grass ring of
50k/150k/300k instances bucketed into 32 m batches, with the dither fade
prototype and grass shadows on/off (timer query when available); (c) building
one batch (`createInstancedModelGroup` vs a packed `instanceMatrix`) and its
first draw.

```
npx vite --port 5274 --strictPort --host 127.0.0.1
node spikes/grass-ring/run.mjs 5274
```

URL knobs: `densities` (per m², default `2,4,8`), `counts` (ring instances,
default `50000,150000,300000`), `frames` (default 60), `ring` (metres, default
96), `mesh` (asset id, default `kenney-grass`). Results: OPEN_WORLD_PLAN Faz 6,
"G0 sonuçları".

## far-view (Faz 7 S7, 7c2 cascaded shadows)

Sun shadow cost on the real runtime: OpenWorldTest (`npm run world:test`) in far
view mode, statics in World Partition cells, a grass ring. `probe.ts` attaches to
the live renderer and swaps the sun between no shadow, today's single follow
cascade, three's `CSM` addon (2/3/4) and a Forge prototype (2/3/4, chained
per-material patch, cascade picked from shadow coordinates). Timer queries split
the shadow pass out; interleaved rounds, median of medians.

```
npm run world:test
npx vite --port 5274 --strictPort --host 127.0.0.1
node spikes/far-view/run.mjs 5274 ultra,high,medium <outDir> [variants]
```

Env knobs: `ROUNDS` (default 4), `LOAD` (untimed extra renders that keep GPU
clocks up, default 2), `VIEW=dx,dz` (screenshot pose 30 m above the camera).
Results: OPEN_WORLD_PLAN Faz 7, "7c2 kaskadlı gölge — S7 ölçümü ve öneri".

## webgpu (Forge-WebGPU rebuild plan, Faz 1: GO / NO-GO spike)

Validates WebGPU for the Forge WebGPU rebuild (separate repo `Forge-WebGPU`,
`docs/planned/FORGE_WEBGPU_REBUILD_PLAN.md`, Faz 1, criteria G1-G9). Pages import
three only through `three/webgpu` / `three/tsl` (+ examples/jsm addons) and Forge
only from its three-free layers (`@engine/terrain`, `@engine/scene`,
`@engine/physics`); nothing here touches `engine/render-three`. Each page writes
the same `data-forge-perf` witness as the runtime, so the Phase 0 baseline harness
reads both. Reference scenes and the harness live outside the repos in
`C:\Users\emret\Desktop\Games\ForgeReference` (its README).

```
node spikes/webgpu/run.mjs s1-boot [--uncapped] [--dpr 1.3333] [--query "k=v"]
node spikes/webgpu/run.mjs s2-terrain --scene island --pose P2 [--uncapped --measure --reps 3]
node spikes/webgpu/run.mjs s2-terrain --scene derekavak --pose P1 --query "g8=1&region=512"
node spikes/webgpu/run.mjs s3-pipeline --scene island --pose P2 --uncapped --query "sweep=1"
node spikes/webgpu/run.mjs s3-pipeline --scene island --pose P2 --uncapped --measure --query "config=balanced"
```

`--scene` / `--pose` take the level, project root and camera pose from
`ForgeReference/baseline/poses.json` (the pose goes in through
`localStorage["forge.play.cameraPose"]`, as with Forge's Play). `--measure` runs
the baseline window per repetition: fresh context, 10 s warm-up, 15 s of frames;
frame = window / frame count, p95 of rAF intervals, GPU = median of the
timestamp-query witness.

The runner starts its own Vite on 127.0.0.1:4174 (never 5173 / 5273) with
`FORGE_PROJECT_ROOT` set to the reference project, opens headed Chrome on the
real GPU, waits for `window.__spikeReport` and writes `<page>.json` + `.png` to
`ForgeReference/baseline/spike/`. A run whose backend is not WebGPU fails.

- `s1-boot`: renderer init, backend proof (`isWebGPUBackend`, core vs
  compatibility), adapter, features, limits, timestamp queries, uncapped frame
  rate. `?forceWebGL=1` runs the WebGL2 backend for comparison only.
- `s2-terrain`: the reference level's World Terrain through a TSL port of
  Forge's CDLOD material (tile slots / global map, collider diagonal, morph,
  skirts, 8-layer splat, far tiling), Forge's `high` sun shadow (3 cascades for a
  `cascadedShadows` sun, else the follow map), SkyMesh + fog. Data via Forge's
  three-free terrain modules. `?g8=1` draws the terrain top-down into a float
  target with the main camera's LOD and compares every pixel with a ray onto
  Forge's Rapier heightfield (`terrainTileHeightfieldShape`), by distance band.
- `s3-pipeline`: the S2 scene (`shared/terrainScene.ts`) through one
  `RenderPipeline` (`shared/pipeline.ts`): MRT scene pass -> GTAO / SSGI / SSR
  composite -> TRAA -> bloom -> output transform; MRT targets only for the
  effects that read them; bloom only where the level authors it (as Forge's
  profile gates: allow, never force on). `?config=<name>` picks a row of `CONFIGS` (default
  `balanced`) for the baseline window; `?sweep=1` runs every row in one page
  load (`warm` / `window` seconds, default 4 / 10) and reports frame, p95, GPU
  and draw calls per row, with `direct` again at the end as a drift check. The
  page raises `maxColorAttachmentBytesPerSample` to 64 (five MRT targets are
  40 bytes / sample, the WebGPU default is 32).
- `s4-world`: the S2 scene plus the level's real content through the S3
  pipeline. `shared/content.ts` loads it the way Forge's runtime does: level
  instances (an asset listed with no placements still gets its empty batch),
  World Partition cells in load range, GLBs with their `*.materials.json` slots
  and `*.material.json` materials, Landscape foliage rings grown by Forge's
  three-free rules over the tiles Forge keeps resident (2 x tile size), far
  billboard blocks over the global map. `shared/contentRender.ts` draws it:
  `?mode=forge` is Forge WebGL's structure (asset x mesh InstancedMeshes per
  scope, cell batches frustum culled, small-asset dither fade and whole-batch
  skip, foliage per ring cell x mesh with cull, fade and wind sway, billboard
  blocks); `?mode=per-placement` draws every placement as its own Mesh;
  `?mode=instanced` merges an asset's meshes per material and draws all its
  placements in one InstancedMesh per material, foliage cells gathered into
  256 m blocks per rule; `?mode=batched` also packs static assets that share a
  material signature (and never detail-cull) into one BatchedMesh;
  `?mode=gpu-cull` is "instanced" with one rule (`cullRule`, default
  `meadow-grass`) drawn GPU-driven (`shared/gpuCull.ts`: compute frustum +
  distance cull into a storage buffer, atomic count into the indirect args, one
  drawIndexedIndirect); `?noCull=<rule>` draws a rule as one InstancedMesh with
  no culling (the G7 reference). The report carries the GPU's visible count next
  to the same test on the CPU. `?planarY=<water level>` adds one planar
  reflection (TSL `reflector()`) like Forge's lake reflection on `high`: 256 px
  wide, refreshed at most every 32 ms (`planarRes`, `planarEveryMs`; 0 = every
  frame), always on (Forge skips one whose water covers < 1 % of the screen).
  `?config=forge-high` (default) is the level's authored post-process (GTAO /
  bloom / SMAA); the S3 rows are accepted too. The witness adds `cpuMainMs`
  (rAF callback) and `cpuRenderMs` (render submission). `?drawTally=1` reports
  one frame's real draws by camera and content kind.

Results go into the Forge-WebGPU plan, not here.
