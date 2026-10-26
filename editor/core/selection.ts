export type Selection =
  | { kind: "instance"; assetId: string; placementIndex: number }
  | { kind: "character"; index: number }
  | { kind: "light"; index: number }
  | { kind: "actor"; index: number }
  | { kind: "reflectionPlane"; index: number }
  | { kind: "reflectiveSurface"; index: number }
  | { kind: "reflectionCapture"; index: number }
  | { kind: "blockingVolume"; index: number }
  | { kind: "aiNavigationVolume"; index: number }
  | { kind: "targetPoint"; index: number }
  | { kind: "spline"; index: number }
  | { kind: "landscape"; index: number }
  | { kind: "lake"; index: number }
  | { kind: "worldWidget"; index: number }
  | { kind: "sky" }
  | { kind: "fog" }
  | { kind: "cloud" }
  | { kind: "post" };

export type InstanceSelection = Extract<Selection, { kind: "instance" }>;
export type CharacterSelection = Extract<Selection, { kind: "character" }>;
export type LightSelection = Extract<Selection, { kind: "light" }>;
export type ActorSelection = Extract<Selection, { kind: "actor" }>;
/** A placed Planar Reflection (mirror) actor. */
export type ReflectionPlaneSelection = Extract<Selection, { kind: "reflectionPlane" }>;
/** A placed Reflective Surface (textured glossy planar reflection) actor. */
export type ReflectiveSurfaceSelection = Extract<Selection, { kind: "reflectiveSurface" }>;
/** A placed Sphere Reflection Capture (probe) actor. */
export type ReflectionCaptureSelection = Extract<Selection, { kind: "reflectionCapture" }>;
/** A placed Blocking Volume (parametric blockout brush) actor. */
export type BlockingVolumeSelection = Extract<Selection, { kind: "blockingVolume" }>;
/** A placed AI Navigation Volume (NavMesh Bounds Volume-style pathfinding bounds). */
export type AiNavigationVolumeSelection = Extract<Selection, { kind: "aiNavigationVolume" }>;
/** A placed Target Point actor for AI patrol route authoring. */
export type TargetPointSelection = Extract<Selection, { kind: "targetPoint" }>;
export type SplineSelection = Extract<Selection, { kind: "spline" }>;
/** A placed Landscape (heightfield terrain) actor. */
export type LandscapeSelection = Extract<Selection, { kind: "landscape" }>;
/** A placed world-space UI widget (screen-projected DOM billboard). */
export type WorldWidgetSelection = Extract<Selection, { kind: "worldWidget" }>;
/** The singleton Sky Atmosphere environment actor (no index/transform). */
export type SkySelection = Extract<Selection, { kind: "sky" }>;
/** The singleton Exponential Height Fog environment actor (no index/transform). */
export type FogSelection = Extract<Selection, { kind: "fog" }>;
/** The singleton static Cloud Layer environment actor (no index/transform). */
export type CloudSelection = Extract<Selection, { kind: "cloud" }>;
/** The singleton global Post Process environment actor (no index/transform). */
export type PostSelection = Extract<Selection, { kind: "post" }>;

export function cloneSelection(selection: Selection): Selection {
  if (selection.kind === "lake") return { ...selection };
  if (selection.kind === "instance") {
    return {
      kind: "instance",
      assetId: selection.assetId,
      placementIndex: selection.placementIndex,
    };
  }
  if (selection.kind === "light") return { kind: "light", index: selection.index };
  if (selection.kind === "actor") return { kind: "actor", index: selection.index };
  if (selection.kind === "reflectionPlane") return { kind: "reflectionPlane", index: selection.index };
  if (selection.kind === "reflectiveSurface") return { kind: "reflectiveSurface", index: selection.index };
  if (selection.kind === "reflectionCapture") return { kind: "reflectionCapture", index: selection.index };
  if (selection.kind === "blockingVolume") return { kind: "blockingVolume", index: selection.index };
  if (selection.kind === "aiNavigationVolume") return { kind: "aiNavigationVolume", index: selection.index };
  if (selection.kind === "targetPoint") return { kind: "targetPoint", index: selection.index };
  if (selection.kind === "spline") return { kind: "spline", index: selection.index };
  if (selection.kind === "landscape") return { kind: "landscape", index: selection.index };
  if (selection.kind === "worldWidget") return { kind: "worldWidget", index: selection.index };
  if (selection.kind === "sky") return { kind: "sky" };
  if (selection.kind === "fog") return { kind: "fog" };
  if (selection.kind === "cloud") return { kind: "cloud" };
  if (selection.kind === "post") return { kind: "post" };
  return { kind: "character", index: selection.index };
}

