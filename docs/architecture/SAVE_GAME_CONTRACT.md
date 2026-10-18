# Save-Game Envelope Contract

> Status: written for P3 of `RUNTIME_GAMEPLAY_REMAINING_CHECKLIST.md`
> (removed from the repo on 2026-07-14 in `e107f11`; its content is in git history).
> Audience: fork/template consumers building save/load into a concrete game.

Forge ships a small, deliberate save-game core. A fork does **not** need to
reverse-engineer what a save captures — this document is the written contract:
what is stored, what is deliberately left out, how a script opts state into a
save, and how load + level travel + restore are sequenced.

The rule of thumb: **a save-game is a small runtime-state delta layered on top of
the authored level, not a snapshot of the world.** The level itself is authored
data and is always reloaded fresh from its `*.level.json`; the save only carries
the few facts that must survive a reload.

## Two layers

| Layer | Owner | File |
| --- | --- | --- |
| Storage envelope (opaque payload, slots, schema, migration) | engine | `engine/persistence/saveGameStore.ts` |
| Payload shape (what a Forge game actually saves) | game | `src/game/saveGame.ts` |

The engine store treats `payload` as opaque; the game module
(`src/game/saveGame.ts`) is the serializer boundary that decides which runtime
facts become a payload and how a loaded payload becomes a restore request. Keep
game-specific save decisions in the game layer, never in the engine store.

### Envelope (`SaveGameEnvelope`)

```jsonc
{
  "schema": 1,              // integer, current SAVE_GAME schema (see below)
  "gameId": "<manifest.name>", // isolates one game's slots from another's
  "createdAt": "2026-…Z",   // ISO, set once on first write to a slot
  "updatedAt": "2026-…Z",   // ISO, refreshed every write
  "payload": { /* GameSaveState, see P3.1 */ }
}
```

- **Backend:** `localStorage` via `createLocalStorageAdapter(window.localStorage)`
  (`createRuntimeSaveGameStore`). Saves are **client-side only**; they are never
  written to `public/` layout files or through any dev endpoint.
- **Slot key:** `forge.saveGame.<encodeURIComponent(gameId)>.slot.<encodeURIComponent(slot)>`
  (namespace `forge.saveGame`). `gameId` is the project manifest `name`, so two
  games (or two forks) never read each other's slots.
- **Built-in slots:** the runtime UI exposes `quick`, `slot-1`, `slot-2`
  (`emptySaveGameUiSlots`); `quick` is the checkpoint autosave target. Slot names
  are just strings — a game may use its own.
- **Safety:** corrupt / wrong-`gameId` / unparseable data reads back as `null`
  with a `console.warn` (never throws); a write that hits a quota / storage error
  returns `{ ok: false, reason: "storage-error" }` instead of throwing.

## P3.1 — Fields that ARE saved (`GameSaveState`)

Defined in `src/game/saveGame.ts`, produced by `collectSaveState(...)`:

| Field | Type | Source |
| --- | --- | --- |
| `activeLevelPath` | `string` | The live level path (`RuntimeSceneApp.activeLevelPath`). Load travels here first. |
| `player` | `{ position: [x,y,z], facingYawDeg } \| null` | Possessed pawn transform: `position` + `rotation[1]` as yaw. `null` when nothing is possessed. |
| `flags` | `PersistentScriptStateEntry[]` | Opt-in persistent script state (see P3.3), each `{ entityId, key, value }`, sorted deterministically by `entityId` then `key`. |

Notes:

- Only the pawn's **planar transform + facing yaw** are kept — not pitch/roll,
  not scale, not velocity. On restore the pawn is placed at rest (P3.4).
- `flags` is the **only** channel for arbitrary game state. If a fact is not the
  level path, the player transform, or an opted-in script-state entry, it is not
  in the save.
- The schema version lives on the **envelope** (`schema`), not the payload.
  Current `SAVE_GAME` schema is `1`, with **no `migrate` hook wired yet**; when
  the payload shape changes, bump the schema in `createRuntimeSaveGameStore` and
  supply a `migrate(fromSchema, payload)` — older slots without a migrate hook are
  rejected (read back as `null`), and newer-than-current slots are always
  rejected.

## P3.2 — Fields deliberately NOT saved

These are intentionally excluded. A fork should not expect them in a slot and
should not try to smuggle them through `flags` unless it genuinely owns that
state as script state:

- **Layout / scene geometry, materials, lights, environment actors** — authored
  data; reloaded fresh from the level `*.level.json` on every load.
- **Editor state** — outliner/selection/gizmo/camera authoring state is
  editor-only and never part of the runtime, let alone a save.
- **Runtime-spawned actors** (projectiles, `actor.spawn(...)` results) and
  **destroyed authored actors** — *except* the opt-in destroyed/hidden markers a
  script persists (P3.3). Spawned actors are transient by default.
- **Transient behavior latches** — one-shot trigger guards
  (`traveledTriggers`, `checkpointsSaved`, `collisionAudioPlayed`,
  interaction edges). These live on the per-scene behavior registry and start
  fresh on every scene build (see P0.1–P0.3 in the runtime checklist), so they
  are neither saved nor restored.
