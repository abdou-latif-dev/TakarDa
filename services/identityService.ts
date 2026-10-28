// Identité de l'utilisateur courant — point d'accès unique pour les NOUVEAUX appels.
//
// V1 : TakarDa fonctionne sans compte. L'utilisateur est un profil local (`users`,
// persisté avec le reste des données par services/persistence.ts) dont l'id est
// 'u-me'. Plus tard, getCurrentUserId() renverra l'UID de l'authentification ; les
// données existantes appartiennent à 'u-me' et seront rattachées au compte à ce moment-là
// (migration à prévoir en V2, pas ici).
//
// Les services métier lisent encore `CURRENT_USER_ID` (db.ts) directement : ils ne sont
// volontairement pas touchés dans cette phase. Leur bascule vers getCurrentUserId() est
// mécanique (6 fichiers) et se fera quand l'identité pourra réellement différer.

import { CURRENT_USER_ID, defaultLocalUser, users } from './db';
import type { User } from '@/types/entities';

export function getCurrentUserId(): string {
  return CURRENT_USER_ID;
}

/** Le profil local de l'utilisateur courant ; le crée s'il manque (ancien stockage sans
 * `users`). À appeler après hydrateDb() : avant, la liste est encore vide et on créerait
 * un profil que l'hydratation écraserait. Ne modifie jamais un profil existant. */
export function ensureLocalUser(): User {
  const id = getCurrentUserId();
  let user = users.find((u) => u.id === id);
  if (!user) {
    user = { ...defaultLocalUser(), id };
    users.push(user);
  }
  return user;
}
