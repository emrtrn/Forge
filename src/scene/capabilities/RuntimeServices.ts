/**
 * What a Layer 2 capability module receives once, when the runtime shell is
 * constructed — before any level exists.
 *
 * {@link RuntimeContext} answers "what is in the level that was just built";
 * this answers "how do I attach to the runtime at all": queue an engine
 * subsystem into a tick slot, ask to be fed the level's entity set, and publish
 * or look up a narrow service so two modules can cooperate without importing
 * each other (the loose coupling the layered runtime plan asks for).
 *
 * The container the shell owns ({@link RuntimeServiceHost}) additionally drains
 * those queues; modules never see that side.
 */
import type { Subsystem } from "@engine/core/Subsystem";
import type { PhysicsTransformSink } from "@engine/physics/physicsSubsystem";

import type { SceneEntitySink } from "../SceneRuntimeCore";

/**
 * Tick order as a named contract rather than an implicit registration sequence.
 *
 * Subsystem update order is real behavior — a platform must move before its
 * rider is solved, an explicit spline route must win over an AI move intent —
 * and once subsystems live in independently registered modules, "whoever
 * registered first ticks first" is no longer something a fork can reason about.
 * Slots pin the order to the meaning of the work; within one slot, registration
 * order still decides (Unreal's tick groups, scaled down).
 */
export const RUNTIME_TICK_SLOTS = [
  /** Sampling the outside world: animation, input devices. */
  "pre-physics",
  /** The rigid-body step. */
  "physics",
  /** Kinematic carriers (moving platforms) — before movement, so riders get this frame's delta. */
  "platform",
  /** Decisions that produce intents for this frame: AI. */
  "decision",
  /** Movement solvers that consume those intents: character movement. */
  "movement",
  /** Explicit route owners that must win over the solvers above: spline followers. */
  "post-movement",
  /** Scripted gameplay reacting to the resolved world: behaviors. */
  "gameplay",
  /** Output-only systems: audio, dialogue, VFX. */
  "presentation",
] as const;

export type RuntimeTickSlot = (typeof RUNTIME_TICK_SLOTS)[number];

/**
 * Typed handle for one shared runtime service. The phantom `value` field only
 * carries the type — a key is compared by `id`, never by identity, so a module
 * and its consumer can import the key from one place and stay decoupled.
 */
export interface RuntimeServiceKey<T> {
  readonly id: string;
  /** Type carrier only; never read at runtime. */
  readonly value?: T;
}

export function runtimeServiceKey<T>(id: string): RuntimeServiceKey<T> {
  return { id };
}

export interface RuntimeServices {
  /** Writes an entity transform through to render, physics and AI in one call. */
  readonly syncEntityTransform: PhysicsTransformSink;

  /**
   * Queues an engine subsystem for registration in the given tick slot. The
   * shell installs every queued subsystem in slot order once construction is
   * complete, so a module never depends on when it happened to be started.
   */
  addSubsystem(slot: RuntimeTickSlot, subsystem: Subsystem): void;

  /**
   * Registers a sink that receives the level's derived entity set each time a
   * level is built, before the engine spine initialises.
   */
  addEntitySink(sink: SceneEntitySink): void;

  /** Publishes a service other modules (or the shell) may resolve. */
  provide<T>(key: RuntimeServiceKey<T>, value: T): void;

  /**
   * Looks a service up, or `undefined` when nothing provides it — which is the
   * normal case for an opted-out module, not an error. Resolve lazily (at call
   * time) when the provider may be registered after you.
   */
  resolve<T>(key: RuntimeServiceKey<T>): T | undefined;
}

/** The shell-side view: everything modules see, plus draining the queues. */
export interface RuntimeServiceHost extends RuntimeServices {
  /**
   * Registers every queued subsystem on the engine app, ordered by tick slot
   * and, within a slot, by the order it was queued. Call once, after all
   * modules have started and the shell's own subsystems are queued.
   */
  installSubsystems(register: (subsystem: Subsystem) => void): void;

  /** Every registered entity sink, in registration order. */
  entitySinks(): readonly SceneEntitySink[];
}

export interface RuntimeServiceHostInit {
  readonly syncEntityTransform: PhysicsTransformSink;
}

export function createRuntimeServiceHost(init: RuntimeServiceHostInit): RuntimeServiceHost {
  const queued: { slot: RuntimeTickSlot; subsystem: Subsystem }[] = [];
  const sinks: SceneEntitySink[] = [];
  const services = new Map<string, unknown>();
  let installed = false;

  return {
    syncEntityTransform: init.syncEntityTransform,

    addSubsystem(slot, subsystem) {
      if (installed) {
        throw new Error(
          `Subsystem "${subsystem.id}" was queued after the tick order was installed.`,
        );
      }
      queued.push({ slot, subsystem });
    },

    addEntitySink(sink) {
      sinks.push(sink);
    },

    provide(key, value) {
      // A silently replaced service is the same class of bug as a duplicate
      // module id: the second provider wins invisibly and the first capability
      // stops working with no trace (I5).
      if (services.has(key.id)) {
        throw new Error(`Duplicate runtime service: "${key.id}".`);
      }
      services.set(key.id, value);
    },

    resolve<T>(key: RuntimeServiceKey<T>): T | undefined {
      return services.get(key.id) as T | undefined;
    },

    installSubsystems(register) {
      installed = true;
      for (const slot of RUNTIME_TICK_SLOTS) {
        for (const entry of queued) {
          if (entry.slot === slot) register(entry.subsystem);
        }
      }
    },

    entitySinks() {
      return sinks;
    },
  };
}
