/**
 * Vehicle Asset Editor — the form-based authoring shell for `*.vehicle.json`
 * (vehicle plan Faz 5), opened from the Content Browser (double-click). Behind
 * the editor's dynamic import like the other asset editors, so nothing here
 * ships in the game bundle.
 *
 * Built on the VFX Lite editor's shell (`pfx-*` layout classes) with a wider
 * Details column (`vhe-window`):
 *   - **Sections** (left) — Chassis, Driving, Steering, Wheels, Drivetrain,
 *     Aerodynamics, Engine Sound; clicking one scrolls its Details group in.
 *     Below: diagnostics (`vehicleDiagnostics`).
 *   - **Overview** (center) — the top-view wheel schematic (click a wheel to
 *     edit it), the torque/power graph and the per-gear top-speed table, all
 *     live off the edited definition (`vehicleAssetEditorModel.ts`).
 *   - **Details** (right) — the grouped forms; wheels as one collapsible card
 *     each, curves and the gear list as editable tables.
 *
 * The edited {@link VehicleDefinition} is exactly what Save writes (through
 * `normalizeVehicleAsset` on both ends). Undo/redo is a snapshot history of the
 * definition — one entry per field-edit session or structural change.
 */
import {
  normalizeVehicleDefinition,
  STEER_GAMMA_RANGE,
  type VehicleDefinition,
  type VehicleWheelDefinition,
} from "@engine/physics/vehicle/vehicleTypes";
import { loadVehicleAssetForEditor, saveVehicleAsset } from "@/editor/vehicleAssetStore";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import {
  drivenWheels,
  enginePeaks,
  gearTopSpeedsKmh,
  torqueCurveSvg,
  vehicleDiagnostics,
  vehicleTopViewSvg,
} from "@/editor/vehicleAssetEditorModel";

type StatusTone = "info" | "success" | "warning" | "error";

export interface VehicleAssetEditorAsset {
  id: string;
  name: string;
  assetType: string;
  path: string;
}

export interface VehicleAssetEditorOptions {
  path: string;
  label: string;
  /** Project assets (the engine sound picker lists `sound` + `soundCue`). */
  assets?: VehicleAssetEditorAsset[];
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

interface SectionMeta { id: string; label: string; icon: string; hint: string }

const SECTIONS: readonly SectionMeta[] = [
  { id: "chassis", label: "Chassis", icon: "CHS", hint: "Mass, centre of mass" },
  { id: "driving", label: "Driving", icon: "DRV", hint: "Engine, brake, reverse forces" },
  { id: "steering", label: "Steering", icon: "STR", hint: "Lock, speed, speed curve" },
  { id: "wheels", label: "Wheels", icon: "WHL", hint: "Hard points, suspension, tyres" },
  { id: "drivetrain", label: "Drivetrain", icon: "GBX", hint: "Torque curve, gears, diff" },
  { id: "aero", label: "Aerodynamics", icon: "AER", hint: "Drag, downforce" },
  { id: "sound", label: "Engine Sound", icon: "SND", hint: "Loop, pitch, volume" },
];

const DRIVE_TYPES = ["FWD", "RWD", "AWD"] as const;
const AXLES = ["front", "rear"] as const;
/** Mirrors the normalizer: more forward gears than this are dropped on save. */
const MAX_GEARS = 12;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone(def: VehicleDefinition): VehicleDefinition {
  return JSON.parse(JSON.stringify(def)) as VehicleDefinition;
}

function copyWheel(wheel: VehicleWheelDefinition, position: [number, number, number]): VehicleWheelDefinition {
  return { ...(JSON.parse(JSON.stringify(wheel)) as VehicleWheelDefinition), position };
}

function equal(a: VehicleDefinition, b: VehicleDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Walks a dotted path (numeric segments = array indices) and sets the leaf. */
function setPath(root: unknown, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    node = node[parts[i]!] as Record<string, unknown>;
    if (node === null || typeof node !== "object") return;
  }
  node[parts[parts.length - 1]!] = value;
}

/** The editable (mutable) view of the definition the form writes into. */
type Draft = {
  -readonly [K in keyof VehicleDefinition]: VehicleDefinition[K] extends readonly (infer T)[] ? T[] : VehicleDefinition[K];
};

export class VehicleAssetEditor {
  private static activeInstance: VehicleAssetEditor | null = null;

