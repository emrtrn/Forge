import type { SceneApp } from "@/scene/SceneApp";
import { OCEAN_APPEARANCE, OCEAN_WAVES, type OceanEdge } from "@engine/scene/oceanWater";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Ocean controls share the existing Terrain / Water navigation and undo model. */
export function renderOceanDetails(element: HTMLElement, app: SceneApp): void {
  const { source, result } = app.getOceanEditorState(); if (!source) return;
  const disabled = source.locked ? "disabled" : "", waves = { ...OCEAN_WAVES, ...source.waves }, a = { ...OCEAN_APPEARANCE, ...source.appearance };
  const number = (group: string, key: string, label: string, value: number, min: number, max: number, step = .1) =>
    `<label class="detail-row"><span>${label}</span><input aria-label="${label}" data-ocean-${group}="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" ${disabled}></label>`;
  const select = (key: string, label: string, choices: readonly (readonly [string, string])[], value: string, inactive = false) =>
    `<label class="detail-row"><span>${label}</span><select aria-label="${label}" data-ocean-reflection="${key}" ${disabled || (inactive ? "disabled" : "")}>${choices.map(([id, text]) => `<option value="${id}" ${id === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
  element.insertAdjacentHTML("beforeend", `<div class="detail-section" data-detail-section="ocean"><div class="detail-section-title">Ocean</div>
    <div class="detail-hint">Deniz seviyesini ayarlayın. Açık kenarlara bağlı alanlar dolar; adalar ve bağlantısız iç çukurlar kuru kalır.</div>
    <label class="detail-row"><span>Name</span><input aria-label="Ocean Name" data-ocean-name value="${escape(source.name ?? "Ocean")}" ${disabled}></label>
    <label class="detail-toggle"><input type="checkbox" data-ocean-hidden ${source.hidden ? "checked" : ""} ${disabled}><span>Hidden</span></label>
    <label class="detail-toggle"><input type="checkbox" data-ocean-locked ${source.locked ? "checked" : ""}><span>Locked</span></label>
    ${number("body", "surfaceLevel", "Sea Level", source.surfaceLevel, -100000, 100000)}
    ${number("body", "offshoreDepth", "Offshore Depth", source.offshoreDepth, 1, 10000)}
    <div class="detail-hint">Open Boundaries · Deniz bu kenarlardan araziye bağlanır.</div>
    ${(["west", "east", "north", "south"] as const).map(edge => `<label class="detail-toggle"><input data-ocean-edge="${edge}" type="checkbox" ${source.openEdges.includes(edge) ? "checked" : ""} ${disabled}><span>${edge[0]!.toUpperCase() + edge.slice(1)}</span></label>`).join("")}
    <div class="detail-hint" data-ocean-status data-ocean-result="${result?.status ?? "preparing"}">${escape(result?.message ?? "Preparing Ocean…")}</div>
    <button type="button" class="detail-action-button" data-ocean-delete ${disabled}>Delete Ocean</button></div>
    <div class="detail-section" data-detail-section="ocean-waves"><div class="detail-section-title">Wind Sea & Swell</div>
    ${number("wave", "windSpeed", "Wind Speed (m/s)", waves.windSpeed, 1, 30)}
    ${number("wave", "windDirection", "Wind Direction", waves.windDirection, 0, 360, 1)}
    ${number("wave", "fetchKm", "Fetch (km)", waves.fetchKm, 1, 2000, 1)}
    ${number("wave", "swellStrength", "Swell Strength", waves.swellStrength, 0, 2, .05)}
    ${number("wave", "swellDirection", "Swell Direction", waves.swellDirection, 0, 360, 1)}
    ${number("wave", "choppiness", "Choppiness", waves.choppiness, 0, 1.5, .05)}
    ${number("wave", "seed", "Seed", waves.seed, 0, 4294967295, 1)}</div>
    <div class="detail-section" data-detail-section="ocean-surface"><div class="detail-section-title">Surface</div>
    ${(["shallowColor", "deepColor"] as const).map(key => `<label class="detail-row"><span>${key === "shallowColor" ? "Shallow Color" : "Deep Color"}</span><input data-ocean-color="${key}" type="color" value="${a[key]}" ${disabled}></label>`).join("")}
    ${number("appearance", "absorptionDistance", "Absorption Distance", a.absorptionDistance, .1, 100)}
    ${number("appearance", "roughness", "Roughness", a.roughness, .04, 1, .01)}
    ${number("appearance", "foamStrength", "Crest Foam Strength", a.foamStrength, 0, 2, .05)}</div>
    <div class="detail-section" data-detail-section="ocean-reflections"><div class="detail-section-title">Reflections</div>
    ${select("reflectionMode", "Reflection Mode", [["off", "Off"], ["environment", "Environment"], ["sharedPlanar", "Planar"]], a.reflectionMode)}
    ${number("appearance", "reflectionStrength", "Reflection Strength", a.reflectionStrength, 0, 1, .05)}
    ${select("reflectionQuality", "Reflection Quality", [["medium", "Medium"], ["high", "High"]], a.reflectionQuality, a.reflectionMode !== "sharedPlanar")}
    <label class="detail-row"><span>Reflection Group</span><input aria-label="Reflection Group" data-ocean-reflection="reflectionGroup" value="${escape(a.reflectionGroup)}" ${disabled || (a.reflectionMode !== "sharedPlanar" ? "disabled" : "")}></label>
    <div class="detail-hint">Environment gökyüzünü ve çevreyi, Planar sahnedeki nesneleri de yansıtır. Grup, kot ve kalite eşleştiğinde sular ortak yansıma kullanır. Grafik kalitesi Planar yansımaları sınırlandırabilir.</div></div>`);
  element.querySelector<HTMLInputElement>("[data-ocean-name]")?.addEventListener("change", event => app.editOcean({ name: (event.target as HTMLInputElement).value }));
  for (const key of ["hidden", "locked"] as const) element.querySelector<HTMLInputElement>(`[data-ocean-${key}]`)?.addEventListener("change", event => app.editOcean({ [key]: (event.target as HTMLInputElement).checked }));
  element.querySelectorAll<HTMLInputElement>("[data-ocean-body],[data-ocean-wave],[data-ocean-appearance]").forEach(input => input.addEventListener("change", () => {
    if (!Number.isFinite(input.valueAsNumber)) return;
    if (input.dataset.oceanBody) app.editOcean({ [input.dataset.oceanBody]: input.valueAsNumber });
    else if (input.dataset.oceanWave) app.editOcean({ waves: { ...source.waves, [input.dataset.oceanWave]: input.valueAsNumber } });
    else app.editOcean({ appearance: { ...source.appearance, [input.dataset.oceanAppearance!]: input.valueAsNumber } });
  }));
  element.querySelectorAll<HTMLInputElement>("[data-ocean-color]").forEach(input => input.addEventListener("change", () => app.editOcean({ appearance: { ...source.appearance, [input.dataset.oceanColor!]: input.value } })));
  element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ocean-reflection]").forEach(input => input.addEventListener("change", () => {
    const value = input.value.trim();
    if (!value || value.length > 256) return;
    app.editOcean({ appearance: { ...source.appearance, [input.dataset.oceanReflection!]: value } });
  }));
  element.querySelectorAll<HTMLInputElement>("[data-ocean-edge]").forEach(input => input.addEventListener("change", () => {
    const edge = input.dataset.oceanEdge as OceanEdge;
    app.editOcean({ openEdges: input.checked ? [...source.openEdges, edge] : source.openEdges.filter(e => e !== edge) });
  }));
  element.querySelector("[data-ocean-delete]")?.addEventListener("click", () => app.deleteOcean());
}
