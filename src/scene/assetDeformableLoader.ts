import {
  deformableSidecarPath,
  normalizeAssetDeformable,
  type AssetDeformableDef,
} from "@engine/physics/deformable/deformableTypes";
import { ContentLoadError } from "@engine/assets/contentValidation";
import { readOptionalSidecar } from "@/project/contentLoader";

export { deformableSidecarPath } from "@engine/physics/deformable/deformableTypes";

/** Loads an optional deformable sidecar; missing or damaged content leaves the model rigid. */
export async function loadAssetDeformable(modelPath: string): Promise<AssetDeformableDef | null> {
  return readOptionalSidecar(deformableSidecarPath(modelPath), normalizeAssetDeformable, () => null, (raw, path) => {
    if (normalizeAssetDeformable(raw) === null) {
      throw new ContentLoadError(path, "invalid-data", 'deformable sidecar must be an object with version 1 and mode "impact"');
    }
  });
}
