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
