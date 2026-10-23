# Save-Game Envelope Contract

> Status: current contract, checked against source on 2026-10-22.
> Origin: P3 of `RUNTIME_GAMEPLAY_REMAINING_CHECKLIST.md` (removed on
> 2026-07-14 in `e107f11`; its content is in git history).
> Audience: fork/template consumers building save/load into a concrete game.

Forge ships a small, deliberate save-game core. A fork does **not** need to
reverse-engineer what a save captures — this document is the written contract:
what is stored, what is deliberately left out, how a script opts state into a
save, and how load + level travel + restore are sequenced.

The rule of thumb: **a save-game is a small runtime-state delta layered on top of
the authored level, not a snapshot of the world.** The level itself is authored
data and is always reloaded fresh from its `*.level.json`; the save only carries
the few facts that must survive a reload.

## Ownership

| Layer | Owner | File |
| --- | --- | --- |
| Storage envelope (opaque payload, slots, schema, migration) | engine | `engine/persistence/saveGameStore.ts` |
| Shared payload shape, collection and normalization | engine | `engine/persistence/saveGameState.ts` |
| Slots, checkpoint writes and pending restore | capability | `src/scene/capabilities/saveGameModule.ts` |
| Live capture and restore adapters | runtime host | `src/scene/RuntimeSceneApp.ts` via `gameplaySaveStateService` |

The engine store treats `payload` as opaque. `saveGameState.ts` defines the
shared `GameSaveState` and normalizes it into a restore request; the capability
coordinates storage and travel, while the host reads and applies live state.
Game-specific progress uses opted-in script state or a fork-owned adapter;
game rules do not belong in the engine store.

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
  (created lazily by `createSaveGameModule`). Saves are **client-side only**; they are never
  written to `public/` layout files or through any dev endpoint.
- **Slot key:** `forge.saveGame.<encodeURIComponent(gameId)>.slot.<encodeURIComponent(slot)>`
  (namespace `forge.saveGame`). `gameId` is the project manifest `name`, so two
  games with different names do not read each other's slots. Forks sharing an
  origin must choose different manifest names to keep their saves separate.
- **Built-in slots:** the runtime UI exposes `quick`, `slot-1`, `slot-2`
  (`emptySaveGameUiSlots`); `quick` is the checkpoint autosave target. Slot names
  are just strings — a game may use its own.
- **Safety:** corrupt / wrong-`gameId` / unparseable data reads back as `null`
  with a `console.warn` (never throws); a write that hits a quota / storage error
  returns `{ ok: false, reason: "storage-error" }` instead of throwing.

## P3.1 — Fields that ARE saved (`GameSaveState`)

Defined in `engine/persistence/saveGameState.ts`, produced by `collectSaveState(...)`:

| Field | Type | Source |
| --- | --- | --- |
| `activeLevelPath` | `string` | The live level path (`RuntimeSceneApp.activeLevelPath`). Load travels here first. |
| `player` | `{ position: [x,y,z], facingYawDeg } \| null` | Possessed pawn transform: `position` + `rotation[1]` as yaw. `null` when nothing is possessed. |
| `flags` | `PersistentScriptStateEntry[]` | Opt-in persistent script state (see P3.3), each `{ entityId, key, value }`, sorted deterministically by `entityId` then `key`. |
| `vehicles` | `SavedVehicleState[]` (optional in older saves) | Every live ray-cast vehicle's entity ID, position, Euler rotation in degrees, world linear/angular velocity, handbrake, and drivetrain (`gear`, `engineRpm`, or `null`). In a World Partition level it also lists cars parked in unloaded cells (at rest: zero velocities); see *World Partition levels* below. |
| `drivingVehicleId` | `string \| null` (optional in older saves) | Vehicle occupied by an on-foot pawn. `null` on foot and when the Game Mode pawn is itself the vehicle. |

Notes:

- `player` keeps the pawn's full XYZ position and facing yaw, without scale,
  pitch/roll or character velocity. A character restores at rest; vehicle pose
  and motion are restored separately from `vehicles` (P3.4).
- `flags` is the **only** channel for arbitrary game state. If a fact is not the
  level path, player transform, vehicle state/occupancy, or an opted-in
  script-state entry, it is not in the save.
