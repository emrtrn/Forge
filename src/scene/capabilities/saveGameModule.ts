/**
 * Layer 2 capability: Save Game — slots, checkpoints and the load handshake.
 *
 * Owns what used to be baked into `RuntimeSceneApp` as the save coordinator: the
 * {@link SaveGameStore}, the pending-restore latch, quick-slot write/load/delete,
 * checkpoint autosave, the reserved `save:*` widget messages and the
 * `save.slots.*` ViewModel fields.
 *
 * Everything it needs from outside is resolved from the service container, and
 * every one of those is optional:
 *   - no gameplay save state → nothing to capture, so writes report "Save
 *     unavailable" instead of persisting an empty payload;
 *   - no level travel → a load cannot reach its level, so it fails visibly
 *     rather than half-restoring the current one;
 *   - no UI ViewModel / no mounted UI → the capability still saves and loads, it
 *     just has no menu to update.
 * Switching this module off removes save/load only: the level's content, its
 * scripts and its checkpoint volumes are untouched — a checkpoint simply stops
 * writing, and `save:*` widget messages fall through to gameplay as ordinary
 * `ui-action` messages.
 */
import {
  SaveGameStore,
  createLocalStorageAdapter,
  type StorageAdapter,
} from "@engine/persistence/saveGameStore";
import {
  applySaveState,
  consumeRestoreForLoadedLevel,
  type GameSaveRestoreRequest,
  type GameSaveState,
} from "@engine/persistence/saveGameState";
import {
  buildSaveGameUiFields,
  emptySaveGameUiSlots,
  readSaveGameUiCommand,
  type SaveGameUiSlotId,
} from "@engine/persistence/saveGameSlots";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  gameplaySaveStateService,
  levelTravelService,
  projectIdentityService,
  saveGameCommandsService,
  uiPresenterService,
  uiViewModelService,
} from "./runtimeServiceKeys";

export const SAVE_GAME_MODULE_ID = "save-game";

export interface SaveGameModuleOptions {
  /**
   * Where slots are persisted. Defaults to `window.localStorage`; a host without
   * one (a test, a server-side render) gets a module that reports every slot as
   * unavailable rather than throwing.
   */
  readonly storage?: StorageAdapter;
}

/** Wraps localStorage, or null in a host that has none / denies access to it. */
function defaultStorage(): StorageAdapter | null {
  try {
    return createLocalStorageAdapter(window.localStorage);
  } catch {
    return null;
  }
}

