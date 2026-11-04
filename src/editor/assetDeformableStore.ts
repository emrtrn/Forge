import type { AssetDeformableDef } from "@engine/physics/deformable/deformableTypes";
import { deformableSidecarPath } from "@/scene/assetDeformableLoader";

export { loadAssetDeformable, deformableSidecarPath } from "@/scene/assetDeformableLoader";

/** Posts deformable parameters to the dev-only save endpoint. */
export async function saveAssetDeformable(
  modelPath: string,
  def: AssetDeformableDef,
): Promise<{ path: string; changed: boolean; dropped: string[] }> {
  const path = deformableSidecarPath(modelPath);
  const response = await fetch("/__save-deformable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, deformable: def }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
    dropped?: string[];
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Deformable save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false, dropped: body.dropped ?? [] };
}
