/**
 * Landscape Paint mode's Auto Paint tab: an ordered list of height/slope rules
 * and one Apply that repaints the whole terrain from them
 * (`engine/terrain/terrainAutoPaint.ts`). It is a one-shot action: the rules
 * live for the editor session only, keyed by terrain, and are not saved.
 */
import {
  TERRAIN_AUTO_PAINT_RANGES as RANGES,
  defaultTerrainAutoPaintRule,
  type TerrainAutoPaintRule,
  type TerrainAutoPaintSettings,
} from "@engine/terrain/terrainAutoPaint";
import type { LandscapeLayerView, LandscapePaintPanel, WorldTerrainDetailsView } from "@/scene/SceneApp";

interface AutoPaintState extends TerrainAutoPaintSettings {
  rules: TerrainAutoPaintRule[];
}

type NumberField = Exclude<keyof TerrainAutoPaintRule, "layerId" | "enabled">;

/** Session rules per terrain definition. */
const states = new Map<string, AutoPaintState>();

/** Height limits a typed value is clamped to; the slider spans the terrain's own ground. */
const HEIGHT_LIMIT = 10000;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const numberText = (value: number): string => String(Number(value.toFixed(3)));

/** A terrain's session state, with layer references repaired after a layer was removed. */
function stateFor(terrain: WorldTerrainDetailsView, layers: readonly LandscapeLayerView[]): AutoPaintState {
  let state = states.get(terrain.dataRef);
  if (!state) {
    state = { baseLayerId: layers[0]?.id ?? "", rules: [], seed: 1 };
    states.set(terrain.dataRef, state);
  }
  const ids = new Set(layers.map((layer) => layer.id));
  const fallback = layers[0]?.id ?? "";
  if (!ids.has(state.baseLayerId)) state.baseLayerId = fallback;
  for (const rule of state.rules) if (!ids.has(rule.layerId)) rule.layerId = fallback;
  return state;
}

/** Slider span for heights: the terrain's ground, widened a little so its edges are reachable. */
function heightSpan(terrain: WorldTerrainDetailsView): [number, number] {
  const [low, high] = terrain.groundRange;
  const margin = Math.max(5, (high - low) * 0.05);
  return [Math.floor(low - margin), Math.ceil(high + margin)];
}

export function landscapePaintPanelTabs(panel: LandscapePaintPanel): string {
  const tab = (id: LandscapePaintPanel, label: string, title: string): string =>
    `<button type="button" role="tab" data-landscape-paint-panel="${id}" class="${panel === id ? "active" : ""}" aria-selected="${panel === id}" title="${title}">${label}</button>`;
  return `<div class="landscape-tool-segment landscape-tool-segment--two" role="tablist" aria-label="Landscape paint panel">
    ${tab("brush", "Brush", "Fırçayla elle boyama.")}
    ${tab("auto", "Auto Paint", "Yüksekliğe ve eğime göre tüm terrain'i bir kerede boyar.")}
  </div>`;
}

