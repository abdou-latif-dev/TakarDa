// Firebase Authentication (e-mail / mot de passe). Avec firestoreRecordsApi.ts et firebaseClient.ts, l’un des seuls
// fichiers à importer le SDK. Aucune migration ni synchronisation n’est déclenchée ici : se connecter ne fait que
// s’identifier.

import { createUserWithEmailAndPassword, deleteUser, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { appErrorCode, authErrorCode, mapAuthError } from '../cloudAuthErrors';
import { getFirebaseAuth } from './firebaseClient';

export interface CloudUser {
  uid: string;
  email: string | null;
  /** Adresse e-mail confirmée par le lien reçu. Jamais supposée vraie : absente = non vérifiée. */
  emailVerified: boolean;
}

export class CloudAuthError extends Error {
  readonly code: string | null;
  constructor(error: unknown) {
    super(mapAuthError(error));
    this.name = 'CloudAuthError';
    this.code = authErrorCode(error) ?? appErrorCode(error);
    Object.setPrototypeOf(this, CloudAuthError.prototype);
  }
}

const toUser = (u: { uid: string; email: string | null; emailVerified?: boolean } | null): CloudUser | null => (u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified === true } : null);

/** Notifie l’état de connexion, y compris la session restaurée depuis l’appareil. Renvoie la fonction d’arrêt. */
export function watchCloudUser(callback: (user: CloudUser | null) => void, onError?: (error: unknown) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (u) => callback(toUser(u)), onError);
}

export async function signUpWithEmail(email: string, password: string): Promise<CloudUser> {
  try {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    return toUser(credential.user) as CloudUser;
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

export async function signInWithEmail(email: string, password: string): Promise<CloudUser> {
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    return toUser(credential.user) as CloudUser;
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

export async function signOutCloud(): Promise<void> {
  try {
    await signOut(getFirebaseAuth());
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

/** Réauthentification récente par mot de passe (avant toute suppression de compte). Le mot de passe n'est pas conservé. */
export async function reauthenticateWithPassword(password: string): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user || !user.email) throw new CloudAuthError({ code: 'app/no-session' });
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

/** Supprime le compte Firebase Authentication de la session courante. Ne résout qu'une fois la suppression confirmée. */
export async function deleteCurrentAccount(): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new CloudAuthError({ code: 'app/no-session' });
  try {
    await deleteUser(user);
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

/**
 * Envoie le lien de réinitialisation. Une adresse inconnue n'est PAS signalée (même réponse que pour un compte existant) : l'écran ne permet pas de savoir
 * si une adresse a un compte. Les autres erreurs (réseau, adresse invalide, quota) restent signalées.
 */
export async function sendResetEmail(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
  } catch (error) {
    if (authErrorCode(error) === 'auth/user-not-found') return;
    throw new CloudAuthError(error);
  }
}

/** Envoie (ou renvoie) l'e-mail de vérification de l'adresse du compte connecté. */
export async function sendVerificationEmail(): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new CloudAuthError({ code: 'app/no-session' });
  try {
    await sendEmailVerification(user);
  } catch (error) {
    throw new CloudAuthError(error);
  }
}

/**
 * Relit le compte auprès du serveur (l'adresse a-t-elle été vérifiée depuis ?) et renouvelle le jeton pour que ses informations à jour (dont la vérification de
 * l'adresse) soient celles que voient les règles de sécurité.
 */
export async function reloadCurrentUser(): Promise<CloudUser> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new CloudAuthError({ code: 'app/no-session' });
  try {
    await reload(user);
    await user.getIdToken(true);
    return toUser(user) as CloudUser;
  } catch (error) {
    throw new CloudAuthError(error);
  }
}