  static async open(options: VehicleAssetEditorOptions): Promise<VehicleAssetEditor> {
    VehicleAssetEditor.activeInstance?.close();
    const editor = new VehicleAssetEditor(options);
    VehicleAssetEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly stackHost: HTMLElement;
  private readonly diagHost: HTMLElement;
  private readonly overviewHost: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;

  private def: VehicleDefinition = normalizeVehicleDefinition({})!;
  private path: string;
  private label: string;
  private selectedWheel = 0;
  private readonly undoStack: VehicleDefinition[] = [];
  private readonly redoStack: VehicleDefinition[] = [];
  private commitBaseline: VehicleDefinition | null = null;
  private dirty = false;
  private disposed = false;

  private constructor(private readonly options: VehicleAssetEditorOptions) {
    this.path = options.path;
    this.label = options.label;

    this.overlay = document.createElement("div");
    this.overlay.className = "pfx-overlay";
    this.overlay.dataset.vehicleEditor = "";
    this.overlay.innerHTML = `
<div class="pfx-window vhe-window">
  <header class="pfx-header">
    <span class="pfx-tab">
      <span class="pfx-tab-icon">VEH</span>
      <strong data-vhe-title></strong>
      <span class="pfx-badge">Vehicle</span>
    </span>
    <div class="pfx-toolbar"></div>
    <div class="pfx-header-actions">
      <button type="button" class="pfx-tool-btn" data-vhe-duplicate title="Save a copy next to this asset">Duplicate</button>
      <button type="button" class="pfx-save" data-vhe-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="pfx-close" data-vhe-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="pfx-body">
    <aside class="pfx-left">
      <div class="pfx-section-title">Sections</div>
      <div class="pfx-stack" data-vhe-stack></div>
      <div class="pfx-section-title">Diagnostics</div>
      <div class="pfx-diag" data-vhe-diag></div>
    </aside>
    <div class="vhe-overview" data-vhe-overview></div>
    <aside class="pfx-details" data-vhe-details></aside>
  </div>
  <footer class="pfx-status" data-vhe-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-vhe-title]");
    this.stackHost = this.req("[data-vhe-stack]");
    this.diagHost = this.req("[data-vhe-diag]");
    this.overviewHost = this.req("[data-vhe-overview]");
    this.detailsHost = this.req("[data-vhe-details]");
    this.statusEl = this.req("[data-vhe-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-vhe-save]");

    this.req<HTMLButtonElement>("[data-vhe-close]").addEventListener("click", () => this.requestClose());
    this.saveBtn.addEventListener("click", () => void this.save());
    this.req<HTMLButtonElement>("[data-vhe-duplicate]").addEventListener("click", () => void this.duplicate());
    this.overviewHost.addEventListener("click", (event) => {
      const wheel = (event.target as Element).closest<SVGElement>("[data-vhe-wheel]");
      if (wheel) this.selectWheel(Number(wheel.dataset.vheWheel), true);
    });

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.overlay.focus();
    this.renderStack();
  }

  private req<T extends Element = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`VehicleAssetEditor: missing ${selector}`);
    return el;
  }

  // ─── Load / lifecycle ──────────────────────────────────────────────────────

  private async load(): Promise<void> {
    try {
      const loaded = await loadVehicleAssetForEditor(this.path);
      if (this.disposed) return;
      this.def = loaded.definition;
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this.dirty = false;
      this.renderAll();
      if (loaded.readable) this.setStatus("Ready.");
      else this.setStatus("The asset could not be read; editing the reference car. Save writes it here.", "warning");
    } catch (error) {
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  private renderAll(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.label;
    this.saveBtn.classList.toggle("is-dirty", this.dirty);
    this.selectedWheel = Math.min(this.selectedWheel, Math.max(0, this.def.wheels.length - 1));
    this.renderOverview();
    this.renderDetails();
    this.renderDiagnostics();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      event.preventDefault();
      this.requestClose();
    } else if (ctrl && key === "s") {
      event.preventDefault();
      void this.save();
    } else if (ctrl && key === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (ctrl && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      this.redo();
    }
  }

  // ─── Left stack + diagnostics ──────────────────────────────────────────────

  private renderStack(): void {
    this.stackHost.replaceChildren();
    for (const section of SECTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pfx-stage";
      btn.dataset.stage = section.id;
      btn.innerHTML = `
        <span class="pfx-stage-icon">${esc(section.icon)}</span>
        <span class="pfx-stage-text"><strong>${esc(section.label)}</strong><em>${esc(section.hint)}</em></span>`;
      btn.addEventListener("click", () => this.focusSection(section.id));
      this.stackHost.append(btn);
    }
  }

  private focusSection(id: string): void {
    const group = this.detailsHost.querySelector<HTMLElement>(`[data-group="${id}"]`);
    group?.scrollIntoView({ behavior: "smooth", block: "start" });
    for (const btn of this.stackHost.querySelectorAll<HTMLElement>(".pfx-stage")) {
      btn.classList.toggle("is-active", btn.dataset.stage === id);
    }
    group?.classList.add("is-flash");
    window.setTimeout(() => group?.classList.remove("is-flash"), 600);
  }

  private renderDiagnostics(): void {
    const issues = vehicleDiagnostics(this.def);
    this.diagHost.innerHTML = issues.length === 0
      ? `<div class="pfx-ok">No problems found.</div>`
      : issues.map((issue) => `<div class="pfx-issue">${esc(issue)}</div>`).join("");
  }

  // ─── Overview (center) ─────────────────────────────────────────────────────

  private renderOverview(): void {
    const def = this.def;
    const drivetrain = def.drivetrain;
    const driven = drivenWheels(def).length;
    const summary = [
      `${def.wheels.length} wheels`,
      `${driven} driven`,
      `${Math.round(def.massKg)} kg`,
      drivetrain ? drivetrain.differential.driveType : "flat force",
    ].join(" · ");
    let drivetrainHtml = `<p class="vhe-note">No drivetrain: the car pushes with a flat ${Math.round(def.maxEngineForce)} N on its Drive wheels. Enable it in Details for torque, RPM and gears.</p>`;
    if (drivetrain) {
      const peaks = enginePeaks(drivetrain);
      const speeds = gearTopSpeedsKmh(def);
      const rows = drivetrain.transmission.forwardRatios.map((ratio, index) =>
        `<tr><td>${index + 1}</td><td>${ratio}</td><td>${speeds[index] !== undefined ? Math.round(speeds[index]!) : "—"} km/h</td></tr>`).join("");
      drivetrainHtml = `
        <div class="vhe-card">
          <div class="vhe-card-title">Torque &amp; power <small>${Math.round(peaks.torqueNm)} N·m @ ${Math.round(peaks.torqueRpm)} · ${Math.round(peaks.powerKw)} kW @ ${Math.round(peaks.powerRpm)}</small></div>
          ${torqueCurveSvg(drivetrain)}
          <div class="vhe-legend"><span class="vhe-key-torque">torque</span><span class="vhe-key-power">power</span><span class="vhe-key-up">upshift</span><span class="vhe-key-down">downshift</span></div>
        </div>
        <div class="vhe-card">
          <div class="vhe-card-title">Gears <small>top speed at ${Math.round(drivetrain.engine.maxRpm)} rpm, final ${drivetrain.transmission.finalDriveRatio.toFixed(2)}</small></div>
          <table class="vhe-table" data-vhe-gear-speeds><thead><tr><th>Gear</th><th>Ratio</th><th>Top speed</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    }
    this.overviewHost.innerHTML = `
      <div class="vhe-card">
        <div class="vhe-card-title">Layout <small>${esc(summary)}</small></div>
        ${vehicleTopViewSvg(def, this.selectedWheel)}
        <div class="vhe-legend"><span class="vhe-key-steer">steers</span><span class="vhe-key-driven">driven</span><span class="vhe-key-hb">handbrake</span><span class="vhe-key-com">centre of mass</span></div>
      </div>
      ${drivetrainHtml}`;
  }

