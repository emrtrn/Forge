/**
 * Phase G: a switched-off capability must say so, not go quiet (plan I5).
 *
 * The checks pin what a level build reports when its authored data has no
 * capability to run it, and — just as important — that the template's own
 * default module set reports nothing at all, so the message stays a signal
 * rather than console noise every fork learns to ignore.
 */
import assert from "node:assert/strict";

import {
  AI_CONTROLLER_COMPONENT,
  AUDIO_COMPONENT,
  CHARACTER_MOVEMENT_COMPONENT,
  BEHAVIOR_COMPONENT,
  PARTICLE_EMITTER_COMPONENT,
} from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { RoomLayout } from "../../engine/scene/layout";
import { collectUnsupportedCapabilities } from "../../src/scene/capabilityCoverage";
import { createDefaultRuntimeModules } from "../../src/scene/capabilities/defaultRuntimeModules";

type Check = (label: string, fn: () => void) => void;

function entity(id: string, components: Record<string, Record<string, unknown>>): Entity {
  return { id, components } as unknown as Entity;
}

const EMPTY_LAYOUT = { name: "test" } as unknown as RoomLayout;

export function registerCapabilityCoverageTests(check: Check): void {
  check("an authored emitter with no vfx capability is reported by name", () => {
    const warnings = collectUnsupportedCapabilities({
      entities: [
        entity("actor:0", { [PARTICLE_EMITTER_COMPONENT]: { effectId: "FX_Fire" } }),
        entity("actor:1", { [PARTICLE_EMITTER_COMPONENT]: { effectId: "FX_Fire" } }),
      ],
      layout: EMPTY_LAYOUT,
      registered: ["audio", "ai"],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Unsupported runtime capability: "vfx"/);
    assert.match(warnings[0] ?? "", /2 authored ParticleEmitter component\(s\)/);
  });

  check("registering the capability silences its warning", () => {
    const entities = [entity("actor:0", { [AUDIO_COMPONENT]: { soundId: "S_Hum" } })];
    assert.equal(
      collectUnsupportedCapabilities({ entities, layout: EMPTY_LAYOUT, registered: ["audio"] })
        .length,
      0,
    );
    assert.equal(
      collectUnsupportedCapabilities({ entities, layout: EMPTY_LAYOUT, registered: [] }).length,
      1,
    );
  });

  check("level-wide settings count too: a HUD widget needs the runtime-ui capability", () => {
    const layout = {
      name: "test",
      worldSettings: { hudWidget: "UI_Hud", pauseMenuWidget: "UI_Pause" },
    } as unknown as RoomLayout;
    const warnings = collectUnsupportedCapabilities({ entities: [], layout, registered: [] });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /"runtime-ui".*2 authored UI widget in World Settings/);
  });

  check("behavior-driven capabilities are spotted through their script id", () => {
    const warnings = collectUnsupportedCapabilities({
      entities: [
        entity("actor:0", { [BEHAVIOR_COMPONENT]: { scriptId: "checkpoint" } }),
        entity("actor:1", { [BEHAVIOR_COMPONENT]: { scriptId: "spin" } }),
      ],
      layout: EMPTY_LAYOUT,
      registered: [],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /"save-game".*1 authored checkpoint trigger/);
  });

  check("a runtime with no behavior catalog says its authored scripts are inert", () => {
    const entities = [
      entity("actor:0", { [BEHAVIOR_COMPONENT]: { scriptId: "spin" } }),
      entity("actor:1", { [BEHAVIOR_COMPONENT]: { scriptId: "spin" } }),
    ];
    const warnings = collectUnsupportedCapabilities({
      entities,
      layout: EMPTY_LAYOUT,
      registered: [],
      hasBehaviorRegistry: false,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /No behavior catalog registered: 2 authored behavior script/);
    // With a game module publishing the catalog, nothing is reported.
    assert.deepEqual(
      collectUnsupportedCapabilities({
        entities,
        layout: EMPTY_LAYOUT,
        registered: [],
        hasBehaviorRegistry: true,
      }),
      [],
    );
  });

  check("a level with nothing authored for a missing capability stays quiet", () => {
    assert.deepEqual(
      collectUnsupportedCapabilities({ entities: [], layout: EMPTY_LAYOUT, registered: [] }),
      [],
    );
  });

  check("the template's default capability set covers every rule", () => {
    const registered = createDefaultRuntimeModules().map((module) => module.id);
    const entities = [
      entity("actor:0", { [PARTICLE_EMITTER_COMPONENT]: {} }),
      entity("actor:1", { [AUDIO_COMPONENT]: {} }),
      entity("actor:2", { [AI_CONTROLLER_COMPONENT]: {} }),
      entity("actor:3", { [CHARACTER_MOVEMENT_COMPONENT]: {} }),
      entity("actor:4", { [BEHAVIOR_COMPONENT]: { scriptId: "checkpoint" } }),
      entity("actor:5", { [BEHAVIOR_COMPONENT]: { scriptId: "begin-conversation" } }),
    ];
    const layout = {
      name: "test",
      worldSettings: { hudWidget: "UI_Hud" },
    } as unknown as RoomLayout;
    assert.deepEqual(collectUnsupportedCapabilities({ entities, layout, registered }), []);
  });
}
