import type { EditorCommand, EditorCommandPhase, EditorHistoryState } from "@editor/core/history";
import { EditorCommandStore } from "@editor/core/history";
import { uniqueEditorId } from "@editor/core/ids";
import {
  cloneActorInstance,
  cloneBehavior,
  cloneCharacter,
  cloneLightActor,
  cloneMetadataValue,
  cloneMovingPlatform,
  cloneParticle,
  clonePhysics,
  clonePlacement,
  cloneUngroupedActorInstance,
  cloneUngroupedCharacter,
  cloneUngroupedLightActor,
  cloneUngroupedPlacement,
} from "@editor/core/layoutSnapshots";
import {
  flagCommandLabel,
  type EditorDefaultTrueFlagCommand,
  type EditorFlagCommand,
} from "@editor/core/commandLabels";
import {
  compareActorDeletes,
  compareActorRestores,
  compareCharacterDeletes,
  compareCharacterRestores,
  compareInstanceDeletes,
  compareInstanceRestores,
  compareLightDeletes,
  compareLightRestores,
  cloneSelection,
  parseSelectionId,
  selectionsEqual,
  type ActorSelection,
  type CharacterSelection,
  type InstanceSelection,
  type LightSelection,
  type Selection,
} from "@editor/core/selection";
import { SelectionStore } from "@editor/core/selectionStore";
import { uniqueActorName } from "@engine/scene/lights";
import type {
  LayoutActorInstance,
  LayoutAudio,
  LayoutBehavior,
  LayoutCharacter,
  LayoutInteraction,
  LayoutLightActor,
  LayoutMetadata,
  LayoutMovingPlatform,
  LayoutParticleEmitter,
  LayoutPlacement,
  LayoutPhysics,
  MetadataValue,
  RoomLayout,
} from "@engine/scene/layout";
import { metadataValuesEqual } from "@engine/scene/metadataSchema";
import type {
  CollisionEnabled,
  CollisionObjectChannel,
  CollisionPresetId,
  CollisionResponseMap,
  NavigationRole,
} from "@engine/scene/collision";

type StatusTone = "info" | "success" | "warning" | "error";

const DEFAULT_LINEAR_DAMPING = 0.12;
const DEFAULT_ANGULAR_DAMPING = 0.45;

type MutableHierarchyTransform = {
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  castShadow?: boolean;
  collision?: boolean;
  spatiallyLoaded?: boolean;
  collisionPreset?: CollisionPresetId;
  collisionEnabled?: CollisionEnabled;
  objectType?: CollisionObjectChannel;
  responses?: CollisionResponseMap;
  physicalMaterialId?: string;
  navigationRole?: NavigationRole;
  generateOverlapEvents?: boolean;
  simulationGeneratesHitEvents?: boolean;
  materialSlot?: string;
  simulatePhysics?: boolean;
  physics?: LayoutPhysics;
  metadata?: LayoutMetadata;
  audio?: LayoutAudio;
  behavior?: LayoutBehavior;
  particle?: LayoutParticleEmitter;
  interaction?: LayoutInteraction;
  movingPlatform?: LayoutMovingPlatform;
  /** Play-mode animation clip for a directly-placed skeletal mesh (characters only). */
  animation?: string;
  nodeId?: string;
  parentId?: string;
};

type CollisionOverrideSettings = Pick<
  LayoutPlacement,
  | "collisionEnabled"
  | "objectType"
  | "responses"
  | "physicalMaterialId"
  | "generateOverlapEvents"
  | "simulationGeneratesHitEvents"
>;

type CollisionOverridePatch = {
  [Key in keyof CollisionOverrideSettings]?: CollisionOverrideSettings[Key] | undefined;
};

function isPlacementCollisionSelection(selection: Selection): boolean {
  return selection.kind === "instance" || selection.kind === "character";
}

function cloneCollisionOverrides(
  source: LayoutPlacement | LayoutCharacter,
): CollisionOverrideSettings | undefined {
  const draft: CollisionOverridePatch = {};
  if (source.collisionEnabled !== undefined) draft.collisionEnabled = source.collisionEnabled;
  if (source.objectType !== undefined) draft.objectType = source.objectType;
  if (source.responses !== undefined) draft.responses = { ...source.responses };
  if (source.physicalMaterialId !== undefined) draft.physicalMaterialId = source.physicalMaterialId;
  if (source.generateOverlapEvents !== undefined) {
    draft.generateOverlapEvents = source.generateOverlapEvents;
  }
  if (source.simulationGeneratesHitEvents !== undefined) {
    draft.simulationGeneratesHitEvents = source.simulationGeneratesHitEvents;
  }
  return normalizeCollisionOverrides(draft);
}

