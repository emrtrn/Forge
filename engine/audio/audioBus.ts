/**
 * Audio Bus Lite — the pure, headless data model for Forge's mix buses.
 *
 * A bus is just a named gain stage. The runtime topology (built lazily in
 * `audioSubsystem.ts` once a Web Audio context exists) is:
 *
 *   destination ← master ← { music, sfx, ui, ambience, voice, notifications }
 *
 * Every play routes its gain into one bus; non-master buses feed `master`, so a
 * play's effective level is `playGain × busVolume × masterVolume`. A *mix
 * snapshot* is a partial set of target bus volumes (e.g. a pause/menu duck that
 * lowers music + ambience while leaving `ui` alone).
 *
 * This module owns no Web Audio objects so it can be unit-tested on node and
 * imported by pure consumers (e.g. `soundCueTypes.ts`) without pulling in the
 * audio runtime.
 */

/**
 * The mix buses, in routing order under `master`.
 *
 * A bus exists when something has to be turned down *independently of everything
 * else* — that is the only thing a gain stage buys, and an unused one is not
 * free: every id here widens the `*.soundcue.json` schema, the save validator's
 * allowlist, and the cue editor's bus picker.
 *
 * `voice` and `notifications` are separate from `sfx` because ducking names
 * them: a critical notice pulls music down, a spoken line pulls nearby action
 * down, and an accessibility pass owes a slider to each. Categories that nothing
 * ducks against each other share `sfx` until something does.
 */
export const AUDIO_BUS_IDS = [
  "master",
  "music",
  "sfx",
  "ui",
  "ambience",
  "voice",
  "notifications",
] as const;
export type AudioBusId = (typeof AUDIO_BUS_IDS)[number];

/** Plays with no explicit bus route straight to `master`. */
export const DEFAULT_AUDIO_BUS: AudioBusId = "master";

/** A partial set of bus → target-volume overrides applied as one mix change. */
export type BusMixSnapshot = Partial<Record<AudioBusId, number>>;

/** A bus volume table: every bus mapped to its current linear gain. */
export type BusVolumes = Record<AudioBusId, number>;

export function isAudioBusId(value: unknown): value is AudioBusId {
  return typeof value === "string" && (AUDIO_BUS_IDS as readonly string[]).includes(value);
}

/** Clamps a bus volume to a finite, non-negative number; defaults to 1. */
export function normalizeBusVolume(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 1;
}

/** A fresh table with every bus at unity gain. */
export function createDefaultBusVolumes(): BusVolumes {
  const volumes = {} as BusVolumes;
  for (const id of AUDIO_BUS_IDS) volumes[id] = 1;
  return volumes;
}

/**
 * The effective gain multiplier a play on `bus` receives, accounting for the
 * bus feeding `master`. `master` is the root, so it only counts its own volume.
 */
export function effectiveBusGain(volumes: BusVolumes, bus: AudioBusId): number {
  const master = normalizeBusVolume(volumes.master);
  if (bus === "master") return master;
  return normalizeBusVolume(volumes[bus]) * master;
}

/**
 * Returns a new volume table with the snapshot's overrides applied (normalized).
 * Buses absent from the snapshot keep their current value. Pure — the live
 * subsystem mirrors this onto its GainNodes.
 */
export function mergeMixSnapshot(volumes: BusVolumes, snapshot: BusMixSnapshot): BusVolumes {
  const next: BusVolumes = { ...volumes };
  for (const id of AUDIO_BUS_IDS) {
    const override = snapshot[id];
    if (override !== undefined) next[id] = normalizeBusVolume(override);
  }
  return next;
}

/**
 * A duck: what one moment does to the mix *while it lasts*.
 *
 * Shaped like a {@link BusMixSnapshot} and read as a **multiplier**, not as a
 * level — `music: 0.6` means "six tenths of whatever the mix currently intends",
 * never "0.6". The distinction is the whole reason ducks are named apart from
 * snapshots even though the shape is shared: a project that authors a quiet mix
 * (an ambience bed at 0.22, music at 0.18) and then applied these as absolute
 * volumes would *raise* both — the duck would be the loudest thing about them.
 *
 * A bus absent from a duck is untouched, which is how a duck says "this one is
 * the point".
 */
export type BusDuckMix = BusMixSnapshot;

/**
 * Duck for a paused/menu state: pull music + ambience well down and trim sfx and
 * voice, but leave `ui` and `notifications` (and `master`) alone so menu clicks
 * stay crisp and an alert raised while paused still reaches the player.
 *
 * The deepest duck a game normally has, because it is the only one the player
 * *asked* for: they opened a menu. Ducks that ride under live play must not be
 * heard as the mix breathing. Apply on pause, restore with
 * {@link createDefaultBusVolumes} (or a stored snapshot) on resume.
 */
export const MENU_DUCK_MIX: BusDuckMix = {
  music: 0.25,
  ambience: 0.3,
  sfx: 0.5,
  voice: 0.5,
};

/**
 * The strongest duck per bus across everything currently ducking.
 *
 * Minimum rather than product, and that is a decision about what a duck means:
 * two ducks are two reasons for one bus to be quieter, not a reason for it to be
 * twice as quiet. A critical notice raised while a character speaks would
 * otherwise multiply to 0.56 on `sfx` — deeper than either moment asked for, and
 * audible as a lurch whichever one ends first. Minimum is also order-independent,
 * so the mix does not depend on which duck the frame happened to see first.
 */
export function mergeDucks(ducks: readonly BusDuckMix[]): BusDuckMix {
  const merged: BusDuckMix = {};
  for (const duck of ducks) {
    for (const id of AUDIO_BUS_IDS) {
      const value = duck[id];
      if (value === undefined) continue;
      const next = normalizeBusVolume(value);
      const current = merged[id];
      if (current === undefined || next < current) merged[id] = next;
    }
  }
  return merged;
}

/** One bus's duck multiplier — 1 when nothing is ducking it. */
export function duckGain(duck: BusDuckMix, bus: AudioBusId): number {
  const value = duck[bus];
  return value === undefined ? 1 : normalizeBusVolume(value);
}

/**
 * Whether two ducks would leave the mix in the same place.
 *
 * By effect, not by shape: an absent bus and a bus at 1 are the same silence,
 * and a host that reconciles its ducks every frame must be able to say "nothing
 * changed" without pushing a ramp onto every gain sixty times a second.
 */
export function ducksEqual(a: BusDuckMix, b: BusDuckMix): boolean {
  return AUDIO_BUS_IDS.every((bus) => duckGain(a, bus) === duckGain(b, bus));
}
