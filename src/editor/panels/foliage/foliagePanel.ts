import { WIND_SWAY_DEFAULTS, WIND_SWAY_LIMITS, type WindSwaySettings } from "@engine/environment/wind";
import {
  FOLIAGE_FAR_RANGES,
  LANDSCAPE_FOLIAGE_RULE_BAND_DEFAULTS as BAND_DEFAULTS,
  LANDSCAPE_FOLIAGE_RULE_RANGES as BAND_RANGES,
  type FoliageResourceUsage,
  type ForgeFoliageTypeDef,
  type LandscapeFoliageRule,
} from "@engine/scene/foliage";
import type {
  FoliageTargetFilters,
  FoliageTool,
  FoliageToolSettings,
  FoliageTypeView,
  LandscapeFoliageLandscapeView,
  LandscapeFoliageRuleView,
} from "@/scene/SceneApp";

/** A pickable asset row (id + display name) for the type dropdowns. */
export interface FoliageAssetOption {
  id: string;
  name: string;
}

export interface FoliagePanelOptions {
  body: HTMLElement;
  settings: FoliageToolSettings;
  types: FoliageTypeView[];
  landscapeOptions: LandscapeFoliageLandscapeView[];
  landscapeRules: LandscapeFoliageRuleView[];
  /** Number of foliage instances currently selected (Select/Lasso). */
  selectionCount: number;
  /** Per-type instance / triangle / draw-call cost of the level's foliage. */
  resourceUsage: FoliageResourceUsage;
  /** `foliageType` assets in the project not yet added to the active list. */
  availableTypeAssets: FoliageAssetOption[];
  /** Static-mesh assets, for the "new foliage type from mesh" flow. */
  staticMeshAssets: FoliageAssetOption[];
  /** Resolved def of the active type (Type Details editor), or null when none. */
  activeType: ForgeFoliageTypeDef | null;
  apply(patch: Partial<FoliageToolSettings>): void;
  setActiveType(id: string): void;
  addType(assetId: string): void;
  removeType(assetId: string): void;
  createType(name: string, meshAssetId: string): void;
  /** Persists a field edit to the active Foliage Type asset. */
  updateType(patch: Partial<ForgeFoliageTypeDef>): void;
  /** Re-rolls scale/rotation of existing instances from current type settings. */
  reapply(): void;
  deselectAll(): void;
  selectInvalid(): void;
  reattachSelected(): void;
  removeSelected(): void;
  addLandscapeRule(rule: Omit<LandscapeFoliageRule, "id">): void;
  updateLandscapeRule(id: string, patch: Partial<Omit<LandscapeFoliageRule, "id">>): void;
  removeLandscapeRule(id: string): void;
}

