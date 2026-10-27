import { TERRAIN_MAX_TILES_PER_AXIS } from "@engine/terrain/terrainTypes";
import {
  WORLD_TERRAIN_EXPAND_DEFAULTS, type WorldTerrainExpandOptions, type WorldTerrainExpansionSource,
} from "@engine/terrain/worldTerrainExpand";

/** Same overlay/form pattern as the new World Terrain dialog, without adaptation choices. */
export function pickWorldTerrainExpansion(source: WorldTerrainExpansionSource): Promise<WorldTerrainExpandOptions | null> {
  return new Promise((resolvePick) => {
    const overlay = document.createElement("div");
    overlay.className = "parent-class-overlay";
    overlay.innerHTML = `
      <div class="parent-class-dialog world-terrain-dialog" role="dialog" aria-modal="true" aria-label="Expand Landscape" data-world-terrain-expand-dialog>
        <header class="parent-class-head">Expand Landscape</header>
        <form class="world-terrain-form" novalidate>
          <label><span>Tiles X</span><input data-field="tilesX" type="number" min="1" max="${TERRAIN_MAX_TILES_PER_AXIS}" step="1" /></label>
          <label><span>Tiles Z</span><input data-field="tilesZ" type="number" min="1" max="${TERRAIN_MAX_TILES_PER_AXIS}" step="1" /></label>
          <label><span>Original tile X (from 0)</span><input data-field="originalX" type="number" min="0" step="1" /></label>
          <label><span>Original tile Z (from 0)</span><input data-field="originalZ" type="number" min="0" step="1" /></label>
          <div class="world-terrain-summary" data-world-terrain-summary aria-live="polite"></div>
          <ul class="world-terrain-problems" data-world-terrain-problems aria-live="polite"></ul>
          <div class="detail-hint">The original tile keeps its world position, heights and paint. New heights extend the nearest edge or corner; new paint starts on layer 0, with shared vertices kept identical.</div>
        </form>
        <footer class="parent-class-foot">
          <button type="button" class="parent-class-cancel" data-world-terrain-cancel>Cancel</button>
          <button type="button" class="parent-class-cancel world-terrain-create" data-world-terrain-expand>Expand</button>
        </footer>
      </div>`;
    const previousFocus = document.activeElement;
    document.body.append(overlay);
    const field = (key: keyof WorldTerrainExpandOptions) => overlay.querySelector<HTMLInputElement>(`[data-field="${key}"]`)!;
    const keys = Object.keys(WORLD_TERRAIN_EXPAND_DEFAULTS) as (keyof WorldTerrainExpandOptions)[];
    keys.forEach((key) => { field(key).value = String(WORLD_TERRAIN_EXPAND_DEFAULTS[key]); });
    const expand = overlay.querySelector<HTMLButtonElement>("[data-world-terrain-expand]")!;
    const summary = overlay.querySelector<HTMLElement>("[data-world-terrain-summary]")!;
    const problemList = overlay.querySelector<HTMLElement>("[data-world-terrain-problems]")!;
    const refresh = (): WorldTerrainExpandOptions | null => {
      const options: WorldTerrainExpandOptions = {
        tilesX: field("tilesX").valueAsNumber, tilesZ: field("tilesZ").valueAsNumber,
        originalX: field("originalX").valueAsNumber, originalZ: field("originalZ").valueAsNumber,
      };
      field("originalX").max = String(options.tilesX - 1);
      field("originalZ").max = String(options.tilesZ - 1);
      const problems = source.problems(options);
      problemList.replaceChildren(...problems.map((problem) => Object.assign(document.createElement("li"), { textContent: problem })));
      expand.disabled = problems.length > 0;
      const edge = source.tileEdge;
      summary.textContent = Number.isFinite(options.tilesX * options.tilesZ)
        ? `${Number((edge * options.tilesX).toFixed(2))} m × ${Number((edge * options.tilesZ).toFixed(2))} m · ${options.tilesX * options.tilesZ} tiles · ${source.tileQuads} quads per tile edge`
        : "Enter the tile grid size.";
      return problems.length ? null : options;
    };
    const finish = (options: WorldTerrainExpandOptions | null): void => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolvePick(options);
    };
    const submit = (): void => {
      const options = refresh();
      if (options) finish(options);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") finish(null);
        else submit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    overlay.querySelector("form")!.addEventListener("input", () => refresh());
    overlay.querySelector("form")!.addEventListener("submit", (event) => { event.preventDefault(); submit(); });
    expand.addEventListener("click", submit);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || (event.target as HTMLElement).closest("[data-world-terrain-cancel]")) finish(null);
    });
    refresh();
    field("tilesX").focus();
    field("tilesX").select();
  });
}
