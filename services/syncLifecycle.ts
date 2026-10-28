// Cycle de vie du nouveau moteur de synchronisation — phase 7. Décide QUAND le runtime tourne, à partir de l'état d'authentification ; ne contient
// aucune logique de synchronisation. Entièrement derrière CLOUD_ACCOUNT_ENABLED (fermé) : `startSyncLifecycle` n'est appelé que si le drapeau est
// ouvert, et chaque décision revérifie le drapeau.
//
// Le runtime tourne seulement si TOUT est vrai : drapeau ouvert, espace PERSONNEL (jamais la démonstration), compte authentifié, aucune
// suppression de compte en cours, et le nouveau moteur CHOISI pour ce compte (marqueur persistant, voir syncMode.ts). Sinon il est arrêté.
//
// Courses asynchrones : les démarrages et arrêts sont SÉRIALISÉS ; avant tout `await`, un arrêt synchrone coupe le runtime qui ne correspond plus
// à l'état courant (ancien compte, déconnexion, suppression) ; après un démarrage asynchrone, l'état est revérifié et un runtime devenu obsolète
// est arrêté aussitôt. Le runtime est lié à son compte (voir firebase/syncRuntimeBoot.ts) : il ne travaille jamais pour un autre compte.
//
// Aucun import statique de Firebase : la composition de production est chargée à la demande, uniquement quand le drapeau est ouvert.

import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { setEngineStampUid } from './cloudVisibility';
import { workspaceId } from './persistence';
import { isEmailVerified } from './accountVerification';
import { AUTH_MESSAGES } from './cloudAuthErrors';
import { SyncModeError, clearEngineChosen, isEngineChosen, isV1KnownActive, markEngineChosen } from './syncMode';
import { loadSyncState } from './cloudSyncService';
import { activateSync } from './sync/syncActivation';
import { getSyncAccount } from './sync/syncAccount';

export interface LifecycleSnapshot {
  authStatus: string;
  uid: string | null;
  /** Change à chaque changement de compte (store de compte) : même identifiant, nouvelle époque = nouveau départ. */
  epoch: number;
  deleting: boolean;
}

export interface LifecycleDeps {
  enabled: () => boolean;
  personalWorkspace: () => boolean;
  engineChosen: (uid: string) => Promise<boolean>;
  /** Démarre le runtime pour le compte donné (lié à ce compte). */
  boot: (authenticatedUid: () => string | null) => Promise<unknown>;
  shutdown: () => void;
  /** Se résout quand plus aucune exécution du moteur n'est en cours (après un arrêt). Absent = rien à attendre. */
  idle?: () => Promise<void>;
}

export type LifecycleStatus =
  | { state: 'stopped'; reason: 'disabled' | 'demo' | 'signed_out' | 'deleting' | 'not_chosen' }
  | { state: 'running'; uid: string }
  | { state: 'refused'; code: string; message: string }
  | { state: 'error'; message: string };

export interface SyncLifecycle {
  /** Applique un nouvel état d'authentification : arrêt immédiat de ce qui ne correspond plus, puis démarrage éventuel (sérialisé). */
  apply(snapshot: LifecycleSnapshot): Promise<void>;
  /** Réévalue l'état courant (changement d'espace, choix du moteur…). */
  refresh(): Promise<void>;
  status(): LifecycleStatus;
  /** Se résout quand l'état voulu est atteint ET qu'aucune exécution du moteur n'est en cours : à attendre avant une suppression de compte. */
  quiesce(): Promise<void>;
  dispose(): void;
}

const keyOf = (uid: string, epoch: number) => `${uid}#${epoch}`;

