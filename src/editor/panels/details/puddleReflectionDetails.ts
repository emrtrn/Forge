import { PUDDLE_APPEARANCE, type PuddleWaterBody } from "@engine/scene/puddleWater";

type Appearance = NonNullable<PuddleWaterBody["appearance"]>;
/** Mounted inside the saved or draft inspector before finalizeDetailsRender. */
export function renderPuddleReflectionDetails(body: HTMLElement, appearance: Appearance, disabled: boolean, edit: (patch: Appearance) => void): void {
  const a = { ...PUDDLE_APPEARANCE, ...appearance }, lock = disabled ? "disabled" : "";
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle-reflection" data-puddle-panel>
    <div class="detail-section-title">Reflection</div>
    <label class="detail-row"><span>Mode</span><select data-puddle-reflection="reflectionMode" ${lock}><option value="environment" ${a.reflectionMode === "environment" ? "selected" : ""}>Environment</option><option value="sharedPlanar" ${a.reflectionMode === "sharedPlanar" ? "selected" : ""}>Planar Reflection</option></select></label>
    <label class="detail-row"><span>Quality</span><select data-puddle-reflection="reflectionQuality" ${lock}>${(["low", "medium", "high"] as const).map(quality => `<option value="${quality}" ${a.reflectionQuality === quality ? "selected" : ""}>${quality[0]!.toUpperCase() + quality.slice(1)}</option>`).join("")}</select></label>
    <label class="detail-row"><span>Planar Strength</span><input type="number" data-puddle-planar-strength min="0" max="1" step="0.05" value="${a.planarReflectionStrength}" ${lock}></label>
    <label class="detail-row"><span>Environment Reflection</span><input type="number" data-puddle-environment-strength min="0" max="3" step="0.05" value="${a.reflectionStrength}" ${lock}></label>
    <div class="detail-hint">Low ortam yansımasını kullanır. Genel grafik kalitesi planar kaliteyi sınırlayabilir; küçük/ekran dışı yüzeyler ve kaynak sınırında ortam yansıması korunur.</div>
    </div>`);
  body.querySelectorAll<HTMLSelectElement>("[data-puddle-reflection]").forEach(input => input.addEventListener("change", () => {
    if (input.dataset.puddleReflection === "reflectionMode") edit({ reflectionMode: input.value as NonNullable<Appearance["reflectionMode"]> });
    else edit({ reflectionQuality: input.value as NonNullable<Appearance["reflectionQuality"]> });
  }));
  body.querySelector<HTMLInputElement>("[data-puddle-planar-strength]")?.addEventListener("change", event => {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) edit({ planarReflectionStrength: value });
  });
  body.querySelector<HTMLInputElement>("[data-puddle-environment-strength]")?.addEventListener("change", event => {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) edit({ reflectionStrength: value });
  });
}
