import type { SceneApp } from "@/scene/SceneApp";
import { resolveLakeAppearance } from "@engine/scene/waterBody";
import { applyWaterTooltips } from "./waterTooltips";
import { UI_ICONS } from "../../editorIcons";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const button = (action: string, label: string, disabled = false, variant = "", icon = "") =>
  `<button type="button" class="detail-button ${variant}" data-lake-${action} ${disabled ? "disabled" : ""}>${icon ? `<span aria-hidden="true">${icon}</span>` : ""}<span>${label}</span></button>`;
const group = (id: string, title: string, content: string, collapsed = false) =>
  `<div class="detail-section" data-detail-section="lake-${id}" data-default-collapsed="${collapsed}"><div class="detail-section-title">${title}</div>${content}</div>`;

/** Mounted by EditorUi before finalizeDetailsRender, including async refreshes. */
export function renderLakeDetails(body: HTMLElement, app: SceneApp, replace = false): void {
  const state = app.getLakeEditorState(), lake = state.source;
  if (!state.available && !lake && !state.picking) return;
  if (replace) body.innerHTML = "";
  const section = document.createElement("div"); section.className = "lake-editor"; section.dataset.lakePanel = "";
  const locked = !!lake?.locked, disabled = locked ? "disabled" : "";
  const field = (label: string, key: string, value: number, step = "0.1", limits = "") =>
    `<label class="detail-row"><span>${label}</span><input data-lake-number="${key}" aria-label="${label}" type="number" step="${step}" value="${Number(value.toFixed(6))}" ${limits} ${disabled}></label>`;
  const ready = state.result?.status === "ready", error = !!state.result && !ready;
  const status = state.picking ? "Click Terrain" : state.leaving ? "Pending Draft" : state.draft ? "Draft Preview" : lake ? "Created Lake" : "Add Lake";
  const hint = state.picking ? "Sculpt ile hazırladığınız çukurun içine tıklayın. Esc nokta seçimini bitirir." :
    state.leaving ? "Başka objeye geçmeden önce gölü oluşturun veya taslağı silin. Düzenlemeye de dönebilirsiniz." :
    state.draft ? "Görünen su henüz oluşturulmadı. Seviyeyi ayarlayın, ardından Gölü oluştur düğmesine basın. Esc taslağı silmez." :
    lake ? "Değişiklikler göle uygulanır. Başka objeye tıklayın veya düzenlemeyi bitirin." :
    "Sculpt ile bir çukur hazırlayın. Çukurun içine tıklayarak su ekleyin; kıyıyı arazi şekli belirler.";
  section.innerHTML = lake && !state.draft && !state.picking ? button("delete", "Delete Lake", locked, "detail-button-warning") : `<div class="lake-workflow" data-lake-workflow>
    <div class="lake-workflow-heading"><strong>Lake</strong><span class="lake-state ${state.draft ? "is-draft" : ""}" data-lake-stage>${status}</span></div>
    <div class="detail-hint">${hint}</div>
    ${!lake && !state.picking ? button("begin", "Add Lake", !state.available, "primary", UI_ICONS.add) : ""}
    ${state.picking ? button("stop-pick", "Finish Picking", false, "", UI_ICONS.arrowLeft) : ""}
    ${state.draft ? `${button("create", state.leaving ? "Create Lake and Continue" : "Create Lake", !ready || state.picking, "primary", UI_ICONS.add)}
      <div class="detail-actions-row">${button("cancel", "Discard Draft", false, "detail-button-warning")}${button(state.leaving ? "resume" : "finish", state.leaving ? "Resume Editing" : "Finish Editing")}</div>` : ""}
    ${lake ? `<div class="lake-result ${error ? "is-error" : ""}" role="status">${ready ? "Preview Ready" : error ? "Unable to Create Water Surface" : "Calculating Water Surface…"}</div>` : ""}
  </div>`;
  if (lake) {
    const a = resolveLakeAppearance(lake);
    section.insertAdjacentHTML("beforeend", group("basic", "Surface", `
      <label class="detail-row"><span>Name</span><input data-lake-name aria-label="Lake Name" value="${escape(lake.name ?? lake.id)}" ${disabled}></label>
      ${field("Water Height (m)", "surfaceLevel", lake.surfaceLevel)}
      ${button("reseed", "Change Fill Point", locked || state.picking)}
      <div class="lake-toggles"><label class="detail-toggle"><input type="checkbox" data-lake-hidden ${lake.hidden ? "checked" : ""} ${disabled}> Hidden</label>
      <label class="detail-toggle"><input type="checkbox" data-lake-locked ${locked ? "checked" : ""}> Locked</label></div>
    `));
    section.insertAdjacentHTML("beforeend", group("appearance", "Appearance", `
      ${(["deepColor", "shallowColor"] as const).map((key) => `<label class="detail-row"><span>${key === "deepColor" ? "Deep Color" : "Shallow Color"}</span><input type="color" aria-label="${key === "deepColor" ? "Deep Color" : "Shallow Color"}" data-lake-color="${key}" value="${a[key]}" ${disabled}></label>`).join("")}
      ${field("Opacity", "opacity", a.opacity, "0.05", 'min="0" max="1"')}
      ${field("Bed Visibility", "bedVisibility", a.bedVisibility, "0.05", 'min="0" max="1"')}
      ${field("Absorption Distance (m)", "absorptionDistance", a.absorptionDistance, "0.25", 'min="0.01" max="100"')}
      ${field("Normal Scale", "normalScale", a.normalScale)}
      ${field("Ripple Speed", "rippleSpeed", a.rippleSpeed)}
    `, true));
    section.insertAdjacentHTML("beforeend", group("caustics", "Caustics", `
      <label class="detail-toggle"><input type="checkbox" data-lake-caustics aria-label="Caustics Enabled" ${a.causticsEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Caustics Strength", "causticsStrength", a.causticsStrength, "0.05", 'min="0" max="3"')}
      ${field("Pattern Size (m)", "causticsScale", a.causticsScale, "0.1", 'min="0.1" max="10"')}
      ${field("Caustics Speed", "causticsSpeed", a.causticsSpeed, "0.05", 'min="0" max="3"')}
      ${field("Depth Fade (m)", "causticsDepthFade", a.causticsDepthFade, "0.1", 'min="0.1" max="30"')}
    `, true));
    section.insertAdjacentHTML("beforeend", group("advanced", "Advanced", `
      <div class="detail-subhead" title="Mavi çerçeve suyun hesaplanacağı alanı sınırlar; gölün kıyısı değildir. Mavi tutamaçları sürükleyerek alanı değiştirebilirsiniz.">Calculation Bounds</div>
      ${field("Width (m)", "width", lake.bounds.max[0] - lake.bounds.min[0], "1")}
      ${field("Length (m)", "length", lake.bounds.max[1] - lake.bounds.min[1], "1")}
      ${field("Min X", "minX", lake.bounds.min[0], "1")}${field("Min Z", "minZ", lake.bounds.min[1], "1")}
      ${field("Max X", "maxX", lake.bounds.max[0], "1")}${field("Max Z", "maxZ", lake.bounds.max[1], "1")}
      ${field("Fill X", "seedX", lake.seed[0])}${field("Fill Z", "seedZ", lake.seed[1])}
      <div class="detail-hint" data-lake-escape title="Su bu yüksekliğe ulaşırsa hesaplama alanının dışına taşabilir.">Escape Level: ${state.result?.escapeLevel?.toFixed(3) ?? "—"} m</div>
      <div class="detail-hint" data-lake-status>${escape(state.result?.message ?? "Calculating Lake…")}</div>
      ${button("retry", "Recalculate Water", state.picking, "", UI_ICONS.refresh)}
      <div class="detail-subhead">Light & Reflection</div>
      ${field("Absorption Distance (m)", "absorptionDistance", a.absorptionDistance)}
      ${field("Reflection Strength", "reflectionStrength", a.reflectionStrength)}
      <label class="detail-row"><span>Reflection Mode</span><select data-lake-reflection ${disabled}><option value="off">Off</option><option value="sharedPlanar">Shared Planar</option></select></label>
      <label class="detail-row"><span>Reflection Quality</span><select data-lake-quality ${disabled}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label class="detail-row"><span>Reflection Group</span><input data-lake-group value="${escape(a.reflectionGroup)}" ${disabled}></label>
      <div class="detail-hint">Terrain: ${escape(lake.terrainRef)} · World Coordinates</div>
      ${!state.draft ? button("terrain", "Select Terrain") : ""}
    `, true));
  }
  body.append(section);
  applyWaterTooltips(section);
  const click = (name: string, fn: () => void) => section.querySelector(`[data-lake-${name}]`)?.addEventListener("click", fn);
  click("begin", () => app.beginLakeFill()); click("reseed", () => app.beginLakeReseed()); click("cancel", () => app.cancelLake());
  click("create", () => app.commitLake()); click("retry", () => app.retryLake()); click("delete", () => app.deleteLake());
  click("terrain", () => app.selectLakeTerrain()); click("stop-pick", () => app.escapeLake());
  click("finish", () => app.finishLakeEditing()); click("resume", () => app.resumeLakeEditing());
  if (!lake) return;
  section.querySelector<HTMLInputElement>("[data-lake-name]")?.addEventListener("change", (event) => app.editLake({ name: (event.target as HTMLInputElement).value }));
  for (const input of section.querySelectorAll<HTMLInputElement>("[data-lake-number]")) input.addEventListener("change", () => {
    const key = input.dataset.lakeNumber!, value = Number(input.value); if (!Number.isFinite(value)) return;
    if (key === "surfaceLevel") app.editLake({ surfaceLevel: value });
    else if (key.startsWith("seed")) { const seed = [...lake.seed] as [number, number]; seed[key === "seedX" ? 0 : 1] = value; app.editLake({ seed }); }
    else if (["minX", "minZ", "maxX", "maxZ", "width", "length"].includes(key)) {
      const bounds = structuredClone(lake.bounds);
      if (key === "width") bounds.max[0] = bounds.min[0] + value;
      else if (key === "length") bounds.max[1] = bounds.min[1] + value;
      else bounds[key.startsWith("min") ? "min" : "max"][key.endsWith("X") ? 0 : 1] = value;
      app.editLake({ bounds });
    } else app.editLake({ appearance: { ...lake.appearance, [key]: value } });
  });
  for (const input of section.querySelectorAll<HTMLInputElement>("[data-lake-color]")) input.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, [input.dataset.lakeColor!]: input.value } }));
  for (const key of ["hidden", "locked"] as const) section.querySelector<HTMLInputElement>(`[data-lake-${key}]`)?.addEventListener("change", (e) => app.editLake({ [key]: (e.target as HTMLInputElement).checked }));
  section.querySelector<HTMLInputElement>("[data-lake-caustics]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, causticsEnabled: (e.target as HTMLInputElement).checked } }));
  const reflection = section.querySelector<HTMLSelectElement>("[data-lake-reflection]")!;
  reflection.value = resolveLakeAppearance(lake).reflectionMode;
  reflection.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionMode: reflection.value as "off" | "sharedPlanar" } }));
  const quality = section.querySelector<HTMLSelectElement>("[data-lake-quality]")!; quality.value = resolveLakeAppearance(lake).reflectionQuality;
  quality.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionQuality: quality.value as "low" | "medium" | "high" } }));
  section.querySelector<HTMLInputElement>("[data-lake-group]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, reflectionGroup: (e.target as HTMLInputElement).value } }));
}
