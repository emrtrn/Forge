import { worldCellBounds } from "@engine/world/worldGrid";
import {
  mapPixelToWorld,
  shadeWorldMapHeights,
  worldMapFrame,
  worldToMapPixel,
  type WorldMapRect,
} from "@engine/world/worldMapView";
import type { WorldPartitionTileView, WorldPartitionView } from "@/scene/SceneApp";

/** Canvas backing size; CSS scales it to the panel width. */
const MAP_SIZE = 512;

const COLORS = {
  background: "#15181b",
  unloaded: "rgba(8, 10, 12, 0.62)",
  loading: "rgba(240, 180, 60, 0.38)",
  tileLine: "rgba(255, 255, 255, 0.22)",
  unsaved: "#ff9b52",
  cellLine: "rgba(110, 200, 230, 0.28)",
  cellFill: "rgba(110, 200, 230, ",
  cellText: "#d8f3ff",
  camera: "#ffffff",
  range: "rgba(255, 255, 255, 0.55)",
} as const;

const TILE_STATE_LABEL: Record<WorldPartitionTileView["state"], string> = {
  resident: "loaded",
  loading: "loading",
  unloaded: "not loaded",
};

export interface WorldPartitionPanelOptions {
  body: HTMLElement;
  /** Moves the editor camera to look at world X/Z. */
  focus(x: number, z: number): void;
}

/**
 * World Partition panel (OPEN_WORLD_PLAN Faz 8, first slice): a top-down map
 * of the level — the terrain's hill-shaded global height map, its tiles by
 * editor residency (loaded / loading / not loaded) with unsaved tiles
 * outlined, the occupied partition cells with their element counts, and the
 * editor camera with its terrain load radius. Clicking the map moves the
 * camera there, which streams the tiles around it in.
 */
