/**
 * Editor-owned contract for the game-provided catalogs/helpers the editor
 * renders: the Game Mode list, behavior-script ids, the montage→input binding
 * resolver, input-code formatting, and the ragdoll driver used by the
 * skeletal-mesh preview.
 *
 * Inversion of control. The editor core stays generic and must not import
 * `@/game` — a fork owns `src/game` and may reshape those exports. Instead the
 * composition root (`src/main.ts`, the only module allowed to see both the
 * editor and the game layer) injects the game's catalog here at editor startup
 * via {@link setGameEditorCatalog}; editor panels read it through
 * {@link getGameEditorCatalog}. The game's concrete types structurally satisfy
 * this contract, so no `@/game` symbol (value or type) leaks into the editor.
 *
 * The interface deliberately references only editor-importable layers
 * (`three`, `@engine/*`, `@/scene/*`), never `@/game`.
 */
import type { Object3D } from "three";
import type { Vec3 } from "@engine/scene/layout";
import type { RagdollGroupDesc, RagdollPose } from "@engine/physics/ragdoll";
import type {
  AssetSkeletonMontageDef,
  AssetSkeletonPhysicsBodyDef,
  AssetSkeletonPhysicsConstraintDef,
} from "@/scene/assetSkeletonLoader";

/** A selectable Game Mode as shown in the editor's World Settings dropdown. */
export interface EditorGameModeOption {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

/** An authored upper-body montage resolved to the input action that fires it. */
export interface EditorMontageBinding {
  readonly montage: string;
  readonly clip: string;
  readonly action: string;
  readonly mode: string;
  readonly blendInSeconds: number;
  readonly blendOutSeconds: number;
}

/** The physics-bridge slice the ragdoll driver needs (subset of the runtime physics API). */
export interface EditorRagdollPhysicsBridge {
  spawnRagdoll(desc: RagdollGroupDesc, options?: { detachEntityId?: string }): number | null;
  sampleRagdoll(id: number): RagdollPose[];
  despawnRagdoll(id: number): void;
}

/** The ragdoll driver handle the skeletal-mesh preview drives each tick. */
export interface EditorRagdollDriver {
  update(): void;
  getFollowPosition(): Vec3 | null;
  getDrivenNodes(): Object3D[];
  dispose(): void;
}

/**
 * Game-provided data + helpers the editor renders, injected at startup. The
 * game assembles a plain object (`src/game/editorCatalog.ts`) whose inferred
 * shape structurally satisfies this contract.
 */
/**
 * Optional per-leaf metadata for a data-table field. Purely presentational —
 * the authoritative rule check is {@link EditorDataTableDef.validate}. Leaves
 * with no matching entry render generically from their raw key and value type.
 */
export interface EditorDataTableFieldMeta {
  /** Dotted leaf path within an entry, e.g. `cost.food` or `damageMultipliers.heavy`.
   *  A path segment of `[]` matches any array index (every tier/level at once). */
  readonly path: string;
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** When set, the leaf renders as a dropdown of these string options. */
  readonly enum?: readonly string[];
  /**
   * When set, the leaf names a manifest asset of this kind (`effect`,
   * `staticMesh`, …) and renders as a picker of the project's assets instead of
   * a free-text id — so an author chooses from what actually exists rather than
   * typing an id the runtime would fail to resolve.
   *
   * On an **array** path the whole array is one add/remove list of pickers, which
   * is also the only way to fill a list the file left empty. Ids already used in
   * the same list are not offered twice; an id no asset answers is preserved and
   * flagged rather than silently dropped.
   */
  readonly assetOptions?: string;
  /**
   * Named values loaded from one of the table definition's `optionSources`.
   * Unlike `assetOptions`, these are project-data ids (for example audio events),
   * not files in the asset manifest.
   */
  readonly referenceOptions?: string;
  /**
   * Optional display order inside a form group. Fields without an order retain
   * their authored JSON order after the ordered fields.
   */
  readonly order?: number;
  /** Renders the input disabled — for structural/identity fields the validator
   *  would reject edits to anyway (tier level indices, entry ids). */
  readonly readonly?: boolean | ((container: Readonly<Record<string | number, unknown>>) => boolean);
  /**
   * Computes a display-only value from the leaf's parent object. The game
   * catalog owns the rule; the editor merely applies it after related edits so
   * its form stays generic.
   */
  readonly derive?: (container: Readonly<Record<string | number, unknown>>) => string | number | boolean;
  /** Tooltip on the field, e.g. explaining that a value is only the level-1 base. */
  readonly hint?: string;
  /** Per-element names for a scalar array (`[]` path), e.g. `["X", "Y", "Z"]` for
   *  an offset triple. Elements past the list fall back to `#n`. */
  readonly itemLabels?: readonly string[];
}

/**
 * Optional label for a repeated block, so the editor can title the collapsible
 * sub-group it renders for each element. Purely presentational.
 *
 * Two block shapes are supported. An **array** path (`progression.settlement`)
 * groups each object element as a tier. An **object** path opts its direct
 * object children into grouping (`slots` → one group per slot); without that
 * opt-in every nested object would become a group, which is noise for the flat
 * balance files. `path: ""` names the entry root itself, for a table whose rows
 * *are* the container (e.g. a `slots` entry whose keys are the slots).
 */
export interface EditorDataTableGroupMeta {
  /** Dotted path to the array or the grouping object; `""` for the entry root. */
  readonly path: string;
  /** Friendly name for the block, e.g. `Settlement`. The editor appends the
   *  element's level (`— Level N`) to distinguish array tiers. */
  readonly label: string;
  /** Object blocks only: friendly title per child key (`lightSmoke` → `Light
   *  damage smoke`). Keys with no entry fall back to the raw key. */
  readonly keyLabels?: Readonly<Record<string, string>>;
}

/**
 * A heading that gathers a table's entries into one collapsible block.
 *
 * For the tables whose rows are a flat namespace rather than a short list: the
 * audio event table ships twenty-nine events, and rendering them as twenty-nine
 * peer sections means the author scrolls a wall to find `ui.click`. Categories
 * put one line per channel on screen instead, and the channel an author is not
 * working on stays shut.
 *
 * Membership is by entry-id prefix because that is what the id already encodes
 * (`combat.sword_swing` is a combat sound and says so). Nothing is hidden by
 * failing to match: an entry no category claims still renders, under a trailing
 * "other" heading — a table where a new row could silently vanish would be worse
 * than a flat one.
 */
export interface EditorDataTableCategoryMeta {
  /** Stable id, used for the DOM hook and for tests. */
  readonly id: string;
  /** Heading text, e.g. `COMBAT`. */
  readonly label: string;
  /**
   * Entry-id prefixes this category claims, e.g. `["combat.", "siege."]`.
   *
   * First match wins in declaration order, so a broader prefix declared later
   * cannot steal a narrower one's rows.
   */
  readonly prefixes: readonly string[];
  /**
   * Shown in place of the entry list when the category has no rows.
   *
   * A category with nothing in it is worth rendering rather than dropping: it
   * says the channel is planned and empty, which is a fact about the project an
   * author otherwise has to go and read the design doc to learn.
   */
  readonly emptyHint?: string;
}

/** A secondary JSON table whose entry ids are offered by a reference picker. */
export interface EditorDataTableOptionSource {
  /** Stable name referenced by `EditorDataTableFieldMeta.referenceOptions`. */
  readonly id: string;
  /** Public-root-relative JSON path. */
  readonly path: string;
  /** Optional dotted object path containing the selectable entry ids. */
  readonly section?: string;
}

/**
 * A game-data file the editor's Data Table editor can open and save. The editor
 * stays generic: it renders each top-level entry as a per-field form by walking
 * the JSON's scalar leaves, and it enforces correctness by calling
 * {@link validate} — the game's real runtime validator, injected as a function so
 * no `@/game` symbol is imported into the editor.
 */
export interface EditorDataTableDef {
  /** Stable id, e.g. `units`. */
  readonly id: string;
  /** Human-readable title shown in the editor header. */
  readonly label: string;
  /** Public-root-relative JSON path, e.g. `game-data/balance/units.json`. */
  readonly path: string;
  /**
   * Edit one sub-object instead of the whole document, e.g. `damage.materials`.
   * Dotted, so a file can expose several tables at the depth whose keys are the
   * natural rows.
   *
   * For a file that is only a table, this is absent and every top-level key is
   * an entry. It exists for files that carry a table *alongside* other data:
   * without it the editor would offer a project's schema markers and asset-
   * reference maps as editable rows, which is a worse hazard than the extra
   * field. Save merges the edited section back and still writes — and validates —
   * the whole document.
   */
  readonly section?: string;
  /** Optional per-leaf presentation hints; keyed by dotted path. */
  readonly fields?: readonly EditorDataTableFieldMeta[];
  /**
   * Secondary data tables used only to populate reference pickers. They are
   * read-only here; saving this table never writes them.
   */
  readonly optionSources?: readonly EditorDataTableOptionSource[];
  /**
   * Project-owned values merged into one entry after its committed git default
   * is restored. This keeps defaults for fields introduced after the current
   * commit explicit, rather than silently dropping them on a per-entry reset.
   */
  readonly resetEntryDefaults?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * Optional friendly names for repeated blocks. When an entry contains arrays
   * of objects (progression tiers, upgrade levels), the editor renders one
   * collapsible sub-group per element; these labels title those groups. Blocks
   * with no matching entry fall back to the array's own key. An entry here also
   * opts an *object* path's children into the same grouping — see
   * {@link EditorDataTableGroupMeta}.
   */
  readonly groups?: readonly EditorDataTableGroupMeta[];
  /**
   * Optional headings that gather the top-level entries into collapsible blocks.
   * Absent means the flat list every other table renders.
   */
  readonly entryCategories?: readonly EditorDataTableCategoryMeta[];
  /**
   * Authoritative validation. Returns `null` when the parsed document is valid,
   * otherwise a field-level message. Wraps the same validator the runtime loads
   * with, so the editor cannot save data the game would reject at boot.
   */
  validate(raw: unknown): string | null;
}

export interface GameEditorCatalog {
  /** Built-in Game Modes, in dropdown order. */
  readonly gameModeOptions: readonly EditorGameModeOption[];
  /** Known behavior-script ids offered as Event Binding suggestions. */
  readonly behaviorScriptIds: readonly string[];
  /** Resolves a character's authored montages to input bindings (game code map). */
  resolveMontageBindings(
    montages: readonly AssetSkeletonMontageDef[] | undefined,
  ): EditorMontageBinding[];
  /** Human-readable label for a raw input code (e.g. `KeyQ` → "Q"). */
  formatInputCode(code: string): string;
  /** Raw input codes bound to an action, in declaration order. */
  keysForAction(action: string): string[];
  /** Builds the ragdoll driver for the skeletal-mesh preview, or null. */
  createRagdollDriver(
    root: Object3D,
    bodies: readonly AssetSkeletonPhysicsBodyDef[],
    constraints: readonly AssetSkeletonPhysicsConstraintDef[],
    bridge: EditorRagdollPhysicsBridge,
    detachEntityId?: string,
  ): EditorRagdollDriver | null;
  /**
   * Game-data files editable through the Data Table editor. Omitted (or empty)
   * for a fork that ships no editable balance data — the editor then offers no
   * data-table opener, so the feature is naturally opt-in.
   */
  readonly dataTables?: readonly EditorDataTableDef[];
}

let catalog: GameEditorCatalog | null = null;

/** Injected once by the composition root before the editor renders. */
export function setGameEditorCatalog(next: GameEditorCatalog): void {
  catalog = next;
}

/** The injected game catalog. Throws if the composition root never registered it. */
export function getGameEditorCatalog(): GameEditorCatalog {
  if (!catalog) {
    throw new Error(
      "GameEditorCatalog was not registered — src/main.ts must call " +
        "setGameEditorCatalog(GAME_EDITOR_CATALOG) before constructing the editor.",
    );
  }
  return catalog;
}
