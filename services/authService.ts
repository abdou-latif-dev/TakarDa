// Abstract auth layer. Today this is a local mock; swapping to a real
// backend later means rewriting the bodies below — callers (store/authStore)
// never touch db.ts or storage.ts directly.

import { CURRENT_USER_ID, delay, users } from './db';
import { storage } from './storage';
import type { User } from '@/types/entities';

const SESSION_KEY = 'session';

export interface AuthCredentials {
  identifier: string; // email or phone
  password: string;
}

export interface SignUpPayload {
  fullName: string;
  identifier: string;
  password: string;
}

async function findCurrentUser(): Promise<User> {
  const user = users.find((u) => u.id === CURRENT_USER_ID);
  if (!user) throw new Error('Utilisateur introuvable.');
  return user;
}

export const authService = {
  async restoreSession(): Promise<User | null> {
    const hasSession = await storage.get<{ userId: string }>(SESSION_KEY);
    if (!hasSession) return null;
    return findCurrentUser();
  },

  async login(credentials: AuthCredentials): Promise<User> {
    await delay();
    if (!credentials.identifier || !credentials.password) {
      throw new Error('Veuillez renseigner vos identifiants.');
    }
    const user = await findCurrentUser();
    await storage.set(SESSION_KEY, { userId: user.id });
    return user;
  },

  async signUp(payload: SignUpPayload): Promise<User> {
    await delay();
    if (!payload.fullName || !payload.identifier || !payload.password) {
      throw new Error('Veuillez remplir tous les champs.');
    }
    const user = await findCurrentUser();
    await storage.set(SESSION_KEY, { userId: user.id });
    return { ...user, name: payload.fullName };
  },

  async logout(): Promise<void> {
    await delay(200);
    await storage.remove(SESSION_KEY);
  },

  async requestPasswordReset(_identifier: string): Promise<void> {
    await delay();
  },

  async updateProfile(patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'avatarUrl'>>): Promise<User> {
    await delay();
    const user = await findCurrentUser();
    Object.assign(user, patch);
    return user;
  },
};
