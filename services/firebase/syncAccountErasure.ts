// Effacement du compte côté cloud : documents de synchronisation (`syncRecords`) PUIS le reste (`records`, espace, profil) — P4.1.
// Procédure CONTRÔLÉE : c'est la seule voie de suppression physique des documents de synchronisation. NON branchée à l'application
// (aucun import hors tests) ; module pur : aucun SDK (le port `ErasureBackend` est réalisé dans firestoreSyncBackend.ts).
//
// Ordre (chaque étape est confirmée par une lecture SERVEUR avant la suivante) :
//   1. propriété démontrée (espace personnel du compte, seul membre) ;
//   2. verrou de suppression posé puis confirmé (plus aucune écriture de synchronisation ni d'enregistrement ; les règles n'autorisent
//      la suppression physique de `syncRecords` QUE sous ce verrou) ;
//   3. suppression de `syncRecords` par lots, puis vérification : plus aucun document ;
//   4. seulement ensuite : le reste (`records`, espace, profil) par la procédure existante, fournie par l'appelant (`deleteRest`).
// Pourquoi cet ordre : une fois l'espace supprimé, les règles interdisent tout accès à ses sous-collections — des documents de
// synchronisation restés derrière seraient des ORPHELINS inatteignables. Tant que `syncRecords` n'est pas confirmé vide, l'espace
// n'est donc pas touché.
//
// Reprise : toutes les étapes sont idempotentes (verrou déjà posé, lots déjà supprimés) ; relancer continue là où la procédure s'est
// arrêtée (réseau, délai, arrêt du processus), sans rien refaire de destructeur inutilement.

import type { CloudDeletionReport } from '../accountDeletionService';

export interface SpaceState {
  exists: boolean;
  ownerUid: string | null;
  memberUids: string[];
  locked: boolean;
}

/** Port : lectures SERVEUR, écritures confirmées. Réalisé avec le SDK dans firestoreSyncBackend.ts, en mémoire dans les tests. */
export interface ErasureBackend {
  readSpace(): Promise<SpaceState>;
  lockSpace(at: string): Promise<void>;
  /** Jusqu'à `limit` identifiants de documents de synchronisation (lecture serveur). */
  listSyncIds(limit: number): Promise<string[]>;
  removeSyncDocs(ids: string[]): Promise<void>;
}

export const ERASURE_PAGE_SIZE = 100;
export const ERASURE_OPERATION_TIMEOUT_MS = 15_000;
export const ERASURE_DEADLINE_MS = 5 * 60 * 1000;
const MAX_PAGES = 10_000;

export type SyncPurgeStatus = 'purged' | 'space_absent' | 'unproven' | 'incomplete' | 'not_started';

export interface AccountErasureReport {
  /** Documents de synchronisation. */
  syncRecords: { status: SyncPurgeStatus; found: number; deleted: number; remaining: number | null };
  locked: boolean;
  /** Rapport de la procédure existante (`records`, espace, profil) ; null si elle n'a pas été lancée. */
  rest: CloudDeletionReport | null;
  /** Vrai seulement si `syncRecords` est confirmé vide ET si le reste est vérifié. */
  verified: boolean;
  /** Une opération n'a pas répondu à temps : son résultat est inconnu. */
  uncertain: boolean;
  /** Espace déjà absent : d'éventuels documents de synchronisation restés derrière seraient inatteignables par les règles. */
  orphansPossible: boolean;
  error: { code: string; message: string } | null;
}

export class ErasureTimeout extends Error {
  readonly code = 'client-timeout';
  constructor(readonly step: string, readonly ms: number) {
    super(`Pas de réponse du serveur en ${Math.round(ms / 1000)} s (${step}). L’opération a peut-être été appliquée.`);
    this.name = 'ErasureTimeout';
  }
}

