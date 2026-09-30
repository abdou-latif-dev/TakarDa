// Tour generation & derived status for Tontine (Tour/Boucle audit, 2026-09-30).
// Centralizes everything the brief calls out as "must not be duplicated
// across screens": which tour a given global number falls into, its
// beneficiary, its date, its status. Screens consume this, never recompute it.
//
// Generation is lazy and bounded (§17: "ne pas créer des milliers de
// documents immédiatement") — ensureToursGenerated() only ever creates
// records up to the tour actually being viewed, never a whole future loop
// ahead of time. A loop's date RANGE (for the "Boucle suivante" preview) is
// pure computation via getLoopBounds() and needs no persisted Tour at all.

import { groups, memberships, tours } from './db';
import { calculateTourDate } from './tontineDates';
import type { Contribution, Membership, TontineFrequency, Tour, TourStatus } from '@/types/entities';

export interface LoopBounds {
  cycleNumber: number;
  firstTourNumber: number;
  lastTourNumber: number;
  startDate: Date;
  endDate: Date;
}

/** Pure computation, no persistence — used for "Boucle suivante" previews
 * that don't need a materialized Tour record. */
export function getLoopBounds(startDate: Date, frequency: TontineFrequency, memberCount: number, cycleNumber: number): LoopBounds | null {
  if (memberCount <= 0 || cycleNumber < 1) return null;
  const firstTourNumber = (cycleNumber - 1) * memberCount + 1;
  const lastTourNumber = cycleNumber * memberCount;
  return {
    cycleNumber,
    firstTourNumber,
    lastTourNumber,
    startDate: calculateTourDate(startDate, frequency, firstTourNumber - 1),
    endDate: calculateTourDate(startDate, frequency, lastTourNumber - 1),
  };
}

/** Active, positioned members for a tontine, sorted by rotation order —
 * the single place this filter+sort is written (mirrors groupService's own
 * recomputePositions filter, kept in sync deliberately). */
function activeOrderedMembers(groupId: string): Membership[] {
  return memberships
    .filter((m) => m.groupId === groupId && m.status === 'active' && typeof m.position === 'number')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Generates and persists any Tour records from the last existing tour up to
 * `uptoTourNumber` (inclusive) that don't already exist yet. A tour's
 * beneficiary/date/expected amount are frozen at the moment it's generated —
 * calling this again never rewrites an already-generated tour, even if the
 * tontine's member order or contribution amount changed since (§8, §31, §35:
 * past/already-generated tours must never be rewritten).
 *
 * Member count used for the cycle-length math is read fresh each time NEW
 * tours are generated. Documented limitation (§36 explicitly allows this
 * rather than a more complex "freeze cycle size" mechanism): a member added
 * mid-loop only affects tours not yet generated, which can occasionally
 * shift an in-progress loop's effective length rather than always starting
 * clean at the next loop boundary.
 */
export function ensureToursGenerated(groupId: string, uptoTourNumber: number): Tour[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group || !group.startDate || !group.frequency) return [];

  const existing = tours.filter((t) => t.groupId === groupId);
  const lastExisting = existing.reduce((max, t) => Math.max(max, t.tourNumber), 0);
  if (uptoTourNumber <= lastExisting) return existing;

  const startDate = new Date(group.startDate);
  const frequency = group.frequency;
  const amount = group.contributionAmount ?? 0;
  const now = new Date().toISOString();

  for (let tourNumber = lastExisting + 1; tourNumber <= uptoTourNumber; tourNumber++) {
    const active = activeOrderedMembers(groupId);
    const memberCount = active.length;
    if (memberCount === 0) break; // nothing to generate yet — no members with a rotation position

    const positionInCycle = ((tourNumber - 1) % memberCount) + 1;
    const cycleNumber = Math.ceil(tourNumber / memberCount);
    const beneficiary = active.find((m) => m.position === positionInCycle);
    if (!beneficiary) break; // positions aren't contiguous 1..N — shouldn't happen, but never guess a beneficiary

    tours.push({
      id: `${groupId}-tour-${tourNumber}`,
      groupId,
      cycleNumber,
      tourNumber,
      positionInCycle,
      beneficiaryMemberId: beneficiary.id,
      scheduledDate: calculateTourDate(startDate, frequency, tourNumber - 1).toISOString(),
      expectedAmountPerMember: amount,
      expectedTotalAmount: amount * memberCount,
      createdAt: now,
    });
  }

  return tours.filter((t) => t.groupId === groupId).sort((a, b) => a.tourNumber - b.tourNumber);
}

export function getToursForGroup(groupId: string): Tour[] {
  return tours.filter((t) => t.groupId === groupId).sort((a, b) => a.tourNumber - b.tourNumber);
}

export function getTour(groupId: string, tourNumber: number): Tour | null {
  return tours.find((t) => t.groupId === groupId && t.tourNumber === tourNumber) ?? null;
}

/** A tour is 'complete' once every active member has a 'paid' contribution
 * for it — a passed date with a partial count is 'late', never silently
 * treated as done (§11: "éviter d'utiliser simplement la date comme preuve
 * de paiement"). Single definition, reused by every screen (§30). */
export function getTourStatus(tour: Tour, paidCount: number, totalMembers: number, now: Date = new Date()): TourStatus {
  if (totalMembers > 0 && paidCount >= totalMembers) return 'complete';
  if (now.getTime() > new Date(tour.scheduledDate).getTime()) return 'late';
  if (paidCount > 0) return 'partial';
  return 'upcoming';
}

/** Per-member display status for one tour — 'late' is derived (a member is
 * late for a tour once its date has passed and they still have no 'paid'
 * contribution for THAT tour), never stored — same rule used everywhere else
 * in this codebase for derived state. */
export function getMemberStatusForTour(contribution: Contribution | undefined, tour: Tour, now: Date = new Date()): 'paid' | 'pending' | 'late' {
  if (contribution?.status === 'paid') return 'paid';
  if (now.getTime() > new Date(tour.scheduledDate).getTime()) return 'late';
  return 'pending';
}