export function selectionId(selection: Selection): string {
  if (selection.kind === "lake") return `lake:${selection.index}`;
  if (selection.kind === "character") return `character:${selection.index}`;
  if (selection.kind === "light") return `light:${selection.index}`;
  if (selection.kind === "actor") return `actor:${selection.index}`;
  if (selection.kind === "reflectionPlane") return `reflectionPlane:${selection.index}`;
  if (selection.kind === "reflectiveSurface") return `reflectiveSurface:${selection.index}`;
  if (selection.kind === "reflectionCapture") return `reflectionCapture:${selection.index}`;
  if (selection.kind === "blockingVolume") return `blockingVolume:${selection.index}`;
  if (selection.kind === "aiNavigationVolume") return `aiNavigationVolume:${selection.index}`;
  if (selection.kind === "targetPoint") return `targetPoint:${selection.index}`;
  if (selection.kind === "spline") return `spline:${selection.index}`;
  if (selection.kind === "landscape") return `landscape:${selection.index}`;
  if (selection.kind === "worldWidget") return `worldWidget:${selection.index}`;
  if (selection.kind === "sky") return "sky";
  if (selection.kind === "fog") return "fog";
  if (selection.kind === "cloud") return "cloud";
  if (selection.kind === "post") return "post";
  return `instance:${encodeURIComponent(selection.assetId)}:${selection.placementIndex}`;
}

export function parseSelectionId(id: string): Selection | null {
  const [kind, encodedAssetId, rawIndex] = id.split(":");
  if (kind === "lake") { const index = Number(encodedAssetId); return Number.isInteger(index) && index >= 0 ? { kind, index } : null; }
  if (kind === "sky") return { kind: "sky" };
  if (kind === "fog") return { kind: "fog" };
  if (kind === "cloud") return { kind: "cloud" };
  if (kind === "post") return { kind: "post" };
  if (kind === "character") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "character", index } : null;
  }
  if (kind === "light") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "light", index } : null;
  }
  if (kind === "actor") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "actor", index } : null;
  }
  if (kind === "reflectionPlane") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "reflectionPlane", index } : null;
  }
  if (kind === "reflectiveSurface") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "reflectiveSurface", index } : null;
  }
  if (kind === "reflectionCapture") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "reflectionCapture", index } : null;
  }
  if (kind === "blockingVolume") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "blockingVolume", index } : null;
  }
  if (kind === "aiNavigationVolume") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "aiNavigationVolume", index } : null;
  }
  if (kind === "targetPoint") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "targetPoint", index } : null;
  }
  if (kind === "spline") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "spline", index } : null;
  }
  if (kind === "landscape") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "landscape", index } : null;
  }
  if (kind === "worldWidget") {
    const index = Number(encodedAssetId);
    return Number.isInteger(index) ? { kind: "worldWidget", index } : null;
  }
  if (kind !== "instance" || rawIndex === undefined) return null;
  const placementIndex = Number(rawIndex);
  if (!Number.isInteger(placementIndex)) return null;
  return {
    kind: "instance",
    assetId: decodeURIComponent(encodedAssetId ?? ""),
    placementIndex,
  };
}

export function selectionsEqual(
  left: Selection | null,
  right: Selection | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "lake" && right.kind === "lake") return left.index === right.index;
  if (left.kind === "character" && right.kind === "character") {
    return left.index === right.index;
  }
  if (left.kind === "light" && right.kind === "light") {
    return left.index === right.index;
  }
  if (left.kind === "actor" && right.kind === "actor") {
    return left.index === right.index;
  }
  if (left.kind === "reflectionPlane" && right.kind === "reflectionPlane") {
    return left.index === right.index;
  }
  if (left.kind === "reflectiveSurface" && right.kind === "reflectiveSurface") {
    return left.index === right.index;
  }
  if (left.kind === "reflectionCapture" && right.kind === "reflectionCapture") {
    return left.index === right.index;
  }
  if (left.kind === "blockingVolume" && right.kind === "blockingVolume") {
    return left.index === right.index;
  }
  if (left.kind === "aiNavigationVolume" && right.kind === "aiNavigationVolume") {
    return left.index === right.index;
  }
  if (left.kind === "targetPoint" && right.kind === "targetPoint") {
    return left.index === right.index;
  }
  if (left.kind === "spline" && right.kind === "spline") {
    return left.index === right.index;
  }
  if (left.kind === "landscape" && right.kind === "landscape") {
    return left.index === right.index;
  }
  if (left.kind === "worldWidget" && right.kind === "worldWidget") {
    return left.index === right.index;
  }
  // The Sky Atmosphere + Height Fog + Cloud Layer are singletons: same kind ⇒ same object.
  if (left.kind === "sky" && right.kind === "sky") return true;
  if (left.kind === "fog" && right.kind === "fog") return true;
  if (left.kind === "cloud" && right.kind === "cloud") return true;
  if (left.kind === "post" && right.kind === "post") return true;
  if (left.kind !== "instance" || right.kind !== "instance") return false;
  return left.assetId === right.assetId && left.placementIndex === right.placementIndex;
}

