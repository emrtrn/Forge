/**
 * Data Table editor — Forge's form-based authoring shell for game-data balance
 * files (`public/game-data/balance/*.json`), opened from the Content Browser.
 *
 * Generic by construction: it knows nothing about "units" or "maxHealth". Given
 * an {@link EditorDataTableDef} (injected by the game via `GameEditorCatalog`),
 * it renders one collapsible section per top-level entry id and walks each entry
 * to its scalar leaves, emitting a labelled input per leaf keyed by its dotted
 * path (`cost.food`, `damageMultipliers.heavy`). Correctness is the game's rule:
 * Save runs `def.validate(document)` — the real runtime validator — and refuses
 * to write anything the runtime would reject, surfacing the field message.
 *
 * Self-contained: styles are injected once so the shared `style.css` is left
 * untouched. Dev-only, like every other `*Editor.ts`.
 */
import type {
  EditorDataTableDef,
  EditorDataTableFieldMeta,
  EditorDataTableGroupMeta,
  EditorDataTableOptionSource,
} from "@/editor/gameEditorRegistry";
import { loadDataTable, loadDataTableDefaults, saveDataTable } from "@/editor/dataTableStore";
import {
  bucketEntriesByCategory,
  collectLeaves,
  groupTitle,
  isPlainObject,
  leafLabel,
  leafType,
  partitionLeaves,
  templatePath,
  type EntryCategoryBucket,
  type Leaf,
  type LeafGroup,
} from "@/editor/dataTableLayout";

type StatusTone = "info" | "success" | "warning" | "error";

export interface DataTableEditorOptions {
  path: string;
  label: string;
  def: EditorDataTableDef;
  /**
   * Manifest assets (id/name/type/path) offered by fields the game marked with
   * `assetOptions` — an effect id is chosen from what the project actually
   * ships rather than typed. Absent (or empty) leaves those fields as text.
   */
  assets?: ReadonlyArray<{ id: string; name: string; assetType: string; path: string }>;
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

export class DataTableEditor {
  private static activeInstance: DataTableEditor | null = null;

