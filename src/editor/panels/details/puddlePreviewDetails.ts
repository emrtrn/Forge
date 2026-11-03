import type { SceneApp } from "@/scene/SceneApp";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Transient authoring step, deliberately distinct from saved Water Bodies. */
export function renderPuddlePreviewDetails(body: HTMLElement, app: SceneApp): void {
  const { state, picking, available } = app.getPuddlePreviewState();
  const loading = state?.status === "loading", active = picking || !!state?.seed;
  body.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="puddle-preview" data-puddle-panel>
    <div class="detail-section-title">Puddle Preview</div>
    <div class="detail-hint">Önce Sculpt ile çukuru hazırlayın. Hazır önizlemeyi Create Puddle ile kalıcı gövdeye dönüştürün.</div>
    <div class="landscape-heightmap-actions">
      <button type="button" class="detail-action-button" data-puddle-begin ${!available || loading || picking ? "disabled" : ""}>${state?.seed ? "Pick Another Puddle" : "Preview Puddle"}</button>
      <button type="button" class="detail-action-button" data-puddle-clear ${active ? "" : "disabled"}>Clear Preview</button>
      <button type="button" class="detail-action-button" data-puddle-create ${state?.status === "ready" && available ? "" : "disabled"}>Create Puddle</button>
    </div>
    ${picking ? '<div class="detail-hint" data-puddle-status>Çukurun içine tıklayın. Esc önizlemeyi iptal eder.</div>' : ""}
    ${state?.seed ? `<label class="detail-row"><span>Water Level (World Y)</span>
      <input type="number" step="0.01" value="${state.level}" data-puddle-number="level" ${loading || !available ? "disabled" : ""} title="Yatay su kotu; çukurun tabanından yukarıda olmalıdır." /></label>
      <label class="detail-row"><span>Working Area (m)</span>
      <input type="number" min="${state.spacing * 2}" max="${Math.min(128, state.spacing * 128)}" step="${state.spacing}" value="${state.size}" data-puddle-number="size" ${loading || !available ? "disabled" : ""} title="Başlangıç noktası çevresindeki kare çalışma alanı. Hücre sınırlarına hizalanır." /></label>
      <div class="detail-hint" data-puddle-status data-puddle-result="${state.status}">${escapeHtml(state.message)}</div>
      <div class="detail-hint">Terrain aralığı: ${state.spacing} m. Küçük oyukların ayrıntısı bu aralıkla sınırlıdır.</div>` : ""}
    </div>`);
  body.querySelector("[data-puddle-begin]")?.addEventListener("click", () => app.beginPuddlePreview());
  body.querySelector("[data-puddle-clear]")?.addEventListener("click", () => app.cancelPuddlePreview());
  body.querySelector("[data-puddle-create]")?.addEventListener("click", () => app.createPuddle());
  body.querySelectorAll<HTMLInputElement>("[data-puddle-number]").forEach(input => {
    input.addEventListener("change", () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      if (input.dataset.puddleNumber === "level") app.editPuddlePreview({ level: value });
      else app.editPuddlePreview({ size: value });
    });
  });
}
