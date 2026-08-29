/**
 * The music bed: a playlist of tracks that fade into one another.
 *
 * Separate from `AudioEventDirector` on purpose, and the split is the same one
 * that separates a bed from an event. The event director's whole job is deciding
 * *whether* a trigger becomes a play — cooldowns, per-event caps, a distance
 * cull, a shared voice budget. A music bed needs none of those, and needs one
 * thing the director cannot give it: ownership of a long-lived handle, so a
 * track can be faded rather than only started and stopped. `trigger()` keeps its
 * handle private, which is right for the thousand one-shots a session fires and
 * wrong for the two that play for twenty minutes.
 *
 * What it still shares with the table is the *authoring*: the playlist is an
 * event's `clips` array and the level is its `volume`, read by the host and
 * handed in here. A fork retunes its music in `events.json` like everything
 * else; this module owns only the timing.
 *
 * Pure — no Web Audio, no Three.js, no clock of its own. The host advances it
 * with the same monotonic real-seconds reading the audio cooldowns use. Real,
 * not simulation: a crossfade at 8x speed must still take as many wall-clock
 * seconds as it does at 1x, because it is addressed to the player's ear.
 */

import type { AudioPlaybackHandle } from "./audioSubsystem";

/**
 * How one playlist moves from track to track. Tuning, not contract — numbers an
 * author changes by ear, so they live in `events.json` and nothing asserts their
 * magnitude.
 */
export interface MusicPlaylistSettings {
  /** Length of the fade, in seconds, at both ends of a transition. */
  readonly crossfadeSeconds: number;
  /**
   * Silence between the two tracks.
   *
   * Zero is a true crossfade — the tracks overlap, one rising as the other
   * falls. A positive value is the design's transition model instead: fade out,
   * a short window of nothing, fade in. One number picks between them because
   * they are the same motion with different overlap, and which one a score wants
   * is a judgement about the music rather than about the code.
   */
  readonly gapSeconds: number;
  /**
   * How long to hold a track whose real length is not known yet.
   *
   * Only ever reached before a clip has decoded, or with no audio device at all
   * (headless). Once the buffer is decoded the hand-over is scheduled from the
   * track's own duration, so the fade lands on the end of the music instead of
   * on an arbitrary count — which is what keeps a generated track from ever
   * reaching its loop seam or its tail.
   */
  readonly segmentSeconds: number;
}

export const DEFAULT_MUSIC_PLAYLIST_SETTINGS: MusicPlaylistSettings = {
  crossfadeSeconds: 6,
  gapSeconds: 0,
  segmentSeconds: 105,
};

export interface MusicDirectorOptions {
  /** The playlist, in no particular order — the bag shuffles it. */
  readonly clips: readonly string[];
  /**
   * Starts one track at the given linear gain and returns its handle.
   *
   * Always called with `0`: every track fades in, including the first. Injected
   * so this module owns no Web Audio objects and a test can drive it with a
   * recording stub.
   */
  readonly play: (clipId: string, volume: number) => AudioPlaybackHandle | null;
  /** The bed's authored gain — the level a fade-in rises to. */
  readonly volume: number;
  /**
   * A decoded clip's length in seconds, or null while it is still loading (and
   * always, headless). Polled rather than awaited: the hand-over is recomputed
   * every advance, so a duration that lands a second after the track started
   * simply corrects a schedule nothing has acted on yet.
   */
  readonly durationOf?: (clipId: string) => number | null;
  readonly settings?: MusicPlaylistSettings;
  /** Injectable for deterministic tests. Defaults to `Math.random`. */
  readonly random?: () => number;
}

/** The track currently rising or holding. */
interface MusicTrack {
  readonly clipId: string;
  readonly handle: AudioPlaybackHandle;
  /**
   * Clock reading at `play()` — the origin for both the fade-in and the hold.
   *
   * Mutable because a pause moves it: the track holds its position while the
   * bed is stopped, so its origin has to move forward by however long that was
   * or the hand-over would fire against time the music never played.
   */
  startedAt: number;
  /** Set once the fade-in has reached the authored level, so it stops writing. */
  atFullVolume: boolean;
}

/** The track on its way out, still audible under the one coming in. */
interface MusicFadeOut {
  readonly handle: AudioPlaybackHandle;
  /** Both move on a pause, for the same reason {@link MusicTrack.startedAt} does. */
  startedAt: number;
  endsAt: number;
}

/**
 * Equal-power crossfade pair for a transition `progress` in [0, 1].
 *
 * Not linear, and that is audible rather than pedantic: two uncorrelated tracks
 * faded linearly sum to about 3 dB below either one at the midpoint, so every
 * transition dips. Sine and cosine keep the squares summing to one, which is
 * what "no dip" means for signals that do not share a waveform.
 *
 * Exported so a test can assert the power law without standing up a director.
 */
