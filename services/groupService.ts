import {
  activityEvents,
  contributions,
  CURRENT_USER_ID,
  delay,
  genId,
  groups,
  memberships,
  tontineCycles,
  users,
} from './db';
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
  /** Defaults to true (existing behavior unchanged for every real caller):
   * the creator joins their own tontine as rotation member #1. Set to false
   * for an admin-only tontine — e.g. the "démo" seed, where the 5 seeded
   * members must be the entire rotation so the total matches
   * membres × cotisation exactly, with no extra "Vous" slot. */
  includeSelfAsMember?: boolean;
}

export const groupService = {
  async listMyGroups(): Promise<Group[]> {
    await delay();
    const myGroupIds = new Set(memberships.filter((m) => m.userId === CURRENT_USER_ID).map((m) => m.groupId));
    // Membership alone would hide an admin-only tontine (includeSelfAsMember:
    // false — e.g. the démo seed) from its own creator, since it has no
    // membership row at all. ownerId is the reliable "this is my group"
    // signal; membership is a separate "am I a rotation participant" concern.
    return groups.filter((g) => myGroupIds.has(g.id) || g.ownerId === CURRENT_USER_ID).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
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
    const includeSelf = input.includeSelfAsMember !== false;
    const group: Group = {
      id: genId('g'),
      name: input.name,
      description: input.description,
      kind: 'tontine',
      ownerId: CURRENT_USER_ID,
      memberCount: includeSelf ? 1 : 0,
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
    if (includeSelf) {
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
    }
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

  /** Edits the tontine's own info (name/cotisation/fréquence) — never the
   * rotation order or membership, which stay on their own dedicated flows
   * (Ordre de passage / Ajouter un membre). Keeps the active cycle's
   * `amountExpectedPerMember` in sync so a changed cotisation is reflected
   * immediately in the next-beneficiary payout total. */
  async updateTontine(groupId: string, input: { name: string; contributionAmount: number; frequency: TontineFrequency }): Promise<Group> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Tontine introuvable.');
    group.name = input.name;
    group.contributionAmount = input.contributionAmount;
    group.frequency = input.frequency;
    group.updatedAt = new Date().toISOString();
    const cycle = tontineCycles.find((c) => c.groupId === groupId);
    if (cycle) cycle.amountExpectedPerMember = input.contributionAmount;
    activityEvents.unshift({
      id: genId('a'),
      type: 'group_updated',
      title: 'Tontine modifiée',
      description: `${group.name} a été mise à jour.`,
      groupId,
      at: group.updatedAt,
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

  /** Deletes a tontine and every record tied to it (members, cotisations, cycles). */
  async deleteTontine(groupId: string): Promise<void> {
    await delay();
    const index = groups.findIndex((g) => g.id === groupId);
    if (index === -1) return;
    const [removed] = groups.splice(index, 1);
    for (let i = memberships.length - 1; i >= 0; i--) {
      if (memberships[i].groupId === groupId) memberships.splice(i, 1);
    }
    for (let i = contributions.length - 1; i >= 0; i--) {
      if (contributions[i].groupId === groupId) contributions.splice(i, 1);
    }
    for (let i = tontineCycles.length - 1; i >= 0; i--) {
      if (tontineCycles[i].groupId === groupId) tontineCycles.splice(i, 1);
    }
    activityEvents.unshift({
      id: genId('a'),
      type: 'tontine_deleted',
      title: 'Tontine supprimée',
      description: `${removed.name} a été supprimée.`,
      at: new Date().toISOString(),
    });
  },
};
