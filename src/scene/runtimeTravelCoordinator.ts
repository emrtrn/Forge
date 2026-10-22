import { ContentLoadError } from "@engine/assets/contentValidation";
import {
  beginLoading,
  finishTravel,
  initialLevelTravelState,
  requestTravel,
  type LevelTravelState,
} from "./levelTravel";

/**
 * Everything the travel coordinator needs from the runtime shell that it does
 * not own itself. Kept deliberately small (mirroring
 * {@link ./runtimeSaveCoordinator.RuntimeSaveCoordinatorDeps}): the coordinator
 * owns the travel state machine and the async travel loop; scene teardown/build,
 * the shared boot/travel loading overlay handoff and the pending-restore latch
 * (owned by the save coordinator) stay in {@link RuntimeSceneApp} and are reached
 * through these callbacks. The loading overlay is deliberately NOT moved here: it
 * is shared with the boot lifecycle (`loadActiveProjectScene` + per-phase
 * `setLoadingStatus`), so owning it in a travel-scoped module would force boot to
 * depend on travel. Keeping it in the shell preserves the one-way
 * shell → coordinator dependency direction.
 */
export interface RuntimeTravelCoordinatorDeps {
  /** Drops any pending save-restore so a portal/menu travel does not re-apply stale state. */
  clearPendingRestore(): void;
  /** Shows the loading overlay + resets the bar at the start of a travel cycle. */
  beginLoadingUi(status: string): void;
  /** Hides the loading overlay once a travel cycle settles with no more queued. */
  finishLoadingUi(): void;
  /** Surfaces a blocking load-error screen (with Retry) when a travel build throws. */
  showLoadError(message: string): void;
  /** Disposes the current scene so the rebuild starts from a clean slate. */
  teardownScene(): void;
  /** Builds the target level, respawning the player at `spawnTag` (or the default marker). */
  buildScene(layoutPath: string, spawnTag: string | undefined): Promise<void>;
}

/**
 * Owns Level Travel (P2) extracted from {@link RuntimeSceneApp} (P2.2): the
 * {@link LevelTravelState} machine and the async travel loop that tears the
 * current scene down, loads the target and processes any request that queued up
 * while loading. `levelTravel.ts` stays the pure state machine; this coordinator
 * drives it against the live scene through {@link RuntimeTravelCoordinatorDeps}.
 * Behaviour is unchanged from the in-shell version — a boundary extraction, not a
 * redesign.
 */
export class RuntimeTravelCoordinator {
  /** Level Travel (P2) state machine: idle unless a portal/menu requested travel. */
  private travelState: LevelTravelState = initialLevelTravelState();

  constructor(private readonly deps: RuntimeTravelCoordinatorDeps) {}

  /**
   * Requests Level Travel (P2) to another layout, respawning the player at the
   * `spawnTag` Player Start there (or the default marker). Safe to call from a
   * behavior tick (a portal trigger) or the menu: the state machine serializes
   * requests — a second one arriving mid-travel is held (latest wins) and runs
   * when the current cycle settles — and the teardown is deferred past the frame.
   * A direct portal/menu travel supersedes any save-load in flight, so the
   * pending restore is cleared first.
   */
  requestLevelTravel(layoutPath: string, spawnTag?: string): void {
    this.deps.clearPendingRestore();
    this.enqueueLevelTravel(layoutPath, spawnTag);
  }

  /**
   * Queues a travel request without clearing the pending save-restore latch. Used
   * both by {@link requestLevelTravel} (after it clears the latch) and by the save
   * coordinator's load path (which sets the latch, then travels to the saved level).
   */
  enqueueLevelTravel(layoutPath: string, spawnTag?: string): void {
    const request = spawnTag !== undefined ? { layoutPath, spawnTag } : { layoutPath };
    const { state, begin } = requestTravel(this.travelState, request);
    this.travelState = state;
    // `begin` is true only when the machine was idle, i.e. no runTravel loop is
    // running; a request arriving mid-travel is queued and picked up by the loop.
    if (begin) void this.runTravel();
  }

  /**
   * Drives one or more queued travel cycles: tear the current scene down, load the
   * target, then process any request that queued up while loading. Yields once
   * before the first teardown so a travel requested from inside the engine update
   * (portal contact) doesn't mutate the scene mid-tick; teardown then runs between
   * frames with the subsystems already emptied, so the loop ticks nothing until
   * the rebuild re-feeds them.
   */
  private async runTravel(): Promise<void> {
    await Promise.resolve();
    while (this.travelState.active) {
      const request = this.travelState.active;
      // Show the loading overlay for the whole travel (P4.4); a minimum on-screen
      // time keeps a fast (cached) transition from flashing it for a single frame.
      this.deps.beginLoadingUi("Loading level");
      const shownAtMs = typeof performance !== "undefined" ? performance.now() : 0;
      this.deps.teardownScene();
      this.travelState = beginLoading(this.travelState);
      let failed = false;
      try {
        await this.deps.buildScene(request.layoutPath, request.spawnTag);
      } catch (error) {
        console.error("[runtime] level travel failed:", request.layoutPath, error);
        failed = true;
        this.deps.showLoadError(error instanceof ContentLoadError
          ? `Failed to load the level. ${error.message}`
          : "Failed to load the level.");
      }
      this.travelState = finishTravel(this.travelState).state;
      // Hold + hide only once no further travel is queued (a queued request re-shows
      // it, so hiding between cycles would flicker); leave the error screen up.
      if (!this.travelState.active && !failed) {
        await this.holdLoadingMinimum(shownAtMs);
        this.deps.finishLoadingUi();
      }
    }
  }

  /** Waits until the loading overlay has been visible for at least `minMs` (anti-flicker). */
  private async holdLoadingMinimum(shownAtMs: number, minMs = 300): Promise<void> {
    if (typeof performance === "undefined") return;
    const remaining = minMs - (performance.now() - shownAtMs);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
