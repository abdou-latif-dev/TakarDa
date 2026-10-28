// Reprise d'une suppression de compte interrompue : journal LOCAL persistant + messages prudents. Sans SDK (testable).
//
// Pourquoi un journal local : l'état du verrou de suppression est sur le serveur, mais il faut un moyen de retrouver le parcours
// de reprise après la fermeture de l'application SANS réseau et sans dépendre d'un état React. Le journal dit seulement
// « une suppression a été commencée sur cet appareil et n'est pas confirmée terminée » : ce n'est PAS une preuve de l'état du
// serveur, et les messages le disent (« peut être verrouillé »). Seule une lecture serveur (`readDeletionLockState`) établit le verrou.
//
// Règles :
//  - jamais d'état de verrouillage déduit d'une erreur (`permission-denied` compris) ;
//  - jamais de « suppression terminée » sans la fin vérifiée (le journal n'est effacé que pour le statut `completed`) ;
//  - les données locales ne sont pas concernées : ce module n'y touche pas.

import type { DeletionJournal, DeletionOutcome, DeletionStatus } from './accountDeletionService';
import { storage } from './storage';

/** Résultat d'une lecture serveur du verrou (voir firestoreAccountDeletion.readDeletionLockState). */
export type LockProbe = 'locked' | 'unlocked' | 'absent' | 'unknown';

export interface DeletionMarker {
  uid: string;
  startedAt: string;
  lastAttemptAt: string;
  /** « started » : commencée, résultat inconnu (processus interrompu ?) ; « observed_locked » : verrou vu par la synchronisation. */
  lastStatus: 'started' | 'observed_locked' | DeletionStatus;
  /** Verrou CONFIRMÉ par une lecture serveur lors de la dernière observation (jamais une supposition). */
  lockConfirmed: boolean;
}

const markerKey = (uid: string) => `cloud_deletion_${uid}`;

export async function loadDeletionMarker(uid: string): Promise<DeletionMarker | null> {
  try {
    const marker = await storage.get<DeletionMarker>(markerKey(uid));
    return marker && marker.uid === uid && typeof marker.startedAt === 'string' ? marker : null;
  } catch {
    return null; // stockage illisible : pas de journal (la suppression reste disponible depuis l'écran du compte)
  }
}

async function save(marker: DeletionMarker): Promise<void> {
  await storage.set(markerKey(marker.uid), marker);
}

export const clearDeletionMarker = (uid: string): Promise<void> => storage.remove(markerKey(uid));

/** La synchronisation a vu le verrou sur le serveur (lecture concluante) : on s'en souvient pour la reprise. */
export async function noteLockObserved(uid: string, now: Date = new Date()): Promise<DeletionMarker> {
  const previous = await loadDeletionMarker(uid);
  const at = now.toISOString();
  const marker: DeletionMarker = {
    uid,
    startedAt: previous?.startedAt ?? at,
    lastAttemptAt: previous?.lastAttemptAt ?? at,
    lastStatus: previous?.lastStatus ?? 'observed_locked',
    lockConfirmed: true,
  };
  await save(marker);
  return marker;
}

export const deletionJournal: DeletionJournal = {
  async started(uid) {
    const previous = await loadDeletionMarker(uid);
    const at = new Date().toISOString();
    await save({ uid, startedAt: previous?.startedAt ?? at, lastAttemptAt: at, lastStatus: 'started', lockConfirmed: previous?.lockConfirmed ?? false });
  },
  async finished(uid, outcome: DeletionOutcome) {
    const previous = await loadDeletionMarker(uid);
    const lockStillThere = !!outcome.report?.locked && outcome.report.space !== 'deleted' && outcome.report.space !== 'absent';
    if (outcome.status === 'completed') return clearDeletionMarker(uid); // fin vérifiée : plus rien à reprendre
    // Rien n'a été supprimé et aucun verrou n'a été vu : il n'y a pas de suppression à reprendre.
    if (outcome.status === 'ownership_unproven' && !lockStillThere && !previous?.lockConfirmed) return clearDeletionMarker(uid);
    const at = new Date().toISOString();
    await save({
      uid,
      startedAt: previous?.startedAt ?? at,
      lastAttemptAt: at,
      lastStatus: outcome.status,
      lockConfirmed: lockStillThere || (outcome.report?.locked === undefined && !!previous?.lockConfirmed && outcome.status !== 'cloud_deleted_account_active' && outcome.status !== 'account_uncertain'),
    });
  },
};

// ---- Messages --------------------------------------------------------------------------------------------------------------

const KEPT_LOCAL = 'Vos données locales sont conservées sur cet appareil.';
const RESUME = 'Pour la reprendre, appuyez sur « Reprendre la suppression » : votre mot de passe sera redemandé (réauthentification).';

/** Carte de reprise affichée tant qu'un journal existe (y compris après un redémarrage de l'application). */
export function describeRecovery(marker: DeletionMarker): { title: string; message: string } {
  const title = 'Suppression du compte inachevée';
  if (marker.lastStatus === 'cloud_deleted_account_active') {
    return {
      title,
      message: `Une suppression de compte a été commencée sur cet appareil : vos données cloud avaient été supprimées et vérifiées, mais votre compte est encore actif. ${RESUME} ${KEPT_LOCAL}`,
    };
  }
  if (marker.lastStatus === 'account_uncertain') {
    return {
      title,
      message: `Une suppression de compte a été commencée sur cet appareil : vos données cloud avaient été supprimées et vérifiées, mais la suppression du compte n’a pas été confirmée. ${RESUME} ${KEPT_LOCAL}`,
    };
  }
  const lock = marker.lockConfirmed
    ? 'Le serveur a confirmé que votre espace cloud est verrouillé pour suppression : les nouvelles modifications ne se synchronisent plus tant que la suppression n’est pas terminée.'
    : 'Votre espace cloud peut être verrouillé pour suppression ; l’application ne le sait qu’en le vérifiant auprès du serveur (connexion nécessaire).';
  return { title, message: `Une suppression de compte a été commencée sur cet appareil et n’est pas confirmée comme terminée. ${lock} ${RESUME} ${KEPT_LOCAL}` };
}

/**
 * Message de synchronisation quand une écriture a été REFUSÉE (permission-denied). Le refus seul ne dit rien du verrou :
 * le message dépend de la lecture serveur (`probe`). Retourne un texte prudent et actionnable dans tous les cas.
 */
export function describeSyncRefusal(probe: LockProbe): string {
  switch (probe) {
    case 'locked':
      return `Synchronisation suspendue : votre espace cloud est verrouillé pour suppression (confirmé par le serveur). Une suppression de compte a été commencée et n’est pas terminée. Pour la reprendre, utilisez « Reprendre la suppression » ci-dessous ; votre mot de passe sera redemandé. ${KEPT_LOCAL}`;
    case 'unlocked':
      return `Accès refusé par le serveur pour ces enregistrements. Le serveur n’indique aucune suppression de compte en cours (espace non verrouillé). Réessayez plus tard. ${KEPT_LOCAL}`;
    case 'absent':
      return `Accès refusé : votre espace cloud est introuvable sur le serveur. Réessayez plus tard ; rien n’est supprimé sur cet appareil. ${KEPT_LOCAL}`;
    default:
      return `Accès refusé par le serveur. L’état de votre espace n’a pas pu être vérifié (connexion ?). Réessayez plus tard ; si vous avez commencé une suppression de compte, vous pouvez la reprendre avec « Supprimer mon compte » (mot de passe demandé). ${KEPT_LOCAL}`;
  }
}
