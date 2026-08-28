import {
  ASSET_TYPES,
  isModelAssetType,
  type AssetType,
  type EditableAsset,
} from "@engine/assets/manifest";

export interface BrowserAssetItem {
  key: string;
  label: string;
  category: string;
  path: string;
  ext: string;
  type: AssetType | "file";
  editable?: EditableAsset;
}

export interface BrowserFolderItem {
  key: string;
  label: string;
  path: string;
  type: "folder";
  fileCount: number;
  descendantFileCount: number;
}

export type BrowserContentItem = BrowserFolderItem | BrowserAssetItem;

export interface BrowserAssetIssue {
  code:
    | "loose-file"
    | "unsupported-file"
    | "missing-placement"
    | "missing-collision-setting"
    | "not-placeable";
  label: string;
}

export const CONTENT_FILTER_ALL = "__all__";
export type ContentTypeFilter = BrowserAssetItem["type"] | typeof CONTENT_FILTER_ALL;

export interface ContentPanelOptions {
  contentList: HTMLDivElement;
  contentPathLabel: HTMLElement;
  contentItemCount: HTMLElement;
  projectLoaded: boolean;
  rootPath: string | null;
  selectedFolder: string;
  folders: readonly BrowserFolderItem[];
  assets: readonly BrowserAssetItem[];
  fileCount: number;
  missingManifestAssetCount: number;
  selectedAssetId: string | null;
  selectedContentFolderPath: string | null;
  /** File currently marked for Cut in the editor-only Content Browser clipboard. */
  cutContentPath: string | null;
  isActiveLevel: (item: BrowserAssetItem) => boolean;
  getEmptyDragImage: () => HTMLImageElement;
  setSelectedAsset: (assetId: string | null) => void;
  setSelectedContentFolder: (path: string | null) => void;
  navigateToContentFolder: (path: string) => void;
  openAssetContextMenu: (event: MouseEvent, item: BrowserAssetItem) => void;
  openContentFolderContextMenu: (event: MouseEvent, item: BrowserFolderItem) => void;
  openMeshEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openActorScriptEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openMaterialEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openSoundCueEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openParticleEffectEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openDialogueEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openBehaviorTreeEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openStateTreeEditor: (item: BrowserAssetItem) => void | Promise<void>;
  openLevel: (item: BrowserAssetItem) => void | Promise<void>;
  openUiWidgetEditor: (item: BrowserAssetItem) => void | Promise<void>;
  renderAssetThumbnail: (item: BrowserAssetItem, thumb: HTMLElement) => void | Promise<void>;
  renderMaterialThumbnail: (item: BrowserAssetItem, thumb: HTMLElement) => void | Promise<void>;
  renderTextureThumbnail: (item: BrowserAssetItem, thumb: HTMLElement) => void;
  beginAssetDragPreview: (assetId: string) => void;
  endAssetDragPreview: () => void;
  setStatus: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

export function renderContentAssetsPanel(options: ContentPanelOptions): string {
  const { contentList, contentPathLabel, contentItemCount } = options;
  if (!options.projectLoaded) {
    contentPathLabel.textContent = "Content";
    contentItemCount.textContent = "0 items";
    contentList.innerHTML = `
        <div class="empty-details">
          <strong>No assets</strong>
          <span>Project folder is not loaded.</span>
        </div>
      `;
    return "";
  }

  const items: BrowserContentItem[] = [...options.folders, ...options.assets];
  const issueCount = options.assets.filter((item) => contentAssetIssues(item).length > 0).length;

  renderContentBreadcrumbs(options);
  const listStatus = formatContentListStatus(
    items.length,
    options.folders.length,
    options.fileCount,
    issueCount,
    options.missingManifestAssetCount,
  );
  contentItemCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;

  if (items.length === 0) {
    contentList.innerHTML = `
        <div class="empty-details">
          <strong>No matching content</strong>
          <span>${escapeHtml(options.selectedFolder)}</span>
        </div>
      `;
    return listStatus;
  }

  contentList.replaceChildren(
    ...items.map((item) =>
      item.type === "folder" ? createFolderCard(options, item) : createAssetCard(options, item),
    ),
  );
  return listStatus;
}

export function renderContentFilterOptions(
  select: HTMLSelectElement,
  allItems: readonly BrowserAssetItem[],
  selected: ContentTypeFilter,
): ContentTypeFilter {
  const types: BrowserAssetItem["type"][] = [...ASSET_TYPES];
  if (allItems.some((item) => item.type === "file")) types.push("file");
  const validValues = new Set([CONTENT_FILTER_ALL, ...types]);
  const nextValue = validValues.has(selected) ? selected : CONTENT_FILTER_ALL;
  const options = [
    new Option("All types", CONTENT_FILTER_ALL),
    ...types.map((value) => new Option(formatContentTypeLabel(value), value)),
  ];
  select.replaceChildren(...options);
  select.value = nextValue;
  select.disabled = types.length === 0;
  return nextValue;
}

export function isContentTypeFilter(value: string): value is ContentTypeFilter {
  return (
    value === CONTENT_FILTER_ALL ||
    value === "staticMesh" ||
    value === "skeletalMesh" ||
    value === "texture" ||
    value === "material" ||
    value === "sound" ||
    value === "soundCue" ||
    value === "dialogueVoice" ||
    value === "dialogueLine" ||
    value === "conversation" ||
    value === "animation" ||
    value === "prefab" ||
    value === "ui" ||
    value === "level" ||
    value === "file"
  );
}

export function contentItemMatchesQuery(item: BrowserContentItem, query: string): boolean {
  if (!query) return true;
  return `${item.label} ${item.type} ${item.path}`.toLocaleLowerCase().includes(query);
}

/** True when a Content Browser item is an Actor Script class-asset (`*.actor.json`). */
export function isActorScriptItem(item: BrowserAssetItem): boolean {
  return item.path.toLowerCase().endsWith(".actor.json");
}

/** True when a Content Browser item is a level/layout asset (`*.level.json` / `*.layout.json`). */
export function isLevelItem(item: BrowserAssetItem): boolean {
  return item.type === "level";
}

/**
 * True for a UI Widget asset (`*.ui.json`). The `ui` asset type also covers
 * `*.theme.json` token files, which must NOT open in the widget editor (saving
 * would overwrite the theme with a widget tree).
 */
export function isUiWidgetItem(item: BrowserAssetItem): boolean {
  return item.type === "ui" && item.path.toLowerCase().endsWith(".ui.json");
}

function createAssetCard(options: ContentPanelOptions, item: BrowserAssetItem): HTMLElement {
  const canPlace = Boolean(item.editable?.placeable);
  const canAssignMaterial = Boolean(item.editable && item.type === "material");
  const activeLevel = options.isActiveLevel(item);
  const issues = contentAssetIssues(item);
  const issueTooltip = contentAssetIssueTooltip(issues);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "asset-card";
  card.classList.toggle("is-unregistered", !item.editable);
  card.classList.toggle("has-issues", issues.length > 0);
  card.classList.toggle("is-active-level", activeLevel);
  card.classList.toggle("is-cut", item.path === options.cutContentPath);
  card.classList.toggle(
    "is-selected",
    Boolean(item.editable && item.editable.id === options.selectedAssetId),
  );
  const canPlaceActorClass = isActorScriptItem(item);
  card.draggable = canPlace || canAssignMaterial || canPlaceActorClass;
  card.dataset.assetPath = item.path;
  if (item.editable) card.dataset.assetId = item.editable.id;
  // The card is only ~118px wide, so any longer name ends in an ellipsis. The
  // tooltip covers the whole card (not just the clipped label) so the full name
  // is readable from wherever the pointer happens to rest — and, when the card
  // carries the amber issue dot, says what the warning is without having to hit
  // the 9px dot itself.
  card.title = contentCardTooltip(item.label, issues, contentFileName(item.path));
  card.innerHTML = `
      ${
        issues.length > 0
          ? `<span class="asset-issue-dot" title="${escapeHtml(issueTooltip)}" aria-label="${escapeHtml(issueTooltip)}"></span>`
          : ""
      }
      ${
        activeLevel
          ? `<span class="asset-active-badge" title="Active level - locked against rename/delete">Active</span>`
          : ""
      }
      <span class="asset-thumb" data-asset-thumb>${escapeHtml(item.ext.toUpperCase())}</span>
      <span class="asset-meta">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="asset-type-line">${escapeHtml(formatContentTypeBadge(item.type))}</span>
      </span>
    `;
  bindAssetCard(options, card, item, issues, canPlace, canAssignMaterial, canPlaceActorClass);
  renderAssetCardThumbnail(options, card, item);
  return card;
}

function bindAssetCard(
  options: ContentPanelOptions,
  card: HTMLElement,
  item: BrowserAssetItem,
  issues: readonly BrowserAssetIssue[],
  canPlace: boolean,
  canAssignMaterial: boolean,
  canPlaceActorClass: boolean,
): void {
  card.addEventListener("dragstart", (event) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    if (canPlaceActorClass) {
      transfer.setData("application/x-forge-actor-class", item.path);
      transfer.effectAllowed = "copy";
      transfer.setDragImage(options.getEmptyDragImage(), 0, 0);
      options.setStatus(`Dragging ${item.label} - drop in the viewport to place.`);
      return;
    }
    if (!item.editable || (!canPlace && !canAssignMaterial)) return;
    if (canAssignMaterial) {
      transfer.setData("application/x-forge-material", item.editable.id);
    } else {
      transfer.setData("application/x-3dgamedev-asset", item.editable.id);
    }
    transfer.effectAllowed = "copy";
    transfer.setDragImage(options.getEmptyDragImage(), 0, 0);
    options.setSelectedAsset(item.editable.id);
    if (canPlace) options.beginAssetDragPreview(item.editable.id);
    options.setStatus(
      canAssignMaterial
        ? `Dragging ${item.editable.id} - drop on a static mesh.`
        : `Dragging ${item.editable.id} - drop in the viewport to place.`,
    );
  });
  card.addEventListener("dragend", () => {
    options.endAssetDragPreview();
  });
  card.addEventListener("click", () => {
    if (item.editable) options.setSelectedAsset(item.editable.id);
    showContentAssetDetails(options, item, issues);
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.editable) options.setSelectedAsset(item.editable.id);
    showContentAssetDetails(options, item, issues);
    options.openAssetContextMenu(event, item);
  });
  bindAssetOpeners(options, card, item);
}

