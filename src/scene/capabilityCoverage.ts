/**
 * Phase G: tells the player's console what a level authored that this runtime
 * cannot run (plan invariant I5, runtime half).
 *
 * Layer 2 capabilities are opt-in, and switching one off is meant to remove only
 * that behavior — the level's scene content still builds in full (I3). But the
 * *authored data* for a switched-off capability then does nothing at all, and
 * silence there is indistinguishable from a bug: "I placed an emitter and no
 * particles appear". So a level build reports each such gap once, by name:
 *
 *   [runtime] Unsupported runtime capability: "vfx" is not registered, so 3
 *   authored ParticleEmitter component(s) in this level do nothing.
 *
 * This is a diagnostic, never a failure: a fork that deliberately drops a
 * capability (a top-down RTS with no character movement) is doing the supported
 * thing, and the message tells whoever opens the console *why* the data is inert
 * rather than leaving them to guess.
 */
import {
  AI_CONTROLLER_COMPONENT,
  AUDIO_COMPONENT,
  BEHAVIOR_COMPONENT,
  CHARACTER_MOVEMENT_COMPONENT,
  MOVING_PLATFORM_COMPONENT,
  PARTICLE_EMITTER_COMPONENT,
  SPLINE_PATH_FOLLOWER_COMPONENT,
  readBehaviorComponent,
} from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { RoomLayout } from "@engine/scene/layout";

/** One authored feature, the capability that runs it, and how to spot it. */
interface CoverageRule {
  /** Capability module id, as registered with the runtime. */
  readonly moduleId: string;
  /** What the level authored, in the words the editor uses for it. */
  readonly authored: string;
  /** How many times this level authored it. */
  count(entities: readonly Entity[], layout: RoomLayout): number;
}

function componentRule(moduleId: string, component: string): CoverageRule {
  return {
    moduleId,
    authored: `${component} component`,
    count: (entities) =>
      entities.reduce((total, entity) => (entity.components[component] ? total + 1 : total), 0),
  };
}

/** Behavior scripts whose whole effect is to call into one capability. */
function behaviorRule(moduleId: string, authored: string, scriptIds: readonly string[]): CoverageRule {
  const wanted = new Set(scriptIds);
  return {
    moduleId,
    authored,
    count: (entities) =>
      entities.reduce((total, entity) => {
        const behavior = readBehaviorComponent(entity);
        return behavior && wanted.has(behavior.scriptId) ? total + 1 : total;
      }, 0),
  };
}

const COVERAGE_RULES: readonly CoverageRule[] = [
  componentRule("audio", AUDIO_COMPONENT),
  componentRule("vfx", PARTICLE_EMITTER_COMPONENT),
  componentRule("ai", AI_CONTROLLER_COMPONENT),
  componentRule("character-movement", CHARACTER_MOVEMENT_COMPONENT),
  componentRule("moving-platform", MOVING_PLATFORM_COMPONENT),
  componentRule("spline-follower", SPLINE_PATH_FOLLOWER_COMPONENT),
  behaviorRule("dialogue", "conversation trigger", ["begin-conversation"]),
  behaviorRule("save-game", "checkpoint trigger", ["checkpoint"]),
  {
    moduleId: "runtime-ui",
    authored: "UI widget in World Settings",
    count: (_entities, layout) => {
      const settings = layout.worldSettings;
      if (!settings) return 0;
      return [
        settings.hudWidget,
        settings.pauseMenuWidget,
        settings.winScreenWidget,
        settings.loseScreenWidget,
      ].filter((widget) => typeof widget === "string" && widget.length > 0).length;
    },
  },
];

export interface CapabilityCoverageInput {
  /** The entity set the level was built from (already includes actor entities). */
  readonly entities: readonly Entity[];
  /** The authored layout, for the level-wide settings no entity carries. */
  readonly layout: RoomLayout;
  /** Capability module ids registered with this runtime. */
  readonly registered: readonly string[];
  /**
   * Whether a Layer 3 game module published a behavior catalog. Behavior scripts
   * are game content, so a runtime with no game module resolves every authored
   * `Behavior` component to nothing — correct, but worth saying out loud for the
   * same reason a switched-off capability is.
   */
  readonly hasBehaviorRegistry?: boolean;
}

/**
 * One warning line per capability this level needs and this runtime does not
 * have. Empty when every authored feature has its capability registered — which
 * is the normal case for the template's own default module set.
 */
export function collectUnsupportedCapabilities(input: CapabilityCoverageInput): string[] {
  const registered = new Set(input.registered);
  const warnings: string[] = [];
  for (const rule of COVERAGE_RULES) {
    if (registered.has(rule.moduleId)) continue;
    const count = rule.count(input.entities, input.layout);
    if (count === 0) continue;
    warnings.push(
      `Unsupported runtime capability: "${rule.moduleId}" is not registered, so ${count} authored ${rule.authored}(s) in this level do nothing.`,
    );
  }
  if (input.hasBehaviorRegistry === false) {
    const scripted = input.entities.filter(
      (entity) => entity.components[BEHAVIOR_COMPONENT] !== undefined,
    ).length;
    if (scripted > 0) {
      warnings.push(
        `No behavior catalog registered: ${scripted} authored behavior script(s) in this level do nothing. Behavior scripts are game content — a Layer 3 game module publishes the catalog.`,
      );
    }
  }
  return warnings;
}

/** Prints the report to the console. No-op when the level is fully covered. */
export function reportUnsupportedCapabilities(input: CapabilityCoverageInput): string[] {
  const warnings = collectUnsupportedCapabilities(input);
  for (const warning of warnings) console.warn(`[runtime] ${warning}`);
  return warnings;
}
