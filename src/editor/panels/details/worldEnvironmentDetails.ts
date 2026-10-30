import type { LayoutWorldEnvironment, Vec3 } from "@engine/scene/layout";
import type { EditableSelection, WorldEnvironmentPreview } from "@/scene/SceneApp";
import type { WorldEnvironmentState } from "@engine/environment/environmentResolve";
import { weatherPresetRequirements } from "@engine/environment/weatherPresets";
import { SEASONS, WEATHER_PRESETS, type Season, type WeatherPreset } from "@engine/environment/worldEnvironment";

/**
 * Details panel of the singleton World Environment (WES) actor: the level
 * defaults (WES v0.3 §12). Every field is one undoable command through
 * `setWorldEnvironment`; grouped fields are merged into the *authored* group
 * (`authored`), never the resolved one, so untouched fields stay absent and keep
 * reading their defaults.
 */
export interface WorldEnvironmentDetailsOptions {
  body: HTMLElement;
  selection: EditableSelection;
  setDetailsScale: (scale: Vec3) => void;
  /** The actor exactly as authored in the layout (sparse). */
  authored: LayoutWorldEnvironment;
  setWorldEnvironment: (
    patch: { [K in keyof LayoutWorldEnvironment]?: LayoutWorldEnvironment[K] | undefined },
    label?: string,
  ) => void;
  /** The preview strip's state; null when the actor is hidden (no preview). */
  preview: WorldEnvironmentPreview | null;
  /** Which environment actors the level has, for the "preset needs" warning (§7.2). */
  presentActors: ReadonlySet<"cloudLayer" | "heightFog" | "skyAtmosphere">;
  setPreview: (
    patch: Partial<Pick<WorldEnvironmentState, "hour" | "season">> & {
      weather?: Partial<WorldEnvironmentState["weather"]>;
      surface?: Partial<WorldEnvironmentState["surface"]>;
    },
    options?: { scrubbing?: boolean },
  ) => void;
  setPreviewPlaying: (playing: boolean) => void;
  setPreviewSpeed: (hoursPerSecond: number) => void;
  resetPreview: () => void;
  makePreviewDefault: () => void;
}

const PREVIEW_SPEEDS = [0.25, 1, 4];

type GroupKey = "time" | "sunPath" | "night" | "weather" | "surface";

