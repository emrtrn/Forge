import type { SceneApp } from "@/scene/SceneApp";
import { LAKE_SURFACE_WAVE_DEFAULTS, LAKE_WHEEL_RIPPLE_DEFAULTS, LAKE_WHEEL_WET_TRAIL_DEFAULTS, resolveLakeAppearance } from "@engine/scene/waterBody";
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
      ${field("Shore Blend Depth (m)", "shoreBlendDepth", a.shoreBlendDepth, "0.05", 'min="0" max="2"')}
      ${field("Surface Strength", "surfaceStrength", a.surfaceStrength, "0.05", 'min="0" max="2"')}
      ${field("Surface Roughness", "surfaceRoughness", a.surfaceRoughness, "0.02", 'min="0.04" max="1"')}
      ${field("Normal Scale", "normalScale", a.normalScale)}
      ${field("Ripple Speed", "rippleSpeed", a.rippleSpeed)}
    `, true));
    section.insertAdjacentHTML("beforeend", group("surface-waves", "Surface Waves", `
      <div class="detail-hint">Yüzeyin hafif yükselip alçalması. Height, ortalama seviyeden en fazla sapmadır; kıyıda hareket söner.</div>
      <label class="detail-toggle"><input type="checkbox" data-lake-surface-waves aria-label="Surface Waves Enabled" ${a.surfaceWavesEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Height (cm)", "surfaceWaveHeight", a.surfaceWaveHeight * 100, "0.5", 'min="0" max="10"')}
      ${field("Wavelength (m)", "surfaceWaveLength", a.surfaceWaveLength, "1", 'min="6" max="40"')}
      ${field("Period (s)", "surfaceWavePeriod", a.surfaceWavePeriod, "0.5", 'min="2" max="12"')}
      ${field("Direction (°)", "surfaceWaveDirection", a.surfaceWaveDirection, "5", 'min="0" max="360"')}
      ${field("Shore Fade Depth (m)", "surfaceWaveShoreDepth", a.surfaceWaveShoreDepth, "0.05", 'min="0.1" max="2"')}
      ${button("reset-surface-waves", "Reset Surface Waves", locked)}
    `));
    section.insertAdjacentHTML("beforeend", group("wheel-ripples", "Wheel Ripples", `
      <div class="detail-hint">Play modunda tekerleklerin oluşturduğu dalgalar. Strength görünürlüğü artırır; doğal yüzey ayarlarından bağımsızdır.</div>
      <label class="detail-toggle"><input type="checkbox" data-lake-wheel-ripples aria-label="Wheel Ripples Enabled" ${a.wheelRipplesEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Wave Strength", "wheelRippleStrength", a.wheelRippleStrength, "0.1", 'min="0" max="6"')}
      ${field("Spread Speed (m/s)", "wheelRippleSpeed", a.wheelRippleSpeed, "0.1", 'min="0.2" max="5"')}
      ${field("Ring Width (m)", "wheelRippleWidth", a.wheelRippleWidth, "0.05", 'min="0.1" max="2"')}
      ${field("Wavelength (m)", "wheelRippleWavelength", a.wheelRippleWavelength, "0.05", 'min="0.1" max="2"')}
      ${field("Lifetime (s)", "wheelRippleLifetime", a.wheelRippleLifetime, "0.1", 'min="0.2" max="4"')}
      ${field("Emission Interval (s)", "wheelRippleInterval", a.wheelRippleInterval, "0.02", 'min="0.04" max="1"')}
      ${button("reset-wheel-ripples", "Reset Wave Settings", locked)}
    `));
    section.insertAdjacentHTML("beforeend", group("wheel-wet-trail", "Wheel Wet Trail", `
      <div class="detail-hint">Play modunda gölden ya da ıslak kıyıdan çıkan tekerleklerin kuru zeminde bıraktığı ıslak iz.</div>
      <label class="detail-toggle"><input type="checkbox" data-lake-wet-trail aria-label="Wheel Wet Trail Enabled" ${a.wheelWetTrailEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Trail Length (m)", "wheelWetTrailLength", a.wheelWetTrailLength, "0.5", 'min="0.5" max="10"')}
      ${field("Trail Strength", "wheelWetTrailStrength", a.wheelWetTrailStrength, "0.05", 'min="0" max="1"')}
      ${field("Dry Time (s)", "wheelWetTrailDrySeconds", a.wheelWetTrailDrySeconds, "5", 'min="5" max="180"')}
      ${button("reset-wet-trail", "Reset Wet Trail", locked)}
    `, true));
    section.insertAdjacentHTML("beforeend", group("wet-shore", "Wet Shore", `
      <label class="detail-toggle"><input type="checkbox" data-lake-wet-shore aria-label="Wet Shore Enabled" ${a.shoreWetnessEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Wet Band Width (m)", "shoreWetnessWidth", a.shoreWetnessWidth, "0.1", 'min="0.2" max="4"')}
      ${field("Wet Band Strength", "shoreWetnessStrength", a.shoreWetnessStrength, "0.05", 'min="0" max="1"')}
    `, true));
    section.insertAdjacentHTML("beforeend", group("foam", "Shore Foam", `
      <label class="detail-toggle"><input type="checkbox" data-lake-foam aria-label="Shore Foam Enabled" ${a.foamEnabled ? "checked" : ""} ${disabled}> Enabled</label>
      ${field("Foam Opacity", "foamOpacity", a.foamOpacity, "0.05", 'min="0" max="1"')}
      ${field("Foam Width (m)", "foamWidth", a.foamWidth, "0.1", 'min="0.2" max="4"')}
      ${field("Foam Pattern Size (m)", "foamScale", a.foamScale, "0.1", 'min="0.1" max="10"')}
      ${field("Foam Speed", "foamSpeed", a.foamSpeed, "0.05", 'min="0" max="3"')}
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
  click("reset-surface-waves", () => app.editLake({ appearance: { ...lake.appearance, ...LAKE_SURFACE_WAVE_DEFAULTS } }));
  section.querySelector<HTMLInputElement>("[data-lake-surface-waves]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, surfaceWavesEnabled: (e.target as HTMLInputElement).checked } }));
  click("reset-wheel-ripples", () => app.editLake({ appearance: { ...lake.appearance, ...LAKE_WHEEL_RIPPLE_DEFAULTS } }));
  section.querySelector<HTMLInputElement>("[data-lake-wheel-ripples]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, wheelRipplesEnabled: (e.target as HTMLInputElement).checked } }));
  click("reset-wet-trail", () => app.editLake({ appearance: { ...lake.appearance, ...LAKE_WHEEL_WET_TRAIL_DEFAULTS } }));
  section.querySelector<HTMLInputElement>("[data-lake-wet-trail]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, wheelWetTrailEnabled: (e.target as HTMLInputElement).checked } }));
  section.querySelector<HTMLInputElement>("[data-lake-name]")?.addEventListener("change", (event) => app.editLake({ name: (event.target as HTMLInputElement).value }));
  for (const input of section.querySelectorAll<HTMLInputElement>("[data-lake-number]")) input.addEventListener("change", () => {
    const key = input.dataset.lakeNumber!; let value = Number(input.value); if (!Number.isFinite(value)) return;
    if (key === "surfaceWaveHeight") value /= 100;
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
  section.querySelector<HTMLInputElement>("[data-lake-wet-shore]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, shoreWetnessEnabled: (e.target as HTMLInputElement).checked } }));
  section.querySelector<HTMLInputElement>("[data-lake-foam]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, foamEnabled: (e.target as HTMLInputElement).checked } }));
  section.querySelector<HTMLInputElement>("[data-lake-caustics]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, causticsEnabled: (e.target as HTMLInputElement).checked } }));
  const reflection = section.querySelector<HTMLSelectElement>("[data-lake-reflection]")!;
  reflection.value = resolveLakeAppearance(lake).reflectionMode;
  reflection.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionMode: reflection.value as "off" | "sharedPlanar" } }));
  const quality = section.querySelector<HTMLSelectElement>("[data-lake-quality]")!; quality.value = resolveLakeAppearance(lake).reflectionQuality;
  quality.addEventListener("change", () => app.editLake({ appearance: { ...lake.appearance, reflectionQuality: quality.value as "low" | "medium" | "high" } }));
  section.querySelector<HTMLInputElement>("[data-lake-group]")?.addEventListener("change", (e) => app.editLake({ appearance: { ...lake.appearance, reflectionGroup: (e.target as HTMLInputElement).value } }));
}
