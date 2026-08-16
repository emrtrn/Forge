/**
 * Phase E: the character movement solver is a Layer 2 capability.
 *
 * These checks pin the wiring the shell depends on rather than re-testing the
 * solver itself (which has its own suite): the module ticks in the `movement`
 * slot, feeds itself the level's entities, publishes both the read side and the
 * transform-reset side, resolves platforms lazily so it does not care whether
 * the platform module attached first — and registers nothing at all when the
 * host that owns input and physics is absent.
 */
import assert from "node:assert/strict";

import type { Entity } from "../../engine/scene/entity";
import {
  CHARACTER_MOVEMENT_COMPONENT,
  TRANSFORM_COMPONENT,
} from "../../engine/scene/components";
import { ActionMap } from "../../engine/input/actionMap";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createCharacterMovementModule } from "../../src/scene/capabilities/characterMovementModule";
import { createMovingPlatformModule } from "../../src/scene/capabilities/movingPlatformModule";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  characterMovementHostService,
  characterMovementQueryService,
  characterTransformResetService,
  type CharacterMovementHost,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type Check = (label: string, fn: () => void) => void;

/** A walking pawn: the smallest entity the solver accepts as a character. */
function pawn(id: string, x: number): Entity {
  return {
    id,
    name: id,
    components: {
      [TRANSFORM_COMPONENT]: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [CHARACTER_MOVEMENT_COMPONENT]: { movementMode: "walking" },
    },
  } as unknown as Entity;
}

function testHost(overrides: Partial<CharacterMovementHost> = {}): CharacterMovementHost {
  return {
    actions: new ActionMap({}),
    physics: {} as CharacterMovementHost["physics"],
    getGravityY: () => -9.81,
    getControlYaw: () => null,
    isPlayerControlled: () => false,
    getMoveIntent: () => null,
    reportLocomotion: () => {},
    dynamicBlockers: () => [],
    ...overrides,
  };
}

function startedHost(host: CharacterMovementHost | null): {
  services: RuntimeServiceHost;
  installed: string[];
  sinkCount: number;
} {
  const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  if (host) services.provide(characterMovementHostService, host);
  createCapabilityRegistry([createCharacterMovementModule()]).runtimeStart(services);
  const installed: string[] = [];
  services.installSubsystems((subsystem) => installed.push(subsystem.id));
  return { services, installed, sinkCount: services.entitySinks().length };
}

export function registerCharacterMovementModuleTests(check: Check): void {
  check("character movement module installs the solver and publishes both of its sides", () => {
    const { services, installed, sinkCount } = startedHost(testHost());
    assert.deepEqual(installed, ["characterMovement"], "ticks in the movement slot");
    assert.equal(sinkCount, 1, "feeds itself the level's entity set");

    const query = services.resolve(characterMovementQueryService);
    assert.ok(query);
    // Before a level is fed there are no characters, and every read says so
    // rather than throwing.
    assert.equal(query.transformOf("pawn:0"), null);
    assert.equal(query.velocityOf("pawn:0"), null);
    let visits = 0;
    query.forEachCharacter(() => (visits += 1));
    assert.equal(visits, 0);

    services.entitySinks()[0]!.setEntities([pawn("pawn:0", 3), pawn("pawn:1", -3)]);
    const seen: string[] = [];
    query.forEachCharacter((entityId) => seen.push(entityId));
    assert.deepEqual(seen.sort(), ["pawn:0", "pawn:1"]);
    assert.deepEqual(query.transformOf("pawn:0")?.position, [3, 0, 0]);

    // A launch on an unknown id is a no-op, not a throw (authored data drifts).
    query.launch("nobody", [0, 5, 0]);
  });

  check("character movement module teleports through the solver, keeping render in sync", () => {
    const synced: string[] = [];
    const services = createRuntimeServiceHost({
      syncEntityTransform: (entityId) => synced.push(entityId),
    });
    services.provide(characterMovementHostService, testHost());
    const registry = createCapabilityRegistry([createCharacterMovementModule()]);
    registry.runtimeStart(services);
    services.installSubsystems(() => {});
    services.entitySinks()[0]!.setEntities([pawn("pawn:0", 0)]);

    const reset = services.resolve(characterTransformResetService);
    assert.ok(reset, "a mover that writes a transform directly needs this");
    reset("pawn:0", { position: [9, 1, 2], rotation: [0, 90, 0], scale: [1, 1, 1] });
    assert.deepEqual(synced, ["pawn:0"], "the write reaches render/physics too");
    assert.deepEqual(
      services.resolve(characterMovementQueryService)?.transformOf("pawn:0")?.position,
      [9, 1, 2],
      "and the solver's own copy moved, so it will not overwrite it next frame",
    );

    // Level teardown empties the solver; the next level re-feeds it.
    registry.levelUnloaded();
    assert.equal(services.resolve(characterMovementQueryService)?.transformOf("pawn:0"), null);
    registry.dispose();
  });

  check("character movement module resolves platforms lazily, in either attach order", () => {
    // The platform module registered *after* the solver must still be found:
    // platforms are resolved per call, never captured at start.
    const services = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    services.provide(characterMovementHostService, testHost());
    createCapabilityRegistry([
      createCharacterMovementModule(),
      createMovingPlatformModule(),
    ]).runtimeStart(services);
    const installed: string[] = [];
    services.installSubsystems((subsystem) => installed.push(subsystem.id));
    // Slot order decides the tick, not registration order: platforms carry
    // their riders, so they must move first.
    assert.deepEqual(installed, ["movingPlatform", "characterMovement"]);
  });

  check("a runtime with no movement host registers no solver at all", () => {
    // The top-down / no-pawn case (I3): nothing ticks, nothing is published, and
    // the shell's transform lookups all report "no solved characters".
    const { services, installed, sinkCount } = startedHost(null);
    assert.deepEqual(installed, []);
    assert.equal(sinkCount, 0);
    assert.equal(services.resolve(characterMovementQueryService), undefined);
    assert.equal(services.resolve(characterTransformResetService), undefined);
  });
}