export function landscapeAutoPaintSection(
  terrain: WorldTerrainDetailsView,
  layers: readonly LandscapeLayerView[],
  layerName: (layer: LandscapeLayerView) => string,
  lockedAttr: string,
): string {
  const state = stateFor(terrain, layers);
  const [spanLow, spanHigh] = heightSpan(terrain);
  const falloffSpan = Math.max(10, Math.ceil((spanHigh - spanLow) / 2));
  const layerOptions = (selected: string): string => layers
    .map((layer) => `<option value="${escapeHtml(layer.id)}" ${layer.id === selected ? "selected" : ""}>${escapeHtml(layerName(layer))}</option>`)
    .join("");
  const row = (i: number, field: NumberField, label: string, tip: string, min: number, max: number, step: number, slider = ""): string =>
    `<label class="detail-row" title="${escapeHtml(tip)}"><span>${label}</span><input type="number" data-auto-rule="${i}" data-auto-field="${field}" min="${min}" max="${max}" step="${step}" value="${numberText(state.rules[i]![field])}" ${slider} ${lockedAttr} /></label>`;
  const heightSlider = `data-slider-min="${spanLow}" data-slider-max="${spanHigh}"`;
  const rules = state.rules.map((rule, i) => `<div class="landscape-auto-rule" data-auto-rule-card="${i}">
      <div class="landscape-auto-rule-head">
        <label class="detail-toggle" title="Kapalı kural uygulanmaz."><input type="checkbox" data-auto-rule-enabled="${i}" ${rule.enabled ? "checked" : ""} ${lockedAttr} /><span>Rule ${i + 1}</span></label>
        <span class="landscape-auto-rule-actions">
          <button type="button" data-auto-rule-move="${i}" data-dir="-1" aria-label="Move Rule Up" title="Yukarı taşı" ${i === 0 ? "disabled" : lockedAttr}>▲</button>
          <button type="button" data-auto-rule-move="${i}" data-dir="1" aria-label="Move Rule Down" title="Aşağı taşı" ${i === state.rules.length - 1 ? "disabled" : lockedAttr}>▼</button>
          <button type="button" data-auto-rule-remove="${i}" aria-label="Remove Rule" title="Kuralı sil" ${lockedAttr}>✕</button>
        </span>
      </div>
      <label class="detail-row" title="Bu kuralın boyayacağı katman."><span>Layer</span><select data-auto-rule-layer="${i}" ${lockedAttr}>${layerOptions(rule.layerId)}</select></label>
      ${row(i, "heightMin", "Height Min", "Kuralın başladığı dünya yüksekliği (m).", -HEIGHT_LIMIT, HEIGHT_LIMIT, 0.5, heightSlider)}
      ${row(i, "heightMax", "Height Max", "Kuralın bittiği dünya yüksekliği (m).", -HEIGHT_LIMIT, HEIGHT_LIMIT, 0.5, heightSlider)}
      ${row(i, "heightFalloff", "Height Falloff", "Yükseklik aralığının dışında kaç metrede sönerek biteceği. 0 keskin kenar verir.", RANGES.heightFalloff.min, RANGES.heightFalloff.max, 0.5, `data-slider-max="${falloffSpan}"`)}
      ${row(i, "slopeMin", "Slope Min", "En düşük eğim (derece). 0 düz zemin, 90 dik duvar.", RANGES.slope.min, RANGES.slope.max, 1)}
      ${row(i, "slopeMax", "Slope Max", "En yüksek eğim (derece).", RANGES.slope.min, RANGES.slope.max, 1)}
      ${row(i, "slopeFalloff", "Slope Falloff", "Eğim aralığının dışında kaç derecede sönerek biteceği. 0 keskin kenar verir.", RANGES.slopeFalloff.min, RANGES.slopeFalloff.max, 0.5)}
      ${row(i, "noiseAmount", "Noise Amount", "Kuralın kapladığı alanı gürültüyle kırar; kenarlar düz çizgi gibi durmaz. 0 kapalı.", RANGES.noiseAmount.min, RANGES.noiseAmount.max, 0.05)}
      ${row(i, "noiseScale", "Noise Scale", "Gürültü lekelerinin boyu (m).", RANGES.noiseScale.min, RANGES.noiseScale.max, 1, 'data-slider-max="100"')}
      ${row(i, "strength", "Strength", "Kuralın tam uyduğu yerdeki boya gücü. 1 tamamen bu katman.", RANGES.strength.min, RANGES.strength.max, 0.05)}
    </div>`).join("");
  const disabled = layers.length === 0 ? "disabled" : lockedAttr;
  return `<div class="detail-subsection-title">Auto Paint</div>
    <label class="detail-row" title="Hiçbir kurala uymayan zeminin katmanı."><span>Base Layer</span><select data-auto-base-layer ${disabled}>${layerOptions(state.baseLayerId)}</select></label>
    ${rules || `<div class="detail-hint">Henüz kural yok. Add Rule seçili katmanla tüm araziyi kapsayan bir kural ekler; aralıkları daraltarak kullan.</div>`}
    <button type="button" class="detail-action-button" data-auto-rule-add ${disabled}>Add Rule</button>
    <label class="detail-row" title="Gürültü tohumu. Değiştirince aynı kurallar farklı lekeler verir."><span>Seed</span><input type="number" data-auto-seed min="0" max="2147483647" step="1" value="${state.seed}" data-param-slider="off" ${disabled} /></label>
    <div class="detail-hint">Kurallar yukarıdan aşağı uygulanır, alttaki kural üsttekinin üstüne boyar. Ground ${numberText(terrain.groundRange[0])} – ${numberText(terrain.groundRange[1])} m. Değerleri seçerken View → Height / Slope işe yarar.</div>
    <button type="button" class="detail-action-button" data-auto-apply ${disabled}>Apply Auto Paint</button>
    <div class="detail-hint">Apply tüm terrain'i kurallara göre yeniden boyar ve önceki boyamanın üstüne yazar (Ctrl+Z geri alır). Kurallar kaydedilmez.</div>`;
}

