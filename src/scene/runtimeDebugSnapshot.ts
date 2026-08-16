/**
 * Side-effect-free `?debug` overlay snapshot builders extracted from
 * {@link RuntimeSceneApp} (P2.5). Each function assembles one overlay readout
 * from already-resolved inputs (values + a few lookup callbacks); none of them
 * touch a subsystem, the renderer or the DOM directly, so the null-branching and
 * default-fallback logic is unit-testable in isolation. The snapshot *shapes*
 * stay defined on {@link RuntimeSceneApp} (their `debugStats.ts` formatter
 * consumers import them from there) and are referenced here type-only, so this
 * module carries no runtime import and cannot widen the game bundle.
 *
 * Only the readouts with real resolution logic moved here; the one-line
 * subsystem delegations (`getRenderStats`, `getVfxDebugSnapshot`, etc.) stay in
 * the shell where they add no branching worth extracting.
 */
import type { RenderMemoryStats } from "@engine/render-three/renderer";
import type { UiFieldValue } from "@engine/ui/uiViewModel";
import type { InputMode } from "@/game/gameModes/types";
import type { LocomotionInput } from "@engine/movement/locomotionAnimation";
import type { WorldUiDebugSnapshot } from "@/ui/WorldUiSubsystem";
import type {
  GameModeDebugSnapshot,
  PerfMemorySnapshot,
  UiDebugSnapshot,
} from "./RuntimeSceneApp";

/** Reads the browser's Chrome-only `performance.memory` heap counters, guarded. */
function readJsHeap(): { used: number | null; limit: number | null } {
  const perfMemory =
    typeof performance !== "undefined"
      ? (performance as { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory
      : undefined;
  return {
    used: typeof perfMemory?.usedJSHeapSize === "number" ? perfMemory.usedJSHeapSize : null,
    limit: typeof perfMemory?.jsHeapSizeLimit === "number" ? perfMemory.jsHeapSizeLimit : null,
  };
}

/**
 * Builds the memory readout: GPU resource counts (always) plus the JS heap when
 * the browser exposes `performance.memory` (Chrome-only, guarded).
 */
export function buildPerfMemorySnapshot(renderMemory: RenderMemoryStats): PerfMemorySnapshot {
  const heap = readJsHeap();
  return { render: renderMemory, jsHeapBytes: heap.used, jsHeapLimitBytes: heap.limit };
}

/** Camera-rotation debug values the active Game Mode may expose (all optional). */
export interface CameraDebugValues {
  controlYawDeg: number | null;
  controlPitchDeg: number | null;
  cameraSource: string | null;
}

/**
 * Inputs for {@link buildGameModeDebugSnapshot}. Subsystem access stays in the
 * shell behind these lookups; the builder owns the "null unless a pawn is
 * possessed" branching so it can be exercised without a live scene.
 */
export interface GameModeDebugInputs {
  /** Active Game Mode display name, or null before one resolves (→ "—"). */
  activeGameModeName: string | null;
  /** Possessed pawn entity id, or null when nothing is possessed. */
  possessed: string | null;
  /** Current runtime input mode. */
  inputMode: InputMode;
  /** Camera-rotation debug values, when the active mode owns control rotation. */
  cameraDebug: CameraDebugValues | null | undefined;
  /** Latest locomotion report for a possessed pawn, or undefined when none yet. */
  locomotionReportOf(entityId: string): LocomotionInput | undefined;
  /** Authored CharacterMovement mode of a possessed pawn, or null. */
  movementModeOf(entityId: string): string | null;
  /** World position of a possessed pawn, or null when it has no transform. */
  positionOf(entityId: string): readonly [number, number, number] | null;
}

/**
 * Builds the Game Mode readout: which mode is active, what it possessed, and the
 * possessed pawn's movement state (mode + grounded + velocity + position). Fields
 * are null when nothing is possessed or the pawn has not reported locomotion yet.
 */
export function buildGameModeDebugSnapshot(inputs: GameModeDebugInputs): GameModeDebugSnapshot {
  const { possessed } = inputs;
  const report = possessed ? inputs.locomotionReportOf(possessed) : undefined;
  return {
    gameMode: inputs.activeGameModeName ?? "—",
    possessed,
    movementMode: possessed ? inputs.movementModeOf(possessed) : null,
    grounded: report ? report.grounded : null,
    velocityY: report ? report.velocityY : null,
    planarSpeed: report ? report.planarSpeed : null,
    position: possessed ? inputs.positionOf(possessed) : null,
    controlYawDeg: inputs.cameraDebug?.controlYawDeg ?? null,
    controlPitchDeg: inputs.cameraDebug?.controlPitchDeg ?? null,
    cameraSource: inputs.cameraDebug?.cameraSource ?? null,
    inputMode: inputs.inputMode,
  };
}

/** The subset of the runtime UI host readout the snapshot needs (structural). */
export interface UiHostDebugLayers {
  hud: string | null;
  screens: string[];
  audit: string[];
}

/** Inputs for {@link buildUiDebugSnapshot}; `host` is null before the UI boots. */
export interface UiDebugInputs {
  host: UiHostDebugLayers | null;
  fields: Array<[string, UiFieldValue]>;
  locale: string | null;
  world: WorldUiDebugSnapshot;
}

/**
 * Builds the UI-host readout: the mounted HUD, active screen stack and the
 * ViewModel store fields the widgets bind to. Returns empty layers before the UI
 * subsystem boots.
 */
export function buildUiDebugSnapshot(inputs: UiDebugInputs): UiDebugSnapshot {
  const host = inputs.host ?? { hud: null, screens: [], audit: [] };
  return {
    hud: host.hud,
    screens: host.screens,
    fields: inputs.fields,
    locale: inputs.locale,
    audit: host.audit,
    world: inputs.world,
  };
}
