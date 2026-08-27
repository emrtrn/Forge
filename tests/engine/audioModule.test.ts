/**
 * Phase E: audio is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach, prepare a
 * level's manifest, start its ambient emitters, play a dialogue line — and pin
 * the degraded path that makes it optional: with no audio module registered,
 * neither the play surface nor the dialogue audio side exists at all.
 */
import assert from "node:assert/strict";

import { AudioSubsystem } from "../../engine/audio/audioSubsystem";
import type { EngineUpdateContext } from "../../engine/core/Subsystem";
import { AUDIO_COMPONENT, TRANSFORM_COMPONENT } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import { createAudioModule } from "../../src/scene/capabilities/audioModule";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  audioCommandsService,
  dialogueAudioService,
  type AudioCommands,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

const CUE = {
  schema: 1,
  type: "soundCue",
  name: "SC_Chime",
  output: { volume: 1, pitch: 1, bus: "sfx" },
  nodes: [
    { id: "output", kind: "output", volume: 1, pitch: 1 },
    { id: "source-1", kind: "source", clipId: "SFX_Chime", volume: 0.5, pitch: 1 },
  ],
  connections: [{ from: "source-1", to: "output" }],
};

const MANIFEST = {
  assets: [
    { id: "SFX_Chime", type: "sound", path: "Audio/SFX_Chime.wav" },
    { id: "SC_Chime", type: "soundCue", path: "Audio/SC_Chime.soundcue.json" },
    { id: "SM_Rock", type: "model", path: "Meshes/SM_Rock.glb" },
  ],
};

/** Serves the sound cue above; anything else 404s, as in a real project. */
async function withStubbedFetch(
  run: (requested: string[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (!url.includes("SC_Chime")) return { ok: false, json: async () => ({}) } as unknown as Response;
    return { ok: true, json: async () => CUE } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run(requested);
  } finally {
    globalThis.fetch = original;
  }
}

/** An ambient emitter: the smallest entity `playAutoPlay` starts. */
function emitter(id: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    name: id,
    components: {
      [TRANSFORM_COMPONENT]: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [AUDIO_COMPONENT]: { clipId: "SFX_Chime", autoPlay: true, volume: 0.5, ...extra },
    },
  } as unknown as Entity;
}

function documentOf(entities: readonly Entity[]): SceneDocument {
  return { schema: 1, name: "test", entities } as unknown as SceneDocument;
}

/**
 * Playback is queued on `play()` and drained by the subsystem's own tick, so the
 * checks tick it once and read what it recorded. Headless is a supported path:
 * with no `AudioContext` the request is still recorded, then stopped.
 */
function drain(commands: AudioCommands): readonly { clipId: string }[] {
  const subsystem = commands.bus as AudioSubsystem;
  subsystem.update({} as EngineUpdateContext);
  return subsystem.playedRequests();
}

function startedHost(): { host: RuntimeServiceHost; installed: string[] } {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  createCapabilityRegistry([createAudioModule()]).runtimeStart(host);
  const installed: string[] = [];
  host.installSubsystems((subsystem) => installed.push(subsystem.id));
  return { host, installed };
}

export async function registerAudioModuleTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("audio module ticks with presentation and starts the level's ambient emitters", async () => {
    await withStubbedFetch(async () => {
      const { host, installed } = startedHost();
      assert.deepEqual(installed, ["audio"], "audio is output, so it ticks last");

      const commands = host.resolve(audioCommandsService);
      assert.ok(commands, "the shell's play surface");
      assert.ok(host.resolve(dialogueAudioService), "and the dialogue capability's");

      commands.prepareLevel(MANIFEST as never);
      commands.playAutoPlay(
        documentOf([
          emitter("actor:0"),
          emitter("actor:1", { autoPlay: false }),
          // No Audio component at all: skipped, not a failure.
          { id: "actor:2", name: "actor:2", components: {} } as unknown as Entity,
        ]),
      );

      const played = drain(commands);
      assert.deepEqual(
        played.map((request) => request.clipId),
        ["SFX_Chime"],
        "only the emitter flagged autoPlay started",
      );

      // A runtime-spawned actor goes through the same path, one entity at a time.
      commands.playEntityAudio(emitter("actor:3"));
      assert.equal(drain(commands).length, 2);
    });
  });

  await checkAsync("audio module plays dialogue lines from both source kinds", async () => {
    await withStubbedFetch(async (requested) => {
      const { host } = startedHost();
      const commands = host.resolve(audioCommandsService)!;
      const playDialogue = host.resolve(dialogueAudioService)!;
      commands.prepareLevel(MANIFEST as never);

      // A raw sound plays straight away and hands back a working stop handle.
      const direct = playDialogue({ sourceType: "sound", sourceId: "SFX_Chime" } as never);
      assert.ok(direct, "a raw source is playable");
      direct.stop();
      assert.deepEqual(drain(commands).length, 0, "stopping before the tick cancels it");

      // A cue is fetched, evaluated and fired; it reports no duration, which is
      // why the subtitle falls back to its text-length estimate.
      const viaCue = playDialogue({ sourceType: "soundCue", sourceId: "SC_Chime" } as never);
      assert.ok(viaCue, "a cue source is accepted even though it is resolved async");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        requested.filter((url) => url.includes("SC_Chime")).length,
        1,
        "the cue is fetched once",
      );
      assert.deepEqual(
        drain(commands).map((request) => request.clipId),
        ["SFX_Chime"],
        "the cue's source node fired",
      );

      // The cache means a second line on the same cue does not re-fetch it.
      playDialogue({ sourceType: "soundCue", sourceId: "SC_Chime" } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(requested.filter((url) => url.includes("SC_Chime")).length, 1);
    });
  });

  await checkAsync("audio module owns the live mix and drops the level's lookups on teardown", async () => {
    await withStubbedFetch(async () => {
      const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
      const registry = createCapabilityRegistry([createAudioModule()]);
      registry.runtimeStart(host);
      host.installSubsystems(() => {});
      const commands = host.resolve(audioCommandsService)!;

      // Bus volumes are stored whether or not a browser audio graph exists, so
      // the shell can apply the player's persisted mix before the first sound.
      commands.setBusVolume("sfx", 0.25);
      assert.equal(commands.getBusVolume("sfx"), 0.25);
      // The listener pose is pushed in from the frame loop; headless it is stored.
      commands.setListenerPose([0, 1, 0], [0, 0, -1]);

      commands.prepareLevel(MANIFEST as never);
      registry.levelUnloaded();
      assert.equal(commands.getBusVolume("sfx"), 0.25, "the mix is per session, not per level");
      registry.dispose();
    });
  });

  await checkAsync("a runtime with no audio module is simply silent", async () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([]);
    registry.runtimeStart(host);
    const installed: string[] = [];
    host.installSubsystems((subsystem) => installed.push(subsystem.id));

    assert.deepEqual(installed, []);
    assert.equal(host.resolve(audioCommandsService), undefined, "no play surface");
    assert.equal(host.resolve(dialogueAudioService), undefined, "dialogue times off its text");
    registry.dispose();
  });
}
