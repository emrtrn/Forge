import { renderRiverEffectsDetails } from "./riverEffectsDetails";
import type { SceneApp } from "@/scene/SceneApp";
import type { SpecialActorDetailsOptions } from "./specialActorDetails";
import { LANDSCAPE_EDIT_MODES, landscapeModeSelect } from "./specialActorDetails";
import { applyWaterTooltips } from "./waterTooltips";
import { renderLakeDetails } from "./lakeDetails";
import type { LandscapeEditMode, RiverWaterDetailsPatch, RiverWaterDetailsView } from "@/scene/SceneApp";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Keep the same water navigation when a Lake replaces the Landscape selection. */
export function renderWaterSystemDetails(body: HTMLElement, app: SceneApp, options?: SpecialActorDetailsOptions): void {
  const context = app.getWaterSystemContext();
  if (!context) {
    renderLakeDetails(body, app, true);
    return;
  }
  body.innerHTML = `<div class="detail-heading"><strong>${escapeHtml(context.name)}</strong><span>terrain / water system</span></div>
    <div class="detail-section" data-detail-section="landscape-mode"><div class="detail-section-title">Landscape Mode</div>
      ${landscapeModeSelect({ ...app.getLandscapeSculptSettings(), editMode: "water" }, context.busy ? "disabled" : "", LANDSCAPE_EDIT_MODES)}
      ${options ? `<label class="detail-toggle"><input type="checkbox" data-detail-toggle="locked" ${context.locked ? "checked" : ""} /><span>Lock Movement</span></label>` : ""}
    </div>`;
  if (options) renderRiverWaterDetails(options, app.getLakeEditorState().available, app);
  else body.insertAdjacentHTML("beforeend", `<div class="detail-section"><div class="detail-section-title">Water</div>
    <button type="button" class="detail-action-button" data-water-terrain ${context.busy ? "disabled" : ""}>Back to Water</button>
    ${context.busy ? '<div class="detail-hint">Araç değiştirmeden önce nokta seçimini bitirin, ardından göl taslağını oluşturun ya da silin.</div>' : ""}
    </div><div data-water-bodies-slot></div>`);
  const slot = body.querySelector("[data-water-bodies-slot]");
  if (slot) slot.outerHTML = `<div class="detail-section" data-detail-section="water-bodies"><div class="detail-section-title">Water Bodies</div>
    <div class="landscape-layer-list">${context.bodies.map((water) => `<button type="button" data-water-body="${escapeHtml(water.id)}" data-water-kind="${water.kind}" class="${water.active ? "active" : ""}" aria-pressed="${water.active}" ${context.busy ? "disabled" : ""}>
      <span>${escapeHtml(water.name)}</span><span>${water.kind === "river" ? "River" : "Lake"}</span></button>`).join("") || '<div class="detail-hint">Henüz su kütlesi yok.</div>'}</div></div>`;
  body.querySelector<HTMLSelectElement>("[data-landscape-mode]")?.addEventListener("change", (event) => {
    const mode = (event.currentTarget as HTMLSelectElement).value as LandscapeEditMode;
    if (LANDSCAPE_EDIT_MODES.includes(mode)) app.selectWaterSystemTerrain(mode);
  });
  body.querySelector("[data-water-terrain]")?.addEventListener("click", () => app.selectWaterSystemTerrain());
  body.querySelector("[data-lake-begin]")?.addEventListener("click", () => app.beginLakeFill());
  body.querySelector<HTMLInputElement>('[data-detail-toggle="locked"]')?.addEventListener("change", (event) => {
    options?.handleDetailToggle("locked", (event.currentTarget as HTMLInputElement).checked);
  });
  body.querySelectorAll<HTMLButtonElement>("[data-water-body]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.waterKind;
      if (kind === "river" || kind === "lake") app.selectWaterSystemBody(kind, button.dataset.waterBody!);
    });
  });
  if (!options) renderLakeDetails(body, app);
}

