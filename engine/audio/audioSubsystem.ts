import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  DEFAULT_AUDIO_CLIP_MANIFEST,
  audioClipById,
  type AudioClipManifest,
} from "../assets/audio";
import {
  AUDIO_BUS_IDS,
  DEFAULT_AUDIO_BUS,
  createDefaultBusVolumes,
  isAudioBusId,
  mergeMixSnapshot,
  normalizeBusVolume,
  type AudioBusId,
  type BusMixSnapshot,
  type BusVolumes,
} from "./audioBus";

export const AUDIO_SUBSYSTEM_ID = "audio";
export type AudioBackend = "none" | "web-audio";

/**
 * How many recent plays {@link AudioSubsystem.playedRequests} keeps.
 *
 * Comfortably above what any single test asserts, and far above the "last 10
 * audio events" a debug panel shows, so trimming is invisible to both readers.
 */
export const PLAYED_HISTORY_LIMIT = 128;

export type AudioVec3 = readonly [number, number, number];

export interface AudioPlayOptions {
  volume?: number;
  loop?: boolean;
  spatial?: boolean;
  pitch?: number;
  /** Emitter world position; routes a spatial sound through a `PannerNode`. */
  position?: AudioVec3;
  /** Distance at which spatial attenuation begins. Default {@link DEFAULT_SPATIAL_ATTENUATION}. */
  refDistance?: number;
  /** Distance past which a spatial sound no longer attenuates. */
  maxDistance?: number;
  /** Spatial attenuation rolloff factor (higher = quieter sooner). */
  rolloff?: number;
  /** Mix bus this play routes through. Defaults to {@link DEFAULT_AUDIO_BUS}. */
  bus?: AudioBusId;
  /**
   * Stream this clip through a media element instead of decoding it into memory.
   *
   * For the handful of long sounds — music tracks, the ambience bed — where the
   * decoded-buffer path is the wrong shape. `decodeAudioData` expands a file to
   * raw float samples and the cache never evicts, so one two-minute stereo track
   * costs about 44 MiB of RAM for as long as the tab lives (120 s × 48 kHz × 2
   * channels × 4 bytes) whether or not it is still playing. Twenty of them is
   * most of a gigabyte. A media element holds a small rolling buffer instead,
   * and starts sounding before the whole file has arrived — which also removes
   * the fetch-and-decode wait that would otherwise land in the middle of a
   * crossfade, on the incoming track.
   *
   * The trade is precision: a media element starts when it is ready rather than
   * on a scheduled sample, so this is wrong for one-shots that must land on a
   * frame. Every short sound should stay on the buffer path.
   */
  stream?: boolean;
}

/** Resolved sphere-attenuation parameters for a spatial `PannerNode`. */
export interface SpatialPannerConfig {
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloff: number;
}

/** Default sphere attenuation: full volume within 4 units, silent past 60. */
export const DEFAULT_SPATIAL_ATTENUATION: SpatialPannerConfig = {
  refDistance: 4,
  maxDistance: 60,
  rolloff: 1,
};

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The media type Forge's audio pipeline ships by default.
 *
 * A project that encodes one format and no fallback — the usual choice, since a
 * second encode doubles the audio payload — buys one consequence worth naming
 * here rather than in a comment somewhere downstream: a browser that cannot
 * decode it plays *nothing*, not a degraded mix. That is what
 * {@link canPlayAudioFormat} exists to detect. A fork shipping something else
 * passes its own mime type.
 */
export const SHIPPED_AUDIO_MIME = 'audio/ogg; codecs="vorbis"';

/**
 * Whether this browser will play a media type at all — the check that turns
 * "there is no sound" into something the game can say out loud.
 *
 * `canPlayType` answers with an intention (`""` / `"maybe"` / `"probably"`) and
 * only the empty string is a real answer: it is the browser stating it will not
 * try. Anything else is treated as yes, because the alternative — warning a
 * player whose browser said "maybe" and would have coped — is a worse error than
 * staying quiet.
 *
 * Returns `true` where there is no DOM to ask (tests, tooling). Not knowing is
 * not evidence, and a headless run must never claim the format is unplayable.
 */