const TOOLS: { id: FoliageTool; label: string; tip: string }[] = [
  { id: "select", label: "Select", tip: "Seçmek için bir örneğe tıklayın (Shift/Ctrl seçimi değiştirir)" },
  { id: "lasso", label: "Lasso", tip: "Örnekleri seçmek için fırçayı üzerlerinde sürükleyin (Ctrl/Alt çıkarır)" },
  { id: "paint", label: "Paint", tip: "Etkin foliage türünü serpmek için sürükleyin; Shift+sürükleme fırça altındaki tüm türleri siler" },
  { id: "erase", label: "Erase", tip: "Fırça altındaki TÜM foliage türlerini silmek için sürükleyin" },
  { id: "single", label: "Single", tip: "TEK bir örnek yerleştirmek için sol tıklayın (sürüklemeden)" },
  { id: "fill", label: "Fill", tip: "Bir yüzeye tıklayarak tüm alanını etkin türle doldurun" },
  { id: "remove", label: "Remove", tip: "Fırça altındaki YALNIZCA etkin türü silmek için sürükleyin" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compact integer formatting: 1500 → "1.5k", 2_400_000 → "2.4M". */
function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

function numField(label: string, attr: string, value: number, step = "0.1", min?: string): string {
  return `
    <label class="detail-row">
      <span>${label}</span>
      <input type="number" step="${step}"${min !== undefined ? ` min="${min}"` : ""} value="${value}" ${attr} />
    </label>`;
}

function optField(label: string, attr: string, value: number | undefined): string {
  return `
    <label class="detail-row">
      <span>${label}</span>
      <input type="number" step="0.5" placeholder="none" value="${
        value === undefined ? "" : value
      }" ${attr} />
    </label>`;
}

function boolField(label: string, attr: string, value: boolean): string {
  return `
    <label class="detail-row detail-toggle">
      <span>${label}</span>
      <input type="checkbox" ${value ? "checked" : ""} ${attr} />
    </label>`;
}

function scaleRow(label: string, attr: string, vec: readonly number[]): string {
  return `
    <label class="detail-row foliage-scale-row">
      <span>${label}</span>
      <input type="number" step="0.05" min="0.001" value="${vec[0]}" ${attr} />
    </label>`;
}

/** Wind Sway toggle and, while on, its response rows (limits from the engine normalizer). */
function renderSwayFields(type: ForgeFoliageTypeDef): string {
  const sway = type.sway;
  const row = (key: keyof WindSwaySettings, label: string, step: number, title: string): string => {
    const [min, max] = WIND_SWAY_LIMITS[key];
    return `
    <label class="detail-row" title="${title}">
      <span>${label}</span>
      <input type="number" data-foliage-type-sway="${key}" min="${min}" max="${max}" step="${step}" value="${sway?.[key] ?? WIND_SWAY_DEFAULTS[key]}" />
    </label>`;
  };
  return `
      <label class="detail-row detail-toggle" title="Rüzgârda salınım (yalnızca görsel; gölge de salınır)">
        <span>Wind Sway</span>
        <input type="checkbox" ${sway ? "checked" : ""} data-foliage-type-sway-enabled />
      </label>${sway ? `
      ${row("amplitude", "Sway Amplitude", 0.01, "Rüzgâr gücü 1 iken tepenin metre cinsinden kayması")}
      ${row("height", "Sway Height", 0.05, "Salınımın tam güce ulaştığı, pivotun üstündeki yükseklik (metre, ölçek 1); taban sabit kalır")}
      ${row("frequency", "Sway Frequency", 0.05, "Titreşim sıklığı (Hz)")}` : ""}`;
}

/** Far billboards and terrain tint: past Cull End, for Landscape rule foliage only. */
function renderFarFields(type: ForgeFoliageTypeDef): string {
  const { farDistance, farTint } = FOLIAGE_FAR_RANGES;
  const note = type.cullEnd > 0
    ? `Cull End ${type.cullEnd} m. Far Distance bundan büyük olunca billboard'lar açılır.`
    : "Cull End 0 iken (Advanced) uzak billboard ve zemin tonu çalışmaz.";
  return `
      <div class="detail-subsection-title">Far</div>
      <label class="detail-row" title="Cull End'den bu mesafeye kadar aynı bitkiler kameraya dönük billboard olarak çizilir (m). 0 kapalı. Yalnız Landscape kurallarıyla üretilen foliage için.">
        <span>Far Distance</span>
        <input type="number" data-foliage-type-num="farDistance" min="${farDistance.min}" max="${farDistance.max}" step="50" data-slider-max="8000" value="${type.farDistance ?? 0}" />
      </label>
      <label class="detail-row" title="Uzakta, bu türün bitkileri olan zemini bitkinin rengine doğru koyulaştırır; ormanlar uzak tepelerde koyu leke olarak okunur. 0 kapalı.">
        <span>Far Tint</span>
        <input type="number" data-foliage-type-num="farTint" min="${farTint.min}" max="${farTint.max}" step="0.05" value="${type.farTint ?? 0}" />
      </label>
      <div class="detail-hint">${escapeHtml(note)}</div>`;
}

// Persisted across the panel's frequent innerHTML re-renders (a native <details>
// would otherwise collapse every time an edit re-renders the panel).
let foliageAdvancedOpen = false;

function renderTypeDetails(
  type: ForgeFoliageTypeDef | null,
  meshAssets: FoliageAssetOption[],
  selectionCount: number,
): string {
  if (!type) {
    return `
    <div class="detail-section">
      <div class="detail-section-title">Type Details</div>
      <div class="detail-hint">Yerleşim kurallarını düzenlemek için bir foliage türü seçin.</div>
    </div>`;
  }
  const meshOptions = meshAssets
    .map(
      (asset) =>
        `<option value="${escapeHtml(asset.id)}" ${
          asset.id === type.meshAssetId ? "selected" : ""
        }>${escapeHtml(asset.name)}</option>`,
    )
    .join("");
  return `
    <div class="detail-section">
      <div class="detail-section-title">Type Details</div>
      <label class="detail-row">
        <span>Mesh</span>
        <select data-foliage-type-mesh>${
          meshOptions || `<option value="${escapeHtml(type.meshAssetId)}">(current)</option>`
        }</select>
      </label>
      ${numField("Radius", "data-foliage-type-num=\"radius\"", type.radius, "0.05", "0.001")}
      ${numField("Density", "data-foliage-type-num=\"density\"", type.density, "0.1", "0")}
      ${scaleRow("Scale Min", "data-foliage-type-scale-min", type.scaleMin)}
      ${scaleRow("Scale Max", "data-foliage-type-scale-max", type.scaleMax)}
      ${boolField("Random Yaw", "data-foliage-type-bool=\"randomYaw\"", type.randomYaw)}
      ${boolField("Align to Normal", "data-foliage-type-bool=\"alignToNormal\"", type.alignToNormal)}
      ${boolField("Cast Shadow", "data-foliage-type-bool=\"castShadow\"", type.castShadow)}
      ${boolField("Receive Shadow", "data-foliage-type-bool=\"receiveShadow\"", type.receiveShadow)}
      ${boolField("Collision", "data-foliage-type-bool=\"collision\"", type.collision)}
      ${renderSwayFields(type)}
      ${renderFarFields(type)}
      <details class="foliage-advanced" ${foliageAdvancedOpen ? "open" : ""}>
        <summary>Advanced — placement filters</summary>
        ${numField("Z Offset Min", "data-foliage-type-num=\"zOffsetMin\"", type.zOffsetMin, "0.05")}
        ${numField("Z Offset Max", "data-foliage-type-num=\"zOffsetMax\"", type.zOffsetMax, "0.05")}
        ${numField("Slope Min°", "data-foliage-type-num=\"slopeMin\"", type.slopeMin, "1", "0")}
        ${numField("Slope Max°", "data-foliage-type-num=\"slopeMax\"", type.slopeMax, "1", "0")}
        ${optField("Height Min", "data-foliage-type-opt=\"heightMin\"", type.heightMin)}
        ${optField("Height Max", "data-foliage-type-opt=\"heightMax\"", type.heightMax)}
        ${numField("Cull Start", "data-foliage-type-num=\"cullStart\"", type.cullStart, "1", "0")}
        ${numField("Cull End", "data-foliage-type-num=\"cullEnd\"", type.cullEnd, "1", "0")}
      </details>
      <div class="detail-hint">Ölçek/dönüş değişiklikleri yeni boyamaya uygulanır.</div>
      <button type="button" class="foliage-reapply" data-foliage-reapply title="Mevcut örneklerin ölçek ve dönüşünü güncel tür ayarlarından yeniden üret (konum korunur)">
        ${selectionCount > 0 ? `Reapply to Selection (${selectionCount})` : "Reapply to Type"}
      </button>
    </div>`;
}

function renderResourceUsage(usage: FoliageResourceUsage): string {
  const typeRows =
    usage.types.length === 0
      ? `<div class="detail-hint">Henüz foliage boyanmadı.</div>`
      : usage.types
          .map(
            (type) => `
        <div class="foliage-usage-row" title="${escapeHtml(type.name)}: ${type.instances} instances, ${
          type.triangles
        } triangles, ${type.drawCalls} draw call${type.drawCalls === 1 ? "" : "s"}">
          <span class="foliage-usage-name">${escapeHtml(type.name)}</span>
          <span class="foliage-usage-stat">${formatCount(type.instances)}</span>
          <span class="foliage-usage-stat">${formatCount(type.triangles)}</span>
          <span class="foliage-usage-stat">${formatCount(type.drawCalls)}</span>
        </div>`,
          )
          .join("");
  return `
    <div class="detail-section">
      <div class="detail-section-title">Resource Usage</div>
      <div class="foliage-usage-row foliage-usage-head">
        <span class="foliage-usage-name">Type</span>
        <span class="foliage-usage-stat">Inst</span>
        <span class="foliage-usage-stat">Tris</span>
        <span class="foliage-usage-stat">Draws</span>
      </div>
      ${typeRows}
      <div class="foliage-usage-row foliage-usage-total">
        <span class="foliage-usage-name">Total</span>
        <span class="foliage-usage-stat">${formatCount(usage.totalInstances)}</span>
        <span class="foliage-usage-stat">${formatCount(usage.totalTriangles)}</span>
        <span class="foliage-usage-stat">${formatCount(usage.totalDrawCalls)}</span>
      </div>
    </div>`;
}

function selectOptions(options: Array<{ id: string; name: string }>, selected: string): string {
  return options
    .map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === selected ? "selected" : ""}>${escapeHtml(option.name)}</option>`)
    .join("");
}

type RuleBandField = keyof typeof BAND_DEFAULTS | "heightMin" | "heightMax";

const bandNumber = (value: number): string => String(Number(value.toFixed(3)));

/**
 * A rule's placement bands (height / slope / noise / edge scale). Heights may be
 * left empty (no limit); the height sliders span the terrain's own ground.
 */
function renderRuleBands(rule: LandscapeFoliageRule, groundRange: [number, number] | null): string {
  const [low, high] = groundRange ?? [0, 100];
  const margin = Math.max(5, (high - low) * 0.05);
  const spanLow = Math.floor(low - margin), spanHigh = Math.ceil(high + margin);
  const falloffSpan = Math.max(10, Math.ceil((spanHigh - spanLow) / 2));
  const row = (field: RuleBandField, label: string, tip: string, range: { min: number; max: number }, step: number, extra = ""): string => {
    const value = rule[field];
    const shown = value ?? (field === "heightMin" || field === "heightMax" ? undefined : BAND_DEFAULTS[field]);
    const placeholder = field === "heightMin" || field === "heightMax" ? ' placeholder="none"' : "";
    return `<label class="detail-row" title="${escapeHtml(tip)}"><span>${label}</span><input type="number" data-rule-band="${field}" min="${range.min}" max="${range.max}" step="${step}" value="${shown === undefined ? "" : bandNumber(shown)}"${placeholder} ${extra} /></label>`;
  };
  const heightSlider = `data-slider-min="${spanLow}" data-slider-max="${spanHigh}"`;
  const ground = groundRange
    ? `Zemin ${bandNumber(groundRange[0])} – ${bandNumber(groundRange[1])} m. `
    : "";
  return `
          <div class="detail-subsection-title">Placement</div>
          ${row("heightMin", "Height Min", "Bu yüksekliğin altında foliage çıkmaz (dünya yüksekliği, m). Boş: sınır yok.", BAND_RANGES.height, 0.5, heightSlider)}
          ${row("heightMax", "Height Max", "Bu yüksekliğin üstünde foliage çıkmaz (dünya yüksekliği, m). Boş: sınır yok.", BAND_RANGES.height, 0.5, heightSlider)}
          ${row("heightFalloff", "Height Falloff", "Yükseklik sınırının dışında kaç metre boyunca seyrelerek biteceği. 0 keskin kenar verir.", BAND_RANGES.heightFalloff, 0.5, `data-slider-max="${falloffSpan}"`)}
          ${row("slopeMin", "Slope Min", "En düşük eğim (derece). 0 düz zemin, 90 dik duvar.", BAND_RANGES.slope, 1)}
          ${row("slopeMax", "Slope Max", "En yüksek eğim (derece).", BAND_RANGES.slope, 1)}
          ${row("slopeFalloff", "Slope Falloff", "Eğim aralığının dışında kaç derece boyunca seyrelerek biteceği. 0 keskin kenar verir.", BAND_RANGES.slopeFalloff, 0.5)}
          ${row("noiseAmount", "Noise Amount", "Yoğunluğu gürültüyle kırar: çayırda öbekler, ormanda açıklıklar. 0 kapalı.", BAND_RANGES.noiseAmount, 0.05)}
          ${row("noiseScale", "Noise Scale", "Öbeklerin / açıklıkların boyu (m).", BAND_RANGES.noiseScale, 1, 'data-slider-max="100"')}
          ${row("edgeScale", "Edge Scale", "Sınıra yaklaştıkça örneklerin küçüleceği ölçek (ağaç sınırında cılız ağaçlar). 1 değiştirmez. Falloff veya Noise ile işe yarar.", BAND_RANGES.edgeScale, 0.05)}
          <div class="detail-hint">${ground}Sınırlar türün kendi Slope/Height filtrelerinin üstüne uygulanır.</div>`;
}

function renderGeneratedRules(options: FoliagePanelOptions): string {
  const landscapes = options.landscapeOptions;
  const types = options.types.map((type) => ({ id: type.id, name: type.name }));
  const canAdd = landscapes.length > 0 && types.length > 0;
  const landscapeOptions = selectOptions(landscapes, landscapes[0]?.id ?? "");
  const typeOptions = selectOptions(types, types[0]?.id ?? "");
  const rows = options.landscapeRules.length === 0
    ? `<div class="detail-hint">Üretilmiş kural yok. Aşağıdan bir Landscape katman eşlemesi ekleyin.</div>`
    : options.landscapeRules.map((rule) => {
      const landscape = landscapes.find((entry) => entry.id === rule.landscapeId);
      const layers = landscape?.layers ?? [];
      const notes = [
        rule.typeCullEnd > 0
          ? `Grows within ${rule.typeCullEnd} m of the camera (the type's Cull End).`
          : "The type never culls: grows over the whole surface (512 m around the camera on large terrain). Set a Cull End.",
        ...(rule.typeCastsShadow ? ["The type casts shadows: grass shadows cost about 2.5× its rendering."] : []),
      ];
      return `
        <div class="detail-section foliage-generated-rule" data-landscape-rule="${escapeHtml(rule.id)}">
          <div class="detail-section-title">${escapeHtml(rule.landscapeName)} / ${escapeHtml(rule.layerName)}</div>
          <div class="detail-hint" data-rule-notes>${notes.map(escapeHtml).join(" ")}</div>
          <label class="detail-row"><span>Landscape</span><select data-rule-landscape>${selectOptions(landscapes, rule.landscapeId)}</select></label>
          <label class="detail-row"><span>Layer</span><select data-rule-layer>${selectOptions(layers, rule.layerId)}</select></label>
          <label class="detail-row"><span>Foliage Type</span><select data-rule-type>${selectOptions(types, rule.foliageTypeId)}</select></label>
          <label class="detail-row"><span>Density</span><input type="number" min="0" max="10" step="0.05" value="${rule.density}" data-rule-density /></label>
          <label class="detail-row"><span>Min Weight</span><input type="number" min="0" max="1" step="0.05" value="${rule.minWeight}" data-rule-min-weight /></label>
          <label class="detail-row"><span>Seed</span><input type="number" min="0" step="1" value="${rule.seed}" data-rule-seed /></label>
          ${renderRuleBands(rule, landscape?.groundRange ?? null)}
          <button type="button" class="foliage-type-remove" data-rule-remove>Remove Rule</button>
        </div>`;
    }).join("");
  const defaultLayers = landscapes[0]?.layers ?? [];
  return `
    <div class="detail-section">
      <div class="detail-section-title">Generated Foliage</div>
      <div class="detail-hint">Landscape katman ağırlıkları foliage'ı kameranın çevresindeki 32 m hücrelerde deterministik olarak üretir; mesafeyle seyrelir. Üretilen örnekler tek tek kaydedilmez.</div>
      ${rows}
      <div class="foliage-generated-add">
        <label class="detail-row"><span>Landscape</span><select data-rule-new-landscape ${canAdd ? "" : "disabled"}>${landscapeOptions}</select></label>
        <label class="detail-row"><span>Layer</span><select data-rule-new-layer ${canAdd ? "" : "disabled"}>${selectOptions(defaultLayers, defaultLayers[0]?.id ?? "")}</select></label>
        <label class="detail-row"><span>Foliage Type</span><select data-rule-new-type ${canAdd ? "" : "disabled"}>${typeOptions}</select></label>
        <button type="button" data-rule-add ${canAdd ? "" : "disabled"}>Add Generated Rule</button>
      </div>
    </div>`;
}

