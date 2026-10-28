/**
 * Settlement program, L1 (World Builder plan v0.4 §13.3, §13.5 L5, WB-14):
 * what a settlement needs, derived the way planners do it — from population.
 *
 * - Dwellings: `population / household.personsPerDwelling`, rounded up.
 * - Profile rows: `count`, or one per `perResidents` residents (rounded up);
 *   below `minPopulation` a row yields nothing.
 * - Game rows: a fork's own needs (a depot, a fuel station, a weighbridge), from
 *   `ProgramExtension`s the game module supplies, so the engine stays generic.
 * - Recipe rows: the settlement's `program.remove`, then `program.add`.
 *
 * Lines merge by role: a later source replaces an earlier line in place. Pure
 * and deterministic. Dependency-free.
 */
import { isSemanticRole } from "../scene/placementIdentity";
import { isPositiveInteger } from "./normalize";
import type { PlanSettlement, ProgramEntry, ProgramLine, ProgramSource } from "./recipe";
import type { RegionProfile } from "./regionProfile";
import { PROGRAM_SITINGS, type ProgramSiting } from "./vocabulary";

/** A game module's program rows for one settlement. */
export type ProgramExtension = (settlement: Readonly<PlanSettlement>) => readonly ProgramEntry[];

export interface DerivedProgram {
  population: number;
  dwellings: number;
  lines: ProgramLine[];
  warnings: string[];
}

export function deriveSettlementProgram(
  settlement: Readonly<PlanSettlement>,
  profile: RegionProfile | null,
  extensions: readonly ProgramExtension[] = [],
): DerivedProgram {
  const warnings: string[] = [];
  const name = `settlement ${settlement.id}`;
  const population = settlement.population ?? 0;
  if (settlement.population === undefined) warnings.push(`${name} has no population; only fixed-count program rows apply`);
  if (!profile) warnings.push(`${name} has no region profile; its program holds only game and recipe rows`);

  const lines: ProgramLine[] = [];
  const put = (role: string, count: number, siting: ProgramSiting, source: ProgramSource): void => {
    const line: ProgramLine = { role, count, siting, source };
    const index = lines.findIndex((entry) => entry.role === role);
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  };

  for (const rule of profile?.program ?? []) {
    if (rule.minPopulation !== undefined && population < rule.minPopulation) continue;
    const count = rule.count ?? (rule.perResidents ? Math.ceil(population / rule.perResidents) : 0);
    if (count > 0) put(rule.role, count, rule.siting, "profile");
  }

  for (const [index, extension] of extensions.entries()) {
    let rows: readonly ProgramEntry[];
    try {
      rows = extension(settlement);
    } catch (error) {
      warnings.push(`${name}: game program extension ${index} failed (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    for (const row of rows) {
      if (!isSemanticRole(row.role) || !isPositiveInteger(row.count)) {
        warnings.push(`${name}: ignored a game program row with role ${JSON.stringify(row.role)} and count ${JSON.stringify(row.count)}`);
        continue;
      }
      const siting = row.siting !== undefined && PROGRAM_SITINGS.includes(row.siting) ? row.siting : "any";
      put(row.role, row.count, siting, "game");
    }
  }

  for (const role of settlement.program?.remove ?? []) {
    const index = lines.findIndex((entry) => entry.role === role);
    if (index >= 0) lines.splice(index, 1);
    else warnings.push(`${name}: program.remove names ${role}, which the program does not hold`);
  }
  for (const row of settlement.program?.add ?? []) put(row.role, row.count, row.siting ?? "any", "recipe");

  if (profile) {
    for (const line of lines) {
      if (!profile.roles[line.role]) warnings.push(`${name}: role ${line.role} has no spec in the region profile; it gets a default placeholder`);
    }
  }
  return {
    population,
    dwellings: profile && population > 0 ? Math.ceil(population / profile.household.personsPerDwelling) : 0,
    lines,
    warnings,
  };
}