function timed<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ErasureTimeout(step, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const failure = (error: unknown): { code: string; message: string } => ({
  code: (error as { code?: string } | null)?.code ?? 'unknown',
  message: error instanceof Error ? error.message : 'Erreur Firestore.',
});

export interface ErasureOptions {
  backend: ErasureBackend;
  uid: string;
  /** Procédure existante pour `records`, l'espace et le profil (ex. `deleteAccountCloudData`). Lancée seulement si `syncRecords` est vide. */
  deleteRest: () => Promise<CloudDeletionReport>;
  now?: () => number;
  timeoutMs?: number;
  deadlineMs?: number;
  pageSize?: number;
}

export async function eraseAccountCloudData(options: ErasureOptions): Promise<AccountErasureReport> {
  const { backend, uid } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? ERASURE_OPERATION_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? ERASURE_DEADLINE_MS;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? ERASURE_PAGE_SIZE, 400));
  const startedAt = now();
  const step = <T,>(promise: Promise<T>, label: string) => timed(promise, timeoutMs, label);

  const report: AccountErasureReport = {
    syncRecords: { status: 'not_started', found: 0, deleted: 0, remaining: null },
    locked: false,
    rest: null,
    verified: false,
    uncertain: false,
    orphansPossible: false,
    error: null,
  };
  if (!uid) {
    report.error = { code: 'no-account', message: 'Aucun compte : rien n’est supprimé.' };
    return report;
  }

  try {
    // 1. propriété démontrée par une lecture serveur
    const space = await step(backend.readSpace(), 'lecture de l’espace');
    if (!space.exists) {
      // espace absent : les règles interdisent tout accès à ses sous-collections ; on laisse la procédure existante conclure (profil)
      report.syncRecords.status = 'space_absent';
      report.orphansPossible = true;
    } else if (space.ownerUid !== uid || space.memberUids.length !== 1 || space.memberUids[0] !== uid) {
      report.syncRecords.status = 'unproven';
      return report; // rien n'est touché
    } else {
      // 2. verrou posé puis confirmé
      if (!space.locked) {
        let lockError: unknown = null;
        try {
          await step(backend.lockSpace(new Date(now()).toISOString()), 'verrouillage de l’espace');
        } catch (error) {
          lockError = error; // un autre appareil a peut-être posé le verrou : le serveur tranche à la relecture
        }
        const confirmed = await step(backend.readSpace(), 'vérification du verrou');
        if (!confirmed.exists || !confirmed.locked) {
          if (lockError) throw lockError;
          report.syncRecords.status = 'incomplete';
          report.error = { code: 'lock-unconfirmed', message: 'Le verrou de suppression n’a pas été confirmé par le serveur : rien n’a été supprimé.' };
          return report;
        }
      }
      report.locked = true;

      // 3. suppression par lots (lecture serveur de chaque page ; seuls les lots confirmés sont comptés)
      const processed = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (now() - startedAt > deadlineMs) {
          report.syncRecords.status = 'incomplete';
          report.error = { code: 'deadline', message: 'Durée maximale d’une tentative atteinte : relancez pour continuer là où la suppression s’est arrêtée.' };
          return report;
        }
        const ids = await step(backend.listSyncIds(pageSize), 'lecture des documents de synchronisation');
        if (ids.length === 0) break;
        if (ids.every((id) => processed.has(id))) {
          report.syncRecords.status = 'incomplete';
          report.syncRecords.remaining = ids.length;
          report.error = { code: 'no-progress', message: 'Des documents de synchronisation déjà supprimés sont toujours présents sur le serveur.' };
          return report;
        }
        report.syncRecords.found += ids.length;
        await step(backend.removeSyncDocs(ids), 'suppression d’un lot de documents de synchronisation');
        ids.forEach((id) => processed.add(id));
        report.syncRecords.deleted += ids.length;
      }

      // 4. vérification SERVEUR : plus aucun document ; sinon l'espace n'est PAS touché
      const left = await step(backend.listSyncIds(1), 'vérification des documents de synchronisation');
      report.syncRecords.remaining = left.length;
      if (left.length > 0) {
        report.syncRecords.status = 'incomplete';
        return report;
      }
      report.syncRecords.status = 'purged';
    }

    // 5. le reste (records, espace, profil) par la procédure existante, seulement maintenant
    report.rest = await options.deleteRest();
    report.verified = report.rest.verified === true && (report.syncRecords.status === 'purged' || report.syncRecords.status === 'space_absent');
    if (report.rest.uncertain) report.uncertain = true;
    return report;
  } catch (error) {
    report.verified = false;
    report.error = failure(error);
    if (error instanceof ErasureTimeout) report.uncertain = true;
    if (report.syncRecords.status === 'not_started') report.syncRecords.status = 'incomplete';
    return report;
  }
}
