// État de vérification de l'adresse e-mail du compte actif — F1. État en mémoire, sans SDK ni réseau : le store de compte l'alimente à chaque changement de
// session ou après une actualisation ; les services (activation de la synchronisation) l'interrogent. REFUS PAR DÉFAUT : sans information, le compte n'est pas
// considéré comme vérifié.

let verifiedUid: string | null = null;

/** `uid` null = plus de session. Seul le compte indiqué est marqué comme vérifié. */
export function setEmailVerified(uid: string | null, verified: boolean): void {
  verifiedUid = uid !== null && verified ? uid : null;
}

export const isEmailVerified = (uid: string): boolean => verifiedUid !== null && verifiedUid === uid;
