/**
 * Slotless user settings persistence.
 *
 * SaveGame stores per-slot game progress. UserSettings is a separate, single
 * document for player preferences that should survive across slots: audio mix
 * bus volumes, locale and future accessibility options.
 */
import {
  AUDIO_BUS_IDS,
  normalizeBusVolume,
  type AudioBusId,
  type BusMixSnapshot,
} from "../audio/audioBus";
import {
  defaultGraphicsPreferences,
  normalizeGraphicsPreferences,
  type GraphicsPreferences,
} from "../perf/qualityProfiles";
import type { PersistenceLogger, StorageAdapter } from "./saveGameStore";

export interface UserSettings {
  readonly audio: {
    readonly busVolumes: BusMixSnapshot;
  };
  readonly locale: string | null;
  /** Player graphics preferences (chosen profile, adaptive toggle, FPS target). */
  readonly graphics: GraphicsPreferences;
}

export interface UserSettingsEnvelope {
  readonly schema: 1;
  readonly updatedAt: string;
  readonly payload: UserSettings;
}

export interface UserSettingsStoreOptions {
  readonly storage: StorageAdapter;
  readonly key?: string;
  readonly now?: () => string;
  readonly logger?: PersistenceLogger;
}

const DEFAULT_KEY = "forge.userSettings";
const DEFAULT_LOGGER: PersistenceLogger = {
  warn(message, details) {
    if (details === undefined) console.warn(message);
    else console.warn(message, details);
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultUserSettings(): UserSettings {
  return { audio: { busVolumes: {} }, locale: null, graphics: defaultGraphicsPreferences() };
}

export function normalizeUserSettings(value: unknown): UserSettings {
  if (!isPlainObject(value)) return defaultUserSettings();
  const busVolumes: BusMixSnapshot = {};
  const audio = isPlainObject(value.audio) ? value.audio : {};
  const rawVolumes = isPlainObject(audio.busVolumes) ? audio.busVolumes : {};
  for (const id of AUDIO_BUS_IDS) {
    const raw = rawVolumes[id];
    if (typeof raw === "number" && Number.isFinite(raw)) busVolumes[id] = normalizeBusVolume(raw);
  }
  const locale = typeof value.locale === "string" && value.locale.length > 0 ? value.locale : null;
  // `graphics` was added after the audio/locale fields; a record written before it
  // (or a corrupt one) normalizes to the default preferences — no schema bump, so
  // existing audio/locale records keep loading (same forward-compatible pattern).
  const graphics = normalizeGraphicsPreferences(value.graphics);
  return { audio: { busVolumes }, locale, graphics };
}

function parseEnvelope(raw: string): UserSettingsEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return null;
    if (parsed.schema !== 1) return null;
    if (typeof parsed.updatedAt !== "string" || Number.isNaN(Date.parse(parsed.updatedAt))) {
      return null;
    }
    return {
      schema: 1,
      updatedAt: parsed.updatedAt,
      payload: normalizeUserSettings(parsed.payload),
    };
  } catch {
    return null;
  }
}

export class UserSettingsStore {
  private readonly storage: StorageAdapter;
  private readonly key: string;
  private readonly now: () => string;
  private readonly logger: PersistenceLogger;

  constructor(options: UserSettingsStoreOptions) {
    this.storage = options.storage;
    this.key = options.key ?? DEFAULT_KEY;
    this.now = options.now ?? (() => new Date().toISOString());
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  read(): UserSettings {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (error) {
      this.logger.warn("User settings read failed.", { error });
      return defaultUserSettings();
    }
    if (raw === null) return defaultUserSettings();
    const envelope = parseEnvelope(raw);
    if (!envelope) {
      this.logger.warn("User settings data is corrupt or incompatible.");
      return defaultUserSettings();
    }
    return envelope.payload;
  }

  write(settings: UserSettings): boolean {
    const envelope: UserSettingsEnvelope = {
      schema: 1,
      updatedAt: this.now(),
      payload: normalizeUserSettings(settings),
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(envelope));
      return true;
    } catch (error) {
      this.logger.warn("User settings write failed.", { error });
      return false;
    }
  }

  update(patch: Partial<UserSettings>): boolean {
    const current = this.read();
    return this.write({
      audio: patch.audio ?? current.audio,
      locale: patch.locale !== undefined ? patch.locale : current.locale,
      graphics: patch.graphics ?? current.graphics,
    });
  }

  setLocale(locale: string | null): boolean {
    return this.update({ locale });
  }

  /** Persists the player's graphics preferences (chosen profile, adaptive, FPS). */
  setGraphics(graphics: GraphicsPreferences): boolean {
    return this.update({ graphics });
  }

  setAudioBusVolume(bus: AudioBusId, volume: number): boolean {
    const current = this.read();
    return this.update({
      audio: {
        busVolumes: {
          ...current.audio.busVolumes,
          [bus]: normalizeBusVolume(volume),
        },
      },
    });
  }

  /**
   * Write several bus volumes as one change.
   *
   * Not just a convenience: a volume panel moves on every pointer `input` event,
   * and doing that one bus at a time would be a read-modify-write per bus per
   * frame of a drag. Unlisted buses keep their stored value.
   */
  setAudioBusVolumes(volumes: BusMixSnapshot): boolean {
    const current = this.read();
    const busVolumes: BusMixSnapshot = { ...current.audio.busVolumes };
    for (const id of AUDIO_BUS_IDS) {
      const value = volumes[id];
      if (value !== undefined) busVolumes[id] = normalizeBusVolume(value);
    }
    return this.update({ audio: { busVolumes } });
  }

  storageKey(): string {
    return this.key;
  }
}
