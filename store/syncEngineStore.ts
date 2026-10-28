import { create } from 'zustand';
import { getAccountEpoch } from '@/services/cloudVisibility';
import { bannerModel, engineStatus, type BannerModel, type CycleStatus, type EngineStatusSummary } from '@/services/syncDisplay';

/**
 * État d'affichage alimenté par les VRAIS états du moteur de synchronisation (phase 6, étape 4). Tant que `active` est faux — c'est le cas
 * dans cette version : le drapeau cloud est fermé et rien ne démarre le moteur — les composants gardent leur comportement actuel et ce store
 * ne lit rien. Il ne lance aucune synchronisation par lui-même : `syncNow` délègue à une fonction fournie par le démarrage du cycle (étape 7).
 */
interface SyncEngineState {
  active: boolean;
  summary: EngineStatusSummary | null;
  banner: BannerModel | null;
  cycle: CycleStatus | null;
  setActive: (active: boolean) => void;
  setCycleStatus: (cycle: CycleStatus | null) => void;
  setSyncNowHandler: (handler: (() => Promise<void>) | null) => void;
  /** Relit, sans réseau, l'état réel du moteur (jamais d'un ancien compte : résultat écarté si le compte a changé entre-temps). */
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  reset: () => void;
}

let syncNowHandler: (() => Promise<void>) | null = null;

const empty = { summary: null, banner: null, cycle: null };

export const useSyncEngineStore = create<SyncEngineState>((set, get) => ({
  active: false,
  ...empty,
  setActive: (active) => {
    if (!active) set({ active: false, ...empty });
    else set({ active: true });
  },
  setCycleStatus: (cycle) => {
    set({ cycle });
    const summary = get().summary;
    if (summary) set({ banner: bannerModel(summary, cycle ? { status: cycle } : null) });
  },
  setSyncNowHandler: (handler) => {
    syncNowHandler = handler;
  },
  refresh: async () => {
    if (!get().active) return;
    const epoch = getAccountEpoch();
    const summary = await engineStatus();
    if (epoch !== getAccountEpoch() || !get().active) return;
    const cycle = get().cycle;
    set({ summary, banner: bannerModel(summary, cycle ? { status: cycle } : null) });
  },
  syncNow: async () => {
    if (!get().active || !syncNowHandler) return;
    await syncNowHandler();
    await get().refresh();
  },
  reset: () => {
    syncNowHandler = null;
    set({ active: false, ...empty });
  },
}));
