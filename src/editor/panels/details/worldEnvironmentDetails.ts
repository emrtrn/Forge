import type { LayoutWorldEnvironment, Vec3 } from "@engine/scene/layout";
import type { EditableSelection } from "@/scene/SceneApp";
import { SEASONS, WEATHER_PRESETS } from "@engine/environment/worldEnvironment";

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
}

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
  const altitude = body.querySelector<HTMLInputElement>("[data-wes-altitude]");
  altitude?.addEventListener("change", () => {
    const raw = altitude.value.trim();
    const value = Number(raw);
    patchGroup("surface", "snowMinAltitude", raw === "" ? undefined : Number.isFinite(value) ? value : undefined);
  });
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
