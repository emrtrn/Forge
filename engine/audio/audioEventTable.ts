/**
 * Audio event table — the data-driven layer between "something happened in the
 * game" and "a clip is playing".
 *
 * Gameplay code names an *event* (`combat.sword_swing`), never a file. What that
 * event sounds like, how loud, how often it may repeat, how many of it may be
 * audible at once and how far it carries all live in
 * the project's own audio event table (`public/game-data/audio/events.json` by
 * convention), which is tuning data in exactly the way a balance table is: it
 * gets retuned by ear, so this module pins its *shape* and never its values.
 *
 * Two pieces:
 *
 * - {@link normalizeAudioEventTable} — the single source of field shape, used by
 *   both the runtime loader and the tests. Unknown fields are dropped and bad
 *   ones throw with the field's name, so a mistyped table fails loudly at load
 *   rather than as a sound that never plays.
 * - {@link AudioEventDirector} — decides whether a trigger becomes a play. It
 *   owns the repeat control the design asks for (per-event cooldown, per-event
 *   instance cap, distance cull, and a global concurrency budget) and nothing
 *   else. It holds no Web Audio objects: playback is an injected callback, so
 *   the rules are testable on node without a context.
 *
 * The division of labour with Sound Cues (`soundCueTypes.ts`) is deliberate: a
 * cue describes what one sound *is* (layers, randomisation, modulation), this
 * table describes *when and how often* it is heard. A cue cannot know how many
 * times it has played; this cannot layer.
 */

import {
  AUDIO_BUS_IDS,
  DEFAULT_AUDIO_BUS,
  isAudioBusId,
  normalizeBusVolume,
  type AudioBusId,
  type BusMixSnapshot,
} from "./audioBus";
import type { AudioPlaybackHandle, AudioPlayOptions, AudioVec3 } from "./audioSubsystem";
import {
  DEFAULT_MUSIC_PLAYLIST_SETTINGS,
  type MusicPlaylistSettings,
} from "./musicDirector";

/** Table schema version; bumped when a field's meaning changes, not when one is added. */
export const AUDIO_EVENT_TABLE_SCHEMA = 1;

/**
 * One event's fully-resolved definition. Every field is present after
 * normalization — an absent JSON field becomes its documented default here, so
 * consumers never re-implement a fallback and the defaults have one home.
 */
export interface AudioEventDefinition {
  /**
   * Variant clip ids, in no particular order; one is chosen per trigger.
   *
   * Manifest `sound` asset ids, never file names or URLs — an id resolves only
   * when the project actually ships that asset, which is the same rule the VFX
   * assets follow and the reason a table can never reach an arbitrary file.
   */
  readonly clips: readonly string[];
  /** Mix bus this event routes through. */
  readonly bus: AudioBusId;
  /** Base linear gain before variation. */
  readonly volume: number;
  /**
   * Per-trigger pitch jitter as a ± ratio (0.04 = ±4%). Zero for voice lines and
   * music, where a wandering pitch reads as a broken tape rather than variety.
   */
  readonly pitchVariation: number;
  /** Shortest gap between two plays of this event, in milliseconds. */
  readonly cooldownMs: number;
  /** How many plays of this event may be audible simultaneously. */
  readonly maxInstances: number;
  /** Whether the play is positioned in the world (needs a `position`). */
  readonly spatial: boolean;
  /** Loops until stopped — ambience beds and fire loops. */
  readonly loop: boolean;
  /**
   * Stream the clip instead of decoding it into memory.
   *
   * For beds only — music and ambience, the sounds measured in minutes. A
   * decoded two-minute stereo track costs about 44 MiB of RAM for the life of
   * the tab, and the cache never evicts, so a playlist of twenty is most of a
   * gigabyte. A one-shot should never set this: a stream starts when the
   * element is ready rather than on a scheduled sample, which is the wrong
   * trade for a sword hit and the right one for a track nobody can hear start.
   */
  readonly stream: boolean;
  /** Distance at which attenuation begins (spatial only). */
  readonly refDistance: number;
  /**
   * Distance past which the event is not played at all (spatial only).
   *
   * Both an attenuation parameter and a cull: a sound whose source is off past
   * the far edge of the map is not quiet, it is a decode and a panner nobody
   * hears. The cheapest guard in the chain and the only one with no cost.
   */
  readonly maxDistance: number;
  /** Attenuation rolloff factor; higher is quieter sooner. */
  readonly rolloff: number;
}