export function createSaveGameModule(options: SaveGameModuleOptions = {}): CapabilityModule {
  let services: RuntimeServices | null = null;
  let store: SaveGameStore<GameSaveState> | null = null;
  /** The project id `store` was built for; a different one rebuilds it. */
  let storeGameId: string | null = null;
  /** Restore applied once the saved level finishes loading; null when idle. */
  let pendingRestore: GameSaveRestoreRequest | null = null;

  /**
   * Builds the slot store for the active project. The project manifest loads
   * after the shell is constructed, so this cannot happen at start time — the
   * id is read at first use and the store rebuilt if the project ever changes.
   */
  function ensureStore(): SaveGameStore<GameSaveState> | null {
    const gameId = services?.resolve(projectIdentityService)?.() ?? null;
    if (!gameId) return store;
    if (store && storeGameId === gameId) return store;
    const storage = options.storage ?? defaultStorage();
    if (!storage) return null;
    try {
      store = new SaveGameStore<GameSaveState>({ gameId, schema: 1, storage });
      storeGameId = gameId;
    } catch {
      store = null;
      storeGameId = null;
    }
    return store;
  }

  /** Rebuilds the `save.slots.*` fields from the current store contents. */
  function refreshUiFields(): void {
    const uiStore = services?.resolve(uiViewModelService);
    if (!uiStore) return;
    const slots = emptySaveGameUiSlots().map((view) => {
      const envelope = store?.readSlot(view.slot) ?? null;
      return envelope
        ? { ...view, updatedAt: envelope.updatedAt, levelPath: envelope.payload.activeLevelPath }
        : view;
    });
    uiStore.setFields(buildSaveGameUiFields(slots));
  }

  function setStatus(slot: SaveGameUiSlotId, status: string): void {
    const uiStore = services?.resolve(uiViewModelService);
    if (!uiStore) return;
    uiStore.setField(`save.slots.${slot}.status`, status);
    uiStore.flush();
  }

  function flushUi(): void {
    services?.resolve(uiViewModelService)?.flush();
  }

  /**
   * Decodes a payload and, if valid, latches it and travels to the saved level;
   * {@link applyPendingRestore} re-applies it once that level has been built.
   */
  function requestSaveGameLoad(payload: unknown): boolean {
    const travel = services?.resolve(levelTravelService);
    if (!travel) return false;
    const restore = applySaveState(payload);
    if (!restore) return false;
    pendingRestore = restore;
    travel(restore.levelPath);
    return true;
  }

  /**
   * After a level build, applies the pending restore only when it targets the
   * level that just loaded (a portal travel elsewhere leaves it latched).
   */
  function applyPendingRestore(loadedLevelPath: string): void {
    const result = consumeRestoreForLoadedLevel(pendingRestore, loadedLevelPath);
    pendingRestore = result.pending;
    if (!result.restore) return;
    services?.resolve(gameplaySaveStateService)?.restore(result.restore);
  }

  function writeSlot(slot: SaveGameUiSlotId): void {
    const payload = services?.resolve(gameplaySaveStateService)?.capture() ?? null;
    const active = ensureStore();
    if (!active || !payload) {
      setStatus(slot, "Save unavailable");
      return;
    }
    const result = active.writeSlot(slot, payload);
    refreshUiFields();
    if (!result.ok) setStatus(slot, "Save failed");
    else flushUi();
  }

  function loadSlot(slot: SaveGameUiSlotId): void {
    const envelope = ensureStore()?.readSlot(slot) ?? null;
    if (!envelope) {
      setStatus(slot, "Empty");
      return;
    }
    if (!requestSaveGameLoad(envelope.payload)) {
      setStatus(slot, "Load failed");
      return;
    }
    services?.resolve(uiPresenterService)?.clearScreens();
  }

  function deleteSlot(slot: SaveGameUiSlotId): void {
    const active = ensureStore();
    if (!active) {
      setStatus(slot, "Save unavailable");
      return;
    }
    const ok = active.deleteSlot(slot);
    refreshUiFields();
    if (!ok) setStatus(slot, "Delete failed");
    else flushUi();
  }

  return {
    id: SAVE_GAME_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      runtimeServices.provide(saveGameCommandsService, {
        handleUiMessage(message) {
          const command = readSaveGameUiCommand(message);
          if (!command) return false;
          switch (command.kind) {
            case "write":
              writeSlot(command.slot);
              return true;
            case "load":
              loadSlot(command.slot);
              return true;
            case "delete":
              deleteSlot(command.slot);
              return true;
          }
        },

        /**
         * Autosave from a `checkpoint` behavior. Reuses the manual-save path;
         * a failure degrades to a warning, because crossing a checkpoint must
         * never interrupt play.
         */
        writeCheckpointSave(slot) {
          const active = ensureStore();
          if (!active) return;
          const payload = services?.resolve(gameplaySaveStateService)?.capture() ?? null;
          if (!payload) return;
          const result = active.writeSlot(slot, payload);
          if (!result.ok) {
            console.warn("[runtime] checkpoint save failed", slot);
            return;
          }
          console.info("[runtime] checkpoint saved", slot);
          refreshUiFields();
          flushUi();
        },

        requestSaveGameLoad,

        clearPendingRestore() {
          pendingRestore = null;
        },
      });
    },

    onLevelLoaded(context) {
      // The project (and therefore the slot namespace) exists by now, so the
      // store can be built and the menu seeded with what is actually saved.
      ensureStore();
      applyPendingRestore(context.levelPath);
      refreshUiFields();
      flushUi();
    },

    dispose() {
      pendingRestore = null;
      store = null;
      storeGameId = null;
      services = null;
    },
  };
}
