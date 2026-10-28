// Client Firebase (SDK JavaScript) — Authentication et Cloud Firestore, PRÉPARÉS mais non branchés.
//
// Ce module est le SEUL endroit autorisé à importer le SDK Firebase. Il ne s'exécute pas au démarrage : rien ne
// l'importe encore, donc aucun compte n'est exigé, aucune synchronisation n'a lieu et aucune donnée locale n'est
// lue ni migrée (voir docs/persistance-et-firebase.md). Les getters initialisent Firebase à la demande, une seule fois.
//
// Configuration : constants/firebaseWebConfig.ts (identifiants PUBLICS de l'application Web du projet `takarda-c8cd8` ;
// la sécurité des données repose sur les règles Firestore et Authentication, côté serveur). Elle est vérifiée avant
// toute initialisation de Firebase.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { BUILD_TARGET } from '@/constants/buildTarget';
import { assertFirebaseWebConfig, firebaseWebConfig } from '@/constants/firebaseWebConfig';
import { assertFirebaseEnvironment } from './firebaseEnvironment';

// `getReactNativePersistence` n'existe que dans la version React Native du SDK (condition « react-native » de Metro) ;
// les types TypeScript par défaut ne l'exposent pas, d'où ce typage local.
const { getReactNativePersistence } = FirebaseAuth as unknown as { getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence };

let authInstance: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  const config = assertFirebaseWebConfig(firebaseWebConfig);
  // la cible déclarée au build décide : « test » ne parle qu'au projet de test, « production » qu'à la production ; une version de développement ne parle qu'au projet de test
  // (voir firebaseEnvironment.ts et constants/buildTarget.ts)
  assertFirebaseEnvironment(config.projectId, { isDev: __DEV__, allowProductionInDev: process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV === 'true', buildTarget: BUILD_TARGET });
  return initializeApp(config);
}

/** Authentication, avec la session conservée sur l'appareil (AsyncStorage). */
export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  try {
    authInstance = FirebaseAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Déjà initialisé (rechargement à chaud) : on reprend l'instance existante.
    authInstance = FirebaseAuth.getAuth(app);
  }
  return authInstance;
}

/** Cloud Firestore. Aucune lecture ni écriture n'est faite ici ; les règles de sécurité sont à définir dans la console. */
export function getFirestoreDb(): Firestore {
  return getFirestore(getFirebaseApp());
}
