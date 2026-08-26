import { activityEvents, CURRENT_USER_ID, delay, genId, groups, memberships, tontineCycles, users } from './db';
import { formatMonthYear } from '@/utils/format';
import type { Group, Membership, TontineFrequency, TontineOrderMethod } from '@/types/entities';

/** Re-derives every active member's rotation position from the tontine's chosen ordering method. */
function recomputePositions(groupId: string) {
  const group = groups.find((g) => g.id === groupId);
  if (!group || group.kind !== 'tontine') return;
  const active = memberships
    .filter((m) => m.groupId === groupId && m.status === 'active')
    .sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1));

  if (group.orderMethod === 'manual') {
    // Leave existing positions alone; only backfill members that never got one.
    const withoutPosition = active.filter((m) => !m.position);
    const maxPosition = Math.max(0, ...active.map((m) => m.position ?? 0));
    withoutPosition.forEach((m, i) => (m.position = maxPosition + i + 1));
    return;
  }

  const order = group.orderMethod === 'draw' ? [...active].sort(() => Math.random() - 0.5) : active;
  order.forEach((m, i) => (m.position = i + 1));
}

export interface CreateTontineInput {
  name: string;
  description?: string;
  contributionAmount: number;
  frequency: TontineFrequency;
  startDate: string;
  orderMethod: TontineOrderMethod;
}

export const groupService = {
  async listMyGroups(): Promise<Group[]> {
    await delay();
    const myGroupIds = new Set(memberships.filter((m) => m.userId === CURRENT_USER_ID).map((m) => m.groupId));
    return groups.filter((g) => myGroupIds.has(g.id)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async getGroup(groupId: string): Promise<Group | null> {
    await delay(250);
    return groups.find((g) => g.id === groupId) ?? null;
  },

  async listMembers(groupId: string): Promise<Membership[]> {
    await delay(250);
    return memberships
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  },

  /** Dedicated tontine creation: captures cotisation, fréquence, date de début et méthode d'ordre. */
  async createTontine(input: CreateTontineInput): Promise<Group> {
    await delay();
    const now = new Date().toISOString();
    const group: Group = {
      id: genId('g'),
      name: input.name,
      description: input.description,
      kind: 'tontine',
      ownerId: CURRENT_USER_ID,
      memberCount: 1,
      createdAt: now,
      updatedAt: now,
      contributionAmount: input.contributionAmount,
      frequency: input.frequency,
      startDate: input.startDate,
      orderMethod: input.orderMethod,
      currentRound: 1,
      tontineStatus: 'active',
    };
    groups.unshift(group);
    memberships.push({
      id: genId('m'),
      groupId: group.id,
      userId: CURRENT_USER_ID,
      role: 'admin',
      displayName: 'Vous',
      joinedAt: now,
      status: 'active',
      accountType: 'formease_user',
      position: 1,
    });
    tontineCycles.push({
      id: genId('c'),
      groupId: group.id,
      label: `Cycle de ${formatMonthYear(new Date(input.startDate))}`,
      amountExpectedPerMember: input.contributionAmount,
      dueDate: input.startDate,
      createdAt: now,
    });
    activityEvents.unshift({
      id: genId('a'),
      type: 'group_created',
      title: 'Tontine créée',
      description: `${group.name} a été créée.`,
      groupId: group.id,
      at: now,
    });
    return group;
  },

  /** Link a real FormEase user (found by their share-able ID) as a member. */
  async addFormeaseMember(groupId: string, formeaseId: string): Promise<Membership> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    const user = users.find((u) => u.formeaseId.toLowerCase() === formeaseId.trim().toLowerCase());
    if (!user) throw new Error("Aucun utilisateur FormEase ne correspond à cet ID.");
    const alreadyMember = memberships.some((m) => m.groupId === groupId && m.userId === user.id && m.status === 'active');
    if (alreadyMember) throw new Error('Cet utilisateur fait déjà partie de la tontine.');

    const membership: Membership = {
      id: genId('m'),
      groupId,
      userId: user.id,
      role: 'member',
      displayName: user.name,
      joinedAt: new Date().toISOString(),
      status: 'active',
      accountType: 'formease_user',
    };
    memberships.push(membership);
    if (group) group.memberCount += 1;
    recomputePositions(groupId);
    activityEvents.unshift({
      id: genId('a'),
      type: 'member_joined',
      title: 'Nouveau membre',
      description: `${membership.displayName} a rejoint ${group?.name ?? 'la tontine'}.`,
      groupId,
      userName: membership.displayName,
      at: membership.joinedAt,
    });
    return membership;
  },

  /** Add a guest member who has no FormEase account — the admin manages their participation. */
  async addGuestMember(groupId: string, input: { firstName: string; lastName: string; phone?: string }): Promise<Membership> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
    const membership: Membership = {
      id: genId('m'),
      groupId,
      userId: genId('guest'),
      role: 'member',
      displayName,
      phone: input.phone,
      joinedAt: new Date().toISOString(),
      status: 'active',
      accountType: 'guest',
    };
    memberships.push(membership);
    if (group) group.memberCount += 1;
    recomputePositions(groupId);
    activityEvents.unshift({
      id: genId('a'),
      type: 'member_invited',
      title: 'Membre invité ajouté',
      description: `${displayName} a été ajouté·e à ${group?.name ?? 'la tontine'}.`,
      groupId,
      userName: displayName,
      at: membership.joinedAt,
    });
    return membership;
  },

  /** Manual reorder of the rotation (drag/tap-reorder screen). */
  async setMemberOrder(groupId: string, orderedMembershipIds: string[]): Promise<void> {
    await delay(250);
    const group = groups.find((g) => g.id === groupId);
    if (group) group.orderMethod = 'manual';
    orderedMembershipIds.forEach((id, i) => {
      const m = memberships.find((mem) => mem.id === id);
      if (m) m.position = i + 1;
    });
    activityEvents.unshift({
      id: genId('a'),
      type: 'order_updated',
      title: "Ordre de passage modifié",
      description: `L'ordre de réception de ${group?.name ?? 'la tontine'} a été mis à jour.`,
      groupId,
      at: new Date().toISOString(),
    });
  },
};