/** The parsed `events.json`. */
export interface AudioEventTable {
  readonly schema: typeof AUDIO_EVENT_TABLE_SCHEMA;
  /**
   * Starting gain per mix bus — the game's priority order, stated once.
   *
   * This is the layer the design's mix hierarchy belongs on. Without it the
   * hierarchy has to be re-expressed in every event's `volume`, which means a
   * continuous bed and a one-shot click are compared by hand, over and over,
   * and the ordering exists only as an average of the numbers nobody can see at
   * the same time. On the bus it is one table: an event's `volume` then means
   * "loud *for its channel*", which is the only thing an author can judge.
   *
   * Buses absent here keep unity gain.
   */
  readonly buses: BusMixSnapshot;
  readonly events: Readonly<Record<string, AudioEventDefinition>>;
  /**
   * How the music bed moves between the tracks of its playlist.
   *
   * Here rather than on the music event, because it is not a property of a
   * sound: `crossfadeSeconds` describes the *seam* between two plays, and an
   * event definition has no seams — it describes one play. The playlist itself
   * is still an ordinary event (`clips`, `bus`, `volume`), read by whoever owns
   * the bed; this block is only the timing that joins its entries.
   */
  readonly music: MusicPlaylistSettings;
}

/**
 * Field defaults. A table entry that names only `clips` is legal and gets a
 * plain, centred, uncapped-distance one-shot on `master` — deliberately
 * unremarkable, so an entry that matters says so explicitly.
 */
const DEFAULTS = {
  bus: DEFAULT_AUDIO_BUS,
  volume: 1,
  pitchVariation: 0,
  cooldownMs: 0,
  maxInstances: 4,
  spatial: false,
  loop: false,
  stream: false,
  refDistance: 8,
  maxDistance: 60,
  rolloff: 1,
} as const;

/** An empty table — the shape the runtime falls back to when loading fails. */
export const EMPTY_AUDIO_EVENT_TABLE: AudioEventTable = {
  schema: AUDIO_EVENT_TABLE_SCHEMA,
  buses: {},
  events: {},
  music: DEFAULT_MUSIC_PLAYLIST_SETTINGS,
};

function readNumber(
  input: Record<string, unknown>,
  key: string,
  where: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = input[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`${where}.${key} must be a finite number`);
  }
  if (raw < min || raw > max) {
    throw new Error(`${where}.${key} must be within [${min}, ${max}] (got ${raw})`);
  }
  return raw;
}

function readBoolean(
  input: Record<string, unknown>,
  key: string,
  where: string,
  fallback: boolean,
): boolean {
  const raw = input[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") throw new Error(`${where}.${key} must be a boolean`);
  return raw;
}

/** Parses and defaults one event entry; throws with the event's own path on error. */
export function normalizeAudioEventDefinition(value: unknown, where: string): AudioEventDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  const input = value as Record<string, unknown>;

  const clips = input.clips;
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error(`${where}.clips must be a non-empty array of manifest sound ids`);
  }
  const clipIds = clips.map((clip, index) => {
    if (typeof clip !== "string" || clip.trim().length === 0) {
      throw new Error(`${where}.clips[${index}] must be a non-empty string`);
    }
    return clip.trim();
  });

  const busRaw = input.bus;
  if (busRaw !== undefined && !isAudioBusId(busRaw)) {
    throw new Error(`${where}.bus "${String(busRaw)}" is not a valid audio bus id`);
  }
  const bus = (busRaw as AudioBusId | undefined) ?? DEFAULTS.bus;

  const refDistance = readNumber(input, "refDistance", where, DEFAULTS.refDistance, 0.01, 1000);
  const maxDistance = readNumber(input, "maxDistance", where, DEFAULTS.maxDistance, 0.02, 10000);
  if (maxDistance <= refDistance) {
    // An inverted pair makes the panner silent or NaN, which reads in-game as
    // "this event was never wired" — the one failure mode worth refusing early.
    throw new Error(
      `${where}.maxDistance (${maxDistance}) must be greater than refDistance (${refDistance})`,
    );
  }

  return {
    clips: clipIds,
    bus,
    volume: readNumber(input, "volume", where, DEFAULTS.volume, 0, 10),
    pitchVariation: readNumber(input, "pitchVariation", where, DEFAULTS.pitchVariation, 0, 0.5),
    cooldownMs: readNumber(input, "cooldownMs", where, DEFAULTS.cooldownMs, 0, 600000),
    maxInstances: Math.round(readNumber(input, "maxInstances", where, DEFAULTS.maxInstances, 1, 64)),
    spatial: readBoolean(input, "spatial", where, DEFAULTS.spatial),
    loop: readBoolean(input, "loop", where, DEFAULTS.loop),
    stream: readBoolean(input, "stream", where, DEFAULTS.stream),
    refDistance,
    maxDistance,
    rolloff: readNumber(input, "rolloff", where, DEFAULTS.rolloff, 0, 10),
  };
}

