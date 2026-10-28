// Suppression du compte cloud : orchestration SANS SDK (testable). Ordre, états et messages.
//
// Trois choses distinctes, jamais confondues à l'écran :
//   1. les DONNÉES CLOUD (enregistrements, espace personnel, profil) ;
//   2. le COMPTE Firebase Authentication (e-mail, identifiant) ;
//   3. les DONNÉES LOCALES de l'appareil, qui sont CONSERVÉES (seul le marquage de propriété cloud est retiré).
//
// Ordre : réauthentification → données cloud (puis relecture de vérification) → nettoyage local → compte Firebase.
// Rien n'est annoncé comme supprimé sans vérification : un échec partiel a son propre état et son propre message.
// Chaque étape réseau est bornée dans le temps. Un délai dépassé donne un état INCERTAIN (l'opération a pu être appliquée
// sans réponse), jamais un succès ; la reprise est idempotente et relit d'abord le serveur.
// Le mot de passe ne sert qu'à la réauthentification : il n'est ni conservé ni renvoyé dans les résultats.

import { authErrorCode, mapAuthError } from './cloudAuthErrors';

/** Ce que la suppression des données cloud a réellement fait (relecture comprise). */
export interface CloudDeletionReport {
  /** « proven » : l'espace est bien personal_<uid>, propriété de ce compte, seul membre. « unproven » : rien n'a été supprimé. */
  ownership: 'proven' | 'space_absent' | 'unproven';
  records: { found: number; deleted: number; /** relu après coup ; null = impossible à relire */ remaining: number | null };
  /** « unknown » : la suppression a été demandée mais son résultat n'est pas confirmé par le serveur. */
  space: 'deleted' | 'absent' | 'failed' | 'skipped' | 'unknown';
  profile: 'deleted' | 'absent' | 'failed' | 'skipped' | 'unknown';
  /** Relecture SERVEUR faite : plus aucun enregistrement, espace et profil absents. Jamais déduit du cache local. */
  verified: boolean;
  /** Une opération n'a pas répondu à temps : elle a peut-être été appliquée. Résultat inconnu. */
  uncertain: boolean;
  error: { code: string; message: string } | null;
  /** Verrou de suppression de l'espace CONFIRMÉ par une lecture serveur pendant cette tentative (absent = non établi). */
  locked?: boolean;
  /** Documents de synchronisation (P5) : purgés puis vérifiés AVANT le reste. Absent = procédure sans synchronisation. */
  syncRecords?: { status: 'purged' | 'space_absent' | 'unproven' | 'incomplete' | 'not_started'; found: number; deleted: number; remaining: number | null };
  /** Espaces partagés du compte (F4) : verrouillés, vidés, vérifiés puis supprimés AVANT tout le reste. Absent = procédure sans espaces partagés. */
  modules?: { status: 'none' | 'purged' | 'incomplete' | 'unproven'; modules: number; deleted: number; docsDeleted: number; pending: number };
  /** Marqueur « compte supprimé » (protection contre la recréation de données avec un ancien jeton) : posé maintenant, déjà présent (reprise), ou impossible à poser (rien n'a alors été supprimé). Absent = procédure sans marqueur. */
  tombstone?: 'created' | 'exists' | 'failed';
}

export type DeletionStatus =
  | 'reauth_required' // identité non confirmée : RIEN n'a été supprimé
  | 'ownership_unproven' // la propriété de l'espace n'est pas démontrée : RIEN n'a été supprimé
  | 'cloud_incomplete' // suppression cloud incomplète : le compte est conservé, la reprise est possible
  | 'cloud_uncertain' // le serveur n'a pas répondu à temps : l'opération a peut-être été appliquée ; la reprise relit le serveur
  | 'cloud_deleted_account_active' // données cloud supprimées et vérifiées, compte Firebase encore actif
  | 'account_uncertain' // données cloud supprimées et vérifiées ; suppression du compte non confirmée (délai dépassé)
  | 'completed'; // données cloud supprimées et vérifiées, compte Firebase supprimé (confirmé)

export interface DeletionOutcome {
  status: DeletionStatus;
  message: string;
  report: CloudDeletionReport | null;
  /** Enregistrements locaux dont le marquage cloud a été retiré (les données elles-mêmes sont conservées) ; 0 si non fait. */
  localReleased: number;
  authDeleted: boolean;
}