function normalizeCollisionOverrides(
  value: CollisionOverridePatch | CollisionOverrideSettings | undefined,
): CollisionOverrideSettings | undefined {
  if (!value) return undefined;
  const next: CollisionOverrideSettings = {};
  if (value.collisionEnabled !== undefined) next.collisionEnabled = value.collisionEnabled;
  if (value.objectType !== undefined) next.objectType = value.objectType;
  if (value.responses && Object.keys(value.responses).length > 0) {
    next.responses = { ...value.responses };
  }
  if (value.physicalMaterialId !== undefined && value.physicalMaterialId.length > 0) {
    next.physicalMaterialId = value.physicalMaterialId;
  }
  if (value.generateOverlapEvents !== undefined) {
    next.generateOverlapEvents = value.generateOverlapEvents;
  }
  if (value.simulationGeneratesHitEvents !== undefined) {
    next.simulationGeneratesHitEvents = value.simulationGeneratesHitEvents;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function collisionOverridesEqual(
  a: CollisionOverrideSettings | undefined,
  b: CollisionOverrideSettings | undefined,
): boolean {
  const left = normalizeCollisionOverrides(a);
  const right = normalizeCollisionOverrides(b);
  return (
    left?.collisionEnabled === right?.collisionEnabled &&
    left?.objectType === right?.objectType &&
    left?.physicalMaterialId === right?.physicalMaterialId &&
    left?.generateOverlapEvents === right?.generateOverlapEvents &&
    left?.simulationGeneratesHitEvents === right?.simulationGeneratesHitEvents &&
    collisionResponseMapsEqual(left?.responses, right?.responses)
  );
}

function collisionResponseMapsEqual(
  a: CollisionResponseMap | undefined,
  b: CollisionResponseMap | undefined,
): boolean {
  const aEntries = Object.entries(a ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const bEntries = Object.entries(b ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([channel, response], index) => {
    const other = bEntries[index];
    return other?.[0] === channel && other[1] === response;
  });
}

function writeCollisionOverrides(
  target: LayoutPlacement | LayoutCharacter,
  value: CollisionOverrideSettings | undefined,
): void {
  delete target.collisionEnabled;
  delete target.objectType;
  delete target.responses;
  delete target.physicalMaterialId;
  delete target.generateOverlapEvents;
  delete target.simulationGeneratesHitEvents;
  if (!value) return;
  if (value.collisionEnabled !== undefined) target.collisionEnabled = value.collisionEnabled;
  if (value.objectType !== undefined) target.objectType = value.objectType;
  if (value.responses && Object.keys(value.responses).length > 0) {
    target.responses = { ...value.responses };
  }
  if (value.physicalMaterialId !== undefined) target.physicalMaterialId = value.physicalMaterialId;
  if (value.generateOverlapEvents !== undefined) {
    target.generateOverlapEvents = value.generateOverlapEvents;
  }
  if (value.simulationGeneratesHitEvents !== undefined) {
    target.simulationGeneratesHitEvents = value.simulationGeneratesHitEvents;
  }
}

export interface EditorSceneControllerHost {
  applyCastShadow: (selection: Selection) => void;
  applyGroupId: (
    selection: Selection,
    groupId: string | undefined,
    options?: { notify?: boolean },
  ) => void;
  applyMaterialSlot: (selection: Selection) => void;
  applyVisibility: (selection: Selection) => void;
  descendantsOf: (selection: Selection) => Selection[];
  emitHistoryChanged: () => void;
  emitSelectionChanged: () => void;
  getAllSelections: (options: { includeHidden: boolean }) => Selection[];
  getGroupedSelections: (selection: Selection) => Selection[];
  getMutableLayout: () => RoomLayout | null;
  getMutableTransform: (selection: Selection) => MutableHierarchyTransform | null;
  getSelectionLabel: (selection: Selection) => string;
  hasSelection: (selection: Selection) => boolean;
  createLightId: (type: LayoutLightActor["type"]) => string;
  insertActorPlacement: (index: number, actor: LayoutActorInstance) => void;
  insertCharacterPlacement: (index: number, placement: LayoutCharacter) => void;
  insertInstancePlacement: (assetId: string, placementIndex: number, placement: LayoutPlacement) => void;
  insertLightActor: (index: number, actor: LayoutLightActor) => void;
  onStatus: (message: string, tone?: StatusTone) => void;
  removeActorPlacement: (index: number) => LayoutActorInstance | null;
  removeCharacterPlacement: (index: number) => LayoutCharacter | null;
  removeInstancePlacement: (assetId: string, placementIndex: number) => LayoutPlacement | null;
  removeLightActor: (index: number) => LayoutLightActor | null;
  updateGizmo: () => void;
  updateSelectionBox: () => void;
}

function normalizePhysicsSettings(physics: LayoutPhysics | undefined): LayoutPhysics | undefined {
  if (!physics) return undefined;
  const normalized: LayoutPhysics = {};
  const massKg = normalizeNumber(physics.massKg, 0.001, 1_000_000);
  if (massKg !== undefined) normalized.massKg = massKg;
  const linearDamping = normalizeNumber(physics.linearDamping, 0, 100);
  if (linearDamping !== undefined && linearDamping !== DEFAULT_LINEAR_DAMPING) {
    normalized.linearDamping = linearDamping;
  }
  const angularDamping = normalizeNumber(physics.angularDamping, 0, 100);
  if (angularDamping !== undefined && angularDamping !== DEFAULT_ANGULAR_DAMPING) {
    normalized.angularDamping = angularDamping;
  }
  if (physics.enableGravity === false) normalized.enableGravity = false;
  if (physics.lockPosition?.some(Boolean)) normalized.lockPosition = [...physics.lockPosition];
  if (physics.lockRotation?.some(Boolean)) normalized.lockRotation = [...physics.lockRotation];
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeNumber(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Number(Math.min(Math.max(value, min), max).toFixed(3));
}

function physicsSettingsEqual(
  left: LayoutPhysics | undefined,
  right: LayoutPhysics | undefined,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function interactionsEqual(
  left: LayoutInteraction | undefined,
  right: LayoutInteraction | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.action === right.action &&
    left.prompt === right.prompt &&
    left.enabled === right.enabled &&
    left.requires === right.requires &&
    left.cooldown === right.cooldown
  );
}

function audiosEqual(
  left: LayoutAudio | undefined,
  right: LayoutAudio | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.clipId === right.clipId &&
    left.volume === right.volume &&
    left.loop === right.loop &&
    left.spatial === right.spatial
  );
}

function behaviorsEqual(
  left: LayoutBehavior | undefined,
  right: LayoutBehavior | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.script === right.script &&
    JSON.stringify(left.params ?? {}) === JSON.stringify(right.params ?? {})
  );
}

function movingPlatformsEqual(
  left: LayoutMovingPlatform | undefined,
  right: LayoutMovingPlatform | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.offset[0] === right.offset[0] &&
    left.offset[1] === right.offset[1] &&
    left.offset[2] === right.offset[2] &&
    left.speed === right.speed &&
    (left.startPhase ?? 0) === (right.startPhase ?? 0)
  );
}

function particlesEqual(
  left: LayoutParticleEmitter | undefined,
  right: LayoutParticleEmitter | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Editor-only scene command controller. This starts as the history/command
 * owner; tightly coupled command orchestration moves here in later slices.
 */
export class EditorSceneController {
  private readonly host: EditorSceneControllerHost;
  private readonly commandStore = new EditorCommandStore();
  private readonly selectionStore = new SelectionStore();

  constructor(host: EditorSceneControllerHost) {
    this.host = host;
  }

  getHistoryState(): EditorHistoryState {
    return this.commandStore.state();
  }

  get selection(): Selection | null {
    return this.selectionStore.activeSelection;
  }

  set selection(value: Selection | null) {
    this.selectionStore.activeSelection = value;
  }

  get selectedCount(): number {
    return this.selectionStore.selectedCount;
  }

  undo(): void {
    const result = this.commandStore.undo();
    if (!result) return;
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  redo(): void {
    const result = this.commandStore.redo();
    if (!result) return;
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  executeCommand(command: EditorCommand): void {
    const result = this.commandStore.execute(command);
    this.host.emitHistoryChanged();
    this.host.onStatus(result.statusMessage, result.statusTone);
  }

  select(selection: Selection | null): void {
    this.selection = this.selectionStore.selectGroup(
      selection,
      selection ? this.host.getGroupedSelections(selection) : [],
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  selectMany(selections: Selection[], active: Selection | null): void {
    this.selection = this.selectionStore.selectMany(
      selections.filter((selection) => this.host.hasSelection(selection)),
      active,
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  toggleSelection(selection: Selection): void {
    this.selection = this.selectionStore.toggleGroup(
      selection,
      this.host.getGroupedSelections(selection),
    );
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    this.host.emitSelectionChanged();
  }

  isSelectionSelected(selection: Selection): boolean {
    return this.selectionStore.has(selection);
  }

  getSelectedSelections(): Selection[] {
    return this.selectionStore.list((selection) => this.host.hasSelection(selection));
  }

  groupSelected(): void {
    const selections = this.getSelectedSelections();
    if (selections.length < 2) {
      this.host.onStatus("Select at least two objects to group.", "warning");
      return;
    }

    const groupId = this.createGroupId();
    const entries = selections.flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target
        ? [
            {
              selection: cloneSelection(selection),
              previousGroupId: target.groupId,
            },
          ]
        : [];
    });
    if (entries.length < 2) {
      this.host.onStatus("Select at least two objects to group.", "warning");
      return;
    }

    const active = this.selection
      ? cloneSelection(this.selection)
      : cloneSelection(entries[0]!.selection);
    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.host.applyGroupId(
          entry.selection,
          mode === "redo" ? groupId : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(
        entries.map((entry) => cloneSelection(entry.selection)),
        active,
      );
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Group ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Clears the group id from every member of any group in the current selection. */
  ungroupSelected(): void {
    const groupIds = new Set<string>();
    for (const selection of this.getSelectedSelections()) {
      const groupId = this.host.getMutableTransform(selection)?.groupId;
      if (groupId) groupIds.add(groupId);
    }
    if (groupIds.size === 0) {
      this.host.onStatus("Selection is not grouped.", "warning");
      return;
    }

    const entries = this.host.getAllSelections({ includeHidden: true }).flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target?.groupId && groupIds.has(target.groupId)
        ? [{ selection: cloneSelection(selection), previousGroupId: target.groupId }]
        : [];
    });
    if (entries.length === 0) return;
    const active = this.selection ? cloneSelection(this.selection) : null;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.host.applyGroupId(
          entry.selection,
          mode === "redo" ? undefined : entry.previousGroupId,
          { notify: false },
        );
      }
      this.selectMany(entries.map((entry) => cloneSelection(entry.selection)), active);
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Ungroup ${entries.length} objects`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Parents the other selected objects to the active selection (the parent). */
  parentSelectionToActive(): void {
    if (!this.selection) return;
    const parent = cloneSelection(this.selection);
    const parentTarget = this.host.getMutableTransform(parent);
    if (!parentTarget) return;

    // Cycle guard: an ancestor of the parent cannot become its child.
    const parentDescendantIds = new Set(
      this.host
        .descendantsOf(parent)
        .map((entry) => this.host.getMutableTransform(entry)?.nodeId)
        .filter((id): id is string => Boolean(id)),
    );

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = this.getSelectedSelections().flatMap((selection) => {
      if (selectionsEqual(selection, parent)) return [];
      const target = this.host.getMutableTransform(selection);
      if (!target) return [];
      // Skip if this object is the parent's ancestor (would form a cycle).
      if (target.nodeId && parentDescendantIds.has(target.nodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) {
      this.host.onStatus("Select children plus a parent (active) to parent.", "warning");
      return;
    }

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.host.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.host.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.host.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /**
   * Parents one or more objects (by scene-object id) to a target object.
   * Used by outliner drag-and-drop: drag child rows onto a parent row.
   * Cycle-safe (a target that is a descendant of a dragged object is skipped).
   */
  parentObjectsTo(childIds: string[], parentId: string): void {
    const parent = parseSelectionId(parentId);
    if (!parent || !this.host.hasSelection(parent)) return;
    const parentTarget = this.host.getMutableTransform(parent);
    if (!parentTarget) return;

    const parentNodeId = parentTarget.nodeId ?? this.createNodeId();
    const children = childIds.flatMap((childId) => {
      const selection = parseSelectionId(childId);
      if (!selection || !this.host.hasSelection(selection)) return [];
      if (selectionsEqual(selection, parent)) return [];
      const target = this.host.getMutableTransform(selection);
      if (!target) return [];
      // Cycle guard: the target cannot be a descendant of this child.
      const descendantIds = new Set(
        this.host
          .descendantsOf(selection)
          .map((entry) => this.host.getMutableTransform(entry)?.nodeId)
          .filter((id): id is string => Boolean(id)),
      );
      if (target.nodeId && descendantIds.has(parentNodeId)) return [];
      if (target.parentId === parentNodeId) return [];
      return [{ selection: cloneSelection(selection), previousParentId: target.parentId }];
    });
    if (children.length === 0) return;

    const hadParentNodeId = parentTarget.nodeId !== undefined;
    const apply = (mode: EditorCommandPhase): void => {
      const parentMut = this.host.getMutableTransform(parent);
      if (parentMut) {
        if (mode === "redo") parentMut.nodeId = parentNodeId;
        else if (!hadParentNodeId) delete parentMut.nodeId;
      }
      for (const child of children) {
        const target = this.host.getMutableTransform(child.selection);
        if (!target) continue;
        if (mode === "redo") target.parentId = parentNodeId;
        else if (child.previousParentId === undefined) delete target.parentId;
        else target.parentId = child.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Parent ${children.length} to ${this.host.getSelectionLabel(parent)}`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  /** Clears the parent of every selected object. */
  unparentSelected(): void {
    const entries = this.getSelectedSelections().flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target?.parentId !== undefined
        ? [{ selection: cloneSelection(selection), previousParentId: target.parentId }]
        : [];
    });
    if (entries.length === 0) {
      this.host.onStatus("Selection has no parent.", "warning");
      return;
    }

    const apply = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        const target = this.host.getMutableTransform(entry.selection);
        if (!target) continue;
        if (mode === "redo") delete target.parentId;
        else target.parentId = entry.previousParentId;
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: `Unparent ${entries.length} objects`,
      redo: () => apply("redo"),
      undo: () => apply("undo"),
    });
  }

  deleteSelected(): void {
    const layout = this.host.getMutableLayout();
    if (!layout) return;
    const selections = this.getSelectedSelections();
    if (selections.length === 0) return;

    const instanceDeletes: Array<{ selection: InstanceSelection; snapshot: LayoutPlacement }> = [];
    const characterDeletes: Array<{ selection: CharacterSelection; snapshot: LayoutCharacter }> = [];
    const lightDeletes: Array<{ selection: LightSelection; snapshot: LayoutLightActor }> = [];
    const actorDeletes: Array<{ selection: ActorSelection; snapshot: LayoutActorInstance }> = [];
    for (const selection of selections) {
      if (selection.kind === "instance") {
        const instance = layout.instances.find((entry) => entry.assetId === selection.assetId);
        const placement = instance?.placements[selection.placementIndex];
        if (placement) {
          instanceDeletes.push({
            selection: cloneSelection(selection) as InstanceSelection,
            snapshot: clonePlacement(placement),
          });
        }
        continue;
      }

      if (selection.kind === "character") {
        const character = layout.characters[selection.index];
        if (!character) continue;
        characterDeletes.push({
          selection: cloneSelection(selection) as CharacterSelection,
          snapshot: cloneCharacter(character),
        });
        continue;
      }

      if (selection.kind === "actor") {
        const actor = layout.actors?.[selection.index];
        if (!actor) continue;
        actorDeletes.push({
          selection: cloneSelection(selection) as ActorSelection,
          snapshot: cloneActorInstance(actor),
        });
        continue;
      }

      // Environment singletons + reflection planes + world widgets are deleted via
      // their own dedicated (SceneApp) commands, not the multi-select snapshot stack.
      if (
        selection.kind === "sky" ||
        selection.kind === "fog" ||
        selection.kind === "cloud" ||
        selection.kind === "reflectionPlane" ||
        selection.kind === "reflectiveSurface" ||
        selection.kind === "reflectionCapture" ||
        selection.kind === "worldWidget" ||
        selection.kind === "landscape" ||
        selection.kind === "post"
      ) {
        continue;
      }

      const light = layout.lights?.[selection.index];
      if (light) {
        lightDeletes.push({
          selection: cloneSelection(selection) as LightSelection,
          snapshot: cloneLightActor(light),
        });
      }
    }
    if (
      instanceDeletes.length +
        characterDeletes.length +
        lightDeletes.length +
        actorDeletes.length ===
      0
    ) {
      return;
    }

    const previousSelections = selections.map(cloneSelection);
    const previousActive = this.selection ? cloneSelection(this.selection) : null;
    this.executeCommand({
      label:
        selections.length === 1
          ? `Delete ${this.host.getSelectionLabel(selections[0]!)}`
          : `Delete ${selections.length} objects`,
      redo: () => {
        for (const entry of [...instanceDeletes].sort(compareInstanceDeletes)) {
          this.host.removeInstancePlacement(entry.selection.assetId, entry.selection.placementIndex);
        }
        for (const entry of [...characterDeletes].sort(compareCharacterDeletes)) {
          this.host.removeCharacterPlacement(entry.selection.index);
        }
        for (const entry of [...lightDeletes].sort(compareLightDeletes)) {
          this.host.removeLightActor(entry.selection.index);
        }
        for (const entry of [...actorDeletes].sort(compareActorDeletes)) {
          this.host.removeActorPlacement(entry.selection.index);
        }
        this.select(null);
      },
      undo: () => {
        for (const entry of [...instanceDeletes].sort(compareInstanceRestores)) {
          this.host.insertInstancePlacement(
            entry.selection.assetId,
            entry.selection.placementIndex,
            entry.snapshot,
          );
        }
        for (const entry of [...characterDeletes].sort(compareCharacterRestores)) {
          this.host.insertCharacterPlacement(entry.selection.index, entry.snapshot);
        }
        for (const entry of [...lightDeletes].sort(compareLightRestores)) {
          this.host.insertLightActor(entry.selection.index, entry.snapshot);
        }
        for (const entry of [...actorDeletes].sort(compareActorRestores)) {
          this.host.insertActorPlacement(entry.selection.index, entry.snapshot);
        }
        this.selectMany(previousSelections, previousActive);
      },
    });
  }

  duplicateSelected(): void {
    const selections = this.getSelectedSelections();
    if (selections.length === 0) {
      this.host.onStatus("No selected object to duplicate.", "warning");
      return;
    }
    if (selections.length === 1) {
      this.duplicateSelection(selections[0]!);
      return;
    }

    this.duplicateSelections(selections);
  }

  duplicateSelectionForDrag(selection: Selection): Selection | null {
    const selections = this.getSelectedSelections();
    if (selections.length > 1 && selections.some((entry) => selectionsEqual(entry, selection))) {
      return this.duplicateSelections(selections);
    }
    return this.duplicateSelection(selection);
  }

  hideSelected(): void {
    this.setSelectedHidden(true);
  }

  setSelectedHidden(hidden: boolean): void {
    this.setSelectionsFlag(
      this.getSelectedSelections(),
      "hidden",
      hidden,
      hidden ? "Hide selected" : "Show selected",
    );
  }

  setSelectedLocked(locked: boolean): void {
    this.setSelectionsFlag(
      this.getSelectedSelections(),
      "locked",
      locked,
      locked ? "Lock selected" : "Unlock selected",
    );
  }

  showHiddenObjects(): void {
    const hiddenSelections = this.host
      .getAllSelections({ includeHidden: true })
      .filter((selection) => this.host.getMutableTransform(selection)?.hidden);
    this.setSelectionsFlag(hiddenSelections, "hidden", false, "Show hidden objects");
  }

  setSelectionFlag(selection: Selection, flag: EditorFlagCommand, value: boolean): void {
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    const previous = Boolean(target[flag]);
    if (previous === value) return;

    const label = flagCommandLabel(flag, value);

    this.executeCommand({
      label,
      redo: () => this.applyFlag(selection, flag, value),
      undo: () => this.applyFlag(selection, flag, previous),
    });
  }

  setSelectionScaleLocked(value: boolean): void {
    this.setSelectionsFlag(
      this.getSelectedSelectionsWithTargets(),
      "scaleLocked",
      value,
      value ? "Lock selected scale ratios" : "Unlock selected scale ratios",
    );
  }

  setSelectionCastShadow(value: boolean): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind !== "character") {
      this.host.onStatus("Cast Shadow is controlled centrally for static objects.", "info");
      return;
    }
    this.setSelectionsDefaultTrueFlag(
      this.getSelectedSelectionsWithTargets((selection) => selection.kind === "character"),
      "castShadow",
      value,
      value ? "Enable selected cast shadow" : "Disable selected cast shadow",
    );
  }

  setSelectionCollision(value: boolean): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    this.setSelectionsDefaultTrueFlag(
      this.getSelectedSelectionsWithTargets((selection) => selection.kind !== "light"),
      "collision",
      value,
      value ? "Enable selected collision" : "Disable selected collision",
    );
  }

  setSelectionSpatiallyLoaded(value: boolean): void {
    const layout = this.host.getMutableLayout();
    if (!layout?.worldSettings?.partition?.enabled) return;
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    const supportsSpatiallyLoaded = (selection: Selection): boolean => {
      if (selection.kind === "light") {
        const light = layout.lights?.[selection.index];
        return !!light && light.type !== "directional";
      }
      return selection.kind === "instance" || selection.kind === "actor"
        || selection.kind === "character" || selection.kind === "reflectionCapture"
        || selection.kind === "blockingVolume" || selection.kind === "targetPoint";
    };
    if (!supportsSpatiallyLoaded(this.selection)) return;
    this.setSelectionsDefaultTrueFlag(
      this.getSelectedSelectionsWithTargets(supportsSpatiallyLoaded),
      "spatiallyLoaded",
      value,
      value ? "Enable selected spatial loading" : "Disable selected spatial loading",
    );
  }

  setSelectionSimulatePhysics(value: boolean): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    this.setSelectionsFlag(
      this.getSelectedSelectionsWithTargets((selection) => selection.kind !== "light"),
      "simulatePhysics",
      value,
      value ? "Enable selected simulate physics" : "Disable selected simulate physics",
    );
  }

  /** Sets (or clears, when `undefined`) the per-placement collision preset override. */
  setSelectionCollisionPreset(value: CollisionPresetId | undefined): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (!isPlacementCollisionSelection(this.selection)) return;
    const entries = this.getSelectedSelectionsWithTargets(isPlacementCollisionSelection)
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection);
        if (!target || target.collisionPreset === value) return [];
        return [{ selection: cloneSelection(selection), previous: target.collisionPreset }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyCollisionPreset(
          entry.selection,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: entries.length === 1 ? "Set collision preset" : "Set selected collision presets",
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyCollisionPreset(
    selection: Selection,
    value: CollisionPresetId | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (!isPlacementCollisionSelection(selection)) return;
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    if (value === undefined) delete target.collisionPreset;
    else target.collisionPreset = value;
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  /** Sets (or clears) the per-placement AI navigation role override for static mesh instances. */
  setSelectionNavigationRole(value: NavigationRole | undefined): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind !== "instance") {
      this.host.onStatus("Navigation role overrides are available for static mesh instances.", "info");
      return;
    }
    const entries = this.getSelectedSelectionsWithTargets((selection) => selection.kind === "instance")
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection);
        if (!target || target.navigationRole === value) return [];
        return [{ selection: cloneSelection(selection), previous: target.navigationRole }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyNavigationRole(
          entry.selection,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: entries.length === 1 ? "Set navigation role" : "Set selected navigation roles",
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyNavigationRole(
    selection: Selection,
    value: NavigationRole | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (selection.kind !== "instance") return;
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    if (value === undefined) delete target.navigationRole;
    else target.navigationRole = value;
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  /** Sets or clears per-placement collision profile/material/event overrides. */
  setSelectionCollisionOverrides(patch: CollisionOverridePatch): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (!isPlacementCollisionSelection(this.selection)) return;
    const entries = this.getSelectedSelectionsWithTargets(isPlacementCollisionSelection)
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection) as
          | LayoutPlacement
          | LayoutCharacter
          | null;
        if (!target) return [];
        const previous = cloneCollisionOverrides(target);
        const next = normalizeCollisionOverrides({ ...previous, ...patch });
        if (collisionOverridesEqual(previous, next)) return [];
        return [{ selection: cloneSelection(selection), previous, next }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyCollisionOverrides(
          entry.selection,
          mode === "redo" ? entry.next : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: entries.length === 1 ? "Set collision overrides" : "Set selected collision overrides",
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyCollisionOverrides(
    selection: Selection,
    value: CollisionOverrideSettings | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (!isPlacementCollisionSelection(selection)) return;
    const target = this.host.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    writeCollisionOverrides(target, value);
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  /** Sets or clears the first material slot for selected static mesh placements. */
  setSelectionMaterialSlot(value: string | undefined): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind !== "instance") {
      this.host.onStatus("Material slots are available for static mesh instances.", "info");
      return;
    }
    const entries = this.getSelectedSelectionsWithTargets((selection) => selection.kind === "instance")
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection);
        if (!target || target.materialSlot === value) return [];
        return [{ selection: cloneSelection(selection), previous: target.materialSlot }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyMaterialSlot(
          entry.selection,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: entries.length === 1 ? "Set material slot" : "Set selected material slots",
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyMaterialSlot(
    selection: Selection,
    value: string | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (selection.kind !== "instance") return;
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    if (value === undefined) delete target.materialSlot;
    else target.materialSlot = value;
    this.host.applyMaterialSlot(selection);
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  setSelectionPhysics(patch: Partial<LayoutPhysics>): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    const entries = this.getSelectedSelectionsWithTargets((selection) => selection.kind !== "light")
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection) as
          | LayoutPlacement
          | LayoutCharacter
          | null;
        if (!target) return [];
        const previous = normalizePhysicsSettings(target.physics);
        const next = normalizePhysicsSettings({ ...(previous ?? {}), ...patch });
        if (physicsSettingsEqual(previous, next)) return [];
        return [{ selection: cloneSelection(selection), previous, next }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyPhysicsSettings(
          entry.selection,
          mode === "redo" ? entry.next : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: entries.length === 1 ? "Set physics" : "Set selected physics",
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  setSelectionMetadata(key: string, value: MetadataValue | undefined, label?: string): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    const entries = this.getSelectedSelectionsWithTargets((selection) => selection.kind !== "light")
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection) as
          | LayoutPlacement
          | LayoutCharacter
          | null;
        if (!target) return [];
        const previous = cloneMetadataValue(target.metadata?.[key]);
        if (metadataValuesEqual(previous, value)) return [];
        return [{ selection: cloneSelection(selection), previous }];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyMetadataValue(
          entry.selection,
          key,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: label ?? `Set ${key}`,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  /** Sets (or clears, when `undefined`) the per-object Interaction component. */
  setSelectionInteraction(value: LayoutInteraction | undefined): void {
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.interaction,
        write: (target, next) => {
          if (next === undefined) delete target.interaction;
          else target.interaction = next;
        },
        clone: (component) => ({ ...component }),
        equals: interactionsEqual,
        label: value ? "Set interaction" : "Remove interaction",
      },
      value,
    );
  }

  /** Sets (or clears, when `undefined`) the per-object Audio component. */
  setSelectionAudio(value: LayoutAudio | undefined): void {
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.audio,
        write: (target, next) => {
          if (next === undefined) delete target.audio;
          else target.audio = next;
        },
        clone: (component) => ({ ...component }),
        equals: audiosEqual,
        label: value ? "Set audio" : "Remove audio",
      },
      value,
    );
  }

  /** Sets (or clears, when `undefined`) the per-object Behavior component. */
  setSelectionBehavior(value: LayoutBehavior | undefined): void {
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.behavior,
        write: (target, next) => {
          if (next === undefined) delete target.behavior;
          else target.behavior = next;
        },
        clone: cloneBehavior,
        equals: behaviorsEqual,
        label: value ? "Set behavior" : "Remove behavior",
      },
      value,
    );
  }

  /**
   * Sets (or clears, when `undefined`) the Play-mode animation clip for a
   * directly-placed skeletal mesh (character selection). Undoable; edit-mode is
   * static so this is data-only until Play.
   */
  setSelectionAnimation(value: string | undefined): void {
    if (this.selection && this.selection.kind !== "character") return;
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.animation,
        write: (target, next) => {
          if (next === undefined || next.length === 0) delete target.animation;
          else target.animation = next;
        },
        clone: (component) => component,
        equals: (a, b) => (a ?? "") === (b ?? ""),
        label: value ? "Set animation" : "Clear animation",
      },
      value,
    );
  }

  /** Sets (or clears, when `undefined`) the per-object Moving Platform component. */
  setSelectionMovingPlatform(value: LayoutMovingPlatform | undefined): void {
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.movingPlatform,
        write: (target, next) => {
          if (next === undefined) delete target.movingPlatform;
          else target.movingPlatform = next;
        },
        clone: cloneMovingPlatform,
        equals: movingPlatformsEqual,
        label: value ? "Set moving platform" : "Remove moving platform",
      },
      value,
    );
  }

  /** Sets (or clears, when `undefined`) the per-object Particle Emitter component. */
  setSelectionParticle(value: LayoutParticleEmitter | undefined): void {
    this.setSelectionOptionalComponent(
      {
        read: (target) => target.particle,
        write: (target, next) => {
          if (next === undefined) delete target.particle;
          else target.particle = next;
        },
        clone: cloneParticle,
        equals: particlesEqual,
        label: value ? "Set particle" : "Remove particle",
      },
      value,
    );
  }

  /**
   * Generic set/clear of an optional component field on the selected objects, as
   * one undo/redo command. `read`/`write` isolate the typed field; `clone`
   * snapshots it (for undo + to avoid shared references across multi-select);
   * `equals` skips no-op edits. Mirrors the per-field commands above.
   */
  private setSelectionOptionalComponent<T>(
    config: {
      read: (target: MutableHierarchyTransform) => T | undefined;
      write: (target: MutableHierarchyTransform, next: T | undefined) => void;
      clone: (component: T) => T;
      equals: (a: T | undefined, b: T | undefined) => boolean;
      label: string;
    },
    value: T | undefined,
  ): void {
    if (!this.selection || !this.host.hasSelection(this.selection)) return;
    if (this.selection.kind === "light") return;
    const entries = this.getSelectedSelectionsWithTargets((selection) => selection.kind !== "light")
      .flatMap((selection) => {
        const target = this.host.getMutableTransform(selection);
        if (!target || config.equals(config.read(target), value)) return [];
        const previous = config.read(target);
        return [
          {
            selection: cloneSelection(selection),
            previous: previous === undefined ? undefined : config.clone(previous),
          },
        ];
      });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        const target = this.host.getMutableTransform(entry.selection);
        if (!target) continue;
        const next = mode === "redo" ? value : entry.previous;
        config.write(target, next === undefined ? undefined : config.clone(next));
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label: config.label,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private duplicateSelection(selection: Selection): Selection | null {
    const layout = this.host.getMutableLayout();
    if (!layout) return null;
    // The Sky Atmosphere + Height Fog + Cloud Layer are singletons, and
    // reflection planes/captures aren't duplicable in v1: never duplicated.
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "reflectionPlane" ||
      selection.kind === "reflectiveSurface" ||
      selection.kind === "reflectionCapture" ||
      selection.kind === "worldWidget" ||
      selection.kind === "landscape"
    ) {
      return null;
    }
    if (selection.kind === "instance") {
      const instance = layout.instances.find((entry) => entry.assetId === selection.assetId);
      const transform = instance?.placements[selection.placementIndex];
      if (!transform) return null;
      const snapshot = clonePlacement(transform);
      delete snapshot.groupId;
      delete snapshot.nodeId;
      const duplicateIndex = selection.placementIndex + 1;
      const duplicateSelection: Selection = {
        kind: "instance",
        assetId: selection.assetId,
        placementIndex: duplicateIndex,
      };
      this.executeCommand({
        label: `Duplicate ${selection.assetId}`,
        redo: () => {
          this.host.insertInstancePlacement(selection.assetId, duplicateIndex, snapshot);
          this.select(duplicateSelection);
        },
        undo: () => {
          this.host.removeInstancePlacement(selection.assetId, duplicateIndex);
          this.select(selection);
        },
      });
      return duplicateSelection;
    }

    if (selection.kind === "light") {
      const light = layout.lights?.[selection.index];
      if (!light) return null;
      const snapshot = cloneLightActor(light);
      snapshot.id = this.host.createLightId(light.type);
      snapshot.name = uniqueActorName(light.name ?? light.id, layout.lights ?? []);
      delete snapshot.groupId;
      delete snapshot.nodeId;
      const duplicateIndex = selection.index + 1;
      const duplicateSelection: Selection = { kind: "light", index: duplicateIndex };
      this.executeCommand({
        label: `Duplicate ${light.name ?? light.id}`,
        redo: () => {
          this.host.insertLightActor(duplicateIndex, snapshot);
          this.select(duplicateSelection);
        },
        undo: () => {
          this.host.removeLightActor(duplicateIndex);
          this.select(selection);
        },
      });
      return duplicateSelection;
    }

    if (selection.kind === "actor") {
      const actor = layout.actors?.[selection.index];
      if (!actor) return null;
      const snapshot = cloneActorInstance(actor);
      delete snapshot.groupId;
      delete snapshot.nodeId;
      const duplicateIndex = selection.index + 1;
      const duplicateSelection: Selection = { kind: "actor", index: duplicateIndex };
      this.executeCommand({
        label: `Duplicate ${actor.name ?? actor.classRef}`,
        redo: () => {
          this.host.insertActorPlacement(duplicateIndex, snapshot);
          this.select(duplicateSelection);
        },
        undo: () => {
          this.host.removeActorPlacement(duplicateIndex);
          this.select(selection);
        },
      });
      return duplicateSelection;
    }

    if (selection.kind === "post") {
      return null;
    }

    const character = layout.characters[selection.index];
    if (!character) return null;
    const snapshot = cloneCharacter(character);
    delete snapshot.groupId;
    delete snapshot.nodeId;
    const duplicateIndex = selection.index + 1;
    const duplicateSelection: Selection = { kind: "character", index: duplicateIndex };
    this.executeCommand({
      label: `Duplicate ${character.name ?? character.assetId}`,
      redo: () => {
        this.host.insertCharacterPlacement(duplicateIndex, snapshot);
        this.select(duplicateSelection);
      },
      undo: () => {
        this.host.removeCharacterPlacement(duplicateIndex);
        this.select(selection);
      },
    });
    return duplicateSelection;
  }

  private duplicateSelections(selections: Selection[]): Selection | null {
    const layout = this.host.getMutableLayout();
    if (!layout) return null;

    const previousSelections = selections.map(cloneSelection);
    const previousActive = this.selection ? cloneSelection(this.selection) : null;
    const inserts: Array<{
      source: Selection;
      selection: Selection;
      snapshot: LayoutPlacement | LayoutCharacter | LayoutLightActor | LayoutActorInstance;
    }> = [];

    const instancesByAsset = new Map<string, Selection[]>();
    for (const selection of selections) {
      if (selection.kind !== "instance") continue;
      const entries = instancesByAsset.get(selection.assetId) ?? [];
      entries.push(cloneSelection(selection));
      instancesByAsset.set(selection.assetId, entries);
    }

    for (const [assetId, entries] of instancesByAsset) {
      entries.sort((left, right) => {
        if (left.kind !== "instance" || right.kind !== "instance") return 0;
        return left.placementIndex - right.placementIndex;
      });
      entries.forEach((selection, offset) => {
        if (selection.kind !== "instance") return;
        const instance = layout.instances.find((entry) => entry.assetId === selection.assetId);
        const transform = instance?.placements[selection.placementIndex];
        if (!transform) return;
        const duplicateSelection: Selection = {
          kind: "instance",
          assetId,
          placementIndex: selection.placementIndex + offset + 1,
        };
        inserts.push({
          source: cloneSelection(selection),
          selection: duplicateSelection,
          snapshot: cloneUngroupedPlacement(transform),
        });
      });
    }

    const characterSelections = selections
      .filter((selection): selection is CharacterSelection => selection.kind === "character")
      .map((selection) => cloneSelection(selection) as CharacterSelection)
      .sort((left, right) => left.index - right.index);
    characterSelections.forEach((selection, offset) => {
      const character = layout.characters[selection.index];
      if (!character) return;
      inserts.push({
        source: cloneSelection(selection),
        selection: { kind: "character", index: selection.index + offset + 1 },
        snapshot: cloneUngroupedCharacter(character),
      });
    });

    const lightSelections = selections
      .filter((selection): selection is LightSelection => selection.kind === "light")
      .map((selection) => cloneSelection(selection) as LightSelection)
      .sort((left, right) => left.index - right.index);
    lightSelections.forEach((selection, offset) => {
      const light = layout.lights?.[selection.index];
      if (!light) return;
      const snapshot = cloneUngroupedLightActor(light);
      snapshot.id = this.host.createLightId(light.type);
      snapshot.name = uniqueActorName(light.name ?? light.id, layout.lights ?? []);
      inserts.push({
        source: cloneSelection(selection),
        selection: { kind: "light", index: selection.index + offset + 1 },
        snapshot,
      });
    });

    const actorSelections = selections
      .filter((selection): selection is ActorSelection => selection.kind === "actor")
      .map((selection) => cloneSelection(selection) as ActorSelection)
      .sort((left, right) => left.index - right.index);
    actorSelections.forEach((selection, offset) => {
      const actor = layout.actors?.[selection.index];
      if (!actor) return;
      inserts.push({
        source: cloneSelection(selection),
        selection: { kind: "actor", index: selection.index + offset + 1 },
        snapshot: cloneUngroupedActorInstance(actor),
      });
    });

    if (inserts.length === 0) return null;

    const duplicateSelections = inserts.map((entry) => cloneSelection(entry.selection));
    const activeDuplicate =
      (previousActive &&
        inserts.find((entry) => selectionsEqual(entry.source, previousActive))?.selection) ??
      duplicateSelections.at(-1) ??
      null;

    this.executeCommand({
      label: `Duplicate ${inserts.length} objects`,
      redo: () => {
        for (const entry of inserts) {
          if (entry.selection.kind === "instance") {
            this.host.insertInstancePlacement(
              entry.selection.assetId,
              entry.selection.placementIndex,
              entry.snapshot as LayoutPlacement,
            );
          } else if (entry.selection.kind === "character") {
            this.host.insertCharacterPlacement(
              entry.selection.index,
              entry.snapshot as LayoutCharacter,
            );
          } else if (entry.selection.kind === "actor") {
            this.host.insertActorPlacement(
              entry.selection.index,
              entry.snapshot as LayoutActorInstance,
            );
          } else if (entry.selection.kind === "light") {
            this.host.insertLightActor(entry.selection.index, entry.snapshot as LayoutLightActor);
          }
        }
        this.selectMany(
          duplicateSelections,
          activeDuplicate ? cloneSelection(activeDuplicate) : null,
        );
      },
      undo: () => {
        for (const entry of [...inserts].reverse()) {
          if (entry.selection.kind === "instance") {
            this.host.removeInstancePlacement(entry.selection.assetId, entry.selection.placementIndex);
          } else if (entry.selection.kind === "character") {
            this.host.removeCharacterPlacement(entry.selection.index);
          } else if (entry.selection.kind === "actor") {
            this.host.removeActorPlacement(entry.selection.index);
          } else if (entry.selection.kind === "light") {
            this.host.removeLightActor(entry.selection.index);
          }
        }
        this.selectMany(previousSelections, previousActive);
      },
    });
    return activeDuplicate ? cloneSelection(activeDuplicate) : null;
  }

  private setSelectionsFlag(
    selections: Selection[],
    flag: EditorFlagCommand,
    value: boolean,
    label: string,
  ): void {
    const entries = selections.flatMap((selection) => {
      const target = this.host.getMutableTransform(selection);
      return target
        ? [{ selection: cloneSelection(selection), previous: Boolean(target[flag]) }]
        : [];
    });
    if (entries.length === 0) {
      this.host.onStatus("No matching objects.", "warning");
      return;
    }
    if (entries.every((entry) => entry.previous === value)) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyFlag(
          entry.selection,
          flag,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.updateSelectionBox();
      this.host.updateGizmo();
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private getSelectedSelectionsWithTargets(
    filter: (selection: Selection) => boolean = () => true,
  ): Selection[] {
    return this.getSelectedSelections().filter((selection) => {
      return filter(selection) && this.host.getMutableTransform(selection) !== null;
    });
  }

  private applyFlag(
    selection: Selection,
    flag: EditorFlagCommand,
    value: boolean,
    options: { notify?: boolean } = {},
  ): void {
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    if (value) target[flag] = true;
    else delete target[flag];

    if (flag === "hidden") this.host.applyVisibility(selection);
    this.host.updateSelectionBox();
    this.host.updateGizmo();
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  private setSelectionsDefaultTrueFlag(
    selections: Selection[],
    field: EditorDefaultTrueFlagCommand | "spatiallyLoaded",
    value: boolean,
    label: string,
  ): void {
    const entries = selections.flatMap((selection) => {
      if (selection.kind === "light" && field !== "spatiallyLoaded") return [];
      const target = this.host.getMutableTransform(selection);
      if (!target) return [];
      const previous = target[field] ?? true;
      return previous === value ? [] : [{ selection: cloneSelection(selection), previous }];
    });
    if (entries.length === 0) return;

    const applyEntries = (mode: EditorCommandPhase): void => {
      for (const entry of entries) {
        this.applyDefaultTrueFlag(
          entry.selection,
          field,
          mode === "redo" ? value : entry.previous,
          { notify: false },
        );
      }
      this.host.emitSelectionChanged();
    };

    this.executeCommand({
      label,
      redo: () => applyEntries("redo"),
      undo: () => applyEntries("undo"),
    });
  }

  private applyDefaultTrueFlag(
    selection: Selection,
    field: EditorDefaultTrueFlagCommand | "spatiallyLoaded",
    value: boolean,
    options: { notify?: boolean } = {},
  ): void {
    if (selection.kind === "light" && field !== "spatiallyLoaded") return;
    const target = this.host.getMutableTransform(selection);
    if (!target) return;
    if (value) delete target[field];
    else target[field] = false;
    if (field === "castShadow") this.host.applyCastShadow(selection);
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  private applyMetadataValue(
    selection: Selection,
    key: string,
    value: MetadataValue | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (selection.kind === "light") return;
    const target = this.host.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    if (value === undefined) {
      if (target.metadata) {
        delete target.metadata[key];
        if (Object.keys(target.metadata).length === 0) delete target.metadata;
      }
    } else {
      target.metadata ??= {};
      target.metadata[key] = cloneMetadataValue(value) as MetadataValue;
    }
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  private applyPhysicsSettings(
    selection: Selection,
    physics: LayoutPhysics | undefined,
    options: { notify?: boolean } = {},
  ): void {
    if (selection.kind === "light") return;
    const target = this.host.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    const next = clonePhysics(physics);
    if (next) target.physics = next;
    else delete target.physics;
    if (options.notify !== false) this.host.emitSelectionChanged();
  }

  private createGroupId(): string {
    const existing = new Set<string>();
    for (const selection of this.host.getAllSelections({ includeHidden: true })) {
      const groupId = this.host.getMutableTransform(selection)?.groupId;
      if (groupId) existing.add(groupId);
    }

    return uniqueEditorId("group", existing, 10_000);
  }

  private createNodeId(): string {
    const existing = new Set<string>();
    for (const selection of this.host.getAllSelections({ includeHidden: true })) {
      const nodeId = this.host.getMutableTransform(selection)?.nodeId;
      if (nodeId) existing.add(nodeId);
    }
    return uniqueEditorId("node", existing);
  }
}
