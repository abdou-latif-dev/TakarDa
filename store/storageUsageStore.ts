import { create } from 'zustand';
import { storageUsageService, type LocalStorageUsage } from '@/services/storageUsageService';
import type { AsyncStatus } from './asyncStatus';

interface StorageUsageState {
  usage: LocalStorageUsage | null;
  status: AsyncStatus;
  fetchUsage: () => Promise<void>;
}

export const useStorageUsageStore = create<StorageUsageState>((set) => ({
  usage: null,
  status: 'idle',

  fetchUsage: async () => {
    set({ status: 'loading' });
    try {
      const usage = await storageUsageService.getUsage();
      set({ usage, status: 'success' });
    } catch {
      set({ status: 'error' });
    }
  },
}));
