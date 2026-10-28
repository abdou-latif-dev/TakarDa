import { create } from 'zustand';
import { enterDemo, enterDemoIfFreshInstall, exitDemo, isDemoWorkspace, personalWorkspaceHasData } from '@/services/demoWorkspace';
import { resetAccountCaches } from './accountCaches';

/** Espace de démonstration actif ou non (état en mémoire ; le marqueur persistant est géré par services/persistence.ts). */
interface DemoState {
  active: boolean;
  busy: boolean;
  error: string | null;
  /**
   * Des données personnelles existent ET l'on est dans la démonstration : un lien de retour reste nécessaire pour les retrouver.
   * Faux sur une installation neuve (rien à retrouver) : aucun bandeau n'est alors affiché.
   */
  canReturn: boolean;
  /** À appeler une fois la base locale chargée : relit l'espace réellement actif. */
  sync: () => void;
  enter: () => Promise<boolean>;
  exit: () => Promise<boolean>;
  /** Première utilisation sans travail personnel : entre dans la démonstration. Jamais d'effet s'il existe des données personnelles. */
  enterIfFresh: () => Promise<boolean>;
  /**
   * Passer à l'espace personnel. « left » : retour aux données personnelles existantes ; « needs_account » : aucun travail personnel
   * n'existe, en commencer un nécessite un compte (on reste dans la démonstration) ; « failed » : changement impossible.
   */
  requestPersonal: () => Promise<'left' | 'needs_account' | 'failed'>;
}

const FAILURE = 'Le changement d’espace a échoué. Vos données personnelles ne sont pas supprimées : fermez puis rouvrez TakarDa.';

export const useDemoStore = create<DemoState>((set, get) => {
  /** Relit s'il existe des données personnelles à retrouver. Lecture impossible = « oui » (dans le doute, on garde le lien de retour). */
  const refreshCanReturn = async (): Promise<void> => {
    try {
      set({ canReturn: isDemoWorkspace() && (await personalWorkspaceHasData()) });
    } catch {
      set({ canReturn: isDemoWorkspace() });
    }
  };

  return {
    active: false,
    busy: false,
    error: null,
    canReturn: false,
    sync: () => {
      set({ active: isDemoWorkspace() });
      void refreshCanReturn();
    },
    enter: async () => {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        await enterDemo();
        resetAccountCaches();
        set({ active: true });
        await refreshCanReturn();
        return true;
      } catch {
        set({ active: isDemoWorkspace(), error: FAILURE });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    enterIfFresh: async () => {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        const entered = await enterDemoIfFreshInstall();
        if (entered) {
          resetAccountCaches();
          set({ active: true });
          await refreshCanReturn();
        }
        return entered;
      } catch {
        set({ active: isDemoWorkspace(), error: FAILURE });
        return false;
      } finally {
        set({ busy: false });
      }
    },
    requestPersonal: async () => {
      if (!get().active) return 'left';
      if (!(await personalWorkspaceHasData())) return 'needs_account';
      return (await get().exit()) ? 'left' : 'failed';
    },
    exit: async () => {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        await exitDemo();
        resetAccountCaches();
        set({ active: false, canReturn: false });
        return true;
      } catch {
        set({ active: isDemoWorkspace(), error: FAILURE });
        return false;
      } finally {
        set({ busy: false });
      }
    },
  };
});
