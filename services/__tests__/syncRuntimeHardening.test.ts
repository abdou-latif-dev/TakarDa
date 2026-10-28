// Phase 7 — démarrage partiel et arrêt propre du runtime : chaque échec après la réservation nettoie tout (écouteurs, cycle, réservation libérée une seule
// fois) en conservant l'erreur initiale ; le démarrage est refaisable ; `stop()` interdit tout nouveau travail et `drain()` n'est résolu qu'à la fin RÉELLE du
// travail engagé (la réservation n'est rendue qu'alors) ; appels répétés et concurrents idempotents ; suppression de compte pendant un cycle. Dépendances
// simulées, cloud en mémoire, aucun Firebase.

import * as dbModule from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { setSyncAccount } from '../sync/syncAccount';
import { forgetSyncAccountState } from '../sync/syncAccountCleanup';
import { __useActivationForTests, activateSync } from '../sync/syncActivation';
import { tryAcquireSyncLock } from '../sync/syncLock';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { startSyncRuntime, type SyncRuntime, type SyncRuntimeDeps } from '../sync/syncRuntime';
import { quiesceSyncLifecycle, startSyncLifecycle, type AuthSource } from '../syncLifecycle';
import { __resetSyncModeForTests, claimEngine, isEngineClaimed, markEngineChosen, noteV1State } from '../syncMode';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => void mockMemory.set(key, value),
    removeItem: async (key: string) => void mockMemory.delete(key),
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

let cloud: MemoryCloud;
let pushCalls: string[];
let pullCalls: number;
let gate: { hold: boolean; pending: (() => void)[]; release: () => void };
const running: SyncRuntime[] = [];

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const flag = (promise: Promise<unknown>) => {
  const state = { done: false };
  void promise.then(() => (state.done = true));
  return state;
};

const baseDeps = (over: Partial<SyncRuntimeDeps> = {}): SyncRuntimeDeps => ({
  enabled: () => true,
  uid: () => 'alice',
  transports: (uid) => {
    const real = createFirestoreSyncTransport({ backend: cloud.backend, uid, overlapMs: 0 });
    return {
      push: {
        read: (kind, id) => real.read(kind, id),
        push: async (request) => {
          pushCalls.push(request.recordId);
          if (gate.hold) await new Promise<void>((resolve) => gate.pending.push(resolve)); // opération réseau « engagée », non annulable
          return real.push(request);
        },
      },
      pull: {
        pull: (request) => {
          pullCalls += 1;
          return real.pull(request);
        },
      },
    };
  },
  isOnline: () => true,
  schedule: () => () => undefined,
  random: () => 0.5,
  ...over,
});
const start = (over: Partial<SyncRuntimeDeps> = {}): SyncRuntime => {
  const runtime = startSyncRuntime(baseDeps(over));
  if (!runtime) throw new Error('démarrage refusé dans le test');
  running.push(runtime);
  return runtime;
};

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(true);
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  __resetSyncModeForTests();
  noteV1State('alice', false);
  cloud = createMemoryCloud({ uid: 'alice', start: new Date(Date.now() - 3_600_000) });
  pushCalls = [];
  pullCalls = 0;
  gate = {
    hold: false,
    pending: [],
    release: () => {
      gate.hold = false;
      gate.pending.splice(0).forEach((resolve) => resolve());
    },
  };
});
afterEach(async () => {
  gate.release();
  for (const runtime of running.splice(0)) {
    runtime.stop();
    await runtime.drain();
  }
  __useActivationForTests(false);
});

/** Active la synchronisation puis crée `count` biens APRÈS l'activation (donc à envoyer). */
async function seed(count: number): Promise<string[]> {
  await activateSync(new Date(Date.now() - 60_000));
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push((await createBien({ nom: `Bien ${i}`, adresse: 'Lomé' })).id);
  return ids;
}

