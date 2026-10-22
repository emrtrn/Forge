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
URL knobs: `tiles`, `patch`, `slots`, `range0`, `shadow`, `shadowExtent`, `dpr`,
`uploadsPerFrame`, `layers` (`4` | `8`), `heightFormat` (`r16-norm` | `r32f` | `r16f`),
`pose=x,agl,z,yaw,pitch`.