- **UI ephemeral state** — open menus, HUD widget state, the screen stack,
  ViewModel store fields.
- **Physics dynamics** — impulses, velocities, ragdoll state. The pawn respawns
  at rest; the locomotion report is cleared on restore.
- **Camera** — the spring-arm / follow camera re-derives from the restored pawn.
- **AI runtime state** — controllers, blackboards, perception, nav paths rebuild
  from the level.
- **VFX instances, active audio, timers / lifespans** — all rebuilt from scratch.

## P3.3 — Opt-in persistent script-state pattern

A behavior / Actor Script writes into the save only by explicitly persisting a
key on its `ScriptState`:

```ts
// Inside a behavior update (BehaviorContext):
const enabled = context.state.toggle("enabled", true);
context.state.persist("enabled", enabled); // <- now part of `flags` on save
```

- `context.state.persist(key, value)` marks `(entityId, key, value)` for the
  next `getPersistentStateSnapshot()`; `value` must be a `SceneJsonValue`
  (JSON-safe). Non-persisted `state.set(...)` values stay in-memory only.
- On load, `applyPersistentStateSnapshot(flags)` re-seeds those keys **before**
  the player transform is applied, so a behavior reads its restored value on its
  first tick of the loaded scene.
- **Reserved auto-persisted keys:** actor-command helpers persist lifecycle
  markers when called with `{ persist: true }` — hidden (visibility), collision
  disabled, and destroyed. This is how an authored actor stays destroyed/hidden
  across a save without the game writing bespoke flag code.
- **Migration hook:** when a persisted key's meaning changes, migrate it at the
  envelope level (schema bump + `migrate`), not by silently reinterpreting an old
  `flags` value. `flags` entries with an unknown shape are dropped by
  `normalizePersistentState` on load (they never crash a restore).

## P3.4 — Load + travel + restore contract

Load is **not** an in-place state injection; it goes through level travel so the
saved level is always rebuilt clean first:

1. `requestSaveGameLoad(payload)` → `applySaveState(payload)` validates +
   normalizes the payload into a `GameSaveRestoreRequest` (bad payload → `false`,
   no travel).
2. It stores `pendingSaveRestore` and calls `enqueueLevelTravel(restore.levelPath)`
   — travel to the **saved** level, even if it is the current one (a full rebuild).
3. After the scene finishes building, `buildScene(...)` calls
   `applyPendingSaveRestore(loadedLevelPath)`.
   `consumeRestoreForLoadedLevel` applies the restore **only if the loaded level
   matches** the pending restore's `levelPath` (else the pending request is kept
   for a later matching load). This runs **after** scene build + Game Mode
   possession, so a pawn exists to move.
4. Restore order: persistent `flags` first (`applyPersistentStateSnapshot`), then
   the player transform (`applySavedPlayerTransform`) — position + facing yaw
   only, pawn placed at rest (locomotion report cleared, respawn transform
   updated).
5. A plain `requestLevelTravel(...)` (e.g. a portal) **clears** any
   `pendingSaveRestore`: a portal travel is not a save-load and must not
   accidentally apply a stale restore.

Checkpoint autosave shares the same collector: `writeCheckpointSave(slot)` →
`collectCurrentSaveState()` → `store.writeSlot(slot, payload)`. It only writes;
it has no restore side effect. Loading that slot later runs the sequence above.

## P3.5 — Validator relationship (and why saves bypass it)

Save-game payloads are **localStorage-only** and never travel through
`tools/saveValidator.ts`. That validator guards the dev-only `/__save-*`
endpoints that write **structured layout / sidecar data** into `public/`
(`applyTransformFields`, `validateLightActor`, `validateSkeleton*`,
`validateEffectAsset`, …). Two consequences a fork must keep straight:

- **Do not** try to persist gameplay progress by writing it into a layout file
  through a dev endpoint. Layout files are authored content; a save-game is a
  separate localStorage delta. Runtime save state never rewrites the layout.
- The layout allowlist gotcha still applies to **authoring**, not saving: any new
  `LayoutPlacement` / `LayoutCharacter` / sidecar field must be added to the
  matching `tools/saveValidator.ts` allowlist (and its loader/normalizer) or it is
  silently dropped on save-layout. See `CLAUDE.md` → *Save-validator allowlist
  gotcha*. This is orthogonal to the save-game envelope but is the field most
  often confused with it.

## Files

- `src/game/saveGame.ts` — payload shape + `collectSaveState` / `applySaveState`
  / `consumeRestoreForLoadedLevel`.
- `engine/persistence/saveGameStore.ts` — envelope, slots, schema, migration,
  storage adapters.
- `src/scene/RuntimeSceneApp.ts` — `writeCheckpointSave`, `collectCurrentSaveState`,
  `requestSaveGameLoad`, `applyPendingSaveRestore`, `applySavedPlayerTransform`.
- `tests/smoke/runtime-checkpoint.spec.ts` — browser proof of the
  autosave → load → respawn round-trip.