- The schema version lives on the **envelope** (`schema`), not the payload.
  Current capability store schema is `1`, with **no `migrate` hook wired yet**.
  Older schema-1 saves without vehicle fields remain valid: missing `vehicles`
  normalizes to `[]`, and missing `drivingVehicleId` to `null`. Invalid vehicle
  entries are dropped individually; duplicate entity IDs keep the first valid
  entry. For an incompatible change, bump the store schema in
  `createSaveGameModule` and supply a `migrate(fromSchema, payload)` to
  `SaveGameStore` — older schemas without a migrate hook are
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
- **Character and other non-vehicle physics dynamics** — impulses, velocities,
  ragdoll state. A character respawns at rest; the locomotion report is cleared.
  Vehicle linear/angular velocities and drivetrain state are saved explicitly.
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
2. The save capability stores `pendingRestore` and requests travel through
   `levelTravelService`, which calls `enqueueLevelTravel(restore.levelPath)`
   — travel to the **saved** level, even if it is the current one (a full rebuild).
3. After the scene finishes building, the save capability's `onLevelLoaded`
   calls `applyPendingRestore(loadedLevelPath)`.
   `consumeRestoreForLoadedLevel` applies the restore **only if the loaded level
   matches** the pending restore's `levelPath` (else the pending request is kept
   for a later matching load). This runs **after** scene build + Game Mode
   possession, so a pawn exists to move.
4. `gameplaySaveStateService.restore` applies persistent `flags` first, then
   vehicle pose/motion, then the player transform, then boards
   `drivingVehicleId` if supported. A character is placed at rest with its
   respawn transform updated. A vehicle pawn already restored from `vehicles`
   keeps that motion; a legacy save without vehicle state resets it at rest.
   Missing vehicles are skipped. Failed boarding warns and leaves the character
   at the saved player position.
5. A plain `requestLevelTravel(...)` (e.g. a portal) **clears** any
   pending restore through `saveGameCommandsService.clearPendingRestore`:
   a portal travel is not a save-load and must not
   accidentally apply a stale restore.

Checkpoint autosave shares the same collector: the save capability's
`writeCheckpointSave(slot)` → `gameplaySaveStateService.capture()` →
`collectCurrentSaveState()` → `store.writeSlot(slot, payload)`. It only writes;
it has no restore side effect. Loading that slot later runs the sequence above.

## World Partition levels

With `worldSettings.partition.enabled`, Actor Script actors stream with their
cells (see `CONTENT_LOADING_CONTRACT.md`). Streaming does not add a save field;
it only has to keep the existing ones meaningful while an actor is not loaded:

- **Script state.** `flags` entries are keyed by the stable `actor:<layout index>`
  id and survive unload: `unloadEntity` keeps only `persist`ed keys, and a
  restore stores entries for actors that are not live yet, applying them when the
  cell activates (`applyPersistentStateSnapshot`). Destroyed/hidden/collision
  markers set with `{ persist: true }` are honored at activation — a persisted
  destroyed actor is never built.
- **Vehicles.** A save lists live vehicles plus cars the streamer remembers from
  unloaded cells, parked at the pose they were left in (`StreamedActorStateCache`).
  A restore applies `vehicles` entries to live cars immediately and keeps the
  entries for cars whose cell is not loaded; the car appears at its saved pose,
  at rest, when the cell activates. The vehicle in `drivingVehicleId` is brought
  live ahead of its cell so the pawn can board it.
- **Other simulated bodies.** Crates and other physics bodies keep their moved pose
  only in memory while the level is loaded (so an unloaded cell does not reset
  them); like loaded ones they are not part of the save-game (P3.2).
- **Not streamed, not saved.** Static meshes, lights, volumes and characters are
  built with the level and unaffected.

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

- `engine/persistence/saveGameState.ts` — payload shape + `collectSaveState` / `applySaveState`
  / `consumeRestoreForLoadedLevel`.
- `engine/persistence/saveGameStore.ts` — envelope, slots, schema, migration,
  storage adapters.
- `engine/persistence/saveGameSlots.ts` — slot IDs, UI fields and commands.
- `src/scene/capabilities/saveGameModule.ts` — checkpoint/slot writes, load
  requests, store creation and pending restore.
- `src/scene/capabilities/runtimeServiceKeys.ts` — capture/restore and travel
  service contracts.
- `src/scene/RuntimeSceneApp.ts` — `collectCurrentSaveState`,
  `applySavedPlayerTransform`, `applySavedVehicles`, `applySavedVehicleRide`.
- `tests/smoke/runtime-checkpoint.spec.ts` — browser proof of the
  autosave → load → respawn round-trip.
