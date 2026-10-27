import { Vector2, Vector3, type PerspectiveCamera, type WebGLRenderer, type Scene, type Group } from "three";
import type { LakeWaterController } from "@/scene/lakeWaterController";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import type { TerrainEditorStreaming } from "@engine/terrain/terrainEditorStreaming";
import { pendingTerrainLoads } from "./terrain-probe-state";
import type { SceneApp } from "@/scene/SceneApp";
import type { WorldTerrainEditSession } from "@/editor/terrainStore";

export function installLakeProbe(app: unknown) {
  const a = app as { camera: PerspectiveCamera; canvas: HTMLCanvasElement; lakes: LakeWaterController | null;
    selection: { kind: string; index?: number } | null;
    renderer: WebGLRenderer; scene: Scene; frameHandle: number; landscapeObjects: Group[];
    postProcessPipeline: { render(dt: number): void } | null;
    worldTerrainStreams?: Map<WorldTerrainDocument, TerrainEditorStreaming>;
    getLakeEditorState?: SceneApp["getLakeEditorState"];
    worldTerrainSessions?: WeakMap<WorldTerrainDocument, WorldTerrainEditSession>;
    worldTerrains?: Map<string, WorldTerrainDocument>; worldTerrainDocuments?: Map<string, WorldTerrainDocument> };
  (window as any).__lakeQA = {
    editor() {
      return { state: a.getLakeEditorState?.(), selection: a.selection,
        terrain: [...(a.worldTerrains ?? a.worldTerrainDocuments ?? [])].map(([id, doc]) => {
          let hash = 2166136261;
          for (const [key, t] of [...doc.tiles].sort(([a], [b]) => a.localeCompare(b))) {
            for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
            for (const buffer of [t.heights, t.weights]) for (const v of new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)) hash = Math.imul(hash ^ v, 16777619);
          }
          return { id, hash: hash >>> 0, dirty: a.worldTerrainSessions?.get(doc)?.dirtyKeys() ?? [], keys: [...doc.tiles.keys()].sort() };
        }) };
    },
    async gpuPilot() {
      cancelAnimationFrame(a.frameHandle);
      const renderer = a.renderer, gl = renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (!ext) return { available: false, device, reason: "GPU timer extension unavailable" };
      const surfaces = [...(a.lakes?.objects.values() ?? [])], visible = surfaces.map((o) => o.visible);
      const queries: Array<{ query: WebGLQuery; wet: boolean }> = [], baseline: number[] = [], water: number[] = [], calls: number[] = [];
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const render = (wet: boolean) => {
        for (let i = 0; i < surfaces.length; i++) surfaces[i]!.visible = wet && visible[i]!;
        // Forge keeps autoReset=false so nested captures count in the parent.
        // Each A/B sample still needs its own frame boundary.
        renderer.info.reset();
        renderer.render(a.scene, a.camera);
      };
      try {
        for (let i = 0; i < 5; i++) { render(false); render(true); await frame(); }
        if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return { available: false, device, reason: "GPU timer already owned" };
        for (let i = 0; i < 300; i++) {
          for (const wet of [false, true]) {
            const query = gl.createQuery()!;
            gl.beginQuery(ext.TIME_ELAPSED_EXT, query); render(wet); gl.endQuery(ext.TIME_ELAPSED_EXT);
            queries.push({ query, wet }); if (i === 299) calls.push(renderer.info.render.calls);
          }
          await frame();
        }
        for (let i = 0; i < 120 && queries.some(({ query }) => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)); i++) await frame();
        if (gl.getParameter(ext.GPU_DISJOINT_EXT) || queries.some(({ query }) => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) return { available: false, device, reason: "GPU timing disjoint or unavailable" };
        for (const { query, wet } of queries) (wet ? water : baseline).push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        const p95 = (values: number[]) => [...values].sort((x, y) => x - y)[Math.ceil(values.length * 0.95) - 1]!;
        return { available: true, device, frames: water.length, viewport: renderer.getSize(new Vector2()).toArray(), baselineP95Ms: p95(baseline), waterP95Ms: p95(water), pairedDeltaP95Ms: p95(water.map((v, i) => v - baseline[i]!)), additionalCalls: calls[1]! - calls[0]! };
      } finally {
        for (const { query } of queries) gl.deleteQuery(query);
        for (let i = 0; i < surfaces.length; i++) surfaces[i]!.visible = visible[i]!;
      }
    },
    project(x: number, y: number, z: number) {
      a.camera.updateMatrixWorld(true); const p = new Vector3(x, y, z).project(a.camera), r = a.canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
    },
    frame(overhead = false) {
      cancelAnimationFrame(a.frameHandle);
      // Gameplay cameras may have a short far clip; this QA view frames the full basin.
      a.camera.near = 0.1; a.camera.far = 2000; a.camera.updateProjectionMatrix();
      a.camera.position.set(overhead ? 0 : 55, overhead ? 115 : 65, overhead ? 1 : 85);
      a.camera.lookAt(0, 11, 0); a.camera.updateMatrixWorld(true);
      for (const object of a.landscapeObjects) updateLandscapeLod(object, a.camera);
      if (a.postProcessPipeline) a.postProcessPipeline.render(0); else a.renderer.render(a.scene, a.camera);
    },
    snapshot() {
      return { results: [...(a.lakes?.results ?? [])].map(([id, r]) => {
        let hash = 2166136261;
        for (const buffer of [r.positions, r.depths, r.indices]) for (const v of new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)) hash = Math.imul(hash ^ v, 16777619);
        return { id, status: r.status, message: r.message, escape: r.escapeLevel, triangles: r.indices.length / 3,
          hash: hash >>> 0, bytes: r.bytes, ms: r.buildMs, position: r.position, maxDepth: r.depths.reduce((a, b) => Math.max(a, b), 0) };
      }), objects: a.lakes?.objects.size ?? 0,
      streamingPending: pendingTerrainLoads(a),
      resident: [...(a.worldTerrains ?? a.worldTerrainDocuments ?? [])].map(([id, d]) => ({ id, count: d.tiles.size, keys: [...d.tiles.keys()].sort() })) };
    },
  };
}
