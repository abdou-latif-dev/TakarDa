import { create } from 'zustand';
import { statisticsService } from '@/services/statisticsService';
import type { AsyncStatus } from './groupStore';
import type { StatisticsOverview } from '@/types/entities';

interface StatisticsState {
  overview: StatisticsOverview | null;
  status: AsyncStatus;
  fetchOverview: () => Promise<void>;
}

export const useStatisticsStore = create<StatisticsState>((set) => ({
  overview: null,
  status: 'idle',

  fetchOverview: async () => {
    set({ status: 'loading' });
    try {
      const overview = await statisticsService.getOverview();
      set({ overview, status: 'success' });
    } catch {
      set({ status: 'error' });
    }
  },
}));
