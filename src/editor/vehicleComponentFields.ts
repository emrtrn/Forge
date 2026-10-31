/**
 * Actor Script Details forms for the `Vehicle` and `VehicleAiDriver`
 * components (vehicle plan Faz 5).
 *
 * A `Vehicle` component is a reference to a `*.vehicle.json` asset plus inline
 * overrides (`normalizeVehicleDefinition`: scalars override the asset one by
 * one; `engineSound` fields merge, `null` silences the car). The form edits only
 * that override layer — the asset picker, the handful of scalars a level
 * designer tunes per class, and the engine sound — and shows each override's
 * inherited value as its placeholder, so a blank field means "use the asset".
 * Wheels, suspension and the drivetrain stay with the vehicle asset (its own
 * editor) or the raw-props JSON.
 *
 * The level Details panel reuses the same form for a placement's
 * `vehicleOverrides`: those carry the same keys with the same meaning, layered
 * one level up (placement over class), so only the markup classes and the
 * "nothing chosen" wording differ ({@link VehicleFieldsContext.surface}).
 *
 * Pure HTML + prop edits, no DOM wiring: `ActorScriptEditor` / `EditorUi` bind
 * the `data-as-vehicle-*` / `data-as-vehicle-ai-*` attributes.
 */
import type { SceneJsonValue } from "@engine/scene/entity";
import {
  VEHICLE_OVERRIDE_SCALAR_KEYS,
  type VehicleDefinition,
  type VehicleOverrideScalarKey,
} from "@engine/physics/vehicle/vehicleTypes";

type Props = Record<string, SceneJsonValue>;

/** Labels + input bounds for the shared override keys (the engine owns the key list). */
const QUICK_FIELD_INPUTS: Record<VehicleOverrideScalarKey, { label: string; attrs: string }> = {
  massKg: { label: "Mass (kg)", attrs: 'step="50" min="1"' },
  maxEngineForce: { label: "Engine Force (N)", attrs: 'step="100" min="0"' },
  maxReverseForce: { label: "Reverse Force (N)", attrs: 'step="100" min="0"' },
  maxBrakeForce: { label: "Brake Force (N)", attrs: 'step="10" min="0"' },
  handbrakeForce: { label: "Handbrake Force (N)", attrs: 'step="10" min="0"' },
  maxSteerAngleDeg: { label: "Max Steer°", attrs: 'step="1" min="0" max="80"' },
  steerSpeed: { label: "Steer Speed", attrs: 'step="0.1" min="0.1"' },
};

export const ENGINE_SOUND_INHERIT = "__inherit";
export const ENGINE_SOUND_SILENT = "__silent";

export interface VehicleFieldsContext {
  /** `vehicle` manifest assets, by public-root path. */
  readonly vehicleAssets: ReadonlyArray<{ path: string; name: string }>;
  /** `sound` + `soundCue` assets an engine voice can loop. */
  readonly soundAssets: ReadonlyArray<{ id: string; name: string }>;
  /**
   * What the overrides fall back to: the loaded asset, or the reference car when
   * the component names none. `undefined` while the asset is still loading,
   * `null` when it could not be read.
   */
  readonly inherited: VehicleDefinition | null | undefined;
  /**
   * `actorScript` (default) edits a class's component; `details` edits one
   * placement's overrides in the level Details panel, where "no asset" means
   * the class's own.
   */
  readonly surface?: "actorScript" | "details";
  /** Details only: the asset the class itself uses, for the "class default" option. */
  readonly classAsset?: string;
  /** Details only: read-only (locked placement). */
  readonly disabled?: boolean;
}