export function canPlayAudioFormat(mimeType: string = SHIPPED_AUDIO_MIME): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("audio");
  if (typeof probe.canPlayType !== "function") return true;
  return probe.canPlayType(mimeType) !== "";
}

/**
 * Resolves a spatial play's attenuation parameters, clamping to positive values
 * and guaranteeing `maxDistance > refDistance` (an inverted/equal pair would make
 * the PannerNode silent or NaN). Pure: unit-tested without a Web Audio context.
 */
export function resolveSpatialPannerConfig(options: AudioPlayOptions): SpatialPannerConfig {
  const refDistance = positiveOr(options.refDistance, DEFAULT_SPATIAL_ATTENUATION.refDistance);
  const maxCandidate = positiveOr(options.maxDistance, DEFAULT_SPATIAL_ATTENUATION.maxDistance);
  return {
    refDistance,
    maxDistance: Math.max(maxCandidate, refDistance + 1),
    rolloff: positiveOr(options.rolloff, DEFAULT_SPATIAL_ATTENUATION.rolloff),
  };
}

export interface AudioPlayRequest extends AudioPlayOptions {
  clipId: string;
}

export interface AudioPlaybackHandle {
  readonly clipId: string;
  readonly stopped: boolean;
  readonly volume: number;
  readonly pitch: number;
  stop(fadeSeconds?: number): void;
  setVolume(value: number, fadeSeconds?: number): void;
  setPitch(value: number): void;
  /**
   * Holds a streamed play where it stands, or lets it go on.
   *
   * Streams only, and the asymmetry is the point rather than an omission: a
   * media element has a position that can be held, a decoded source does not —
   * `AudioBufferSourceNode` can be started and stopped but never resumed, so
   * "pause" for a one-shot would have to mean "stop", which is a different
   * thing and not one any caller has asked for. A no-op there keeps a caller
   * that pauses everything from silently destroying the short sounds.
   */
  setPaused(paused: boolean): void;
}

export interface AudioBus {
  playOneShot(clipId: string, options?: AudioPlayOptions): void;
  play(clipId: string, options?: AudioPlayOptions): AudioPlaybackHandle;
}

export interface AudioSubsystemOptions {
  backend?: AudioBackend;
  clips?: AudioClipManifest;
  /**
   * Resolves a `clipId` that is not a built-in tone clip to a fetchable audio
   * file URL (e.g. a manifest `sound` asset). Returning null skips playback.
   * Injected by the host so the engine layer stays manifest-agnostic.
   */
  resolveClipUrl?: (clipId: string) => string | null;
}

type BrowserAudioContext = AudioContext;

type AudioSourceNode = AudioBufferSourceNode | OscillatorNode;

