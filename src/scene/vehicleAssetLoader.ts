/** Static asset reads, shared by placed actors and runtime spawns; no editor code. */
import type { ActorScriptDef } from "@engine/scene/actorScript";
import { VEHICLE_COMPONENT } from "@engine/scene/components";
import type { SceneJsonValue } from "@engine/scene/entity";
import {
  normalizeVehicleAsset,
  normalizeVehicleAssetPath,
  vehicleDefinitionFromComponent,
  type VehicleDefinition,
} from "@engine/physics/vehicle/vehicleTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

export type VehicleAssetLoader = (path: string) => Promise<VehicleDefinition | null>;

/** Cache in-flight reads per runtime, including failures; a bad asset cannot abort a level. */
export function createVehicleAssetLoader(fetcher: typeof fetch = fetch): VehicleAssetLoader {
  const cache = new Map<string, Promise<VehicleDefinition | null>>();
  return (path) => {
    const normalized = normalizeVehicleAssetPath(path);
    if (!normalized) return Promise.resolve(null);
    let pending = cache.get(normalized);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetcher(projectFileUrl(normalized), { cache: "no-cache" });
          return response.ok ? normalizeVehicleAsset(await response.json()) : null;
        } catch {
          return null;
        }
      })();
      cache.set(normalized, pending);
    }
    return pending;
  };
}

/**
 * Expand asset + inline overrides in a runtime copy of the class before physics
 * derives its entities. Authored props stay untouched for editor round trips.
 * Missing/malformed assets retain Faz 1's inline/reference-car fallback.
 */
export async function resolveActorVehicleAssets(
  def: ActorScriptDef,
  loadAsset: VehicleAssetLoader,
): Promise<ActorScriptDef> {
  const components = await Promise.all(def.components.map(async (node) => {
    if (node.component !== VEHICLE_COMPONENT || node.props.asset === undefined) return node;
    const path = normalizeVehicleAssetPath(node.props.asset);
    const asset = path ? await loadAsset(path) : null;
    if (!asset) {
      console.warn(`[vehicle] Could not load ${String(node.props.asset)}; using inline/default settings.`);
    }
    const definition = vehicleDefinitionFromComponent(node.props, asset ?? undefined)!;
    return {
      ...node,
      props: { ...node.props, ...definition } as unknown as Record<string, SceneJsonValue>,
    };
  }));
  return { ...def, components };
}
