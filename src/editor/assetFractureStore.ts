import type { AssetFractureDef } from "@engine/physics/fracture/fractureTypes";
import { fractureSidecarPath } from "@/scene/assetFractureLoader";

export { loadAssetFracture, fractureSidecarPath } from "@/scene/assetFractureLoader";

/** Posts fracture parameters to the dev-only save endpoint. */
export async function saveAssetFracture(
  modelPath: string,
  def: AssetFractureDef,
): Promise<{ path: string; changed: boolean; dropped: string[] }> {
  const path = fractureSidecarPath(modelPath);
  const response = await fetch("/__save-fracture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, fracture: def }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
    dropped?: string[];
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Fracture save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false, dropped: body.dropped ?? [] };
}
