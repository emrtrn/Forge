import type { EditableSelection } from "@editor/core/editableScene";
import type { Selection } from "@editor/core/selection";
import type { GizmoPointerDrag } from "@editor/gizmos/interaction";
import type { GizmoHandle } from "@editor/gizmos/handles";
import type { LayoutLightActor } from "@engine/scene/layout";
import {
  isCameraNavigationKey,
  isEditableTarget,
} from "./keyboard";

type Unbind = () => void;

export interface EditorInputBindings {
  hasSelection(): boolean;
  pickGizmoHandle(clientX: number, clientY: number): GizmoHandle | null;
  startGizmoDrag(handle: GizmoHandle, event: PointerEvent): void;
  beginAltCameraDrag(event: PointerEvent): boolean;
  beginCameraNavigation(event: PointerEvent): void;
  pickSelection(clientX: number, clientY: number): Selection | null;
  toggleSelection(selection: Selection): void;
  select(selection: Selection | null): void;
  beginLandscapeSculpt(event: PointerEvent): boolean;
  updateLandscapeSculpt(event: PointerEvent): boolean;
  endLandscapeSculpt(event: PointerEvent): boolean;
  updateLandscapeBrushHover(clientX: number, clientY: number): void;
  clearLandscapeBrushHover(): void;
  beginMeshPaintStroke(event: PointerEvent): boolean;
  updateMeshPaintStroke(event: PointerEvent): boolean;
  endMeshPaintStroke(event: PointerEvent): boolean;
  updateMeshPaintBrushHover(clientX: number, clientY: number): void;
  clearMeshPaintBrushHover(): void;
  beginFoliageStroke(event: PointerEvent): boolean;
  updateFoliageStroke(event: PointerEvent): boolean;
  endFoliageStroke(event: PointerEvent): boolean;
  updateFoliageBrushHover(clientX: number, clientY: number): void;
  clearFoliageBrushHover(): void;
  /** A handle drawn by an editor overlay (e.g. World Builder's Edit Plan); true when it owns the pointer. */
  beginOverlayHandleDrag(event: PointerEvent): boolean;
  updateOverlayHandleDrag(event: PointerEvent): boolean;
  endOverlayHandleDrag(event: PointerEvent): boolean;

  isCameraNavigationActive(): boolean;
  cameraNavigationPointerId(): number | null;
  updateCameraLook(movementX: number, movementY: number): void;
  endCameraNavigation(event: PointerEvent): void;

  cameraDragPointerId(): number | null;
  updateCameraDrag(event: PointerEvent): void;
  endCameraDrag(event: PointerEvent): void;

  pointerDrag(): GizmoPointerDrag | null;
  clearPointerDrag(): GizmoPointerDrag | null;
  endGizmoDrag(): void;
  selected(): EditableSelection | null;
  updateGizmoHover(clientX: number, clientY: number): void;
  clearGizmoHover(): void;
  updateMoveDrag(event: PointerEvent, selected: EditableSelection): void;
  updateRotateDrag(event: PointerEvent): void;
  updateScaleDrag(event: PointerEvent): void;
  commitPointerDrag(drag: GizmoPointerDrag): void;
  updateGizmo(): void;

  onAssetDragOver(clientX: number, clientY: number): void;
  onAssetDragLeave(): void;
  onAssetDrop(assetId: string, clientX: number, clientY: number): void;
  onActorClassDrop(classRef: string, clientX: number, clientY: number): void;
  onMaterialDrop(materialId: string, clientX: number, clientY: number): void;
  onLightDrop(type: LayoutLightActor["type"], clientX: number, clientY: number): void;
  onSpecialActorDrop(payload: string, clientX: number, clientY: number): void;
  onWheel(event: WheelEvent): void;

  addPressedKey(code: string): void;
  deletePressedKey(code: string): void;
}