export interface AutoPaintBindOptions {
  body: HTMLElement;
  terrain: WorldTerrainDetailsView;
  layers: readonly LandscapeLayerView[];
  activeLayerId: string;
  refresh: () => void;
  apply: (settings: TerrainAutoPaintSettings) => Promise<boolean>;
}

export function bindLandscapeAutoPaint({ body, terrain, layers, activeLayerId, refresh, apply }: AutoPaintBindOptions): void {
  const state = stateFor(terrain, layers);
  const ruleAt = (element: HTMLElement, attribute: string): TerrainAutoPaintRule | undefined =>
    state.rules[Number(element.getAttribute(attribute))];
  body.querySelectorAll<HTMLInputElement>("[data-auto-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const rule = ruleAt(input, "data-auto-rule");
      const field = input.dataset.autoField as NumberField | undefined;
      const value = input.valueAsNumber;
      if (rule && field && field in rule && Number.isFinite(value)) rule[field] = value;
      else refresh();
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-auto-rule-enabled]").forEach((input) => {
    input.addEventListener("change", () => {
      const rule = ruleAt(input, "data-auto-rule-enabled");
      if (rule) rule.enabled = input.checked;
    });
  });
  body.querySelectorAll<HTMLSelectElement>("[data-auto-rule-layer]").forEach((select) => {
    select.addEventListener("change", () => {
      const rule = ruleAt(select, "data-auto-rule-layer");
      if (rule) rule.layerId = select.value;
    });
  });
  body.querySelectorAll<HTMLButtonElement>("[data-auto-rule-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const from = Number(button.dataset.autoRuleMove), to = from + Number(button.dataset.dir);
      if (!state.rules[from] || !state.rules[to]) return;
      [state.rules[from], state.rules[to]] = [state.rules[to]!, state.rules[from]!];
      refresh();
    });
  });
  body.querySelectorAll<HTMLButtonElement>("[data-auto-rule-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.rules.splice(Number(button.dataset.autoRuleRemove), 1);
      refresh();
    });
  });
  body.querySelector<HTMLButtonElement>("[data-auto-rule-add]")?.addEventListener("click", () => {
    const layer = layers.some((entry) => entry.id === activeLayerId) ? activeLayerId : state.baseLayerId;
    const [low, high] = terrain.groundRange;
    state.rules.push(defaultTerrainAutoPaintRule(layer, Math.floor(low), Math.ceil(high)));
    refresh();
  });
  body.querySelector<HTMLSelectElement>("[data-auto-base-layer]")?.addEventListener("change", (event) => {
    state.baseLayerId = (event.currentTarget as HTMLSelectElement).value;
  });
  body.querySelector<HTMLInputElement>("[data-auto-seed]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) state.seed = Math.round(value);
  });
  body.querySelector<HTMLButtonElement>("[data-auto-apply]")?.addEventListener("click", async (event) => {
    (event.currentTarget as HTMLButtonElement).disabled = true;
    await apply({ baseLayerId: state.baseLayerId, seed: state.seed, rules: state.rules.map((rule) => ({ ...rule })) });
    refresh();
  });
}
