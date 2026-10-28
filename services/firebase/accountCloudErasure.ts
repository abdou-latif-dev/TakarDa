// Suppression des données cloud d'un compte — version COMPLÈTE (P5) : documents de synchronisation PUIS le reste. Module sans SDK.
//
// Compose la procédure d'effacement (syncAccountErasure.ts : propriété démontrée, verrou confirmé, `syncRecords` purgé puis VÉRIFIÉ vide)
// avec la suppression existante (`records`, espace, profil), et rend un `CloudDeletionReport` : le même contrat que l'orchestration
// `deleteAccount` utilise déjà. Garanties :
//  - le reste n'est lancé qu'après la vérification de la purge de `syncRecords` ;
//  - une purge incomplète donne un rapport NON vérifié (`verified: false`) : `deleteAccount` annonce alors une suppression « incomplète »,
//    conserve le compte et propose la reprise — jamais un succès ;
//  - la reprise relit le serveur : verrou déjà posé, lots déjà supprimés, rien n'est refait inutilement.

import type { CloudDeletionReport } from '../accountDeletionService';
import type { TombstoneBackend } from './accountTombstone';
import { eraseOwnedModules, type ModuleErasureBackend, type ModulesErasureReport } from './moduleErasure';
import { ERASURE_OPERATION_TIMEOUT_MS, ErasureTimeout, eraseAccountCloudData, type AccountErasureReport, type ErasureBackend } from './syncAccountErasure';

export interface CompleteErasureDeps {
  backend: ErasureBackend;
  /** Suppression existante de `records`, de l'espace et du profil (ex. `deleteAccountCloudData`). */
  deleteRest: () => Promise<CloudDeletionReport>;
  /** Espaces partagés du compte (F4) : effacés AVANT tout le reste ; une procédure non terminée garde le compte (reprise possible). Absent = comptes sans espaces partagés. */
  modules?: ModuleErasureBackend;
  /**
   * Marqueur « compte supprimé » (accountTombstone.ts), posé AVANT toute suppression : un ancien jeton du même compte ne peut plus rien recréer ensuite. Posé seulement si la
   * propriété de l'espace n'est pas contredite (sinon rien n'est touché, comme avant). Impossible à poser = suppression non commencée, compte conservé. Absent = sans marqueur.
   */
  tombstone?: TombstoneBackend;
  now?: () => number;
  timeoutMs?: number;
  deadlineMs?: number;
  pageSize?: number;
}

const syncSummary = (e: AccountErasureReport): NonNullable<CloudDeletionReport['syncRecords']> => ({ ...e.syncRecords });

export function toCloudDeletionReport(e: AccountErasureReport): CloudDeletionReport {
  if (e.rest) {
    return {
      ...e.rest,
      syncRecords: syncSummary(e),
      verified: e.verified, // synchronisation vide ET reste vérifié : jamais l'un sans l'autre
      uncertain: e.uncertain || e.rest.uncertain,
      error: e.rest.error ?? e.error,
      locked: e.rest.locked ?? (e.locked ? true : undefined),
    };
  }
  // le reste n'a PAS été lancé (propriété non démontrée, verrou non confirmé, purge incomplète, délai…) : rien d'autre n'est touché
  return {
    ownership: e.syncRecords.status === 'unproven' ? 'unproven' : 'proven',
    records: { found: 0, deleted: 0, remaining: null },
    space: 'skipped',
    profile: 'skipped',
    verified: false,
    uncertain: e.uncertain,
    error: e.error ?? (e.syncRecords.status === 'unproven' ? null : { code: 'sync-purge-incomplete', message: 'Les documents de synchronisation ne sont pas tous supprimés : le reste du compte n’a pas été touché.' }),
    locked: e.locked ? true : undefined,
    syncRecords: syncSummary(e),
  };
}

const modulesSummary = (m: ModulesErasureReport): NonNullable<CloudDeletionReport['modules']> => ({ status: m.status, modules: m.modules, deleted: m.deleted, docsDeleted: m.docsDeleted, pending: m.pending.length });

/** Rapport quand les espaces partagés ne sont pas tous effacés : rien d'autre n'est touché, le compte est conservé et la reprise relit le serveur. */
function modulesIncompleteReport(m: ModulesErasureReport): CloudDeletionReport {
  return {
    ownership: m.status === 'unproven' ? 'unproven' : 'proven',
    records: { found: 0, deleted: 0, remaining: null },
    space: 'skipped',
    profile: 'skipped',
    verified: false,
    uncertain: m.uncertain,
    error: m.error ?? { code: 'modules-purge-incomplete', message: 'Vos espaces partagés ne sont pas tous supprimés : le reste du compte n’a pas été touché.' },
    modules: modulesSummary(m),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ErasureTimeout(step, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Le marqueur n'a pas pu être posé : la suppression n'a PAS commencé (rien n'est supprimé, le compte est conservé, la reprise est possible). */
function tombstoneFailedReport(error: unknown): CloudDeletionReport {
  const timedOut = error instanceof ErasureTimeout;
  return {
    ownership: 'proven',
    records: { found: 0, deleted: 0, remaining: null },
    space: 'skipped',
    profile: 'skipped',
    verified: false,
    uncertain: timedOut,
    error: {
      code: 'tombstone-failed',
      message: timedOut
        ? error.message
        : 'Le compte n’a pas pu être marqué « en cours de suppression » : rien n’a été supprimé. Réessayez dans un instant.',
    },
    tombstone: 'failed',
  };
}

export async function deleteAccountCloudDataWithSync(uid: string, deps: CompleteErasureDeps): Promise<CloudDeletionReport> {
  // 0. marqueur « compte supprimé » AVANT toute suppression (protection contre la recréation de données avec un ancien jeton)
  let tombstone: 'created' | 'exists' | undefined;
  if (deps.tombstone) {
    try {
      const timeoutMs = deps.timeoutMs ?? ERASURE_OPERATION_TIMEOUT_MS;
      const space = await withTimeout(deps.backend.readSpace(), timeoutMs, 'lecture de l’espace');
      const contradicted = space.exists && (space.ownerUid !== uid || space.memberUids.length !== 1 || space.memberUids[0] !== uid);
      // propriété contredite : rien n'est touché (la procédure ci-dessous le constate et s'arrête), donc aucun marqueur irréversible
      if (!contradicted) tombstone = await withTimeout(deps.tombstone.mark(), timeoutMs, 'marquage du compte');
    } catch (error) {
      return tombstoneFailedReport(error);
    }
  }
  const tagged = (report: CloudDeletionReport): CloudDeletionReport => (tombstone ? { ...report, tombstone } : report);

  let modulesReport: ModulesErasureReport | null = null;
  if (deps.modules) {
    modulesReport = await eraseOwnedModules({ backend: deps.modules, uid, now: deps.now, timeoutMs: deps.timeoutMs, deadlineMs: deps.deadlineMs, pageSize: deps.pageSize });
    if (modulesReport.status !== 'none' && modulesReport.status !== 'purged') return tagged(modulesIncompleteReport(modulesReport));
  }
  const erasure = await eraseAccountCloudData({ backend: deps.backend, uid, deleteRest: deps.deleteRest, now: deps.now, timeoutMs: deps.timeoutMs, deadlineMs: deps.deadlineMs, pageSize: deps.pageSize });
  const report = toCloudDeletionReport(erasure);
  return tagged(modulesReport ? { ...report, modules: modulesSummary(modulesReport) } : report);
}
