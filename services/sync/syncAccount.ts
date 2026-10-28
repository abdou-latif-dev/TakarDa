// Compte de synchronisation actif — P5. Isole, sur un même appareil, l'état de synchronisation de chaque compte.
//
// Tous les magasins du moteur (file, référence, conflits, suppressions reçues, changements en attente, curseur, corrections, métadonnées)
// sont rangés sous une clé PROPRE AU COMPTE : `<magasin>@<uid>` (précédée du préfixe de l'espace de travail). Un autre compte, ou l'absence
// de compte, ne lit donc jamais l'état d'un compte et ne peut ni l'envoyer ni le recevoir à sa place.
//
// Changement de compte PENDANT une exécution (déconnexion, autre compte) : il est DIFFÉRÉ jusqu'à la fin de l'exécution en cours (le
// verrou de synchronisation compte les exécutions) ; l'exécution s'arrête proprement à la prochaine étape (`accountChangePending`).
// Ainsi aucune écriture d'une exécution ne tombe jamais dans le magasin d'un autre compte.
//
// Module pur : aucun SDK, aucun réseau. Le store du compte l'appelle à chaque changement de compte (voir store/cloudStore.ts) ; rien ne
// déclenche de synchronisation.

export type SyncAccountErrorCode = 'no_account' | 'account_mismatch' | 'invalid_account';

export class SyncAccountError extends Error {
  constructor(readonly code: SyncAccountErrorCode, message: string) {
    super(message);
    this.name = 'SyncAccountError';
  }
}

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

let current: string | null = null;
let pending: { uid: string | null } | null = null;
let runs = 0;

export const getSyncAccount = (): string | null => current;

/** Un changement de compte attend la fin de l'exécution en cours : l'exécution doit s'arrêter dès que possible. */
export const accountChangePending = (): boolean => pending !== null;

/**
 * Définit le compte de synchronisation (null = aucun). Retourne « applied » ou « deferred » (une exécution est en cours : le changement
 * s'applique à sa fin). Un uid inhabituel est refusé : il servirait de clé de stockage.
 */
export function setSyncAccount(uid: string | null): 'applied' | 'deferred' {
  if (uid !== null && !UID_PATTERN.test(uid)) throw new SyncAccountError('invalid_account', 'Identifiant de compte inutilisable comme clé de stockage.');
  if (runs > 0) {
    if (uid === current) {
      pending = null; // retour au compte en cours : plus rien à changer
      return 'applied';
    }
    pending = { uid };
    return 'deferred';
  }
  current = uid;
  pending = null;
  return 'applied';
}

/** Appelés par le verrou de synchronisation (une exécution = un verrou tenu). */
export function beginEngineRun(): void {
  runs += 1;
}
export function endEngineRun(): void {
  runs = Math.max(0, runs - 1);
  if (runs === 0 && pending) {
    current = pending.uid;
    pending = null;
  }
}

/** Compte actif, obligatoire ; `expected` (compte annoncé par l'appelant) doit être EXACTEMENT le compte actif. */
export function requireSyncAccount(expected?: string): string {
  if (!current) throw new SyncAccountError('no_account', 'Aucun compte de synchronisation actif : rien n’est capturé, envoyé ni reçu.');
  if (expected !== undefined && expected !== current) throw new SyncAccountError('account_mismatch', 'Le compte demandé n’est pas le compte de synchronisation actif : rien n’est capturé, envoyé ni reçu.');
  return current;
}

/** Clé d'un magasin propre au compte actif. Sans compte : erreur (jamais de repli sur une clé commune). */
export function accountScopedKey(base: string): string {
  if (!current) throw new SyncAccountError('no_account', 'Aucun compte de synchronisation actif.');
  return `${base}@${current}`;
}

/** Variante tolérante pour les métadonnées locales de la fondation (P1) : sans compte, la clé historique est conservée. */
export const accountKeyIfAny = (base: string): string => (current ? `${base}@${current}` : base);

/** Clé du magasin d'un compte précis (nettoyage à la suppression du compte). */
export const accountKeyFor = (base: string, uid: string): string => {
  if (!UID_PATTERN.test(uid)) throw new SyncAccountError('invalid_account', 'Identifiant de compte inutilisable comme clé de stockage.');
  return `${base}@${uid}`;
};
