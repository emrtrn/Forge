/**
 * Bounded number parameters across every editor surface.
 *
 * A parameter-row number input (Details `.detail-row` and the asset editors'
 * rows, {@link PARAM_ROW_SELECTOR}) that declares both `min` and `max` gains a
 * visible range under its label and a slider beside it. The number input stays
 * the row's first control, so its label, data attributes and the panel's own
 * change listeners are untouched; the slider only writes into it. Any number
 * input with `min`/`max` is clamped before panel listeners read it, with a
 * warning naming the range.
 *
 * Optional attributes on the number input:
 * - `data-slider-min` / `data-slider-max`: narrower slider span for a wide hard
 *   range (typing still reaches the hard limits).
 * - `data-param-slider="off"`: keep the plain input.
 */

const ENHANCED = "paramEnhanced";
/** Name + control rows: Details panels, Material, Particle/Vehicle and UI Widget editors. */
export const PARAM_ROW_SELECTOR = ".detail-row, .me-row, .pfx-row, .uie-field";
const PARAM_INPUT_SELECTOR = PARAM_ROW_SELECTOR.split(", ").map((row) => `${row} > input[type="number"]`).join(", ");

function bound(input: HTMLInputElement, name: "min" | "max"): number | null {
  const raw = input.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Shortest form of a limit, in the locale the number box itself displays
 * (`0.05`, or `0,05` in Turkish), so the range and the value read alike. */
export function formatParamLimit(value: number): string {
  return Number(value.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 6, useGrouping: false });
}

function rowLabel(input: HTMLInputElement): string {
  const span = input.closest(PARAM_ROW_SELECTOR)?.querySelector(":scope > span");
  const text = span?.firstChild?.nodeType === Node.TEXT_NODE ? span.firstChild.textContent : span?.textContent;
  return (text ?? input.getAttribute("aria-label") ?? "").trim() || "Value";
}

/** Clamp to the input's own limits; returns the applied value or null when unchanged. */
export function clampParamInput(input: HTMLInputElement): number | null {
  if (input.value.trim() === "") return null;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return null;
  const min = bound(input, "min"), max = bound(input, "max");
  const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
  if (clamped === value) return null;
  input.value = String(clamped); // value attribute syntax is locale-free
  return clamped;
}

function enhance(input: HTMLInputElement): void {
  if (input.dataset[ENHANCED] || input.dataset.paramSlider === "off") return;
  const row = input.parentElement;
  if (!row?.matches(PARAM_ROW_SELECTOR)) return;
  const min = bound(input, "min"), max = bound(input, "max");
  if (min === null || max === null || !(max > min)) return;
  input.dataset[ENHANCED] = "true";

  const span = row.querySelector(":scope > span");
  if (span && !span.querySelector(".param-range")) {
    const range = document.createElement("small");
    range.className = "param-range";
    range.textContent = `${formatParamLimit(min)} – ${formatParamLimit(max)}`;
    span.append(range);
  }

  const sliderMin = Math.max(min, Number(input.dataset.sliderMin ?? min));
  const sliderMax = Math.min(max, Number(input.dataset.sliderMax ?? max));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "param-slider";
  slider.min = String(sliderMin);
  slider.max = String(sliderMax);
  const step = Number(input.step);
  slider.step = Number.isFinite(step) && step > 0 ? input.step : String((sliderMax - sliderMin) / 200);
  slider.value = input.value;
  slider.disabled = input.disabled;
  slider.tabIndex = -1; // The number input stays the keyboard target.
  slider.setAttribute("aria-hidden", "true");
  if (input.title) slider.title = input.title;

  const control = document.createElement("span");
  control.className = "param-control";
  input.replaceWith(control);
  control.append(input, slider); // Number first: the label still targets it.
}

function enhanceWithin(root: ParentNode): void {
  if (root instanceof HTMLInputElement) { if (root.type === "number") enhance(root); return; }
  root.querySelectorAll<HTMLInputElement>(PARAM_INPUT_SELECTOR).forEach(enhance);
}

function sliderOf(input: HTMLInputElement): HTMLInputElement | null {
  return input.parentElement?.classList.contains("param-control")
    ? input.parentElement.querySelector<HTMLInputElement>(".param-slider") : null;
}

/** Installed once by EditorUi. `warn` shows a clamp message to the user. */
export function installParamFields(root: HTMLElement, warn: (message: string) => void): () => void {
  enhanceWithin(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element) enhanceWithin(node);
    }
    // Panels toggle `disabled` without re-rendering (lock, quality tiers).
    for (const record of records) if (record.type === "attributes" && record.target instanceof HTMLInputElement) {
      const slider = sliderOf(record.target);
      if (slider) slider.disabled = record.target.disabled;
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

  const onSlide = (event: Event) => {
    const slider = event.target;
    if (!(slider instanceof HTMLInputElement) || !slider.classList.contains("param-slider")) return;
    const input = slider.parentElement?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) return;
    event.stopPropagation(); // Panels listen to the number input, never the slider.
    input.value = slider.value;
    if (event.type === "change") input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // Capture phase: runs before any panel listener reads the value.
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "number") return;
    const applied = clampParamInput(input);
    if (applied !== null) {
      const min = bound(input, "min"), max = bound(input, "max");
      const range = min !== null && max !== null ? `${formatParamLimit(min)} – ${formatParamLimit(max)} aralığında`
        : min !== null ? `en az ${formatParamLimit(min)}` : `en fazla ${formatParamLimit(max!)}`;
      warn(`${rowLabel(input)} ${range} olmalı; ${formatParamLimit(applied)} uygulandı.`);
    }
    const slider = sliderOf(input);
    if (slider) slider.value = input.value;
  };
  root.addEventListener("input", onSlide, true);
  root.addEventListener("change", onSlide, true);
  root.addEventListener("change", onChange, true);
  return () => {
    observer.disconnect();
    root.removeEventListener("input", onSlide, true);
    root.removeEventListener("change", onSlide, true);
    root.removeEventListener("change", onChange, true);
  };
}
