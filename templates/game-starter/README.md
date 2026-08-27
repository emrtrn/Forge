# game-starter

The smallest complete Forge game: **no gameplay, no scene-setup code**.

`main.ts` is the whole application — three calls, no render loop of its own
(plus a `?debug` perf overlay, which is diagnostics, not scene setup):

```ts
const forge = await createForgeRuntime({ canvas, modules: createDefaultRuntimeModules() });
await forge.loadLevel("layouts/main.level.json");
forge.start();
```

`main.level.json` is the [RuntimeParity](../../public/layouts/RuntimeParity.level.json)
fixture under a starter name: terrain, static meshes with a per-placement
material override, a shadow-casting sun plus a fill light, the whole
sky/fog/cloud/post-process stack, an auto-playing particle effect, a placed
Actor Script with collision, and a behavior-animated object. None of it is wired
up by this app — the level file is the source of the scene (plan invariant I1),
so everything above renders because it was *authored*, not because the starter
knows about it.

Open it in the template's dev server without installing anything:
`npm run editor`, then `http://127.0.0.1:5173/templates/game-starter/index.html?debug`
(the level must be installed first — step 3 below).

## Using it

1. Copy the Forge template repo (a fork is a copy — see `docs/`).
2. Replace `src/main.ts` with this `main.ts`.
3. Copy `main.level.json` into `public/layouts/` and point
   `public/project.3dgame.json` → `editor.defaultScene` at it. The level's
   terrain reads `landscapes/runtime-parity.landscape.json`, which the template
   already ships; author your own terrain in the editor to replace it.

## Adding gameplay

Game rules are Layer 3: a `ForgeGameModule` the composition root plugs in.

```ts
const forge = await createForgeRuntime({
  canvas,
  modules: createDefaultRuntimeModules(),
  gameModules: [createMyGameModule()],
});
```

The module publishes what the runtime shell must not know by itself — the Game
Mode catalog, the behavior catalog, the AI task vocabulary — and receives the
level through its own `onLevelLoaded`. See `src/game/gameModule.ts` for the
template's own implementation, and
`docs/planned/FORGE_LAYERED_RUNTIME_PLAN.md` for the layering rules.

## What a game module unlocks

Behavior scripts are game content too, so with no game module the level's
authored `Behavior` components resolve to nothing and the runtime says so:

```
[runtime] No behavior catalog registered: 1 authored behavior script(s) in this
level do nothing. Behavior scripts are game content — a Layer 3 game module
publishes the catalog.
```

That is why the starter's spinning cube stands still: the scene content renders
without a game, the *scripted* part waits for one.

## Dropping a capability

`createDefaultRuntimeModules()` is an ordered list a fork edits. Removing one
removes **only** that behavior; the level's scene content still builds in full,
and the runtime says what went inert:

```
[runtime] Unsupported runtime capability: "vfx" is not registered, so 1 authored
ParticleEmitter component(s) in this level do nothing.
```