export function replaceSelectedGroup(
  selected: Map<string, Selection>,
  selection: Selection | null,
  groupSelections: Selection[],
): Selection | null {
  selected.clear();
  if (!selection) return null;
  for (const groupSelection of groupSelections) {
    const current = cloneSelection(groupSelection);
    selected.set(selectionId(current), current);
  }
  return cloneSelection(selection);
}

export function replaceSelectedMany(
  selected: Map<string, Selection>,
  selections: Selection[],
  active: Selection | null,
): Selection | null {
  selected.clear();
  for (const selection of selections) {
    const current = cloneSelection(selection);
    selected.set(selectionId(current), current);
  }

  if (active && selected.has(selectionId(active))) {
    return cloneSelection(active);
  }
  return selected.values().next().value ?? null;
}

export function toggleSelectedGroup(
  selected: Map<string, Selection>,
  active: Selection | null,
  selection: Selection,
  groupSelections: Selection[],
): Selection | null {
  const allSelected = groupSelections.every((entry) => selected.has(selectionId(entry)));

  if (allSelected) {
    for (const entry of groupSelections) selected.delete(selectionId(entry));
    if (active && groupSelections.some((entry) => selectionsEqual(active, entry))) {
      const remaining = [...selected.values()];
      return remaining.at(-1) ? cloneSelection(remaining.at(-1)!) : null;
    }
    return active ? cloneSelection(active) : null;
  }

  for (const entry of groupSelections) {
    const current = cloneSelection(entry);
    selected.set(selectionId(current), current);
  }
  return cloneSelection(selection);
}

export function selectedSelectionList(
  selected: Map<string, Selection>,
  isValid: (selection: Selection) => boolean,
): Selection[] {
  return [...selected.values()].filter(isValid).map(cloneSelection);
}

export function compareInstanceDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "instance" || right.selection.kind !== "instance") return 0;
  const assetSort = right.selection.assetId.localeCompare(left.selection.assetId);
  if (assetSort !== 0) return assetSort;
  return right.selection.placementIndex - left.selection.placementIndex;
}

export function compareInstanceRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "instance" || right.selection.kind !== "instance") return 0;
  const assetSort = left.selection.assetId.localeCompare(right.selection.assetId);
  if (assetSort !== 0) return assetSort;
  return left.selection.placementIndex - right.selection.placementIndex;
}

export function compareCharacterDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "character" || right.selection.kind !== "character") return 0;
  return right.selection.index - left.selection.index;
}

export function compareCharacterRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "character" || right.selection.kind !== "character") return 0;
  return left.selection.index - right.selection.index;
}

export function compareLightDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "light" || right.selection.kind !== "light") return 0;
  return right.selection.index - left.selection.index;
}

export function compareLightRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "light" || right.selection.kind !== "light") return 0;
  return left.selection.index - right.selection.index;
}

export function compareActorDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "actor" || right.selection.kind !== "actor") return 0;
  return right.selection.index - left.selection.index;
}

export function compareWorldWidgetDeletes(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "worldWidget" || right.selection.kind !== "worldWidget") return 0;
  return right.selection.index - left.selection.index;
}

export function compareWorldWidgetRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "worldWidget" || right.selection.kind !== "worldWidget") return 0;
  return left.selection.index - right.selection.index;
}

export function compareActorRestores(
  left: { selection: Selection },
  right: { selection: Selection },
): number {
  if (left.selection.kind !== "actor" || right.selection.kind !== "actor") return 0;
  return left.selection.index - right.selection.index;
}
