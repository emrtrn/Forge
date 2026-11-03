import {
  FRACTURE_LIMITS,
  type AssetFractureDef,
  type PlacementFractureOverride,
} from "@engine/physics/fracture/fractureTypes";
import type { EditableSelection } from "@/scene/SceneApp";

/**
 * Per-placement override of the asset's `.fracture.json` (plan §4, K-04).
 * Shown only for a static mesh instance whose asset has an enabled sidecar:
 * the asset stays the definition, the placement may opt out or move the
 * break impulse (empty = the asset's value).
 */
export function renderFractureSection(
  selection: EditableSelection,
  asset: AssetFractureDef | null | undefined,
): string {
  if (selection.kind !== "instance" || !asset?.enabled) return "";
  const override = selection.fracture;
  const disabled = selection.locked ? "disabled" : "";
  const [min, max] = FRACTURE_LIMITS.breakImpulse;
  return `
      <div class="detail-section" data-detail-section="fracture">
        <div class="detail-section-title">Fracture</div>
        <label class="detail-toggle" title="Kapalıysa bu yerleştirme asset kırılabilir olsa da bütün kalır.">
          <input type="checkbox" data-fracture-enabled ${override?.enabled === false ? "" : "checked"} ${disabled} />
          <span>Breakable</span>
        </label>
        <label class="detail-row" title="Bu yerleştirmeyi kıran çarpma impulsu (N·s). Boş bırakılırsa asset değeri (${asset.breakImpulse}) kullanılır.">
          <span>Break Impulse</span>
          <input data-fracture-break-impulse type="number" step="10" min="${min}" max="${max}"
            data-slider-max="5000" value="${override?.breakImpulse ?? ""}"
            placeholder="Asset (${asset.breakImpulse})" ${disabled} />
        </label>
      </div>
    `;
}

export function bindFractureInputs(
  body: HTMLElement,
  current: () => PlacementFractureOverride | undefined,
  setOverride: (value: PlacementFractureOverride | undefined) => void,
): void {
  const commit = (patch: Partial<Record<keyof PlacementFractureOverride, unknown>>): void => {
    const next: PlacementFractureOverride = { ...current() };
    if ("enabled" in patch) {
      if (patch.enabled === false) next.enabled = false;
      else delete next.enabled;
    }
    if ("breakImpulse" in patch) {
      if (typeof patch.breakImpulse === "number") next.breakImpulse = patch.breakImpulse;
      else delete next.breakImpulse;
    }
    setOverride(Object.keys(next).length > 0 ? next : undefined);
  };
  body.querySelector<HTMLInputElement>("[data-fracture-enabled]")?.addEventListener("change", (event) => {
    commit({ enabled: (event.currentTarget as HTMLInputElement).checked ? undefined : false });
  });
  body.querySelector<HTMLInputElement>("[data-fracture-break-impulse]")?.addEventListener("change", (event) => {
    const raw = (event.currentTarget as HTMLInputElement).value.trim();
    if (raw === "") {
      commit({ breakImpulse: undefined });
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const [min, max] = FRACTURE_LIMITS.breakImpulse;
    commit({ breakImpulse: Math.max(min, Math.min(max, value)) });
  });
}
