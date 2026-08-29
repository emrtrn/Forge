/**
 * The visible `?debug` surface: a control strip over the perf readout, plus the
 * table modal the diagnostic tables open in.
 *
 * Why it exists at all: the readout was something you *read*. This is the shell
 * that makes it something you *use* — a place to put an action that measures on
 * demand, and a table to show the result in.
 *
 * Three placement rules, each with a reason:
 *
 *  - **Not under `src/editor/`.** `?debug` works on the runtime route as well,
 *    and the editor has to stay behind its own `?editor` dynamic import.
 *  - **Not in the base game bundle either.** This module and the modal it pulls
 *    in are loaded through `await import()` behind `?debug`, exactly as the
 *    editor is behind `?editor`, so a shipped game carries none of it.
 *  - **The controls sit above the readout**, because the readout grows and
 *    shrinks by several lines as the scene changes, and a button that moves
 *    while you are aiming at it is a button you misclick.
 *
 * The panel takes over the existing `#debug-stats` element rather than adding a
 * sibling: that element already carries the runtime and editor CSS that places a
 * viewport overlay correctly, and the editor reparents it into the viewport host
 * by id. Taking it over keeps all of that working and gives the readout a `<pre>`
 * of its own inside.
 */
import type { DebugTableView } from "@engine/perf/debugTableView";
import { buildFrameCapture, frameCaptureTableView } from "@engine/perf/frameCapture";
import { gpuSweepTableView, gpuSweepUnavailableView } from "@engine/perf/gpuSweep";

import { attachDebugStats } from "./debugStats";
import { DebugSpeedControl } from "./debugSpeedControl";
import { DebugTableModal } from "./debugTableModal";
import type { RuntimeStatsApp } from "./RuntimeSceneApp";

/** One button in the control strip. */
export interface DebugPanelAction {
  /** Stable id, also the `data-forge-debug-action` hook a smoke test drives. */
  readonly id: string;
  readonly label: string;
  /** Title text: what it measures, and what it costs to run. */
  readonly hint: string;
  readonly run: () => void;
}

export interface DebugPanelOptions {
  /** Actions to place in the strip, left to right. */
  readonly actions?: readonly DebugPanelAction[];
  /** Where the modal mounts; defaults to `#ui-overlay`, else `<body>`. */
  readonly modalHost?: HTMLElement;
}

export class DebugPanel {
  private readonly controls = document.createElement("div");
  /**
   * Reserved for a persistent control (the speed picker, F4), so an action
   * button added later cannot end up in front of it.
   */
  private readonly controlSlot = document.createElement("div");
  private readonly readout = document.createElement("pre");
  private readonly modal: DebugTableModal;

  constructor(
    /** The existing `#debug-stats` element, which becomes the panel root. */
    private readonly root: HTMLElement,
    options: DebugPanelOptions = {},
  ) {
    this.root.classList.add("forge-debug-panel");
    this.controls.className = "forge-debug-panel-controls ui-interactive";
    this.controlSlot.className = "forge-debug-panel-control-slot";
    this.controls.appendChild(this.controlSlot);
    this.readout.className = "forge-debug-panel-readout";
    this.root.replaceChildren(this.controls, this.readout);
    for (const action of options.actions ?? []) this.addAction(action);
    this.modal = new DebugTableModal({
      ...(options.modalHost ? { host: options.modalHost } : {}),
    });
  }

  /** The element the perf readout is written into. */
  get readoutElement(): HTMLElement {
    return this.readout;
  }

  get table(): DebugTableModal {
    return this.modal;
  }

  addAction(action: DebugPanelAction): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "forge-debug-panel-button";
    button.dataset.forgeDebugAction = action.id;
    button.textContent = action.label;
    button.title = action.hint;
    button.addEventListener("click", () => action.run());
    this.controls.appendChild(button);
  }

  /** Mounts a persistent control into the reserved slot (kept leftmost). */
  mountControl(control: { mount(parent: HTMLElement): void }): void {
    control.mount(this.controlSlot);
  }

  showTable(view: DebugTableView): void {
    this.modal.show(view);
  }

  dispose(): void {
    this.modal.dispose();
    this.root.replaceChildren();
    this.root.classList.remove("forge-debug-panel");
  }
}

/**
 * Mounts the panel over `#debug-stats` and starts the readout.
 *
 * Returns the panel so the host can add actions and open tables. Called from
 * `main.ts` behind a dynamic import, and from the editor's Show > Stats toggle —
 * the same flag governs the whole panel, not only the text, or the buttons would
 * hang in an empty corner with the readout switched off.
 */
export function attachDebugPanel(
  app: RuntimeStatsApp,
  element: HTMLElement,
  options: DebugPanelOptions = {},
): DebugPanel {
  const panel = new DebugPanel(element, options);
  attachDebugStats(app, panel.readoutElement);
  // Into the reserved slot, so it stays leftmost however many actions arrive
  // later. A state you leave set does not belong among buttons you fire.
  const time = app.getTimeControl?.();
  if (time) panel.mountControl(new DebugSpeedControl(time));
  // Offered only where something is actually profiling. A button that opens
  // an empty table teaches the reader that the instrument is broken, which is
  // worse than not offering it: the editor shell profiles nothing today, and
  // simply has no frame-cost button.
  if (app.armFrameCapture) {
    panel.addAction({
      id: "frame-cost",
      label: "Frame cost",
      hint: "Measure the next frame and break it down: every region, its share of that frame, its rolling average and peak, and what is left unmeasured",
      run: () => {
        // Armed, not taken here: a capture made inside this click handler
        // would describe a frame that was already half over, with the click
        // handler in it.
        app.armFrameCapture?.((captured, context) =>
          panel.showTable(frameCaptureTableView(buildFrameCapture(captured, context))),
        );
      },
    });
  }
  if (app.startGpuSweep) {
    panel.addAction({
      id: "gpu-sweep",
      label: "GPU sweep",
      hint: "Turn each content category off in turn and measure what it gives back. Holds the scene still and takes several seconds.",
      run: () => {
        app.startGpuSweep?.((outcome) => {
          if (outcome.kind === "done") panel.showTable(gpuSweepTableView(outcome.sweep));
          else if (outcome.kind === "failed") {
            panel.showTable(gpuSweepUnavailableView(outcome.reason));
          }
        });
      },
    });
  }
  return panel;
}
