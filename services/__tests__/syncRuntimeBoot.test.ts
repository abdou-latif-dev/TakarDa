// Phase 7 — démarrage de PRODUCTION du moteur (`bootSyncRuntime`, `shutdownSyncRuntime` et le pilotage par défaut de `syncLifecycle`) avec dépendances SIMULÉES :
// le drapeau est simulé ouvert dans CE fichier seulement (le vrai reste fermé), Firebase est remplacé (client, backend, transport) par le cloud en mémoire.
// Aucun appel réseau ni Firebase.

import * as dbModule from '../db';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';
import { resetImmobilierToolCache } from '../immobilierService';
import { enableSync, type CloudRecordsApi } from '../cloudSyncService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { bootSyncRuntime, shutdownSyncRuntime, waitForSyncRuntimeIdle } from '../firebase/syncRuntimeBoot';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { quiesceSyncLifecycle, startSyncLifecycle, type AuthSource } from '../syncLifecycle';
import { __resetSyncModeForTests, isEngineClaimed, markEngineChosen, noteV1State } from '../syncMode';
import { useSyncEngineStore } from '../../store/syncEngineStore';

const mockState: { cloud: MemoryCloud | null; failKeys: string[] } = { cloud: null, failKeys: [] };

jest.mock('@/constants/features', () => ({ CLOUD_ACCOUNT_ENABLED: true }));
jest.mock('../firebase/firebaseClient', () => ({ getFirestoreDb: () => ({}) }));
jest.mock('../firebase/firestoreSyncBackend', () => ({ createFirestoreSyncBackend: () => ({}) }));
jest.mock('../firebase/firestoreSyncTransport', () => {
  const actual = jest.requireActual('../firebase/firestoreSyncTransport');
  return { ...actual, createFirestoreSyncTransport: (options: Record<string, unknown>) => actual.createFirestoreSyncTransport({ ...options, backend: (mockState.cloud as MemoryCloud).backend }) };
});
jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockState.failKeys.some((k) => key.includes(k))) throw new Error('stockage illisible');
      return mockMemory.has(key) ? (mockMemory.get(key) as string) : null;
    },
    setItem: async (key: string, value: string) => void mockMemory.set(key, value),
    removeItem: async (key: string) => void mockMemory.delete(key),
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

const api = { ensureSpace: async (uid: string) => `personal_${uid}`, fetchRecords: async () => [], writeRecord: async () => 1 } as unknown as CloudRecordsApi;
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const store = () => useSyncEngineStore.getState();

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(false);
  await switchWorkspace('personal');
  mockMemory.clear();
  mockState.failKeys = [];
  mockState.cloud = createMemoryCloud({ uid: 'alice', start: new Date(Date.now() - 3_600_000) });
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  __resetSyncModeForTests();
  store().reset();
});
afterEach(async () => {
  shutdownSyncRuntime();
  await waitForSyncRuntimeIdle();
  store().reset();
  __useActivationForTests(false);
});

