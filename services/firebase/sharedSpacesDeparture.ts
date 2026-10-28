// Départ des espaces partagés rejoints, au moment de la suppression d'un compte (F6) : composition de production. Reçoit le Firestore de l'application ; lit le carnet
// local du compte (espaces demandés) ; MEILLEUR EFFORT : n'échoue jamais, ne bloque jamais la suppression du compte.

import type { Firestore } from 'firebase/firestore';
import { listLocalModules } from '../sharedModules/localModules';
import { leaveJoinedModules, type DepartureReport } from '../sharedModules/departure';
import { createFirestoreModulesBackend } from './firestoreModulesBackend';

export async function leaveSharedSpacesBestEffort(db: Firestore, uid: string): Promise<DepartureReport | null> {
  try {
    const joined = (await listLocalModules()).joined.map((j) => j.moduleId);
    if (joined.length === 0) return { left: 0, erased: 0, failed: 0 };
    return await leaveJoinedModules(createFirestoreModulesBackend(db, uid), uid, joined);
  } catch {
    return null; // carnet illisible ou cloud injoignable : la suppression du compte continue
  }
}
