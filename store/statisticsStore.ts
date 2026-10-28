import { create } from 'zustand';
import { statisticsService } from '@/services/statisticsService';
import { getAccountEpoch } from '@/services/cloudVisibility';
import type { AsyncStatus } from './asyncStatus';
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
    const epoch = getAccountEpoch();
    try {
      const overview = await statisticsService.getOverview();
      if (epoch !== getAccountEpoch()) return; // résultat d'un ancien compte
      set({ overview, status: 'success' });
    } catch {
      if (epoch === getAccountEpoch()) set({ status: 'error' });
    }
  },
}));