describe('bootSyncRuntime (production, dépendances simulées)', () => {
  it('compte absent : rien ne démarre, aucune réservation, affichage inactif', async () => {
    expect(await bootSyncRuntime(() => null)).toBeNull();
    expect(isEngineClaimed()).toBe(false);
    expect(store().active).toBe(false);
  });

  it('démarrage autorisé (V1 non active) : runtime lié au compte, réservation prise, affichage activé ; un second appel renvoie le même runtime', async () => {
    const first = await bootSyncRuntime(() => 'alice');
    expect(first).not.toBeNull();
    expect(first?.uid).toBe('alice');
    expect(isEngineClaimed()).toBe(true);
    expect(store().active).toBe(true);
    expect(await bootSyncRuntime(() => 'alice')).toBe(first);
  });

  it('V1 active pour le compte : démarrage refusé (SyncModeError), aucune réservation, rien d’activé', async () => {
    await enableSync(api, 'alice');
    await expect(bootSyncRuntime(() => 'alice')).rejects.toMatchObject({ code: 'v1_active' });
    expect(isEngineClaimed()).toBe(false);
    expect(store().active).toBe(false);
  });

  it('état V1 illisible : démarrage refusé (inconnu = refus), jamais de pari', async () => {
    mockState.failKeys = ['cloud_sync_'];
    await expect(bootSyncRuntime(() => 'alice')).rejects.toMatchObject({ code: 'v1_unknown' });
    expect(isEngineClaimed()).toBe(false);
  });

  it('le compte change pendant la lecture de l’état V1 : rien ne démarre pour l’ancien compte', async () => {
    let reads = 0;
    // le compte est « alice » à la première lecture (début du démarrage), puis « bob » : changement de compte pendant la lecture de l'état V1
    expect(await bootSyncRuntime(() => (reads++ === 0 ? 'alice' : 'bob'))).toBeNull();
    expect(isEngineClaimed()).toBe(false);
  });

  it('arrêt : affichage remis à l’état inactif ; la réservation n’est rendue qu’après la fin du travail ; un nouveau démarrage est ensuite possible', async () => {
    const runtime = await bootSyncRuntime(() => 'alice');
    shutdownSyncRuntime();
    expect(store().active).toBe(false);
    await waitForSyncRuntimeIdle();
    await settle();
    expect(isEngineClaimed()).toBe(false);
    expect(runtime).not.toBeNull();
    expect(await bootSyncRuntime(() => 'alice')).not.toBeNull();
  });

  it('changement de compte : l’ancien runtime ne voit plus de compte (il ne travaille jamais pour le nouveau) et un nouveau démarrage attend la fin du précédent', async () => {
    let uid: string | null = 'alice';
    const getUid = () => uid;
    const alice = await bootSyncRuntime(getUid);
    expect(alice?.uid).toBe('alice');
    uid = 'bob';
    const result = await alice?.syncNow(); // lié à alice : le compte authentifié est bob → aucun compte pour ce runtime
    expect(result?.ran).toBe(false);
    expect(result?.skipped).toBe('no_account');
    const bob = await bootSyncRuntime(getUid);
    expect(bob?.uid).toBe('bob');
    expect(bob).not.toBe(alice);
    expect(isEngineClaimed()).toBe(true); // seul le runtime de bob détient la réservation
  });
});

describe('Pilotage par défaut (syncLifecycle) avec le démarrage de production simulé', () => {
  const source = (initial: { authStatus: string; user: { uid: string } | null; accountEpoch: number; deleting: boolean }) => {
    const state = { ...initial };
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

  it('moteur choisi : démarre pour le compte connecté ; déconnexion : arrêt complet ; la réservation est rendue ensuite', async () => {
    noteV1State('alice', false);
    await markEngineChosen('alice');
    const src = source({ authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false });
    const stop = startSyncLifecycle(src);
    await settle();
    expect(isEngineClaimed()).toBe(true);
    expect(store().active).toBe(true);
    src.set({ authStatus: 'signedOut', user: null, accountEpoch: 2 });
    expect(await quiesceSyncLifecycle(2000)).toBe(true);
    await settle();
    expect(store().active).toBe(false);
    expect(isEngineClaimed()).toBe(false);
    stop();
  });

  it('marqueur illisible : le moteur NE démarre PAS (illisible n’est pas un choix) et la V1 reste refusée', async () => {
    noteV1State('alice', false);
    await markEngineChosen('alice');
    __resetSyncModeForTests(); // redémarrage simulé : la mémoire est oubliée
    mockState.failKeys = ['sync_engine_mode_'];
    noteV1State('alice', false);
    const src = source({ authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false });
    const stop = startSyncLifecycle(src);
    await settle();
    expect(isEngineClaimed()).toBe(false);
    expect(store().active).toBe(false);
    await expect(enableSync(api, 'alice')).rejects.toMatchObject({ code: 'marker_unreadable' });
    stop();
  });

  it('changement vers un compte sans choix du moteur : l’ancien est arrêté et rien ne démarre pour le nouveau', async () => {
    noteV1State('alice', false);
    noteV1State('bob', false);
    await markEngineChosen('alice');
    const src = source({ authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false });
    const stop = startSyncLifecycle(src);
    await settle();
    expect(isEngineClaimed()).toBe(true);
    src.set({ user: { uid: 'bob' }, accountEpoch: 2 });
    await quiesceSyncLifecycle(2000);
    await settle();
    expect(isEngineClaimed()).toBe(false);
    expect(store().active).toBe(false);
    stop();
  });

  it('suppression de compte en cours : arrêt avant l’effacement', async () => {
    noteV1State('alice', false);
    await markEngineChosen('alice');
    const src = source({ authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false });
    const stop = startSyncLifecycle(src);
    await settle();
    src.set({ deleting: true });
    expect(await quiesceSyncLifecycle(2000)).toBe(true);
    await settle();
    expect(isEngineClaimed()).toBe(false);
    stop();
  });
});
