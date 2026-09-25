import { activityEvents, contributions, delay, genId, groups, memberships, tontineCycles } from './db';
import { formatFcfa } from '@/utils/format';
import type { Contribution, ContributionStatus, Membership, TontineCycle } from '@/types/entities';

export interface TontineSummary {
  cycle: TontineCycle | null;
  members: Membership[];
  contributionsByMember: Record<string, Contribution | undefined>;
  totalCollected: number;
  totalExpected: number;
  paidCount: number;
  currentRound: number;
  totalRounds: number;
  nextBeneficiary: Membership | null;
  progress: number; // 0..1
}

function generateReference(): string {
  return `FE-${Math.floor(10000 + Math.random() * 89999)}`;
}

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export const tontineService = {
  async getSummary(groupId: string): Promise<TontineSummary> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    const cycle = tontineCycles.find((c) => c.groupId === groupId) ?? null;
    const members = memberships
      .filter((m) => m.groupId === groupId && m.status !== 'invited')
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const groupContributions = contributions.filter((c) => c.groupId === groupId && c.cycleId === cycle?.id);
    const contributionsByMember: Record<string, Contribution | undefined> = {};
    for (const member of members) {
      contributionsByMember[member.id] = groupContributions.find((c) => c.memberId === member.id);
    }
    const paid = groupContributions.filter((c) => c.status === 'paid');
    const currentRound = group?.currentRound ?? 1;
    const totalRounds = members.length;
    const nextBeneficiary = members.find((m) => m.position === currentRound) ?? null;

    return {
      cycle,
      members,
      contributionsByMember,
      totalCollected: paid.reduce((sum, c) => sum + c.amount, 0),
      totalExpected: (cycle?.amountExpectedPerMember ?? 0) * members.length,
      paidCount: paid.length,
      currentRound,
      totalRounds,
      nextBeneficiary,
      progress: totalRounds > 0 ? Math.min(1, (currentRound - 1) / totalRounds) : 0,
    };
  },

  /** Real monthly totals (in FCFA) from paid contributions over the last 6 months — never fabricated. */
  async getMonthlyContributions(groupId: string): Promise<{ label: string; value: number }[]> {
    await delay(200);
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

  async listHistory(groupId: string): Promise<Contribution[]> {
    await delay(300);
    return contributions
      .filter((c) => c.groupId === groupId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async addContribution(input: {
    groupId: string;
    cycleId: string;
    memberId: string;
    amount: number;
    status: ContributionStatus;
    note?: string;
  }): Promise<Contribution> {
    await delay();
    const existingIndex = contributions.findIndex(
      (c) => c.groupId === input.groupId && c.cycleId === input.cycleId && c.memberId === input.memberId,
    );
    const previousContribution = existingIndex >= 0 ? contributions[existingIndex] : null;
    const contribution: Contribution = {
      id: existingIndex >= 0 ? contributions[existingIndex].id : genId('ct'),
      groupId: input.groupId,
      cycleId: input.cycleId,
      memberId: input.memberId,
      amount: input.amount,
      status: input.status,
      reference: existingIndex >= 0 ? contributions[existingIndex].reference : generateReference(),
      note: input.note,
      paidAt: input.status === 'paid' ? new Date().toISOString() : undefined,
      createdAt: existingIndex >= 0 ? contributions[existingIndex].createdAt : new Date().toISOString(),
    };
    if (existingIndex >= 0) contributions[existingIndex] = contribution;
    else contributions.unshift(contribution);

    const member = memberships.find((m) => m.id === input.memberId);
    activityEvents.unshift({
      id: genId('a'),
      type: 'contribution_added',
      title: previousContribution ? 'Cotisation corrigée' : input.status === 'paid' ? 'Paiement de cotisation validé' : 'Cotisation enregistrée en attente',
      description:
        previousContribution
          ? `Correction manuelle : ${previousContribution.status === 'paid' ? 'payé' : 'non payé'} (${formatFcfa(previousContribution.amount)}) → ${input.status === 'paid' ? 'payé' : 'non payé'} (${formatFcfa(input.amount)}).`
          : input.status === 'paid'
          ? `${member?.displayName ?? 'Un membre'} a payé ${formatFcfa(input.amount)}.`
          : `Paiement de ${formatFcfa(input.amount)} enregistré comme non payé pour ${member?.displayName ?? 'un membre'}.`,
      groupId: input.groupId,
      userName: member?.displayName,
      amount: input.amount,
      at: new Date().toISOString(),
    });
    return contribution;
  },

  /** Admin marks the current beneficiary as paid out and advances the rotation to the next member. */
  async advanceRound(groupId: string): Promise<void> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const members = memberships.filter((m) => m.groupId === groupId && m.status === 'active');
    const current = members.find((m) => m.position === (group.currentRound ?? 1));
    if (current) current.hasReceivedPayout = true;

    const totalRounds = members.length;
    const nextRound = (group.currentRound ?? 1) + 1;

    if (nextRound > totalRounds) {
      group.tontineStatus = 'completed';
      activityEvents.unshift({
        id: genId('a'),
        type: 'cycle_completed',
        title: 'Cycle terminé',
        description: `Tous les membres de ${group.name} ont reçu la cagnotte — le cycle est terminé.`,
        groupId,
        at: new Date().toISOString(),
      });
      return;
    }

    group.currentRound = nextRound;
    const next = members.find((m) => m.position === nextRound);
    activityEvents.unshift({
      id: genId('a'),
      type: 'order_updated',
      title: 'Tour suivant',
      description: `${next?.displayName ?? 'Le prochain membre'} est maintenant bénéficiaire de ${group.name}.`,
      groupId,
      userName: next?.displayName,
      at: new Date().toISOString(),
    });
  },
};
