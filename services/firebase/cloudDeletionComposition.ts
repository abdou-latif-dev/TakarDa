// Composition RÉELLE de la suppression des données cloud d'un compte — P5. Une seule définition, utilisée par l'application
// (accountDeletionApi.ts) ET par la validation sur le projet de test (real/deletionFlow.n2.test.ts) : ce qui est validé est ce qui s'exécute.
//
// Reçoit une instance `Firestore` : n'importe ni la configuration, ni le client applicatif, ne démarre rien.
//   purge de `syncRecords` vérifiée  →  puis `records`, espace, profil (suppression existante)  →  rapport `CloudDeletionReport`.
// `options` ne sert qu'aux tests (injection de pannes) ; l'application ne l'utilise pas.

import type { Firestore } from 'firebase/firestore';
import type { CloudDeletionReport } from '../accountDeletionService';
import { deleteAccountCloudDataWithSync } from './accountCloudErasure';
import { createFirestoreTombstoneBackend } from './firestoreAccountTombstone';
import { deleteAccountCloudData, type DeletionOptions } from './firestoreAccountDeletion';
import { createFirestoreModuleErasureBackend } from './firestoreModulesBackend';
import { createFirestoreErasureBackend } from './firestoreSyncBackend';
import type { ModuleErasureBackend } from './moduleErasure';
import type { ErasureBackend } from './syncAccountErasure';

export interface CloudDeletionTestHooks {
  /** Options de la suppression existante (ex. opérations simulées). */
  deletion?: DeletionOptions;
  /** Enveloppe du port d'effacement (ex. panne après N lots). */
  wrapErasureBackend?: (backend: ErasureBackend) => ErasureBackend;
  timeoutMs?: number;
  pageSize?: number;
  /** Enveloppe du port d'effacement des espaces partagés (ex. panne après N lots). */
  wrapModuleErasureBackend?: (backend: ModuleErasureBackend) => ModuleErasureBackend;
  /** `false` : sans l'effacement des espaces partagés (réservé aux essais contre des règles qui ne les contiennent pas encore). Défaut : avec. */
  sharedModules?: boolean;
  /** `false` : sans le marqueur « compte supprimé » (réservé aux essais contre des règles qui ne le contiennent pas encore : sans elles, le marqueur est refusé et la suppression ne commence pas). Défaut : avec. */
  accountTombstone?: boolean;
}

export function createCloudDeletion(db: Firestore, hooks: CloudDeletionTestHooks = {}): (uid: string) => Promise<CloudDeletionReport> {
  return (uid) => {
    const base = createFirestoreErasureBackend(db, uid);
    const modules = hooks.sharedModules === false ? undefined : createFirestoreModuleErasureBackend(db, uid);
    return deleteAccountCloudDataWithSync(uid, {
      backend: hooks.wrapErasureBackend ? hooks.wrapErasureBackend(base) : base,
      modules: modules && hooks.wrapModuleErasureBackend ? hooks.wrapModuleErasureBackend(modules) : modules,
      tombstone: hooks.accountTombstone === false ? undefined : createFirestoreTombstoneBackend(db, uid),
      deleteRest: () => deleteAccountCloudData(db, uid, hooks.deletion),
      timeoutMs: hooks.timeoutMs,
      pageSize: hooks.pageSize,
    });
  };
}
