import { Box3, Vector3, type Group, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { updateLandscapeLod } from "@engine/render-three/landscape";
import type { RiverWaterObject } from "@engine/render-three/riverWater";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainEditorStreaming } from "@engine/terrain/terrainEditorStreaming";
import { pendingTerrainLoads } from "./terrain-probe-state";
import { QUALITY_PROFILES } from "@engine/perf/qualityProfiles";

interface RiverProbeApp {
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  riverWaterObjects: RiverWaterObject[];
  frameHandle: number;
  landscapeObjects: Group[];
  postProcessPipeline: { render(dt: number): void } | null;
  worldTerrains?: Map<string, WorldTerrainDocument>;
  worldTerrainDocuments?: Map<string, WorldTerrainDocument>;
  worldTerrainStreams?: Map<WorldTerrainDocument, TerrainEditorStreaming>;
}

// Read-only observations of the actual editor/runtime output. Authoring and
// retries use UI controls; no fixture writes to live terrain or water state.
export function installRiverProbe(app: unknown) {
  const internal = app as RiverProbeApp;
  (window as any).__riverQA = {
    quality(level: "low" | "high") {
      const runtime = app as { applyQualitySettings?: (settings: typeof QUALITY_PROFILES.high) => void };
      if (!runtime.applyQualitySettings) throw new Error("Runtime quality control required");
      runtime.applyQualitySettings(QUALITY_PROFILES[level]);
    },
    // Test camera only; stops gameplay updates so screenshots share one view.
    frame() {
      cancelAnimationFrame(internal.frameHandle);
      const bounds = new Box3().setFromObject(internal.riverWaterObjects[0]!);
      const centre = bounds.getCenter(new Vector3());
      internal.camera.position.copy(centre).add(new Vector3(15, 22, 35));
      internal.camera.lookAt(centre); internal.camera.updateMatrixWorld(true);
      for (const object of internal.landscapeObjects) updateLandscapeLod(object, internal.camera);
      if (internal.postProcessPipeline) internal.postProcessPipeline.render(0);
      else internal.renderer.render(internal.scene, internal.camera);
    },
    snapshot() {
      return { waters: internal.riverWaterObjects.map((water) => {
        water.updateWorldMatrix(true, true);
        const bounds = new Box3().setFromObject(water);
        const depth = water.geometry.getAttribute("waterDepth"), position = water.geometry.getAttribute("position");
        const flow = water.geometry.getAttribute("flowDirection");
        const samples = Array.from({ length: depth.count }, (_, i) => ({
          x: position.getX(i) + water.position.x, y: position.getY(i) + water.position.y,
          z: position.getZ(i) + water.position.z, depth: depth.getX(i), flow: [flow.getX(i), flow.getY(i)],
        }));
        return { name: water.name, visible: water.visible, position: water.position.toArray(),
          triangles: water.geometry.index!.count / 3, samples,
          min: bounds.min.toArray(), max: bounds.max.toArray(),
          time: water.material.uniforms["time"]!.value,
          flowSpeed: water.material.uniforms["flowSpeed"]!.value,
          reflection: water.material.uniforms["reflectionStrength"]!.value,
          surfaceStrength: water.material.uniforms.surfaceStrength!.value,
          surfaceRoughness: water.material.uniforms.surfaceRoughness!.value,
          refractionStrength: water.material.uniforms.riverRefractionStrength!.value,
          refractionBytes: water.userData.riverRefractionBytes ?? 0,
          crestFoamStrength: water.material.uniforms.crestFoamStrength!.value,
          foamOpacity: water.material.uniforms.foamOpacity!.value,
          foam: water.children.map((child) => ({ name: child.name, world: child.getWorldPosition(water.position.clone()).toArray() })) };
      }), streamingPending: pendingTerrainLoads(internal), resident: [...(internal.worldTerrains ?? internal.worldTerrainDocuments ?? new Map()).values()].map((doc) => doc.tiles.size) };
    },
  };
}
