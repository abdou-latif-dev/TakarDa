// Composition de PRODUCTION du cycle de synchronisation (phase 6, étape 7) : relie le runtime aux transports Firestore, à l'état de l'application
// et au store d'affichage. PRÉPARÉE, NON APPELÉE : aucun écran, store ni service de l'application n'importe ce module ; l'appeler est un acte
// délibéré de la validation finale (avec l'ouverture du drapeau). Le drapeau fermé suffit d'ailleurs à empêcher tout démarrage.

import { AppState } from 'react-native';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { useSyncEngineStore } from '@/store/syncEngineStore';
import { loadSyncState } from '../cloudSyncService';
import { createFirestoreSyncBackend } from './firestoreSyncBackend';
import { createFirestoreSyncTransport } from './firestoreSyncTransport';
import { getFirestoreDb } from './firebaseClient';
import { startSyncRuntime, type SyncRuntime } from '../sync/syncRuntime';
import { subscribeDataChanges } from '../persistence';

let current: SyncRuntime | null = null;
let unsubscribeDataChanges: (() => void) | null = null;
let lastDrain: Promise<void> = Promise.resolve();

/**
 * Démarre le cycle pour le compte authentifié ; sans effet (null) si le drapeau est fermé ou sans compte. Un seul cycle à la fois.
 * Lit d'abord l'état V1 du compte (lecture locale) : si la V1 est active, le démarrage est refusé par `SyncModeError`.
 */
export async function bootSyncRuntime(authenticatedUid: () => string | null): Promise<SyncRuntime | null> {
  if (current && current.uid === authenticatedUid()) return current;
  shutdownSyncRuntime(); // autre compte ou ancien cycle : arrêt complet avant de repartir
  await lastDrain; // l'ancien cycle a terminé son exécution en cours (et rendu sa réservation) avant tout nouveau démarrage
  const uid = CLOUD_ACCOUNT_ENABLED ? authenticatedUid() : null;
  if (uid) await loadSyncState(uid); // renseigne l'exclusion V1 / nouveau moteur (lecture seule)
  if (uid && authenticatedUid() !== uid) return null; // le compte a changé pendant la lecture : rien ne démarre pour l'ancien compte
  const store = useSyncEngineStore.getState();
  const runtime = startSyncRuntime({
    enabled: () => CLOUD_ACCOUNT_ENABLED,
    // le runtime est LIÉ à ce compte : dès que le compte authentifié change, il ne voit plus de compte et s'arrête (jamais le nouveau compte)
    uid: () => (uid && authenticatedUid() === uid ? uid : null),
    transports: (uid) => {
      const transport = createFirestoreSyncTransport({ backend: createFirestoreSyncBackend(getFirestoreDb(), uid), uid });
      return { push: transport, pull: transport };
    },
    subscribeForeground: (onChange) => {
      const subscription = AppState.addEventListener('change', (state) => onChange(state === 'active'));
      return () => subscription.remove();
    },
    onState: (state) => {
      const engine = useSyncEngineStore.getState();
      engine.setCycleStatus(state.status);
      void engine.refresh();
    },
  });
  if (!runtime) return null;
  current = runtime;
  // F2 : toute modification locale enregistrée déclenche la capture, puis l'envoi après l'accalmie (voir syncCycle.ts) ; plus rien à faire à la main
  unsubscribeDataChanges?.();
  unsubscribeDataChanges = subscribeDataChanges(() => runtime.notifyLocalChange());
  store.setActive(true);
  store.setSyncNowHandler(async () => {
    await runtime.syncNow();
  });
  return runtime;
}

/** Arrêt complet (déconnexion, drapeau refermé) : minuteurs et écouteurs retirés, affichage remis à l'état inactif. */
export function shutdownSyncRuntime(): void {
  const stopping = current;
  current = null;
  unsubscribeDataChanges?.(); // plus aucune notification vers un runtime arrêté
  unsubscribeDataChanges = null;
  stopping?.stop(); // plus aucun nouveau travail dès cet instant ; l'exécution en cours s'arrête à sa prochaine opération
  if (stopping) lastDrain = stopping.drain().catch(() => undefined);
  useSyncEngineStore.getState().reset();
}

/** Se résout quand le dernier runtime arrêté n'a plus aucune exécution en cours (suppression de compte, changement de compte). */
export const waitForSyncRuntimeIdle = (): Promise<void> => lastDrain;