  // ─── Details form ──────────────────────────────────────────────────────────

  private renderDetails(): void {
    const d = this.def;
    const html: string[] = [];

    html.push(this.groupOpen("chassis", "Chassis"));
    html.push(this.numRow("Mass (kg)", "massKg", d.massKg, 1, 100000, 10));
    html.push(this.vec3Row("Centre of Mass", "centerOfMassOffset", d.centerOfMassOffset, 0.05));
    html.push(this.groupClose());

    html.push(this.groupOpen("driving", "Driving"));
    html.push(this.numRow(d.drivetrain ? "Force Cap (N)" : "Engine Force (N)", "maxEngineForce", d.maxEngineForce, 0, 1e6, 100));
    html.push(this.numRow("Reverse Force (N)", "maxReverseForce", d.maxReverseForce, 0, 1e6, 100));
    html.push(this.numRow("Brake Force (N)", "maxBrakeForce", d.maxBrakeForce, 0, 1e6, 10));
    html.push(this.numRow("Handbrake (N)", "handbrakeForce", d.handbrakeForce, 0, 1e6, 10));
    html.push(this.numRow("Rolling Resist. (N)", "rollingResistanceForce", d.rollingResistanceForce, 0, 1e5, 1));
    html.push(this.numRow("Reverse Below (m/s)", "reverseSpeedThreshold", d.reverseSpeedThreshold, 0, 50, 0.1));
    html.push(this.groupClose());

    html.push(this.groupOpen("steering", "Steering"));
    html.push(this.numRow("Max Steer (°)", "maxSteerAngleDeg", d.maxSteerAngleDeg, 0, 80, 1));
    html.push(this.numRow("Steer Speed", "steerSpeed", d.steerSpeed, 0.1, 50, 0.1));
    html.push(this.numRow("Return Speed (0 = Steer)", "steerReturnSpeed", d.steerReturnSpeed, 0, 50, 0.1));
    html.push(this.numRow("Steer Gamma", "steerGamma", d.steerGamma, STEER_GAMMA_RANGE[0], STEER_GAMMA_RANGE[1], 0.1));
    html.push(this.numRow("Handbrake Grip ×", "handbrakeSideFrictionMultiplier", d.handbrakeSideFrictionMultiplier, 0, 1, 0.05));
    html.push(this.tableBlock(
      "Lock over speed",
      ["Speed (m/s)", "Lock ×"],
      d.steeringSpeedCurve.map((point, index) => [
        this.cellNum(`steeringSpeedCurve.${index}.speedMps`, point.speedMps, 0, 500, 1),
        this.cellNum(`steeringSpeedCurve.${index}.scale`, point.scale, 0, 1, 0.05),
      ]),
      "steer",
    ));
    html.push(this.tableBlock(
      "Steer speed over speed",
      ["Speed (m/s)", "Rate ×"],
      d.steerRateCurve.map((point, index) => [
        this.cellNum(`steerRateCurve.${index}.speedMps`, point.speedMps, 0, 500, 1),
        this.cellNum(`steerRateCurve.${index}.scale`, point.scale, 0.01, 4, 0.05),
      ]),
      "steer-rate",
    ));
    html.push(this.groupClose());

    html.push(this.groupOpen("wheels", "Wheels"));
    d.wheels.forEach((wheel, index) => html.push(this.wheelCard(wheel, index)));
    html.push(`<div class="vhe-actions"><button type="button" class="pfx-tool-btn" data-vhe-op="add-wheel">+ Wheel</button></div>`);
    html.push(this.groupClose());

    html.push(this.groupOpen("drivetrain", "Drivetrain"));
    html.push(this.toggleRow("Enabled", "drivetrain", d.drivetrain !== null));
    const drivetrain = d.drivetrain;
    if (drivetrain) {
      html.push(this.enumRow("Drive", "drivetrain.differential.driveType", drivetrain.differential.driveType, DRIVE_TYPES));
      if (drivetrain.differential.driveType === "AWD") {
        html.push(this.numRow("Front Share", "drivetrain.differential.frontTorqueShare", drivetrain.differential.frontTorqueShare, 0, 1, 0.05));
      }
      html.push(this.numRow("Idle RPM", "drivetrain.engine.idleRpm", drivetrain.engine.idleRpm, 100, 20000, 50));
      html.push(this.numRow("Max RPM", "drivetrain.engine.maxRpm", drivetrain.engine.maxRpm, 200, 30000, 50));
      html.push(this.numRow("Engine Brake (N·m)", "drivetrain.engine.engineBrakeTorqueNm", drivetrain.engine.engineBrakeTorqueNm, 0, 5000, 5));
      html.push(this.tableBlock(
        "Torque curve",
        ["RPM", "Torque (N·m)"],
        drivetrain.engine.torqueCurve.map((point, index) => [
          this.cellNum(`drivetrain.engine.torqueCurve.${index}.rpm`, point.rpm, 0, 30000, 100),
          this.cellNum(`drivetrain.engine.torqueCurve.${index}.torqueNm`, point.torqueNm, 0, 100000, 5),
        ]),
        "torque",
      ));
      html.push(this.tableBlock(
        "Forward gears",
        ["Gear", "Ratio"],
        drivetrain.transmission.forwardRatios.map((ratio, index) => [
          `<span class="vhe-cell-label">${index + 1}</span>`,
          this.cellNum(`drivetrain.transmission.forwardRatios.${index}`, ratio, 0.01, 20, 0.05),
        ]),
        "gear",
      ));
      html.push(this.numRow("Reverse Ratio", "drivetrain.transmission.reverseRatio", drivetrain.transmission.reverseRatio, 0.01, 20, 0.05));
      html.push(this.numRow("Final Drive", "drivetrain.transmission.finalDriveRatio", drivetrain.transmission.finalDriveRatio, 0.01, 20, 0.05));
      html.push(this.numRow("Efficiency", "drivetrain.transmission.efficiency", drivetrain.transmission.efficiency, 0, 1, 0.01));
      html.push(this.numRow("Upshift RPM", "drivetrain.transmission.upshiftRpm", drivetrain.transmission.upshiftRpm, 100, 30000, 50));
      html.push(this.numRow("Downshift RPM", "drivetrain.transmission.downshiftRpm", drivetrain.transmission.downshiftRpm, 100, 30000, 50));
      html.push(this.numRow("Shift Time (s)", "drivetrain.transmission.shiftDurationSeconds", drivetrain.transmission.shiftDurationSeconds, 0, 5, 0.05));
    }
    html.push(this.groupClose());

    html.push(this.groupOpen("aero", "Aerodynamics"));
    html.push(this.numRow("Drag (kg/m)", "aerodynamics.dragCoefficient", d.aerodynamics.dragCoefficient, 0, 100, 0.01));
    html.push(this.numRow("Downforce (kg/m)", "aerodynamics.downforceCoefficient", d.aerodynamics.downforceCoefficient, 0, 100, 0.01));
    html.push(this.groupClose());

    html.push(this.groupOpen("sound", "Engine Sound"));
    html.push(this.toggleRow("Enabled", "engineSound", d.engineSound !== null));
    const sound = d.engineSound;
    if (sound) {
      html.push(this.soundRow(sound.sound));
      html.push(this.numRow("Idle Pitch", "engineSound.idlePitch", sound.idlePitch, 0.1, 4, 0.05));
      html.push(this.numRow("Max Pitch", "engineSound.maxPitch", sound.maxPitch, 0.1, 4, 0.05));
      html.push(this.numRow("Idle Volume", "engineSound.idleVolume", sound.idleVolume, 0, 1, 0.05));
      html.push(this.numRow("Load Volume", "engineSound.loadVolume", sound.loadVolume, 0, 1, 0.05));
      if (!d.drivetrain) {
        html.push(this.numRow("Max Pitch At (m/s)", "engineSound.speedForMaxPitch", sound.speedForMaxPitch, 0.1, 200, 1));
      }
      html.push(this.numRow("Ref Distance (m)", "engineSound.refDistance", sound.refDistance, 0.1, 1000, 0.5));
      html.push(this.numRow("Max Distance (m)", "engineSound.maxDistance", sound.maxDistance, 1, 5000, 1));
    }
    html.push(this.groupClose());

    this.detailsHost.innerHTML = html.join("");
    this.bindDetailInputs();
    // Re-rendering drops the focused control; keep focus in the window so
    // Ctrl+Z / Ctrl+S right after a checkbox or button still reach onKeyDown.
    if (!this.overlay.contains(document.activeElement)) this.overlay.focus({ preventScroll: true });
  }

