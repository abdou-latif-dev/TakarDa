import { create } from 'zustand';
import type { AccountPromptReason } from '@/services/accountPromptService';

/** État de la fenêtre « un compte est nécessaire » (montée une seule fois dans app/_layout.tsx). */
interface AccountPromptState {
  visible: boolean;
  reason: AccountPromptReason;
  /** Les comptes sont fermés et l'utilisateur a appuyé sur « S'inscrire » ou « Se connecter » : message d'explication. */
  unavailable: boolean;
  open: (reason: AccountPromptReason) => void;
  /** Comptes fermés : ouvre directement le message d'explication (bloc « S'inscrire / Se connecter » de l'accueil). */
  openUnavailable: () => void;
  showUnavailable: () => void;
  close: () => void;
}

export const useAccountPromptStore = create<AccountPromptState>((set) => ({
  visible: false,
  reason: 'sync',
  unavailable: false,
  open: (reason) => set({ visible: true, reason, unavailable: false }),
  openUnavailable: () => set({ visible: true, unavailable: true }),
  showUnavailable: () => set({ unavailable: true }),
  close: () => set({ visible: false, unavailable: false }),
}));
