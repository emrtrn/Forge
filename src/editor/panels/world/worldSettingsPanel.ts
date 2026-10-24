import type { EditorWorldSettings } from "@editor/core/editableScene";
import { normalizeWorldPartitionSettings } from "@engine/world/worldPartition";
import { VIEW_DISTANCE_MAX, VIEW_DISTANCE_MIN } from "@engine/world/viewDistance";
import {
  getGameEditorCatalog,
  type EditorGameModeOption,
} from "@/editor/gameEditorRegistry";

export interface WorldSettingsPanelOptions {
  body: HTMLElement;
  settings: EditorWorldSettings;
  projectGameModes: readonly EditorGameModeOption[];
  setWorldSettings: (values: Partial<EditorWorldSettings>) => void;
}

export function renderWorldSettingsPanel(options: WorldSettingsPanelOptions): void {
  const { body, settings } = options;
  body.innerHTML = renderWorldSettingsHtml(settings, options.projectGameModes);
  bindWorldSettingsInputs(options);
}

function renderWorldSettingsHtml(
  settings: EditorWorldSettings,
  projectGameModes: readonly EditorGameModeOption[],
): string {
  // Built-in modes plus discovered project `gameMode` Actor Scripts. Include the
  // current selection even if it is a not-yet-discovered class ref so it stays
  // selected (and round-trips) instead of silently resetting to the default.
  const modeOptions: EditorGameModeOption[] = [
    ...getGameEditorCatalog().gameModeOptions,
    ...projectGameModes,
  ];
  if (settings.gameMode && !modeOptions.some((option) => option.id === settings.gameMode)) {
    modeOptions.push({
      id: settings.gameMode,
      displayName: settings.gameMode,
      description: "Project Game Mode (Actor Script).",
    });
  }
  const gameModeOptions = modeOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}" ${
          option.id === settings.gameMode ? "selected" : ""
        }>${escapeHtml(option.displayName)}</option>`,
    )
    .join("");
  const gameModeDescription =
    modeOptions.find((option) => option.id === settings.gameMode)?.description ?? "";
  const partition = normalizeWorldPartitionSettings(settings.partition);
  const partitionDisabled = partition.enabled ? "" : "disabled";

  return `
      <div class="detail-heading">
        <strong>World Settings</strong>
        <span>Scene rendering</span>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Game Mode</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-world-game-mode>${gameModeOptions}</select>
        </label>
        <div class="detail-hint">${escapeHtml(gameModeDescription)}</div>
        <label class="detail-row">
          <span>Kill Z</span>
          <input type="number" data-world-number="killZ" step="0.5"
            value="${escapeHtml(String(settings.killZ))}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">World Partition</div>
        <label class="detail-toggle">
          <input type="checkbox" data-world-partition-enabled ${partition.enabled ? "checked" : ""} />
          <span>Enable World Partition</span>
        </label>
        <label class="detail-row">
          <span>Cell Size (m)</span>
          <input type="number" data-world-partition-cell-size min="0" step="any"
            value="${partition.grids.main.cellSize}" ${partitionDisabled} />
        </label>
        <label class="detail-row">
          <span>Loading Range (m)</span>
          <input type="number" data-world-partition-range min="0" step="any"
            value="${partition.grids.main.loadRange}" ${partitionDisabled} />
        </label>
        <div class="detail-hint">Saves actors into per-cell files by position. Persistent: singletons, landscapes, splines, Player Start, directional lights and actors with Spatially Loaded off.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Lighting</div>
        <div class="detail-row">
          <span>Lighting Mode</span>
          <span class="detail-value">${settings.lightingMode}</span>
        </div>
        <div class="detail-row">
          <span>Shadow Filter</span>
          <span class="detail-value">${settings.shadowFilter}</span>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Environment</div>
        <label class="detail-row">
          <span>View Distance (m)</span>
          <input type="number" data-world-view-distance min="${VIEW_DISTANCE_MIN}" max="${VIEW_DISTANCE_MAX}" step="50"
            placeholder="Camera default"
            value="${settings.viewDistance === undefined ? "" : escapeHtml(String(settings.viewDistance))}" />
        </label>
        <div class="detail-hint">Camera far plane in Play (scaled by the game's quality setting). Empty keeps each camera's own Far Clip.</div>
        <label class="detail-row">
          <span>Background</span>
          <input type="color" data-world-color="backgroundColor"
            value="${escapeHtml(settings.backgroundColor)}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Ambient Light</div>
        <label class="detail-row">
          <span>Color</span>
          <input type="color" data-world-color="ambientColor"
            value="${escapeHtml(settings.ambientColor)}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input type="number" data-world-number="ambientIntensity" min="0" max="20" step="0.05"
            value="${escapeHtml(String(settings.ambientIntensity))}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Static Objects</div>
        <label class="detail-toggle">
          <input type="checkbox" data-world-toggle="staticObjectsCastShadow" ${
            settings.staticObjectsCastShadow ? "checked" : ""
          } />
          <span>Cast Shadow</span>
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-world-toggle="staticObjectsReceiveShadow" ${
            settings.staticObjectsReceiveShadow ? "checked" : ""
          } />
          <span>Receive Shadow</span>
        </label>
      </div>
    `;
}

function bindWorldSettingsInputs(options: WorldSettingsPanelOptions): void {
  const partition = normalizeWorldPartitionSettings(options.settings.partition);
  options.body.querySelector<HTMLInputElement>("[data-world-partition-enabled]")
    ?.addEventListener("change", (event) => {
      options.setWorldSettings({
        partition: normalizeWorldPartitionSettings({
          ...partition,
          enabled: (event.currentTarget as HTMLInputElement).checked,
        }),
      });
    });
  for (const [selector, key] of [
    ["[data-world-partition-cell-size]", "cellSize"],
    ["[data-world-partition-range]", "loadRange"],
  ] as const) {
    options.body.querySelector<HTMLInputElement>(selector)?.addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0) {
        input.value = String(partition.grids.main[key]);
        return;
      }
      options.setWorldSettings({
        partition: normalizeWorldPartitionSettings({
          ...partition,
          grids: { ...partition.grids, main: { ...partition.grids.main, [key]: value } },
        }),
      });
    });
  }

  options.body.querySelectorAll<HTMLInputElement>("[data-world-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const key = toggle.dataset.worldToggle;
      if (key === "staticObjectsCastShadow") {
        options.setWorldSettings({ staticObjectsCastShadow: toggle.checked });
      }
      if (key === "staticObjectsReceiveShadow") {
        options.setWorldSettings({ staticObjectsReceiveShadow: toggle.checked });
      }
    });
  });

  options.body.querySelectorAll<HTMLInputElement>("[data-world-color]").forEach((input) => {
    const key = input.dataset.worldColor as "backgroundColor" | "ambientColor";
    // "change" fires when the picker closes -> one command + one auto-save.
    input.addEventListener("change", () => options.setWorldSettings({ [key]: input.value }));
  });

  options.body.querySelectorAll<HTMLInputElement>("[data-world-number]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const key = (event.currentTarget as HTMLInputElement).dataset.worldNumber;
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      if (key === "ambientIntensity") options.setWorldSettings({ ambientIntensity: value });
      if (key === "killZ") options.setWorldSettings({ killZ: value });
    });
  });

  options.body
    .querySelector<HTMLInputElement>("[data-world-view-distance]")
    ?.addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      if (input.value.trim() === "") {
        options.setWorldSettings({ viewDistance: undefined });
        return;
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      options.setWorldSettings({
        viewDistance: Math.min(VIEW_DISTANCE_MAX, Math.max(VIEW_DISTANCE_MIN, value)),
      });
    });

  options.body
    .querySelector<HTMLSelectElement>("[data-world-game-mode]")
    ?.addEventListener("change", (event) => {
      options.setWorldSettings({ gameMode: (event.currentTarget as HTMLSelectElement).value });
    });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
