import { create } from 'zustand';
import { tontineService, type TontineSummary, type TourHistoryEntry } from '@/services/tontineService';
import type { AsyncStatus } from './asyncStatus';

const tourKey = (groupId: string, tourNumber: number) => `${groupId}:${tourNumber}`;

interface TontineState {
  /** Current-tour summary, keyed by groupId — what the Dashboard reads. */
  summaries: Record<string, TontineSummary | null>;
  summaryStatus: Record<string, AsyncStatus>;
  /** Any tour's summary, keyed by `${groupId}:${tourNumber}` — what the tour
   * detail screen and "Cotisation +" (which targets a specific tour) read. */
  tourSummaries: Record<string, TontineSummary | null>;
  tourSummaryStatus: Record<string, AsyncStatus>;
  history: Record<string, TourHistoryEntry[]>;
  historyStatus: Record<string, AsyncStatus>;

  fetchSummary: (groupId: string) => Promise<void>;
  fetchTourSummary: (groupId: string, tourNumber: number) => Promise<void>;
  fetchHistory: (groupId: string) => Promise<void>;
  recordContributions: (input: { groupId: string; tourId: string; memberIds: string[] }) => Promise<void>;
  advanceRound: (groupId: string) => Promise<void>;
}

export const useTontineStore = create<TontineState>((set, get) => ({
  summaries: {},
  summaryStatus: {},
  tourSummaries: {},
  tourSummaryStatus: {},
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

  fetchTourSummary: async (groupId, tourNumber) => {
    const key = tourKey(groupId, tourNumber);
    set((s) => ({ tourSummaryStatus: { ...s.tourSummaryStatus, [key]: 'loading' } }));
    try {
      const summary = await tontineService.getSummary(groupId, tourNumber);
      set((s) => ({
        tourSummaries: { ...s.tourSummaries, [key]: summary },
        tourSummaryStatus: { ...s.tourSummaryStatus, [key]: 'success' },
      }));
    } catch {
      set((s) => ({ tourSummaryStatus: { ...s.tourSummaryStatus, [key]: 'error' } }));
    }
  },

  fetchHistory: async (groupId) => {
    set((s) => ({ historyStatus: { ...s.historyStatus, [groupId]: 'loading' } }));
    try {
      const history = await tontineService.getTourHistory(groupId);
      set((s) => ({
        history: { ...s.history, [groupId]: history },
        historyStatus: { ...s.historyStatus, [groupId]: 'success' },
      }));
    } catch {
      set((s) => ({ historyStatus: { ...s.historyStatus, [groupId]: 'error' } }));
    }
  },

  recordContributions: async (input) => {
    await tontineService.recordContributions(input);
    await Promise.all([get().fetchSummary(input.groupId), get().fetchHistory(input.groupId)]);
    // Refresh every cached tour-specific summary for this group too, since
    // "Cotisation +" may have targeted a tour other than the current one.
    const staleTourKeys = Object.keys(get().tourSummaries).filter((k) => k.startsWith(`${input.groupId}:`));
    await Promise.all(
      staleTourKeys.map((k) => get().fetchTourSummary(input.groupId, Number(k.split(':')[1]))),
    );
  },

  advanceRound: async (groupId) => {
    await tontineService.advanceRound(groupId);
    await get().fetchSummary(groupId);
  },
}));
