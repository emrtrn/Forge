/**
 * Runtime/game behavior registry: concrete script id -> update function map.
 *
 * Game content lives here, not in the engine. Each behavior receives the engine
 * tick context, the input action map, its authored params, and a mutable entity
 * transform it may edit. The BehaviorSubsystem syncs the transform back to the
 * rendered object after each tick.
 */
import type {
  BehaviorRegistry,
  BehaviorUpdate,
} from "@engine/behavior/behaviorSubsystem";
import type { BehaviorRegistryHost } from "@engine/behavior/behaviorHost";
import { facingYawFromMove, planarMoveStep } from "@engine/movement/planarMovement";
import { groundedAt, stepVerticalMotion, type VerticalMotionState } from "@engine/movement/verticalMotion";
import { resolvePlanarMovement, type PlanarDelta } from "@engine/movement/characterCollision";
import {
  initialInteractionState,
  stepInteractionTrigger,
  type InteractionTriggerState,
} from "./interaction";

/**
 * Catalog of behavior script ids the runtime registry resolves. Authoring
 * surfaces (the Actor Script editor's Event Bindings) offer these as suggestions;
 * free-form ids are still allowed so an AI-authored behavior can be referenced
 * before it is registered here. Keep in sync with the `behaviors` map below.
 */
export const BEHAVIOR_SCRIPT_IDS = [
  "spin",
  "input-move",
  "collision-chime",
  "goal-reached",
  "level-travel",
  "checkpoint",
  "collectible",
  "interact",
  "use-toggleable",
  "lamp-toggle",
  "begin-conversation",
  "proximity-toggle",
  "velocity-gate",
  "apply-damage",
  "damage-zone",
  "raise-alert",
] as const;
export type BehaviorScriptId = (typeof BEHAVIOR_SCRIPT_IDS)[number];

/** Gravity used when the host does not inject one (e.g. headless tests). */
const DEFAULT_GRAVITY_Y = -9.81;

/**
 * Host-provided dependencies for the runtime behaviors. The contract itself is
 * engine-owned (the shell fills it in without importing the game); this alias
 * keeps the historic name for the call sites in this file and its tests.
 */
export type BehaviorRegistryOptions = BehaviorRegistryHost;

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boolParam(value: unknown): boolean {
  return value === true;
}

/** Spins an entity around one axis at `speedDeg` degrees per second. */
const spin: BehaviorUpdate = ({ engine, params, transform }) => {
  const speedDeg = numberParam(params.speedDeg, 90);
  const axis = params.axis === "x" ? 0 : params.axis === "z" ? 2 : 1;
  transform.rotation[axis] += speedDeg * engine.deltaSeconds;
};

/**
 * Moves an entity on the XZ plane from the named movement actions at `speed`
 * units per second. Demonstrates the spine driving gameplay from input.
 */
/** Plays the entity's authored audio cue once, immediately (no contact gating). */
function playAudioCue(context: Parameters<BehaviorUpdate>[0]): void {
  const { audio, audioComponent, transform } = context;
  if (!audio || !audioComponent) return;
  audio.playOneShot(audioComponent.clipId, {
    volume: audioComponent.volume,
    loop: audioComponent.loop,
    spatial: audioComponent.spatial,
    // A spatial cue is pinned at the emitter's position so the PannerNode +
    // listener give it direction/distance; non-spatial cues ignore position.
    ...(audioComponent.spatial
      ? { position: [transform.position[0], transform.position[1], transform.position[2]] as const }
      : {}),
  });
}

function triggerOverlapBegins(context: Parameters<BehaviorUpdate>[0]): boolean {
  const event = context.event;
  // An authored `overlap` event binding is authoritative: fire exactly on its
  // begin phase. Any other contact event (`hit`) is not an overlap-begin.
  // A `tick` invocation — the shape flat-Behavior fallback still used by legacy
  // trigger placements — carries a synthetic tick envelope (not `undefined`), so
  // it must route to contact polling here, or a `behavior: { script: "checkpoint"
  // | "level-travel" }` placed on a `shape:*` volume can never fire (the player
  // pawn overlaps the sensor but the tick branch used to short-circuit as "not an
  // overlap event"). The once-guard in each trigger keeps polling single-shot.
  if (event && event.kind !== "tick") {
    return event.kind === "overlap" && event.phase === "begin";
  }
  return (context.physics?.contactsForEntity(context.entityId).length ?? 0) > 0;
}