export function vehicleComponentFields(props: Props, context: VehicleFieldsContext): string {
  const details = context.surface === "details";
  const field = details ? "detail-row" : "as-field";
  const note = details ? "detail-hint" : "as-details-note";
  const disabled = context.disabled ? "disabled" : "";
  const asset = typeof props.asset === "string" ? props.asset : "";
  const known = context.vehicleAssets.some((entry) => entry.path === asset);
  const noneLabel = details
    ? `Class default${context.classAsset ? ` (${assetName(context.classAsset, context.vehicleAssets)})` : ""}`
    : "— none (inline / reference car) —";
  const assetOptions = [
    `<option value="" ${asset ? "" : "selected"}>${escapeHtml(noneLabel)}</option>`,
    ...context.vehicleAssets.map((entry) =>
      `<option value="${escapeHtml(entry.path)}" ${entry.path === asset ? "selected" : ""}>${escapeHtml(entry.name)}</option>`),
    ...(asset && !known ? [`<option value="${escapeHtml(asset)}" selected>${escapeHtml(asset)} (unknown)</option>`] : []),
  ].join("");

  const inherited = context.inherited;
  const status = inherited === undefined
    ? `<p class="${note}">Araç asset'i yükleniyor…</p>`
    : inherited === null
      ? `<p class="${note}">Araç asset'i okunamadı; Play, satır içi / referans araç ayarlarına geri döner.</p>`
      : "";

  const quick = VEHICLE_OVERRIDE_SCALAR_KEYS.map((key) => {
    const input = QUICK_FIELD_INPUTS[key];
    const value = props[key];
    const current = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    const fallback = inherited ? formatNumber(inherited[key]) : "";
    return `
      <label class="${field}">
        <span>${input.label}</span>
        <input type="number" data-as-vehicle-num="${key}" value="${current}" placeholder="${fallback}" ${input.attrs} ${disabled} />
      </label>`;
  }).join("");

  const sound = engineSoundChoice(props.engineSound);
  const inheritedSound = inherited?.engineSound?.sound;
  const soundKnown = context.soundAssets.some((entry) => entry.id === sound);
  const soundOptions = [
    `<option value="${ENGINE_SOUND_INHERIT}" ${sound === ENGINE_SOUND_INHERIT ? "selected" : ""}>${
      escapeHtml(`${details ? "Class default" : "From asset"} (${inheritedSound ?? "silent"})`)}</option>`,
    `<option value="${ENGINE_SOUND_SILENT}" ${sound === ENGINE_SOUND_SILENT ? "selected" : ""}>Silent</option>`,
    ...context.soundAssets.map((entry) =>
      `<option value="${escapeHtml(entry.id)}" ${entry.id === sound ? "selected" : ""}>${escapeHtml(entry.name)}</option>`),
    ...(sound !== ENGINE_SOUND_INHERIT && sound !== ENGINE_SOUND_SILENT && !soundKnown
      ? [`<option value="${escapeHtml(sound)}" selected>${escapeHtml(sound)} (unknown)</option>`] : []),
  ].join("");

  const inlineWheels = Array.isArray(props.wheels) ? props.wheels.length : 0;
  const wheelNote = inlineWheels > 0
    ? `${inlineWheels} satır içi tekerlek asset'inkilerin yerine geçer (ham değerler aşağıda).`
    : inherited
      ? `${inherited.wheels.length} tekerlek ${asset || context.classAsset ? "asset'ten" : "referans araçtan"} geliyor.`
      : "Tekerlekler asset'ten gelir.";

  const assetRow = `
    <label class="${field}">
      <span>Vehicle Asset</span>
      <select data-as-vehicle-asset ${disabled}>${assetOptions}</select>
    </label>`;
  const soundRow = `
    <label class="${field}">
      <span>Engine Sound</span>
      <select data-as-vehicle-engine-sound ${disabled}>${soundOptions}</select>
    </label>`;
  const footer = `<p class="${note}">${escapeHtml(wheelNote)} Tekerlekler, süspansiyon ve drivetrain araç asset'inde düzenlenir.</p>`;
  if (details) {
    return `
      <div class="detail-section" data-actor-vehicle-section>
        <div class="detail-section-title">Vehicle <small>instance override · blank = class</small></div>
        ${assetRow}
        ${status}
        ${quick}
        ${soundRow}
        ${footer}
      </div>`;
  }
  return `
    <div class="as-section-label">Vehicle</div>
    ${assetRow}
    ${status}
    <div class="as-section-label">Overrides <small>(blank = inherit)</small></div>
    ${quick}
    ${soundRow}
    ${footer}
  `;
}