/**
 * Parses the optional `music` block — the bed's transition timing.
 *
 * Absent is legal and common: a project with one music track has no seam to
 * describe, and the defaults then hold a track for its own length and fade for
 * six seconds. Out-of-range is refused rather than clamped, because every one of
 * these numbers is silent when wrong — a negative gap and a zero crossfade both
 * produce "the music changed abruptly", with nothing to say why.
 */
export function normalizeMusicPlaylistSettings(
  value: unknown,
  where = "music",
): MusicPlaylistSettings {
  if (value === undefined) return DEFAULT_MUSIC_PLAYLIST_SETTINGS;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const crossfadeSeconds = readNumber(
    input,
    "crossfadeSeconds",
    where,
    DEFAULT_MUSIC_PLAYLIST_SETTINGS.crossfadeSeconds,
    0,
    60,
  );
  const gapSeconds = readNumber(
    input,
    "gapSeconds",
    where,
    DEFAULT_MUSIC_PLAYLIST_SETTINGS.gapSeconds,
    0,
    120,
  );
  // Floored well above a fade rather than at zero: the fallback is a hold, and a
  // hold shorter than the transition it ends with is a bed that is never not
  // transitioning.
  const segmentSeconds = readNumber(
    input,
    "segmentSeconds",
    where,
    DEFAULT_MUSIC_PLAYLIST_SETTINGS.segmentSeconds,
    5,
    3600,
  );
  return { crossfadeSeconds, gapSeconds, segmentSeconds };
}

/** Parses a whole `events.json`. The single source of the table's field shape. */
export function normalizeAudioEventTable(value: unknown): AudioEventTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Audio event table must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.schema !== AUDIO_EVENT_TABLE_SCHEMA) {
    throw new Error(`Audio event table schema must be ${AUDIO_EVENT_TABLE_SCHEMA}`);
  }
  const buses: BusMixSnapshot = {};
  if (input.buses !== undefined) {
    if (!input.buses || typeof input.buses !== "object" || Array.isArray(input.buses)) {
      throw new Error("Audio event table `buses` must be an object");
    }
    const busesRaw = input.buses as Record<string, unknown>;
    for (const key of Object.keys(busesRaw)) {
      // Named rather than ignored: a typo here is silent by nature — the bus
      // keeps unity gain and the mix is simply wrong, with nothing to say why.
      if (!isAudioBusId(key)) throw new Error(`buses."${key}" is not a valid audio bus id`);
    }
    for (const id of AUDIO_BUS_IDS) {
      const raw = busesRaw[id];
      if (raw === undefined) continue;
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 4) {
        throw new Error(`buses.${id} must be a number within [0, 4]`);
      }
      buses[id] = normalizeBusVolume(raw);
    }
  }

  const eventsRaw = input.events;
  if (!eventsRaw || typeof eventsRaw !== "object" || Array.isArray(eventsRaw)) {
    throw new Error("Audio event table `events` must be an object");
  }
  const events: Record<string, AudioEventDefinition> = {};
  for (const [eventId, definition] of Object.entries(eventsRaw as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(eventId)) {
      throw new Error(
        `Audio event id "${eventId}" must be lower-case dotted snake_case (e.g. combat.sword_swing)`,
      );
    }
    events[eventId] = normalizeAudioEventDefinition(definition, `events.${eventId}`);
  }
  return {
    schema: AUDIO_EVENT_TABLE_SCHEMA,
    buses,
    events,
    music: normalizeMusicPlaylistSettings(input.music),
  };
}

