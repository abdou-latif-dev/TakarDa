import { create } from 'zustand';
import { authService, type AuthCredentials, type SignUpPayload } from '@/services/authService';
import type { User } from '@/types/entities';

interface AuthState {
  user: User | null;
  status: 'idle' | 'restoring' | 'authenticating' | 'ready' | 'error';
  error: string | null;
  restore: () => Promise<void>;
  login: (credentials: AuthCredentials) => Promise<void>;
  signUp: (payload: SignUpPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'avatarUrl'>>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',
  error: null,

  restore: async () => {
    set({ status: 'restoring' });
    try {
      const user = await authService.restoreSession();
      set({ user, status: 'ready', error: null });
    } catch {
      set({ user: null, status: 'ready' });
    }
  },

  login: async (credentials) => {
    set({ status: 'authenticating', error: null });
    try {
      const user = await authService.login(credentials);
      set({ user, status: 'ready' });
    } catch (e) {
      set({ status: 'ready', error: e instanceof Error ? e.message : 'Connexion impossible.' });
      throw e;
    }
  },

  signUp: async (payload) => {
    set({ status: 'authenticating', error: null });
    try {
      const user = await authService.signUp(payload);
      set({ user, status: 'ready' });
    } catch (e) {
      set({ status: 'ready', error: e instanceof Error ? e.message : 'Inscription impossible.' });
      throw e;
    }
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, status: 'ready' });
  },

  updateProfile: async (patch) => {
    const user = await authService.updateProfile(patch);
    set({ user });
  },
}));