  private wheelCard(wheel: VehicleWheelDefinition, index: number): string {
    const flags = [wheel.axle, wheel.steer ? "steer" : "", wheel.drive ? "drive" : "", wheel.handbrake ? "handbrake" : ""]
      .filter(Boolean).join(" · ");
    const base = `wheels.${index}`;
    const open = index === this.selectedWheel ? " open" : "";
    const selected = index === this.selectedWheel ? " is-selected" : "";
    return `
      <details class="vhe-wheel-card${selected}" data-vhe-wheel-card="${index}"${open}>
        <summary><strong>Wheel ${index + 1}</strong><span>${esc(flags)}</span></summary>
        <div class="vhe-wheel-body">
          ${this.textRow("Model Node", `${base}.visualNode`, wheel.visualNode ?? "", "generated wheel")}
          ${this.vec3Row("Hard Point", `${base}.position`, wheel.position, 0.01)}
          ${this.enumRow("Axle", `${base}.axle`, wheel.axle, AXLES)}
          ${this.numRow("Radius (m)", `${base}.radius`, wheel.radius, 0.01, 5, 0.01)}
          ${this.numRow("Width (m)", `${base}.width`, vehicleWheelWidth(wheel), 0.01, 5, 0.01)}
          ${this.numRow("Rest Length (m)", `${base}.suspensionRestLength`, wheel.suspensionRestLength, 0, 5, 0.01)}
          ${this.numRow("Max Travel (m)", `${base}.suspensionMaxTravel`, wheel.suspensionMaxTravel, 0, 5, 0.01)}
          ${this.numRow("Stiffness", `${base}.suspensionStiffness`, wheel.suspensionStiffness, 0.1, 1000, 1)}
          ${this.numRow("Compression", `${base}.suspensionCompression`, wheel.suspensionCompression, 0, 100, 0.1)}
          ${this.numRow("Relaxation", `${base}.suspensionRelaxation`, wheel.suspensionRelaxation, 0, 100, 0.1)}
          ${this.numRow("Max Force (N)", `${base}.maxSuspensionForce`, wheel.maxSuspensionForce, 1, 1e6, 100)}
          ${this.numRow("Grip", `${base}.frictionSlip`, wheel.frictionSlip, 0, 100, 0.1)}
          ${this.numRow("Side Grip", `${base}.sideFrictionStiffness`, wheel.sideFrictionStiffness, 0, 100, 0.05)}
          <div class="vhe-flags">
            ${this.flag("Steer", `${base}.steer`, wheel.steer)}
            ${this.flag("Drive", `${base}.drive`, wheel.drive)}
            ${this.flag("Brake", `${base}.brake`, wheel.brake)}
            ${this.flag("Handbrake", `${base}.handbrake`, wheel.handbrake)}
          </div>
          <div class="vhe-actions">
            <button type="button" class="pfx-tool-btn" data-vhe-op="mirror-wheel" data-vhe-index="${index}" title="Add the mirror image of this wheel on the other side">Mirror</button>
            <button type="button" class="pfx-tool-btn" data-vhe-op="remove-wheel" data-vhe-index="${index}">Remove</button>
          </div>
        </div>
      </details>`;
  }

