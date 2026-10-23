import type { Entity, EntityId } from "../scene/entity";
import { readSmartObjectComponent } from "../scene/components";

export interface SmartObjectReservation {
  readonly entityId: EntityId;
  readonly slotId: string | null;
  readonly reservedBy: EntityId;
  readonly state: "claimed" | "inUse";
  readonly expiresAt: number | null;
}

export interface SmartObjectClaimInput {
  readonly entityId: EntityId;
  readonly reservedBy: EntityId;
  readonly slotId?: string | null;
  readonly ttlSeconds?: number | null;
  readonly nowSeconds?: number;
}

export interface SmartObjectReleaseInput {
  readonly entityId: EntityId;
  readonly reservedBy?: EntityId;
  readonly slotId?: string | null;
}

export interface SmartObjectReservationQuery {
  isReserved(entityId: EntityId, slotId?: string | null, requesterId?: EntityId): boolean;
  reservation(entityId: EntityId, slotId?: string | null): SmartObjectReservation | null;
}

export interface SmartObjectRuntime extends SmartObjectReservationQuery {
  claim(input: SmartObjectClaimInput): boolean;
  use(input: SmartObjectClaimInput): boolean;
  release(input: SmartObjectReleaseInput): boolean;
  expire(nowSeconds: number): number;
}

/**
 * Runtime-only Smart Object claim state. Authored SmartObjectComponent data stays
 * immutable; this store tracks which AI currently owns a claim/use slot.
 */
export class SmartObjectReservationStore implements SmartObjectRuntime {
  private readonly reservations = new Map<string, SmartObjectReservation>();
  private validSlots = new Set<string>();
  private slotKeysByEntity = new Map<EntityId, readonly string[]>();

  setEntities(entities: readonly Entity[]): void {
    const next = new Set<string>();
    this.slotKeysByEntity.clear();
    for (const entity of entities) {
      const keys = this.keysFor(entity);
      this.slotKeysByEntity.set(entity.id, keys);
      for (const key of keys) next.add(key);
    }
    this.validSlots = next;
    for (const key of [...this.reservations.keys()]) {
      if (!this.validSlots.has(key)) this.reservations.delete(key);
    }
  }

  addEntity(entity: Entity): void {
    if (this.slotKeysByEntity.has(entity.id)) return;
    const keys = this.keysFor(entity);
    this.slotKeysByEntity.set(entity.id, keys);
    for (const key of keys) this.validSlots.add(key);
  }

  removeEntity(entityId: EntityId): void {
    for (const key of this.slotKeysByEntity.get(entityId) ?? []) this.validSlots.delete(key);
    this.slotKeysByEntity.delete(entityId);
    for (const [key, reservation] of this.reservations) {
      if (reservation.entityId === entityId || reservation.reservedBy === entityId) this.reservations.delete(key);
    }
  }

  private keysFor(entity: Entity): string[] {
    const smartObject = readSmartObjectComponent(entity);
    if (!smartObject || smartObject.enabled === false) return [];
    return smartObject.slots.length === 0
      ? [reservationKey(entity.id, null)]
      : smartObject.slots.map((slot) => reservationKey(entity.id, slot.id));
  }

  clear(): void {
    this.reservations.clear();
    this.validSlots.clear();
    this.slotKeysByEntity.clear();
  }

  claim(input: SmartObjectClaimInput): boolean {
    const key = reservationKey(input.entityId, input.slotId ?? null);
    if (!this.validSlots.has(key)) return false;
    const existing = this.reservations.get(key);
    if (existing && existing.reservedBy !== input.reservedBy) return false;
    this.reservations.set(key, {
      entityId: input.entityId,
      slotId: input.slotId ?? null,
      reservedBy: input.reservedBy,
      state: "claimed",
      expiresAt: expiresAt(input.nowSeconds ?? 0, input.ttlSeconds ?? null),
    });
    return true;
  }

  use(input: SmartObjectClaimInput): boolean {
    const key = reservationKey(input.entityId, input.slotId ?? null);
    const existing = this.reservations.get(key);
    if (existing && existing.reservedBy !== input.reservedBy) return false;
    if (!existing && !this.claim(input)) return false;
    const reservation = this.reservations.get(key);
    if (!reservation) return false;
    this.reservations.set(key, {
      ...reservation,
      state: "inUse",
      expiresAt: expiresAt(input.nowSeconds ?? 0, input.ttlSeconds ?? null),
    });
    return true;
  }

  release(input: SmartObjectReleaseInput): boolean {
    const key = reservationKey(input.entityId, input.slotId ?? null);
    const existing = this.reservations.get(key);
    if (!existing) return false;
    if (input.reservedBy && existing.reservedBy !== input.reservedBy) return false;
    this.reservations.delete(key);
    return true;
  }

  expire(nowSeconds: number): number {
    let removed = 0;
    for (const [key, reservation] of this.reservations) {
      if (reservation.expiresAt !== null && reservation.expiresAt <= nowSeconds) {
        this.reservations.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  isReserved(entityId: EntityId, slotId: string | null = null, requesterId?: EntityId): boolean {
    const reservation = this.reservation(entityId, slotId);
    return reservation !== null && reservation.reservedBy !== requesterId;
  }

  reservation(entityId: EntityId, slotId: string | null = null): SmartObjectReservation | null {
    return this.reservations.get(reservationKey(entityId, slotId)) ?? null;
  }
}

function reservationKey(entityId: EntityId, slotId: string | null): string {
  return `${entityId}#${slotId ?? ""}`;
}

function expiresAt(nowSeconds: number, ttlSeconds: number | null): number | null {
  if (ttlSeconds === null || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return null;
  return nowSeconds + ttlSeconds;
}
