import { Box3, DataArrayTexture, DataTexture, Vector3, type WebGLRenderer } from "three";
import type { TerrainVertexRect } from "@engine/terrain/terrainRenderData";

type TerrainTexture = DataTexture | DataArrayTexture;

/** Deferred CPU-to-GPU copies; the texture images remain the authoritative mirrors. */
export class TerrainTextureUpdates {
  private readonly pending = new Map<TerrainTexture, Map<number, TerrainVertexRect>>();
  private readonly sources = new Map<TerrainTexture, DataTexture>();
  private readonly region = new Box3();
  private readonly position = new Vector3();

  constructor(private readonly textures: readonly TerrainTexture[]) {}

  add(texture: TerrainTexture, layer: number, rect: TerrainVertexRect): void {
    let layers = this.pending.get(texture);
    if (!layers) this.pending.set(texture, layers = new Map());
    const previous = layers.get(layer);
    layers.set(layer, previous ? {
      x0: Math.min(previous.x0, rect.x0), x1: Math.max(previous.x1, rect.x1),
      z0: Math.min(previous.z0, rect.z0), z1: Math.max(previous.z1, rect.z1),
    } : { ...rect });
  }

  flush(renderer: WebGLRenderer): void {
    for (const texture of this.textures) {
      // Three r184 exposes no public initialization query. Only inspect its
      // properties here; initTexture restores the entire CPU mirror after
      // first use/context loss. All uploads use public three APIs.
      const properties = renderer.properties.get(texture) as { __webglTexture?: unknown; __version?: number };
      if (!properties.__webglTexture || properties.__version !== texture.version) {
        if (texture instanceof DataArrayTexture) texture.clearLayerUpdates();
        renderer.initTexture(texture);
        this.pending.delete(texture);
        continue;
      }
      const layers = this.pending.get(texture);
      if (!layers) continue;
      let source = this.sources.get(texture);
      if (!source) {
        source = new DataTexture();
        this.sources.set(texture, source);
      }
      const { data, width, height } = texture.image;
      if (!data) continue;
      const depth = texture instanceof DataArrayTexture ? texture.image.depth : 1;
      const layerElements = data.length / depth;
      source.format = texture.format;
      source.type = texture.type;
      for (const [layer, rect] of layers) {
        // A separate, never-initialized DataTexture selects r184's CPU copy
        // path (using the destination itself would select a framebuffer copy).
        source.image = { data: data.subarray(layer * layerElements, (layer + 1) * layerElements), width, height };
        this.region.min.set(rect.x0, rect.z0, 0);
        this.region.max.set(rect.x1 + 1, rect.z1 + 1, 1);
        this.position.set(rect.x0, rect.z0, layer);
        renderer.copyTextureToTexture(source, texture, this.region, this.position);
      }
      this.pending.delete(texture);
    }
  }

  dispose(): void {
    this.pending.clear();
    for (const source of this.sources.values()) source.dispose();
    this.sources.clear();
  }
}