  static async open(options: DataTableEditorOptions): Promise<DataTableEditor> {
    DataTableEditor.activeInstance?.close();
    const editor = new DataTableEditor(options);
    DataTableEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;

  /**
   * The entry root, mutated in place as leaves are committed. Identical to
   * {@link fullDoc} unless the def names a `section`, in which case this is that
   * sub-object and {@link fullDoc} is what gets validated and written.
   */
  private doc: Record<string, unknown> = {};
  /** The whole parsed file; the save payload and the validator's input. */
  private fullDoc: Record<string, unknown> = {};
  /** Field metadata keyed by dotted leaf path, for labels/steps/enums. */
  private readonly fieldMeta = new Map<string, EditorDataTableFieldMeta>();
  /** Block metadata keyed by the container's dotted path (the array, or the object whose children group). */
  private readonly groupMeta = new Map<string, EditorDataTableGroupMeta>();
  /** Object paths whose direct object children each form a block. Arrays group without opt-in. */
  private readonly blockParents = new Set<string>();
  /** Template paths edited as a whole list (an asset-id array), not per index. */
  private readonly listPaths = new Set<string>();
  /** Project-data ids loaded for reference fields (an audio-event picker, say). */
  private readonly referenceOptions = new Map<string, readonly string[]>();
  /** Committed (git HEAD) document, lazily fetched the first time an entry is reset. */
  private defaults: Record<string, unknown> | null = null;
  private disposed = false;

  private constructor(private readonly options: DataTableEditorOptions) {
    for (const field of options.def.fields ?? []) {
      this.fieldMeta.set(field.path, field);
      // An asset-picker field over an array is edited as a list; over a scalar
      // the same entry just turns the text box into a dropdown.
      if (field.assetOptions) this.listPaths.add(field.path);
    }
    for (const group of options.def.groups ?? []) {
      this.groupMeta.set(group.path, group);
      this.blockParents.add(group.path);
    }
    ensureStyles();

    this.overlay = document.createElement("div");
    this.overlay.className = "dte-overlay";
    this.overlay.innerHTML = `
<div class="dte-window" role="dialog" aria-label="Data Table Editor">
  <header class="dte-header">
    <span class="dte-tab">
      <span class="dte-tab-icon">DATA</span>
      <strong data-dte-title></strong>
      <span class="dte-badge">Data Table</span>
    </span>
    <div class="dte-header-actions">
      <button type="button" class="dte-save" data-dte-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="dte-close" data-dte-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="dte-body" data-dte-body></div>
  <footer class="dte-status" data-dte-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-dte-title]");
    this.bodyEl = this.req("[data-dte-body]");
    this.statusEl = this.req("[data-dte-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-dte-save]");

    this.req<HTMLButtonElement>("[data-dte-close]").addEventListener("click", () => this.close());
    this.saveBtn.addEventListener("click", () => void this.save());

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.save();
      }
    });
    this.overlay.focus();
  }

  private req<T extends Element = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`DataTableEditor: missing ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      const optionSources = this.options.def.optionSources ?? [];
      const [raw, ...optionDocs] = await Promise.all([
        loadDataTable(this.options.path),
        ...optionSources.map((source) => loadDataTable(source.path)),
      ]);
      if (!isPlainObject(raw)) {
        this.setStatus("This file is not an object keyed by entry id, so it cannot be edited.", "error");
        return;
      }
      const entryRoot = this.sectionOf(raw);
      if (!entryRoot) {
        this.setStatus(`This file has no "${this.options.def.section}" section, so it cannot be edited.`, "error");
        return;
      }
      optionSources.forEach((source, index) => {
        const options = optionSectionOf(optionDocs[index], source);
        if (!options) {
          throw new Error(`Option source "${source.id}" has no "${source.section ?? "(root)"}" section`);
        }
        this.referenceOptions.set(source.id, Object.keys(options).sort((a, b) => a.localeCompare(b, "tr")));
      });
      this.fullDoc = raw;
      this.doc = entryRoot;
      for (const entryId of Object.keys(this.doc)) this.applyDerivedFields(entryId);
      this.titleEl.textContent = this.options.def.label;
      this.renderEntries();
      this.setStatus(`Ready — ${Object.keys(this.doc).length} entries.`);
    } catch (error) {
      this.setStatus(`Load failed: ${describeError(error)}`, "error");
    }
  }

  /** True when the def buckets entries under collapsible channel headings. */
  private get isCategorised(): boolean {
    return (this.options.def.entryCategories?.length ?? 0) > 0;
  }

  private renderEntries(): void {
    this.bodyEl.replaceChildren();
    const categories = this.options.def.entryCategories;
    if (!categories || categories.length === 0) {
      for (const entryId of Object.keys(this.doc)) {
        this.bodyEl.append(this.buildEntrySection(entryId));
      }
      return;
    }
    for (const bucket of bucketEntriesByCategory(Object.keys(this.doc), categories)) {
      this.bodyEl.append(this.buildCategorySection(bucket));
    }
  }

  /**
   * One collapsible heading holding a category's entries.
   *
   * Shut by default, which is the whole point: a categorised table opens as one
   * line per channel instead of a wall of expanded forms. The entries inside
   * start shut too (see {@link buildEntrySection}), so opening a heading lists
   * its rows rather than unrolling every form in the channel at once.
   */
  private buildCategorySection(bucket: EntryCategoryBucket): HTMLDetailsElement {
    const section = document.createElement("details");
    section.className = "dte-category";
    if (bucket.isOther) section.classList.add("dte-category-other");
    section.dataset.categoryId = bucket.id;

    const summary = document.createElement("summary");
    summary.className = "dte-category-title";
    const heading = document.createElement("span");
    heading.textContent = bucket.label;
    const count = document.createElement("span");
    count.className = "dte-category-count";
    count.textContent = String(bucket.entryIds.length);
    summary.append(heading, count);
    section.append(summary);

    if (bucket.entryIds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dte-category-empty";
      empty.textContent = bucket.emptyHint ?? "Nothing in this group yet.";
      section.append(empty);
      return section;
    }
    for (const entryId of bucket.entryIds) section.append(this.buildEntrySection(entryId));
    return section;
  }

