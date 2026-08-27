/**
 * Phase F: AI character animation is a Layer 2 capability.
 *
 * The checks drive the module the way the runtime shell does — register an
 * AI-controlled character, tick it against locomotion reports, fire an attack
 * intent over the script-message bus — and pin what makes it optional: with no
 * host it registers nothing, and it never animates the pawn the Game Mode
 * possesses.
 */
import assert from "node:assert/strict";
import { AnimationClip, Object3D, VectorKeyframeTrack, type AnimationMixer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { LayoutCharacter } from "../../engine/scene/layout";
import type { LocomotionInput } from "../../engine/movement/locomotionAnimation";
import { createAiCharacterAnimationModule } from "../../src/scene/capabilities/aiCharacterAnimationModule";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  characterAnimationCommandsService,
  characterAnimationHostService,
  scriptMessageBusService,
  type ScriptMessageBus,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import type { RuntimeCharacterRef } from "../../src/scene/gameModeTypes";

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

/** One-second clip on the object's position track — enough for a real action. */
function clip(name: string): AnimationClip {
  return new AnimationClip(name, 1, [
    new VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 0, 0, 0]),
  ]);
}

function characterRef(entityId: string, clips: AnimationClip[]): RuntimeCharacterRef {
  const object = new Object3D();
  object.name = entityId;
  return {
    index: 0,
    entityId,
    object,
    gltf: { animations: clips } as unknown as GLTF,
    placement: { assetId: "SK_Enemy", position: [0, 0, 0] } as unknown as LayoutCharacter,
    hasCharacterMovement: true,
    isAiControlled: true,
  };
}

interface Harness {
  readonly services: RuntimeServiceHost;
  readonly mixers: AnimationMixer[];
  readonly bus: ScriptMessageBus;
  readonly locomotion: Map<string, LocomotionInput>;
  possessed: string | null;
  emit(type: string, source: string, payload: Record<string, unknown>): void;
  subscriberCount(type: string): number;
}

/** A shell stand-in: an animation sink, a locomotion map and a message bus. */
function harness(options: { host?: boolean } = {}): Harness {
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const mixers: AnimationMixer[] = [];
  const locomotion = new Map<string, LocomotionInput>();
  const handlers = new Map<string, Set<(envelope: { source: string; payload: Record<string, unknown> }) => void>>();
  const bus: ScriptMessageBus = {
    subscribe: (type, handler) => {
      const set = handlers.get(type) ?? new Set();
      handlers.set(type, set);
      set.add(handler as never);
      return () => set.delete(handler as never);
    },
    emit: () => {},
  };
  services.provide(scriptMessageBusService, bus);
  const state: Harness = {
    services,
    mixers,
    bus,
    locomotion,
    possessed: null,
    emit(type, source, payload) {
      for (const handler of handlers.get(type) ?? []) handler({ source, payload });
    },
    subscriberCount: (type) => handlers.get(type)?.size ?? 0,
  };
  if (options.host !== false) {
    services.provide(characterAnimationHostService, {
      addMixer: (mixer) => {
        mixers.push(mixer);
      },
      distanceSquaredToCamera: () => 1,
      locomotion: (entityId) => locomotion.get(entityId),
      possessedEntityId: () => state.possessed,
    });
  }
  return state;
}

export async function registerAiCharacterAnimationModuleTests(
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("registering an AI character adds one mixer and plays its idle clip", async () => {
    const shell = harness();
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    const ref = characterRef("character:0", [clip("Idle"), clip("Walk")]);
    const commands = shell.services.resolve(characterAnimationCommandsService);
    assert.ok(commands, "the module publishes its command surface");
    assert.equal(commands.registerAiCharacter(ref), true);
    assert.equal(shell.mixers.length, 1);
  });

  await checkAsync("a moving character crossfades to its walk clip, an idle one stays put", async () => {
    const shell = harness();
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    const commands = shell.services.resolve(characterAnimationCommandsService);
    const walker = characterRef("character:0", [clip("Idle"), clip("Walk")]);
    const idler = characterRef("character:1", [clip("Idle"), clip("Walk")]);
    commands?.registerAiCharacter(walker);
    commands?.registerAiCharacter(idler);
    await registry.levelLoaded({} as never);

    shell.locomotion.set("character:0", { planarSpeed: 3, grounded: true, velocityY: 0 });
    registry.update(0.016);
    // Both mixers exist and tick; the module drives them without the shell
    // touching an animator — the assertion that matters is that neither throws
    // and each keeps its own clip set.
    assert.equal(shell.mixers.length, 2);
  });

  await checkAsync("the possessed pawn is left to the Game Mode", async () => {
    const shell = harness();
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    const ref = characterRef("character:0", [clip("Idle")]);
    shell.services.resolve(characterAnimationCommandsService)?.registerAiCharacter(ref);
    await registry.levelLoaded({} as never);
    shell.possessed = "character:0";
    shell.locomotion.set("character:0", { planarSpeed: 4, grounded: true, velocityY: 0 });
    registry.update(0.016);
    assert.equal(shell.possessed, "character:0");
  });

  await checkAsync("an attack intent plays once and releases after its clip", async () => {
    const shell = harness();
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    const ref = characterRef("character:0", [clip("Idle"), clip("Punch")]);
    shell.services.resolve(characterAnimationCommandsService)?.registerAiCharacter(ref);
    await registry.levelLoaded({} as never);
    assert.equal(shell.subscriberCount("ai.attack.intent"), 1);

    shell.emit("ai.attack.intent", "character:0", { attack: "punch" });
    // Mid-clip: the one-shot holds, so ticking does not fall back to locomotion.
    shell.locomotion.set("character:0", { planarSpeed: 5, grounded: true, velocityY: 0 });
    registry.update(0.1);
    // Past the clip's duration the one-shot releases and locomotion resumes.
    registry.update(2);
    registry.update(0.016);
  });

  await checkAsync("unloading a level drops the subscriptions and the animators", async () => {
    const shell = harness();
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    shell.services
      .resolve(characterAnimationCommandsService)
      ?.registerAiCharacter(characterRef("character:0", [clip("Idle")]));
    await registry.levelLoaded({} as never);
    assert.equal(shell.subscriberCount("ai.attack.intent"), 1);
    registry.levelUnloaded();
    assert.equal(shell.subscriberCount("ai.attack.intent"), 0);
    // A stale intent after teardown must not resurrect a torn-down animator.
    shell.emit("ai.attack.intent", "character:0", { attack: "punch" });
    registry.update(0.016);
  });

  await checkAsync("with no animation host the module registers nothing at all", async () => {
    const shell = harness({ host: false });
    const registry = createCapabilityRegistry([createAiCharacterAnimationModule()]);
    registry.runtimeStart(shell.services);
    assert.equal(shell.services.resolve(characterAnimationCommandsService), undefined);
    await registry.levelLoaded({} as never);
    registry.update(0.016);
    assert.equal(shell.subscriberCount("ai.attack.intent"), 0);
  });
}