  private groupOpen(id: string, label: string): string {
    return `<section class="pfx-group" data-group="${id}"><header class="pfx-group-head">${esc(label)}</header><div class="pfx-group-body">`;
  }

  private groupClose(): string {
    return `</div></section>`;
  }

  private row(label: string, inner: string): string {
    return `<label class="pfx-row"><span class="pfx-row-label">${esc(label)}</span>${inner}</label>`;
  }

  private numRow(label: string, path: string, value: number, min: number, max: number, step: number): string {
    return this.row(label, this.cellNum(path, value, min, max, step));
  }

  private cellNum(path: string, value: number, min: number, max: number, step: number): string {
    return `<input type="number" class="pfx-input" data-path="${esc(path)}" data-kind="num" min="${min}" max="${max}" step="${step}" value="${value}">`;
  }

  private textRow(label: string, path: string, value: string, placeholder: string): string {
    return this.row(label, `<input type="text" class="pfx-input" data-path="${esc(path)}" data-kind="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`);
  }

  private vec3Row(label: string, path: string, value: readonly [number, number, number], step: number): string {
    const axis = (i: number): string =>
      `<input type="number" class="pfx-input" data-path="${esc(path)}.${i}" data-kind="num" step="${step}" value="${value[i]}">`;
    return this.row(label, `<span class="pfx-vec3">${axis(0)}${axis(1)}${axis(2)}</span>`);
  }