/** Every clip id any event names — for warming, and for coverage checks. */
export function audioEventClipIds(table: AudioEventTable): string[] {
  const ids = new Set<string>();
  for (const definition of Object.values(table.events)) {
    for (const clip of definition.clips) ids.add(clip);
  }
  return [...ids];
}

/**
 * What the shared voice budget has cost so far — see
 * {@link AudioEventDirector.budgetStats}.
 */
export interface AudioBudgetStats {
  /** Plays sounding right now. */
  readonly active: number;
  /** The most that were ever sounding at once, since the last reset. */
  readonly peak: number;
  /** The ceiling those are measured against. */
  readonly limit: number;
  /** Triggers refused because the shared budget was full — the ceiling biting. */
  readonly budgetRefusals: number;
  /** Triggers refused by one event's own `maxInstances` — by design, usually. */
  readonly eventRefusals: number;
  /** Per channel, busiest first — a voice budget is judged per channel, not in total. */
  readonly byBus: ReadonlyArray<{
    readonly bus: AudioBusId;
    readonly active: number;
    readonly peak: number;
  }>;
}

/** Where a trigger happens, and how far it is from the listener. */
export interface AudioEventTriggerContext {
  /** Emitter world position. Required for a spatial event to be positioned. */
  readonly position?: AudioVec3;
  /**
   * Distance from the listener, for the cull.
   *
   * `undefined` means the caller does not know where the listener is (a headless
   * harness, or a UI event with no place on the map). Treated as "near", which
   * keeps such a caller on the behaviour it would have had before culling
   * existed — the same convention the VFX notify budget uses.
   */
  readonly distance?: number;
}

/** Why a trigger produced no sound. Returned so tests can assert intent. */
export type AudioEventTriggerResult =
  | "played"
  | "unknown-event"
  | "too-far"
  | "cooldown"
  | "event-full"
  | "budget-full"
  | "no-clip";

export interface AudioEventDirectorOptions {
  /**
   * Starts a clip and returns a handle, or null when the clip could not be
   * resolved (an id the project does not ship). Injected so this module owns no
   * Web Audio objects.
   */
  readonly play: (clipId: string, options: AudioPlayOptions) => AudioPlaybackHandle | null;
  /** Injectable for deterministic tests. Defaults to `Math.random`. */
  readonly random?: () => number;
  /**
   * Ceiling on simultaneous plays across every event.
   *
   * Per-event caps do not bound anything on their own — forty events each
   * politely under their own limit is still forty voices — and what is being
   * protected is one shared decode/mixing budget.
   */
  readonly maxConcurrent?: number;
  /** Called once per unknown event id, so a mistyped name is reported but not spammed. */
  readonly onUnknownEvent?: (eventId: string) => void;
}

const DEFAULT_MAX_CONCURRENT = 24;

/**
 * Turns game events into plays, subject to the table's repeat rules.
 *
 * Stateful only in the ways it must be: when each event last fired, and which
 * plays are still sounding. A dropped trigger is invisible to everything else by
 * construction — nothing reads back what the director decided, so a sound the
 * budget refused can never change the simulation.
 */
