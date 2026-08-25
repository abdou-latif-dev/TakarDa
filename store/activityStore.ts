import { create } from 'zustand';
import { activityService } from '@/services/activityService';
import type { AsyncStatus } from './groupStore';
import type { ActivityEvent } from '@/types/entities';

interface ActivityState {
  events: ActivityEvent[];
  status: AsyncStatus;
  error: string | null;
  fetch: (groupId?: string) => Promise<void>;
  createEvent: (input: { groupId: string; title: string; description: string }) => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  status: 'idle',
  error: null,

  fetch: async (groupId) => {
    set({ status: 'loading', error: null });
    try {
      const events = await activityService.list(groupId);
      set({ events, status: 'success' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Chargement impossible.' });
    }
  },

  createEvent: async (input) => {
    const event = await activityService.createEvent(input);
    set((s) => ({ events: [event, ...s.events] }));
  },
}));
