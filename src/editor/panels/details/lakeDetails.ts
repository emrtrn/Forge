import type { SceneApp } from "@/scene/SceneApp";
import { resolveLakeAppearance } from "@engine/scene/waterBody";
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
  const status = state.picking ? "Araziye tıklayın" : state.leaving ? "Taslak için karar verin" : state.draft ? "Taslak önizleme" : lake ? "Oluşturulmuş göl" : "Göl ekle";
  const hint = state.picking ? "Sculpt ile hazırladığınız çukurun içine tıklayın. Esc nokta seçimini bitirir." :
    state.leaving ? "Başka objeye geçmeden önce gölü oluşturun veya taslağı silin. Düzenlemeye de dönebilirsiniz." :
    state.draft ? "Görünen su henüz oluşturulmadı. Seviyeyi ayarlayın, ardından Gölü oluştur düğmesine basın. Esc taslağı silmez." :
    lake ? "Değişiklikler göle uygulanır. Başka objeye tıklayın veya düzenlemeyi bitirin." :
    "Sculpt ile bir çukur hazırlayın. Çukurun içine tıklayarak su ekleyin; kıyıyı arazi şekli belirler.";
  section.innerHTML = `<div class="lake-workflow" data-lake-workflow>
    <div class="lake-workflow-heading"><strong>Göl</strong><span class="lake-state ${state.draft ? "is-draft" : ""}" data-lake-stage>${status}</span></div>
    <div class="detail-hint">${hint}</div>
    ${!lake && !state.picking ? button("begin", "Göl ekle", !state.available, "primary", UI_ICONS.add) : ""}
    ${state.picking ? button("stop-pick", "Nokta seçimini bitir", false, "", UI_ICONS.arrowLeft) : ""}
    ${state.draft ? `${button("create", state.leaving ? "Gölü oluştur ve geç" : "Gölü oluştur", !ready || state.picking, "primary", UI_ICONS.add)}
      <div class="detail-actions-row">${button("cancel", "Taslağı sil", false, "detail-button-warning")}${button(state.leaving ? "resume" : "finish", state.leaving ? "Düzenlemeye dön" : "Düzenlemeyi bitir")}</div>` :
      lake ? button("finish", "Düzenlemeyi bitir", false, "", UI_ICONS.arrowLeft) : ""}
    ${lake ? `<div class="lake-result ${error ? "is-error" : ""}" role="status">${ready ? state.draft ? "Önizleme hazır · Henüz oluşturulmadı" : "Su yüzeyi hazır" : error ? "Su yüzeyi oluşturulamadı. Su seviyesini ve gelişmiş ayarlardaki hesaplama alanını kontrol edin." : "Su yüzeyi hesaplanıyor…"}</div>` : ""}
  </div>`;
  if (lake) {
    const a = resolveLakeAppearance(lake);
    section.insertAdjacentHTML("beforeend", group("basic", "Temel ayarlar", `
      <label class="detail-row"><span>Ad</span><input data-lake-name aria-label="Göl adı" value="${escape(lake.name ?? lake.id)}" ${disabled}></label>
      ${field("Su seviyesi (m)", "surfaceLevel", lake.surfaceLevel)}
      <div class="detail-hint">Su yüzeyinin dünya yüksekliği. Kıyı, suyun araziyle kesiştiği yerde oluşur.</div>
      ${button("reseed", "Dolum noktasını değiştir", locked || state.picking)}
      <div class="lake-toggles"><label class="detail-toggle"><input type="checkbox" data-lake-hidden ${lake.hidden ? "checked" : ""} ${disabled}> Gizli</label>
      <label class="detail-toggle"><input type="checkbox" data-lake-locked ${locked ? "checked" : ""}> Kilitli</label></div>
    `));
    section.insertAdjacentHTML("beforeend", group("appearance", "Su görünümü", `
      ${(["deepColor", "shallowColor"] as const).map((key) => `<label class="detail-row"><span>${key === "deepColor" ? "Derin su" : "Sığ su"}</span><input type="color" aria-label="${key === "deepColor" ? "Derin su rengi" : "Sığ su rengi"}" data-lake-color="${key}" value="${a[key]}" ${disabled}></label>`).join("")}
      ${field("Opaklık", "opacity", a.opacity, "0.05", 'min="0" max="1"')}
      ${field("Taban görünümü", "bedVisibility", a.bedVisibility, "0.05", 'min="0" max="1"')}
      ${field("Dalga ölçeği", "normalScale", a.normalScale)}
      ${field("Dalga hızı", "rippleSpeed", a.rippleSpeed)}
    `, true));
    section.insertAdjacentHTML("beforeend", group("advanced", "Gelişmiş ayarlar", `
      <div class="detail-subhead">Hesaplama alanı</div>
      <div class="detail-hint">Mavi çerçeve hesaplanacak alanı sınırlar; gölün kıyısı değildir. Dört mavi tutamacı sürükleyerek alanı büyütebilirsiniz.</div>
      ${field("Genişlik (m)", "width", lake.bounds.max[0] - lake.bounds.min[0], "1")}
      ${field("Uzunluk (m)", "length", lake.bounds.max[1] - lake.bounds.min[1], "1")}
      ${field("En küçük X", "minX", lake.bounds.min[0], "1")}${field("En küçük Z", "minZ", lake.bounds.min[1], "1")}
      ${field("En büyük X", "maxX", lake.bounds.max[0], "1")}${field("En büyük Z", "maxZ", lake.bounds.max[1], "1")}
      ${field("Dolum X", "seedX", lake.seed[0])}${field("Dolum Z", "seedZ", lake.seed[1])}
      <div class="detail-hint" data-lake-escape>Alan dışına taşma seviyesi: ${state.result?.escapeLevel?.toFixed(3) ?? "—"} m</div>
      <div class="detail-hint" data-lake-status>${escape(state.result?.message ?? "Calculating Lake…")}</div>
      ${button("retry", "Suyu yeniden hesapla", state.picking, "", UI_ICONS.refresh)}
      <div class="detail-subhead">Işık ve yansıma</div>
      ${field("Işık soğurumu (m)", "absorptionDistance", a.absorptionDistance)}
      ${field("Yansıma gücü", "reflectionStrength", a.reflectionStrength)}
      <label class="detail-row"><span>Yansıma</span><select data-lake-reflection ${disabled}><option value="off">Kapalı</option><option value="sharedPlanar">Düzlemsel yansıma</option></select></label>
      <label class="detail-row"><span>Yansıma kalitesi</span><select data-lake-quality ${disabled}><option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option></select></label>
      <label class="detail-row"><span>Yansıma grubu</span><input data-lake-group value="${escape(a.reflectionGroup)}" ${disabled}></label>
      <div class="detail-hint">Arazi: ${escape(lake.terrainRef)} · Dünya koordinatları</div>
      ${!state.draft ? `<div class="detail-actions-row">${button("terrain", "Araziyi seç")}${button("delete", "Gölü sil", locked, "detail-button-warning")}</div>` : ""}
    `, true));
  }
  body.append(section);
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
  const reflection = section.querySelector<HTMLSelectElement>("[data-lake-reflection]")!;
  reflection.value = resolveLakeAppearance(lake).reflectionMode;
  reflection.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionMode: reflection.value as "off" | "sharedPlanar" } }));
  const quality = section.querySelector<HTMLSelectElement>("[data-lake-quality]")!; quality.value = resolveLakeAppearance(lake).reflectionQuality;
  quality.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionQuality: quality.value as "low" | "medium" | "high" } }));
  section.querySelector<HTMLInputElement>("[data-lake-group]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, reflectionGroup: (e.target as HTMLInputElement).value } }));
}