export class AudioEventDirector {
  private table: AudioEventTable;
  private readonly options: AudioEventDirectorOptions;
  private readonly random: () => number;
  private readonly maxConcurrent: number;
  /** Monotonic real-seconds reading at each event's last accepted trigger. */
  private readonly lastPlayedAt = new Map<string, number>();
  /** Live handles per event id; pruned in {@link advance}. */
  private readonly live = new Map<string, AudioPlaybackHandle[]>();
  private liveCount = 0;
  private readonly reportedUnknown = new Set<string>();
  /**
   * What the voice budget actually cost, as opposed to what it was set to.
   *
   * A voice budget starts as a guess and is settled by measurement, because it
   * cannot be settled by listening: a player hears a mix that is too busy, not a
   * budget that is being hit, and the two are different findings with opposite
   * fixes (retune the levels, or raise the ceiling). These counters are what
   * makes the second one visible.
   *
   * Peaks rather than instantaneous counts, because the moment worth knowing
   * about — a crowd of emitters firing while an alert posts over them — lasts a
   * few frames and nobody is reading a debug panel at that instant.
   */
  private peakLive = 0;
  private readonly peakLiveByBus = new Map<AudioBusId, number>();
  /** Refusals that mean a ceiling was reached, split by which ceiling it was. */
  private budgetRefusals = 0;
  private eventRefusals = 0;

