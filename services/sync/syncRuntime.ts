// Démarrage du cycle de synchronisation réel — phase 6, étape 7. PRÉPARÉ, NON ACTIVÉ : aucun code de l'application n'appelle ce module
// (un test statique le vérifie). Il ne démarre que si TROIS conditions sont réunies — drapeau cloud ouvert, compte authentifié, et (au sein du
// cycle) synchronisation activée pour ce compte — et, sinon, ne crée ni minuteur, ni écouteur, ni transport.
//
// Tout ce qui touche la plate-forme est INJECTÉ (état de l'application, connectivité, minuterie, transports) : le module reste testable avec de
// faux événements et ne dépend d'aucune bibliothèque. Aucune dépendance n'est ajoutée : sans module de connectivité, la valeur par défaut
// de `isOnline` est « connecté » et un échec réseau est traité par la reprise différée du cycle (voir syncCycle.ts).

import type { ScanScope } from './changeScanner';
import { createSyncCycle, type CycleReason, type CycleReport, type SyncCycle, type SyncCycleDeps, type SyncCycleState } from './syncCycle';
import { setSyncAccount } from './syncAccount';
import { getActivation } from './syncActivation';
import { claimEngine } from '../syncMode';

export interface SyncRuntimeDeps {
  /** Drapeau d'ouverture des comptes cloud (constants/features.ts). */
  enabled: () => boolean;
  /** Identifiant du compte AUTHENTIFIÉ, ou null. */
  uid: () => string | null;
  transports: SyncCycleDeps['transports'];
  isOnline?: () => boolean;
  /** Retour du réseau : `true` quand la connexion revient. Renvoie la fonction de désabonnement. */
  subscribeNetwork?: (onChange: (online: boolean) => void) => () => void;
  /** Passage au premier plan : `true` quand l'application devient active. Renvoie la fonction de désabonnement. */
  subscribeForeground?: (onChange: (active: boolean) => void) => () => void;
  schedule?: SyncCycleDeps['schedule'];
  now?: () => Date;
  limits?: SyncCycleDeps['limits'];
  random?: () => number;
  /** Reçoit chaque changement d'état du cycle (affichage). */
  onState?: (state: SyncCycleState) => void;
}

export interface SyncRuntime {
  readonly uid: string;
  /** Un changement local vient d'avoir lieu (capture immédiate, envoi après l'accalmie). */
  notifyLocalChange(): void;
  /** Demande immédiate (bouton « Synchroniser maintenant »). */
  syncNow(): Promise<CycleReport>;
  trigger(reason: CycleReason): Promise<CycleReport>;
  state(): SyncCycleState;
  /** Arrête tout : minuteurs, écouteurs ; le compte de synchronisation est conservé (c'est celui de l'authentification). L'exécution en cours s'arrête à sa prochaine opération. */
  stop(): void;
  /** Se résout quand l'exécution éventuellement en cours est terminée (à appeler après `stop()` avant une suppression de compte). */
  drain(): Promise<void>;
}

// Instant « jamais » : tant que l'activation n'est pas connue, la capture automatique ne propose rien.
const NEVER = '9999-12-31T23:59:59.999Z';

/**
 * Démarre le cycle pour le compte authentifié. Retourne null — sans rien créer — si le drapeau est fermé ou si aucun compte n'est connecté.
 * Lève `SyncModeError` si la synchronisation V1 est active (ou en cours, ou inconnue) : jamais deux flux sur les mêmes données.
 * Un second appel pour le même compte est refusé par l'appelant (un seul runtime à la fois) : voir `startSyncRuntime` dans l'application.
 */