function assetName(path: string, assets: VehicleFieldsContext["vehicleAssets"]): string {
  return assets.find((entry) => entry.path === path)?.name ?? path.split("/").pop() ?? path;
}

/** Points the component at another asset; an empty path makes it inline-only. */
export function setVehicleAsset(props: Props, path: string): void {
  if (path) props.asset = path;
  else delete props.asset;
}

/** A blank field drops the override (inherit); anything else must be a finite number. */
export function setVehicleScalarOverride(props: Props, key: string, raw: string): boolean {
  const text = raw.trim();
  if (!text) {
    delete props[key];
    return true;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  props[key] = value;
  return true;
}

/**
 * Inherit drops the whole inline block; Silent writes the `null` the runtime
 * reads as "no voice"; a sound id keeps any inline tuning and swaps the loop.
 */
export function setVehicleEngineSound(props: Props, choice: string): void {
  if (choice === ENGINE_SOUND_INHERIT) {
    delete props.engineSound;
    return;
  }
  if (choice === ENGINE_SOUND_SILENT) {
    props.engineSound = null;
    return;
  }
  const current = props.engineSound;
  const tuning = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  props.engineSound = { ...tuning, sound: choice };
}

function engineSoundChoice(value: SceneJsonValue | undefined): string {
  if (value === null) return ENGINE_SOUND_SILENT;
  if (value && typeof value === "object" && !Array.isArray(value)
    && typeof value.sound === "string" && value.sound.trim()) {
    return value.sound.trim();
  }
  return ENGINE_SOUND_INHERIT;
}

/**
 * The `VehicleAiDriver` form, mirroring `readVehicleAiDriverComponent`. The
 * spline is level-owned, so a reusable class usually leaves it blank and each
 * placement's patrol route supplies it.
 */
export function vehicleAiDriverFields(props: Props): string {
  const splineId = typeof props.splineId === "string" ? props.splineId : "";
  const entry = props.entry === "start" ? "start" : "nearest";
  const wrap = props.wrapMode === "loop" || props.wrapMode === "clamp" ? props.wrapMode : "";
  const number = (key: string, fallback: number): string => {
    const value = props[key];
    return String(typeof value === "number" && Number.isFinite(value) ? value : fallback);
  };
  const option = (value: string, label: string, selected: string): string =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;
  return `
    <div class="as-section-label">AI Driver</div>
    <label class="as-field">
      <span>Spline ID</span>
      <input type="text" data-as-vehicle-ai-spline value="${escapeHtml(splineId)}" placeholder="from the placement's patrol route" />
    </label>
    <label class="as-field">
      <span>Entry</span>
      <select data-as-vehicle-ai-select="entry">
        ${option("nearest", "Nearest point", entry)}
        ${option("start", "Route start", entry)}
      </select>
    </label>
    <label class="as-field">
      <span>Wrap</span>
      <select data-as-vehicle-ai-select="wrapMode">
        ${option("", "Auto (loop closed, stop open)", wrap)}
        ${option("loop", "Loop", wrap)}
        ${option("clamp", "Stop at end", wrap)}
      </select>
    </label>
    <label class="as-field">
      <span>Target Speed (m/s)</span>
      <input type="number" data-as-num="targetSpeed" value="${number("targetSpeed", 12)}" step="0.5" min="0" max="100" />
    </label>
    <label class="as-field">
      <span>Look Ahead (m)</span>
      <input type="number" data-as-num="lookAheadDistance" value="${number("lookAheadDistance", 5)}" step="0.5" min="1" max="50" />
    </label>
    <label class="as-field as-check">
      <input type="checkbox" data-as-vehicle-ai-enabled ${props.enabled === false ? "" : "checked"} />
      <span>Enabled</span>
    </label>
  `;
}

/** Defaults stay implicit: `nearest` entry, auto wrap and `enabled` are not written. */
export function setVehicleAiDriverChoice(props: Props, key: "entry" | "wrapMode", value: string): void {
  if (key === "entry") {
    if (value === "start") props.entry = "start";
    else delete props.entry;
    return;
  }
  if (value === "loop" || value === "clamp") props.wrapMode = value;
  else delete props.wrapMode;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