describe('Démarrage partiel : nettoyage complet, erreur initiale préservée, nouvel essai possible', () => {
  const initial = new Error('échec initial');

  it('échec de l’état initial du cycle (onState lève pendant cycle.start) : réservation rendue, aucun écouteur résiduel', async () => {
    const unsubscribed = jest.fn();
    expect(() =>
      startSyncRuntime(baseDeps({ onState: () => { throw initial; }, subscribeNetwork: () => unsubscribed })),
    ).toThrow(initial);
    expect(isEngineClaimed()).toBe(false);
    expect(unsubscribed).not.toHaveBeenCalled(); // jamais abonné : rien à retirer
  });

  it('échec de l’abonnement réseau : réservation rendue', () => {
    expect(() => startSyncRuntime(baseDeps({ subscribeNetwork: () => { throw initial; } }))).toThrow(initial);
    expect(isEngineClaimed()).toBe(false);
  });

  it('échec de l’abonnement au premier plan APRÈS l’abonnement réseau : l’écouteur réseau est retiré exactement une fois, la réservation rendue une fois', () => {
    const unsubscribeNetwork = jest.fn();
    expect(() =>
      startSyncRuntime(baseDeps({ subscribeNetwork: () => unsubscribeNetwork, subscribeForeground: () => { throw initial; } })),
    ).toThrow(initial);
    expect(unsubscribeNetwork).toHaveBeenCalledTimes(1);
    expect(isEngineClaimed()).toBe(false);
  });

  it('une erreur de nettoyage (désabonnement qui lève) ne masque PAS l’erreur initiale, et la réservation est quand même rendue', () => {
    const throwing = jest.fn(() => { throw new Error('désabonnement impossible'); });
    let caught: unknown;
    try {
      startSyncRuntime(baseDeps({ subscribeNetwork: () => throwing, subscribeForeground: () => { throw initial; } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(initial);
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(isEngineClaimed()).toBe(false);
  });

  it('après un échec partiel, un nouveau démarrage réussit sans redémarrer l’application, et le moteur peut être réservé', async () => {
    expect(() => startSyncRuntime(baseDeps({ subscribeForeground: () => { throw initial; } }))).toThrow(initial);
    const runtime = start();
    expect(isEngineClaimed()).toBe(true);
    runtime.stop();
    await runtime.drain();
    expect(isEngineClaimed()).toBe(false);
    expect(() => claimEngine('alice')()).not.toThrow();
  });

  it('échec de réservation (V1 active) : rien n’est créé, aucun écouteur, la V1 n’est pas touchée', () => {
    noteV1State('alice', true);
    const subscribe = jest.fn(() => () => undefined);
    expect(() => startSyncRuntime(baseDeps({ subscribeNetwork: subscribe, subscribeForeground: subscribe }))).toThrow(expect.objectContaining({ code: 'v1_active' }));
    expect(subscribe).not.toHaveBeenCalled();
    expect(isEngineClaimed()).toBe(false);
  });
});

describe('Arrêt : plus aucun nouveau travail, drainage réel, réservation rendue après', () => {
  it('arrêt PENDANT une opération engagée : on attend sa fin, aucune opération suivante n’est envoyée, aucune lecture ne suit', async () => {
    await seed(3);
    gate.hold = true;
    const runtime = start();
    await settle();
    expect(pushCalls).toHaveLength(1); // une opération engagée, bloquée dans le « réseau »
    runtime.stop();
    gate.release(); // l'opération engagée se termine
    await runtime.drain();
    expect(pushCalls).toHaveLength(1); // shouldStop : aucune écriture supplémentaire
    expect(cloud.docs.size).toBe(1);
    expect(pullCalls).toBe(0); // et plus aucune réception
  });

  it('la réservation du moteur n’est rendue qu’APRÈS la fin du travail engagé ; drain() ne se résout pas avant', async () => {
    await seed(2);
    gate.hold = true;
    const runtime = start();
    await settle();
    runtime.stop();
    const drained = flag(runtime.drain());
    await settle();
    expect(drained.done).toBe(false); // l'opération réseau n'est pas terminée : pas de délai arbitraire, on attend réellement
    expect(isEngineClaimed()).toBe(true); // la V1 ne peut pas démarrer pendant ce temps
    gate.release();
    await runtime.drain();
    await settle();
    expect(drained.done).toBe(true);
    expect(isEngineClaimed()).toBe(false);
  });

  it('stop() et drain() répétés ou concurrents : même promesse de terminaison, aucune erreur, réservation rendue une seule fois', async () => {
    await seed(2);
    gate.hold = true;
    const runtime = start();
    await settle();
    expect(() => { runtime.stop(); runtime.stop(); runtime.stop(); }).not.toThrow();
    const first = runtime.drain();
    const second = runtime.drain();
    expect(second).toBe(first); // une seule promesse de terminaison
    gate.release();
    await Promise.all([first, second, runtime.drain()]);
    await settle();
    expect(isEngineClaimed()).toBe(false);
    // un autre runtime réserve ensuite le moteur : les appels tardifs de l'ancien ne le libèrent PAS
    const next = start();
    runtime.stop();
    await runtime.drain();
    await settle();
    expect(isEngineClaimed()).toBe(true);
    next.stop();
    await next.drain();
  });

  it('après stop(), toute demande (synchroniser maintenant, changement local) est sans effet', async () => {
    const [id] = await seed(1);
    const runtime = start();
    await settle();
    runtime.stop();
    await runtime.drain();
    pushCalls.length = 0;
    await createBien({ nom: 'Après', adresse: 'X' });
    runtime.notifyLocalChange();
    await runtime.syncNow();
    expect(pushCalls).toEqual([]);
    expect(cloud.docs.has(id)).toBe(true); // ce qui avait été envoyé avant l'arrêt n'est pas touché
  });

  it('stop() demandé depuis un chemin qui détient déjà le verrou de synchronisation : aucun interblocage', async () => {
    const runtime = start();
    await settle();
    const release = tryAcquireSyncLock();
    expect(release).not.toBeNull();
    runtime.stop(); // ne prend jamais le verrou
    await runtime.drain();
    release?.();
    expect(isEngineClaimed()).toBe(false);
  });

  it('une erreur de désabonnement à l’arrêt ne casse pas l’arrêt : la réservation est quand même rendue', async () => {
    const runtime = start({ subscribeNetwork: () => () => { throw new Error('désabonnement impossible'); } });
    await settle();
    expect(() => runtime.stop()).not.toThrow();
    await runtime.drain();
    expect(isEngineClaimed()).toBe(false);
  });
});

describe('Suppression de compte pendant un cycle', () => {
  const source = (state: { authStatus: string; user: { uid: string } | null; accountEpoch: number; deleting: boolean }) => {
    const listeners = new Set<() => void>();
    const src: AuthSource & { set: (patch: Partial<typeof state>) => void } = {
      getState: () => state,
      subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
      set: (patch) => {
        Object.assign(state, patch);
        listeners.forEach((l) => l());
      },
    };
    return src;
  };

  async function startPilot() {
    await markEngineChosen('alice');
    const state = { authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false };
    const src = source(state);
    let current: SyncRuntime | null = null;
    const stop = startSyncLifecycle(src, {
      enabled: () => true,
      personalWorkspace: () => true,
      engineChosen: async () => true,
      boot: async (getUid) => {
        current = startSyncRuntime(baseDeps({ uid: getUid }));
      },
      shutdown: () => current?.stop(),
      idle: () => current?.drain() ?? Promise.resolve(),
    });
    return { src, stop, runtime: () => current };
  }

  it('quiesceSyncLifecycle attend la fin du cycle engagé : aucune écriture après la demande de suppression', async () => {
    await seed(3);
    gate.hold = true;
    const pilot = await startPilot();
    await settle();
    expect(pushCalls).toHaveLength(1);
    pilot.src.set({ deleting: true }); // suppression demandée : arrêt synchrone
    const quiesced = flag(quiesceSyncLifecycle(2000));
    await settle();
    expect(quiesced.done).toBe(false); // l'opération engagée n'est pas finie : on attend
    gate.release();
    expect(await quiesceSyncLifecycle(2000)).toBe(true);
    await settle();
    expect(quiesced.done).toBe(true);
    expect(pushCalls).toHaveLength(1); // aucune opération suivante
    expect(isEngineClaimed()).toBe(false);
    pilot.stop();
  });

  it('délai dépassé : quiesce retourne false (ce n’est PAS une garantie d’arrêt) ; le travail engagé continue mais aucune opération suivante ne part', async () => {
    await seed(3);
    gate.hold = true;
    const pilot = await startPilot();
    await settle();
    pilot.src.set({ deleting: true });
    expect(await quiesceSyncLifecycle(60)).toBe(false);
    expect(isEngineClaimed()).toBe(true); // le travail engagé n'est pas terminé : la réservation n'est pas rendue
    gate.release();
    await pilot.runtime()?.drain();
    await settle();
    expect(pushCalls).toHaveLength(1);
    expect(isEngineClaimed()).toBe(false);
    pilot.stop();
  });

  it('sans pilotage démarré (drapeau fermé) : quiesce se résout aussitôt', async () => {
    expect(await quiesceSyncLifecycle(50)).toBe(true);
  });

  it('forgetSyncAccountState attend le verrou : il ne réécrit ni ne supprime rien pendant le cycle, puis oublie l’état technique après sa fin', async () => {
    await seed(2);
    await markEngineChosen('alice');
    gate.hold = true;
    const runtime = start();
    await settle();
    runtime.stop();
    const forgotten = flag(forgetSyncAccountState('alice', 2000));
    await settle();
    expect(forgotten.done).toBe(false); // le cycle engagé détient le verrou
    expect([...mockMemory.keys()].some((k) => k.includes('sync_activation') && k.includes('@alice'))).toBe(true);
    gate.release();
    await runtime.drain();
    await settle();
    expect(forgotten.done).toBe(true);
    expect([...mockMemory.keys()].filter((k) => /sync_(queue|baseline|meta|inbound_cursor|inbound_pending|budget|activation)/.test(k) && k.includes('@alice'))).toEqual([]);
    expect([...mockMemory.keys()].some((k) => k.includes('sync_engine_mode_alice'))).toBe(false);
    // le cycle arrêté n'a rien réécrit après l'oubli
    await settle();
    expect([...mockMemory.keys()].filter((k) => /sync_(queue|baseline|meta|activation)/.test(k) && k.includes('@alice'))).toEqual([]);
  });

  it('forgetSyncAccountState : verrou toujours pris après l’attente bornée → refus explicite, rien n’est oublié', async () => {
    await seed(1);
    await markEngineChosen('alice');
    const held = tryAcquireSyncLock();
    const before = [...mockMemory.keys()].sort();
    await expect(forgetSyncAccountState('alice', 60)).rejects.toThrow(/encore en cours/);
    expect([...mockMemory.keys()].sort()).toEqual(before);
    held?.();
    await expect(forgetSyncAccountState('alice', 500)).resolves.toBeDefined();
  });
});
