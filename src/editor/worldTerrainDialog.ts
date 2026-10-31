import {
  WORLD_TERRAIN_CREATE_DEFAULTS,
  WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT,
  WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE,
  WORLD_TERRAIN_CREATE_MAX_SPACING,
  WORLD_TERRAIN_CREATE_MIN_SPACING,
  WORLD_TERRAIN_CREATE_TILE_QUADS,
  estimateWorldTerrain,
  worldTerrainCreateProblems,
  worldTerrainGridForHeightmap,
  worldTerrainHeightmapProblems,
  worldTerrainHeightStep,
  type WorldTerrainCreateOptions,
  type WorldTerrainCreateTileQuads,
  type WorldTerrainHeightmapSource,
} from "@engine/terrain/worldTerrainCreate";
import { decodeHeightmapPng } from "@engine/terrain/heightmapPng";
import { heightmapSamplesToRaw } from "@engine/terrain/terrainImport";
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

/** What the dialog creates: the terrain grid and the level's open world settings. */
export interface NewLandscapeChoice {
  terrain: WorldTerrainCreateOptions;
  /** Seeded from the level, so leaving the section alone changes nothing. */
  world: OpenWorldSetup;
  /** Heights to start from instead of a flat grid (its size matches the grid). */
  heightmap: WorldTerrainHeightmapSource | null;
}

