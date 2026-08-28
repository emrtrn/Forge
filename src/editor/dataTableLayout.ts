/**
 * Form layout for the Data Table editor: the pure half of `DataTableEditor.ts`,
 * split out so the shaping rules can be exercised without a DOM.
 *
 * The job is turning one JSON entry into an ordered list of labelled inputs
 * grouped into readable blocks. The one judgement call it makes: **what counts
 * as a repeated block**. An object element of an array is one (a progression
 * tier); an object child of a path the game opted into through `groups` is one
 * (a damage slot). A *scalar* array is not — an `offset: [x, y, z]` triple must
 * stay three fields of its owner, not three anonymous "levels", which is exactly
 * what a purely index-driven rule produced.
 */
import type {
  EditorDataTableFieldMeta,
  EditorDataTableGroupMeta,
} from "@/editor/gameEditorRegistry";

/** A single editable leaf discovered by walking an entry. */
export interface Leaf {
  /** Dotted path within the entry, e.g. `cost.food`. */
  readonly path: string;
  /** `stringList` is a whole string array edited as one add/remove widget. */
  readonly type: "number" | "string" | "boolean" | "stringList";
  /** Parent container + key so a committed edit writes straight back into the doc. */
  readonly container: Record<string, unknown> | unknown[];
  readonly key: string | number;
  /**
   * Path of the nearest enclosing repeated block (`progression.settlement.0`,
   * `slots.lightSmoke`), or `""` when the leaf belongs to the entry's base values.
   */
  readonly block: string;
  /** Index within the owning array, for scalar array members only. */
  readonly itemIndex?: number;
}

/** A run of leaves rendered as one collapsible sub-group of an entry. */
export interface LeafGroup {
  /** Group identity: the block path (`progression.settlement.0`, `slots.lightSmoke`) or `""` for base. */
  readonly key: string;
  /** Base values (no repeated block) vs. one element of a repeated block. */
  readonly isBase: boolean;
  /** Path to the owning array/object (`progression.settlement`, `slots`); empty for base or an entry-root block. */
  readonly containerPath: string;
  /** Last path segment: the array index as text, or the object key. */
  readonly childKey: string;
  /** Element index within an array; `-1` for an object block or for base. */
  readonly index: number;
  readonly leaves: Leaf[];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function leafType(value: unknown): Leaf["type"] | null {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return null;
}

/** Replace array-index path segments with `[]` so field metadata is index-agnostic. */
export function templatePath(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, ".[]");
}

/**
 * Depth-first walk of an entry to its editable scalar leaves. Nested objects and
 * arrays recurse with a dotted path (`levels.0.maxHealth`); null/other values are
 * skipped so a leaf always has a coercible type. Each leaf carries the block it
 * landed in — see this module's header for what opens one.
 *
 * `blockParents` holds the object paths the game opted in (relative to the entry;
 * `""` is the entry root). Arrays need no opt-in.
 *
 * `listPaths` holds the (template) paths the game asked to edit as a *whole
 * list* rather than per index — an asset-id array. Such an array yields one
 * `stringList` leaf pointing at the array itself, so the widget can add and
 * remove entries. An empty list still yields its leaf, which is what makes a
 * slot the file left empty fillable at all.
 */
export function collectLeaves(
  node: Record<string, unknown> | unknown[],
  prefix: string,
  block: string,
  blockParents: ReadonlySet<string>,
  listPaths: ReadonlySet<string> = new Set(),
): Leaf[] {
  const leaves: Leaf[] = [];
  const isArray = Array.isArray(node);
  const childrenAreBlocks = !isArray && blockParents.has(prefix);
  const entries: [string | number, unknown][] = isArray
    ? node.map((value, index) => [index, value])
    : Object.entries(node);
  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : String(key);
    const type = leafType(value);
    if (type) {
      leaves.push({
        path,
        type,
        container: node,
        key,
        block,
        ...(isArray ? { itemIndex: Number(key) } : {}),
      });
    } else if (isPlainObject(value)) {
      const childBlock = isArray || childrenAreBlocks ? path : block;
      leaves.push(...collectLeaves(value, path, childBlock, blockParents, listPaths));
    } else if (Array.isArray(value)) {
      // A list the game named is one leaf over the array; anything else recurses
      // to its members, so an `offset` triple stays three numbered fields.
      if (listPaths.has(templatePath(path)) && value.every((item) => typeof item === "string")) {
        leaves.push({ path, type: "stringList", container: node, key, block });
      } else {
        leaves.push(...collectLeaves(value, path, block, blockParents, listPaths));
      }
    }
  }
  return leaves;
}

/**
 * Partition an entry's leaves into ordered sub-groups, keyed by the block each
 * leaf was assigned during the walk. Insertion order follows first appearance,
 * so groups keep the natural document order (base values, then each tier/slot).
 * An entry with no blocks yields a single base group.
 */
export function partitionLeaves(leaves: readonly Leaf[]): LeafGroup[] {
  const order: string[] = [];
  const groups = new Map<string, LeafGroup>();
  for (const leaf of leaves) {
    let bucket = groups.get(leaf.block);
    if (!bucket) {
      bucket = { ...describeBlock(leaf.block), leaves: [] };
      groups.set(leaf.block, bucket);
      order.push(leaf.block);
    }
    bucket.leaves.push(leaf);
  }
  return order.map((key) => groups.get(key)!);
}