/**
 * Clamps a proposed planar move so the entity cannot enter static colliders,
 * using the AABBs the physics subsystem already derives. Falls back to the raw
 * move when there is no physics query, no blockers, or no collider on the entity.
 */
function resolvePlanarAgainstBlockers(
  context: Parameters<BehaviorUpdate>[0],
  planar: PlanarDelta,
): PlanarDelta {
  const { physics, entityId, transform } = context;
  if (!physics) return planar;
  const blockers = physics.staticBlockerAabbs();
  if (blockers.length === 0) return planar;
  const half = physics.colliderHalfExtents(entityId);
  if (!half) return planar;
  return resolvePlanarMovement(transform.position, planar, half, blockers);
}

/** Per-entity vertical motion state plus the floor height captured on entry. */
interface PlayerVertical {
  state: VerticalMotionState;
  floorY: number;
}

/**
 * Builds the runtime behavior registry used by the BehaviorSubsystem. Vertical
 * (gravity/jump) and one-shot trigger state is scoped to this registry instance,
 * so it starts fresh on each scene load and never leaks between scenes.
 */
export function createBehaviorRegistry(options: BehaviorRegistryOptions = {}): BehaviorRegistry {
  const getGravityY = options.getGravityY ?? (() => DEFAULT_GRAVITY_Y);
  const reportLocomotion = options.reportLocomotion;
  const onGoalReached = options.onGoalReached;
  const onInteraction = options.onInteraction;
  const onInteractionOverlap = options.onInteractionOverlap;
  const onActorLightToggle = options.onActorLightToggle;
  const onActorParticleEffect = options.onActorParticleEffect;
  const onLevelTravel = options.onLevelTravel;
  const onCheckpoint = options.onCheckpoint;
  const isPlayerControlled = options.isPlayerControlled ?? (() => true);
  const vertical = new Map<string, PlayerVertical>();
  const reachedGoals = new Set<string>();
  const traveledTriggers = new Set<string>();
  const checkpointsSaved = new Set<string>();
  const collisionAudioPlayed = new Set<string>();
  const interactions = new Map<string, InteractionTriggerState>();
  const interactionOverlaps = new Map<string, boolean>();

  const playCollisionAudioOnce = (context: Parameters<BehaviorUpdate>[0]): void => {
    const { audio, audioComponent, entityId, physics } = context;
    if (!audio || !audioComponent) return;
    if ((physics?.contactsForEntity(entityId).length ?? 0) === 0) return;
    if (collisionAudioPlayed.has(entityId)) return;
    collisionAudioPlayed.add(entityId);
    playAudioCue(context);
  };

  const collisionChime: BehaviorUpdate = playCollisionAudioOnce;

  const inputMove: BehaviorUpdate = (context) => {
    // Only the possessed pawn responds to input. An authored `input-move`
    // character left unpossessed (e.g. under the default camera Game Mode) stays
    // exactly where it was placed instead of drifting on WASD.
    if (!isPlayerControlled(context.entityId)) return;

    const { engine, actions, params, transform } = context;

    // Planar movement (G1) resolved against static blockers (G3), then facing.
    // Holding sprint scales the base speed so the run animation state (G5) can
    // be reached; the intended (pre-collision) speed drives the animation.
    const baseSpeed = numberParam(params.speed, 3);
    const speed = actions.held("sprint")
      ? baseSpeed * numberParam(params.sprintMultiplier, 2)
      : baseSpeed;
    const planar = planarMoveStep(
      {
        forward: actions.held("move-forward"),
        back: actions.held("move-back"),
        left: actions.held("move-left"),
        right: actions.held("move-right"),
      },
      speed,
      engine.deltaSeconds,
    );
    const { dx, dz } = resolvePlanarAgainstBlockers(context, planar);
    transform.position[0] += dx;
    transform.position[2] += dz;
    const yaw = facingYawFromMove(dx, dz);
    if (yaw !== null) transform.rotation[1] = yaw;

    // Gravity + jump (G2). The first tick captures the authored height as the
    // floor the entity rests on and jumps from.
    let runtime = vertical.get(context.entityId);
    if (!runtime) {
      const floorY = transform.position[1];
      runtime = { state: groundedAt(floorY), floorY };
      vertical.set(context.entityId, runtime);
    }
    runtime.state = stepVerticalMotion(runtime.state, {
      gravityY: getGravityY(),
      jumpSpeed: numberParam(params.jumpSpeed, 4),
      floorY: runtime.floorY,
      dt: engine.deltaSeconds,
      jump: actions.pressed("jump"),
    });
    transform.position[1] = runtime.state.y;

    // Report the movement snapshot (G5) so the shell can pick a clip. Speed is
    // the intended planar speed (before collision), so pushing into a wall still
    // animates as walking/running rather than freezing to idle.
    reportLocomotion?.(context.entityId, {
      planarSpeed: engine.deltaSeconds > 0 ? Math.hypot(planar.dx, planar.dz) / engine.deltaSeconds : 0,
      grounded: runtime.state.grounded,
      velocityY: runtime.state.velocityY,
    });

    playCollisionAudioOnce(context);
  };

  // Goal trigger (G6): a sensor-collider entity whose overlap-begin event plays
  // its audio cue once and signals the shell. Legacy flat Behavior components
  // still fall back to contact polling for existing layout content.
  const goalReached: BehaviorUpdate = (context) => {
    if (reachedGoals.has(context.entityId)) return;
    if (!triggerOverlapBegins(context)) return;
    reachedGoals.add(context.entityId);
    playAudioCue(context);
    onGoalReached?.(context.entityId);
  };

  // Level Travel trigger (P2): a sensor-collider entity whose overlap-begin event
  // requests travel to another level. It fires exactly once per scene, so the
  // teardown/rebuild the shell kicks off is never re-entered by a lingering
  // overlap. `targetLevel` is the destination layout path; the optional
  // `targetSpawn` picks a tagged Player Start there. A trigger without a
  // `targetLevel` is inert. Legacy flat Behavior components still fall back to
  // contact polling for existing layout content.
  const levelTravel: BehaviorUpdate = (context) => {
    if (traveledTriggers.has(context.entityId)) return;
    if (!triggerOverlapBegins(context)) return;
    const targetLevel = stringParam(context.params.targetLevel);
    if (!targetLevel) return;
    traveledTriggers.add(context.entityId);
    playAudioCue(context);
    const targetSpawn = stringParam(context.params.targetSpawn);
    onLevelTravel?.(context.entityId, targetLevel, targetSpawn ?? undefined);
  };

  // Checkpoint trigger (P3.6): a sensor-collider entity whose overlap-begin event
  // writes an autosave. Legacy flat Behavior components still fall back to the old
  // goal-reached contact + once pattern so it saves exactly once per scene visit —
  // a lingering overlap never spams the storage layer. `params.slot` names the
  // save slot; it defaults to `"quick"` so the built-in load menu can restore it.
  // The host owns serialization + the actual write.
  const checkpoint: BehaviorUpdate = (context) => {
    if (checkpointsSaved.has(context.entityId)) return;
    if (!triggerOverlapBegins(context)) return;
    checkpointsSaved.add(context.entityId);
    playAudioCue(context);
    const slot = stringParam(context.params.slot) ?? "quick";
    onCheckpoint?.(context.entityId, slot);
  };

  // Collectible pickup (P3.7): a sensor-collider entity the player collects on
  // contact. The `collected` flag is persisted (opt-in), so a save-game restores
  // it: on a fresh scene the behavior sees the restored flag and re-hides the
  // pickup without a contact. The `hidden` latch lives in ScriptState (cleared on
  // every setEntities), not a registry closure, so hiding fires exactly once per
  // scene build — on the pickup tick and again after a restore. Hiding goes
  // through the generic actor command (`setVisibility(false)` → host sink, A1);
  // it is idempotent, so an extra call is harmless. Persistence stays the
  // behavior's own `collected` flag (not the command's `persist`), so the
  // re-hide-on-restore semantics are unchanged.
  const collectible: BehaviorUpdate = (context) => {
    if (context.state.get("collected", false)) {
      if (!context.state.get("hidden", false)) {
        context.state.set("hidden", true);
        context.actor.setVisibility(false);
      }
      return;
    }
    if ((context.physics?.contactsForEntity(context.entityId).length ?? 0) === 0) return;
    context.state.persist("collected", true);
    context.state.set("hidden", true);
    playCollisionAudioOnce(context);
    context.actor.setVisibility(false);
    context.messages.emit("Collectible.Collected", { entityId: context.entityId });
  };

  // Interaction trigger (§3): an interaction-marked sensor entity whose first
  // contact with the kinematic player fires its action (host-interpreted),
  // playing the optional audio cue. Re-fires on a fresh re-enter once any
  // authored cooldown elapses. Reuses the goal-reached sensor + contact pattern,
  // with the edge/cooldown logic in the pure `stepInteractionTrigger` core.
  const interact: BehaviorUpdate = (context) => {
    const interaction = context.interactionComponent;
    if (!interaction) return;
    const prev = interactions.get(context.entityId) ?? initialInteractionState();
    const overlapping = (context.physics?.contactsForEntity(context.entityId).length ?? 0) > 0;
    const wasOverlapping = interactionOverlaps.get(context.entityId) ?? false;
    if (overlapping !== wasOverlapping) {
      interactionOverlaps.set(context.entityId, overlapping);
      onInteractionOverlap?.(
        context.entityId,
        interaction.action,
        interaction.prompt,
        overlapping,
      );
    }
    const inputAction = stringParam(context.params.inputAction);
    const result = stepInteractionTrigger(prev, {
      overlapping: inputAction ? overlapping && context.actions.pressed(inputAction) : overlapping,
      enabled: interaction.enabled ?? true,
      cooldown: interaction.cooldown ?? 0,
      dt: context.engine.deltaSeconds,
    });
    interactions.set(context.entityId, result.state);
    if (!result.fire) return;
    playAudioCue(context);
    const payload: Record<string, unknown> = {
      entityId: context.entityId,
      action: interaction.action,
    };
    if (interaction.prompt !== undefined) payload.prompt = interaction.prompt;
    const usableTargets = context.world.withInterface("Usable");
    const usableTarget = usableTargets.includes(context.entityId)
      ? context.entityId
      : context.world.nearestWithInterface(
          "Usable",
          context.entityId,
          numberParam(context.params.useRange, 2),
        );
    if (usableTarget) context.messages.send(usableTarget, "Usable.Use", payload);
    context.messages.emit("Interaction.Activated", payload);
    context.messages.emit(`Interaction.${interaction.action}`, payload);
    onInteraction?.(context.entityId, interaction.action);
  };

  const useToggleable: BehaviorUpdate = (context) => {
    context.messages.send(context.entityId, "Toggleable.Toggle", {
      source: context.message?.source ?? context.entityId,
    });
  };

  const lampToggle: BehaviorUpdate = (context) => {
    const enabled = context.state.toggle("enabled", true);
    context.state.persist("enabled", enabled);
    onActorLightToggle?.(context.entityId, enabled);
    onActorParticleEffect?.(context.entityId);
    context.messages.emit("Lamp.Toggled", { enabled });
  };

  // Conversation bridge (§D3): emits the `start-conversation` script message the
  // runtime's ConversationDirector subscribes to, using the `conversationId`
  // param. Bind it to an NPC's interaction event (e.g. `Interaction.Talk`) via a
  // Message Binding so talking to the NPC starts its conversation graph. Kept
  // generic — no conversation content lives here, only the trigger.
  const beginConversation: BehaviorUpdate = (context) => {
    const conversationId = stringParam(context.params.conversationId);
    if (!conversationId) return;
    context.messages.emit("start-conversation", { conversationId });
  };

  // A3 ScriptWorld example: finds a tagged target, reads the self->target
  // distance via the read-only world query API, and emits an edge only when the
  // target crosses the configured range. Game rules can bind to
  // `Proximity.Changed`; the behavior owns no project-specific outcome.
  const proximityToggle: BehaviorUpdate = (context) => {
    const targetTag = stringParam(context.params.targetTag) ?? "player";
    const target = context.world.byTag(targetTag)[0];
    if (!target) return;
    const range = numberParam(context.params.range, 2);
    const near = (context.world.distanceTo(target) ?? Infinity) <= range;
    if (context.state.get("near", false) === near) return;
    context.state.set("near", near);
    context.messages.emit("Proximity.Changed", {
      entityId: context.entityId,
      target,
      near,
    });
  };

  // A6 velocity example: reads the entity's own world velocity (Unreal
  // GetVelocity) via the read-only `world.velocityOf` provider and emits a
  // `Velocity.Changed` edge when its speed crosses the configured threshold. Game
  // rules bind to the message (e.g. play a run VFX above speed); the behavior
  // itself owns no project outcome. Inert when no velocity source is wired.
  const velocityGate: BehaviorUpdate = (context) => {
    const velocity = context.world.velocityOf(context.entityId);
    if (!velocity) return;
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const threshold = numberParam(context.params.speedThreshold, 1);
    const moving = speed >= threshold;
    if (context.state.get("moving", false) === moving) return;
    context.state.set("moving", moving);
    context.messages.emit("Velocity.Changed", {
      entityId: context.entityId,
      speed,
      moving,
    });
  };

  // A6 damage convention (receiver). The `Damage.Apply` message standard: a
  // sender routes damage to a target actor with `context.messages.send(target,
  // "Damage.Apply", { amount, instigator?, damageType? })`. This template behavior
  // is bound to that message (target `self`), tracks health in ScriptState from the
  // `maxHealth` param, subtracts the incoming amount, and re-broadcasts the result
  // as `Health.Changed`; on depletion it emits `Damage.Died` and (opt-in) destroys
  // the actor. Generic on purpose — a fork owns the concrete health rules/UI by
  // binding to `Health.Changed`/`Damage.Died`, not by editing the engine.
  const applyDamage: BehaviorUpdate = (context) => {
    const payload = context.message?.payload;
    const amount = numberParam(payload?.amount, 0);
    if (amount <= 0) return;
    const maxHealth = numberParam(context.params.maxHealth, 100);
    const current = numberParam(context.state.get("health", maxHealth), maxHealth);
    if (current <= 0) return; // already dead — ignore further damage
    const next = Math.max(0, current - amount);
    context.state.set("health", next);
    if (boolParam(context.params.persistHealth)) context.state.persist("health", next);
    const rawInstigator = payload?.instigator;
    const instigator =
      (typeof rawInstigator === "string" && rawInstigator) ||
      context.message?.source ||
      context.entityId;
    context.messages.emit("Health.Changed", {
      entityId: context.entityId,
      health: next,
      maxHealth,
      delta: -amount,
      instigator,
    });
    if (next <= 0) {
      context.messages.emit("Damage.Died", { entityId: context.entityId, instigator });
      if (boolParam(context.params.destroyOnDeath)) context.actor.destroy();
    }
  };

  // A6 damage convention (sender): a hazard/projectile actor that deals damage to
  // whatever it touches. On a begin overlap or hit edge it routes `params.damage`
  // to the other actor via the `Damage.Apply` standard, tagging itself as the
  // instigator. A per-target `once` latch (opt-in) makes it a one-shot per victim
  // (projectile), otherwise every fresh contact re-applies (walk-in spikes).
  const damageZone: BehaviorUpdate = (context) => {
    const event = context.event;
    if (!event || event.phase !== "begin") return;
    if (event.kind !== "overlap" && event.kind !== "hit") return;
    const other = event.otherEntityId;
    if (!other) return;
    const amount = numberParam(context.params.damage, 10);
    if (amount <= 0) return;
    if (boolParam(context.params.once)) {
      if (context.state.get(`hit:${other}`, false)) return;
      context.state.set(`hit:${other}`, true);
    }
    const payload: Record<string, unknown> = { amount, instigator: context.entityId };
    const damageType = stringParam(context.params.damageType);
    if (damageType) payload.damageType = damageType;
    context.messages.send(other, "Damage.Apply", payload);
  };

  // Turns an interaction into an AI-perceivable `alert` gameplay stimulus at this
  // actor's own location. Bind it via a Message Binding on the actor's interaction
  // message (e.g. `Interaction.Activated`, target `any`) so triggering the actor
  // trips an alarm: the AI script-stimulus bridge (SceneApp/RuntimeSceneApp)
  // converts the emitted `alert` into an `alert` perception sense for every AI
  // within hearing range, and `forge.updatePerceptionBlackboard` writes it to the
  // listener's `lastStimulus*` keys. The self-source guard keeps multiple alarm
  // points independent (an actor only re-broadcasts its own interaction, never a
  // sibling's). Generic on purpose — the alarm owns no reaction; each AI decides
  // via its behavior tree.
  const raiseAlert: BehaviorUpdate = (context) => {
    if (context.message && context.message.source !== context.entityId) return;
    const payload: Record<string, unknown> = {};
    const urgency = stringParam(context.params.urgency);
    if (urgency) payload.urgency = urgency;
    context.messages.emit("alert", payload);
  };

  const behaviors = new Map<string, BehaviorUpdate>([
    ["spin", spin],
    ["input-move", inputMove],
    ["collision-chime", collisionChime],
    ["goal-reached", goalReached],
    ["level-travel", levelTravel],
    ["checkpoint", checkpoint],
    ["collectible", collectible],
    ["interact", interact],
    ["use-toggleable", useToggleable],
    ["lamp-toggle", lampToggle],
    ["begin-conversation", beginConversation],
    ["proximity-toggle", proximityToggle],
    ["velocity-gate", velocityGate],
    ["apply-damage", applyDamage],
    ["damage-zone", damageZone],
    ["raise-alert", raiseAlert],
  ]);
  return { get: (scriptId) => behaviors.get(scriptId) };
}
