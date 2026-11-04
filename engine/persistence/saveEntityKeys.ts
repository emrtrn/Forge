/**
 * What an actor is called inside a save.
 *
 * At runtime an actor is `actor:<index>`, its place in `layout.actors`. That
 * index moves: editing a level shifts it, and in a World Partition level adding
 * an actor to one cell renumbers the actors of the cells after it. A save
 * outlives such edits, so it names an actor by `LayoutActorInstance.id` instead,
 * and these keys translate at the save boundary. Everything between the two ends
 * keeps using the runtime id.
 *
 * An actor without an id keeps its runtime id in the save, as every save written
 * before ids did. Those stay readable.
 */
import { actorInstanceEntityId } from "../scene/actorInstance";

/** A saved actor reference: this prefix and the actor's `id`. */
export const SAVED_ACTOR_PREFIX = "actor-id:";

export interface SaveEntityKeys {
  /** The name a save uses for a runtime entity. */
  toSaved(entityId: string): string;
  /** The runtime entity a save's name means here; null = that actor left the level. */
  toRuntime(saved: string): string | null;
}

/** Keys for this level's actors. Where two share an id the first has it; the other stays by index. */
export function createSaveEntityKeys(actors: readonly { readonly id?: string }[]): SaveEntityKeys {
  const entityById = new Map<string, string>();
  const idByEntity = new Map<string, string>();
  actors.forEach((actor, index) => {
    if (actor.id === undefined || entityById.has(actor.id)) return;
    const entityId = actorInstanceEntityId(index);
    entityById.set(actor.id, entityId);
    idByEntity.set(entityId, actor.id);
  });
  return {
    toSaved: (entityId) => {
      const id = idByEntity.get(entityId);
      return id === undefined ? entityId : `${SAVED_ACTOR_PREFIX}${id}`;
    },
    toRuntime: (saved) => (saved.startsWith(SAVED_ACTOR_PREFIX)
      ? entityById.get(saved.slice(SAVED_ACTOR_PREFIX.length)) ?? null
      : saved),
  };
}

/** Renames a list's entities; `rename` returning null drops the entry. */
export function rekeyEntries<T extends { readonly entityId: string }>(
  entries: readonly T[],
  rename: (entityId: string) => string | null,
): T[] {
  return entries.flatMap((entry) => {
    const entityId = rename(entry.entityId);
    return entityId === null ? [] : [{ ...entry, entityId }];
  });
}