export function createSyncLifecycle(deps: LifecycleDeps): SyncLifecycle {
  let latest: LifecycleSnapshot = { authStatus: 'unknown', uid: null, epoch: 0, deleting: false };
  let running: string | null = null; // clé (compte#époque) du runtime démarré ou en cours de démarrage
  let queue: Promise<void> = Promise.resolve();
  let status: LifecycleStatus = { state: 'stopped', reason: 'signed_out' };
  let disposed = false;

  /** Ce qui DOIT tourner d'après l'état courant : null si rien. */
  const wanted = (): { key: string; uid: string; epoch: number } | null => {
    if (disposed || !deps.enabled() || !deps.personalWorkspace() || latest.authStatus !== 'signedIn' || !latest.uid || latest.deleting) return null;
    return { key: keyOf(latest.uid, latest.epoch), uid: latest.uid, epoch: latest.epoch };
  };
  const whyStopped = (): LifecycleStatus => ({
    state: 'stopped',
    reason: !deps.enabled() || disposed ? 'disabled' : !deps.personalWorkspace() ? 'demo' : latest.deleting ? 'deleting' : 'signed_out',
  });
  const authenticatedUid = (uid: string, epoch: number) => (): string | null => (!disposed && deps.enabled() && latest.authStatus === 'signedIn' && latest.uid === uid && latest.epoch === epoch && !latest.deleting ? uid : null);

  /** Arrêt SYNCHRONE de tout runtime qui ne correspond plus à l'état voulu (aucun `await` avant : aucun travail de l'ancien compte ne se poursuit). */
  const stopStale = () => {
    const want = wanted();
    if (running !== null && running !== want?.key) {
      deps.shutdown();
      running = null;
      setEngineStampUid(null); // plus de compte en mode moteur : les créations ne sont plus marquées à son nom
      status = whyStopped();
    }
  };

  async function settle(): Promise<void> {
    for (let guard = 0; guard < 5; guard += 1) {
      stopStale();
      const want = wanted();
      if (!want) {
        if (running === null) status = whyStopped();
        return;
      }
      if (running === want.key) return;
      await deps.idle?.(); // l'ancien runtime a terminé son exécution en cours avant tout nouveau démarrage
      if (wanted()?.key !== want.key) continue;
      let chosen = false;
      try {
        chosen = await deps.engineChosen(want.uid);
      } catch {
        chosen = false;
      }
      if (wanted()?.key !== want.key) continue; // l'état a changé pendant la lecture : on recommence avec le nouvel état
      if (!chosen) {
        status = { state: 'stopped', reason: 'not_chosen' }; // le nouveau moteur n'a pas été choisi pour ce compte : rien ne démarre
        return;
      }
      running = want.key;
      setEngineStampUid(want.uid); // dès le choix constaté : les créations de ce compte sont marquées à son nom (invisibles pour les autres comptes)
      try {
        await deps.boot(authenticatedUid(want.uid, want.epoch));
        status = { state: 'running', uid: want.uid };
      } catch (error) {
        running = null;
        setEngineStampUid(null);
        deps.shutdown();
        status = error instanceof SyncModeError ? { state: 'refused', code: error.code, message: error.message } : { state: 'error', message: error instanceof Error ? error.message : 'Démarrage impossible.' };
        return;
      }
      if (wanted()?.key !== want.key) {
        // devenu obsolète pendant le démarrage (un arrêt synchrone a pu précéder la fin du démarrage) : on arrête CE runtime tout de suite.
        // Les démarrages étant sérialisés, il n'en existe pas d'autre à épargner.
        deps.shutdown();
        if (running === want.key) running = null;
        setEngineStampUid(null);
        status = whyStopped();
        continue;
      }
      return;
    }
  }

  const enqueue = (): Promise<void> => {
    stopStale(); // synchrone, avant la file : un ancien compte ne travaille plus dès cet instant
    queue = queue.then(settle, settle);
    return queue;
  };

  return {
    apply: (snapshot) => {
      latest = snapshot;
      return enqueue();
    },
    refresh: () => enqueue(),
    quiesce: async () => {
      await enqueue();
      await deps.idle?.();
    },
    status: () => status,
    dispose: () => {
      disposed = true;
      if (running !== null) {
        deps.shutdown();
        running = null;
      }
      setEngineStampUid(null);
      status = { state: 'stopped', reason: 'disabled' };
    },
  };
}

// ---- Composition de production ---------------------------------------------------------------------------------------------------
// Chargée à la demande : tant que le drapeau est fermé, rien de ceci n'est appelé et Firebase n'est jamais importé.

interface BootModule {
  bootSyncRuntime: (uid: () => string | null) => Promise<unknown>;
  shutdownSyncRuntime: () => void;
  waitForSyncRuntimeIdle: () => Promise<void>;
}
let bootModule: BootModule | null = null;
const loadBoot = (): BootModule => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  bootModule = bootModule ?? (require('./firebase/syncRuntimeBoot') as BootModule);
  return bootModule;
};

const productionDeps = (): LifecycleDeps => ({
  enabled: () => CLOUD_ACCOUNT_ENABLED,
  personalWorkspace: () => workspaceId() === 'personal',
  engineChosen: isEngineChosen,
  boot: (authenticatedUid) => loadBoot().bootSyncRuntime(authenticatedUid),
  shutdown: () => bootModule?.shutdownSyncRuntime(), // rien n'a été chargé : rien à arrêter
  idle: () => bootModule?.waitForSyncRuntimeIdle() ?? Promise.resolve(),
});