export function crossfadeGains(progress: number): { incoming: number; outgoing: number } {
  const t = Math.min(1, Math.max(0, progress));
  const angle = (t * Math.PI) / 2;
  return { incoming: Math.sin(angle), outgoing: Math.cos(angle) };
}

/**
 * Plays a playlist end to end, forever, fading between tracks.
 *
 * Idempotent to start: the host arms the beds when the level starts *and* again
 * when the audio table lands, because either can happen first. A second
 * `start()` on a running bed is a no-op rather than a second playlist — the same
 * guarantee `maxInstances: 1` gives the looping ambience.
 */
export class MusicDirector {
  private readonly options: MusicDirectorOptions;
  private readonly random: () => number;
  private readonly settings: MusicPlaylistSettings;
  private running = false;
  /** The shuffle bag: tracks not yet played in this pass, in play order. */
  private bag: string[] = [];
  /** The last track begun — kept so a refilled bag never repeats it back-to-back. */
  private lastPlayed: string | null = null;
  private current: MusicTrack | null = null;
  private fadingOut: MusicFadeOut | null = null;
  /** When the next track begins; non-null only inside a transition's gap. */
  private pendingStartAt: number | null = null;
  /** Clock reading at which the bed was held, or null while it is running. */
  private pausedAt: number | null = null;
  /** The live playlist. Starts as the authored one; {@link setPlaylist} replaces it. */
  private clips: readonly string[];
  /** The live level, likewise — each state may sit at its own gain. */
  private volume: number;
  /** A multiplier on {@link volume} while something plays over the bed. See {@link setDuck}. */
  private duck = 1;
  /**
   * A playlist change waiting for a voice to free up.
   *
   * A switch wants to be heard now — the point of combat music is that it starts
   * when the combat does — but the bed is two voices and a transition already
   * under way is using both. Queued rather than forced, so the worst case is one
   * crossfade of lateness instead of a third track over the top.
   */
  private switchRequested = false;

  constructor(options: MusicDirectorOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    this.settings = options.settings ?? DEFAULT_MUSIC_PLAYLIST_SETTINGS;
    this.clips = options.clips;
    this.volume = options.volume;
  }

  /**
   * Swaps the playlist, crossfading out of whatever is sounding into the new one.
   *
   * The division of labour is that the bag still decides *which* track and the
   * caller decides *which bag*. A repeat of the
   * playlist already running is a no-op rather than a restart — the host
   * reconciles state every frame, so this is called sixty times a second with
   * the same list and must cost nothing when nothing changed.
   */
  setPlaylist(clips: readonly string[], volume: number, clockSeconds: number): void {
    const unchanged =
      clips.length === this.clips.length && clips.every((clip, i) => clip === this.clips[i]);
    if (unchanged) {
      // The level can still move under a steady playlist (a slider, a retune).
      this.applyVolume(volume);
      return;
    }
    this.clips = clips;
    this.applyVolume(volume);
    // Drop what was queued from the old list; the next pick comes from the new.
    this.bag = [];
    this.lastPlayed = null;
    if (!this.running || clips.length === 0) return;
    this.switchRequested = true;
    // Nothing is sounding (a playlist that resolved no clips, a bed between
    // tracks): start straight away rather than waiting for a hand-over that has
    // nothing to hand over from.
    if (!this.current && this.pendingStartAt === null && this.pausedAt === null) {
      this.switchRequested = false;
      this.beginTrack(clockSeconds);
    }
  }

  /** Re-points the live gains at a new authored level without restarting anything. */
  private applyVolume(volume: number): void {
    if (volume === this.volume) return;
    this.volume = volume;
    // Only a track that has finished rising is at the authored level; one still
    // fading is mid-curve and `stepFadeIn` will carry it to the new value.
    if (this.current?.atFullVolume) this.current.handle.setVolume(this.bedVolume());
  }

  /**
   * The level the bed actually plays at: its authored gain, ducked.
   *
   * Every fade target reads this rather than {@link volume}, so a duck applied
   * mid-transition is carried by the ramp already running instead of fighting
   * it — the crossfade keeps its shape and simply happens quieter.
   */
  private bedVolume(): number {
    return this.volume * this.duck;
  }

