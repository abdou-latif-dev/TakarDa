import { activityEvents, CURRENT_USER_ID, delay, genId, groups, memberships, tontineCycles } from './db';
import { formatMonthYear } from '@/utils/format';
import type { Group, GroupKind, Membership } from '@/types/entities';

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
    return memberships.filter((m) => m.groupId === groupId);
  },

  async createGroup(input: { name: string; description?: string; kind?: GroupKind }): Promise<Group> {
    await delay();
    const group: Group = {
      id: genId('g'),
      name: input.name,
      description: input.description,
      kind: input.kind ?? 'general',
      ownerId: CURRENT_USER_ID,
      memberCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    groups.unshift(group);
    memberships.push({
      id: genId('m'),
      groupId: group.id,
      userId: CURRENT_USER_ID,
      role: 'admin',
      displayName: 'Vous',
      joinedAt: group.createdAt,
      status: 'active',
    });
    activityEvents.unshift({
      id: genId('a'),
      type: 'group_created',
      title: 'Groupe créé',
      description: `${group.name} a été créé.`,
      groupId: group.id,
      at: group.createdAt,
    });

    if (group.kind === 'tontine') {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      tontineCycles.push({
        id: genId('c'),
        groupId: group.id,
        label: `Cycle de ${formatMonthYear(dueDate)}`,
        amountExpectedPerMember: 10000,
        dueDate: dueDate.toISOString(),
        createdAt: group.createdAt,
      });
    }

    return group;
  },

  async inviteMember(groupId: string, displayName: string): Promise<Membership> {
    await delay();
    const group = groups.find((g) => g.id === groupId);
    const membership: Membership = {
      id: genId('m'),
      groupId,
      userId: genId('u'),
      role: 'member',
      displayName,
      joinedAt: new Date().toISOString(),
      status: 'invited',
    };
    memberships.push(membership);
    if (group) group.memberCount += 1;
    activityEvents.unshift({
      id: genId('a'),
      type: 'member_invited',
      title: 'Membre invité',
      description: `${displayName} a été invité·e${group ? ` à rejoindre ${group.name}` : ''}.`,
      groupId,
      userName: displayName,
      at: new Date().toISOString(),
    });
    return membership;
  },
};
