// One-time-per-boot migration from the old "one TontineCycle for the whole
// tontine's lifetime" model to the new per-tour model (Tour/Boucle audit,
// 2026-09-30, §38: "NE PAS supprimer brutalement ces données. Faire une
// migration compatible.").
//
// What this does NOT do, deliberately: it never invents which round a
// legacy Contribution was actually paid for — the old model genuinely never
// captured that (a single shared cycleId was reused across every round,
// which is precisely the bug this whole change fixes). The only honest,
// non-invented thing we can do is reattach a legacy Contribution to the
// tontine's CURRENT tour, since that's the tour the old shared cycle was
// factually standing in for at the moment of hydration. Rounds before the
// current one simply have no contribution history for pre-migration
// tontines — a documented, accepted limitation, not a silent data loss (the
// legacy TontineCycle and the original Contribution rows are left in place,
// untouched, never deleted).
import { contributions, groups, tontineCycles } from './db';
import { ensureToursGenerated, getTour } from './tontineTours';

/** A legacy Contribution row still has `cycleId` at runtime (from an
 * AsyncStorage snapshot saved before this change) even though the
 * `Contribution` type no longer declares that field — and has no `tourId`
 * yet either, despite the type now declaring it as required. */
interface LegacyContributionShape {
  cycleId?: string;
}

export async function migrateLegacyTontines(): Promise<void> {
  const legacyTontineGroupIds = new Set(
    groups
      .filter((g) => g.kind === 'tontine' && tontineCycles.some((c) => c.groupId === g.id))
      .map((g) => g.id),
  );
  if (legacyTontineGroupIds.size === 0) return;

  for (const groupId of legacyTontineGroupIds) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;

    // A tontine could never actually finish exhausting rounds under the old
    // model without being auto-marked 'completed' (see the old
    // advanceRound()) — and there was never an admin-driven "end tontine"
    // action to confuse this with. Loops are infinite now (§4), so reopen it.
    if (group.tontineStatus === 'completed') group.tontineStatus = 'active';

    const currentTourNumber = Math.max(group.currentRound ?? 1, 1);
    ensureToursGenerated(groupId, currentTourNumber);
    const currentTour = getTour(groupId, currentTourNumber);
    const legacyCycle = tontineCycles.find((c) => c.groupId === groupId);
    if (!currentTour || !legacyCycle) continue;

    for (const contribution of contributions) {
      if (contribution.groupId !== groupId) continue;
      if (contribution.tourId) continue; // already migrated (or already new-model)
      const legacyCycleId = (contribution as unknown as LegacyContributionShape).cycleId;
      if (legacyCycleId !== legacyCycle.id) continue;
      contribution.tourId = currentTour.id;
    }
  }
}
