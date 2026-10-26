import type { SceneApp } from "@/scene/SceneApp";
import { resolveLakeAppearance } from "@engine/scene/waterBody";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Mounted by EditorUi before finalizeDetailsRender, including all async refreshes. */
export function renderLakeDetails(body: HTMLElement, app: SceneApp, replace = false): void {
  const state = app.getLakeEditorState(), lake = state.source;
  if (!state.available && !lake && !state.picking) return;
  if (replace) body.innerHTML = "";
  const section = document.createElement("div"); section.className = "detail-section"; section.dataset.lakePanel = "";
  const disabled = lake?.locked ? "disabled" : "";
  const field = (label: string, key: string, value: number, step = "0.1") => `<label class="detail-row"><span>${label}</span><input data-lake-number="${key}" type="number" step="${step}" value="${Number(value.toFixed(6))}" ${disabled}></label>`;
  section.innerHTML = `<h3>Lake · Fill existing depression</h3>
    ${!lake ? `<button type="button" data-lake-begin ${state.available && !state.picking ? "" : "disabled"}>Choose Lake seed</button>` : ""}
    ${state.picking ? `<div class="detail-hint">Click the terrain inside the depression. Escape cancels.</div>` : ""}
    ${lake ? `<label class="detail-row"><span>Name</span><input data-lake-name value="${escape(lake.name ?? lake.id)}" ${disabled}></label>
      <div class="detail-hint">Terrain: ${escape(lake.terrainRef)} · World coordinates</div>
      ${field("Water level · World Y", "surfaceLevel", lake.surfaceLevel)}
      ${field("Seed X", "seedX", lake.seed[0])}${field("Seed Z", "seedZ", lake.seed[1])}
      <button type="button" data-lake-reseed ${disabled}>Pick another seed</button>
      <div class="detail-hint">Work area limits computation. It is not a shoreline. Drag the four blue edge handles or edit bounds below.</div>
      ${field("Min X", "minX", lake.bounds.min[0], "1")}${field("Min Z", "minZ", lake.bounds.min[1], "1")}
      ${field("Max X", "maxX", lake.bounds.max[0], "1")}${field("Max Z", "maxZ", lake.bounds.max[1], "1")}
      ${field("Width", "width", lake.bounds.max[0] - lake.bounds.min[0], "1")}${field("Length", "length", lake.bounds.max[1] - lake.bounds.min[1], "1")}
      <div class="detail-hint" data-lake-status>${escape(state.result?.message ?? "Calculating Lake…")}</div>
      <div class="detail-hint" data-lake-escape>Area escape level: ${state.result?.escapeLevel?.toFixed(3) ?? "—"}</div>
      <button type="button" data-lake-retry>Recalculate / Retry</button>
      ${["deepColor", "shallowColor"].map((key) => `<label class="detail-row"><span>${key === "deepColor" ? "Deep color" : "Shallow color"}</span><input type="color" data-lake-color="${key}" value="${resolveLakeAppearance(lake)[key as "deepColor" | "shallowColor"]}" ${disabled}></label>`).join("")}
      ${(["opacity", "bedVisibility", "absorptionDistance", "normalScale", "rippleSpeed", "reflectionStrength"] as const).map((key) => field(({ opacity: "Opacity", bedVisibility: "Bed visibility", absorptionDistance: "Absorption distance", normalScale: "Ripple scale", rippleSpeed: "Ripple speed", reflectionStrength: "Reflection strength" })[key], key, resolveLakeAppearance(lake)[key])).join("")}
      <label class="detail-row"><span>Reflection</span><select data-lake-reflection ${disabled}><option value="off">Off</option><option value="sharedPlanar">Shared planar</option></select></label>
      <label class="detail-row"><span>Reflection quality</span><select data-lake-quality ${disabled}>${["low", "medium", "high"].map((q) => `<option>${q}</option>`).join("")}</select></label>
      <label class="detail-row"><span>Reflection group</span><input data-lake-group value="${escape(resolveLakeAppearance(lake).reflectionGroup)}" ${disabled}></label>
      <label class="detail-row"><span>Hidden</span><input type="checkbox" data-lake-hidden ${lake.hidden ? "checked" : ""} ${disabled}></label>
      <label class="detail-row"><span>Locked</span><input type="checkbox" data-lake-locked ${lake.locked ? "checked" : ""}></label>
      ${state.draft ? `<button type="button" data-lake-create ${state.result?.status === "ready" ? "" : "disabled"}>Create Lake</button>` : `<button type="button" data-lake-terrain>Edit terrain</button><button type="button" data-lake-delete ${disabled}>Delete Lake</button>`}` : ""}
    ${state.draft || state.picking ? `<button type="button" data-lake-cancel>Cancel Lake</button>` : ""}`;
  body.append(section);
  const click = (name: string, fn: () => void) => section.querySelector(`[data-lake-${name}]`)?.addEventListener("click", fn);
  click("begin", () => app.beginLakeFill()); click("reseed", () => app.beginLakeReseed()); click("cancel", () => app.cancelLake());
  click("create", () => app.commitLake()); click("retry", () => app.retryLake()); click("delete", () => app.deleteLake());
  click("terrain", () => app.selectLakeTerrain());
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