export function startSyncRuntime(deps: SyncRuntimeDeps): SyncRuntime | null {
  if (!deps.enabled()) return null;
  const uid = deps.uid();
  if (!uid) return null;

  // ---- Ressources, enregistrées DÈS leur acquisition ---------------------------------------------------------------------------------
  const releaseMode = onceOnly(claimEngine(uid)); // réservation du moteur (exclusion avec la V1) : lève SyncModeError avant toute autre ressource
  const unsubscribers: (() => void)[] = [];
  let created: SyncCycle | null = null;
  let stopped = false;

  /** Nettoyage de TOUTES les ressources acquises ; chaque étape est indépendante (une erreur n'empêche pas les suivantes). Retourne les erreurs rencontrées. */
  const cleanup = (): unknown[] => {
    const errors: unknown[] = [];
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      created?.stop();
    } catch (error) {
      errors.push(error);
    }
    return errors;
  };

  try {
    setSyncAccount(uid);
    let scope: ScanScope = { enabledAt: NEVER };
    const refreshScope = async (): Promise<void> => {
      try {
        const activation = await getActivation();
        scope = activation.enabledAt ? { enabledAt: activation.enabledAt, adoptedIds: new Set(activation.adoptedIds) } : { enabledAt: NEVER };
      } catch {
        scope = { enabledAt: NEVER }; // activation illisible : on ne capture rien plutôt que de capturer à tort
      }
    };

    const cycle: SyncCycle = createSyncCycle({
      account: () => (!stopped && deps.enabled() ? deps.uid() : null), // le drapeau refermé ou l'arrêt coupent le cycle, même sans autre signal
      transports: deps.transports,
      isOnline: deps.isOnline ?? (() => true),
      scope: () => scope,
      schedule: deps.schedule,
      now: deps.now,
      limits: deps.limits,
      random: deps.random,
      onState: deps.onState,
    });
    created = cycle;

    const trigger = async (reason: CycleReason): Promise<CycleReport> => {
      if (stopped) return cycle.trigger(reason); // le cycle arrêté répond « stopped » : aucun travail
      await refreshScope();
      if (stopped) return cycle.trigger(reason); // arrêt demandé pendant la lecture de l'activation
      return cycle.trigger(reason);
    };

    cycle.start();
    // chaque écouteur est enregistré aussitôt abonné : si le suivant échoue, il est retiré avec les autres
    const network = deps.subscribeNetwork?.((online) => {
      if (online) void trigger('network_back');
    });
    if (typeof network === 'function') unsubscribers.push(network);
    const foreground = deps.subscribeForeground?.((active) => {
      if (active) void trigger('foreground');
    });
    if (typeof foreground === 'function') unsubscribers.push(foreground);
    void trigger('start');

    // Arrêt : UNE seule promesse de terminaison, partagée par tous les appels à stop() et drain().
    // Elle se résout quand l'exécution engagée est réellement terminée ET les ressources nettoyées ; la réservation n'est rendue qu'À CE MOMENT.
    // Une opération réseau déjà engagée n'est pas annulable : on attend sa fin ; `shouldStop` empêche toute opération suivante.
    let termination: Promise<void> | null = null;
    const terminate = (): Promise<void> => {
      if (termination) return termination;
      stopped = true; // plus aucun nouveau travail, dès cet instant
      cleanup(); // écouteurs retirés, cycle arrêté (minuteurs annulés, `shouldStop` vrai pour l'exécution en cours)
      termination = cycle
        .whenIdle()
        .then(
          () => undefined,
          () => undefined,
        )
        .then(releaseMode); // réservation rendue exactement une fois, après la fin du travail
      return termination;
    };

    return {
      uid,
      notifyLocalChange: () => {
        if (!stopped) void trigger('local_change');
      },
      syncNow: () => trigger('manual'),
      trigger,
      state: () => cycle.state(),
      stop: () => {
        void terminate();
      },
      drain: () => (termination ?? cycle.whenIdle()),
    };
  } catch (error) {
    // Démarrage partiel : tout ce qui a été acquis est nettoyé, la réservation est rendue ; l'erreur INITIALE est celle qui remonte.
    stopped = true;
    try {
      cleanup();
    } catch {
      // le nettoyage ne masque jamais l'erreur d'origine
    }
    try {
      releaseMode();
    } catch {
      // idem
    }
    throw error;
  }
}

/** Fonction appelée au plus une fois, quelles que soient les relances (libération de réservation). */
function onceOnly(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}
