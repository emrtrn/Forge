import { defaultWaterContactFoam, validateWaterContactFoam, type WaterContactFoam } from "@engine/scene/waterContactFoam";
import type { Vec3 } from "@engine/scene/layout";

/** Shared Lake/River authoring; edits enter the owner's existing undo command. */
export function renderWaterContactFoamDetails(parent: HTMLElement, source: WaterContactFoam | undefined, centre: Vec3,
  locked: boolean, edit: (settings: WaterContactFoam) => void, river = false): void {
  const settings = structuredClone(source ?? defaultWaterContactFoam());
  const section = document.createElement("div"); section.className = "detail-section";
  section.dataset.detailSection = "water-contact-foam";
  const disabled = locked ? "disabled" : "";
  const field = (label: string, key: string, value: number, min: number, max: number) =>
    `<label class="detail-row"><span>${label}</span><input aria-label="${label}" data-contact-number="${key}" type="number" step="any" min="${min}" max="${max}" value="${value}" ${disabled}></label>`;
  section.innerHTML = `<div class="detail-section-title">Contact Foam</div>
    <div class="detail-hint">Taş veya iskele için bir temas alanı ekleyin. Konum ve boyutu suya değen bölüme ayarlayın. X yarıçapı uzun eksendir; Y ve yarı yükseklik suyla kesişmeyi belirler. River’da iz akışın arkasına uzar. Bu alanlar taş geometrisini değiştirmez.</div>
    <label class="detail-toggle"><input data-contact-enabled aria-label="Contact Foam Enabled" type="checkbox" ${settings.enabled ? "checked" : ""} ${disabled}> Enabled</label>
    ${river ? field("Contact Shore Width (m)", "shoreWidth", settings.shoreWidth, .2, 4) : ""}
    ${field("Contact Pattern Size (m)", "scale", settings.scale, .1, 10)}
    ${field("Contact Pattern Speed", "speed", settings.speed, 0, 3)}
    <button class="detail-action-button" data-contact-add ${locked || settings.obstacles.length >= 16 ? "disabled" : ""}>Add Obstacle Contact</button>`;
  const commit = () => { if (!locked) edit(validateWaterContactFoam(settings)); };
  section.querySelector<HTMLInputElement>("[data-contact-enabled]")!.addEventListener("change", e => { settings.enabled = (e.target as HTMLInputElement).checked; commit(); });
  section.querySelectorAll<HTMLInputElement>("[data-contact-number]").forEach(input => input.addEventListener("change", () => {
    const key = input.dataset.contactNumber as "shoreWidth" | "scale" | "speed";
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) return;
    settings[key] = input.valueAsNumber; commit();
  }));
  section.querySelector("[data-contact-add]")!.addEventListener("click", () => {
    if (locked || settings.obstacles.length >= 16) return;
    let index = 1; while (settings.obstacles.some(o => o.id === `obstacle-${index}`)) index++;
    settings.obstacles.push({ id: `obstacle-${index}`, kind: "ellipse", position: [...centre], radii: [1, 1], rotation: 0, halfHeight: 1, width: .3, strength: .8, wakeLength: 4 });
    settings.enabled = true; commit();
  });
  settings.obstacles.forEach((obstacle, index) => {
    const row = document.createElement("div"); row.dataset.contactObstacle = String(index);
    row.innerHTML = `<div class="detail-subsection-title"><span>Obstacle ${index + 1}</span><button class="detail-action-button" data-contact-delete ${disabled}>Delete</button></div>
      <label class="detail-toggle"><input data-contact-visible type="checkbox" ${!obstacle.hidden ? "checked" : ""} ${disabled}> Visible</label>
      <label class="detail-row"><span>Shape</span><select data-contact-shape ${disabled}><option value="ellipse" ${obstacle.kind === "ellipse" ? "selected" : ""}>Ellipse / Circle</option><option value="capsule" ${obstacle.kind === "capsule" ? "selected" : ""}>Capsule</option></select></label>
      ${field("Obstacle X", "x", obstacle.position[0], -1e9, 1e9)}${field("Obstacle Y", "y", obstacle.position[1], -1e9, 1e9)}${field("Obstacle Z", "z", obstacle.position[2], -1e9, 1e9)}
      ${field("Radius X (m)", "rx", obstacle.radii[0], .05, 100)}${field("Radius Z (m)", "rz", obstacle.radii[1], .05, 100)}
      ${field("Rotation (deg)", "rotation", obstacle.rotation, -360, 360)}${field("Half Height (m)", "halfHeight", obstacle.halfHeight, .05, 100)}
      ${field("Contact Band (m)", "width", obstacle.width, .1, 4)}${field("Contact Strength", "strength", obstacle.strength, 0, 1)}${field("Wake Length (m)", "wakeLength", obstacle.wakeLength, 0, 30)}`;
    row.querySelector("[data-contact-delete]")!.addEventListener("click", () => { settings.obstacles.splice(index, 1); commit(); });
    row.querySelector<HTMLInputElement>("[data-contact-visible]")!.addEventListener("change", e => { obstacle.hidden = !(e.target as HTMLInputElement).checked; commit(); });
    row.querySelector<HTMLSelectElement>("[data-contact-shape]")!.addEventListener("change", e => { obstacle.kind = (e.target as HTMLSelectElement).value as "ellipse" | "capsule"; commit(); });
    row.querySelectorAll<HTMLInputElement>("[data-contact-number]").forEach(input => input.addEventListener("change", () => {
      if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) return;
      const key = input.dataset.contactNumber!, value = input.valueAsNumber;
      if (key === "x" || key === "y" || key === "z") obstacle.position[{ x: 0, y: 1, z: 2 }[key]] = value;
      else if (key === "rx" || key === "rz") obstacle.radii[key === "rx" ? 0 : 1] = value;
      else obstacle[key as "rotation" | "halfHeight" | "width" | "strength" | "wakeLength"] = value;
      commit();
    }));
    section.append(row);
  });
  parent.append(section);
}