  /** One collapsible section for a single entry: title, reset button, field grid. */
  private buildEntrySection(entryId: string): HTMLDetailsElement {
    const entry = this.doc[entryId];
    const section = document.createElement("details");
    section.className = "dte-entry";
    section.dataset.entryId = entryId;
    // A categorised table (the audio events one) nests entries under channel
    // headings, so both levels start shut: the table opens as a list of
    // channels, not as every form in the file. A flat table has nothing above
    // the entry, so shutting these there would open to titles and no content.
    section.open = !this.isCategorised;

    const summary = document.createElement("summary");
    summary.className = "dte-entry-title";
    const heading = document.createElement("span");
    heading.textContent = displayLabel(entry) ? `${entryId} — ${displayLabel(entry)}` : entryId;
    summary.append(heading);

    // Reset this one entry to its committed (git HEAD) values. Placed in the
    // summary; clicking it must not toggle the section open/closed.
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "dte-reset";
    reset.textContent = "Reset to default";
    reset.title = "Reset this entry to its last committed (git) values";
    reset.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.resetEntry(entryId);
    });
    summary.append(reset);
    section.append(summary);

    const leaves =
      isPlainObject(entry) || Array.isArray(entry)
        ? collectLeaves(
            entry as Record<string, unknown> | unknown[],
            "",
            "",
            this.blockParents,
            this.listPaths,
          )
        : // A scalar top-level entry is itself a single leaf; key it by the entry
          // id so a flat config (e.g. roads.json) can label each value distinctly.
          [{ path: entryId, type: leafType(entry)!, container: this.doc, key: entryId, block: "" } satisfies Leaf];

