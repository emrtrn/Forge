import { PUDDLE_WHEEL_RIPPLE_DEFAULTS, PUDDLE_WHEEL_RIPPLE_RANGES, type PuddleWaterBody } from "@engine/scene/puddleWater";

type Appearance = NonNullable<PuddleWaterBody["appearance"]>;
/** The draft and saved body share persisted settings and bounded controls. */
export function renderPuddleRippleDetails(body: HTMLElement, appearance: Appearance, disabled: boolean, edit: (patch: Appearance) => void): void {
  const a = { ...PUDDLE_WHEEL_RIPPLE_DEFAULTS, ...appearance }, lock = disabled ? "disabled" : "";
  const labels = { wheelRippleStrength: "Strength", wheelRippleSpeed: "Spread Speed", wheelRippleWidth: "Ring Width",
    wheelRippleWavelength: "Wavelength", wheelRippleLifetime: "Lifetime", wheelRippleInterval: "Emission Interval" };
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle-wheel-ripples" data-puddle-panel>
    <div class="detail-section-title">Wheel Ripples</div>
    <label class="detail-row"><span>Enabled</span><input type="checkbox" data-puddle-ripples-enabled ${a.wheelRipplesEnabled ? "checked" : ""} ${lock}></label>
    ${Object.entries(PUDDLE_WHEEL_RIPPLE_RANGES).map(([key, range]) => `<label class="detail-row"><span>${labels[key as keyof typeof labels]}</span><input type="number" data-puddle-ripple="${key}" min="${range[0]}" max="${range[1]}" step="0.01" value="${a[key as keyof typeof labels]}" ${lock}></label>`).join("")}
    <button data-puddle-ripples-reset ${lock}>Reset Wheel Ripples</button>
    <div class="detail-hint">Play sırasında suya temas eden hareketli veya patinaj yapan tekerlekler halka üretir. Halkalar kuru kıyı ve adalarda sonlanır.</div>
  </div>`);
  body.querySelector<HTMLInputElement>("[data-puddle-ripples-enabled]")?.addEventListener("change", event => edit({ wheelRipplesEnabled: (event.target as HTMLInputElement).checked }));
  body.querySelectorAll<HTMLInputElement>("[data-puddle-ripple]").forEach(input => input.addEventListener("change", () => {
    const key = input.dataset.puddleRipple as keyof typeof PUDDLE_WHEEL_RIPPLE_RANGES, range = PUDDLE_WHEEL_RIPPLE_RANGES[key];
    if (Number.isFinite(input.valueAsNumber)) edit({ [key]: Math.max(range[0], Math.min(range[1], input.valueAsNumber)) });
  }));
  body.querySelector("[data-puddle-ripples-reset]")?.addEventListener("click", () => edit({ ...PUDDLE_WHEEL_RIPPLE_DEFAULTS }));
}
