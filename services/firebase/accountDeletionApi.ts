// Branche l'orchestration de suppression de compte sur Firebase (Authentication + Firestore).

import type { AccountDeletionApi } from '../accountDeletionService';
import { deleteCurrentAccount, reauthenticateWithPassword } from './firebaseAuthService';
import { getFirestoreDb } from './firebaseClient';
import { createCloudDeletion } from './cloudDeletionComposition';
import { leaveSharedSpacesBestEffort } from './sharedSpacesDeparture';
import { readDeletionLockState, type DeletionLockState } from './firestoreAccountDeletion';

export const firebaseAccountDeletionApi: AccountDeletionApi = {
  reauthenticate: (password) => reauthenticateWithPassword(password),
  // P5 : documents de synchronisation purgés et vérifiés AVANT les enregistrements, l'espace et le profil (reprise possible à chaque étape)
  // F6 : le compte quitte d'abord, en meilleur effort et sans jamais bloquer, les espaces partagés qu'il a rejoints (le nom saisi dans ses demandes est retiré)
  deleteCloudData: async (uid) => {
    await leaveSharedSpacesBestEffort(getFirestoreDb(), uid);
    return createCloudDeletion(getFirestoreDb())(uid);
  },
  deleteAuthAccount: () => deleteCurrentAccount(),
};

/** Lecture SERVEUR (lecture seule) de l'état du verrou de suppression : « unknown » dès que la lecture n'est pas concluante. */
export const readDeletionLock = (uid: string): Promise<DeletionLockState> => readDeletionLockState(getFirestoreDb(), uid);