/** Source minimale d'état d'authentification (le store de compte) : évite d'importer le store depuis un service. */
export interface AuthSource {
  getState: () => { authStatus: string; user: { uid: string } | null; accountEpoch: number; deleting: boolean };
  subscribe: (listener: () => void) => () => void;
}

const snapshotOf = (source: AuthSource): LifecycleSnapshot => {
  const s = source.getState();
  return { authStatus: s.authStatus, uid: s.user?.uid ?? null, epoch: s.accountEpoch, deleting: s.deleting };
};

let current: { lifecycle: SyncLifecycle; source: AuthSource } | null = null;

/**
 * Démarre le pilotage du runtime. Sans effet si le drapeau est fermé (aucun abonnement, aucun chargement). Retourne la fonction d'arrêt complet
 * (démontage de l'application).
 */
export function startSyncLifecycle(source: AuthSource, deps: LifecycleDeps = productionDeps()): () => void {
  if (!deps.enabled()) return () => undefined;
  current?.lifecycle.dispose();
  const lifecycle = createSyncLifecycle(deps);
  current = { lifecycle, source };
  const unsubscribe = source.subscribe(() => void lifecycle.apply(snapshotOf(source)));
  void lifecycle.apply(snapshotOf(source));
  return () => {
    unsubscribe();
    lifecycle.dispose();
    if (current?.lifecycle === lifecycle) current = null;
  };
}

/** Réévalue l'état (changement d'espace, choix du moteur). Sans pilotage démarré : sans effet. */
export function refreshSyncLifecycle(): Promise<void> {
  return current ? current.lifecycle.apply(snapshotOf(current.source)) : Promise.resolve();
}

/**
 * Arrête le moteur et attend la fin de toute exécution en cours (au plus `timeoutMs`). À appeler AVANT une suppression de compte. Sans pilotage démarré
 * (drapeau fermé) : se résout aussitôt. Retourne false si l'attente a expiré (l'appelant décide ; rien n'est forcé).
 */
export async function quiesceSyncLifecycle(timeoutMs = 10000): Promise<boolean> {
  if (!current) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([current.lifecycle.quiesce().then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer); // aucun minuteur résiduel
  }
}

export const getSyncLifecycleStatus = (): LifecycleStatus | null => current?.lifecycle.status() ?? null;

// ---- Activation explicite du nouveau moteur --------------------------------------------------------------------------------------

export type EngineActivationResult = { ok: true } | { ok: false; message: string };

export interface EngineActivationState {
  chosen: boolean;
  v1Active: boolean;
}

/** État affiché par l'écran de compte (lecture locale, sans réseau). */
export async function engineActivationState(uid: string): Promise<EngineActivationState> {
  const v1 = await loadSyncState(uid);
  return { chosen: await isEngineChosen(uid), v1Active: v1 !== null };
}

/**
 * Choix explicite du nouveau moteur pour le compte actif : pose le marqueur (refusé si la V1 est active), puis ACTIVE la synchronisation du compte
 * (instant d'activation et liste des anciennes données : jamais envoyées automatiquement), puis demande le démarrage. N'adopte, ne migre, ne supprime
 * et n'envoie aucune donnée. Refusé si le drapeau est fermé.
 */
export async function activateEngine(uid: string, enabled: () => boolean = () => CLOUD_ACCOUNT_ENABLED): Promise<EngineActivationResult> {
  if (!enabled()) return { ok: false, message: 'Les comptes cloud ne sont pas ouverts dans cette version.' };
  if (getSyncAccount() !== uid) return { ok: false, message: 'Le compte actif a changé : réessayez.' };
  // F1 : la synchronisation n'est proposée qu'à un compte dont l'adresse e-mail est vérifiée (refus par défaut)
  if (!isEmailVerified(uid)) return { ok: false, message: AUTH_MESSAGES['app/email-not-verified'] };
  try {
    await loadSyncState(uid); // renseigne l'exclusion avec la V1 (lecture locale)
    if (isV1KnownActive(uid)) return { ok: false, message: 'La synchronisation V1 est active pour ce compte : le nouveau moteur n’est pas disponible.' };
    await markEngineChosen(uid);
    try {
      await activateSync();
    } catch (error) {
      await clearEngineChosen(uid); // activation impossible : le choix n'est pas conservé
      throw error;
    }
    setEngineStampUid(uid); // dès le choix : les créations de ce compte sont marquées à son nom, avant même la première capture
    await refreshSyncLifecycle();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Activation impossible.' };
  }
}
