// Marqueur « compte en cours de suppression ou supprimé » — protection contre la recréation de données avec un ancien jeton. Module sans SDK.
//
// Problème (constaté sur le projet de test réel, test A6) : à la suppression d'un compte, Authentication ne révoque pas les jetons déjà émis.
// Un autre appareil du même compte garde donc, jusqu'à l'expiration de son jeton (au plus une heure), le droit d'écrire sous l'ancien identifiant :
// il peut RECRÉER profil, espace personnel, enregistrements, documents de synchronisation ou espaces partagés derrière une suppression pourtant vérifiée.
// Les règles ne peuvent pas savoir qu'un compte n'existe plus ; elles savent en revanche lire un document.
//
// Protection : au début de la suppression, le compte pose LUI-MÊME un marqueur `deletedAccounts/<uid>` (heure du serveur, rien d'autre). Les règles refusent
// toute création et toute modification de données dès que ce marqueur existe (voir `accountLive()` dans firestore.p5.rules). Le marqueur n'est jamais
// modifié ni supprimé par un client : un ancien jeton ne peut pas le retirer. La suppression et le verrou d'effacement restent permis (la procédure va à son terme).
//
// Conséquence assumée : poser le marqueur est IRRÉVERSIBLE, comme le verrou d'effacement. Une suppression interrompue se REPREND (le marqueur existe déjà : la reprise
// le constate et continue) ; elle ne s'annule pas.

export const TOMBSTONE_COLLECTION = 'deletedAccounts';

/** « created » : posé maintenant ; « exists » : déjà posé (reprise d'une suppression interrompue). */
export type TombstoneResult = 'created' | 'exists';

/** Port : réalisé avec le SDK dans firestoreAccountTombstone.ts, en mémoire dans les tests. */
export interface TombstoneBackend {
  /** Pose le marqueur du compte courant, ou constate qu'il existe déjà. Jamais de suppression : le marqueur est définitif. */
  mark(): Promise<TombstoneResult>;
}
