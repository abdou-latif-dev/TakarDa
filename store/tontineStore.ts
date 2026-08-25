import { create } from 'zustand';
import { tontineService, type TontineSummary } from '@/services/tontineService';
import type { AsyncStatus } from './groupStore';
import type { Contribution, ContributionStatus } from '@/types/entities';

interface TontineState {
  summaries: Record<string, TontineSummary>;
  summaryStatus: Record<string, AsyncStatus>;
  history: Record<string, Contribution[]>;
  historyStatus: Record<string, AsyncStatus>;

  fetchSummary: (groupId: string) => Promise<void>;
  fetchHistory: (groupId: string) => Promise<void>;
  addContribution: (input: {
    groupId: string;
    cycleId: string;
    memberId: string;
    amount: number;
    status: ContributionStatus;
    note?: string;
  }) => Promise<Contribution>;
}

export const useTontineStore = create<TontineState>((set, get) => ({
  summaries: {},
  summaryStatus: {},
  history: {},
  historyStatus: {},

  fetchSummary: async (groupId) => {
    set((s) => ({ summaryStatus: { ...s.summaryStatus, [groupId]: 'loading' } }));
    try {
      const summary = await tontineService.getSummary(groupId);
      set((s) => ({
        summaries: { ...s.summaries, [groupId]: summary },
        summaryStatus: { ...s.summaryStatus, [groupId]: 'success' },
      }));
    } catch {
      set((s) => ({ summaryStatus: { ...s.summaryStatus, [groupId]: 'error' } }));
    }
  },

  fetchHistory: async (groupId) => {
    set((s) => ({ historyStatus: { ...s.historyStatus, [groupId]: 'loading' } }));
    try {
      const history = await tontineService.listHistory(groupId);
      set((s) => ({
        history: { ...s.history, [groupId]: history },
        historyStatus: { ...s.historyStatus, [groupId]: 'success' },
      }));
    } catch {
      set((s) => ({ historyStatus: { ...s.historyStatus, [groupId]: 'error' } }));
    }
  },

  addContribution: async (input) => {
    const contribution = await tontineService.addContribution(input);
    await Promise.all([get().fetchSummary(input.groupId), get().fetchHistory(input.groupId)]);
    return contribution;
  },
}));
