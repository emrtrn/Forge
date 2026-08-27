/**
 * The template's gameplay-rules runtime: the authored `worldSettings.gameRules`
 * turned into a live round.
 *
 * This is Layer 3 — score, objectives, the round timer, the win/loss screen and
 * the restart button are game rules, not platform behavior — so it lives here
 * and is driven by the game module's hooks rather than by the runtime shell. It
 * reaches the world only through runtime services: the script-message bus for
 * content-emitted `game-event`s, the UI ViewModel for the `game.*` fields a HUD
 * binds to, and the UI presenter for the outcome screen. Every one of them is
 * optional, so a level with no rules (or a runtime with the UI capability off)
 * simply plays on.
 */
import type { RuntimeContext } from "@/scene/capabilities/RuntimeContext";
import type { RuntimeServices } from "@/scene/capabilities/RuntimeServices";
import {
  scriptMessageBusService,
  uiPresenterService,
  uiViewModelService,
} from "@/scene/capabilities/runtimeServiceKeys";
import { GameStateStore, normalizeGameRules, parseGameEvent, type GamePhase } from "./gameRules";

export interface GameRulesRuntime {
  /** Builds the round for a freshly loaded level (no-op when it authors none). */
  levelLoaded(context: RuntimeContext): void;
  /** Advances the round and mirrors its fields into the HUD. */
  update(deltaSeconds: number): void;
  /** Claims the reserved `game:*` widget messages; false leaves them to the chain. */
  handleUiMessage(message: string): boolean;
  /** Drops the round (Level Travel teardown or shutdown). */
  reset(): void;
}

export function createGameRulesRuntime(services: RuntimeServices): GameRulesRuntime {
  let store: GameStateStore | null = null;
  let unsubscribe: (() => void) | null = null;
  /** True once the win/loss screen for the current terminal round has been pushed. */
  let outcomeShown = false;

  const writeHudFields = (): void => {
    const uiStore = services.resolve(uiViewModelService);
    if (!store || !uiStore) return;
    for (const [path, value] of Object.entries(store.hudFields())) {
      uiStore.setField(path, value);
    }
  };

  const showOutcome = (phase: GamePhase): void => {
    services.resolve(uiPresenterService)?.showOutcomeScreen(phase === "won" ? "won" : "lost");
  };

  /**
   * Resets the round in place: authored initial state back, any open screen
   * closed (resuming gameplay), and a `game-restart` script message broadcast so
   * content can reset itself (respawn pickups, move the player home). A full
   * world reset is the game's own job — the rules own only the rules state.
   */
  const restart = (): void => {
    if (!store) return;
    store.dispatch({ kind: "restart" });
    outcomeShown = false;
    services.resolve(uiPresenterService)?.clearScreens();
    services.resolve(scriptMessageBusService)?.emit("game-restart", "game", {});
  };

  return {
    levelLoaded(context) {
      const rules = normalizeGameRules(context.layout.worldSettings?.gameRules);
      if (!rules) return;
      store = new GameStateStore(rules);
      outcomeShown = false;
      // Bridge content-emitted `game-event` script messages into the store, so
      // triggers and actor scripts drive score/objectives/win/lose without the
      // engine knowing a single project rule.
      unsubscribe =
        services.resolve(scriptMessageBusService)?.subscribe("game-event", (envelope) => {
          const event = parseGameEvent(envelope.payload);
          if (event) store?.dispatch(event);
        }) ?? null;
      // Seed the bound fields so the HUD's first render shows authored values.
      writeHudFields();
    },

    update(deltaSeconds) {
      if (!store) return;
      // The round freezes while any screen (pause or outcome) is open, so
      // pausing genuinely pauses the timer.
      const paused = (services.resolve(uiPresenterService)?.screenDepth() ?? 0) > 0;
      if (!paused) store.tick(deltaSeconds);
      writeHudFields();
      if (!outcomeShown && store.phase !== "playing") {
        outcomeShown = true;
        showOutcome(store.phase);
      }
    },

    handleUiMessage(message) {
      switch (message) {
        case "game:restart":
          restart();
          return true;
        case "game:resume":
          services.resolve(uiPresenterService)?.clearScreens();
          return true;
        default:
          return false;
      }
    },

    reset() {
      unsubscribe?.();
      unsubscribe = null;
      store = null;
      outcomeShown = false;
    },
  };
}
