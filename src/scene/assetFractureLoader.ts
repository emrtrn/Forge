import {
  fractureSidecarPath,
  normalizeAssetFracture,
  type AssetFractureDef,
} from "@engine/physics/fracture/fractureTypes";
import { ContentLoadError } from "@engine/assets/contentValidation";
import { readOptionalSidecar } from "@/project/contentLoader";

export { fractureSidecarPath } from "@engine/physics/fracture/fractureTypes";

/** Loads an optional fracture sidecar; missing or damaged content disables fracture. */
export async function loadAssetFracture(modelPath: string): Promise<AssetFractureDef | null> {
  return readOptionalSidecar(fractureSidecarPath(modelPath), normalizeAssetFracture, () => null, (raw, path) => {
    if (normalizeAssetFracture(raw) === null) {
      throw new ContentLoadError(path, "invalid-data", "fracture sidecar must be an object with version 1 and source \"voronoi\"");
    }
  });
}
