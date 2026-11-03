import { PUDDLE_WIND_DEFAULTS, PUDDLE_WIND_RANGES, type PuddleWaterBody } from "@engine/scene/puddleWater";

type Appearance = NonNullable<PuddleWaterBody["appearance"]>;
/** Shared draft/saved controls; global wind direction and weather remain in WES. */
export function renderPuddleWindDetails(body: HTMLElement, appearance: Appearance, disabled: boolean, edit: (patch: Appearance) => void): void {
  const a = { ...PUDDLE_WIND_DEFAULTS, ...appearance }, lock = disabled ? "disabled" : "";
  const labels = { windNormalStrength: "Normal Strength", windWorldScale: "World Scale (m)", windSpeedResponse: "Speed Response", windInfluence: "Wind Influence" };
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle-wind-ripples" data-puddle-panel>
    <div class="detail-section-title">Wind Ripples</div>
    <label class="detail-row"><span>Enabled</span><input type="checkbox" data-puddle-wind-enabled ${a.windRipplesEnabled ? "checked" : ""} ${lock}></label>
    ${Object.entries(PUDDLE_WIND_RANGES).map(([key, range]) => `<label class="detail-row"><span>${labels[key as keyof typeof labels]}</span><input type="number" data-puddle-wind="${key}" min="${range[0]}" max="${range[1]}" step="0.01" value="${a[key as keyof typeof labels]}" ${lock}></label>`).join("")}
    <div class="detail-hint">Yön, güç ve esinti World Environment rüzgarından gelir. Wind Influence suyun rüzgara tepkisini artırır; 0 etkiyi kapatır, 1 normal tepkidir. Esintiler dalga grupları halinde belirip söner. World Environment yoksa World Settings rüzgarı kullanılır.</div>
  </div>`);
  body.querySelector<HTMLInputElement>("[data-puddle-wind-enabled]")?.addEventListener("change", event => edit({ windRipplesEnabled: (event.target as HTMLInputElement).checked }));
  body.querySelectorAll<HTMLInputElement>("[data-puddle-wind]").forEach(input => input.addEventListener("change", () => {
    const key = input.dataset.puddleWind as keyof typeof PUDDLE_WIND_RANGES, range = PUDDLE_WIND_RANGES[key];
    if (Number.isFinite(input.valueAsNumber)) edit({ [key]: Math.max(range[0], Math.min(range[1], input.valueAsNumber)) });
  }));
}