  constructor(table: AudioEventTable, options: AudioEventDirectorOptions) {
    this.table = table;
    this.options = options;
    this.random = options.random ?? Math.random;
    this.maxConcurrent = Math.max(1, Math.round(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
  }

  /** Swaps the table in — used once the async load resolves after play starts. */
  setTable(table: AudioEventTable): void {
    this.table = table;
  }

  /** The definition behind an event id, or null. Read-only; for debug surfaces. */
  definition(eventId: string): AudioEventDefinition | null {
    return this.table.events[eventId] ?? null;
  }

  /** Plays currently sounding, across all events. For the debug panel and tests. */
  activeCount(): number {
    return this.liveCount;
  }

  /**
   * What the budget has actually been asked for — the ceiling's verification, as
   * data rather than as an impression.
   *
   * Read by the debug panel; costs nothing when nothing reads it, because the
   * numbers are accumulated in {@link advance}, which already walks the live
   * list once a frame for its own reasons.
   */
  budgetStats(): AudioBudgetStats {
    const byBus: Array<{ bus: AudioBusId; active: number; peak: number }> = [];
    const active = this.liveCountByBus();
    for (const [bus, peak] of this.peakLiveByBus) {
      byBus.push({ bus, active: active.get(bus) ?? 0, peak });
    }
    byBus.sort((a, b) => b.peak - a.peak);
    return {
      active: this.liveCount,
      peak: this.peakLive,
      limit: this.maxConcurrent,
      budgetRefusals: this.budgetRefusals,
      eventRefusals: this.eventRefusals,
      byBus,
    };
  }

  /** Live plays per bus, walked from the live map (bounded by the budget). */
  private liveCountByBus(): Map<AudioBusId, number> {
    const counts = new Map<AudioBusId, number>();
    for (const [eventId, handles] of this.live) {
      if (handles.length === 0) continue;
      const bus = this.table.events[eventId]?.bus;
      if (!bus) continue;
      counts.set(bus, (counts.get(bus) ?? 0) + handles.length);
    }
    return counts;
  }

  /**
   * Whether any play of one event is still sounding.
   *
   * The one thing a caller is allowed to read back about a play, and it exists
   * for ducking: a duck has to be *released* when the sound that asked for it
   * ends, and the host has no other way to learn that — `trigger` returns a
   * verdict, not a handle, precisely so a refused sound can never change the
   * simulation. This keeps that guarantee (a caller still cannot reach the
   * handle, stop it, or read its clip) while making the end of a sound
   * observable.
   *
   * Accurate to the last {@link advance}, which the host calls once a frame —
   * so a duck outlives its sound by at most one frame.
   */
  isPlaying(eventId: string): boolean {
    return (this.live.get(eventId)?.length ?? 0) > 0;
  }

  /**
   * Drops handles whose clip has finished, freeing both the per-event cap and
   * the global budget. Call once per rendered frame; cheap, since the list it
   * walks is bounded by {@link maxConcurrent}.
   */
  advance(): void {
    for (const [eventId, handles] of this.live) {
      let write = 0;
      for (let read = 0; read < handles.length; read += 1) {
        const handle = handles[read]!;
        if (handle.stopped) continue;
        handles[write++] = handle;
      }
      const dropped = handles.length - write;
      if (dropped > 0) {
        handles.length = write;
        this.liveCount -= dropped;
      }
      if (handles.length === 0) this.live.delete(eventId);
    }
    // Sampled after the prune, so a peak is a count of plays that were all
    // genuinely sounding in the same frame rather than a sum with finished ones
    // still in it.
    if (this.liveCount > this.peakLive) this.peakLive = this.liveCount;
    for (const [bus, count] of this.liveCountByBus()) {
      if (count > (this.peakLiveByBus.get(bus) ?? 0)) this.peakLiveByBus.set(bus, count);
    }
  }

  /**
   * Fire an event.
   *
   * `clockSeconds` is a monotonic real-time reading — real, not simulation, so a
   * cooldown means the same number of seconds to the player's ear at any game
   * speed.
   */
  trigger(
    eventId: string,
    clockSeconds: number,
    context: AudioEventTriggerContext = {},
  ): AudioEventTriggerResult {
    const definition = this.table.events[eventId];
    if (!definition) {
      if (!this.reportedUnknown.has(eventId)) {
        this.reportedUnknown.add(eventId);
        this.options.onUnknownEvent?.(eventId);
      }
      return "unknown-event";
    }

    // Cheapest test first: a sound past its own range costs nothing to refuse.
    if (
      definition.spatial &&
      context.distance !== undefined &&
      context.distance > definition.maxDistance
    ) {
      return "too-far";
    }

    if (definition.cooldownMs > 0) {
      const last = this.lastPlayedAt.get(eventId);
      if (last !== undefined && (clockSeconds - last) * 1000 < definition.cooldownMs) {
        return "cooldown";
      }
    }

    const handles = this.live.get(eventId);
    if (handles && handles.length >= definition.maxInstances) {
      this.eventRefusals += 1;
      return "event-full";
    }
    if (this.liveCount >= this.maxConcurrent) {
      this.budgetRefusals += 1;
      return "budget-full";
    }

    const clipId = definition.clips[Math.min(
      definition.clips.length - 1,
      Math.floor(this.random() * definition.clips.length),
    )]!;
    const handle = this.options.play(clipId, this.playOptions(definition, context));
    if (!handle) return "no-clip";

    this.lastPlayedAt.set(eventId, clockSeconds);
    if (handles) handles.push(handle);
    else this.live.set(eventId, [handle]);
    this.liveCount += 1;
    return "played";
  }

  /** Stops every live play of one event — for loops (ambience beds, fires). */
  stop(eventId: string, fadeSeconds = 0): void {
    const handles = this.live.get(eventId);
    if (!handles) return;
    for (const handle of handles) handle.stop(fadeSeconds);
    this.liveCount -= handles.length;
    this.live.delete(eventId);
  }

  /** Stops everything and forgets all cooldowns — level teardown / restart. */
  reset(): void {
    for (const handles of this.live.values()) {
      for (const handle of handles) handle.stop();
    }
    this.live.clear();
    this.liveCount = 0;
    this.lastPlayedAt.clear();
    // The measurement belongs to one session, like the cooldowns: a peak carried
    // into the next one would report a moment that no longer happened.
    this.peakLive = 0;
    this.peakLiveByBus.clear();
    this.budgetRefusals = 0;
    this.eventRefusals = 0;
  }

  /** Builds the engine play options for one trigger, applying the pitch jitter. */
  private playOptions(
    definition: AudioEventDefinition,
    context: AudioEventTriggerContext,
  ): AudioPlayOptions {
    const options: AudioPlayOptions = {
      volume: definition.volume,
      bus: definition.bus,
      pitch: jitterPitch(definition.pitchVariation, this.random),
      ...(definition.loop ? { loop: true } : {}),
      ...(definition.stream ? { stream: true } : {}),
    };
    if (!definition.spatial || !context.position) return options;
    return {
      ...options,
      spatial: true,
      position: context.position,
      refDistance: definition.refDistance,
      maxDistance: definition.maxDistance,
      rolloff: definition.rolloff,
    };
  }
}

/**
 * A pitch multiplier within ±`variation`. Pure and exported so a test can assert
 * the bounds without standing up a director.
 */
export function jitterPitch(variation: number, random: () => number): number {
  if (!(variation > 0)) return 1;
  return 1 + (random() * 2 - 1) * variation;
}
