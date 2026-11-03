import type { SceneApp } from "@/scene/SceneApp";
import { UI_ICONS } from "../../editorIcons";
import { renderPuddleReflectionDetails } from "./puddleReflectionDetails";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Transient authoring step, deliberately distinct from saved Water Bodies. */
export function renderPuddlePreviewDetails(body: HTMLElement, app: SceneApp): void {
  const { state, picking, available, leaving } = app.getPuddlePreviewState();
  const loading = state?.status === "loading";
  if (!picking && !state?.seed) return;
  const button = (action: string, label: string, disabled = false, variant = "", icon = "") =>
    `<button type="button" class="detail-button ${variant}" data-puddle-${action} ${disabled ? "disabled" : ""}>${icon ? `<span aria-hidden="true">${icon}</span>` : ""}<span>${label}</span></button>`;
  body.insertAdjacentHTML("beforeend", `<div class="lake-editor" data-puddle-panel>
    <div class="lake-workflow" data-puddle-workflow>
    <div class="lake-workflow-heading"><strong>Puddle</strong><span class="lake-state ${state?.seed ? "is-draft" : ""}" data-puddle-stage>${picking ? "Click Terrain" : leaving ? "Pending Draft" : "Draft Preview"}</span></div>
    <div class="detail-hint">${picking ? "Sculpt ile hazırladığınız çukurun içine tıklayın. Esc nokta seçimini bitirir." : leaving ? "Başka araca veya objeye geçmeden önce birikintiyi oluşturun veya taslağı silin. Düzenlemeye de dönebilirsiniz." : "Görünen su henüz oluşturulmadı. Seviyeyi ve alanı ayarlayın, ardından Create Puddle düğmesine basın. Esc taslağı silmez."}</div>
    ${picking ? button("stop-pick", "Finish Picking", false, "", UI_ICONS.arrowLeft) : ""}
    ${state?.seed ? `${button("create", leaving ? "Create Puddle and Continue" : "Create Puddle", state.status !== "ready" || !available || picking, "primary", UI_ICONS.add)}
    <div class="detail-actions-row">${button("clear", "Discard Draft", false, "detail-button-warning")}${button(leaving ? "resume" : "finish", leaving ? "Resume Editing" : "Finish Editing")}</div>` : ""}
    </div>
    ${picking ? '<div class="detail-hint" data-puddle-status>Çukurun içine tıklayın.</div>' : ""}
    ${state?.seed ? `<div class="detail-section" data-detail-section="puddle-preview"><div class="detail-section-title">Surface</div>
      <label class="detail-row"><span>Water Level (World Y)</span>
      <input type="number" step="0.01" value="${state.level}" data-puddle-number="level" ${loading || !available ? "disabled" : ""} title="Yatay su kotu; çukurun tabanından yukarıda olmalıdır." /></label>
      <label class="detail-row"><span>Working Area (m)</span>
      <input type="number" min="${state.spacing * 2}" max="${Math.min(128, state.spacing * 128)}" step="${state.spacing}" value="${state.size}" data-puddle-number="size" ${loading || !available ? "disabled" : ""} title="Başlangıç noktası çevresindeki kare çalışma alanı. Hücre sınırlarına hizalanır." /></label>
      <div class="detail-hint" data-puddle-status data-puddle-result="${state.status}">${escapeHtml(state.message)}</div>
      <div class="detail-hint">Terrain aralığı: ${state.spacing} m. Küçük oyukların ayrıntısı bu aralıkla sınırlıdır.</div></div>` : ""}
    </div>`);
  body.querySelector("[data-puddle-stop-pick]")?.addEventListener("click", () => app.finishPuddlePicking());
  body.querySelector("[data-puddle-finish]")?.addEventListener("click", () => app.finishLakeEditing());
  body.querySelector("[data-puddle-resume]")?.addEventListener("click", () => app.resumeLakeEditing());
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
  if (state?.seed) renderPuddleReflectionDetails(body, state.appearance, state.status !== "ready" || !available,
    patch => app.editPuddlePreviewAppearance(patch));
}
