import { Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from "three";

import { createForgeGltfLoader } from "@engine/render-three/gltfLoader";
import { distanceToWorldCell, parseWorldCellKey } from "@engine/world/worldGrid";
import { hlodCellPath, hlodIndexPath, normalizeHlodIndex, type HlodIndex } from "@engine/world/hlod";
import { readContentJson } from "@/project/contentLoader";
import { projectFileUrl } from "@/project/ProjectSystem";

/**
 * HLOD proxies in Play (OPEN_WORLD_PLAN Faz 7f). Each `main` cell with an HLOD
 * shows its baked, vertex-coloured proxy while it is within the view distance
 * but its statics are not active; when the cell activates the real meshes take
 * over and the proxy hides. Proxies are read on demand and dropped past 1.25×
 * the view distance. One shared material: no textures, no shadow casting.
 */

/** Proxies fetched at once; the rest wait for a later frame. */
const MAX_IN_FLIGHT = 4;
/** Loaded proxies are dropped past this multiple of the view distance. */
const RELEASE_FACTOR = 1.25;

interface ProxyCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  mesh: Mesh | null;
  loading: boolean;
  /** A failed read is not retried for this level. */
  failed: boolean;
}

export interface HlodProxiesOptions {
  readonly index: HlodIndex;
  readonly parent: Object3D;
  /** Reads one cell's proxy geometry (null when unreadable). */
  readonly load: (key: string) => Promise<BufferGeometry | null>;
}

export class HlodProxies {
  private readonly cells: ProxyCell[];
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  private readonly grid: { cellSize: number };
  private inFlight = 0;
  private disposed = false;

  constructor(private readonly options: HlodProxiesOptions) {
    this.grid = { cellSize: options.index.cellSize };
    this.cells = options.index.cells.flatMap((entry) => {
      const coord = parseWorldCellKey(entry.key);
      return coord ? [{ key: entry.key, x: coord.x, z: coord.z, mesh: null, loading: false, failed: false }] : [];
    });
  }

  /**
   * Per frame: shows the proxy of every cell within `viewDistance` of the
   * camera whose statics are not active, starts reads for missing ones and
   * drops proxies far outside the view.
   */
  update(cameraX: number, cameraZ: number, viewDistance: number, isCellActive: (key: string) => boolean): void {
    for (const cell of this.cells) {
      const distance = distanceToWorldCell(this.grid, cell.x, cell.z, cameraX, cameraZ);
      if (distance > viewDistance * RELEASE_FACTOR) {
        this.release(cell);
        continue;
      }
      const wanted = distance <= viewDistance && !isCellActive(cell.key);
      if (cell.mesh) cell.mesh.visible = wanted;
      else if (wanted) this.request(cell);
    }
  }

  /** Proxies currently drawn (for `?debug` and smokes). */
  visibleCount(): number {
    return this.cells.reduce((count, cell) => count + (cell.mesh?.visible ? 1 : 0), 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const cell of this.cells) this.release(cell);
    this.material.dispose();
  }

  private request(cell: ProxyCell): void {
    if (cell.loading || cell.failed || this.inFlight >= MAX_IN_FLIGHT) return;
    cell.loading = true;
    this.inFlight += 1;
    this.options.load(cell.key)
      .then((geometry) => {
        if (this.disposed) {
          geometry?.dispose();
          return;
        }
        if (!geometry) {
          cell.failed = true;
          return;
        }
        const mesh = new Mesh(geometry, this.material);
        mesh.name = `hlod-${cell.key}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Hidden until the next update decides; never picked or collided.
        mesh.visible = false;
        mesh.raycast = () => {};
        cell.mesh = mesh;
        this.options.parent.add(mesh);
      })
      .catch((error: unknown) => {
        cell.failed = true;
        console.warn(`[hlod] cell ${cell.key} failed to load`, error);
      })
      .finally(() => {
        cell.loading = false;
        this.inFlight -= 1;
      });
  }

  private release(cell: ProxyCell): void {
    if (!cell.mesh) return;
    cell.mesh.removeFromParent();
    cell.mesh.geometry.dispose();
    cell.mesh = null;
  }
}

/** The level's HLOD index (`npm run world:build`), or null when it has none. */
export async function fetchHlodIndex(levelPath: string): Promise<HlodIndex | null> {
  const raw = await readContentJson(hlodIndexPath(levelPath), true);
  return raw === undefined ? null : normalizeHlodIndex(raw);
}

/** Reads one cell's proxy GLB and returns its (single) mesh geometry. */
export async function loadHlodGeometry(levelPath: string, key: string): Promise<BufferGeometry | null> {
  const response = await fetch(projectFileUrl(hlodCellPath(levelPath, key)), { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const gltf = await createForgeGltfLoader().parseAsync(await response.arrayBuffer(), "");
  let geometry: BufferGeometry | null = null;
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (geometry || !mesh.isMesh) return;
    mesh.updateWorldMatrix(true, false);
    // The proxy is baked in world space; keep any root transform the file carries.
    geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  });
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  return geometry;
}
