// Composition de PRODUCTION des modules partagés (F3b) : relie le port aux instances Firestore de l'application. Chargée À LA DEMANDE par
// services/sharedModulesService.ts, uniquement drapeau ouvert ; jamais importée statiquement, rien ne démarre à l'import.

import { ModulesError, type ModulesBackend } from '../sharedModules/modulesPort';
import { getFirebaseAuth, getFirestoreDb } from './firebaseClient';
import { createFirestoreModuleErasureBackend, createFirestoreModulesBackend } from './firestoreModulesBackend';
import type { ModuleErasureBackend } from './moduleErasure';

/** Backend du compte CONNECTÉ : refuse si la session Firebase n'est pas celle du compte demandé (jamais d'accès au nom d'un autre compte). */
export function bootModulesBackend(uid: string): ModulesBackend {
  const current = getFirebaseAuth().currentUser;
  if (!current || current.uid !== uid) throw new ModulesError('permission', 'La session ne correspond pas au compte actif.');
  return createFirestoreModulesBackend(getFirestoreDb(), uid);
}

/** Port d'effacement d'un espace du compte CONNECTÉ (« supprimer cet espace ») : même garde de session. */
export function bootModuleErasureBackend(uid: string): ModuleErasureBackend {
  const current = getFirebaseAuth().currentUser;
  if (!current || current.uid !== uid) throw new ModulesError('permission', 'La session ne correspond pas au compte actif.');
  return createFirestoreModuleErasureBackend(getFirestoreDb(), uid);
}
