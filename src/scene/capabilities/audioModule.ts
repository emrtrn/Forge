/**
 * Layer 2 capability: Audio — everything the runtime makes a sound with.
 *
 * Owns the {@link AudioSubsystem} (mix buses, the spatial listener, clip
 * playback), the manifest lookup that turns a `sound` / `soundCue` asset id into
 * a fetchable URL, the soundCue definition cache and its graph evaluation, the
 * `autoPlay` Audio components a built level starts with, and the dialogue
 * capability's audio side.
 *
 * It ticks in the `presentation` slot: audio is output, produced from a world
 * that has already been simulated this frame.
 *
 * Everything it publishes is resolved by its consumers at call time, so the
 * shell, the behavior layer and the dialogue module all degrade the same way
 * when it is switched off: `playSound` in a script is a no-op, an ambient
 * emitter never starts, a dialogue line still shows its subtitle (timed from the
 * text length, since nothing reports a duration) and the settings screen's
 * volume sliders persist a preference nothing is listening to. A silent game
 * pays for none of it.
 *
 * Two things deliberately stay with the shell. The listener pose is pushed in
 * from the frame loop rather than read in this module's tick, because it must be
 * sampled *after* the Game Mode has moved the camera or panning trails a frame
 * behind. And the persisted volume preference stays in the shell's user-settings
 * store — the module owns the live mix, not the player's saved choice.
 */
