// Premier lancement : l'utilisateur a-t-il déjà vu la présentation de TakarDa ?
//
// La clé 'onboarding_seen' est celle utilisée depuis le début (préfixe @formease/ conservé) :
// une installation existante n'est donc pas ramenée à la présentation. Aucun compte n'est
// requis pour entrer dans l'application.

import { storage } from './storage';

export const ONBOARDING_KEY = 'onboarding_seen';

export type EntryRoute = 'onboarding' | 'tabs';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await storage.get<boolean>(ONBOARDING_KEY)) === true;
  } catch {
    return false; // stockage illisible : on montre la présentation plutôt que de bloquer l'entrée
  }
}

export async function completeOnboarding(): Promise<void> {
  await storage.set(ONBOARDING_KEY, true);
}

/** Où va-t-on après le splash ? Jamais vers l'écran de connexion : il n'est pas obligatoire. */
export function resolveEntryRoute(onboardingCompleted: boolean): EntryRoute {
  return onboardingCompleted ? 'tabs' : 'onboarding';
}
