/**
 * The reserved save-game slot set and its UI contract.
 *
 * Widget messages (`save:write|load|delete:<slot>`) and the `save.slots.*`
 * ViewModel fields are the whole surface a HUD needs to drive save/load, so the
 * slot list, the message parser and the field builder live together. Consumed by
 * the save-game capability module; a fork restyles the widget, not this shape.
 */
import type { UiFieldValue } from "../ui/uiViewModel";

export const SAVE_GAME_UI_SLOTS = [
  { slot: "quick", label: "Quick Save" },
  { slot: "slot-1", label: "Slot 1" },
  { slot: "slot-2", label: "Slot 2" },
] as const;

export type SaveGameUiSlotId = (typeof SAVE_GAME_UI_SLOTS)[number]["slot"];
export type SaveGameUiCommandKind = "write" | "load" | "delete";

export interface SaveGameUiCommand {
  readonly kind: SaveGameUiCommandKind;
  readonly slot: SaveGameUiSlotId;
}

export interface SaveGameUiSlotView {
  readonly slot: SaveGameUiSlotId;
  readonly label: string;
  readonly updatedAt: string | null;
  readonly levelPath: string | null;
}

export function isSaveGameUiSlotId(value: string): value is SaveGameUiSlotId {
  return SAVE_GAME_UI_SLOTS.some((entry) => entry.slot === value);
}

export function readSaveGameUiCommand(message: string): SaveGameUiCommand | null {
  if (!message.startsWith("save:")) return null;
  const [, kind, slot] = message.split(":");
  if (kind !== "write" && kind !== "load" && kind !== "delete") return null;
  if (!slot || !isSaveGameUiSlotId(slot)) return null;
  return { kind, slot };
}

export function emptySaveGameUiSlots(): SaveGameUiSlotView[] {
  return SAVE_GAME_UI_SLOTS.map((entry) => ({
    slot: entry.slot,
    label: entry.label,
    updatedAt: null,
    levelPath: null,
  }));
}

export function formatSaveGameTimestamp(value: string | null): string {
  if (!value) return "Empty";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Saved";
  return `Saved ${parsed.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function formatSaveGameLevel(value: string | null): string {
  if (!value) return "No saved level";
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

export function buildSaveGameUiFields(slots: readonly SaveGameUiSlotView[]): Record<string, UiFieldValue> {
  const fields: Record<string, UiFieldValue> = {};
  for (const view of slots) {
    const prefix = `save.slots.${view.slot}`;
    fields[`${prefix}.label`] = view.label;
    fields[`${prefix}.status`] = formatSaveGameTimestamp(view.updatedAt);
    fields[`${prefix}.level`] = formatSaveGameLevel(view.levelPath);
  }
  return fields;
}
