import { activityEvents, contributions, delay, genId, memberships, tontineCycles } from './db';
import type { Contribution, ContributionStatus, Membership, TontineCycle } from '@/types/entities';

export interface TontineSummary {
  cycle: TontineCycle | null;
  members: Membership[];
  contributionsByMember: Record<string, Contribution | undefined>;
  totalCollected: number;
  totalExpected: number;
  paidCount: number;
}

export const tontineService = {
  async getSummary(groupId: string): Promise<TontineSummary> {
    await delay();
    const cycle = tontineCycles.find((c) => c.groupId === groupId) ?? null;
    const members = memberships.filter((m) => m.groupId === groupId && m.status !== 'invited');
    const groupContributions = contributions.filter((c) => c.groupId === groupId && c.cycleId === cycle?.id);
    const contributionsByMember: Record<string, Contribution | undefined> = {};
    for (const member of members) {
      contributionsByMember[member.id] = groupContributions.find((c) => c.memberId === member.id);
    }
    const paid = groupContributions.filter((c) => c.status === 'paid');
    return {
      cycle,
      members,
      contributionsByMember,
      totalCollected: paid.reduce((sum, c) => sum + c.amount, 0),
      totalExpected: (cycle?.amountExpectedPerMember ?? 0) * members.length,
      paidCount: paid.length,
    };
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
    const contribution: Contribution = {
      id: existingIndex >= 0 ? contributions[existingIndex].id : genId('ct'),
      groupId: input.groupId,
      cycleId: input.cycleId,
      memberId: input.memberId,
      amount: input.amount,
      status: input.status,
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
      title: 'Cotisation enregistrée',
      description: `${member?.displayName ?? 'Un membre'} a payé ${input.amount.toLocaleString('fr-FR')} FCFA.`,
      groupId: input.groupId,
      userName: member?.displayName,
      amount: input.amount,
      at: contribution.createdAt,
    });
    return contribution;
  },
};
