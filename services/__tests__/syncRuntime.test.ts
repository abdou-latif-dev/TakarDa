// Phase 6, étape 7 — démarrage du cycle réel PRÉPARÉ, NON ACTIVÉ : conditions de démarrage (drapeau, compte authentifié, activation), aucun
// minuteur ni écouteur quand une condition manque, réseau et premier plan simulés, arrêt complet, et preuve statique que l'application n'appelle
// rien (drapeau fermé, aucun import de production). Aucun réseau réel : cloud en mémoire.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests, activateSync } from '../sync/syncActivation';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { startSyncRuntime, type SyncRuntimeDeps } from '../sync/syncRuntime';
import { __resetSyncModeForTests, noteV1State } from '../syncMode';
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

const NOW = new Date('2026-10-22T12:00:00.000Z');
let clock = NOW.getTime();
let cloud: MemoryCloud;
let scheduled: { run: () => void; delay: number; cancelled: boolean }[];
let networkListeners: ((online: boolean) => void)[];
let foregroundListeners: ((active: boolean) => void)[];
let online: boolean;

const deps = (over: Partial<SyncRuntimeDeps> = {}): SyncRuntimeDeps => ({
  enabled: () => true,
  uid: () => 'alice',
  transports: (uid) => {
    const t = createFirestoreSyncTransport({ backend: cloud.backend, uid, now: () => new Date(clock), overlapMs: 0 });
    return { push: t, pull: t };
  },
  isOnline: () => online,
  subscribeNetwork: (cb) => (networkListeners.push(cb), () => void (networkListeners = networkListeners.filter((l) => l !== cb))),
  subscribeForeground: (cb) => (foregroundListeners.push(cb), () => void (foregroundListeners = foregroundListeners.filter((l) => l !== cb))),
  schedule: (run, delay) => {
    const entry = { run, delay, cancelled: false };
    scheduled.push(entry);
    return () => void (entry.cancelled = true);
  },
  now: () => new Date(clock),
  random: () => 0.5,
  ...over,
});
const live = () => scheduled.filter((s) => !s.cancelled);
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 30)); };

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(true); // mode strict : l'activation est obligatoire
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  __resetSyncModeForTests();
  noteV1State('alice', false); // V1 non activée pour ce compte (l'exclusion V1/moteur est testée dans syncMode.test.ts)
  clock = NOW.getTime();
  scheduled = [];
  networkListeners = [];
  foregroundListeners = [];
  online = true;
  cloud = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') });
});
afterEach(() => __useActivationForTests(false));

describe('Conditions de démarrage', () => {
  it('drapeau fermé : rien n’est créé (ni minuteur, ni écouteur, ni transport, ni lecture)', async () => {
    const transports = jest.fn(deps().transports);
    expect(startSyncRuntime(deps({ enabled: () => false, transports }))).toBeNull();
    await settle();
    expect(transports).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    expect(networkListeners.length + foregroundListeners.length).toBe(0);
    expect(cloud.log).toEqual([]);
  });

  it('aucun compte authentifié : rien n’est créé', async () => {
    expect(startSyncRuntime(deps({ uid: () => null }))).toBeNull();
    await settle();
    expect(scheduled).toEqual([]);
    expect(networkListeners.length + foregroundListeners.length).toBe(0);
    expect(cloud.log).toEqual([]);
  });

  it('compte sans activation : le cycle démarre mais reste en pause « non activée » ; rien n’est capturé ni envoyé', async () => {
    await createBien({ nom: 'Ancien', adresse: 'X' });
    const runtime = startSyncRuntime(deps())!;
    await settle();
    expect(runtime.state().status).toBe('not_activated');
    expect(cloud.log).toEqual([]);
    runtime.stop();
  });
});