  /**
   * Pull the bed down (or let it back up) without touching the music bus.
   *
   * This exists because of one routing fact: stingers play on the `music` bus,
   * so the obvious way to clear a bed for an announcement — duck the bus —
   * ducks the announcement too. The bed's own handle is the only gain between
   * the two, so this is where a "music steps back under the fanfare" is even
   * expressible.
   *
   * `fadeSeconds` matters more here than anywhere else in this class: a stinger
   * arrives on the frame the player is told something, and a step change on the
   * bed under it is heard as a glitch rather than as room being made.
   */
  setDuck(multiplier: number, fadeSeconds = 0): void {
    const next = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;
    if (next === this.duck) return;
    this.duck = next;
    // A rising track is mid-ramp and `stepFadeIn` owns its gain; writing here
    // would jump it off its curve. The outgoing half is stepped every frame for
    // the same reason and needs nothing either.
    if (this.current?.atFullVolume) this.current.handle.setVolume(this.bedVolume(), fadeSeconds);
  }

  /** True between `start()` and `stop()`, whether or not a clip resolved. */
  get active(): boolean {
    return this.running;
  }

  /** True while two tracks are audible at once — a transition with no gap. */
  get crossfading(): boolean {
    return this.fadingOut !== null && this.current !== null;
  }

  /** The track sounding at full or rising, for the debug readout and tests. */
  nowPlaying(): string | null {
    return this.current?.clipId ?? null;
  }

  /** Begins the playlist. A no-op if it is already running. */
  start(clockSeconds: number): void {
    if (this.running) return;
    if (this.clips.length === 0) return;
    this.running = true;
    this.beginTrack(clockSeconds);
  }

  /**
   * Advances the fades and schedules the next track. Call once per rendered
   * frame with the host's real-seconds clock.
   */
  /** True while the bed is held by {@link setPaused}. */
  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /**
   * Holds the bed where it stands, or lets it go on.
   *
   * The bug this exists for: the track and the schedule that hands it over run
   * on two different clocks. The music plays on the audio device's own time,
   * which does not care whether anything is being drawn; the schedule advances
   * on a clock the host accumulates per rendered frame. Leave the tab and the
   * frames stop while the music does not, so a track can run out entirely
   * against a schedule that believes it is halfway through — and the hand-over
   * then arrives that much late, as a gap the player hears on returning.
   *
   * Holding both halves is what keeps them honest. The handles stop advancing
   * because the elements are paused; the schedule stops because every scheduled
   * moment is shifted forward by exactly the span that passed while nothing was
   * playing. Whether the host's clock ran during that span therefore does not
   * matter — a hidden tab (where it froze too, and the shift is zero) and a
   * paused game (where it kept going) both come out right.
   */
  setPaused(paused: boolean, clockSeconds: number): void {
    if (!this.running) return;
    if (paused) {
      if (this.pausedAt !== null) return;
      this.pausedAt = clockSeconds;
      this.current?.handle.setPaused(true);
      this.fadingOut?.handle.setPaused(true);
      return;
    }
    if (this.pausedAt === null) return;
    const held = Math.max(0, clockSeconds - this.pausedAt);
    this.pausedAt = null;
    if (this.current) this.current.startedAt += held;
    if (this.fadingOut) {
      this.fadingOut.startedAt += held;
      this.fadingOut.endsAt += held;
    }
    if (this.pendingStartAt !== null) this.pendingStartAt += held;
    this.current?.handle.setPaused(false);
    this.fadingOut?.handle.setPaused(false);
  }

  advance(clockSeconds: number): void {
    if (!this.running || this.pausedAt !== null) return;
    // Order matters. The outgoing track is stepped first, so a fade that
    // completes this frame frees its slot before anything reads it; the
    // hand-over is decided before the pending start is served, so a gapless
    // crossfade begins both halves in the same frame rather than one apart.
    this.stepFadeOut(clockSeconds);
    this.maybeBeginHandover(clockSeconds);
    this.maybeStartPending(clockSeconds);
    this.stepFadeIn(clockSeconds);
  }

  /** Stops the bed. Both tracks fade over `fadeSeconds`; the state is cleared. */
  stop(fadeSeconds = 0): void {
    this.current?.handle.stop(fadeSeconds);
    this.fadingOut?.handle.stop(fadeSeconds);
    this.current = null;
    this.fadingOut = null;
    this.pendingStartAt = null;
    this.pausedAt = null;
    this.running = false;
  }

  /** Rides the outgoing track down and releases it when the fade is spent. */
  private stepFadeOut(clockSeconds: number): void {
    const fade = this.fadingOut;
    if (!fade) return;
    const span = fade.endsAt - fade.startedAt;
    const progress = span > 0 ? (clockSeconds - fade.startedAt) / span : 1;
    if (progress >= 1) {
      // Stopped with no fade of its own: the ramp below already took it to
      // silence, and a second fade here would only hold a dead source open.
      fade.handle.stop(0);
      this.fadingOut = null;
      return;
    }
    fade.handle.setVolume(this.bedVolume() * crossfadeGains(progress).outgoing);
  }

