/**
 * Details editing for Actor Script *instance variables* — the class-declared
 * `variables` of a `*.actor.json` as overridden per placement.
 *
 * The data path (`LayoutActorInstance.variableOverrides` ->
 * `resolveActorInstanceVariables` -> the game's level adapter) already existed
 * end to end; only this authoring surface was missing, which forced every
 * override to be hand-written into the level JSON. The widgets mirror
 * `metadataDetails.ts` so a variable looks and behaves like a metadata field,
 * with one addition: a variable that is overridden shows a reset control, since
 * "same as the class default" is a meaningfully different state from "pinned to
 * this value on this placement".
 */
import type { MetadataFieldDef } from "@engine/scene/metadataSchema";
import type { MetadataValue } from "@engine/scene/layout";
import type { ActorVariableView } from "@/scene/SceneApp";

export interface ActorVariableBindOptions {
  body: HTMLElement;
  locked: boolean;
  variables: () => readonly ActorVariableView[];
  setVariable: (key: string, value: MetadataValue | undefined) => void;
}

export function renderActorVariableSection(variables: readonly ActorVariableView[], locked: boolean): string {
  if (variables.length === 0) return "";
  return `
    <div class="detail-section">
      <div class="detail-section-title">Actor Variables <small>instance override</small></div>
      ${variables.map((variable) => renderVariable(variable, locked)).join("")}
    </div>`;
}

export function bindActorVariableInputs(options: ActorVariableBindOptions): void {
  if (options.locked) return;
  options.body
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-actor-var-key]")
    .forEach((input) => {
      input.addEventListener("change", () => commit(options, input));
    });
  options.body.querySelectorAll<HTMLButtonElement>("[data-actor-var-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.actorVarReset;
      if (key) options.setVariable(key, undefined);
    });
  });
}

function renderVariable({ field, value, overridden }: ActorVariableView, locked: boolean): string {
  const attr = `data-actor-var-key="${escapeHtml(field.key)}" data-actor-var-type="${field.type}"`;
  const disabled = locked ? "disabled" : "";
  const label = escapeHtml(field.label || field.key);
  const reset = overridden && !locked
    ? `<button type="button" class="detail-inline-button" data-actor-var-reset="${escapeHtml(field.key)}" title="Reset to class default">↺</button>`
    : "";
  const rowClass = overridden ? "detail-row actor-var-overridden" : "detail-row";

  if (field.type === "boolean") {
    const checked = value === true ? "checked" : "";
    return `<label class="detail-toggle">
        <input type="checkbox" ${attr} ${checked} ${disabled} />
        <span>${label}</span>${reset}
      </label>`;
  }

  if (field.type === "select") {
    const current = typeof value === "string" ? value : "";
    const options = (field.options ?? [])
      .map(
        (option) =>
          `<option value="${escapeHtml(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`,
      )
      .join("");
    // An unknown current value must stay visible rather than silently snapping
    // to the first option the moment the panel is drawn.
    const unknown = current && !(field.options ?? []).includes(current)
      ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`
      : "";
    return `<label class="${rowClass}">
        <span>${label}</span>
        <select ${attr} ${disabled}>${options}${unknown}</select>${reset}
      </label>`;
  }

  if (field.type === "number") {
    const min = field.min !== undefined ? `min="${field.min}"` : "";
    const max = field.max !== undefined ? `max="${field.max}"` : "";
    const step = field.step !== undefined ? `step="${field.step}"` : "";
    return `<label class="${rowClass}">
        <span>${label}</span>
        <input type="number" ${attr} ${min} ${max} ${step} ${disabled}
          value="${escapeHtml(typeof value === "number" ? String(value) : "")}" />${reset}
      </label>`;
  }

  const text =
    field.type === "tags"
      ? (Array.isArray(value) ? value : []).join(", ")
      : typeof value === "string"
        ? value
        : "";
  const placeholder = field.placeholder ?? (field.type === "tags" ? "comma, separated, tags" : "");
  return `<label class="${rowClass}">
      <span>${label}</span>
      <input type="text" ${attr} ${disabled} value="${escapeHtml(text)}"
        placeholder="${escapeHtml(placeholder)}" />${reset}
    </label>`;
}

function commit(
  options: ActorVariableBindOptions,
  input: HTMLInputElement | HTMLSelectElement,
): void {
  const key = input.dataset.actorVarKey;
  const type = input.dataset.actorVarType as MetadataFieldDef["type"] | undefined;
  if (!key || !type) return;
  const field = options.variables().find((variable) => variable.field.key === key)?.field;
  if (!field) return;

  let value: MetadataValue | undefined;
  if (type === "boolean") {
    value = (input as HTMLInputElement).checked;
  } else if (type === "number") {
    const parsed = Number(input.value);
    value = input.value.trim() === "" || Number.isNaN(parsed) ? undefined : parsed;
  } else if (type === "tags") {
    value = input.value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  } else {
    value = input.value;
  }

  // Matching the class default is stored as "no override", so a level only
  // carries the values that actually deviate from the class.
  if (value !== undefined && sameValue(value, field.default)) value = undefined;
  options.setVariable(key, value);
}

function sameValue(value: MetadataValue, other: MetadataValue | undefined): boolean {
  if (other === undefined) return false;
  if (Array.isArray(value) || Array.isArray(other)) {
    return Array.isArray(value) && Array.isArray(other)
      && value.length === other.length
      && value.every((entry, index) => entry === other[index]);
  }
  return value === other;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