function bindAssetOpeners(
  options: ContentPanelOptions,
  card: HTMLElement,
  item: BrowserAssetItem,
): void {
  const activeLevel = options.isActiveLevel(item);
  if (item.type !== "file" && isModelAssetType(item.type)) {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openMeshEditor(item);
    });
  }
  if (isActorScriptItem(item)) {
    card.classList.add("is-actor-script");
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openActorScriptEditor(item);
    });
  }
  if (item.type === "material") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openMaterialEditor(item);
    });
  }
  if (item.type === "soundCue") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openSoundCueEditor(item);
    });
  }
  if (item.type === "effect") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openParticleEffectEditor(item);
    });
  }
  if (item.type === "dialogueVoice" || item.type === "dialogueLine") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openDialogueEditor(item);
    });
  }
  if (item.type === "behaviorTree") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openBehaviorTreeEditor(item);
    });
  }
  if (item.type === "stateTree") {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openStateTreeEditor(item);
    });
  }
  if (isLevelItem(item) && !activeLevel) {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openLevel(item);
    });
  }
  if (isUiWidgetItem(item)) {
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void options.openUiWidgetEditor(item);
    });
  }
}

function renderAssetCardThumbnail(
  options: ContentPanelOptions,
  card: HTMLElement,
  item: BrowserAssetItem,
): void {
  const thumb = card.querySelector<HTMLElement>("[data-asset-thumb]");
  if (thumb && isActorScriptItem(item)) thumb.textContent = "BP";
  if (thumb && item.type !== "file" && isModelAssetType(item.type)) {
    void options.renderAssetThumbnail(item, thumb);
  } else if (thumb && item.type === "material") {
    void options.renderMaterialThumbnail(item, thumb);
  } else if (thumb && item.type === "texture") {
    options.renderTextureThumbnail(item, thumb);
  }
}

