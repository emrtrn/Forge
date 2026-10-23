import {
  WORLD_TERRAIN_CREATE_DEFAULTS,
  WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT,
  WORLD_TERRAIN_CREATE_MAX_SPACING,
  WORLD_TERRAIN_CREATE_MIN_SPACING,
  WORLD_TERRAIN_CREATE_TILE_QUADS,
  estimateWorldTerrain,
  worldTerrainCreateProblems,
  type WorldTerrainCreateOptions,
  type WorldTerrainCreateTileQuads,
} from "@engine/terrain/worldTerrainCreate";
import { TERRAIN_MAX_TILES_PER_AXIS } from "@engine/terrain/terrainTypes";

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const metres = (value: number): string => `${Number(value.toFixed(2))} m`;

/**
 * Asks for a new World Terrain's grid (Add Actor → World Terrain). Shows the
 * resulting world size and cost while typing and only enables Create for
 * options `createFlatWorldTerrain` accepts. Resolves null on cancel.
 */
export function pickWorldTerrainOptions(initial: WorldTerrainCreateOptions = WORLD_TERRAIN_CREATE_DEFAULTS): Promise<WorldTerrainCreateOptions | null> {
  return new Promise((resolvePick) => {
    const overlay = document.createElement("div");
    overlay.className = "parent-class-overlay";
    overlay.innerHTML = `
      <div class="parent-class-dialog world-terrain-dialog" role="dialog" aria-label="New World Terrain" data-world-terrain-dialog>
        <header class="parent-class-head">New World Terrain</header>
        <form class="world-terrain-form" data-world-terrain-form novalidate>
          <label><span>Name</span><input data-field="name" type="text" maxlength="80" /></label>
          <label><span>Tiles X</span><input data-field="tilesX" type="number" min="1" max="${TERRAIN_MAX_TILES_PER_AXIS}" step="1" /></label>
          <label><span>Tiles Z</span><input data-field="tilesZ" type="number" min="1" max="${TERRAIN_MAX_TILES_PER_AXIS}" step="1" /></label>
          <label><span>Tile Resolution</span><select data-field="tileQuads">${WORLD_TERRAIN_CREATE_TILE_QUADS.map(
            (quads) => `<option value="${quads}">${quads} × ${quads} quads</option>`,
          ).join("")}</select></label>
          <label><span>Vertex Spacing (m)</span><input data-field="spacing" type="number" min="${WORLD_TERRAIN_CREATE_MIN_SPACING}" max="${WORLD_TERRAIN_CREATE_MAX_SPACING}" step="0.25" /></label>
          <label><span>Base Height (m)</span><input data-field="baseHeight" type="number" min="${-WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT}" max="${WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT}" step="0.5" /></label>
          <div class="world-terrain-summary" data-world-terrain-summary></div>
          <ul class="world-terrain-problems" data-world-terrain-problems></ul>
          <div class="detail-hint">Flat and centred on the world origin, with the default Grass/Dirt/Rock/Snow layers. Save writes the tiles into this level's terrain folder.</div>
        </form>
        <footer class="parent-class-foot">
          <button type="button" class="parent-class-cancel" data-world-terrain-cancel>Cancel</button>
          <button type="button" class="parent-class-cancel world-terrain-create" data-world-terrain-create>Create</button>
        </footer>
      </div>
    `;
    document.body.append(overlay);
    const form = overlay.querySelector<HTMLFormElement>("[data-world-terrain-form]")!;
    const field = <T extends HTMLInputElement | HTMLSelectElement>(name: keyof WorldTerrainCreateOptions) =>
      form.querySelector<T>(`[data-field="${name}"]`)!;
    field<HTMLInputElement>("name").value = initial.name;
    field<HTMLInputElement>("tilesX").value = String(initial.tilesX);
    field<HTMLInputElement>("tilesZ").value = String(initial.tilesZ);
    field<HTMLSelectElement>("tileQuads").value = String(initial.tileQuads);
    field<HTMLInputElement>("spacing").value = String(initial.spacing);
    field<HTMLInputElement>("baseHeight").value = String(initial.baseHeight);
    const create = overlay.querySelector<HTMLButtonElement>("[data-world-terrain-create]")!;
    const summary = overlay.querySelector<HTMLElement>("[data-world-terrain-summary]")!;
    const problemList = overlay.querySelector<HTMLElement>("[data-world-terrain-problems]")!;

    const read = (): WorldTerrainCreateOptions => ({
      name: field<HTMLInputElement>("name").value,
      tilesX: Number(field<HTMLInputElement>("tilesX").value),
      tilesZ: Number(field<HTMLInputElement>("tilesZ").value),
      tileQuads: Number(field<HTMLSelectElement>("tileQuads").value) as WorldTerrainCreateTileQuads,
      spacing: Number(field<HTMLInputElement>("spacing").value),
      baseHeight: Number(field<HTMLInputElement>("baseHeight").value),
    });
    const refresh = (): WorldTerrainCreateOptions | null => {
      const options = read();
      const problems = worldTerrainCreateProblems(options);
      problemList.replaceChildren(...problems.map((problem) => Object.assign(document.createElement("li"), { textContent: problem })));
      create.disabled = problems.length > 0;
      if (problems.length > 0) {
        summary.textContent = "";
        return null;
      }
      const estimate = estimateWorldTerrain(options);
      summary.textContent = `${metres(estimate.extent[0])} × ${metres(estimate.extent[1])} · ${estimate.tileCount} tiles of ${metres(options.tileQuads * options.spacing)} · ` +
        `${(estimate.vertices / 1e6).toFixed(2)} M vertices · ~${megabytes(estimate.diskBytes)} on disk · ~${megabytes(estimate.memoryBytes)} in editor memory`;
      return options;
    };
    refresh();

    const finish = (value: WorldTerrainCreateOptions | null): void => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolvePick(value);
    };
    const submit = (): void => {
      const options = refresh();
      if (options) finish({ ...options, name: options.name.trim() });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    form.addEventListener("input", () => refresh());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    create.addEventListener("click", submit);
    overlay.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target === overlay || target.closest("[data-world-terrain-cancel]")) finish(null);
    });
    field<HTMLInputElement>("tilesX").focus();
    field<HTMLInputElement>("tilesX").select();
  });
}