export class WorldPartitionPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly summary: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly shaded = document.createElement("canvas");
  private shadedRevision: string | null = null;
  private view: WorldPartitionView | null = null;
  private frame: WorldMapRect = worldMapFrame([]);

  constructor(options: WorldPartitionPanelOptions) {
    options.body.innerHTML = `
      <div class="world-partition-panel" data-world-partition>
        <div class="world-partition-summary" data-wp-summary></div>
        <canvas class="world-partition-map" data-wp-map width="${MAP_SIZE}" height="${MAP_SIZE}" role="img" aria-label="World map"></canvas>
        <div class="world-partition-hover" data-wp-hover>Click the map to move the camera there.</div>
        <ul class="world-partition-legend">
          <li><i class="is-loaded"></i>Loaded tile</li>
          <li><i class="is-loading"></i>Loading</li>
          <li><i class="is-unloaded"></i>Not loaded</li>
          <li><i class="is-unsaved"></i>Unsaved edits</li>
          <li><i class="is-cell"></i>Partition cell</li>
          <li><i class="is-camera"></i>Camera</li>
        </ul>
      </div>
    `;
    this.canvas = options.body.querySelector<HTMLCanvasElement>("[data-wp-map]")!;
    this.summary = options.body.querySelector<HTMLElement>("[data-wp-summary]")!;
    this.hover = options.body.querySelector<HTMLElement>("[data-wp-hover]")!;
    this.canvas.addEventListener("click", (event) => {
      const [x, z] = this.eventWorld(event);
      options.focus(x, z);
    });
    this.canvas.addEventListener("mousemove", (event) => {
      const [x, z] = this.eventWorld(event);
      this.hover.textContent = this.describe(x, z);
    });
    this.canvas.addEventListener("mouseleave", () => {
      this.hover.textContent = "Click the map to move the camera there.";
    });
  }

  update(view: WorldPartitionView): void {
    this.view = view;
    const rects: WorldMapRect[] = [];
    if (view.terrain) rects.push(view.terrain.rect);
    const grid = view.partition.grids.main;
    for (const cell of view.cells) rects.push(worldCellBounds(grid, cell.x, cell.z));
    if (rects.length === 0) rects.push({ minX: view.camera.x - 128, minZ: view.camera.z - 128, maxX: view.camera.x + 128, maxZ: view.camera.z + 128 });
    this.frame = worldMapFrame(rects);
    this.summary.innerHTML = this.summaryMarkup(view);
    this.draw(view);
  }

  private summaryMarkup(view: WorldPartitionView): string {
    const lines: string[] = [];
    const terrain = view.terrain;
    if (terrain) {
      const loaded = terrain.tiles.filter((tile) => tile.state === "resident").length;
      const loading = terrain.tiles.filter((tile) => tile.state === "loading").length;
      const unsaved = terrain.tiles.filter((tile) => tile.unsaved).length;
      const width = Math.round(terrain.rect.maxX - terrain.rect.minX);
      const depth = Math.round(terrain.rect.maxZ - terrain.rect.minZ);
      lines.push(`<strong>${escapeHtml(terrain.name)}</strong> · ${terrain.tilesX} × ${terrain.tilesZ} tiles · ${width} m × ${depth} m`);
      lines.push(`<span data-wp-tiles>${loaded}/${terrain.tiles.length} loaded${loading > 0 ? ` · ${loading} loading` : ""} · ${unsaved} unsaved</span>`
        + (terrain.streams ? ` · streams around the camera (${Math.round(terrain.loadRange ?? 0)} m)` : " · all tiles in memory"));
    } else {
      lines.push("No Landscape in this level.");
    }
    const { enabled, grids } = view.partition;
    const elements = view.cells.reduce((sum, cell) => sum + cell.count, 0);
    lines.push(enabled
      ? `<span data-wp-cells>World Partition on · ${grids.main.cellSize} m cells, ${grids.main.loadRange} m range · ${view.cells.length} occupied cell${view.cells.length === 1 ? "" : "s"}, ${elements} streamed element${elements === 1 ? "" : "s"}</span>`
      : `<span data-wp-cells>World Partition off</span> (World Settings › World Partition)`);
    return lines.map((line) => `<div>${line}</div>`).join("");
  }

  private draw(view: WorldPartitionView): void {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    const terrain = view.terrain;
    if (terrain) {
      const [x0, y0] = this.pixel(terrain.rect.minX, terrain.rect.minZ);
      const [x1, y1] = this.pixel(terrain.rect.maxX, terrain.rect.maxZ);
      if (terrain.map) {
        if (this.shadedRevision !== terrain.mapRevision) this.shade(terrain.map, terrain.metresPerSample, terrain.mapRevision);
        context.imageSmoothingEnabled = true;
        context.drawImage(this.shaded, x0, y0, x1 - x0, y1 - y0);
      } else {
        context.fillStyle = "#3b4a3d";
        context.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      const tileW = (x1 - x0) / terrain.tilesX;
      const tileH = (y1 - y0) / terrain.tilesZ;
      for (const tile of terrain.tiles) {
        const tx = x0 + tile.x * tileW;
        const ty = y0 + tile.z * tileH;
        if (tile.state !== "resident") {
          context.fillStyle = tile.state === "loading" ? COLORS.loading : COLORS.unloaded;
          context.fillRect(tx, ty, tileW, tileH);
        }
        if (tileW >= 6) {
          context.strokeStyle = COLORS.tileLine;
          context.lineWidth = 1;
          context.strokeRect(tx + 0.5, ty + 0.5, tileW - 1, tileH - 1);
        }
      }
      for (const tile of terrain.tiles) {
        if (!tile.unsaved) continue;
        context.strokeStyle = COLORS.unsaved;
        context.lineWidth = 2;
        context.strokeRect(x0 + tile.x * tileW + 1, y0 + tile.z * tileH + 1, tileW - 2, tileH - 2);
      }
    }
    if (view.partition.enabled) this.drawCells(context, view);
    this.drawCamera(context, view);
  }

  private drawCells(context: CanvasRenderingContext2D, view: WorldPartitionView): void {
    const grid = view.partition.grids.main;
    const most = Math.max(1, ...view.cells.map((cell) => cell.count));
    context.font = "10px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const cell of view.cells) {
      const bounds = worldCellBounds(grid, cell.x, cell.z);
      const [x0, y0] = this.pixel(bounds.minX, bounds.minZ);
      const [x1, y1] = this.pixel(bounds.maxX, bounds.maxZ);
      context.fillStyle = `${COLORS.cellFill}${(0.12 + 0.33 * (cell.count / most)).toFixed(3)})`;
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
      context.strokeStyle = COLORS.cellLine;
      context.lineWidth = 1;
      context.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      if (x1 - x0 >= 18) {
        context.fillStyle = COLORS.cellText;
        context.fillText(String(cell.count), (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  }

  private drawCamera(context: CanvasRenderingContext2D, view: WorldPartitionView): void {
    const [cx, cy] = this.pixel(view.camera.x, view.camera.z);
    const range = view.terrain?.streams ? view.terrain.loadRange : null;
    if (range) {
      const [rx] = this.pixel(view.camera.x + range, view.camera.z);
      context.strokeStyle = COLORS.range;
      context.setLineDash([4, 4]);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cx, cy, Math.abs(rx - cx), 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    const length = Math.hypot(view.camera.forwardX, view.camera.forwardZ);
    const angle = length > 1e-6 ? Math.atan2(view.camera.forwardZ, view.camera.forwardX) : -Math.PI / 2;
    context.save();
    context.translate(cx, cy);
    context.rotate(angle);
    context.fillStyle = COLORS.camera;
    context.strokeStyle = "#000000";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(-6, -6);
    context.lineTo(-3, 0);
    context.lineTo(-6, 6);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private shade(map: NonNullable<NonNullable<WorldPartitionView["terrain"]>["map"]>, metresPerSample: number, revision: string): void {
    this.shaded.width = map.width;
    this.shaded.height = map.height;
    const context = this.shaded.getContext("2d");
    if (!context) return;
    const pixels = shadeWorldMapHeights(map, metresPerSample);
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), map.width, map.height), 0, 0);
    this.shadedRevision = revision;
  }

  private describe(x: number, z: number): string {
    const view = this.view;
    if (!view) return "";
    const parts: string[] = [];
    const terrain = view.terrain;
    if (terrain && x >= terrain.rect.minX && x < terrain.rect.maxX && z >= terrain.rect.minZ && z < terrain.rect.maxZ) {
      const tx = Math.floor((x - terrain.rect.minX) / terrain.tileSize);
      const tz = Math.floor((z - terrain.rect.minZ) / terrain.tileSize);
      const tile = terrain.tiles.find((entry) => entry.x === tx && entry.z === tz);
      parts.push(tile ? `Tile ${tile.key} · ${TILE_STATE_LABEL[tile.state]}${tile.unsaved ? " · unsaved" : ""}` : `Tile ${tx}_${tz} · hole`);
    }
    if (view.partition.enabled) {
      const size = view.partition.grids.main.cellSize;
      const cx = Math.floor(x / size);
      const cz = Math.floor(z / size);
      const cell = view.cells.find((entry) => entry.x === cx && entry.z === cz);
      parts.push(`Cell ${cx}_${cz} · ${cell ? `${cell.count} element${cell.count === 1 ? "" : "s"}` : "empty"}`);
    }
    parts.push(`${Math.round(x)}, ${Math.round(z)}`);
    return parts.join(" · ");
  }

  private pixel(x: number, z: number): [number, number] {
    return worldToMapPixel(this.frame, MAP_SIZE, x, z);
  }

  private eventWorld(event: MouseEvent): [number, number] {
    const bounds = this.canvas.getBoundingClientRect();
    const px = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * MAP_SIZE;
    const py = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * MAP_SIZE;
    return mapPixelToWorld(this.frame, MAP_SIZE, px, py);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}
