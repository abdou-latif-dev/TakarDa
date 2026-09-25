import { create } from 'zustand';
import { storage } from '@/services/storage';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_SETTINGS_KEY = 'theme_settings';

interface ThemeSettings {
  mode: ThemeMode;
  accentKey: string; // 'default' today; a future "Apparence" screen would offer more
}

const DEFAULT_SETTINGS: ThemeSettings = { mode: 'system', accentKey: 'default' };

interface ThemeState extends ThemeSettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setAccentKey: (accentKey: string) => Promise<void>;
}

/** Persisted light/dark/system appearance preference. */
export const useThemeStore = create<ThemeState>((set) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    const saved = await storage.get<ThemeSettings>(THEME_SETTINGS_KEY).catch(() => null);
    set({ ...DEFAULT_SETTINGS, ...saved, hydrated: true });
  },

  setMode: async (mode) => {
    set({ mode });
    await storage.set(THEME_SETTINGS_KEY, { mode, accentKey: useThemeStore.getState().accentKey });
  },

  setAccentKey: async (accentKey) => {
    set({ accentKey });
    await storage.set(THEME_SETTINGS_KEY, { mode: useThemeStore.getState().mode, accentKey });
  },
}));