export function bindEditorInputEvents(
  canvas: HTMLCanvasElement,
  bindings: EditorInputBindings,
): Unbind {
  const unbinders: Unbind[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    target: HTMLCanvasElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, listener, options);
    unbinders.push(() => target.removeEventListener(type, listener, options));
  };
  const onWindow = <K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
  ): void => {
    window.addEventListener(type, listener);
    unbinders.push(() => window.removeEventListener(type, listener));
  };

  on(canvas, "pointerdown", (event) => {
    if (event.altKey) {
      // On a selected sculptable terrain, Alt+left flattens before camera orbit.
      if (event.button === 0 && bindings.beginLandscapeSculpt(event)) {
        event.preventDefault();
        return;
      }
      const gizmoHandle = bindings.pickGizmoHandle(event.clientX, event.clientY);
      if (event.button === 0 && gizmoHandle && bindings.hasSelection()) {
        bindings.startGizmoDrag(gizmoHandle, event);
        return;
      }
      if (bindings.beginAltCameraDrag(event)) return;
    }

    // Middle mouse button = pan (no Alt required).
    if (event.button === 1) {
      bindings.beginAltCameraDrag(event);
      return;
    }

    if (event.button === 2) {
      bindings.beginCameraNavigation(event);
      return;
    }

    // Overlay handles sit on top of the scene, so they win over the selection's gizmo.
    if (event.button === 0 && bindings.beginOverlayHandleDrag(event)) return;

    const gizmoHandle = bindings.pickGizmoHandle(event.clientX, event.clientY);
    if (gizmoHandle && bindings.hasSelection()) {
      bindings.startGizmoDrag(gizmoHandle, event);
      return;
    }

    if (event.button === 0 && bindings.beginMeshPaintStroke(event)) return;
    if (event.button === 0 && bindings.beginFoliageStroke(event)) return;
    if (event.button === 0 && bindings.beginLandscapeSculpt(event)) return;

    const picked = bindings.pickSelection(event.clientX, event.clientY);
    if (event.ctrlKey || event.shiftKey) {
      if (picked) bindings.toggleSelection(picked);
      return;
    }

    bindings.select(picked);
  });

  on(canvas, "pointermove", (event) => {
    if (
      bindings.isCameraNavigationActive() &&
      bindings.cameraNavigationPointerId() === event.pointerId
    ) {
      bindings.updateCameraLook(event.movementX, event.movementY);
      return;
    }

    if (bindings.cameraDragPointerId() === event.pointerId) {
      bindings.updateCameraDrag(event);
      return;
    }

    if (bindings.updateOverlayHandleDrag(event)) return;
    if (bindings.updateMeshPaintStroke(event)) return;
    if (bindings.updateFoliageStroke(event)) return;
    if (bindings.updateLandscapeSculpt(event)) return;

    const pointerDrag = bindings.pointerDrag();
    if (!pointerDrag) {
      bindings.updateMeshPaintBrushHover(event.clientX, event.clientY);
      bindings.updateFoliageBrushHover(event.clientX, event.clientY);
      bindings.updateLandscapeBrushHover(event.clientX, event.clientY);
      bindings.updateGizmoHover(event.clientX, event.clientY);
      return;
    }
    if (pointerDrag.pointerId !== event.pointerId) return;
    const selected = bindings.selected();
    if (!selected) return;

    if (pointerDrag.mode === "move") {
      bindings.updateMoveDrag(event, selected);
    } else if (pointerDrag.mode === "rotate") {
      bindings.updateRotateDrag(event);
    } else {
      bindings.updateScaleDrag(event);
    }
  });

  const clearDrag = (event: PointerEvent): void => {
    if (bindings.cameraNavigationPointerId() === event.pointerId) {
      bindings.endCameraNavigation(event);
    }
    if (bindings.cameraDragPointerId() === event.pointerId) {
      bindings.endCameraDrag(event);
    }
    if (bindings.pointerDrag()?.pointerId === event.pointerId) {
      const drag = bindings.clearPointerDrag();
      bindings.endGizmoDrag();
      canvas.releasePointerCapture(event.pointerId);
      if (drag) bindings.commitPointerDrag(drag);
      bindings.updateGizmo();
    }
    bindings.endOverlayHandleDrag(event);
    if (bindings.endMeshPaintStroke(event)) {
      bindings.updateGizmo();
    }
    if (bindings.endFoliageStroke(event)) {
      bindings.updateGizmo();
    }
    if (bindings.endLandscapeSculpt(event)) {
      bindings.updateGizmo();
    }
  };
  on(canvas, "pointerup", clearDrag);
  on(canvas, "pointercancel", clearDrag);
  on(canvas, "pointerleave", () => {
    bindings.clearMeshPaintBrushHover();
    bindings.clearFoliageBrushHover();
    bindings.clearLandscapeBrushHover();
    bindings.clearGizmoHover();
  });
  on(canvas, "contextmenu", (event) => event.preventDefault());

  onWindow("keydown", (event) => {
    if (!bindings.isCameraNavigationActive() || isEditableTarget(event.target)) return;
    if (!isCameraNavigationKey(event.code)) return;
    event.preventDefault();
    bindings.addPressedKey(event.code);
  });
  onWindow("keyup", (event) => {
    if (!isCameraNavigationKey(event.code)) return;
    bindings.deletePressedKey(event.code);
  });

  on(canvas, "dragover", (event) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
    // dataTransfer payloads are unreadable during dragover (drag data store is in
    // protected mode), so the ghost is tracked by client coords here and the
    // asset id is resolved by beginAssetDragPreview on dragstart.
    bindings.onAssetDragOver(event.clientX, event.clientY);
  });
  on(canvas, "dragleave", () => {
    bindings.onAssetDragLeave();
  });
  on(canvas, "drop", (event) => {
    event.preventDefault();
    const assetId = event.dataTransfer?.getData("application/x-3dgamedev-asset");
    if (assetId) {
      bindings.onAssetDrop(assetId, event.clientX, event.clientY);
      return;
    }
    const materialId = event.dataTransfer?.getData("application/x-forge-material");
    if (materialId) {
      bindings.onMaterialDrop(materialId, event.clientX, event.clientY);
      return;
    }
    const lightType = event.dataTransfer?.getData("application/x-forge-light-actor");
    if (lightType === "directional" || lightType === "point" || lightType === "spot") {
      bindings.onLightDrop(lightType, event.clientX, event.clientY);
      return;
    }
    const actorClassRef = event.dataTransfer?.getData("application/x-forge-actor-class");
    if (actorClassRef) {
      bindings.onActorClassDrop(actorClassRef, event.clientX, event.clientY);
      return;
    }
    const specialActor = event.dataTransfer?.getData("application/x-forge-special-actor");
    if (specialActor) {
      bindings.onSpecialActorDrop(specialActor, event.clientX, event.clientY);
      return;
    }
    bindings.onAssetDragLeave();
  });
  on(canvas, "wheel", (event) => bindings.onWheel(event), { passive: false });

  return () => {
    for (const unbind of unbinders.splice(0).reverse()) unbind();
  };
}