import { AudioSubsystem, type AudioPlayOptions } from "@engine/audio/audioSubsystem";
import type { AudioBusId } from "@engine/audio/audioBus";
import {
  evaluateSoundCue,
  isSoundCueAsset,
  type ResolvedPlayEvent,
} from "@engine/audio/soundCueEvaluator";
import type { SoundCueAsset } from "@engine/audio/soundCueTypes";
import { assetPath, assetType, type AssetManifest } from "@engine/assets/manifest";
import type {
  DialogueAudioPlayback,
  DialogueAudioRequest,
} from "@engine/dialogue/dialogueSubsystem";
import { readAudioComponent, readTransformComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import { projectFileUrl } from "@/project/ProjectSystem";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import { audioCommandsService, dialogueAudioService } from "./runtimeServiceKeys";

export const AUDIO_MODULE_ID = "audio";

export function createAudioModule(): CapabilityModule {
  /** Manifest sound asset id -> fetchable file URL, filled when a level prepares. */
  const soundUrlById = new Map<string, string>();
  /** Manifest soundCue asset id -> fetchable file URL. */
  const soundCueUrlById = new Map<string, string>();
  /** Parsed soundCue assets, cached by id (null = known-missing/unparseable). */
  const soundCueDefs = new Map<string, SoundCueAsset | null>();
  let releaseGesture: (() => void) | null = null;
  const audio = new AudioSubsystem({
    backend: "web-audio",
    resolveClipUrl: (clipId) => soundUrlById.get(clipId) ?? null,
  });

  /** Fetches and caches a soundCue asset by id. Returns null on failure. */
  async function loadSoundCue(cueId: string): Promise<SoundCueAsset | null> {
    if (soundCueDefs.has(cueId)) return soundCueDefs.get(cueId) ?? null;
    const url = soundCueUrlById.get(cueId);
    if (!url) {
      soundCueDefs.set(cueId, null);
      return null;
    }
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) {
        soundCueDefs.set(cueId, null);
        return null;
      }
      const data: unknown = await response.json();
      // A hand-edited or truncated cue must fail here, once, with a name in the
      // log — not inside the evaluator on a fire-and-forget promise, where it
      // would surface as an unhandled rejection instead of a missing sound.
      if (!isSoundCueAsset(data)) {
        console.warn(`[audio] "${cueId}" is not a valid sound cue; ignoring it.`);
        soundCueDefs.set(cueId, null);
        return null;
      }
      soundCueDefs.set(cueId, data);
      return data;
    } catch {
      soundCueDefs.set(cueId, null);
      return null;
    }
  }

  /**
   * Resolves a cue's graph to play events and fires them, honouring each event's
   * delay. `scale` folds in the caller's own volume/pitch/loop/spatial overrides
   * (an Audio component's; a dialogue line has none).
   *
   * Evaluation is guarded because it is reached from a fire-and-forget promise:
   * a cue that passes the structural gate can still describe a graph the
   * evaluator chokes on, and one bad cue must cost its own sound, nothing more.
   */
  function fireSoundCue(
    cueId: string,
    cue: SoundCueAsset,
    scale: (event: ResolvedPlayEvent, cue: SoundCueAsset) => AudioPlayOptions,
  ): void {
    let events: readonly ResolvedPlayEvent[];
    try {
      events = evaluateSoundCue(cue);
    } catch (error) {
      console.warn(`[audio] sound cue "${cueId}" could not be evaluated:`, error);
      return;
    }
    for (const event of events) {
      const options = scale(event, cue);
      if (event.delaySeconds > 0) {
        setTimeout(() => audio.playOneShot(event.clipId, options), event.delaySeconds * 1000);
      } else {
        audio.playOneShot(event.clipId, options);
      }
    }
  }

  /** Loads a cue and fires it; never rejects, so no caller needs to catch. */
  function playSoundCue(
    cueId: string,
    scale: (event: ResolvedPlayEvent, cue: SoundCueAsset) => AudioPlayOptions,
  ): void {
    void loadSoundCue(cueId)
      .then((cue) => {
        if (cue) fireSoundCue(cueId, cue, scale);
      })
      .catch((error) => console.warn(`[audio] sound cue "${cueId}" failed to play:`, error));
  }

  /**
   * Plays a resolved dialogue line's audio and hands back a control handle. Raw
   * `sound` sources play directly; a `soundCue` source is evaluated and fired
   * best-effort (subtitle timing then falls back to the text-length estimate,
   * since a cue reports no duration).
   */
  function playDialogueAudio(request: DialogueAudioRequest): DialogueAudioPlayback | null {
    if (request.sourceType === "soundCue") {
      playSoundCue(request.sourceId, (event, cue) => ({
        volume: event.volume,
        loop: event.loop,
        pitch: event.pitch,
        ...(cue.output.bus ? { bus: cue.output.bus } : {}),
      }));
      return { stop: () => undefined };
    }
    // Raw sound: the audio subsystem resolves the asset id to a file URL itself.
    const handle = audio.play(request.sourceId, {});
    return { stop: () => handle.stop() };
  }

  function playEntityAudio(entity: Entity): void {
    const component = readAudioComponent(entity);
    if (!component?.autoPlay) return;
    const position = component.spatial ? readTransformComponent(entity)?.position : undefined;
    // Spatial placement + authored sphere-attenuation overrides for the PannerNode.
    const spatialOpts =
      component.spatial && position
        ? {
            position: [position[0], position[1], position[2]] as const,
            ...(component.refDistance !== undefined ? { refDistance: component.refDistance } : {}),
            ...(component.maxDistance !== undefined ? { maxDistance: component.maxDistance } : {}),
            ...(component.rolloff !== undefined ? { rolloff: component.rolloff } : {}),
          }
        : {};
    const componentPitch = component.pitch ?? 1;

    if (component.sourceType === "soundCue" && component.sourceId) {
      // Async: load cue, evaluate graph, fire each resolved event.
      playSoundCue(component.sourceId, (event, cue) => ({
        volume: event.volume * component.volume,
        loop: event.loop || component.loop,
        // The component's pitch multiplier scales the cue's own pitch (Unreal parity).
        pitch: event.pitch * componentPitch,
        spatial: component.spatial,
        // Route the cue through its authored mix bus (default master).
        ...(cue.output.bus ? { bus: cue.output.bus } : {}),
        ...spatialOpts,
      }));
      return;
    }
    audio.playOneShot(component.clipId, {
      volume: component.volume,
      loop: component.loop,
      spatial: component.spatial,
      ...(component.pitch !== undefined ? { pitch: component.pitch } : {}),
      ...spatialOpts,
    });
  }

  /**
   * Browser autoplay policies suspend the audio context until a user gesture, so
   * resume it on the first pointer/key input — then ambient cues auto-played at
   * scene load begin sounding. One-shot: removes itself after the first gesture.
   */
  function resumeOnFirstGesture(): void {
    if (typeof window === "undefined") return;
    const resume = (): void => {
      audio.resumeContext();
      release();
    };
    const release = (): void => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      releaseGesture = null;
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    releaseGesture = release;
  }

  return {
    id: AUDIO_MODULE_ID,

    onRuntimeStart(services: RuntimeServices) {
      // Output-only: it runs after everything that could have made a sound.
      services.addSubsystem("presentation", audio);
      resumeOnFirstGesture();

      services.provide(audioCommandsService, {
        bus: audio,
        prepareLevel(manifest: AssetManifest) {
          for (const asset of manifest.assets) {
            const path = assetPath(asset);
            if (assetType(asset) === "sound") soundUrlById.set(asset.id, projectFileUrl(path));
            if (assetType(asset) === "soundCue") soundCueUrlById.set(asset.id, projectFileUrl(path));
          }
        },
        playAutoPlay(document: SceneDocument) {
          for (const entity of document.entities) {
            try {
              playEntityAudio(entity);
            } catch (error) {
              // One unplayable emitter must not stop the rest (or the scene start).
              console.error(`[runtime] auto-play audio failed for ${entity.id}:`, error);
            }
          }
        },
        playEntityAudio,
        setListenerPose: (position, forward) => audio.setListenerPose(position, forward),
        setBusVolume: (bus: AudioBusId, volume: number) => audio.setBusVolume(bus, volume),
        getBusVolume: (bus: AudioBusId) => audio.getBusVolume(bus),
      });

      // The dialogue capability asks whoever owns audio to play a line; before
      // this module existed the shell answered. Its consumer did not change.
      services.provide(dialogueAudioService, playDialogueAudio);
    },

    onLevelUnloaded() {
      // Cue definitions are per-project authoring and could have been re-saved
      // between levels; the URL maps are re-filled by the next `prepareLevel`.
      soundCueDefs.clear();
      soundUrlById.clear();
      soundCueUrlById.clear();
    },

    dispose() {
      releaseGesture?.();
      audio.dispose();
      soundCueDefs.clear();
      soundUrlById.clear();
      soundCueUrlById.clear();
    },
  };
}
