# spikes/

Throwaway measurement pages for `docs/planned/OPEN_WORLD_PLAN.md` Faz 0. They
live only on `feat/open-world`, are not part of the app build, the root
`tsc --noEmit` or `verify:imports`, and the whole folder is deleted before the
branch merges to `main`. Results go into the plan's "Kararlar" section.

Type-check: `npx tsc -p spikes`.

## terrain-cdlod (S1 + S2)

GPU CDLOD terrain: 16×16 tiles of 256 m (4 km), Uint16 tiles through the real
`terrainTileCodec`, a `DataArrayTexture` slot pool, one instanced draw with
morphing, the Landscape splat material moved onto `onBeforeCompile`
displacement, shadow receiving and terrain self-shadow via `customDepthMaterial`.

```
npm run dev:smoke
http://127.0.0.1:5273/spikes/terrain-cdlod/index.html
```

Press **B** for the 33 s scripted benchmark (low flight, high orbit, ground run,
terrain-hidden baseline); the report opens bottom-right with a Copy button.
Press **U** (S3) to evict every resident tile and upload them all again in one
frame; the report lists per-tile main-thread cost.
Press **Z** (S5) for the z-fighting test: quad pairs 1 cm–10 m apart at
250 m–5.8 km, read back to measure how often the back quad wins.
URL knobs: `tiles`, `patch`, `slots`, `range0`, `shadow`, `shadowExtent`,
`shadowBias`, `dpr`, `uploadsPerFrame`, `layers` (`4` | `8`), `heightFormat`
(`r16-norm` | `r32f` | `r16f`), `depth` (`standard` | `reversed` | `log` |
`reversed-float`), `near`, `pose=x,agl,z,yaw,pitch`.

## terrain-worker (S6)

Tile decode on the main thread vs a module worker (`transfer`, 1/2/4 workers)
for 64 real 8-layer tiles; the page prints its report and needs no input.

```
npm run dev:smoke
http://127.0.0.1:5273/spikes/terrain-worker/index.html
```

Production check with the project's own Vite config, outside `dist/`:

```
SPIKE_OUT_DIR=<dir> npx vite build --config spikes/terrain-worker/vite.build.config.ts
node builder/web/verify-dist.mjs --dist <dir> --strict
SPIKE_OUT_DIR=<dir> npx vite preview --config spikes/terrain-worker/vite.build.config.ts --port 4373
```

## terrain-physics (S4)

Rapier heightfield create/remove cost from real codec tiles (vs a trimesh),
down-ray continuity on tile seams and corners, and a ball plus Forge's
reference car crossing a seam and a corner compared with one seamless
heightfield (with and without `FIX_INTERNAL_EDGES`). Prints its report.

```
npm run dev:smoke
http://127.0.0.1:5273/spikes/terrain-physics/index.html
```

## terrain-deformation (TERRAIN_DEFORMATION_PLAN Faz 0)

Automatic real `PhysicsSubsystem` reference-car measurements at fixed 60 Hz:
one-wheel rest-length changes (+0.3 m and back, instant/3/1/0.3 m/s, parked
and initially 10 m/s), sleep/wake probe, matched speed-proportional wheel-brake
versus chassis-impulse coast-down and released-handbrake 8° ramp behaviour.
Also measures the actual `mud` surface provider (not force-matched). Baseline
rolling brake and body damping are disabled to isolate resistance. The rest
length recommendation uses explicit exploratory comfort thresholds in the JSON.
Rate comparisons keep the solver awake; the separate sleep probe reports
automatic waking and the explicit `wakeUp` fallback. Motion metrics use pose
differences to avoid sleeping-controller velocity artifacts.

Texture measurements replay identical seeded rectangles over 300 frames each:
512² R8 full upload versus packed `texSubImage2D` partial upload, CPU mean/p95
and asynchronous GPU timers when available. Installed three r184's 2D update
ranges assume RGBA, so they are unsuitable for R8. Reports include readback
validation, GPU/disjoint availability and separate render/upload+render timing.
Results appear in the DOM and `window.__spikeReport`; failures also produce a
report. Terrain recognition remains out of scope until OPEN_WORLD Faz 3.

```
npm run dev:smoke
http://127.0.0.1:5273/spikes/terrain-deformation/index.html
```

With that server running, print the JSON report (runner exits nonzero on failure):

```
node spikes/terrain-deformation/run.mjs
```
