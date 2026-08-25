import { create } from 'zustand';
import { groupService } from '@/services/groupService';
import type { Group, GroupKind, Membership } from '@/types/entities';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

interface GroupState {
  groups: Group[];
  status: AsyncStatus;
  error: string | null;
  members: Record<string, Membership[]>;
  membersStatus: Record<string, AsyncStatus>;

  fetchGroups: () => Promise<void>;
  fetchMembers: (groupId: string) => Promise<void>;
  createGroup: (input: { name: string; description?: string; kind?: GroupKind }) => Promise<Group>;
  inviteMember: (groupId: string, displayName: string) => Promise<void>;
  getGroup: (groupId: string) => Group | undefined;
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  status: 'idle',
  error: null,
  members: {},
  membersStatus: {},

  fetchGroups: async () => {
    set({ status: 'loading', error: null });
    try {
      const groups = await groupService.listMyGroups();
      set({ groups, status: 'success' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Chargement impossible.' });
    }
  },

  fetchMembers: async (groupId) => {
    set((s) => ({ membersStatus: { ...s.membersStatus, [groupId]: 'loading' } }));
    try {
      const members = await groupService.listMembers(groupId);
      set((s) => ({
        members: { ...s.members, [groupId]: members },
        membersStatus: { ...s.membersStatus, [groupId]: 'success' },
      }));
    } catch {
      set((s) => ({ membersStatus: { ...s.membersStatus, [groupId]: 'error' } }));
    }
  },

  createGroup: async (input) => {
    const group = await groupService.createGroup(input);
    set((s) => ({ groups: [group, ...s.groups] }));
    return group;
  },

  inviteMember: async (groupId, displayName) => {
    const membership = await groupService.inviteMember(groupId, displayName);
    set((s) => ({
      members: { ...s.members, [groupId]: [...(s.members[groupId] ?? []), membership] },
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, memberCount: g.memberCount + 1 } : g)),
    }));
  },

  getGroup: (groupId) => get().groups.find((g) => g.id === groupId),
}));
