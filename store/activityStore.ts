import { create } from 'zustand';
import { activityService } from '@/services/activityService';
import { getAccountEpoch } from '@/services/cloudVisibility';
import type { AsyncStatus } from './asyncStatus';
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
    const epoch = getAccountEpoch();
    try {
      const events = await activityService.list(groupId);
      if (epoch !== getAccountEpoch()) return; // résultat d'un ancien compte
      set({ events, status: 'success' });
    } catch (e) {
      if (epoch !== getAccountEpoch()) return;
      set({ status: 'error', error: e instanceof Error ? e.message : 'Chargement impossible.' });
    }
  },

  createEvent: async (input) => {
    const event = await activityService.createEvent(input);
    set((s) => ({ events: [event, ...s.events] }));
  },
}));