    const groups = partitionLeaves(leaves);
    // Entries with repeated blocks (progression tiers, upgrade levels, damage
    // slots) get one collapsible sub-group each so the long form stays readable;
    // simpler flat configs (units, roads, …) keep the single grid unchanged.
    if (groups.some((group) => !group.isBase)) {
      for (const group of groups) section.append(this.buildGroupSection(entry, group, entryId));
    } else {
      const grid = document.createElement("div");
      grid.className = "dte-grid";
      for (const leaf of this.orderedLeaves(leaves)) grid.append(this.renderLeaf(leaf, entryId));
      section.append(grid);
    }
    return section;
  }

  /** One collapsible sub-group (base values, or a single array tier/level). */
  private buildGroupSection(entry: unknown, group: LeafGroup, entryId: string): HTMLElement {
    const details = document.createElement("details");
    details.className = "dte-group";
    // Keyed so a re-render (a list edit) can put the open sub-groups back.
    details.dataset.groupKey = group.key;
    // Base values open by default; tiers/levels start collapsed to cut clutter.
    details.open = group.isBase;

    const summary = document.createElement("summary");
    summary.className = "dte-group-title";
    summary.textContent = groupTitle(entry, group, this.groupMeta.get(group.containerPath));
    details.append(summary);

    const grid = document.createElement("div");
    grid.className = "dte-grid";
    for (const leaf of this.orderedLeaves(group.leaves)) grid.append(this.renderLeaf(leaf, entryId));
    details.append(grid);
    return details;
  }

  /** Explicit form order wins where a game needs paired fields, then JSON order. */
  private orderedLeaves(leaves: readonly Leaf[]): readonly Leaf[] {
    return leaves
      .map((leaf, index) => ({ leaf, index, order: this.metaFor(leaf.path)?.order }))
      .sort((left, right) => {
        if (left.order === undefined && right.order === undefined) return left.index - right.index;
        if (left.order === undefined) return 1;
        if (right.order === undefined) return -1;
        return left.order - right.order || left.index - right.index;
      })
      .map(({ leaf }) => leaf);
  }

  /**
   * Rebuild one entry's section in place, keeping what the author had open and
   * where they were scrolled. Used after an edit that changes the *shape* of the
   * form — adding or removing a list item, or a reset — where re-rendering just
   * that leaf is not enough.
   */
  private replaceEntrySection(entryId: string): void {
    const existing = this.bodyEl.querySelector<HTMLDetailsElement>(
      `.dte-entry[data-entry-id="${CSS.escape(entryId)}"]`,
    );
    if (!existing) {
      this.renderEntries();
      return;
    }
    const openGroups = new Set(
      Array.from(existing.querySelectorAll<HTMLDetailsElement>("details[data-group-key]"))
        .filter((details) => details.open)
        .map((details) => details.dataset.groupKey ?? ""),
    );
    const scrollTop = this.bodyEl.scrollTop;
    const rebuilt = this.buildEntrySection(entryId);
    rebuilt.open = existing.open;
    for (const details of rebuilt.querySelectorAll<HTMLDetailsElement>("details[data-group-key]")) {
      details.open = openGroups.has(details.dataset.groupKey ?? "");
    }
    existing.replaceWith(rebuilt);
    this.bodyEl.scrollTop = scrollTop;
  }

  /**
   * The sub-object this editor treats as its entry root: the whole document, or
   * the named `section` within it. Null when the section is missing or not an
   * object, which is a load failure rather than something to edit around.
   */
  private sectionOf(doc: Record<string, unknown>): Record<string, unknown> | null {
    const section = this.options.def.section;
    if (section === undefined) return doc;
    let cursor: unknown = doc;
    for (const key of section.split(".")) {
      if (!isPlainObject(cursor)) return null;
      cursor = cursor[key];
    }
    return isPlainObject(cursor) ? cursor : null;
  }

  /** Restore one entry to its committed defaults, then leave it as a dirty edit to save. */
  private async resetEntry(entryId: string): Promise<void> {
    try {
      if (!this.defaults) {
        const committed = await loadDataTableDefaults(this.options.path);
        // Reset reads the same section the editor is showing, or an entry id
        // would be looked up against the wrong level of the file.
        this.defaults = this.sectionOf(committed) ?? {};
      }
      const defaultEntry = this.defaults[entryId];
      if (defaultEntry === undefined) {
        this.setStatus(`"${entryId}" is not in the repository (git), so there is no default to reset to.`, "warning");
        return;
      }
      const projectDefaults = this.options.def.resetEntryDefaults?.[entryId];
      // Spread only what can be spread. A flat config's entry is a bare number
      // (`crossfadeSeconds: 18`) and object-spreading one yields `{}` — a reset
      // that silently replaced the value with an empty object, which the save
      // then refused with a message about the wrong thing entirely.
      const restored = structuredClone(defaultEntry);
      this.doc[entryId] =
        isPlainObject(restored) && projectDefaults !== undefined
          ? { ...restored, ...structuredClone(projectDefaults) }
          : restored;
      this.applyDerivedFields(entryId);
      this.replaceEntrySection(entryId);
      this.markDirty();
      this.setStatus(`"${entryId}" reset to its default — press Save to write it.`, "info");
    } catch (error) {
      this.setStatus(`Could not read the defaults: ${describeError(error)}`, "error");
    }
  }

  /**
   * Field metadata for a leaf: an exact-path entry wins, else the array-index
   * template (`levels.0.cost.wood` → `levels.[].cost.wood`) so one entry covers
   * every tier without listing indices.
   */
  private metaFor(path: string): EditorDataTableFieldMeta | undefined {
    return this.fieldMeta.get(path) ?? this.fieldMeta.get(templatePath(path));
  }

  /** Apply game-authored computed fields within one entry without owning their rules. */
  private applyDerivedFields(entryId: string): void {
    const entry = this.doc[entryId];
    if (!isPlainObject(entry) && !Array.isArray(entry)) return;
    for (const leaf of collectLeaves(entry, "", "", this.blockParents, this.listPaths)) {
      const derive = this.metaFor(leaf.path)?.derive;
      if (derive) (leaf.container as Record<string | number, unknown>)[leaf.key] = derive(leaf.container as Record<string | number, unknown>);
    }
  }

  private renderLeaf(leaf: Leaf, entryId: string): HTMLElement {
    const meta = this.metaFor(leaf.path);
    if (leaf.type === "stringList") return this.renderAssetList(leaf, meta, entryId);

    const row = document.createElement("label");
    row.className = "dte-field";
    if (meta?.hint) {
      row.title = meta.hint;
      row.classList.add("dte-field-hinted");
    }

    const name = document.createElement("span");
    name.className = "dte-field-label";
    name.textContent = leafLabel(leaf, meta);
    row.append(name);

    const current = (leaf.container as Record<string | number, unknown>)[leaf.key];
    let input: HTMLInputElement | HTMLSelectElement;
    if (leaf.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      (input as HTMLInputElement).checked = current === true;
    } else if (leaf.type === "string" && meta?.enum) {
      input = document.createElement("select");
      for (const option of meta.enum) {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option;
        if (option === current) opt.selected = true;
        input.append(opt);
      }
    } else if (leaf.type === "string" && meta?.assetOptions) {
      // A lone asset id (not a list): the same picker, with the current value
      // preserved as an option so an id no asset answers survives a stray edit.
      input = this.buildAssetSelect(meta.assetOptions, typeof current === "string" ? current : "", []);
    } else if (leaf.type === "string" && meta?.referenceOptions) {
      input = this.buildReferenceSelect(meta.referenceOptions, typeof current === "string" ? current : "");
    } else {
      input = document.createElement("input");
      input.type = leaf.type === "number" ? "number" : "text";
      input.value = current == null ? "" : String(current);
      if (leaf.type === "number") {
        if (meta?.min !== undefined) input.min = String(meta.min);
        if (meta?.max !== undefined) input.max = String(meta.max);
        if (meta?.step !== undefined) input.step = String(meta.step);
      }
    }
    input.className = "dte-field-input";
    if (meta?.readonly === true || (typeof meta?.readonly === "function" && meta.readonly(leaf.container as Record<string | number, unknown>))) {
      input.disabled = true;
      if (!row.title) row.title = "This field is structural and cannot be edited.";
    } else {
      input.addEventListener("change", () => this.commitLeaf(leaf, input, entryId));
    }
    row.append(input);
    return row;
  }

  /**
   * Manifest assets of one kind, name-sorted, as the picker's options. The kind
   * is matched against the manifest's own `assetType`, with the file suffix
   * (`.effect.json`) as the tolerant fallback the runtime loader also applies to
   * older manifests that typed effects as prefabs.
   */
  private assetOptionsFor(kind: string): Array<{ id: string; name: string }> {
    const wanted = kind.toLowerCase();
    const suffix = `.${wanted}.json`;
    return (this.options.assets ?? [])
      .filter(
        (asset) =>
          asset.assetType?.toLowerCase() === wanted || asset.path.toLowerCase().endsWith(suffix),
      )
      .map((asset) => ({ id: asset.id, name: asset.name || asset.id }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }

  /**
   * A picker over the assets of one kind. `current` stays selectable even when no
   * asset answers it (flagged, never dropped — an id can outlive an import), and
   * `excluded` hides ids already spoken for elsewhere in the same list.
   */
  private buildAssetSelect(
    kind: string,
    current: string,
    excluded: readonly string[],
    blankLabel = "— none —",
  ): HTMLSelectElement {
    const select = document.createElement("select");
    const assets = this.assetOptionsFor(kind);
    const taken = new Set(excluded);
    select.append(buildOption("", blankLabel, current === ""));
    if (current && !assets.some((asset) => asset.id === current)) {
      select.append(buildOption(current, `⚠ ${current} (unknown asset)`, true));
    }
    for (const asset of assets) {
      if (asset.id !== current && taken.has(asset.id)) continue;
      select.append(buildOption(asset.id, asset.name, asset.id === current));
    }
    return select;
  }

  /** A dropdown over entry ids from a read-only project-data table. */
  private buildReferenceSelect(source: string, current: string): HTMLSelectElement {
    const select = document.createElement("select");
    const options = this.referenceOptions.get(source) ?? [];
    select.append(buildOption("", "— none —", current === ""));
    if (current && !options.includes(current)) {
      select.append(buildOption(current, `⚠ ${current} (unknown entry)`, true));
    }
    for (const option of options) select.append(buildOption(option, option, option === current));
    return select;
  }

  /**
   * A string array of asset ids as one add/remove column of pickers: one row per
   * authored id (its blank option removes the row) plus a trailing "add" row of
   * the ids not yet used. Rendering the whole array rather than a field per index
   * is what lets a slot the file left empty be filled at all.
   */
  private renderAssetList(
    leaf: Leaf,
    meta: EditorDataTableFieldMeta | undefined,
    entryId: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "dte-field dte-field-list";
    if (meta?.hint) {
      row.title = meta.hint;
      row.classList.add("dte-field-hinted");
    }

    const name = document.createElement("span");
    name.className = "dte-field-label";
    name.textContent = leafLabel(leaf, meta);
    row.append(name);

    const list = document.createElement("div");
    list.className = "dte-list";
    const values = (leaf.container as Record<string | number, unknown>)[leaf.key];
    const items = Array.isArray(values) ? values.filter((item): item is string => typeof item === "string") : [];
    const kind = meta?.assetOptions ?? "";
    const label = meta?.label ?? "value";

    items.forEach((value, index) => {
      const select = this.buildAssetSelect(kind, value, items, "— remove —");
      select.className = "dte-field-input dte-list-input";
      select.addEventListener("change", () => this.commitListItem(leaf, index, select.value, entryId));
      list.append(select);
    });

    const remaining = this.assetOptionsFor(kind).filter((asset) => !items.includes(asset.id));
    if (remaining.length > 0) {
      const add = document.createElement("select");
      add.className = "dte-field-input dte-list-input dte-list-add";
      add.append(buildOption("", `+ ${label} ekle…`, true));
      for (const asset of remaining) add.append(buildOption(asset.id, asset.name, false));
      add.addEventListener("change", () => {
        if (add.value) this.commitListItem(leaf, items.length, add.value, entryId);
      });
      list.append(add);
    } else if (items.length === 0) {
      const empty = document.createElement("span");
      empty.className = "dte-list-empty";
      empty.textContent = "(no assets to choose from)";
      list.append(empty);
    }
    row.append(list);
    return row;
  }

  /** Write one list row back: a blank choice removes it, anything else sets/appends it. */
  private commitListItem(leaf: Leaf, index: number, value: string, entryId: string): void {
    const array = (leaf.container as Record<string | number, unknown>)[leaf.key];
    if (!Array.isArray(array)) return;
    if (value === "") array.splice(index, 1);
    else array[index] = value;
    this.markDirty();
    // The row count changed, so the whole entry is rebuilt rather than patched.
    this.replaceEntrySection(entryId);
  }

  /** Coerce the input back to the leaf's original JS type and write it into the doc. */
  private commitLeaf(leaf: Leaf, input: HTMLInputElement | HTMLSelectElement, entryId: string): void {
    const container = leaf.container as Record<string | number, unknown>;
    if (leaf.type === "boolean") {
      container[leaf.key] = (input as HTMLInputElement).checked;
    } else if (leaf.type === "number") {
      const next = Number((input as HTMLInputElement).value);
      if (!Number.isFinite(next)) {
        this.setStatus(`"${leaf.path}" must be numeric; the edit was ignored.`, "warning");
        (input as HTMLInputElement).value = String(container[leaf.key] ?? "");
        return;
      }
      container[leaf.key] = next;
    } else {
      container[leaf.key] = input.value;
    }
    this.applyDerivedFields(entryId);
    this.replaceEntrySection(entryId);
    this.markDirty();
  }

  private markDirty(): void {
    this.saveBtn.classList.add("is-dirty");
    this.setStatus("Unsaved changes.", "info");
  }

  private async save(): Promise<void> {
    // `doc` is a live reference into `fullDoc`, so edits are already merged; the
    // validator and the write both see the whole file either way.
    const message = this.options.def.validate(this.fullDoc);
    if (message !== null) {
      this.setStatus(`Invalid data — not saved: ${message}`, "error");
      return;
    }
    try {
      const result = await saveDataTable(this.options.path, this.fullDoc);
      this.saveBtn.classList.remove("is-dirty");
      this.setStatus(
        result.changed ? "Saved. Reload the game tab to see it." : "No changes.",
        "success",
      );
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private setStatus(message: string, tone: StatusTone = "info"): void {
    if (this.disposed) return;
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.options.onStatus?.(message, tone);
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (DataTableEditor.activeInstance === this) DataTableEditor.activeInstance = null;
    this.overlay.remove();
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** A `label`/`name` scalar on an entry, used as a friendly section subtitle. */
function displayLabel(entry: unknown): string {
  if (!isPlainObject(entry)) return "";
  const label = entry.label ?? entry.name;
  return typeof label === "string" ? label : "";
}

function buildOption(value: string, label: string, selected: boolean): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

/** Resolves a table's root or named object section for a reference picker. */
function optionSectionOf(
  raw: unknown,
  source: EditorDataTableOptionSource,
): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  if (source.section === undefined) return raw;
  let cursor: unknown = raw;
  for (const key of source.section.split(".")) {
    if (!isPlainObject(cursor)) return null;
    cursor = cursor[key];
  }
  return isPlainObject(cursor) ? cursor : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Injected styles (keeps the shared style.css untouched) ──────────────────

function ensureStyles(): void {
  if (document.getElementById("dte-styles")) return;
  const style = document.createElement("style");
  style.id = "dte-styles";
  style.textContent = `
.dte-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  background:rgba(10,12,16,.6);backdrop-filter:blur(2px);outline:none;}
.dte-window{display:flex;flex-direction:column;width:min(720px,92vw);height:min(80vh,900px);
  background:#1e2127;color:#dfe3ea;border:1px solid #333842;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.5);overflow:hidden;}
.dte-header{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#252932;border-bottom:1px solid #333842;}
.dte-tab{display:flex;align-items:center;gap:8px;flex:1;min-width:0;}
.dte-tab-icon{font-size:10px;font-weight:700;letter-spacing:.5px;color:#8b93a3;background:#30353f;padding:2px 6px;border-radius:4px;}
.dte-tab strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dte-badge{font-size:11px;color:#8b93a3;background:#30353f;padding:2px 8px;border-radius:10px;}
.dte-header-actions{display:flex;gap:8px;}
.dte-save,.dte-close{border:1px solid #3a4650;background:#2c313b;color:#dfe3ea;border-radius:5px;cursor:pointer;padding:5px 12px;font:inherit;}
.dte-save.is-dirty{background:#3a5bd0;border-color:#4a6bea;}
.dte-close{padding:5px 10px;line-height:1;}
.dte-save:hover,.dte-close:hover{filter:brightness(1.15);}
.dte-body{flex:1;overflow:auto;padding:10px 12px;}
.dte-category{border:1px solid #333a46;border-radius:6px;margin-bottom:6px;background:#1b1f26;}
.dte-category[open]{background:#1e222a;padding-bottom:6px;}
.dte-category-title{cursor:pointer;padding:9px 12px;font-weight:700;font-size:12px;letter-spacing:.08em;color:#c6cdda;user-select:none;list-style:none;display:flex;align-items:center;gap:8px;}
.dte-category-title::-webkit-details-marker{display:none;}
.dte-category-title::before{content:"▸";color:#7f8aa0;font-size:10px;letter-spacing:0;}
.dte-category[open]>.dte-category-title::before{content:"▾";}
.dte-category-count{margin-left:auto;flex:0 0 auto;min-width:20px;text-align:center;background:#2c313b;border:1px solid #3a4650;border-radius:9px;padding:1px 7px;font-size:11px;font-weight:600;letter-spacing:0;color:#aeb6c4;}
.dte-category-empty{margin:0 12px 8px;color:#7f8aa0;font-size:12px;font-style:italic;}
.dte-category-other>.dte-category-title{color:#ffce7a;}
.dte-category>.dte-entry{margin:6px 10px;}
.dte-entry{border:1px solid #2e333d;border-radius:6px;margin-bottom:8px;background:#22262e;}
.dte-entry-title{cursor:pointer;padding:8px 12px;font-weight:600;user-select:none;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.dte-reset{flex:0 0 auto;border:1px solid #3a4650;background:#2c313b;color:#cdd4df;border-radius:5px;cursor:pointer;padding:3px 10px;font:inherit;font-size:12px;font-weight:500;}
.dte-reset:hover{filter:brightness(1.2);border-color:#c8955a;color:#ffce7a;}
.dte-group{border:1px solid #2a2f38;border-radius:5px;margin:6px 12px;background:#1d2128;}
.dte-group[open]{background:#20242c;}
.dte-group-title{cursor:pointer;padding:6px 10px;font-weight:600;font-size:12px;color:#c6cdda;user-select:none;list-style:none;display:flex;align-items:center;gap:8px;}
.dte-group-title::-webkit-details-marker{display:none;}
.dte-group-title::before{content:"▸";color:#7f8aa0;font-size:10px;}
.dte-group[open]>.dte-group-title::before{content:"▾";}
.dte-group>.dte-grid{padding-top:2px;}
.dte-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;padding:6px 12px 12px;}
.dte-field{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;}
.dte-field-label{flex:1 1 auto;min-width:0;color:#aeb6c4;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dte-field-hinted .dte-field-label::after{content:" ⓘ";color:#7f8aa0;}
.dte-field-input:disabled{opacity:.55;cursor:not-allowed;}
.dte-field-input{flex:0 0 30%;min-width:0;background:#171a20;color:#dfe3ea;border:1px solid #333842;border-radius:4px;padding:4px 6px;font:inherit;}
.dte-field-input[type=checkbox]{flex:0 0 auto;}
.dte-field-list{grid-column:1/-1;align-items:flex-start;}
.dte-field-list .dte-field-label{padding-top:4px;white-space:normal;}
.dte-list{flex:0 0 65%;display:flex;flex-direction:column;gap:4px;min-width:0;}
.dte-list-input{flex:1 1 auto;width:100%;}
.dte-list-add{color:#9fb0c8;border-style:dashed;}
.dte-list-empty{color:#7f8aa0;font-size:12px;padding:4px 0;}
.dte-field-input:focus{outline:none;border-color:#4a6bea;}
.dte-status{padding:8px 12px;border-top:1px solid #333842;background:#252932;font-size:12px;color:#aeb6c4;}
.dte-status[data-tone=error]{color:#ff8a8a;}
.dte-status[data-tone=success]{color:#8fe0a4;}
.dte-status[data-tone=warning]{color:#ffce7a;}
`;
  document.head.append(style);
}
