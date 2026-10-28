import { Vector2, Vector3, WebGLRenderTarget, type PerspectiveCamera, type WebGLRenderer, type Scene, type Group } from "three";
import type { LakeWaterController } from "@/scene/lakeWaterController";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import type { TerrainEditorStreaming } from "@engine/terrain/terrainEditorStreaming";
import { pendingTerrainLoads } from "./terrain-probe-state";
import { LakeSurfaceQuery, LakeRippleState, lakeWheelContact } from "@engine/terrain/lakeInteraction";
import type { VehicleWheelState } from "@engine/physics/vehicle/vehicleTypes";
import { resolveLakeAppearance } from "@engine/scene/waterBody";
import type { RoomLayout } from "@engine/scene/layout";
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
    layout?: RoomLayout;
    worldTerrains?: Map<string, WorldTerrainDocument>; worldTerrainDocuments?: Map<string, WorldTerrainDocument> };
  (window as any).__lakeQA = {
    surfaceFrame(time = 0, encoded = false, direct = false) {
      const restore: Array<() => void> = [];
      for (const object of a.lakes!.objects.values()) if (encoded) {
        const material = object.material, fragment = material.fragmentShader;
        material.uniforms.qaWaterLevel = { value: object.position.y };
        material.fragmentShader = "uniform float qaWaterLevel;\n" + fragment.slice(0, fragment.indexOf("void main(){"))
          + "void main(){gl_FragColor=vec4(vec3(.5+(vWorldPosition.y-qaWaterLevel)*4.),1.);}";
        material.needsUpdate = true;
        restore.push(() => { material.fragmentShader = fragment; delete material.uniforms.qaWaterLevel; material.needsUpdate = true; });
      }
      try {
        const frame = (window as any).__lakeQA.causticsFrame(false, 0, true, false, false, encoded, false, 0, true, direct || encoded, true, 0, encoded ? 0 : 1, true, time);
        const object = [...a.lakes!.objects.values()][0]!, source = a.layout!.waterBodies![0]!;
        const query = new LakeSurfaceQuery(a.lakes!.results.get(source.id)!);
        return { ...frame, cpuHeights: { wetBed: query.offsetAt(-20, -8, time, object.waveParameters), deep: query.offsetAt(-20, -22, time, object.waveParameters) },
          waveHeight: object.waveParameters.height, waveTime: object.material.uniforms.surfaceWaveTime!.value,
          overrideCount: (object as any).waveOverrides.size };
      } finally { restore.forEach(fn => fn()); }
    },
    wheelFrame(mode = "moving", age = .15, direct = false) {
      cancelAnimationFrame(a.frameHandle);
      const id = a.lakes!.objects.keys().next().value!;
      const object = a.lakes!.objects.get(id)!, query = new LakeSurfaceQuery(a.lakes!.results.get(id)!);
      const source = a.layout!.waterBodies!.find(lake => lake.id === id)!;
      const state = new LakeRippleState(resolveLakeAppearance(source));
      for (let i = 0; i < 31; i++) {
        const x = mode === "moving" ? -15 + i * .05 : mode === "dry" ? 0 : -14;
        const y = mode === "air" ? 14 : mode === "submerged" ? 10 : 12.1;
        const wheel: VehicleWheelState = { position: [0, 0, 0], suspensionLength: .3, suspensionForce: 0,
          radius: .5, steering: 0, rotation: i * .1, inContact: false, groundEntityId: null,
          contactPoint: null, hardPoint: [x, y + .3, mode === "dry" ? 0 : 4], worldCenter: [x, y, mode === "dry" ? 0 : 4],
          worldAxle: [1, 0, 0], tractionSlip: mode === "slip" ? .8 : 0 };
        const contact = lakeWheelContact("qa-wheel", wheel, .35, 12, query);
        state.advance(1 / 60, contact ? [contact] : []);
      }
      if (age > 0) state.advance(age, []);
      object.setWheelRipples(state.ripples);
      const frame = (window as any).__lakeQA.causticsFrame(false, 0, true, false, false, false, false, 0, true, direct, true, 0, 1);
      return { ...frame, ripples: state.ripples.map(r => ({ ...r })),
        waveParams: object.material.uniforms.wheelRippleParams!.value.toArray(),
        wavelength: object.material.uniforms.wheelRippleWavelength!.value };
    },
    causticsFrame(enabled = true, time = 0, detail = true, night = false, close = false, wide = false, foam?: boolean, foamTime = 0, softEdge = true, direct = false, wetShore = true, surfaceStrength?: number, surfaceView = 0, mappedSurface = true, waveTime = 0) {
      cancelAnimationFrame(a.frameHandle);
      a.camera.near = 0.1; a.camera.far = 2000;
      a.camera.position.set(close ? -20 : -12, close ? 13.3 : 35, close ? -25.5 : 32);
      a.camera.lookAt(close ? -20 : -10, close ? 11.6 : 10, close ? -23.2 : -5);
      if (wide) { a.camera.position.set(0, 200, 1); a.camera.lookAt(0, 11, 0); }
      if (surfaceView) {
        let sun: any;
        a.scene.traverseVisible((node: any) => { if (node.isDirectionalLight && (!sun || node.intensity > sun.intensity)) sun = node; });
        if (sun) {
          const direction = sun.getWorldPosition(new Vector3()).sub(sun.target.getWorldPosition(new Vector3())).normalize();
          const target = new Vector3(-12, 12, 4);
          a.camera.position.copy(target).addScaledVector(new Vector3(-direction.x, direction.y, -direction.z), surfaceView === 2 ? 100 : 30);
          a.camera.lookAt(target);
        }
      }
      a.camera.updateProjectionMatrix(); a.camera.updateMatrixWorld(true);
      const restore: Array<() => void> = [];
      let count = 0, normalLayers = 0, foamActive = false, wetShoreActive = false, lakeDraws = 0, snapshotUsed = false;
      let drawnMaterial = "";
      a.scene.traverse((node: any) => {
        if (night && node.isDirectionalLight) { const intensity = node.intensity; node.intensity = 0; restore.push(() => { node.intensity = intensity; }); }
        const terrain = node.userData.forgeTerrain;
        if (terrain) {
          const before = node.onBeforeRender;
          node.onBeforeRender = (...args: any[]) => {
            before(...args); const u = terrain.materials.uniforms;
            count = u.uCausticCount.value;
            u.uCausticTime.value = time;
            if (!enabled) u.uCausticCount.value = 0;
            if (u.uShoreWetParams) {
              wetShoreActive ||= u.uShoreWetCount.value > 0 && u.uShoreWetParams.value.slice(0, u.uShoreWetCount.value).some((p: any) => p.w > 0);
              if (!wetShore) u.uShoreWetCount.value = 0;
            }
            if (u.uLayerNormalIndex) {
              normalLayers = u.uLayerNormalIndex.value.filter((n: number) => n >= 0).length;
              if (!detail) u.uLayerNormalIndex.value = u.uLayerNormalIndex.value.map(() => -1);
            }
          };
          const indices = terrain.materials.uniforms.uLayerNormalIndex?.value;
          restore.push(() => { node.onBeforeRender = before; if (indices) terrain.materials.uniforms.uLayerNormalIndex.value = indices; });
        }
        if (node.userData.waterBodyId && node.material?.uniforms?.time) {
          node.setSurfaceWaveTime?.(waveTime);
          const before = node.onBeforeRender;
          const opacity = node.material.uniforms.foamOpacity?.value;
          const edgeDepth = node.material.uniforms.shoreBlendDepth?.value;
          const strength = node.material.uniforms.surfaceStrength?.value;
          const hasNormal = node.material.uniforms.hasNormal?.value;
          const normalMap = node.material.uniforms.normalMap?.value;
          node.onBeforeRender = (...args: any[]) => {
            before(...args); node.material.uniforms.time.value = foamTime;
            lakeDraws++; snapshotUsed = node.material.uniforms.waterSceneEnabled?.value > 0; drawnMaterial = args[4]?.type;
            if (!mappedSurface) { node.material.uniforms.hasNormal.value = 0; node.material.uniforms.normalMap.value = null; }
            if (surfaceStrength !== undefined && strength !== undefined) node.material.uniforms.surfaceStrength.value = surfaceStrength;
            if (!softEdge && edgeDepth !== undefined) node.material.uniforms.shoreBlendDepth.value = 0;
            foamActive ||= (node.material.uniforms.foamOpacity?.value ?? 0) > 0;
            if (foam === false && opacity !== undefined) node.material.uniforms.foamOpacity.value = 0;
          };
          restore.push(() => { node.onBeforeRender = before; if (hasNormal !== undefined) { node.material.uniforms.hasNormal.value = hasNormal; node.material.uniforms.normalMap.value = normalMap; } if (strength !== undefined) node.material.uniforms.surfaceStrength.value = strength; if (edgeDepth !== undefined) node.material.uniforms.shoreBlendDepth.value = edgeDepth; if (opacity !== undefined) node.material.uniforms.foamOpacity.value = opacity; });
        }
      });
      const directTarget = direct ? new WebGLRenderTarget(a.renderer.domElement.width, a.renderer.domElement.height) : null;
      try {
        for (const object of a.landscapeObjects) updateLandscapeLod(object, a.camera);
        a.renderer.info.reset();
        if (a.postProcessPipeline && !direct) a.postProcessPipeline.render(0); else { a.renderer.setRenderTarget(directTarget); a.renderer.clear(); a.renderer.render(a.scene, a.camera); }
        const canvas = a.renderer.domElement;
        const gl = a.renderer.getContext(), width = canvas.width, height = canvas.height;
        const pixels = new Uint8Array(width * height * 4);
        if (directTarget) a.renderer.readRenderTargetPixels(directTarget, 0, 0, width, height, pixels);
        else gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const samples: number[] = [];
        for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
          const i = (y * width + x) * 4; samples.push(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
        }
        const probe = (x: number, y: number, z: number) => {
          const p = new Vector3(x, y, z).project(a.camera);
          const px = Math.round((p.x + 1) * width / 2), py = Math.round((p.y + 1) * height / 2);
          if (px < 2 || px >= width - 2 || py < 2 || py >= height - 2) return null;
          const result: number[] = [];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const i = ((py + dy) * width + px + dx) * 4; result.push(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
          }
          return result;
        };
        let cascades = 0;
        a.scene.traverse(node => { if (node.name.startsWith("forge-sun-cascade-")) cascades++; });
        return { count, normalLayers, foamActive, wetShoreActive, lakeDraws, snapshotUsed, drawnMaterial, override: a.scene.overrideMaterial?.type, samples, calls: a.renderer.info.render.calls, textures: a.renderer.info.memory.textures, glError: gl.getError(),
          shadows: { enabled: a.renderer.shadowMap.enabled, cascades },
          shoreProbes: { near: probe(-20,12,-23.9), deep: probe(-20,12,-22) },
          probes: { wetBed: probe(-20, 12, -8), dry: probe(-20, 16, -40), island: probe(0, 15, 0), separate: probe(30, 10, 0) } };
      } finally { a.renderer.setRenderTarget(null); directTarget?.dispose(); restore.reverse().forEach(fn => fn()); }
    },
    async causticsGpuPilot() {
      cancelAnimationFrame(a.frameHandle);
      const renderer = a.renderer, gl = renderer.getContext() as WebGL2RenderingContext;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      if (!ext) return { available: false, device, reason: "GPU timer unavailable" };
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return { available: false, device, reason: "GPU timer already owned" };
      let enabled = false;
      const restore: Array<() => void> = [];
      a.scene.traverse((node: any) => {
        if (!node.userData.forgeTerrain) return;
        const before = node.onBeforeRender;
        node.onBeforeRender = (...args: any[]) => {
          before(...args); const u = node.userData.forgeTerrain.materials.uniforms;
          if (!enabled) u.uCausticCount.value = 0;
          u.uCausticTime.value = 0;
        };
        restore.push(() => { node.onBeforeRender = before; });
      });
      const queries: Array<{ query: WebGLQuery; on: boolean }> = [], calls: number[] = [];
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const render = (on: boolean) => { enabled = on; renderer.info.reset(); renderer.render(a.scene, a.camera); };
      try {
        for (let i = 0; i < 5; i++) { render(false); render(true); await frame(); }
        for (let i = 0; i < 300; i++) {
          for (const on of [false, true]) {
            const query = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
            render(on); gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push({ query, on });
            if (i === 299) calls.push(renderer.info.render.calls);
          }
          await frame();
        }
        for (let i = 0; i < 120 && queries.some(q => !gl.getQueryParameter(q.query, gl.QUERY_RESULT_AVAILABLE)); i++) await frame();
        if (gl.getParameter(ext.GPU_DISJOINT_EXT) || queries.some(q => !gl.getQueryParameter(q.query, gl.QUERY_RESULT_AVAILABLE))) return { available: false, device, reason: "GPU timing disjoint or incomplete" };
        const off = queries.filter(q => !q.on).map(q => gl.getQueryParameter(q.query, gl.QUERY_RESULT) / 1e6);
        const on = queries.filter(q => q.on).map(q => gl.getQueryParameter(q.query, gl.QUERY_RESULT) / 1e6);
        const p95 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1]!;
        return { available: true, device, frames: 300, viewport: renderer.getSize(new Vector2()).toArray(), baselineP95Ms: p95(off), causticsP95Ms: p95(on), pairedDeltaP95Ms: p95(on.map((v, i) => v - off[i]!)), additionalCalls: calls[1]! - calls[0]! };
      } finally { queries.forEach(q => gl.deleteQuery(q.query)); restore.forEach(fn => fn()); }
    },
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
      return { source: a.getLakeEditorState?.().source ?? a.layout?.waterBodies?.[0] ?? null,
        results: [...(a.lakes?.results ?? [])].map(([id, r]) => {
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