export function renderFoliagePanel(options: FoliagePanelOptions): void {
  options.body.innerHTML = renderHtml(options);
  bindInputs(options);
}

function renderHtml(options: FoliagePanelOptions): string {
  const { settings, types } = options;
  const toolButtons = TOOLS.map(
    (tool) =>
      `<button type="button" class="foliage-tool${
        settings.tool === tool.id ? " active" : ""
      }" data-foliage-tool="${tool.id}" title="${escapeHtml(tool.tip)}">${tool.label}</button>`,
  ).join("");

  const typeRows =
    types.length === 0
      ? `<div class="detail-hint">Henüz foliage türü yok. Aşağıdan ekleyin.</div>`
      : types
          .map(
            (type) => `
        <label class="foliage-type-row${
          settings.activeTypeId === type.id ? " active" : ""
        }">
          <input type="radio" name="foliage-active-type" value="${escapeHtml(type.id)}" ${
            settings.activeTypeId === type.id ? "checked" : ""
          } />
          <span class="foliage-type-name">${escapeHtml(type.name)}</span>
          <span class="foliage-type-count">${type.instanceCount}</span>
          <button type="button" class="foliage-type-remove" data-foliage-remove="${escapeHtml(
            type.id,
          )}" title="Türü ve örneklerini kaldır">✕</button>
        </label>`,
          )
          .join("");

  const availableOptions = options.availableTypeAssets
    .map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)}</option>`)
    .join("");
  const meshOptions = options.staticMeshAssets
    .map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)}</option>`)
    .join("");

  return `
    <div class="detail-section">
      <div class="detail-section-title">Tools</div>
      <div class="foliage-tools">${toolButtons}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Brush Options</div>
      <label class="detail-row">
        <span>Brush Size</span>
        <input type="number" min="0.1" step="0.5" value="${settings.brushSize}" data-foliage-brush-size />
      </label>
      <label class="detail-row">
        <span>Paint Density</span>
        <input type="number" min="0" max="4" step="0.1" value="${settings.paintDensity}" data-foliage-paint-density />
      </label>
      <label class="detail-row">
        <span>Erase Density</span>
        <input type="number" min="0" max="1" step="0.1" value="${settings.eraseDensity}" data-foliage-erase-density />
      </label>
      <label class="detail-row">
        <span>Random Seed</span>
        <input type="number" min="1" step="1" value="${settings.randomSeed}" data-foliage-seed />
      </label>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Filters</div>
      <label class="detail-row detail-toggle">
        <span>Landscape</span>
        <input type="checkbox" ${settings.filters.landscape ? "checked" : ""} data-foliage-filter="landscape" />
      </label>
      <label class="detail-row detail-toggle">
        <span>Static Mesh</span>
        <input type="checkbox" ${settings.filters.staticMesh ? "checked" : ""} data-foliage-filter="staticMesh" />
      </label>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Selection</div>
      <div class="detail-hint">${
        options.selectionCount > 0
          ? `${options.selectionCount} örnek seçili`
          : "Seçili örnek yok. Select veya Lasso kullanın."
      }</div>
      <div class="foliage-selection-actions">
        <button type="button" data-foliage-select-invalid title="Altında geçerli zemin olmayan örnekleri seç">Select Invalid</button>
        <button type="button" data-foliage-deselect ${
          options.selectionCount > 0 ? "" : "disabled"
        }>Deselect All</button>
        <button type="button" data-foliage-reattach ${
          options.selectionCount > 0 ? "" : "disabled"
        } title="Seçili örnekleri alttaki zemine oturt">Snap to Ground</button>
        <button type="button" class="foliage-remove-selected" data-foliage-remove-selected ${
          options.selectionCount > 0 ? "" : "disabled"
        }>Remove Selected</button>
      </div>
    </div>
    ${renderResourceUsage(options.resourceUsage)}
    ${renderGeneratedRules(options)}
    <div class="detail-section">
      <div class="detail-section-title">Foliage Types</div>
      <div class="foliage-type-list">${typeRows}</div>
      <div class="foliage-add-row">
        <select data-foliage-add-select ${availableOptions ? "" : "disabled"}>
          ${availableOptions || `<option value="">No unused types</option>`}
        </select>
        <button type="button" data-foliage-add ${availableOptions ? "" : "disabled"}>Add</button>
      </div>
    </div>
    ${renderTypeDetails(options.activeType, options.staticMeshAssets, options.selectionCount)}
    <div class="detail-section">
      <div class="detail-section-title">New Type From Mesh</div>
      <label class="detail-row">
        <span>Mesh</span>
        <select data-foliage-new-mesh>${
          meshOptions || `<option value="">No static meshes</option>`
        }</select>
      </label>
      <label class="detail-row">
        <span>Name</span>
        <input type="text" placeholder="Grass" data-foliage-new-name />
      </label>
      <button type="button" class="foliage-create" data-foliage-create ${
        meshOptions ? "" : "disabled"
      }>Create Foliage Type</button>
    </div>
  `;
}