  /** Rides the incoming track up, then leaves its gain alone. */
  private stepFadeIn(clockSeconds: number): void {
    const track = this.current;
    if (!track || track.atFullVolume) return;
    const fade = this.settings.crossfadeSeconds;
    const progress = fade > 0 ? (clockSeconds - track.startedAt) / fade : 1;
    if (progress >= 1) {
      track.handle.setVolume(this.bedVolume());
      track.atFullVolume = true;
      return;
    }
    track.handle.setVolume(this.bedVolume() * crossfadeGains(progress).incoming);
  }

  /**
   * The clock reading at which the current track hands over.
   *
   * Recomputed every frame rather than stored, because the length it derives
   * from arrives late: a clip that has never been played is still decoding when
   * the track starts, and `durationOf` answers null until it lands. Nothing has
   * acted on the earlier answer, so correcting it costs nothing.
   */
  private handoverAt(track: MusicTrack): number {
    const measured = this.options.durationOf?.(track.clipId) ?? null;
    const length =
      measured !== null && Number.isFinite(measured) && measured > 0
        ? measured
        : this.settings.segmentSeconds;
    const lead = this.settings.crossfadeSeconds;
    // `length - lead` puts the end of the fade on the end of the music. The
    // floor is for a clip shorter than its own fade — a stub, a bad decode —
    // where the subtraction goes negative and would otherwise hand over on the
    // frame it started, forever.
    return track.startedAt + Math.max(lead, length - lead);
  }

  /** Starts the hand-over: the current track begins falling, the next is queued. */
  private maybeBeginHandover(clockSeconds: number): void {
    const track = this.current;
    // Never while one is already under way: the bed is two voices, not three.
    if (!track || this.fadingOut || this.pendingStartAt !== null) return;
    // A queued playlist switch hands over at the first free moment instead of
    // waiting out the track. This is the state machine's whole audible effect:
    // without it, combat music would arrive whenever the exploration track
    // happened to end, which is up to two minutes after the combat started.
    if (this.switchRequested) this.switchRequested = false;
    else if (clockSeconds < this.handoverAt(track)) return;
    this.fadingOut = {
      handle: track.handle,
      startedAt: clockSeconds,
      endsAt: clockSeconds + this.settings.crossfadeSeconds,
    };
    this.current = null;
    this.pendingStartAt = clockSeconds + Math.max(0, this.settings.gapSeconds);
  }

  private maybeStartPending(clockSeconds: number): void {
    if (this.pendingStartAt === null || clockSeconds < this.pendingStartAt) return;
    this.beginTrack(clockSeconds);
  }

  private beginTrack(clockSeconds: number): void {
    this.pendingStartAt = null;
    const clipId = this.takeFromBag();
    if (clipId === null) return;
    // Zero, always: the ramp in `stepFadeIn` owns the level from here. Starting
    // at the authored gain would be one frame of full-level music at the top of
    // every transition, which is the click a crossfade exists to avoid.
    const handle = this.options.play(clipId, 0);
    this.lastPlayed = clipId;
    if (!handle) {
      // Nothing resolved the clip. Hold the slot open on the fallback segment
      // rather than retrying every frame: an id the project does not ship is a
      // wiring mistake that a busy loop would only make harder to read.
      this.pendingStartAt = clockSeconds + this.settings.segmentSeconds;
      return;
    }
    this.current = { clipId, handle, startedAt: clockSeconds, atFullVolume: false };
  }

  /**
   * The next track: a shuffle bag, refilled when empty.
   *
   * A bag rather than a fresh random pick, because independent picks repeat —
   * over four tracks, one transition in four plays the piece that just ended,
   * which a player hears as the music having stopped changing. The bag also
   * refuses the seam between passes, where a plain shuffle is free to put the
   * track that just ended at the head of the next round.
   */
  private takeFromBag(): string | null {
    if (this.bag.length === 0) this.refillBag();
    return this.bag.shift() ?? null;
  }

  private refillBag(): void {
    const next = [...this.clips];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      const a = next[i]!;
      const b = next[j]!;
      next[i] = b;
      next[j] = a;
    }
    if (next.length > 1 && next[0] === this.lastPlayed) {
      const head = next[0]!;
      const tail = next[next.length - 1]!;
      next[0] = tail;
      next[next.length - 1] = head;
    }
    this.bag = next;
  }
}