  private enumRow(label: string, path: string, value: string, options: readonly string[]): string {
    const opts = options.map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o)}</option>`).join("");
    return this.row(label, `<select class="pfx-input" data-path="${esc(path)}" data-kind="enum">${opts}</select>`);
  }

  private toggleRow(label: string, section: "drivetrain" | "engineSound", on: boolean): string {
    return this.row(label, `<input type="checkbox" class="pfx-check" data-vhe-toggle="${section}"${on ? " checked" : ""}>`);
  }

  private flag(label: string, path: string, value: boolean): string {
    return `<label class="vhe-flag"><input type="checkbox" class="pfx-check" data-path="${esc(path)}" data-kind="bool"${value ? " checked" : ""}><span>${esc(label)}</span></label>`;
  }

  private soundRow(current: string): string {
    const sounds = this.soundAssets();
    const known = sounds.some((asset) => asset.id === current);
    const opts = [
      ...sounds.map((asset) => `<option value="${esc(asset.id)}"${asset.id === current ? " selected" : ""}>${esc(asset.name)}</option>`),
      ...(!known ? [`<option value="${esc(current)}" selected>${esc(current || "— none —")}${current ? " (unknown)" : ""}</option>`] : []),
    ].join("");
    return this.row("Sound", `<select class="pfx-input" data-path="engineSound.sound" data-kind="enum">${opts}</select>`);
  }

  /** A small editable table with per-row remove buttons and an add button. */
  private tableBlock(title: string, headers: readonly string[], rows: readonly (readonly string[])[], list: string): string {
    const body = rows.map((cells, index) =>
      `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}<td><button type="button" class="vhe-row-remove" data-vhe-op="remove-${list}" data-vhe-index="${index}" aria-label="Remove row ${index + 1}">×</button></td></tr>`).join("");
    return `
      <div class="vhe-table-block" data-vhe-table="${list}">
        <div class="vhe-table-title">${esc(title)}</div>
        <table class="vhe-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}<th></th></tr></thead><tbody>${body}</tbody></table>
        <div class="vhe-actions"><button type="button" class="pfx-tool-btn" data-vhe-op="add-${list}">+ Row</button></div>
      </div>`;
  }

  private soundAssets(): VehicleAssetEditorAsset[] {
    return (this.options.assets ?? [])
      .filter((asset) => asset.assetType === "sound" || asset.assetType === "soundCue")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private bindDetailInputs(): void {
    for (const el of this.detailsHost.querySelectorAll<HTMLElement>("[data-path]")) {
      const path = el.dataset.path!;
      const kind = el.dataset.kind!;
      if (kind === "num" || kind === "text") {
        // Live update on input (no Details re-render → caret preserved); commit on change.
        el.addEventListener("input", () => this.onFieldInput(path, kind, el as HTMLInputElement));
        el.addEventListener("change", () => {
          this.commit();
          this.renderDetails(); // card summaries + gated rows follow the committed value
        });
      } else {
        el.addEventListener("change", () => this.onFieldToggle(path, kind, el));
      }
    }
    for (const el of this.detailsHost.querySelectorAll<HTMLInputElement>("[data-vhe-toggle]")) {
      el.addEventListener("change", () => this.toggleSection(el.dataset.vheToggle as "drivetrain" | "engineSound", el.checked));
    }
    for (const button of this.detailsHost.querySelectorAll<HTMLButtonElement>("[data-vhe-op]")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.runOp(button.dataset.vheOp!, Number(button.dataset.vheIndex ?? -1));
      });
    }
    for (const card of this.detailsHost.querySelectorAll<HTMLDetailsElement>("[data-vhe-wheel-card]")) {
      card.addEventListener("toggle", () => {
        if (card.open) this.selectWheel(Number(card.dataset.vheWheelCard), false);
      });
    }
  }

  // ─── Edits + undo/redo ─────────────────────────────────────────────────────

  private draft(): Draft {
    return this.def as unknown as Draft;
  }

  private beginEdit(): void {
    if (!this.commitBaseline) this.commitBaseline = clone(this.def);
  }

  private onFieldInput(path: string, kind: string, el: HTMLInputElement): void {
    this.beginEdit();
    if (kind === "num") {
      const value = parseFloat(el.value);
      if (!Number.isFinite(value)) return;
      setPath(this.def, path, value);
    } else if (path.endsWith(".visualNode")) {
      const node = el.value.trim();
      const wheel = this.draft().wheels[Number(path.split(".")[1])] as { visualNode?: string } | undefined;
      if (wheel) {
        if (node) wheel.visualNode = node;
        else delete wheel.visualNode;
      }
    } else {
      setPath(this.def, path, el.value);
    }
    this.renderOverview();
    this.renderDiagnostics();
  }

  private onFieldToggle(path: string, kind: string, el: HTMLElement): void {
    this.beginEdit();
    if (kind === "bool") setPath(this.def, path, (el as HTMLInputElement).checked);
    else setPath(this.def, path, (el as HTMLSelectElement).value);
    this.commit();
    this.renderAll();
  }

  /** Drivetrain / engine sound on-off: on fills the normalizer's defaults. */
  private toggleSection(section: "drivetrain" | "engineSound", on: boolean): void {
    this.beginEdit();
    const draft = this.draft();
    if (section === "drivetrain") {
      draft.drivetrain = on ? normalizeVehicleDefinition({ drivetrain: {} })!.drivetrain : null;
    } else if (!on) {
      draft.engineSound = null;
    } else {
      const sound = this.soundAssets()[0]?.id ?? "";
      draft.engineSound = sound
        ? normalizeVehicleDefinition({ engineSound: { sound } })!.engineSound
        : null;
      if (!sound) this.setStatus("No sound or sound cue asset in the project to loop.", "warning");
    }
    this.commit();
    this.renderAll();
  }

  private runOp(op: string, index: number): void {
    this.beginEdit();
    const draft = this.draft();
    const drivetrain = draft.drivetrain as { engine: { torqueCurve: { rpm: number; torqueNm: number }[] }; transmission: { forwardRatios: number[] } } | null;
    switch (op) {
      case "add-wheel": {
        // A copy of the last wheel a metre further back (a fresh default wheel
        // when there is none); the model node is the source's, so it is dropped.
        const last = draft.wheels[draft.wheels.length - 1];
        const { visualNode: _node, ...wheel } = last
          ? copyWheel(last, [last.position[0], last.position[1], last.position[2] - 1])
          : normalizeVehicleDefinition({ wheels: [{ position: [0, 0, 0] }] })!.wheels[0]!;
        draft.wheels.push(wheel);
        this.selectedWheel = draft.wheels.length - 1;
        break;
      }
      case "mirror-wheel": {
        const source = draft.wheels[index];
        if (!source) break;
        const { visualNode: _node, ...mirror } = copyWheel(source, [-source.position[0], source.position[1], source.position[2]]);
        draft.wheels.splice(index + 1, 0, mirror);
        this.selectedWheel = index + 1;
        break;
      }
      case "remove-wheel":
        draft.wheels.splice(index, 1);
        break;
      case "add-steer": {
        const curve = draft.steeringSpeedCurve;
        const last = curve[curve.length - 1];
        curve.push({ speedMps: (last?.speedMps ?? 0) + 10, scale: last?.scale ?? 1 });
        break;
      }
      case "remove-steer":
        draft.steeringSpeedCurve.splice(index, 1);
        break;
      case "add-steer-rate": {
        const curve = draft.steerRateCurve;
        const last = curve[curve.length - 1];
        curve.push({ speedMps: (last?.speedMps ?? 0) + 10, scale: last?.scale ?? 1 });
        break;
      }
      case "remove-steer-rate":
        draft.steerRateCurve.splice(index, 1);
        break;
      case "add-torque": {
        const curve = drivetrain?.engine.torqueCurve;
        if (!curve) break;
        const last = curve[curve.length - 1];
        curve.push({ rpm: (last?.rpm ?? 1000) + 500, torqueNm: last?.torqueNm ?? 200 });
        break;
      }
      case "remove-torque":
        drivetrain?.engine.torqueCurve.splice(index, 1);
        break;
      case "add-gear": {
        const ratios = drivetrain?.transmission.forwardRatios;
        if (!ratios) break;
        if (ratios.length >= MAX_GEARS) {
          this.setStatus(`A gearbox keeps at most ${MAX_GEARS} forward gears.`, "warning");
          break;
        }
        ratios.push(Math.round((ratios[ratios.length - 1] ?? 1.25) * 0.8 * 100) / 100);
        break;
      }
      case "remove-gear":
        drivetrain?.transmission.forwardRatios.splice(index, 1);
        break;
    }
    this.commit();
    this.renderAll();
  }

  private selectWheel(index: number, scroll: boolean): void {
    if (index === this.selectedWheel && !scroll) return;
    this.selectedWheel = index;
    this.renderOverview();
    if (!scroll) {
      for (const card of this.detailsHost.querySelectorAll<HTMLElement>("[data-vhe-wheel-card]")) {
        card.classList.toggle("is-selected", Number(card.dataset.vheWheelCard) === index);
      }
      return;
    }
    this.renderDetails();
    this.detailsHost.querySelector<HTMLElement>(`[data-vhe-wheel-card="${index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  private commit(): void {
    const baseline = this.commitBaseline;
    this.commitBaseline = null;
    if (!baseline || equal(baseline, this.def)) return;
    this.undoStack.push(baseline);
    this.redoStack.length = 0;
    this.markDirty();
  }

  private undo(): void {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this.def));
    this.def = prev;
    this.markDirty();
    this.renderAll();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.def));
    this.def = next;
    this.markDirty();
    this.renderAll();
  }

  // ─── Save / duplicate ──────────────────────────────────────────────────────

  private async save(): Promise<void> {
    try {
      this.commit();
      this.setStatus("Saving…");
      const saved = await saveVehicleAsset(this.path, this.def);
      // Show what was written: the normaliser sorts curves and drops bad rows.
      this.def = saved.definition;
      this.dirty = false;
      this.renderAll();
      if (saved.dropped.length > 0) {
        this.setStatus(`Saved, but the allowlist dropped: ${saved.dropped.join(", ")}`, "warning");
      } else {
        this.setStatus("Saved.", "success");
      }
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private async duplicate(): Promise<void> {
    const name = window.prompt("Duplicate vehicle as", `${this.label}_Copy`);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || /[\\/]/.test(trimmed) || trimmed.includes("..")) {
      this.setStatus("Invalid duplicate name.", "warning");
      return;
    }
    const slash = this.path.lastIndexOf("/");
    const newPath = `${slash >= 0 ? this.path.slice(0, slash + 1) : ""}${trimmed}.vehicle.json`;
    try {
      this.commit();
      const saved = await saveVehicleAsset(newPath, this.def);
      this.path = saved.path;
      this.label = trimmed;
      this.def = saved.definition;
      this.dirty = false;
      this.renderAll();
      this.options.onSaved?.();
      this.setStatus(`Duplicated to ${saved.path}.`, "success");
    } catch (error) {
      this.setStatus(`Duplicate failed: ${describeError(error)}`, "error");
    }
  }

  // ─── Status / dispose ──────────────────────────────────────────────────────

  private setStatus(message: string, tone?: StatusTone): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone ?? "";
    this.options.onStatus?.(message, tone);
  }

  private markDirty(): void {
    this.dirty = true;
    this.saveBtn.classList.add("is-dirty");
  }

  private requestClose(): void {
    this.commit();
    if (this.dirty && !window.confirm("Discard unsaved vehicle changes?")) return;
    this.close();
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlay.remove();
    if (VehicleAssetEditor.activeInstance === this) VehicleAssetEditor.activeInstance = null;
  }
}