class RuntimeAudioPlaybackHandle implements AudioPlaybackHandle {
  readonly clipId: string;
  private source: AudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private context: BrowserAudioContext | null = null;
  private sourceBaseRate = 1;
  private stoppedInternal = false;
  private volumeInternal: number;
  private pitchInternal: number;
  /** Set instead of `source` when this play streams (see `AudioPlayOptions.stream`). */
  private media: HTMLAudioElement | null = null;
  /** Pending pause for a streamed stop that is still fading out. */
  private mediaStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    clipId: string,
    options: AudioPlayOptions = {},
    private readonly onStop: (handle: RuntimeAudioPlaybackHandle) => void = () => undefined,
  ) {
    this.clipId = clipId;
    this.volumeInternal = sanitizeVolume(options.volume);
    this.pitchInternal = sanitizePitch(options.pitch);
  }

  get stopped(): boolean {
    return this.stoppedInternal;
  }

  get volume(): number {
    return this.volumeInternal;
  }

  get pitch(): number {
    return this.pitchInternal;
  }

  attach(context: BrowserAudioContext, source: AudioSourceNode, gain: GainNode): void {
    this.context = context;
    this.source = source;
    this.gain = gain;
    this.sourceBaseRate = sourcePitchBase(source);
    applySourcePitch(source, this.pitchInternal, this.sourceBaseRate);
    gain.gain.value = this.volumeInternal;
    source.onended = () => this.finish();
    if (this.stoppedInternal) this.stop(0);
  }

  /**
   * Attaches a streamed play: the element is the source, so there is no
   * scheduled start or stop and the pitch rides `playbackRate` on the element.
   */
  attachMedia(context: BrowserAudioContext, media: HTMLAudioElement, gain: GainNode): void {
    this.context = context;
    this.media = media;
    this.gain = gain;
    media.playbackRate = this.pitchInternal;
    gain.gain.value = this.volumeInternal;
    media.addEventListener("ended", () => this.finish(), { once: true });
    if (this.stoppedInternal) this.stop(0);
  }

  stop(fadeSeconds = 0): void {
    this.finish();
    const source = this.source;
    const media = this.media;
    const gain = this.gain;
    const context = this.context;
    if ((!source && !media) || !context) return;

    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    const stopTime = fade > 0 ? now + fade : now;
    if (gain) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (fade > 0) gain.gain.linearRampToValueAtTime(0, stopTime);
      else gain.gain.setValueAtTime(0, now);
    }
    if (media) {
      // A media element has no scheduled stop, so the pause waits out the ramp
      // on a timer. Releasing `src` matters as much as the pause: a paused
      // element with a source still buffers, and a bed torn down mid-match
      // would go on pulling its file down for nothing.
      const release = () => {
        this.mediaStopTimer = null;
        media.pause();
        media.removeAttribute("src");
        media.load();
      };
      if (this.mediaStopTimer !== null) clearTimeout(this.mediaStopTimer);
      if (fade > 0) this.mediaStopTimer = setTimeout(release, fade * 1000);
      else release();
      return;
    }
    try {
      source!.stop(stopTime);
    } catch {
      // Web Audio throws if a source was already stopped; handles are idempotent.
    }
  }

  setVolume(value: number, fadeSeconds = 0): void {
    const next = sanitizeVolume(value);
    this.volumeInternal = next;
    const gain = this.gain;
    const context = this.context;
    if (!gain || !context || this.stoppedInternal) return;

    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    if (fade > 0) gain.gain.linearRampToValueAtTime(next, now + fade);
    else gain.gain.setValueAtTime(next, now);
  }

  setPitch(value: number): void {
    this.pitchInternal = sanitizePitch(value);
    if (this.source) applySourcePitch(this.source, this.pitchInternal, this.sourceBaseRate);
    if (this.media) this.media.playbackRate = this.pitchInternal;
  }

  setPaused(paused: boolean): void {
    const media = this.media;
    if (!media || this.stoppedInternal) return;
    if (paused) {
      media.pause();
      return;
    }
    void media.play().catch(() => undefined);
  }

  /** Asks a stream the autoplay policy refused to start again, after a gesture. */
  retryMedia(): void {
    if (this.stoppedInternal || !this.media) return;
    void this.media.play().catch(() => undefined);
  }

  private finish(): void {
    if (this.stoppedInternal) return;
    this.stoppedInternal = true;
    this.onStop(this);
  }
}

function sanitizeVolume(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 1;
}