function bindInputs(options: FoliagePanelOptions): void {
  const { body } = options;

  body.querySelectorAll<HTMLButtonElement>("[data-foliage-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      options.apply({ tool: button.dataset.foliageTool as FoliageTool });
    });
  });

  body.querySelectorAll<HTMLInputElement>('input[name="foliage-active-type"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) options.setActiveType(input.value);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-foliage-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const id = button.dataset.foliageRemove;
      if (id) options.removeType(id);
    });
  });

  const numberInput = (
    selector: string,
    key: "brushSize" | "paintDensity" | "eraseDensity" | "randomSeed",
  ): void => {
    body.querySelector<HTMLInputElement>(selector)?.addEventListener("change", (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      if (Number.isFinite(value)) options.apply({ [key]: value } as Partial<FoliageToolSettings>);
    });
  };
  numberInput("[data-foliage-brush-size]", "brushSize");
  numberInput("[data-foliage-paint-density]", "paintDensity");
  numberInput("[data-foliage-erase-density]", "eraseDensity");
  numberInput("[data-foliage-seed]", "randomSeed");

  body.querySelectorAll<HTMLInputElement>("[data-foliage-filter]").forEach((input) => {
    input.addEventListener("change", () => {
      const filters: FoliageTargetFilters = { ...options.settings.filters };
      const key = input.dataset.foliageFilter as keyof FoliageTargetFilters;
      filters[key] = input.checked;
      options.apply({ filters });
    });
  });

  body
    .querySelector<HTMLButtonElement>("[data-foliage-select-invalid]")
    ?.addEventListener("click", () => options.selectInvalid());
  body
    .querySelector<HTMLButtonElement>("[data-foliage-deselect]")
    ?.addEventListener("click", () => options.deselectAll());
  body
    .querySelector<HTMLButtonElement>("[data-foliage-reattach]")
    ?.addEventListener("click", () => options.reattachSelected());
  body
    .querySelector<HTMLButtonElement>("[data-foliage-remove-selected]")
    ?.addEventListener("click", () => options.removeSelected());

  const addSelect = body.querySelector<HTMLSelectElement>("[data-foliage-add-select]");
  body.querySelector<HTMLButtonElement>("[data-foliage-add]")?.addEventListener("click", () => {
    const id = addSelect?.value;
    if (id) options.addType(id);
  });

  body.querySelector<HTMLButtonElement>("[data-foliage-create]")?.addEventListener("click", () => {
    const mesh = body.querySelector<HTMLSelectElement>("[data-foliage-new-mesh]")?.value ?? "";
    const nameInput = body.querySelector<HTMLInputElement>("[data-foliage-new-name]");
    const name = (nameInput?.value ?? "").trim() || "Foliage Type";
    if (mesh) options.createType(name, mesh);
  });

  bindTypeDetails(options);
  bindGeneratedRules(options);
}

