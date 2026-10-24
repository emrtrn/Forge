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