/** Split a block path into its container and child (`levels.0` → `levels` + index 0). */
function describeBlock(block: string): Omit<LeafGroup, "leaves"> {
  if (!block) return { key: "", isBase: true, containerPath: "", childKey: "", index: -1 };
  const segments = block.split(".");
  const childKey = segments[segments.length - 1]!;
  return {
    key: block,
    isBase: false,
    containerPath: segments.slice(0, -1).join("."),
    childKey,
    index: /^\d+$/.test(childKey) ? Number(childKey) : -1,
  };
}

/**
 * Title for a sub-group: "Base values" for the base values, "<block> — Level N"
 * for an array tier, and the child's friendly name for an object block (a
 * damage slot), so the author always reads which row they are in. `meta` is the
 * game's entry for the group's container, when it named one.
 */
export function groupTitle(
  entry: unknown,
  group: LeafGroup,
  meta: EditorDataTableGroupMeta | undefined,
): string {
  if (group.isBase) return "Base values";
  if (group.index < 0) return meta?.keyLabels?.[group.childKey] ?? group.childKey;
  const label = meta?.label ?? (lastSegment(group.containerPath) || group.childKey);
  const element = resolveArrayElement(entry, group.containerPath, group.index);
  const level =
    isPlainObject(element) && typeof element.level === "number" ? element.level : group.index + 1;
  return `${label} — Level ${level}`;
}

/**
 * Field caption. Members of a scalar array get a per-element suffix so the rows
 * are told apart: the game's own names when it supplied them (`X`/`Y`/`Z` for an
 * offset triple), otherwise `#n` — and only when the array actually holds more
 * than one value, so a single-item list stays a plain field.
 */
export function leafLabel(leaf: Leaf, meta: EditorDataTableFieldMeta | undefined): string {
  const base = meta?.label ?? (leaf.path || "(value)");
  if (leaf.itemIndex === undefined) return base;
  const itemLabel = meta?.itemLabels?.[leaf.itemIndex];
  if (itemLabel) return `${base} — ${itemLabel}`;
  const length = Array.isArray(leaf.container) ? leaf.container.length : 0;
  return length > 1 ? `${base} #${leaf.itemIndex + 1}` : base;
}

/** Resolve `entry.<arrayPath>[index]`, tolerating missing intermediate keys. */
function resolveArrayElement(entry: unknown, arrayPath: string, index: number): unknown {
  let node: unknown = entry;
  for (const segment of arrayPath ? arrayPath.split(".") : []) {
    if (!isPlainObject(node)) return undefined;
    node = node[segment];
  }
  return Array.isArray(node) ? node[index] : undefined;
}

/** Last dotted segment, used as a fallback group label when the game names none. */
function lastSegment(path: string): string {
  const segments = path.split(".");
  return segments[segments.length - 1] || path;
}

/** One rendered heading: a category (or the trailing catch-all) and its rows. */
export interface EntryCategoryBucket {
  readonly id: string;
  readonly label: string;
  readonly entryIds: readonly string[];
  /** Shown instead of rows when `entryIds` is empty. */
  readonly emptyHint?: string;
  /** True for the trailing bucket that holds entries no category claimed. */
  readonly isOther: boolean;
}

/** Heading id for entries no declared category matches. */
export const OTHER_ENTRY_CATEGORY_ID = "__other";

/**
 * Buckets a table's entry ids under its declared categories, in declaration
 * order, with anything unmatched gathered into a trailing "other" heading.
 *
 * Two properties this guarantees, and both are the reason it is a pure function
 * with its own test rather than a loop inside the renderer:
 *
 * - **Nothing is lost.** Every id in equals exactly one id out. A category
 *   scheme that silently swallowed a row would turn "I added an event and the
 *   editor does not show it" into a mystery, and the obvious way to write this
 *   (filter per category, render the results) has exactly that bug.
 * - **Nothing is duplicated.** First match wins, so overlapping prefixes are a
 *   precedence question rather than a row appearing twice.
 *
 * Entry order within a bucket follows the document, not the prefix list: the
 * file's own order is the one an author edited and diffs against.
 */
export function bucketEntriesByCategory(
  entryIds: readonly string[],
  categories: readonly { id: string; label: string; prefixes: readonly string[]; emptyHint?: string }[],
): EntryCategoryBucket[] {
  const claimed = new Map<string, string[]>();
  for (const category of categories) claimed.set(category.id, []);
  const other: string[] = [];

  for (const entryId of entryIds) {
    const owner = categories.find((category) =>
      category.prefixes.some((prefix) => entryId.startsWith(prefix)),
    );
    if (owner) claimed.get(owner.id)!.push(entryId);
    else other.push(entryId);
  }

  const buckets: EntryCategoryBucket[] = categories.map((category) => ({
    id: category.id,
    label: category.label,
    entryIds: claimed.get(category.id)!,
    ...(category.emptyHint === undefined ? {} : { emptyHint: category.emptyHint }),
    isOther: false,
  }));
  // Only when it has something in it: an empty catch-all is a heading that
  // says nothing, while a populated one is a prompt to go and categorise.
  if (other.length > 0) {
    buckets.push({
      id: OTHER_ENTRY_CATEGORY_ID,
      label: "UNCATEGORIZED",
      entryIds: other,
      isOther: true,
    });
  }
  return buckets;
}