interface NumberField {
  group: GroupKey;
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SECTIONS: Array<{ title: string; hint?: string; fields: NumberField[] }> = [
  {
    title: "Time",
    hint: "Day length is real minutes per 24 game hours in Play; 0 keeps the clock still.",
    fields: [
      { group: "time", key: "hour", label: "Hour", min: 0, max: 23.99, step: 0.25 },
      { group: "time", key: "dayLengthMinutes", label: "Day Length (min)", min: 0, max: 1440, step: 1 },
    ],
  },
  {
    title: "Sun Path",
    hint: "Azimuth is the compass direction of the noon sun (0 = +Z).",
    fields: [
      { group: "sunPath", key: "azimuthDeg", label: "Azimuth", min: 0, max: 359.9, step: 1 },
      { group: "sunPath", key: "noonElevationDeg", label: "Noon Elevation", min: 5, max: 90, step: 1 },
      { group: "sunPath", key: "sunriseHour", label: "Sunrise", min: 0, max: 23.5, step: 0.25 },
      { group: "sunPath", key: "sunsetHour", label: "Sunset", min: 0.5, max: 24, step: 0.25 },
    ],
  },
  {
    title: "Night",
    fields: [
      { group: "night", key: "moonIntensity", label: "Moon Intensity", min: 0, max: 2, step: 0.01 },
      { group: "night", key: "ambientFloor", label: "Ambient Floor", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Surface (visual)",
    hint: "Snow and wetness are visual only; they never change tyre grip.",
    fields: [
      { group: "surface", key: "snowCoverage", label: "Snow Coverage", min: 0, max: 1, step: 0.05 },
      { group: "surface", key: "wetness", label: "Wetness", min: 0, max: 1, step: 0.05 },
      { group: "surface", key: "winterSnowCoverage", label: "Winter Snow", min: 0, max: 1, step: 0.05 },
      { group: "surface", key: "snowSlopeStartDeg", label: "Snow Slope Start", min: 0, max: 90, step: 1 },
      { group: "surface", key: "snowSlopeEndDeg", label: "Snow Slope End", min: 0, max: 90, step: 1 },
      { group: "surface", key: "snowAltitudeBlend", label: "Altitude Blend", min: 0, max: 10000, step: 1 },
    ],
  },
];

export function renderWorldEnvironmentDetails(options: WorldEnvironmentDetailsOptions): void {
  const { body, selection } = options;
  const env = selection.worldEnvironment;
  if (!env) return;
  options.setDetailsScale([1, 1, 1]);
  const resolvedGroup = (group: GroupKey): Record<string, unknown> => env[group] as unknown as Record<string, unknown>;
  const numberRow = (field: NumberField): string => `
        <label class="detail-row">
          <span>${field.label}</span>
          <input data-wes-number="${field.group}.${field.key}" type="number" step="${field.step}"
            min="${field.min}" max="${field.max}" value="${Number(resolvedGroup(field.group)[field.key])}" />
        </label>`;
  const section = (title: string, rows: string, hint?: string): string => `
      <div class="detail-section">
        <div class="detail-section-title">${title}</div>${rows}
        ${hint ? `<div class="detail-hint">${hint}</div>` : ""}
      </div>`;
  const sections = SECTIONS.map((entry) => {
    let rows = entry.fields.map(numberRow).join("");
    if (entry.title === "Night") {
      rows += colorRow("night.moonColor", "Moon Color", env.night.moonColor);
    }
    if (entry.title.startsWith("Surface")) {
      rows += colorRow("surface.snowColor", "Snow Color", env.surface.snowColor);
      rows += `
        <label class="detail-row">
          <span>Snow Min Altitude</span>
          <input data-wes-altitude type="number" step="1" placeholder="none"
            value="${env.surface.snowMinAltitude ?? ""}" />
        </label>`;
    }
    return section(entry.title, rows, entry.hint);
  });

  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / world environment</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-wes-name type="text" value="${escapeHtml(env.name)}" placeholder="World Environment" />
      </label>
      ${options.preview ? previewStrip(options.preview) : `<div class="detail-hint">Hidden: the authored sky, fog and sun render unchanged.</div>`}
      <div class="detail-section" data-wes-defaults>
        <div class="detail-section-title">Level Defaults</div>
        <label class="detail-row">
          <span>Season</span>
          <select data-wes-season>
            ${SEASONS.map((season) => `<option value="${season}" ${env.season === season ? "selected" : ""}>${titleCase(season)}</option>`).join("")}
          </select>
        </label>
        <label class="detail-row">
          <span>Weather</span>
          <select data-wes-weather>
            ${WEATHER_PRESETS.map((preset) => `<option value="${preset}" ${env.weather.preset === preset ? "selected" : ""}>${titleCase(preset)}</option>`).join("")}
          </select>
        </label>
        <label class="detail-row">
          <span>Weather Intensity</span>
          <input data-wes-number="weather.intensity" type="number" step="0.05" min="0" max="1"
            value="${env.weather.intensity}" />
        </label>
        <div class="detail-hint">Summer + Clear keep the authored look; the clock only moves the sun.</div>
      </div>
      ${sections.join("")}
    `;

  const label = "Edit World Environment";
  const patchGroup = (group: GroupKey, key: string, value: unknown): void => {
    const next = { ...(options.authored[group] as Record<string, unknown> | undefined) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    options.setWorldEnvironment(
      { [group]: Object.keys(next).length > 0 ? next : undefined } as Partial<LayoutWorldEnvironment>,
      label,
    );
  };

  const nameInput = body.querySelector<HTMLInputElement>("[data-wes-name]");
  nameInput?.addEventListener("change", () => {
    const value = nameInput.value.trim();
    options.setWorldEnvironment({ name: value.length > 0 ? value : undefined }, "Rename World Environment");
  });
  body.querySelector<HTMLSelectElement>("[data-wes-season]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as LayoutWorldEnvironment["season"];
    options.setWorldEnvironment({ season: value }, label);
  });
  body.querySelector<HTMLSelectElement>("[data-wes-weather]")?.addEventListener("change", (event) => {
    patchGroup("weather", "preset", (event.currentTarget as HTMLSelectElement).value);
  });
  body.querySelectorAll<HTMLInputElement>("[data-wes-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const [group, key] = (input.dataset.wesNumber ?? "").split(".") as [GroupKey, string];
      const value = Number(input.value);
      if (!group || !key || !Number.isFinite(value)) return;
      patchGroup(group, key, value);
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-wes-color]").forEach((input) => {
    input.addEventListener("change", () => {
      const [group, key] = (input.dataset.wesColor ?? "").split(".") as [GroupKey, string];
      if (group && key) patchGroup(group, key, input.value);
    });
  });
  bindPreviewStrip(options);
  if (options.preview) updateWorldEnvironmentPreviewStrip(body, options.preview, options.presentActors);

  const altitude = body.querySelector<HTMLInputElement>("[data-wes-altitude]");
  altitude?.addEventListener("change", () => {
    const raw = altitude.value.trim();
    const value = Number(raw);
    patchGroup("surface", "snowMinAltitude", raw === "" ? undefined : Number.isFinite(value) ? value : undefined);
  });
}

/**
 * The Preview strip (§12): changes here are never saved and never dirty the
 * level; "Make Default" writes them as one undo step, "Reset" drops them.
 */
function previewStrip(preview: WorldEnvironmentPreview): string {
  const button = (attr: string, value: string, label: string): string =>
    `<button type="button" class="detail-button" ${attr}="${value}">${label}</button>`;
  return `
      <div class="detail-section" data-wes-preview>
        <div class="detail-section-title">Preview <span class="detail-hint">not saved</span></div>
        <label class="detail-row">
          <span>Time <span data-wes-preview-hour-label>${formatHour(preview.state.hour)}</span></span>
          <input data-wes-preview-hour type="range" min="0" max="23.99" step="0.01" value="${preview.state.hour}" />
        </label>
        <div class="detail-row">
          <span>Play</span>
          <span class="wes-preview-buttons">
            <button type="button" class="detail-button" data-wes-preview-play>${preview.playing ? "Pause" : "Play"}</button>
            <select data-wes-preview-speed>
              ${PREVIEW_SPEEDS.map((speed) => `<option value="${speed}" ${speed === preview.hoursPerSecond ? "selected" : ""}>${speed} h/s</option>`).join("")}
            </select>
          </span>
        </div>
        <div class="detail-row"><span>Season</span><span class="wes-preview-buttons">${SEASONS.map((season) => button("data-wes-preview-season", season, titleCase(season))).join("")}</span></div>
        <div class="detail-row"><span>Weather</span><span class="wes-preview-buttons">${WEATHER_PRESETS.map((preset) => button("data-wes-preview-weather", preset, titleCase(preset))).join("")}</span></div>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-wes-preview-number="weather.intensity" type="range" min="0" max="1" step="0.05" value="${preview.state.weather.intensity}" />
        </label>
        <label class="detail-row">
          <span>Snow Cover</span>
          <input data-wes-preview-number="surface.snowCoverage" type="range" min="0" max="1" step="0.05" value="${preview.state.surface.snowCoverage}" />
        </label>
        <label class="detail-row">
          <span>Wetness</span>
          <input data-wes-preview-number="surface.wetness" type="range" min="0" max="1" step="0.05" value="${preview.state.surface.wetness}" />
        </label>
        <div class="detail-hint" data-wes-preview-needs></div>
        <div class="detail-hint">Snow and wetness are preview state until terrain and materials consume them (K2).</div>
        <div class="wes-preview-buttons">
          <button type="button" class="detail-button" data-wes-preview-default>Make Default</button>
          <button type="button" class="detail-button" data-wes-preview-reset>Reset</button>
        </div>
      </div>`;
}

function bindPreviewStrip(options: WorldEnvironmentDetailsOptions): void {
  const { body } = options;
  const hour = body.querySelector<HTMLInputElement>("[data-wes-preview-hour]");
  hour?.addEventListener("input", () => options.setPreview({ hour: Number(hour.value) }, { scrubbing: true }));
  hour?.addEventListener("change", () => options.setPreview({ hour: Number(hour.value) }, { scrubbing: false }));
  const play = body.querySelector<HTMLButtonElement>("[data-wes-preview-play]");
  // The strip updates in place, so the button's label (not the render-time state) says what a click does.
  play?.addEventListener("click", () => options.setPreviewPlaying(play.textContent === "Play"));
  body.querySelector<HTMLSelectElement>("[data-wes-preview-speed]")?.addEventListener("change", (event) => {
    options.setPreviewSpeed(Number((event.currentTarget as HTMLSelectElement).value));
  });
  body.querySelectorAll<HTMLButtonElement>("[data-wes-preview-season]").forEach((button) => {
    button.addEventListener("click", () => options.setPreview({ season: button.dataset.wesPreviewSeason as Season }));
  });
  body.querySelectorAll<HTMLButtonElement>("[data-wes-preview-weather]").forEach((button) => {
    button.addEventListener("click", () =>
      options.setPreview({ weather: { preset: button.dataset.wesPreviewWeather as WeatherPreset } }));
  });
  body.querySelectorAll<HTMLInputElement>("[data-wes-preview-number]").forEach((input) => {
    input.addEventListener("input", () => {
      const [group, key] = (input.dataset.wesPreviewNumber ?? "").split(".");
      const value = Number(input.value);
      if (group === "weather" && key === "intensity") options.setPreview({ weather: { intensity: value } });
      if (group === "surface" && (key === "snowCoverage" || key === "wetness")) options.setPreview({ surface: { [key]: value } });
    });
  });
  body.querySelector("[data-wes-preview-default]")?.addEventListener("click", () => options.makePreviewDefault());
  body.querySelector("[data-wes-preview-reset]")?.addEventListener("click", () => options.resetPreview());
}

/**
 * Brings an open preview strip up to date in place — the clock runs every
 * frame while previewing, and re-rendering the panel would drop a slider drag.
 */
export function updateWorldEnvironmentPreviewStrip(
  body: HTMLElement,
  preview: WorldEnvironmentPreview,
  presentActors: ReadonlySet<"cloudLayer" | "heightFog" | "skyAtmosphere">,
): void {
  const { state } = preview;
  const hour = body.querySelector<HTMLInputElement>("[data-wes-preview-hour]");
  if (hour && document.activeElement !== hour) hour.value = String(state.hour);
  const label = body.querySelector("[data-wes-preview-hour-label]");
  if (label) label.textContent = formatHour(state.hour);
  const play = body.querySelector("[data-wes-preview-play]");
  if (play) play.textContent = preview.playing ? "Pause" : "Play";
  body.querySelectorAll<HTMLButtonElement>("[data-wes-preview-season]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.wesPreviewSeason === state.season);
  });
  body.querySelectorAll<HTMLButtonElement>("[data-wes-preview-weather]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.wesPreviewWeather === state.weather.preset);
  });
  body.querySelectorAll<HTMLInputElement>("[data-wes-preview-number]").forEach((input) => {
    if (document.activeElement === input) return;
    const [group, key] = (input.dataset.wesPreviewNumber ?? "").split(".");
    const source = group === "weather" ? state.weather : state.surface;
    const value = (source as unknown as Record<string, number>)[key ?? ""];
    if (value !== undefined) input.value = String(value);
  });
  for (const selector of ["[data-wes-preview-default]", "[data-wes-preview-reset]"]) {
    const button = body.querySelector<HTMLButtonElement>(selector);
    if (button) button.disabled = !preview.modified;
  }
  const needs = body.querySelector("[data-wes-preview-needs]");
  if (needs) {
    const missing = weatherPresetRequirements(state.weather.preset).filter((actor) => !presentActors.has(actor));
    needs.textContent = missing.length > 0
      ? `${titleCase(state.weather.preset)} needs ${missing.map(actorLabel).join(", ")} to show fully; WES never adds them.`
      : "";
  }
}

function actorLabel(actor: "cloudLayer" | "heightFog" | "skyAtmosphere"): string {
  return actor === "cloudLayer" ? "a Cloud Layer" : actor === "heightFog" ? "an Exponential Height Fog" : "a Sky Atmosphere";
}

function formatHour(hour: number): string {
  const minutes = Math.floor(hour * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function colorRow(field: string, label: string, value: string): string {
  return `
        <label class="detail-row">
          <span>${label}</span>
          <input data-wes-color="${field}" type="color" value="${escapeHtml(value)}" />
        </label>`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
