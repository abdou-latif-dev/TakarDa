import { create } from 'zustand';
import { groupService, type CreateTontineInput } from '@/services/groupService';
import type { AsyncStatus } from './asyncStatus';
import type { Group, Membership } from '@/types/entities';

interface GroupState {
  groups: Group[];
  status: AsyncStatus;
  error: string | null;
  members: Record<string, Membership[]>;
  membersStatus: Record<string, AsyncStatus>;

  fetchGroups: () => Promise<void>;
  fetchMembers: (groupId: string) => Promise<void>;
  createTontine: (input: CreateTontineInput) => Promise<Group>;
  addFormeaseMember: (groupId: string, formeaseId: string) => Promise<void>;
  addGuestMember: (groupId: string, input: { firstName: string; lastName: string; phone?: string }) => Promise<void>;
  setMemberOrder: (groupId: string, orderedMembershipIds: string[]) => Promise<void>;
  deleteTontine: (groupId: string) => Promise<void>;
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

  createTontine: async (input) => {
    const group = await groupService.createTontine(input);
    set((s) => ({ groups: [group, ...s.groups] }));
    return group;
  },

  addFormeaseMember: async (groupId, formeaseId) => {
    await groupService.addFormeaseMember(groupId, formeaseId);
    await Promise.all([get().fetchMembers(groupId), get().fetchGroups()]);
  },

  addGuestMember: async (groupId, input) => {
    await groupService.addGuestMember(groupId, input);
    await Promise.all([get().fetchMembers(groupId), get().fetchGroups()]);
  },

  setMemberOrder: async (groupId, orderedMembershipIds) => {
    await groupService.setMemberOrder(groupId, orderedMembershipIds);
    await get().fetchMembers(groupId);
  },

  deleteTontine: async (groupId) => {
    await groupService.deleteTontine(groupId);
    set((s) => ({ groups: s.groups.filter((g) => g.id !== groupId) }));
  },

  getGroup: (groupId) => get().groups.find((g) => g.id === groupId),
}));