function createFolderCard(options: ContentPanelOptions, item: BrowserFolderItem): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "asset-card is-folder";
  card.classList.toggle("is-selected", item.path === options.selectedContentFolderPath);
  card.dataset.folderPath = item.path;
  card.title = contentCardTooltip(item.label, [], item.path);
  card.innerHTML = `
      <span class="asset-thumb folder-thumb" aria-hidden="true"><span class="folder-glyph"></span></span>
      <span class="asset-meta">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="asset-type-line">Folder</span>
      </span>
    `;
  card.addEventListener("click", () => {
    options.setSelectedContentFolder(item.path);
    options.setStatus(`${item.label} - Folder`);
  });
  card.addEventListener("dblclick", (event) => {
    event.preventDefault();
    options.navigateToContentFolder(item.path);
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.setSelectedContentFolder(item.path);
    options.openContentFolderContextMenu(event, item);
  });
  return card;
}

function showContentAssetDetails(
  options: ContentPanelOptions,
  item: BrowserAssetItem,
  issues: readonly BrowserAssetIssue[],
): void {
  const prefix = `${item.label} · ${formatContentTypeBadge(item.type)}`;
  options.setStatus(
    issues.length > 0 ? `${prefix} · ${contentAssetIssueTooltip(issues)}` : `${prefix} · No issues`,
    issues.length > 0 ? "warning" : "info",
  );
}

