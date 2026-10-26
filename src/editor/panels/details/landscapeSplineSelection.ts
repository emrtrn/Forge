/** Inspector-only selection; spline data keeps its stable point and segment IDs. */
interface ItemSelection {
  ids: Set<string>;
  anchor: string | null;
  active: string | null;
}
interface SplineSelection {
  context: string;
  points: ItemSelection;
  segments: ItemSelection;
}
const selections = new WeakMap<HTMLElement, SplineSelection>();
const empty = (): ItemSelection => ({ ids: new Set(), anchor: null, active: null });

export function landscapeSplineSelection(body: HTMLElement, context: string) {
  let state = selections.get(body);
  if (!state || state.context !== context) {
    state = { context, points: empty(), segments: empty() };
    selections.set(body, state);
  }
  return state;
}

export function syncSplineSelection(state: ItemSelection, ids: string[], active: string | null): void {
  const resolved = active && ids.includes(active) ? active : ids.at(-1) ?? null;
  state.ids = new Set([...state.ids].filter((id) => ids.includes(id)));
  // A viewport pick or a different spline must replace an old inspector selection.
  if (resolved !== state.active || !state.ids.size) {
    state.ids = new Set(resolved ? [resolved] : []);
    state.anchor = resolved;
  }
  if (!state.anchor || !ids.includes(state.anchor)) state.anchor = resolved;
  state.active = resolved;
}

export function clickSplineSelection(state: ItemSelection, ids: string[], id: string, event: MouseEvent): string {
  if (event.shiftKey && state.anchor && ids.includes(state.anchor)) {
    const a = ids.indexOf(state.anchor), b = ids.indexOf(id);
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    state.ids = new Set(event.ctrlKey || event.metaKey ? [...state.ids, ...range] : range);
  } else if (event.ctrlKey || event.metaKey) {
    if (state.ids.has(id) && state.ids.size > 1) state.ids.delete(id);
    else state.ids.add(id);
    state.anchor = id;
  } else {
    state.ids = new Set([id]);
    state.anchor = id;
  }
  state.active = state.ids.has(id) ? id : [...state.ids].at(-1)!;
  return state.active;
}

/** Show mixed values without writing a representative item's value to its peers. */
export function showMixedSplineValues(body: HTMLElement, selector: string, read: (input: HTMLInputElement | HTMLSelectElement) => unknown[]): void {
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector).forEach((input) => {
    const values = read(input);
    if (values.length < 2 || values.every((value) => value === values[0])) return;
    input.title = "Seçili öğelerin değerleri farklı. Yeni değer tüm seçili öğelere uygulanır.";
    if (input instanceof HTMLInputElement && input.type === "checkbox") input.indeterminate = true;
    else {
      input.value = "";
      if (input instanceof HTMLInputElement) input.placeholder = "Mixed";
      else {
        const option = new Option("Mixed", "", true, true);
        option.disabled = true;
        input.prepend(option);
      }
    }
  });
}
