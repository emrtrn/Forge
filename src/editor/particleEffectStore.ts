/**
 * Particle effect asset I/O for the editor (dev-only).
 *
 * Loads `*.effect.json` assets from the project public root and saves them back
 * through the dev `/__save-effect` endpoint, which re-validates and normalises
 * the payload server-side (see `tools/saveValidator.ts` → `validateEffectAsset`).
 * Mirrors the pattern of `soundCueStore.ts` and `materialStore.ts`.
 *
 * Schema-1, schema-2 and schema-3 asset bodies all normalise to the same rich
 * {@link ParticleEffectDefinition} on load; the editor saves schema-2 for sprite
 * effects and schema-3 for mesh (3D model) effects, so opening a legacy schema-1
 * asset and saving it upgrades it in place.
 */
import type { ParticleEffectDefinition } from "@engine/vfx/particleEffectTypes";
import { normalizeEffectDefinition } from "@engine/vfx/particleEffectParser";
import { particleEffectPresetDefinition } from "@engine/vfx/particleEffectPresets";
import { projectFileUrl } from "@/project/ProjectSystem";

/** A blank normalized definition used when the file is missing or corrupt. */
function fallbackDefinition(name: string): ParticleEffectDefinition {
  const def = particleEffectPresetDefinition("blank");
  def.name = name;
  return def;
}

export async function loadEffectAsset(
  path: string,
  fallbackName = "Particle Effect",
): Promise<ParticleEffectDefinition> {
  try {
    const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
    if (!response.ok) return fallbackDefinition(fallbackName);
    const data = (await response.json()) as unknown;
    const def = normalizeEffectDefinition(data);
    return def ?? fallbackDefinition(fallbackName);
  } catch {
    return fallbackDefinition(fallbackName);
  }
}

export async function saveEffectAsset(
  path: string,
  definition: ParticleEffectDefinition,
): Promise<{ path: string; changed: boolean }> {
  // Schema 3 only when the author actually selected the mesh renderer; sprite
  // effects keep writing schema 2 so older readers still load them (plan §3).
  const schema = definition.renderer.type === "mesh" ? 3 : 2;
  const effect = { schema, type: "particleEffect", ...definition };
  const response = await fetch("/__save-effect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, effect }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    path?: string;
    changed?: boolean;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Effect save failed: HTTP ${response.status}`);
  }
  return { path: body.path ?? path, changed: body.changed ?? false };
}