function bindGeneratedRules(options: FoliagePanelOptions): void {
  const { body } = options;
  const landscapes = options.landscapeOptions;
  const layersFor = (landscapeId: string): Array<{ id: string; name: string }> =>
    landscapes.find((entry) => entry.id === landscapeId)?.layers ?? [];
  const setLayerOptions = (select: HTMLSelectElement, landscapeId: string): void => {
    const layers = layersFor(landscapeId);
    select.innerHTML = selectOptions(layers, layers[0]?.id ?? "");
  };
  body.querySelectorAll<HTMLElement>("[data-landscape-rule]").forEach((row) => {
    const id = row.dataset.landscapeRule;
    if (!id) return;
    const landscape = row.querySelector<HTMLSelectElement>("[data-rule-landscape]");
    const layer = row.querySelector<HTMLSelectElement>("[data-rule-layer]");
    const type = row.querySelector<HTMLSelectElement>("[data-rule-type]");
    const density = row.querySelector<HTMLInputElement>("[data-rule-density]");
    const minWeight = row.querySelector<HTMLInputElement>("[data-rule-min-weight]");
    const seed = row.querySelector<HTMLInputElement>("[data-rule-seed]");
    landscape?.addEventListener("change", () => {
      if (layer) setLayerOptions(layer, landscape.value);
      options.updateLandscapeRule(id, { landscapeId: landscape.value, layerId: layer?.value ?? "" });
    });
    layer?.addEventListener("change", () => options.updateLandscapeRule(id, { layerId: layer.value }));
    type?.addEventListener("change", () => options.updateLandscapeRule(id, { foliageTypeId: type.value }));
    density?.addEventListener("change", () => options.updateLandscapeRule(id, { density: Number(density.value) }));
    minWeight?.addEventListener("change", () => options.updateLandscapeRule(id, { minWeight: Number(minWeight.value) }));
    seed?.addEventListener("change", () => options.updateLandscapeRule(id, { seed: Number(seed.value) }));
    row.querySelectorAll<HTMLInputElement>("[data-rule-band]").forEach((input) => {
      input.addEventListener("change", () => {
        const field = input.dataset.ruleBand as RuleBandField;
        const raw = input.value.trim();
        if (raw === "") {
          // Heights clear to "no limit"; the other fields fall back to their default.
          options.updateLandscapeRule(id, { [field]: undefined });
          return;
        }
        const value = Number(raw);
        if (Number.isFinite(value)) options.updateLandscapeRule(id, { [field]: value });
      });
    });
    row.querySelector<HTMLButtonElement>("[data-rule-remove]")?.addEventListener("click", () => options.removeLandscapeRule(id));
  });
  const newLandscape = body.querySelector<HTMLSelectElement>("[data-rule-new-landscape]");
  const newLayer = body.querySelector<HTMLSelectElement>("[data-rule-new-layer]");
  newLandscape?.addEventListener("change", () => {
    if (newLayer) setLayerOptions(newLayer, newLandscape.value);
  });
  body.querySelector<HTMLButtonElement>("[data-rule-add]")?.addEventListener("click", () => {
    const foliageTypeId = body.querySelector<HTMLSelectElement>("[data-rule-new-type]")?.value ?? "";
    if (!newLandscape?.value || !newLayer?.value || !foliageTypeId) return;
    options.addLandscapeRule({
      landscapeId: newLandscape.value,
      layerId: newLayer.value,
      foliageTypeId,
      density: 0.25,
      minWeight: 0.5,
      seed: 1,
    });
  });
}

