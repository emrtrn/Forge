# rts-starter

The game the layered runtime plan was written for: **no characters, no scene
setup, no second app shell.**

Forge's runtime used to build a character-shaped world unconditionally —
CharacterMovement, skeletons, locomotion animation, all constructed whether a
game had a character or not. Building a top-down strategy game therefore meant
writing an `RtsApp` of your own, which threw away everything `buildScene` did:
terrain, materials, lights, the sky/fog/cloud/post stack, VFX, collision. Every
one of them had to be re-plumbed by hand, and the ones you forgot showed up as
"it looks right in the editor and wrong in Play".

This starter is the same app as [`game-starter`](../game-starter/README.md) with
two differences, and no re-plumbing:

```ts
const forge = await createForgeRuntime({
  canvas,
  // 1. a shorter capability list — the character modules are simply not there
  modules: createDefaultRuntimeModules().filter((m) => !CHARACTER_CAPABILITIES.has(m.id)),
  // 2. a game module whose entire content is "my Game Mode is the RTS camera"
  gameModules: [rtsStarterGameModule],
});
await forge.loadLevel("layouts/rts.level.json");
forge.start();
```

`main.level.json` is the same
[RuntimeParity](../../public/layouts/RuntimeParity.level.json) fixture the
game-starter opens, with one field added: `worldSettings.gameMode` =
`forge.rtsCamera`. Everything it authors — terrain, static meshes with a
material override, sun + fill light, sky/fog/clouds/post-process, an
auto-playing particle effect, a placed Actor Script with collision — still
renders in full. Dropping three capabilities cost the scene nothing, which is
the plan's invariant I3.

Open it in the template's dev server without installing anything:
`npm run editor`, then `http://127.0.0.1:5173/templates/rts-starter/index.html?debug`
(the level must be installed first — step 3 below).

## Controls

| Input | Action |
| --- | --- |
| Cursor at a screen edge | Pan the map (ramps in across the edge band) |
| `WASD` / arrows | Pan the map |
| Mouse wheel | Zoom; panning speeds up as you zoom out |
| Left click | Select the unit under the cursor; click empty ground to clear |

The camera never turns: a fixed heading and tilt looking down at a ground focus
point, which is what the panning actually moves. `?debug` shows the mode's state
on the `camera:` line — `rts-top-down zoom:… selected:…`.

## Using it

1. Copy the Forge template repo (a fork is a copy — see `docs/`).
2. Replace `src/main.ts` with this `main.ts`.
3. Copy `main.level.json` into `public/layouts/` as `rts.level.json` and point
   `public/project.3dgame.json` → `editor.defaultScene` at it. The level's
   terrain reads `landscapes/runtime-parity.landscape.json`, which the template
   already ships; author your own terrain in the editor to replace it.

## Where a real RTS grows from here

- **Units.** They are placed Actor Scripts, so they already select. Give them an
  AI controller and the `ai` capability (kept in this list) runs them.
- **Rules.** Score, resources, win/loss: another service published from the same
  `register` hook, exactly as `src/game/gameModule.ts` does for the template.
- **Behavior scripts.** This starter publishes no behavior catalog, so the
  level's scripted cube stands still and the console says why. Publishing
  `behaviorRegistryFactoryService` is what wakes it up.
- **The camera.** `createRtsCameraGameMode(settings)` takes the heading, tilt,
  zoom range, edge margin and pan speeds; the default is
  `DEFAULT_RTS_CAMERA_SETTINGS`.

## What it does not need

No `RtsApp`. No copy of `buildScene`. No editing of `RuntimeSceneApp`,
`LevelRuntime` or any capability module. That is the acceptance criterion of the
layered runtime plan's Phase I — see
`docs/planned/FORGE_LAYERED_RUNTIME_PLAN.md`.