function sanitizePitch(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function sourcePitchBase(source: AudioSourceNode): number {
  if ("playbackRate" in source) return source.playbackRate.value;
  return source.frequency.value;
}

function applySourcePitch(source: AudioSourceNode, pitch: number, base: number): void {
  if ("playbackRate" in source) source.playbackRate.value = base * pitch;
  else source.frequency.value = base * pitch;
}

/**
 * Writes a 3-vector to a Web Audio `positionX/Y/Z` (or `forwardX/Y/Z`) AudioParam
 * trio when the browser exposes them, else calls the deprecated `setPosition`/
 * `setOrientation` fallback. Keeps spatial audio working across browser versions.
 */
function setAudioVec3(
  context: BrowserAudioContext,
  x: AudioParam | undefined,
  y: AudioParam | undefined,
  z: AudioParam | undefined,
  value: AudioVec3,
  fallback: () => void,
): void {
  if (x && y && z) {
    const t = context.currentTime;
    x.setValueAtTime(value[0], t);
    y.setValueAtTime(value[1], t);
    z.setValueAtTime(value[2], t);
  } else {
    fallback();
  }
}

export class AudioSubsystem implements Subsystem, AudioBus {
  readonly id = AUDIO_SUBSYSTEM_ID;
  private readonly backend: AudioBackend;
  private readonly clips: AudioClipManifest;
  private readonly resolveClipUrl?: (clipId: string) => string | null;
  private context: BrowserAudioContext | null = null;
  private pending: Array<{ request: AudioPlayRequest; handle: RuntimeAudioPlaybackHandle }> = [];
  private readonly active = new Set<RuntimeAudioPlaybackHandle>();
  private played: AudioPlayRequest[] = [];
  /** Decoded audio buffers keyed by URL; promise-cached so each file loads once. */
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /**
   * Decoded length in seconds, keyed by clip id, recorded as each buffer lands.
   *
   * Written from the decode rather than authored beside the file, so it cannot
   * disagree with the audio: a track re-exported a bar longer needs no edit
   * anywhere. Only what has actually been played is in here, which is why a
   * consumer that needs a length polls for it instead of asking up front.
   */
  private readonly clipDurations = new Map<string, number>();
  /**
   * Streamed plays the browser's autoplay policy refused, awaiting a gesture.
   *
   * Only streams land here: a decoded buffer starts against a suspended context
   * and simply becomes audible when it resumes, but a media element's `play()`
   * is rejected outright and has to be asked again.
   */
  private readonly blockedStreams = new Set<RuntimeAudioPlaybackHandle>();
  /** Latest listener pose (camera), applied to the context once it exists. */
  private listenerPosition: AudioVec3 | null = null;
  private listenerForward: AudioVec3 = [0, 0, -1];
  /** Linear gain per mix bus; the source of truth, mirrored onto live GainNodes. */
  private readonly busVolumes: BusVolumes = createDefaultBusVolumes();
  /** Live bus GainNodes, created lazily with the context (`master` → destination). */
  private busNodes: Map<AudioBusId, GainNode> | null = null;
  /** Urls already reported as undecodable, so the warning is once per clip. */
  private readonly reportedDecodeFailures = new Set<string>();

  constructor(options: AudioSubsystemOptions = {}) {
    this.backend = options.backend ?? "none";
    this.clips = options.clips ?? DEFAULT_AUDIO_CLIP_MANIFEST;
    if (options.resolveClipUrl) this.resolveClipUrl = options.resolveClipUrl;
  }

  /**
   * Resumes the audio context (browser autoplay policies suspend it until a user
   * gesture). The host should call this on the first pointer/key input so
   * auto-played ambient cues queued at scene load begin sounding.
   */
  resumeContext(): void {
    void this.context?.resume().catch(() => undefined);
    if (this.blockedStreams.size === 0) return;
    for (const handle of [...this.blockedStreams]) {
      this.blockedStreams.delete(handle);
      if (!handle.stopped) handle.retryMedia();
    }
  }

  /**
   * Silences everything without ending it — for a tab the player has left.
   *
   * The context's own clock stops with it, so a scheduled fade resumes where it
   * was rather than finishing to nobody. What this does *not* stop is a media
   * element: a stream keeps advancing its own position through a suspended
   * context, which is why a streamed bed has to be paused on its handle as well.
   * Whoever owns the bed does that; this covers everything else.
   */
  suspendContext(): void {
    void this.context?.suspend().catch(() => undefined);
  }

  /**
   * Updates the spatial-audio listener (the runtime camera/player). Stored and
   * applied to the Web Audio listener whenever the context exists, so the host
   * can call it every frame; a no-op for the `none` backend.
   */
  setListenerPose(position: AudioVec3, forward: AudioVec3): void {
    this.listenerPosition = position;
    this.listenerForward = forward;
    if (this.context) this.applyListener(this.context);
  }

  /** Current linear gain of a mix bus (headless-safe; reads the stored table). */
  getBusVolume(bus: AudioBusId): number {
    return this.busVolumes[bus];
  }

  /**
   * Sets a mix bus's linear gain, optionally ramping a live GainNode over
   * `fadeSeconds`. Stored even with no context so the value applies once a bus
   * graph is built. Non-finite/negative values clamp to a sane gain.
   */
  setBusVolume(bus: AudioBusId, value: number, fadeSeconds = 0): void {
    const next = normalizeBusVolume(value);
    this.busVolumes[bus] = next;
    const node = this.busNodes?.get(bus);
    const context = this.context;
    if (!node || !context) return;
    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    if (fade > 0) node.gain.linearRampToValueAtTime(next, now + fade);
    else node.gain.setValueAtTime(next, now);
  }

  /** Applies a partial mix snapshot (e.g. a pause/menu duck) to several buses. */
  applyMixSnapshot(snapshot: BusMixSnapshot, fadeSeconds = 0): void {
    const next = mergeMixSnapshot(this.busVolumes, snapshot);
    for (const id of AUDIO_BUS_IDS) {
      if (next[id] !== this.busVolumes[id]) this.setBusVolume(id, next[id], fadeSeconds);
    }
  }

  /** Restores every bus to unity gain (the default mix). */
  resetMix(fadeSeconds = 0): void {
    for (const id of AUDIO_BUS_IDS) this.setBusVolume(id, 1, fadeSeconds);
  }

  /**
   * Builds the bus gain graph once per context: `master` → destination, then
   * every other bus → master. Each node starts at its stored bus volume so
   * a mix set before the context existed is preserved.
   */
  private ensureBusGraph(context: BrowserAudioContext): Map<AudioBusId, GainNode> {
    if (this.busNodes) return this.busNodes;
    const nodes = new Map<AudioBusId, GainNode>();
    for (const id of AUDIO_BUS_IDS) {
      const gain = context.createGain();
      gain.gain.value = this.busVolumes[id];
      nodes.set(id, gain);
    }
    const master = nodes.get("master")!;
    master.connect(context.destination);
    for (const id of AUDIO_BUS_IDS) {
      if (id !== "master") nodes.get(id)!.connect(master);
    }
    this.busNodes = nodes;
    return nodes;
  }

  private applyListener(context: BrowserAudioContext): void {
    const position = this.listenerPosition;
    if (!position) return;
    const listener = context.listener;
    setAudioVec3(context, listener.positionX, listener.positionY, listener.positionZ, position, () =>
      listener.setPosition?.(position[0], position[1], position[2]),
    );
    const f = this.listenerForward;
    setAudioVec3(context, listener.forwardX, listener.forwardY, listener.forwardZ, f, () =>
      listener.setOrientation?.(f[0], f[1], f[2], 0, 1, 0),
    );
  }

  /** Resolves the bus GainNode a request routes into (building the graph if new). */
  private busOutput(context: BrowserAudioContext, request: AudioPlayRequest): GainNode {
    const nodes = this.ensureBusGraph(context);
    const bus = request.bus && isAudioBusId(request.bus) ? request.bus : DEFAULT_AUDIO_BUS;
    return nodes.get(bus) ?? nodes.get("master")!;
  }

  /**
   * Connects a play's gain to its mix bus. Spatial plays with a position route
   * through a `PannerNode` (sphere attenuation) first; everything else feeds the
   * bus directly. The bus graph chains to the destination.
   */
  private connectSpatialOutput(
    context: BrowserAudioContext,
    gain: GainNode,
    request: AudioPlayRequest,
  ): void {
    const output = this.busOutput(context, request);
    if (!request.spatial || !request.position) {
      gain.connect(output);
      return;
    }
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    const config = resolveSpatialPannerConfig(request);
    panner.refDistance = config.refDistance;
    panner.maxDistance = config.maxDistance;
    panner.rolloffFactor = config.rolloff;
    const p = request.position;
    setAudioVec3(context, panner.positionX, panner.positionY, panner.positionZ, p, () =>
      panner.setPosition?.(p[0], p[1], p[2]),
    );
    gain.connect(panner);
    panner.connect(output);
  }

  playOneShot(clipId: string, options: AudioPlayOptions = {}): void {
    this.play(clipId, options);
  }

  play(clipId: string, options: AudioPlayOptions = {}): AudioPlaybackHandle {
    const request = { clipId, ...options };
    const handle = new RuntimeAudioPlaybackHandle(clipId, options, (stopped) => {
      this.active.delete(stopped);
    });
    this.active.add(handle);
    this.pending.push({ request, handle });
    return handle;
  }

  /**
   * The most recent plays, oldest first, capped at {@link PLAYED_HISTORY_LIMIT}.
   *
   * Inspection only — tests assert what a scene played, and the debug overlay
   * shows the last few events. Bounded because a busy scene fires thousands of
   * one-shots over a long session, and an unbounded log of them is a leak that
   * grows with playtime and shows up as nothing but rising memory.
   */
  playedRequests(): readonly AudioPlayRequest[] {
    return this.played;
  }

  /**
   * A clip's decoded length in seconds, or null if it has not been decoded here.
   *
   * Null is the ordinary answer for a clip that has never played, for the first
   * moment after one starts (the fetch and decode are in flight), for a
   * synthesized tone, and always on the headless backend. A caller that needs a
   * length before then needs its own fallback — this reports what is known, not
   * what is authored.
   */
  clipDurationSeconds(clipId: string): number | null {
    return this.clipDurations.get(clipId) ?? null;
  }

  update(_context: EngineUpdateContext): void {
    const requests = this.pending;
    this.pending = [];
    for (const { request, handle } of requests) {
      if (handle.stopped) {
        this.active.delete(handle);
        continue;
      }
      this.played.push(request);
      if (this.played.length > PLAYED_HISTORY_LIMIT) {
        this.played.splice(0, this.played.length - PLAYED_HISTORY_LIMIT);
      }
      if (this.backend === "web-audio") {
        // A failed clip (bad node param, decode error, etc.) must never throw out
        // of the per-frame update and kill the engine loop.
        try {
          this.playWebAudio(request, handle);
        } catch (error) {
          console.error(`[audio] playback failed for "${request.clipId}":`, error);
          handle.stop();
        }
      } else if (!request.loop) handle.stop();
    }
  }

  dispose(): void {
    for (const { handle } of this.pending) handle.stop();
    this.pending = [];
    for (const handle of this.active) handle.stop();
    this.active.clear();
    this.blockedStreams.clear();
    this.played = [];
    this.buffers.clear();
    this.clipDurations.clear();
    this.busNodes = null;
    void this.context?.close();
    this.context = null;
  }

  private playWebAudio(
    request: AudioPlayRequest,
    handle: RuntimeAudioPlaybackHandle,
  ): void {
    const context = this.audioContext();
    if (!context) {
      handle.stop();
      return;
    }
    void context.resume().catch(() => undefined);

    // Built-in synthesized tone clips (e.g. the collision chime).
    const tone = audioClipById(this.clips, request.clipId);
    if (tone && tone.type === "tone") {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.frequency.value = tone.frequencyHz;
      oscillator.connect(gain);
      this.connectSpatialOutput(context, gain, request);
      handle.attach(context, oscillator, gain);
      if (handle.stopped) return;
      oscillator.start(now);
      oscillator.stop(now + tone.durationSeconds);
      return;
    }

    // Otherwise resolve the clip id to a fetchable audio file (manifest sound).
    const url = this.resolveClipUrl?.(request.clipId) ?? null;
    if (!url) {
      handle.stop();
      return;
    }
    if (request.stream) this.playStream(context, url, request, handle);
    else void this.playFile(context, url, request, handle);
  }

  /**
   * Plays a long clip through a media element rather than a decoded buffer.
   *
   * Nothing is cached here on purpose. The buffer path caches because decoding
   * the same one-shot a thousand times would be absurd; a streamed track is
   * played one at a time and the browser's own HTTP cache already keeps the
   * bytes, so a second element for the same url is cheap while a second decoded
   * copy would not be.
   */
  private playStream(
    context: BrowserAudioContext,
    url: string,
    request: AudioPlayRequest,
    handle: RuntimeAudioPlaybackHandle,
  ): void {
    const media = new Audio();
    media.src = url;
    media.loop = request.loop ?? false;
    media.preload = "auto";
    // The length arrives with the metadata, well before the file does, and the
    // music director is polling for it — a streamed track therefore schedules
    // its hand-over sooner than a decoded one ever could.
    media.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(media.duration) && media.duration > 0) {
          this.clipDurations.set(request.clipId, media.duration);
        }
      },
      { once: true },
    );
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();
    source.connect(gain);
    this.connectSpatialOutput(context, gain, request);
    handle.attachMedia(context, media, gain);
    if (handle.stopped) return;
    void media.play().catch(() => {
      // Autoplay policy: the element is refused until the page has a gesture.
      // Held rather than dropped, because the bed asked for at match start is
      // exactly the play a policy refuses, and silently losing it would make a
      // whole match silent. `resumeContext` retries these on the first input.
      if (!handle.stopped) this.blockedStreams.add(handle);
    });
  }

  private async playFile(
    context: BrowserAudioContext,
    url: string,
    request: AudioPlayRequest,
    handle: RuntimeAudioPlaybackHandle,
  ): Promise<void> {
    const buffer = await this.loadBuffer(context, url);
    // Recorded before the early return: a play that was cancelled while its file
    // was in flight still decoded the buffer, and the length it learned is just
    // as true as the one a completed play learns.
    if (buffer) this.clipDurations.set(request.clipId, buffer.duration);
    if (!buffer || handle.stopped) {
      if (!buffer) handle.stop();
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = request.loop ?? false;
    const gain = context.createGain();
    source.connect(gain);
    this.connectSpatialOutput(context, gain, request);
    handle.attach(context, source, gain);
    if (handle.stopped) return;
    source.start();
  }

  private loadBuffer(context: BrowserAudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .catch((error: unknown) => {
          // Reported, and the reason is a failure mode this used to hide
          // completely: a browser that cannot decode the shipped codec fails
          // *every* clip here, and with a silent catch the game simply plays no
          // sound and says nothing about why. That is the one audio bug a bug
          // report cannot describe — "there is no sound" reads the same whether
          // the table failed to load, the context is suspended, or the decoder
          // refused the format.
          //
          // Once per url: a clip that cannot decode is asked for again on
          // every trigger, and an unbounded log in a per-frame path is its own
          // bug.
          if (!this.reportedDecodeFailures.has(url)) {
            this.reportedDecodeFailures.add(url);
            console.warn(`[audio] could not decode "${url}" — this browser may not support the format:`, error);
          }
          return null;
        });
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private audioContext(): BrowserAudioContext | null {
    if (this.context) return this.context;
    const ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!ctor) return null;
    this.context = new ctor();
    this.applyListener(this.context);
    return this.context;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  var webkitAudioContext: typeof AudioContext | undefined;
}