function bindTypeDetails(options: FoliagePanelOptions): void {
  const { body, activeType } = options;
  if (!activeType) return;

  const advanced = body.querySelector<HTMLDetailsElement>(".foliage-advanced");
  advanced?.addEventListener("toggle", () => {
    foliageAdvancedOpen = advanced.open;
  });

  body
    .querySelector<HTMLButtonElement>("[data-foliage-reapply]")
    ?.addEventListener("click", () => options.reapply());

  body.querySelector<HTMLSelectElement>("[data-foliage-type-mesh]")?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    if (id) options.updateType({ meshAssetId: id });
  });

  body.querySelectorAll<HTMLInputElement>("[data-foliage-type-num]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.foliageTypeNum as keyof ForgeFoliageTypeDef;
      const value = Number(input.value);
      if (Number.isFinite(value)) options.updateType({ [key]: value } as Partial<ForgeFoliageTypeDef>);
    });
  });

  body.querySelector<HTMLInputElement>("[data-foliage-type-sway-enabled]")?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    options.updateType({ sway: checked ? { ...WIND_SWAY_DEFAULTS } : undefined } as Partial<ForgeFoliageTypeDef>);
  });
  body.querySelectorAll<HTMLInputElement>("[data-foliage-type-sway]").forEach((input) => {
    input.addEventListener("change", () => {
      const current = options.activeType?.sway;
      const value = Number(input.value);
      if (!current || !Number.isFinite(value)) return;
      options.updateType({ sway: { ...current, [input.dataset.foliageTypeSway as keyof WindSwaySettings]: value } });
    });
  });

  body.querySelectorAll<HTMLInputElement>("[data-foliage-type-bool]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.foliageTypeBool as keyof ForgeFoliageTypeDef;
      options.updateType({ [key]: input.checked } as Partial<ForgeFoliageTypeDef>);
    });
  });

  body.querySelectorAll<HTMLInputElement>("[data-foliage-type-opt]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.foliageTypeOpt as "heightMin" | "heightMax";
      const raw = input.value.trim();
      if (raw === "") {
        options.updateType({ [key]: undefined } as Partial<ForgeFoliageTypeDef>);
        return;
      }
      const value = Number(raw);
      if (Number.isFinite(value)) options.updateType({ [key]: value } as Partial<ForgeFoliageTypeDef>);
    });
  });

  const bindScale = (key: "scaleMin" | "scaleMax"): void => {
    body.querySelectorAll<HTMLInputElement>(`[data-${key === "scaleMin" ? "foliage-type-scale-min" : "foliage-type-scale-max"}]`).forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        options.updateType({ [key]: [value, value, value] } as Partial<ForgeFoliageTypeDef>);
      });
    });
  };
  bindScale("scaleMin");
  bindScale("scaleMax");
}
