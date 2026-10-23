import type { EditableSelection } from "@/scene/SceneApp";

/** Shared by the instance/character/actor and special-actor Details renderers. */
export function appendSpatiallyLoadedDetails(
  body: HTMLElement,
  selection: EditableSelection,
  partitionEnabled: boolean,
  handleDetailToggle: (toggle: string, checked: boolean) => void,
): void {
  if (!partitionEnabled || selection.spatiallyLoaded === undefined) return;
  const directional = selection.kind === "light" && selection.lightType === "directional";
  body.insertAdjacentHTML("beforeend", `
    <div class="detail-section" data-detail-section="world-partition">
      <div class="detail-section-title">World Partition</div>
      <label class="detail-toggle" ${directional ? 'title="Directional lights are always persistent"' : ""}>
        <input type="checkbox" data-detail-toggle="spatiallyLoaded" data-detail-spatially-loaded
          ${selection.spatiallyLoaded ? "checked" : ""} ${directional || selection.locked ? "disabled" : ""}
          ${directional ? 'title="Directional lights are always persistent"' : ""} />
        <span>Spatially Loaded</span>
      </label>
    </div>`);
  body.querySelector<HTMLInputElement>("[data-detail-spatially-loaded]")
    ?.addEventListener("change", (event) => {
      handleDetailToggle("spatiallyLoaded", (event.currentTarget as HTMLInputElement).checked);
    });
}