describe('Cycle réel simulé', () => {
  it('activation puis création : seul l’élément créé après l’activation est envoyé ; l’ancien reste local', async () => {
    const old = await createBien({ nom: 'Ancien', adresse: 'X' });
    await activateSync(new Date(Date.now() - 60_000));
    const fresh = await createBien({ nom: 'Nouveau', adresse: 'Y' });
    const runtime = startSyncRuntime(deps())!;
    await settle();
    expect(runtime.state().status).toBe('idle');
    expect(cloud.docs.has(fresh.id)).toBe(true);
    expect(cloud.docs.has(old.id)).toBe(false);
    runtime.stop();
  });

  it('hors ligne : aucun appel réseau, état « hors ligne » ; le retour du réseau relance un cycle', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    const fresh = await createBien({ nom: 'Nouveau', adresse: 'Y' });
    online = false;
    const runtime = startSyncRuntime(deps())!;
    await settle();
    expect(runtime.state().status).toBe('offline');
    expect(cloud.log).toEqual([]);
    online = true;
    clock += 60_000;
    networkListeners.forEach((l) => l(true));
    await settle();
    expect(runtime.state().status).toBe('idle');
    expect(cloud.docs.has(fresh.id)).toBe(true);
    runtime.stop();
  });

  it('retour au premier plan : un cycle est demandé ; passage en arrière-plan : rien', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    const runtime = startSyncRuntime(deps())!;
    await settle();
    const fresh = await createBien({ nom: 'Pendant', adresse: 'Z' });
    clock += 60_000;
    foregroundListeners.forEach((l) => l(false));
    await settle();
    expect(cloud.docs.has(fresh.id)).toBe(false);
    foregroundListeners.forEach((l) => l(true));
    await settle();
    expect(cloud.docs.has(fresh.id)).toBe(true);
    runtime.stop();
  });

  it('changement local : capture immédiate puis envoi différé (accalmie) ; « synchroniser maintenant » envoie sans attendre', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    const runtime = startSyncRuntime(deps())!;
    await settle();
    const fresh = await createBien({ nom: 'Local', adresse: 'W' });
    runtime.notifyLocalChange();
    await settle();
    expect(cloud.docs.has(fresh.id)).toBe(false); // pas encore envoyé : accalmie programmée
    expect(live().some((s) => s.delay > 0)).toBe(true);
    clock += 60_000;
    await runtime.syncNow();
    expect(cloud.docs.has(fresh.id)).toBe(true);
    runtime.stop();
  });
});

describe('Arrêt et changement de compte', () => {
  it('stop : minuteurs annulés, écouteurs retirés, plus aucun cycle', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    const runtime = startSyncRuntime(deps())!;
    await settle();
    runtime.stop();
    expect(live()).toEqual([]);
    expect(networkListeners.length + foregroundListeners.length).toBe(0);
    const fresh = await createBien({ nom: 'Après', adresse: 'V' });
    runtime.notifyLocalChange();
    await runtime.syncNow();
    expect(cloud.docs.has(fresh.id)).toBe(false);
    expect(runtime.state().status).toBe('stopped');
  });

  it('drapeau refermé pendant l’exécution : le cycle s’arrête de lui-même (aucun envoi)', async () => {
    await activateSync(new Date(Date.now() - 60_000));
    let enabled = true;
    const runtime = startSyncRuntime(deps({ enabled: () => enabled }))!;
    await settle();
    const fresh = await createBien({ nom: 'Fermé', adresse: 'U' });
    enabled = false;
    clock += 60_000;
    await runtime.syncNow();
    expect(cloud.docs.has(fresh.id)).toBe(false);
    expect(runtime.state().status).toBe('no_account');
    runtime.stop();
  });
});

describe('Non activé dans l’application', () => {
  const root = path.join(__dirname, '..', '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const rel = (f: string) => path.relative(root, f).replace(/\\/g, '/');

  it('aucun code de production n’importe le runtime ni sa composition (seule la composition importe le runtime)', () => {
    const importing = (pattern: RegExp) => walk(root).filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(importing(/sync\/syncRuntime['"]/)).toEqual(['services/firebase/syncRuntimeBoot.ts']);
    expect(importing(/syncRuntimeBoot['"]/)).toEqual(['services/syncLifecycle.ts']);
  });

  it('le drapeau reste fermé et le runtime ne lit que le drapeau injecté', () => {
    expect(fs.readFileSync(path.join(root, 'constants/features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
    const runtime = fs.readFileSync(path.join(root, 'services/sync/syncRuntime.ts'), 'utf8');
    const imports = runtime.split('\n').filter((l) => l.startsWith('import')).join('\n');
    expect(imports).not.toMatch(/constants\/features|react-native|firebase/);
  });
});
