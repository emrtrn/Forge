import {
  WORLD_TERRAIN_CREATE_DEFAULTS,
  WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT,
  WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE,
  WORLD_TERRAIN_CREATE_MAX_SPACING,
  WORLD_TERRAIN_CREATE_MIN_SPACING,
  WORLD_TERRAIN_CREATE_TILE_QUADS,
  estimateWorldTerrain,
  worldTerrainCreateProblems,
  worldTerrainHeightStep,
  type WorldTerrainCreateOptions,
  type WorldTerrainCreateTileQuads,
} from "@engine/terrain/worldTerrainCreate";
import { TERRAIN_DEFAULT_HEIGHT_MAX, TERRAIN_DEFAULT_HEIGHT_MIN, TERRAIN_MAX_TILES_PER_AXIS } from "@engine/terrain/terrainTypes";
import {
  openWorldSetupFromLevel,
  openWorldSetupNotes,
  openWorldSetupProblems,
  suggestedViewDistance,
  type OpenWorldSetup,
} from "@engine/world/openWorldSetup";
import { FAR_VIEW_MODE_THRESHOLD, VIEW_DISTANCE_MAX, VIEW_DISTANCE_MIN } from "@engine/world/viewDistance";

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const metres = (value: number): string => `${Number(value.toFixed(2))} m`;

/** What the dialog creates: the terrain grid, and for a multi-tile grid the level's open world settings. */
export interface NewLandscapeChoice {
  terrain: WorldTerrainCreateOptions;
  /** Null for a 1x1 Landscape: the level's settings stay as they are. */
  world: OpenWorldSetup | null;
}

/**
 * Asks for a new Landscape's tile grid (Add Actor → Landscape; 1x1 is the
 * classic single-grid Landscape). Shows the resulting world size and cost while
 * typing and only enables Create for options `createFlatWorldTerrain` accepts.
 * A multi-tile grid also opens the Open World section (OPEN_WORLD_PLAN Faz 8):
 * height range, World Partition, view distance and a fitted Height Fog, seeded
 * from the level's world settings and applied with the terrain as one undo
 * step. Resolves null on cancel.
 */
