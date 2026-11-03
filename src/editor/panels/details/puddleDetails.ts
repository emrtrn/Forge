import type { SceneApp } from "@/scene/SceneApp";
import { PUDDLE_APPEARANCE } from "@engine/scene/puddleWater";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function renderPuddleDetails(body: HTMLElement, app: SceneApp): void {
  const puddle = app.getSelectedPuddle(); if (!puddle) return;
  const a = { ...PUDDLE_APPEARANCE, ...puddle.appearance }, locked = puddle.locked ? "disabled" : "";
  const result = app.getSelectedPuddleResult();
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle" data-puddle-panel>
    <div class="detail-section-title">Puddle</div>
    <div class="detail-hint">Kalıcı su gövdesi · Save ile level dosyasına yazılır.</div>
    <label class="detail-row"><span>Name</span><input data-puddle-name value="${escape(puddle.name ?? puddle.id)}" ${locked}></label>
    <label class="detail-toggle"><input type="checkbox" data-puddle-locked ${puddle.locked ? "checked" : ""}> Locked</label>
    <label class="detail-toggle"><input type="checkbox" data-puddle-hidden ${puddle.hidden ? "checked" : ""} ${locked}> Hidden</label>
    <label class="detail-row"><span>Water Level (World Y)</span><input type="number" step="0.01" data-puddle-saved-number="level" value="${puddle.surfaceLevel}" ${locked}></label>
    <label class="detail-row"><span>Working Area (m)</span><input type="number" step="1" min="0.01" max="128" data-puddle-saved-number="size" value="${puddle.bounds.max[0] - puddle.bounds.min[0]}" ${locked}></label>
    <label class="detail-row"><span>Color</span><input type="color" data-puddle-color value="${a.color}" ${locked}></label>
    ${([['opacity', 'Opacity', 0, 1], ['roughness', 'Roughness', .04, 1], ['reflectionStrength', 'Environment Reflection', 0, 3]] as const).map(([key, label, min, max]) =>
      `<label class="detail-row"><span>${label}</span><input type="number" step="0.01" min="${min}" max="${max}" data-puddle-appearance="${key}" value="${a[key]}" ${locked}></label>`).join("")}
    <div class="detail-hint" data-puddle-saved-status data-puddle-result="${puddle.hidden ? 'hidden' : result?.status ?? 'loading'}">${escape(puddle.hidden ? "Hidden" : result?.message ?? "Preparing water…")}</div>
    <button type="button" class="detail-action-button" data-puddle-delete ${locked}>Delete Puddle</button>
    </div>`);
  body.querySelector<HTMLInputElement>("[data-puddle-name]")?.addEventListener("change", event => app.editPuddle({ name: (event.target as HTMLInputElement).value }));
  body.querySelector<HTMLInputElement>("[data-puddle-locked]")?.addEventListener("change", event => app.editPuddle({ locked: (event.target as HTMLInputElement).checked }));
  body.querySelector<HTMLInputElement>("[data-puddle-hidden]")?.addEventListener("change", event => app.editPuddle({ hidden: (event.target as HTMLInputElement).checked }));
  body.querySelector<HTMLInputElement>("[data-puddle-color]")?.addEventListener("change", event => app.editPuddle({ appearance: { ...puddle.appearance, color: (event.target as HTMLInputElement).value } }));
  body.querySelectorAll<HTMLInputElement>("[data-puddle-saved-number]").forEach(input => input.addEventListener("change", () => {
    const value = input.valueAsNumber; if (!Number.isFinite(value)) return;
    if (input.dataset.puddleSavedNumber === "level") app.editPuddle({ surfaceLevel: value }); else app.resizePuddle(value);
  }));
  body.querySelectorAll<HTMLInputElement>("[data-puddle-appearance]").forEach(input => input.addEventListener("change", () => {
    if (Number.isFinite(input.valueAsNumber)) app.editPuddle({ appearance: { ...puddle.appearance, [input.dataset.puddleAppearance!]: input.valueAsNumber } });
  }));
  body.querySelector("[data-puddle-delete]")?.addEventListener("click", () => app.deletePuddle());
}
