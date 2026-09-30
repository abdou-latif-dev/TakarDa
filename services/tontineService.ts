import { activityEvents, contributions, delay, genId, groups, memberships } from './db';
import { formatFcfa } from '@/utils/format';
import { ensureToursGenerated, getLoopBounds, getMemberStatusForTour, getTour, getToursForGroup, getTourStatus, type LoopBounds } from './tontineTours';
import type { Contribution, ContributionStatus, Group, Membership, Tour, TourStatus } from '@/types/entities';

export interface TourMemberStatus {
  member: Membership;
  contribution: Contribution | undefined;
  status: ContributionStatus;
}

/** Everything one tour needs to be displayed, all computed from real data —
 * see services/tontineTours.ts for the single place each formula lives. */
export interface TontineSummary {
  group: Group;
  /** Active, positioned members — always in rotation order (§33: "ordre de
   * bénéficiaire ≠ ordre de paiement", never reordered by who paid). */
  members: Membership[];
  currentTour: Tour | null;
  tourStatus: TourStatus;
  memberStatuses: TourMemberStatus[];
  paidCount: number;
  totalMembers: number;
  collected: number;
  expectedTotal: number;
  remaining: number;
  nextBeneficiary: Membership | null;
  /** Members late for `currentTour` specifically — the one and only
   * definition of "late" (§30), reused by every screen that shows it. */
  lateCount: number;
  currentLoop: LoopBounds | null;
  nextLoop: LoopBounds | null;
}

export interface TourHistoryEntry {
  tour: Tour;
  beneficiary: Membership | null;
  paidCount: number;
  totalMembers: number;
  collected: number;
  expectedTotal: number;
  status: TourStatus;
}

function generateReference(): string {
  return `FE-${Math.floor(10000 + Math.random() * 89999)}`;
}

