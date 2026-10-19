/**
 * Vehicle asset I/O for the editor (dev-only).
 *
 * Loads `*.vehicle.json` assets from the project public root and saves them
 * back through the dev `/__save-vehicle` endpoint, which re-validates and
 * normalises the payload server-side (`validateSaveVehiclePayload` →
 * `normalizeVehicleAsset`). Mirrors `particleEffectStore.ts`.
 *
 * The editor works on the fully normalised definition: a sparse hand-written
 * asset opens with every default filled in, and is saved that way.
 */
import {
  createReferenceCarDefinition,
  normalizeVehicleAsset,
  type VehicleDefinition,
} from "@engine/physics/vehicle/vehicleTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

export interface LoadedVehicleAsset {
  definition: VehicleDefinition;
  /** False when the file was missing or unreadable and the reference car stands in. */
  readable: boolean;
}

export async function loadVehicleAssetForEditor(path: string): Promise<LoadedVehicleAsset> {
  try {
    const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
    if (response.ok) {
      const asset = normalizeVehicleAsset(await response.json());
      if (asset) return { definition: stripEnvelope(asset), readable: true };
    }
  } catch {
    // fall through to the reference car
  }
  return { definition: createReferenceCarDefinition(), readable: false };
}

export interface SavedVehicleAsset {
  path: string;
  changed: boolean;
  /** Fields the server allowlist did not keep (should be empty for editor saves). */
  dropped: string[];
  /** What was written, re-read through the same normaliser. */
  definition: VehicleDefinition;
}

export async function saveVehicleAsset(path: string, definition: VehicleDefinition): Promise<SavedVehicleAsset> {
  const vehicle = { schema: 1, type: "vehicle", ...definition };
  const response = await fetch("/__save-vehicle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, vehicle }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
    dropped?: string[];
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Vehicle save failed: HTTP ${response.status}`);
  }
  const normalized = normalizeVehicleAsset(vehicle);
  return {
    path: body.path ?? path,
    changed: body.changed ?? false,
    dropped: body.dropped ?? [],
    definition: normalized ? stripEnvelope(normalized) : definition,
  };
}

function stripEnvelope(asset: VehicleDefinition & { schema?: unknown; type?: unknown }): VehicleDefinition {
  const { schema: _schema, type: _type, ...definition } = asset;
  return definition;
}
