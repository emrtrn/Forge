import type { CollisionPresetId } from "@engine/scene/collision";
import { AMBIENT_SOUND_ASSET_ID } from "@engine/scene/shapes";
import type { EditableSelection } from "@/scene/SceneApp";
import { pivotRow, scaleRow, vectorRow } from "./transformRows";

export interface InstanceDetailsSections {
  material: string;
  /** Play-mode animation clip picker; only non-empty for a skeletal `character`. */
  animation: string;
  navigation: string;
  collision: string;
  physics: string;
  components: string;
  metadata: string;
}

export interface InstanceDetailsRenderOptions {
  selection: EditableSelection;
  sections: InstanceDetailsSections;
  pivotEditActive: boolean;
}

export interface InstanceDetailsBindOptions {
  body: HTMLElement;
  selection: EditableSelection;
  beginDetailsEdit: () => void;
  applyDetails: () => void;
  applyScaleInput: (input: HTMLInputElement) => void;
  commitDetailsEdit: () => void;
  setSelectionScaleLocked: (locked: boolean) => void;
  commitPivotInput: () => void;
  applySelectionPivotPreset: (preset: "reset" | "center" | "base") => void;
  togglePivotEditMode: () => void;
  renameSceneObject: (id: string, name: string) => void;
  handleDetailAction: (action: string) => void;
  handleDetailToggle: (toggle: string, checked: boolean) => void;
  setSelectionCollisionPreset: (preset: CollisionPresetId | undefined) => void;
  bindNavigationInputs: () => void;
  bindCollisionOverrideInputs: (selection: EditableSelection) => void;
  setSelectionMaterialSlot: (assetId: string | undefined) => void;
  setSelectionAnimation: (clip: string | undefined) => void;
  bindPhysicsInputs: () => void;
  bindComponentsInputs: () => void;
  bindActorPatrolRouteInputs: () => void;
  bindMetadataInputs: () => void;
}

export function renderInstanceDetails({
  selection,
  sections,
  pivotEditActive,
}: InstanceDetailsRenderOptions): string {
  // An Ambient Sound emitter is a transform + Audio component only: it has no
  // mesh/material, no collision/physics, and no pivot/placement affordances, so
  // those Details sections are hidden to keep the panel focused on the sound.
  const isAmbientSound =
    selection.kind === "instance" && selection.assetId === AMBIENT_SOUND_ASSET_ID;

  const lockedAttr = selection.locked ? "disabled" : "";
  const wallDisabled = selection.locked || selection.kind === "character" ? "disabled" : "";
  const castShadowToggle =
    selection.kind === "character"
      ? `<label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="castShadow" ${
            selection.castShadow ? "checked" : ""
          } />
          <span>Cast Shadow</span>
        </label>`
      : "";

  return `
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="${escapeHtml(selection.assetId)}" />
      </label>
      <div class="detail-row">
        <span>Category</span>
        <span class="detail-value">${
          selection.category ? escapeHtml(selection.category) : "â€”"
        }</span>
      </div>
      <div class="detail-section" data-detail-section="transform">
        <div class="detail-section-title">Transform</div>
        ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
        ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
        ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
        <div class="detail-actions-row">
          <button type="button" data-detail-action="reset" ${lockedAttr}
            title="Rotation'ı 0'a, Scale'i 1'e sıfırla">Reset</button>
          <button type="button" data-detail-action="copy"
            title="Bu transform'u kopyala">Copy</button>
          <button type="button" data-detail-action="paste" ${lockedAttr}
            title="Kopyalanan transform'u yapıştır">Paste</button>
        </div>
      </div>
      ${
        isAmbientSound
          ? ""
          : `<div class="detail-section" data-detail-section="pivot">
        <div class="detail-section-title">Pivot</div>
        ${pivotRow(selection.pivot, selection.locked, pivotEditActive)}
      </div>`
      }
      ${isAmbientSound ? "" : sections.material}
      ${
        isAmbientSound
          ? ""
          : `<div class="detail-section">
        <div class="detail-section-title">Placement</div>
        <div class="detail-actions-row">
          <button type="button" data-detail-action="snap-floor" ${lockedAttr}
            title="Alttaki yüzeye bırak (End)">Snap to Floor</button>
          <button type="button" data-detail-action="snap-wall" ${wallDisabled}
            title="En yakın duvara yasla">Snap to Wall</button>
        </div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="locked" ${selection.locked ? "checked" : ""} />
          <span>Lock Movement</span>
        </label>
        ${castShadowToggle}
      </div>`
      }
      ${sections.animation}
      ${isAmbientSound ? "" : sections.navigation}
      ${isAmbientSound ? "" : sections.collision}
      ${isAmbientSound ? "" : sections.physics}
      ${sections.components}
      ${sections.metadata}
    `;
}