function renderRiverWaterDetails(options: SpecialActorDetailsOptions, canAddLake: boolean, app: SceneApp): void {
  const { body, selection } = options;
  const lockedAttr = selection.locked ? "disabled" : "";
  const settings = options.getLandscapeSculptSettings();
  const splines = options.getSelectedLandscapeSplines();
  const riverWaters = options.getSelectedLandscapeRiverWaters();
  const availableRiverSplines = splines.filter(
    (spline) => spline.pointCount >= 2 && spline.segmentCount >= 1 && !riverWaters.some((water) => water.splineRef === spline.id),
  );
  const riverSourceSpline = availableRiverSplines.find((spline) => spline.id === settings.activeSplineId) ?? availableRiverSplines[0];
  const activeRiverWater = riverWaters.find((water) => water.id === settings.activeRiverWaterId) ?? riverWaters[0];
  const riverWaterMarkup = activeRiverWater
    ? `<div class="landscape-heightmap-actions"><button type="button" class="detail-action-button" data-river-water-delete ${lockedAttr}>Delete River</button></div><div class="detail-section" data-detail-section="river-surface"><div class="detail-section-title">Surface</div>
        <label class="detail-row"><span>Start Water Height (${activeRiverWater.coordinateSpace === "world" ? "World" : "Local"} Y)</span><input data-river-water-number="surfaceLevel" type="number" step="0.1" value="${activeRiverWater.surfaceLevel}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Width Scale</span><input data-river-water-number="widthScale" type="number" min="0.05" max="10" step="0.05" value="${activeRiverWater.widthScale}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Deep Color</span><input data-river-water-color="deepColor" type="color" value="${escapeHtml(activeRiverWater.deepColor)}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Shallow Color</span><input data-river-water-color="shallowColor" type="color" value="${escapeHtml(activeRiverWater.shallowColor)}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Opacity</span><input data-river-water-number="opacity" type="number" min="0" max="1" step="0.05" value="${activeRiverWater.opacity}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Bed Visibility</span><input data-river-water-number="bedVisibility" type="number" min="0" max="1" step="0.05" value="${activeRiverWater.bedVisibility}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Absorption Distance</span><input data-river-water-number="absorptionDistance" type="number" data-slider-max="20" min="0.01" max="100" step="0.05" value="${activeRiverWater.absorptionDistance}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Refraction Strength</span><input data-river-water-number="refractionStrength" type="number" min="0" max="2" step="0.05" value="${activeRiverWater.refractionStrength}" ${lockedAttr} /></label>
        ${activeRiverWater.refractionWarning ? `<div class="detail-note" data-river-refraction-status title="${escapeHtml(activeRiverWater.refractionWarning)}">Kırılma kullanılamıyor; taban optiği korunuyor.</div>` : ""}
      </div><div class="detail-section" data-detail-section="river-flow"><div class="detail-section-title">Flow & Waves</div>
        <label class="detail-row"><span>Surface Strength</span><input data-river-water-number="surfaceStrength" type="number" min="0" max="2" step="0.05" value="${activeRiverWater.surfaceStrength}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Surface Roughness</span><input data-river-water-number="surfaceRoughness" type="number" min="0.04" max="1" step="0.01" value="${activeRiverWater.surfaceRoughness}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Flow Speed</span><input data-river-water-number="flowSpeed" type="number" min="0" max="10" step="0.05" value="${activeRiverWater.flowSpeed}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Normal Scale</span><input data-river-water-number="normalScale" type="number" data-slider-max="5" min="0.05" max="20" step="0.05" value="${activeRiverWater.normalScale}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Wave Amplitude</span><input data-river-water-number="waveAmplitude" type="number" min="0" max="1" step="0.01" value="${activeRiverWater.waveAmplitude}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Wave Length</span><input data-river-water-number="waveLength" type="number" data-slider-max="40" min="0.1" max="100" step="0.1" value="${activeRiverWater.waveLength}" ${lockedAttr} /></label>
      </div><div class="detail-section" data-detail-section="river-foam"><div class="detail-section-title">Foam</div>
        <label class="detail-row"><span>Foam Color</span><input data-river-water-color="foamColor" type="color" value="${escapeHtml(activeRiverWater.foamColor)}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Foam Opacity</span><input data-river-water-number="foamOpacity" type="number" min="0" max="1" step="0.05" value="${activeRiverWater.foamOpacity}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Band Spacing</span><input data-river-water-number="shoreWaveSpacing" type="number" min="0.5" max="20" step="0.1" value="${activeRiverWater.shoreWaveSpacing}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Inward Speed</span><input data-river-water-number="shoreWaveSpeed" type="number" min="0" max="10" step="0.05" value="${activeRiverWater.shoreWaveSpeed}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Shore Wave Reach</span><input data-river-water-number="shoreWaveReach" type="number" min="0.05" max="1" step="0.05" value="${activeRiverWater.shoreWaveReach}" ${lockedAttr} /></label>
        <label class="detail-row"><span>Breakup Scale</span><input data-river-water-number="shoreWaveBreakupScale" type="number" min="0.1" max="10" step="0.05" value="${activeRiverWater.shoreWaveBreakupScale}" ${lockedAttr} /></label>
      </div><div class="detail-section" data-detail-section="river-reflection"><div class="detail-section-title">Reflection</div>
        <label class="detail-row"><span>Mode</span><select data-river-water-reflection="reflectionMode" ${lockedAttr}><option value="off" ${activeRiverWater.reflectionMode === "off" ? "selected" : ""}>Off</option><option value="environment" ${activeRiverWater.reflectionMode === "environment" ? "selected" : ""}>Environment / Captures</option></select></label>
        <label class="detail-row"><span>Quality</span><select data-river-water-reflection="reflectionQuality" ${lockedAttr}>${["low", "medium", "high"].map((quality) => `<option value="${quality}" ${activeRiverWater.reflectionQuality === quality ? "selected" : ""}>${quality}</option>`).join("")}</select></label>
        <label class="detail-row"><span>Strength</span><input data-river-water-number="reflectionStrength" type="number" min="0" max="1" step="0.05" value="${activeRiverWater.reflectionStrength}" ${lockedAttr} /></label>
      </div>`
    : `<div class="detail-section"><div class="detail-section-title">River Water</div><div class="detail-hint">Tamamlanmış bir Landscape spline'ından nehir su kütlesi oluşturun. Spline'ın genişliğini ve ilk kontrol noktasının yüksekliğini hemen kullanır.</div></div>`;
  const riverWaterCreateMarkup = `<div class="detail-section">
      <div class="detail-section-title">Water</div>
      <label class="detail-row"><span>Source Spline</span><select data-river-water-create-spline ${availableRiverSplines.length ? lockedAttr : "disabled"}>${availableRiverSplines.map((spline) => `<option value="${escapeHtml(spline.id)}" ${riverSourceSpline?.id === spline.id ? "selected" : ""}>${escapeHtml(spline.name)} (${spline.segmentCount} segments)</option>`).join("") || "<option value=\"\">No completed unbound spline</option>"}</select></label>
      <div class="landscape-heightmap-actions"><button type="button" class="detail-action-button" data-river-water-create ${availableRiverSplines.length ? lockedAttr : "disabled"}>Add River</button>
      <button type="button" class="detail-action-button" data-lake-begin ${canAddLake ? lockedAttr : "disabled"}>Add Lake</button></div>
      ${availableRiverSplines.length ? "" : `<button type="button" class="detail-action-button" data-water-create-spline ${lockedAttr}>Create Spline</button>`}
    </div>`;
  body.insertAdjacentHTML("beforeend", riverWaterCreateMarkup + '<div data-water-bodies-slot></div>' + riverWaterMarkup);
  if (activeRiverWater) renderRiverEffectsDetails(body,app,activeRiverWater,!!selection.locked);
  applyWaterTooltips(body);
  body.querySelector("[data-water-create-spline]")?.addEventListener("click", () => {
    options.setLandscapeSculptSettings({ editMode: "splines", splineTool: "draw" });
    options.createSelectedLandscapeSpline();
    options.refreshDetails();
  });
  body.querySelector<HTMLButtonElement>("[data-river-water-create]")?.addEventListener("click", () => {
    const splineId = body.querySelector<HTMLSelectElement>("[data-river-water-create-spline]")?.value;
    if (!splineId) return;
    options.createSelectedLandscapeRiverWater(splineId);
    options.refreshDetails();
  });
  const selectedRiverWater = (): RiverWaterDetailsView | null => {
    const waters = options.getSelectedLandscapeRiverWaters();
    const activeId = options.getLandscapeSculptSettings().activeRiverWaterId;
    return waters.find((water) => water.id === activeId) ?? waters[0] ?? null;
  };
  body.querySelector<HTMLButtonElement>("[data-river-water-delete]")?.addEventListener("click", () => {
    const water = selectedRiverWater();
    if (!water) return;
    options.deleteSelectedLandscapeRiverWater(water.id);
    options.refreshDetails();
  });
  body.querySelectorAll<HTMLInputElement>("[data-river-water-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const water = selectedRiverWater();
      const key = input.dataset.riverWaterNumber as keyof Pick<RiverWaterDetailsPatch, "surfaceLevel" | "widthScale" | "flowSpeed" | "normalScale" | "surfaceStrength" | "surfaceRoughness" | "refractionStrength" | "opacity" | "bedVisibility" | "absorptionDistance" | "waveAmplitude" | "waveLength" | "foamOpacity" | "shoreWaveSpacing" | "shoreWaveSpeed" | "shoreWaveReach" | "shoreWaveBreakupScale" | "reflectionStrength"> | undefined;
      const value = Number(input.value);
      if (!water || !key || !Number.isFinite(value)) return;
      options.setSelectedLandscapeRiverWater(water.id, { [key]: value } as RiverWaterDetailsPatch);
      options.refreshDetails();
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-river-water-color]").forEach((input) => {
    input.addEventListener("change", () => {
      const water = selectedRiverWater();
      const key = input.dataset.riverWaterColor as "deepColor" | "shallowColor" | "foamColor" | undefined;
      if (!water || !key) return;
      options.setSelectedLandscapeRiverWater(water.id, { [key]: input.value } as RiverWaterDetailsPatch);
      options.refreshDetails();
    });
  });
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-river-water-reflection]").forEach((input) => {
    input.addEventListener("change", () => {
      const water = selectedRiverWater();
      const key = input.dataset.riverWaterReflection as "reflectionMode" | "reflectionGroup" | "reflectionQuality" | undefined;
      if (!water || !key) return;
      const value = input.value;
      if (key === "reflectionMode" && value !== "off" && value !== "environment") return;
      if (key === "reflectionQuality" && value !== "low" && value !== "medium" && value !== "high") return;
      options.setSelectedLandscapeRiverWater(water.id, { [key]: value } as RiverWaterDetailsPatch);
      options.refreshDetails();
    });
  });

}
