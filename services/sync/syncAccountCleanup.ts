// Oubli de l'état TECHNIQUE de synchronisation d'un compte supprimé — P5. Local, sans réseau.
//
// Retire seulement ce qui n'a de sens que pour ce compte et ne contient aucune donnée de l'utilisateur : file d'opérations, référence,
// métadonnées, curseur de lecture, changements reçus en attente. Il NE touche PAS aux données métier, ni aux corrections financières, ni
// aux conflits résolus ou ouverts, ni aux copies des suppressions reçues (versions conservées) : ce sont des données de l'utilisateur.
// Les éléments du compte redeviennent sans propriétaire (visibles comme données locales, comme la libération V1) ; rien n'est supprimé.

import { storage } from '../storage';
import { clearEngineChosen } from '../syncMode';
import { workspaceId, workspaceKey } from '../persistence';
import { releaseOwnership } from './ownership';
import { accountKeyFor } from './syncAccount';
import { acquireSyncLockWithin } from './syncLock';

const TECHNICAL_STORES = ['sync_queue', 'sync_baseline', 'sync_meta', 'sync_inbound_cursor', 'sync_inbound_pending', 'sync_budget', 'sync_activation'] as const;
// Carnet des espaces partagés du compte supprimé (F3b/F3c) : espaces créés ou demandés, état publié, copie reçue de la vue du locataire. Rien ne s'y rapporte plus une fois
// le compte et ses espaces supprimés ; aucune donnée métier n'y figure (la copie reçue est une projection venue du propriétaire).
const SHARED_SPACE_STORES = ['shared_modules', 'tenant_view_published', 'tenant_view_received'] as const;

/** Attente maximale du verrou de synchronisation avant d'oublier l'état technique d'un compte. */
const FORGET_LOCK_WAIT_MS = 5000;

export async function forgetSyncAccountState(uid: string, lockWaitMs: number = FORGET_LOCK_WAIT_MS): Promise<{ removedStores: number; releasedItems: number }> {
  if (workspaceId() !== 'personal') return { removedStores: 0, releasedItems: 0 }; // la démonstration n'a jamais d'état de synchronisation
  // Sous le verrou de synchronisation (attente bornée) : jamais en même temps qu'une exécution du moteur, qui pourrait sinon réécrire ces fichiers
  // techniques après leur oubli. Verrou toujours occupé : rien n'est oublié, l'appelant le sait et peut réessayer (aucune donnée perdue).
  const release = await acquireSyncLockWithin(lockWaitMs);
  if (!release) throw new Error('Une synchronisation est encore en cours : l’état technique du compte n’a pas été oublié. Réessayez dans un instant.');
  try {
    let removedStores = 0;
    for (const base of [...TECHNICAL_STORES, ...SHARED_SPACE_STORES]) {
      const key = workspaceKey(accountKeyFor(base, uid));
      if ((await storage.get(key)) !== null) {
        await storage.remove(key);
        removedStores += 1;
      }
    }
    const releasedItems = await releaseOwnership(uid);
    await clearEngineChosen(uid); // le choix du moteur appartient au compte supprimé ; aucune donnée métier n'est touchée
    return { removedStores, releasedItems };
  } finally {
    release();
  }
}