export interface AccountDeletionApi {
  reauthenticate(password: string): Promise<void>;
  deleteCloudData(uid: string): Promise<CloudDeletionReport>;
  deleteAuthAccount(): Promise<void>;
}

/** Délais maximaux (ms) des étapes sans lecture serveur propre : un délai dépassé n'est jamais un succès. */
export interface DeletionTimeouts {
  reauthMs: number;
  cloudMs: number;
  authMs: number;
}
export const DEFAULT_TIMEOUTS: DeletionTimeouts = { reauthMs: 20_000, cloudMs: 10 * 60 * 1000, authMs: 20_000 };

/** Une étape n'a pas répondu à temps (promesse abandonnée, non annulée). */
export class OperationTimeout extends Error {
  readonly code = 'client-timeout';
  constructor(readonly label: string, readonly ms: number) {
    super('délai dépassé (' + label + ', ' + Math.round(ms / 1000) + ' s)');
    this.name = 'OperationTimeout';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  promise.catch(() => undefined); // résultat tardif d'une opération abandonnée : pas d'erreur non gérée
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeout(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface LocalCleanup {
  /** Rend visibles comme données locales celles que ce compte marquait, et oublie l'état de synchronisation du compte. */
  release(uid: string): Promise<{ released: number }>;
}

const KEPT_LOCAL = 'Vos données locales restent sur cet appareil.';

function describeReport(r: CloudDeletionReport): string {
  const parts = [`${r.records.deleted} enregistrement(s) supprimé(s) et confirmé(s) sur ${r.records.found} trouvé(s)`];
  if (r.syncRecords && r.syncRecords.status !== 'space_absent') {
    parts.push(`${r.syncRecords.deleted} document(s) de synchronisation supprimé(s)`);
    if (r.syncRecords.status !== 'purged') parts.push(r.syncRecords.remaining ? `${r.syncRecords.remaining} document(s) de synchronisation restent dans le cloud` : 'purge des documents de synchronisation non confirmée');
  }
  if (r.records.remaining !== null && r.records.remaining > 0) parts.push(`${r.records.remaining} restent dans le cloud`);
  if (r.records.remaining === null) parts.push('l’état des enregistrements n’est pas confirmé');
  if (r.space === 'failed') parts.push('espace personnel non supprimé');
  if (r.space === 'unknown') parts.push('suppression de l’espace non confirmée');
  if (r.profile === 'failed') parts.push('profil non supprimé');
  if (r.profile === 'unknown') parts.push('suppression du profil non confirmée');
  return parts.join(' ; ');
}

/** Journal local de la suppression (persistant) : lui seul permet de retrouver le parcours de reprise après un redémarrage. */
export interface DeletionJournal {
  /** Appelé juste AVANT la première opération cloud (après réauthentification réussie). */
  started(uid: string): Promise<void>;
  /** Appelé avec le résultat final de la tentative. */
  finished(uid: string, outcome: DeletionOutcome): Promise<void>;
}

/** Le journal est une aide : son échec ne doit jamais bloquer ni modifier la suppression. */
const safely = async (task: Promise<void> | undefined): Promise<void> => {
  try {
    await task;
  } catch {
    // sans incidence sur la suppression
  }
};

export async function deleteAccount(
  api: AccountDeletionApi,
  uid: string,
  password: string,
  local: LocalCleanup,
  timeouts: DeletionTimeouts = DEFAULT_TIMEOUTS,
  journal?: DeletionJournal,
): Promise<DeletionOutcome> {
  let started = false;
  const outcome = await runDeletion(api, uid, password, local, timeouts, async () => {
    started = true;
    await safely(journal?.started(uid));
  });
  if (started) await safely(journal?.finished(uid, outcome));
  return outcome;
}

/** Verrou confirmé ET espace pas (encore) supprimé : sinon le verrou n'existe plus et ne doit pas être annoncé. */
const stillLocked = (r: CloudDeletionReport | null): boolean => !!r?.locked && r.space !== 'deleted' && r.space !== 'absent';

const LOCK_NOTE =
  ' Votre espace cloud est verrouillé pour suppression (confirmé par le serveur) : les nouvelles modifications ne se synchronisent plus tant que la suppression n’est pas terminée. Appuyez sur « Réessayer » ; votre mot de passe sera redemandé (réauthentification).';

async function runDeletion(
  api: AccountDeletionApi,
  uid: string,
  password: string,
  local: LocalCleanup,
  timeouts: DeletionTimeouts,
  onCloudStart: () => Promise<void>,
): Promise<DeletionOutcome> {
  const empty = (status: DeletionStatus, message: string, report: CloudDeletionReport | null = null): DeletionOutcome => ({ status, message, report, localReleased: 0, authDeleted: false });

  // 1. Réauthentification : aucune opération destructive avant.
  if (!password) return empty('reauth_required', 'Réauthentification nécessaire : saisissez votre mot de passe. Rien n’a été supprimé.');
  try {
    await withTimeout(api.reauthenticate(password), timeouts.reauthMs, 'réauthentification');
  } catch (error) {
    if (error instanceof OperationTimeout) return empty('reauth_required', 'Réauthentification nécessaire : le serveur n’a pas répondu à temps (connexion Internet ?). Rien n’a été supprimé.');
    const code = authErrorCode(error);
    const why = code === 'auth/requires-recent-login' ? 'Reconnectez-vous puis réessayez.' : mapAuthError(error);
    return empty('reauth_required', `Réauthentification nécessaire. ${why} Rien n’a été supprimé.`);
  }

  // 2. Données cloud (avec relecture de vérification).
  await onCloudStart();
  let report: CloudDeletionReport;
  const uncertain = (detail: string, rep: CloudDeletionReport | null) =>
    empty(
      'cloud_uncertain',
      `Suppression cloud incertaine : le serveur n’a pas répondu à temps${detail}. L’opération a peut-être été appliquée. Votre compte et vos données locales sont conservés. Vérifiez votre connexion puis appuyez sur « Réessayer » : la reprise relit d’abord le serveur avant d’agir.${stillLocked(rep) ? LOCK_NOTE : ''}`,
      rep,
    );
  try {
    report = await withTimeout(api.deleteCloudData(uid), timeouts.cloudMs, 'suppression cloud');
  } catch (error) {
    if (error instanceof OperationTimeout) return uncertain('', null);
    return empty('cloud_incomplete', `Suppression cloud incomplète : ${error instanceof Error ? error.message : 'erreur inconnue'}. Le compte est conservé ; vous pouvez réessayer.`);
  }
  if (report.ownership === 'unproven') {
    return empty('ownership_unproven', 'Suppression refusée : l’espace cloud ne peut pas être démontré comme le vôtre. Rien n’a été supprimé.', report);
  }
  if (report.uncertain) return uncertain(` (${describeReport(report)})`, report);
  if (!report.verified) {
    const cause = report.error ? ` (${report.error.message})` : '';
    return empty('cloud_incomplete', `Suppression cloud incomplète : ${describeReport(report)}${cause}. Votre compte est conservé et vos données locales aussi ; vous pouvez réessayer.${stillLocked(report) ? LOCK_NOTE : ''}`, report);
  }

  // 3. Données cloud supprimées ET vérifiées : l'état de synchronisation n'a plus de sens ; les données locales sont conservées.
  let released = 0;
  let localNote = KEPT_LOCAL;
  try {
    released = (await local.release(uid)).released;
  } catch {
    localNote = `${KEPT_LOCAL} Le retrait du marquage cloud a échoué : vos données peuvent rester masquées (réglage « données d'un autre compte »).`;
  }

  // 4. Compte Firebase : annoncé seulement après confirmation.
  try {
    await withTimeout(api.deleteAuthAccount(), timeouts.authMs, 'suppression du compte');
  } catch (error) {
    if (error instanceof OperationTimeout) {
      return {
        status: 'account_uncertain',
        message: `Données cloud supprimées ; la suppression du compte n’a pas été confirmée (le serveur n’a pas répondu à temps). Elle a peut-être été appliquée : vérifiez en vous reconnectant ou appuyez sur « Réessayer ». ${localNote}`,
        report,
        localReleased: released,
        authDeleted: false,
      };
    }
    const why = authErrorCode(error) === 'auth/requires-recent-login' ? 'Reconnectez-vous puis réessayez.' : mapAuthError(error);
    return { status: 'cloud_deleted_account_active', message: `Données cloud supprimées, compte encore actif. ${why} ${localNote}`, report, localReleased: released, authDeleted: false };
  }
  return {
    status: 'completed',
    message: `Compte supprimé : ${report.records.deleted} enregistrement(s) cloud supprimé(s). ${localNote} Les autres appareils conservent leurs données locales.`,
    report,
    localReleased: released,
    authDeleted: true,
  };
}
