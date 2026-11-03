import { PUDDLE_MUD_DEFAULTS, type PuddleWaterBody } from "@engine/scene/puddleWater";

type Appearance = NonNullable<PuddleWaterBody["appearance"]>;
export function renderPuddleMudDetails(body: HTMLElement, appearance: Appearance, disabled: boolean, edit: (patch: Appearance) => void): void {
  const a = { ...PUDDLE_MUD_DEFAULTS, ...appearance }, lock = disabled ? "disabled" : "";
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle-mud" data-puddle-panel>
    <div class="detail-section-title">Muddy Water</div>
    <label class="detail-row"><span>Mud Density</span><input type="number" data-puddle-mud-density min="0" max="80" step="0.5" value="${a.mudDensity}" ${lock}></label>
    <label class="detail-row"><span>Mud Color</span><input type="color" data-puddle-mud-color value="${a.mudColor}" ${lock}></label>
    <div class="detail-hint">Sığ su daha saydam kalır, derinleştikçe çamur rengi ve örtücülük artar. Yoğunluğu artırmak dibi daha sığda gizler. Opacity de yoğunluğu etkiler.</div>
  </div>`);
  body.querySelector<HTMLInputElement>("[data-puddle-mud-density]")?.addEventListener("change", event => {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) edit({ mudDensity: Math.max(0, Math.min(80, value)) });
  });
  body.querySelector<HTMLInputElement>("[data-puddle-mud-color]")?.addEventListener("change", event => edit({ mudColor: (event.target as HTMLInputElement).value }));
}