/** A picked heightmap file, as u16 samples (a PNG is converted to little-endian RAW). */
interface PickedHeightmap {
  name: string;
  png: boolean;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Asks for a new Landscape's tile grid (Add Actor → Landscape; 1x1 is the
 * classic single-grid Landscape). Shows the resulting world size and cost while
 * typing and only enables Create for options `createFlatWorldTerrain` accepts.
 * The Open World section (OPEN_WORLD_PLAN Faz 8) sets World Partition, the
 * view distance and a fitted Height Fog for any grid (a 1x1 tile reaches 2 km at
 * 8 m spacing), seeded from the level's world settings and applied with the
 * terrain as one undo step. The height range is multi-tile only: those tiles
 * store u16 heights whose step it sets, while a 1x1 Landscape saves Float32 and
 * its range only follows the data. An optional 16-bit PNG/RAW heightmap
 * starts the terrain from its heights: picking one fits the grid to its size
 * (never resampled), and its 0/65535 metres become the encoding range.
 * Resolves null on cancel.
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
          <fieldset class="world-terrain-open-world" data-heightmap-section>
            <legend>Heightmap (optional)</legend>
            <label><span>16-bit PNG or RAW</span><input data-heightmap-file type="file" accept=".png,.raw,.r16,image/png" /></label>
            <label data-heightmap-row data-heightmap-raw><span>RAW Byte Order</span><select data-heightmap-order>
              <option value="little">Little-endian</option><option value="big">Big-endian</option>
            </select></label>
            <label data-heightmap-row><span>Min Height (0), m</span><input data-heightmap-min type="number" step="any" value="${TERRAIN_DEFAULT_HEIGHT_MIN}" /></label>
            <label data-heightmap-row><span>Max Height (65535), m</span><input data-heightmap-max type="number" step="any" value="${TERRAIN_DEFAULT_HEIGHT_MAX}" /></label>
            <div class="world-terrain-actions" data-heightmap-row><button type="button" class="parent-class-cancel" data-heightmap-remove>Remove Heightmap</button></div>
            <ul class="world-terrain-notes" data-heightmap-status></ul>
          </fieldset>
          <fieldset class="world-terrain-open-world" data-open-world>
            <legend>Open World</legend>
            <label data-height-range><span>Height Min (m)</span><input data-field="heightMin" type="number" min="${-WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE}" max="0" step="1" /></label>
            <label data-height-range><span>Height Max (m)</span><input data-field="heightMax" type="number" min="0" max="${WORLD_TERRAIN_CREATE_MAX_HEIGHT_RANGE}" step="1" /></label>
            <label class="world-terrain-check"><input data-world="partition" type="checkbox" /><span>World Partition: stream actors by cell</span></label>
            <label><span>Cell Size (m)</span><input data-world="cellSize" type="number" min="1" step="any" /></label>
            <label><span>Loading Range (m)</span><input data-world="loadRange" type="number" min="1" step="any" /></label>
            <label><span>View Distance (m)</span><input data-world="viewDistance" type="number" min="${VIEW_DISTANCE_MIN}" max="${VIEW_DISTANCE_MAX}" step="50" placeholder="Camera default" /></label>
            <label class="world-terrain-check"><input data-world="fitFog" type="checkbox" /><span>Fit Height Fog to the view distance</span></label>
            <div class="world-terrain-actions"><button type="button" class="parent-class-cancel" data-open-world-suggest>Suggest for this world</button></div>
            <ul class="world-terrain-notes" data-open-world-notes></ul>
          </fieldset>
          <ul class="world-terrain-problems" data-world-terrain-problems></ul>
          <div class="detail-hint" data-world-terrain-multitile hidden>Çok tile'lı Spline'lar düzenleme, arazi etkileri, mesh çıktısı ve River Water destekler.</div>
          <div class="detail-hint">Varsayılan Grass/Dirt/Rock/Snow katmanlarıyla dünya orijinine ortalanır; heightmap seçilmezse düzdür. Save, tile'ları bu level'ın arazi klasörüne yazar.</div>
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
    const heightRows = [...overlay.querySelectorAll<HTMLElement>("[data-height-range]")];
    const notes = overlay.querySelector<HTMLElement>("[data-open-world-notes]")!;
    const heightmapFile = overlay.querySelector<HTMLInputElement>("[data-heightmap-file]")!;
    const heightmapRows = [...overlay.querySelectorAll<HTMLElement>("[data-heightmap-row]")];
    const heightmapRawRow = overlay.querySelector<HTMLElement>("[data-heightmap-raw]")!;
    const heightmapStatus = overlay.querySelector<HTMLElement>("[data-heightmap-status]")!;
    let picked: PickedHeightmap | null = null;
    const setHeightmapStatus = (...lines: string[]) =>
      heightmapStatus.replaceChildren(...lines.map((line) => Object.assign(document.createElement("li"), { textContent: line })));
    const readHeightmap = (): WorldTerrainHeightmapSource | null => picked && {
      bytes: picked.bytes, width: picked.width, height: picked.height,
      endianness: picked.png ? "little" : overlay.querySelector<HTMLSelectElement>("[data-heightmap-order]")!.value as "little" | "big",
      heightMin: Number(overlay.querySelector<HTMLInputElement>("[data-heightmap-min]")!.value),
      heightMax: Number(overlay.querySelector<HTMLInputElement>("[data-heightmap-max]")!.value),
    };

    const multiTile = (): boolean => Number(field<HTMLInputElement>("tilesX").value) * Number(field<HTMLInputElement>("tilesZ").value) > 1;
    const read = (): WorldTerrainCreateOptions => ({
      name: field<HTMLInputElement>("name").value,
      tilesX: Number(field<HTMLInputElement>("tilesX").value),
      tilesZ: Number(field<HTMLInputElement>("tilesZ").value),
      tileQuads: Number(field<HTMLSelectElement>("tileQuads").value) as WorldTerrainCreateTileQuads,
      spacing: Number(field<HTMLInputElement>("spacing").value),
      baseHeight: Number(field<HTMLInputElement>("baseHeight").value),
      // A 1x1 Landscape is edited as Float32 through the adapter: no encoding range
      // to pick; a heightmap brings its own.
      ...(multiTile() && !picked ? {
        heightMin: Number(field<HTMLInputElement>("heightMin").value),
        heightMax: Number(field<HTMLInputElement>("heightMax").value),
      } : {}),
    });
    const readWorld = (): OpenWorldSetup => {
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
      const heightmap = readHeightmap();
      const problems = [
        ...worldTerrainCreateProblems(options), ...openWorldSetupProblems(world),
        ...(heightmap ? worldTerrainHeightmapProblems(options, heightmap) : []),
      ];
      problemList.replaceChildren(...problems.map((problem) => Object.assign(document.createElement("li"), { textContent: problem })));
      create.disabled = problems.length > 0;
      multiTileNote.hidden = !multiTile();
      for (const row of heightRows) row.hidden = !multiTile() || Boolean(heightmap);
      for (const row of heightmapRows) row.hidden = !heightmap;
      heightmapRawRow.hidden = !heightmap || Boolean(picked?.png);
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
      const range = heightmap ?? options;
      const lines = [
        ...(multiTile() ? [`Heights are stored in ${(worldTerrainHeightStep(range) * 100).toFixed(1)} cm steps${
          heightmap ? " (the heightmap's range)" : ""}; sculpting past the range widens it on Save.`] : []),
        ...openWorldSetupNotes(world, estimate.extent),
      ];
      notes.replaceChildren(...lines.map((line) => Object.assign(document.createElement("li"), { textContent: line })));
      return { terrain: options, world, heightmap };
    };

    /** Reads a picked PNG/RAW and fits the grid to its size; the file is never resampled. */
    const pickHeightmap = async (file: File): Promise<void> => {
      picked = null;
      setHeightmapStatus(`Reading ${file.name}…`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const png = /\.png$/i.test(file.name) || file.type === "image/png";
        let next: PickedHeightmap;
        if (png) {
          const decoded = await decodeHeightmapPng(bytes);
          next = { name: file.name, png, bytes: heightmapSamplesToRaw(decoded.samples), width: decoded.width, height: decoded.height };
        } else {
          // RAW has no header: a square is inferred, anything else must match the current grid.
          const side = Math.sqrt(bytes.byteLength / 2);
          const current = read();
          const [width, height] = Number.isInteger(side)
            ? [side, side]
            : [current.tilesX * current.tileQuads + 1, current.tilesZ * current.tileQuads + 1];
          next = { name: file.name, png, bytes, width, height };
        }
        picked = next;
        const grid = worldTerrainGridForHeightmap(next.width, next.height, read().tileQuads);
        if (grid) {
          field<HTMLInputElement>("tilesX").value = String(grid.tilesX);
          field<HTMLInputElement>("tilesZ").value = String(grid.tilesZ);
          field<HTMLSelectElement>("tileQuads").value = String(grid.tileQuads);
          setHeightmapStatus(`${next.name}: ${next.width} × ${next.height} samples → ${grid.tilesX} × ${grid.tilesZ} tiles of ${grid.tileQuads} quads.`);
        } else {
          setHeightmapStatus(`${next.name}: ${next.width} × ${next.height} samples fit no tile grid here ((size − 1) must be a multiple of 64, 128 or 256, within 64 tiles of 256 quads); no resampling.`);
        }
      } catch (error) {
        heightmapFile.value = "";
        setHeightmapStatus(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      refresh();
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
    heightmapFile.addEventListener("change", () => {
      const file = heightmapFile.files?.[0];
      if (file) void pickHeightmap(file);
    });
    overlay.querySelector<HTMLButtonElement>("[data-heightmap-remove]")!.addEventListener("click", () => {
      picked = null;
      heightmapFile.value = "";
      setHeightmapStatus();
      refresh();
    });
    form.addEventListener("input", (event) => {
      if (event.target !== heightmapFile) refresh();
    });
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