export function pickWorldTerrainOptions(
  levelSettings: { partition?: unknown; viewDistance?: number | undefined },
  initial: WorldTerrainCreateOptions = WORLD_TERRAIN_CREATE_DEFAULTS,
): Promise<NewLandscapeChoice | null> {
  const level = openWorldSetupFromLevel(levelSettings.partition, levelSettings.viewDistance);
  return new Promise((resolvePick) => {
    const overlay = document.createElement("div");
    overlay.className = "parent-class-overlay";
    overlay.innerHTML = `
      <div class="parent-class-dialog world-terrain-dialog" role="dialog" aria-label="New Landscape" data-world-terrain-dialog>
        <header class="parent-class-head">New Landscape</header>
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
          <fieldset class="world-terrain-open-world" data-open-world hidden>
            <legend>Open World</legend>
            <label><span>Height Min (m)</span><input data-field="heightMin" type="number" min="${-WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE}" max="0" step="1" /></label>
            <label><span>Height Max (m)</span><input data-field="heightMax" type="number" min="0" max="${WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE}" step="1" /></label>
            <label class="world-terrain-check"><input data-world="partition" type="checkbox" /><span>World Partition: stream actors by cell</span></label>
            <label><span>Cell Size (m)</span><input data-world="cellSize" type="number" min="1" step="any" /></label>
            <label><span>Loading Range (m)</span><input data-world="loadRange" type="number" min="1" step="any" /></label>
            <label><span>View Distance (m)</span><input data-world="viewDistance" type="number" min="${VIEW_DISTANCE_MIN}" max="${VIEW_DISTANCE_MAX}" step="50" placeholder="Camera default" /></label>
            <label class="world-terrain-check"><input data-world="fitFog" type="checkbox" /><span>Fit Height Fog to the view distance</span></label>
            <div class="world-terrain-actions"><button type="button" class="parent-class-cancel" data-open-world-suggest>Suggest for this world</button></div>
            <ul class="world-terrain-notes" data-open-world-notes></ul>
          </fieldset>
          <ul class="world-terrain-problems" data-world-terrain-problems></ul>
          <div class="detail-hint" data-world-terrain-multitile hidden>Multi-tile Splines support editing, terrain effects, mesh output and River Water.</div>
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
    const worldField = (name: keyof OpenWorldSetup | "cellSize" | "loadRange") =>
      form.querySelector<HTMLInputElement>(`[data-world="${name}"]`)!;
    field<HTMLInputElement>("name").value = initial.name;
    field<HTMLInputElement>("tilesX").value = String(initial.tilesX);
    field<HTMLInputElement>("tilesZ").value = String(initial.tilesZ);
    field<HTMLSelectElement>("tileQuads").value = String(initial.tileQuads);
    field<HTMLInputElement>("spacing").value = String(initial.spacing);
    field<HTMLInputElement>("baseHeight").value = String(initial.baseHeight);
    field<HTMLInputElement>("heightMin").value = String(initial.heightMin ?? TERRAIN_DEFAULT_HEIGHT_MIN);
    field<HTMLInputElement>("heightMax").value = String(initial.heightMax ?? TERRAIN_DEFAULT_HEIGHT_MAX);
    worldField("partition").checked = level.partition.enabled;
    worldField("cellSize").value = String(level.partition.cellSize);
    worldField("loadRange").value = String(level.partition.loadRange);
    worldField("viewDistance").value = level.viewDistance === null ? "" : String(level.viewDistance);
    worldField("fitFog").checked = level.fitFog;
    const create = overlay.querySelector<HTMLButtonElement>("[data-world-terrain-create]")!;
    const summary = overlay.querySelector<HTMLElement>("[data-world-terrain-summary]")!;
    const problemList = overlay.querySelector<HTMLElement>("[data-world-terrain-problems]")!;
    const multiTileNote = overlay.querySelector<HTMLElement>("[data-world-terrain-multitile]")!;
    const openWorld = overlay.querySelector<HTMLFieldSetElement>("[data-open-world]")!;
    const notes = overlay.querySelector<HTMLElement>("[data-open-world-notes]")!;

    const multiTile = (): boolean => Number(field<HTMLInputElement>("tilesX").value) * Number(field<HTMLInputElement>("tilesZ").value) > 1;
    const read = (): WorldTerrainCreateOptions => ({
      name: field<HTMLInputElement>("name").value,
      tilesX: Number(field<HTMLInputElement>("tilesX").value),
      tilesZ: Number(field<HTMLInputElement>("tilesZ").value),
      tileQuads: Number(field<HTMLSelectElement>("tileQuads").value) as WorldTerrainCreateTileQuads,
      spacing: Number(field<HTMLInputElement>("spacing").value),
      baseHeight: Number(field<HTMLInputElement>("baseHeight").value),
      // A 1x1 Landscape is edited as Float32 through the adapter: no encoding range to pick.
      ...(multiTile() ? {
        heightMin: Number(field<HTMLInputElement>("heightMin").value),
        heightMax: Number(field<HTMLInputElement>("heightMax").value),
      } : {}),
    });
    const readWorld = (): OpenWorldSetup | null => {
      if (!multiTile()) return null;
      const viewDistance = worldField("viewDistance").value.trim();
      return {
        partition: {
          enabled: worldField("partition").checked,
          cellSize: Number(worldField("cellSize").value),
          loadRange: Number(worldField("loadRange").value),
        },
        viewDistance: viewDistance === "" ? null : Number(viewDistance),
        fitFog: worldField("fitFog").checked,
      };
    };
    const refresh = (): NewLandscapeChoice | null => {
      const options = read();
      const world = readWorld();
      const problems = [...worldTerrainCreateProblems(options), ...(world ? openWorldSetupProblems(world) : [])];
      problemList.replaceChildren(...problems.map((problem) => Object.assign(document.createElement("li"), { textContent: problem })));
      create.disabled = problems.length > 0;
      multiTileNote.hidden = !multiTile();
      openWorld.hidden = !multiTile();
      const partitionOn = worldField("partition").checked;
      worldField("cellSize").disabled = !partitionOn;
      worldField("loadRange").disabled = !partitionOn;
      if (problems.length > 0) {
        summary.textContent = "";
        notes.replaceChildren();
        return null;
      }
      const estimate = estimateWorldTerrain(options);
      summary.textContent = `${metres(estimate.extent[0])} × ${metres(estimate.extent[1])} · ${estimate.tileCount} tile${estimate.tileCount === 1 ? "" : "s"} of ${metres(options.tileQuads * options.spacing)} · ` +
        `${(estimate.vertices / 1e6).toFixed(2)} M vertices · ~${megabytes(estimate.diskBytes)} on disk · ~${megabytes(estimate.memoryBytes)} in editor memory`;
      const lines = world ? [
        `Heights are stored in ${(worldTerrainHeightStep(options) * 100).toFixed(1)} cm steps; sculpting past the range widens it on Save.`,
        ...openWorldSetupNotes(world, estimate.extent),
      ] : [];
      notes.replaceChildren(...lines.map((line) => Object.assign(document.createElement("li"), { textContent: line })));
      return { terrain: options, world };
    };
    refresh();

    const finish = (value: NewLandscapeChoice | null): void => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolvePick(value);
    };
    const submit = (): void => {
      const choice = refresh();
      if (choice) finish({ ...choice, terrain: { ...choice.terrain, name: choice.terrain.name.trim() } });
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
    overlay.querySelector<HTMLButtonElement>("[data-open-world-suggest]")!.addEventListener("click", () => {
      const options = read();
      if (worldTerrainCreateProblems(options).length > 0) return;
      const distance = suggestedViewDistance(estimateWorldTerrain(options).extent);
      worldField("viewDistance").value = String(distance);
      worldField("partition").checked = true;
      // Past far view mode an unfogged terrain ends in a hard edge (Faz 7d).
      worldField("fitFog").checked = distance > FAR_VIEW_MODE_THRESHOLD;
      refresh();
    });
    overlay.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target === overlay || target.closest("[data-world-terrain-cancel]")) finish(null);
    });
    field<HTMLInputElement>("tilesX").focus();
    field<HTMLInputElement>("tilesX").select();
  });
}