function activeOrderedMembers(groupId: string): Membership[] {
  return memberships
    .filter((m) => m.groupId === groupId && m.status === 'active' && typeof m.position === 'number')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export const tontineService = {
  /** Summary for one tour — defaults to the tontine's current tour
   * (group.currentRound), or pass `tourNumber` explicitly for the tour
   * detail screen / history. Generates the tour on demand if it doesn't
   * exist yet (never generates further ahead than asked). */
  async getSummary(groupId: string, tourNumber?: number): Promise<TontineSummary | null> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return null;

    const members = activeOrderedMembers(groupId);
    const totalMembers = members.length;
    const targetTourNumber = tourNumber ?? Math.max(group.currentRound ?? 1, 1);
    ensureToursGenerated(groupId, targetTourNumber);
    const tour = getTour(groupId, targetTourNumber);

    const memberStatuses: TourMemberStatus[] = tour
      ? members.map((member) => {
          const contribution = contributions.find((c) => c.groupId === groupId && c.tourId === tour.id && c.memberId === member.id);
          return { member, contribution, status: getMemberStatusForTour(contribution, tour) };
        })
      : [];

    const paidCount = memberStatuses.filter((s) => s.status === 'paid').length;
    const lateCount = memberStatuses.filter((s) => s.status === 'late').length;
    const collected = memberStatuses.reduce((sum, s) => sum + (s.contribution?.status === 'paid' ? s.contribution.amount : 0), 0);
    const expectedTotal = tour?.expectedTotalAmount ?? 0;
    const nextBeneficiary = tour ? (members.find((m) => m.id === tour.beneficiaryMemberId) ?? null) : null;

    const startDate = group.startDate ? new Date(group.startDate) : null;
    const currentLoop = tour && startDate && group.frequency ? getLoopBounds(startDate, group.frequency, totalMembers, tour.cycleNumber) : null;
    const nextLoop = tour && startDate && group.frequency ? getLoopBounds(startDate, group.frequency, totalMembers, tour.cycleNumber + 1) : null;

    return {
      group,
      members,
      currentTour: tour,
      tourStatus: tour ? getTourStatus(tour, paidCount, totalMembers) : 'upcoming',
      memberStatuses,
      paidCount,
      totalMembers,
      collected,
      expectedTotal,
      remaining: Math.max(0, expectedTotal - collected),
      nextBeneficiary,
      lateCount,
      currentLoop,
      nextLoop,
    };
  },

  /** Every generated tour (past + current), most recent first — each with
   * its own frozen beneficiary/date/amount, never recomputed from the
   * CURRENT member roster (§31: "l'historique doit rester stable"). */
  async getTourHistory(groupId: string): Promise<TourHistoryEntry[]> {
    await delay(300);
    const groupTours = getToursForGroup(groupId);
    return groupTours
      .slice()
      .reverse()
      .map((tour) => {
        const beneficiary = memberships.find((m) => m.id === tour.beneficiaryMemberId) ?? null;
        const tourContributions = contributions.filter((c) => c.groupId === groupId && c.tourId === tour.id);
        const paidCount = tourContributions.filter((c) => c.status === 'paid').length;
        const collected = tourContributions.filter((c) => c.status === 'paid').reduce((sum, c) => sum + c.amount, 0);
        // Derived from the tour's own frozen amounts, not the live member
        // count — a member added/removed since must never change how many
        // members THIS tour expected (§36/§37).
        const totalMembers = tour.expectedAmountPerMember > 0 ? Math.round(tour.expectedTotalAmount / tour.expectedAmountPerMember) : 0;
        return {
          tour,
          beneficiary,
          paidCount,
          totalMembers,
          collected,
          expectedTotal: tour.expectedTotalAmount,
          status: getTourStatus(tour, paidCount, totalMembers),
        };
      });
  },

  /** Real monthly totals (in FCFA) from paid contributions over the last 6 months — never fabricated. */
  async getMonthlyContributions(groupId: string): Promise<{ label: string; value: number }[]> {
    await delay(200);
    const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const now = new Date();
    const paid = contributions.filter((c) => c.groupId === groupId && c.status === 'paid');
    const months: { label: string; value: number }[] = [];
    for (let offset = 5; offset >= 0; offset--) {
      const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const total = paid
        .filter((c) => {
          const paidAt = new Date(c.paidAt ?? c.createdAt);
          return paidAt.getFullYear() === month.getFullYear() && paidAt.getMonth() === month.getMonth();
        })
        .reduce((sum, c) => sum + c.amount, 0);
      months.push({ label: MONTH_LABELS[month.getMonth()], value: Math.round(total / 1000) });
    }
    return months;
  },

  /** Marks every listed member as paid for `tourId`, at the tour's own
   * frozen `expectedAmountPerMember` — never an arbitrary amount (§7: the
   * amount is not editable from this screen). Members not listed are left
   * untouched (no row = still unpaid); a member ALREADY marked paid stays
   * paid even if re-submitted — this screen can only ever confirm a
   * payment, never revert one (§20: the safest of the three options offered
   * — reverting a validated payment is a distinct "correction" action, not
   * built here since nothing requested it). */
  async recordContributions(input: { groupId: string; tourId: string; memberIds: string[] }): Promise<Contribution[]> {
    await delay();
    const tour = getToursForGroup(input.groupId).find((t) => t.id === input.tourId);
    if (!tour) throw new Error('Tour introuvable.');
    const now = new Date().toISOString();
    const recorded: Contribution[] = [];

    for (const memberId of input.memberIds) {
      const existingIndex = contributions.findIndex((c) => c.groupId === input.groupId && c.tourId === input.tourId && c.memberId === memberId);
      if (existingIndex >= 0 && contributions[existingIndex].status === 'paid') {
        recorded.push(contributions[existingIndex]);
        continue;
      }
      const member = memberships.find((m) => m.id === memberId);
      const contribution: Contribution = {
        id: existingIndex >= 0 ? contributions[existingIndex].id : genId('ct'),
        groupId: input.groupId,
        tourId: input.tourId,
        memberId,
        amount: tour.expectedAmountPerMember,
        status: 'paid',
        reference: existingIndex >= 0 ? contributions[existingIndex].reference : generateReference(),
        paidAt: now,
        createdAt: existingIndex >= 0 ? contributions[existingIndex].createdAt : now,
      };
      if (existingIndex >= 0) contributions[existingIndex] = contribution;
      else contributions.unshift(contribution);
      recorded.push(contribution);

      activityEvents.unshift({
        id: genId('a'),
        type: 'contribution_added',
        title: 'Paiement de cotisation validé',
        description: `${member?.displayName ?? 'Un membre'} a payé ${formatFcfa(tour.expectedAmountPerMember)} (Tour ${tour.tourNumber}).`,
        groupId: input.groupId,
        userName: member?.displayName,
        amount: tour.expectedAmountPerMember,
        at: now,
      });
    }
    return recorded;
  },

  /** Admin confirms the current beneficiary received the cagnotte and moves
   * the rotation pointer to the next tour. Loops forever — reaching the
   * last position of a loop simply starts the next one (§4), there is no
   * "tontine finished" state to reach anymore. */
  async advanceRound(groupId: string): Promise<void> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const nextTourNumber = (group.currentRound ?? 1) + 1;
    group.currentRound = nextTourNumber;
    ensureToursGenerated(groupId, nextTourNumber);
    const nextTour = getTour(groupId, nextTourNumber);
    const beneficiary = nextTour ? memberships.find((m) => m.id === nextTour.beneficiaryMemberId) : null;
    activityEvents.unshift({
      id: genId('a'),
      type: 'order_updated',
      title: 'Tour suivant',
      description: `${beneficiary?.displayName ?? 'Le prochain membre'} est maintenant bénéficiaire de ${group.name} (Tour ${nextTourNumber}).`,
      groupId,
      userName: beneficiary?.displayName,
      at: new Date().toISOString(),
    });
  },
};