function renderContentBreadcrumbs(options: ContentPanelOptions): void {
  const { contentPathLabel, rootPath, selectedFolder } = options;
  const normalizedRoot = (rootPath ?? selectedFolder).replace(/\/+$/, "");
  const normalizedSelected = selectedFolder.replace(/\/+$/, "");
  const suffix = normalizedSelected.startsWith(`${normalizedRoot}/`)
    ? normalizedSelected.slice(normalizedRoot.length + 1).split("/").filter(Boolean)
    : [];
  contentPathLabel.replaceChildren();
  const appendCrumb = (label: string, path: string): void => {
    if (contentPathLabel.childNodes.length > 0) {
      const separator = document.createElement("span");
      separator.className = "content-breadcrumb-separator";
      separator.textContent = ">";
      contentPathLabel.append(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "content-breadcrumb";
    button.textContent = label;
    button.title = path;
    button.addEventListener("click", () => options.navigateToContentFolder(path));
    contentPathLabel.append(button);
  };
  appendCrumb("All", normalizedRoot);
  appendCrumb("Content", normalizedRoot);
  let current = normalizedRoot;
  for (const segment of suffix) {
    current = `${current}/${segment}`;
    appendCrumb(segment, current);
  }
}

/**
 * Native-tooltip text for a Content Browser card: the untruncated name, the file
 * behind it when the two differ, then one line per issue behind the amber dot.
 * Cards live inside a scrolling grid, so a CSS bubble would be clipped by the
 * grid's own overflow — the native `title` is the one tooltip that escapes it.
 */
function contentCardTooltip(
  label: string,
  issues: readonly BrowserAssetIssue[] = [],
  fileName?: string,
): string {
  const file = fileName && fileName !== label ? [fileName] : [];
  return [label, ...file, ...issues.map((issue) => `⚠ ${issue.label}`)].join("\n");
}

function contentFileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function formatContentTypeLabel(value: string): string {
  if (value === "staticMesh") return "Static Meshes";
  if (value === "skeletalMesh") return "Skeletal Meshes";
  if (value === "texture") return "Textures";
  if (value === "material") return "Materials";
  if (value === "sound") return "Sounds";
  if (value === "soundCue") return "Sound Cues";
  if (value === "dialogueVoice") return "Dialogue Voices";
  if (value === "dialogueLine") return "Dialogue Lines";
  if (value === "conversation") return "Conversations";
  if (value === "animation") return "Animations";
  if (value === "prefab") return "Prefabs";
  if (value === "level") return "Levels";
  if (value === "file") return "Files";
  return formatAssetTypeFallbackLabel(value);
}

function formatContentTypeBadge(value: BrowserAssetItem["type"]): string {
  if (value === "staticMesh") return "Static Mesh";
  if (value === "skeletalMesh") return "Skeletal Mesh";
  if (value === "texture") return "Texture";
  if (value === "material") return "Material";
  if (value === "sound") return "Sound";
  if (value === "soundCue") return "Sound Cue";
  if (value === "dialogueVoice") return "Dialogue Voice";
  if (value === "dialogueLine") return "Dialogue Line";
  if (value === "conversation") return "Conversation";
  if (value === "animation") return "Animation";
  if (value === "prefab") return "Prefab";
  if (value === "ui") return "UI Widget";
  if (value === "level") return "Level";
  return "File";
}

function contentAssetIssues(item: BrowserAssetItem): BrowserAssetIssue[] {
  const issues: BrowserAssetIssue[] = [];
  if (!item.editable) {
    issues.push({
      code: "loose-file",
      label: "File exists but is not registered in the manifest",
    });
    if (item.type === "file") {
      issues.push({ code: "unsupported-file", label: "Unsupported file type" });
    }
    return issues;
  }

  if (!item.editable.placement) {
    issues.push({ code: "missing-placement", label: "Missing placement rule" });
  }
  if (typeof item.editable.runtime?.collision !== "boolean") {
    issues.push({ code: "missing-collision-setting", label: "No collision setting" });
  }
  if (item.type !== "file" && isModelAssetType(item.type) && !item.editable.placeable) {
    issues.push({ code: "not-placeable", label: "Not placeable" });
  }
  if (item.type === "file") {
    issues.push({ code: "unsupported-file", label: "Unsupported file type" });
  }
  return issues;
}

function contentAssetIssueTooltip(issues: readonly BrowserAssetIssue[]): string {
  return issues.map((issue) => issue.label).join("; ");
}

function formatContentListStatus(
  shownCount: number,
  folderCount: number,
  fileCount: number,
  issueCount: number,
  missingManifestAssetCount: number,
): string {
  const parts = [`${shownCount} shown / ${folderCount} folders / ${fileCount} files`];
  if (issueCount > 0) parts.push(`${issueCount} with issues`);
  if (missingManifestAssetCount > 0) {
    parts.push(`${missingManifestAssetCount} manifest asset file missing`);
  }
  return parts.join(" · ");
}

function formatAssetTypeFallbackLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