export function bindInstanceDetails({
  body,
  selection,
  beginDetailsEdit,
  applyDetails,
  applyScaleInput,
  commitDetailsEdit,
  setSelectionScaleLocked,
  commitPivotInput,
  applySelectionPivotPreset,
  togglePivotEditMode,
  renameSceneObject,
  handleDetailAction,
  handleDetailToggle,
  setSelectionCollisionPreset,
  bindNavigationInputs,
  bindCollisionOverrideInputs,
  setSelectionMaterialSlot,
  setSelectionAnimation,
  bindPhysicsInputs,
  bindComponentsInputs,
  bindActorPatrolRouteInputs,
  bindMetadataInputs,
}: InstanceDetailsBindOptions): void {
  body.querySelectorAll<HTMLInputElement>('input[data-detail="pr"]').forEach((input) => {
    input.addEventListener("focus", () => beginDetailsEdit());
    input.addEventListener("input", () => {
      beginDetailsEdit();
      applyDetails();
    });
    input.addEventListener("change", () => commitDetailsEdit());
  });

  body.querySelectorAll<HTMLInputElement>('input[data-detail="scale"]').forEach((input) => {
    input.addEventListener("focus", () => beginDetailsEdit());
    input.addEventListener("input", () => {
      beginDetailsEdit();
      applyScaleInput(input);
      applyDetails();
    });
    input.addEventListener("change", () => commitDetailsEdit());
  });

  body.querySelector<HTMLButtonElement>("[data-scale-lock]")?.addEventListener("click", () => {
    setSelectionScaleLocked(!selection.scaleLocked);
  });

  body.querySelectorAll<HTMLInputElement>("input[data-pivot]").forEach((input) => {
    input.addEventListener("change", () => commitPivotInput());
  });

  body.querySelectorAll<HTMLButtonElement>("[data-pivot-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.pivotPreset;
      if (preset === "reset" || preset === "center" || preset === "base") {
        applySelectionPivotPreset(preset);
      }
    });
  });

  body.querySelector<HTMLButtonElement>("[data-pivot-drag]")?.addEventListener("click", () => {
    togglePivotEditMode();
  });

  const nameInput = body.querySelector<HTMLInputElement>("[data-detail-name]");
  nameInput?.addEventListener("change", () => {
    renameSceneObject(selection.id, nameInput.value);
  });

  body.querySelectorAll<HTMLButtonElement>("[data-detail-action]").forEach((button) => {
    button.addEventListener("click", () => handleDetailAction(button.dataset.detailAction ?? ""));
  });

  body.querySelectorAll<HTMLInputElement>("[data-detail-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () =>
      handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
    );
  });

  body.querySelector<HTMLSelectElement>("[data-collision-preset]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.target as HTMLSelectElement).value;
      setSelectionCollisionPreset(value ? (value as CollisionPresetId) : undefined);
    },
  );
  bindNavigationInputs();
  bindCollisionOverrideInputs(selection);

  body.querySelector<HTMLSelectElement>("[data-material-slot]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.target as HTMLSelectElement).value;
      setSelectionMaterialSlot(value || undefined);
    },
  );

  body.querySelector<HTMLSelectElement>("[data-animation-clip]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.target as HTMLSelectElement).value;
      setSelectionAnimation(value || undefined);
    },
  );

  bindPhysicsInputs();
  bindComponentsInputs();
  bindActorPatrolRouteInputs();
  bindMetadataInputs();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
