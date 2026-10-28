// Phase 6, étape 4 — états de synchronisation réels dans les composants EXISTANTS (pastille et bandeau), derrière le drapeau (fermé) : état par
// élément, pauses, conflits, erreurs, suppressions récupérables ; jamais « synchronisé » sans confirmation du cloud ; comportement actuel inchangé
// quand le moteur n'est pas démarré. Pas de bibliothèque de rendu dans le projet : mapping, store et structure des composants sont testés
// (les composants eux-mêmes sont vérifiés statiquement).

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { records } from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { runInbound } from '../sync/inbound';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { badgeStateFor, isPausedCycle } from '../syncDisplay';
import { useSyncEngineStore } from '../../store/syncEngineStore';
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

const EARLY = { enabledAt: '2000-01-01T00:00:00.000Z' };
const NOW = new Date('2026-10-22T12:00:00.000Z');
let cloud: MemoryCloud;
const store = () => useSyncEngineStore.getState();

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(false);
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  store().reset();
  cloud = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') });
});

const transport = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: () => NOW, overlapMs: 0 });
const push = async () => (await captureLocalChanges({ scope: EARLY, now: NOW }), runOnce({ transport: transport(), ownerUid: 'alice', now: () => NOW, random: () => 0.5 }));
const rec = (id: string) => records.find((r) => r.id === id) as unknown as { values: Record<string, unknown> };

describe('Pastille : correspondance état réel → affichage', () => {
  it('chaque état réel a son affichage ; « synchronisé » n’est jamais produit sans que le moteur l’ait établi ; « en cours » seulement pour un élément en attente pendant un cycle', () => {
    expect(badgeStateFor(undefined, null)).toBe('local'); // inconnu du moteur : jamais « synchronisé » par défaut
    expect(badgeStateFor('local', 'running')).toBe('local');
    expect(badgeStateFor('pending', null)).toBe('pending');
    expect(badgeStateFor('pending', 'running')).toBe('syncing');
    expect(badgeStateFor('synced', 'running')).toBe('synced'); // un élément déjà confirmé ne repasse pas « en cours »
    expect(badgeStateFor('conflict', 'running')).toBe('conflict');
    expect(badgeStateFor('error', 'idle')).toBe('error');
    // pauses : l'état de l'élément ne ment pas (un élément en attente reste « en attente »)
    for (const paused of ['offline', 'quota_paused', 'paused_errors', 'backoff', 'not_activated'] as const) {
      expect(isPausedCycle(paused)).toBe(true);
      expect(badgeStateFor('pending', paused)).toBe('pending');
      expect(badgeStateFor('synced', paused)).toBe('synced');
    }
    expect(isPausedCycle('idle')).toBe(false);
    expect(isPausedCycle(null)).toBe(false);
  });
});

describe('Store d’affichage alimenté par le moteur', () => {
  it('inactif par défaut (drapeau fermé) : il ne lit rien et ne change rien', async () => {
    await createBien({ nom: 'Local', adresse: 'X' });
    expect(store()).toMatchObject({ active: false, summary: null, banner: null, cycle: null });
    const keys = JSON.stringify([...mockMemory.entries()]);
    await store().refresh();
    await store().syncNow();
    expect(JSON.stringify([...mockMemory.entries()])).toBe(keys); // aucune écriture, aucun état de synchronisation créé
    expect(store().summary).toBeNull();
    expect(cloud.log).toEqual([]);
  });

  it('local → en attente → synchronisé seulement après confirmation ; modification locale : en attente ; bandeau cohérent', async () => {
    store().setActive(true);
    const old = await createBien({ nom: 'Ancien', adresse: 'X' });
    await store().refresh();
    // sans activation stricte (mode moteur générique) l'élément éligible est « en attente » dès qu'il est revendiqué ; avant la capture il est « local »
    expect(store().summary?.states[old.id]).toBe('local');
    await captureLocalChanges({ scope: EARLY, now: NOW });
    await store().refresh();
    expect(store().summary?.states[old.id]).toBe('pending');
    expect(store().banner).toMatchObject({ summary: '1 en attente d’envoi', tone: 'pending' });
    expect(badgeStateFor(store().summary?.states[old.id], store().cycle)).toBe('pending');
    await runOnce({ transport: transport(), ownerUid: 'alice', now: () => NOW, random: () => 0.5 });
    await store().refresh();
    expect(store().summary?.states[old.id]).toBe('synced');
    expect(store().banner).toMatchObject({ summary: 'Tout est synchronisé', tone: 'ok' });
    rec(old.id).values.nom = 'Modifié';
    await store().refresh();
    expect(store().summary?.states[old.id]).toBe('pending'); // jamais « synchronisé » tant que le cloud n'a pas confirmé
  });

  it('conflit, erreur définitive et suppression récupérable apparaissent dans le bandeau avec leur ton', async () => {
    store().setActive(true);
    const a = await createBien({ nom: 'A', adresse: 'X' });
    const b = await createBien({ nom: 'B', adresse: 'Y' });
    await push();
    // conflit : même champ des deux côtés
    rec(a.id).values.nom = 'Locale';
    const doc = cloud.docs.get(a.id)!;
    cloud.docs.set(a.id, { ...doc, rev: 2, body: { ...doc.body, nom: 'Distante' }, lastOpId: 'autre', serverUpdatedAt: '2026-10-22T09:30:00.000Z' });
    // suppression distante de B (non modifié localement) : récupérable
    const docB = cloud.docs.get(b.id)!;
    cloud.docs.set(b.id, { ...docB, rev: 2, deleted: true, deletedAt: 'x', lastOpId: 'autre', serverUpdatedAt: '2026-10-22T09:31:00.000Z' });
    await runInbound({ pull: transport(), ownerUid: 'alice', now: () => NOW });
    await store().refresh();
    expect(store().summary?.states[a.id]).toBe('conflict');
    expect(store().summary?.recoverable.map((r) => r.recordId)).toEqual([b.id]);
    expect(store().banner).toMatchObject({ summary: '1 conflit(s) à résoudre', tone: 'attention', conflicts: 1, recoverable: 1 });
    // erreur définitive : contenu refusé avant l'envoi
    const c = await createBien({ nom: 'C', adresse: 'Z' });
    rec(c.id).values.tableau = [[1]];
    await push();
    await store().refresh();
    expect(store().summary?.states[c.id]).toBe('error');
    expect(store().summary?.errors).toEqual([c.id]);
  });

  it('pauses : le bandeau explique hors ligne, limite quotidienne, pause après échecs, non activé ; l’état par élément ne change pas ; « en cours » pendant un cycle', async () => {
    store().setActive(true);
    const a = await createBien({ nom: 'A', adresse: 'X' });
    await captureLocalChanges({ scope: EARLY, now: NOW });
    await store().refresh();
    const cases: [Parameters<ReturnType<typeof store>['setCycleStatus']>[0], RegExp][] = [
      ['offline', /Hors ligne/],
      ['quota_paused', /Limite quotidienne/],
      ['paused_errors', /Synchroniser maintenant/],
      ['not_activated', /non activée/],
    ];
    for (const [status, pattern] of cases) {
      store().setCycleStatus(status);
      expect(store().banner?.summary).toMatch(pattern);
      expect(store().banner?.tone).toBe('paused');
      expect(store().summary?.states[a.id]).toBe('pending'); // l'élément reste en attente : aucune fausse confirmation
    }
    store().setCycleStatus('running');
    expect(store().banner).toMatchObject({ summary: 'Synchronisation…', tone: 'pending' });
    expect(badgeStateFor(store().summary?.states[a.id], 'running')).toBe('syncing');
    store().setCycleStatus('idle');
    expect(store().banner?.summary).toBe('1 en attente d’envoi');
  });

  it('un résultat lu sous un ancien compte est écarté ; la désactivation vide tout ; « synchroniser maintenant » n’agit que par la fonction fournie au démarrage du cycle', async () => {
    store().setActive(true);
    await createBien({ nom: 'A', adresse: 'X' });
    await captureLocalChanges({ scope: EARLY, now: NOW });
    const pending = store().refresh();
    setActiveCloudUid('bob'); // changement de compte pendant la lecture
    await pending;
    expect(store().summary).toBeNull();
    setActiveCloudUid('alice');
    await store().refresh();
    expect(store().summary).not.toBeNull();
    const handler = jest.fn(async () => undefined);
    await store().syncNow(); // aucune fonction fournie : sans effet
    expect(handler).not.toHaveBeenCalled();
    store().setSyncNowHandler(handler);
    await store().syncNow();
    expect(handler).toHaveBeenCalledTimes(1);
    store().setActive(false);
    expect(store()).toMatchObject({ active: false, summary: null, banner: null, cycle: null });
  });
});

describe('Composants existants : structure et drapeau', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

  it('la pastille et le bandeau gardent leur logique actuelle et n’utilisent le moteur que s’il est actif ; le bandeau reste nul drapeau fermé ou sans compte', () => {
    const badge = read('components/immobilier/SyncBadge.tsx');
    expect(badge).toContain('const key: BadgeState = engineActive ? badgeStateFor(engineState, cycle) : badgeState(state ?? \'local\', syncing);');
    expect(badge).toContain('if (!engineActive && !enabled) return null;');
    for (const key of ['local', 'pending', 'syncing', 'synced', 'conflict', 'error']) expect(badge).toContain(`${key}: {`); // mêmes libellés
    const banner = read('components/immobilier/SyncBanner.tsx');
    expect(banner.indexOf("if (!CLOUD_ACCOUNT_ENABLED || authStatus !== 'signedIn') return null;")).toBeGreaterThan(-1);
    expect(banner.indexOf("if (!CLOUD_ACCOUNT_ENABLED || authStatus !== 'signedIn') return null;")).toBeLessThan(banner.indexOf('if (engineActive && engineBanner)'));
    expect(banner).toContain('Compte connecté. Activez la synchronisation pour retrouver vos biens sur un autre téléphone.'); // texte V1 conservé
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });

  it('les écrans et stores ne lisent le moteur que par la façade d’affichage ; le store du moteur ne démarre rien', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    for (const file of [...walk('components'), ...walk('features'), ...walk('app'), ...walk('store')]) {
      const imports = read(file).split('\n').filter((l) => /^import /.test(l)).join('\n');
      const direct = [...imports.matchAll(/from '@\/services\/sync\/(\w+)'/g)].map((m) => m[1]);
      expect(direct.filter((name) => !(file === 'store/cloudStore.ts' && ['syncAccount', 'syncAccountCleanup'].includes(name)))).toEqual([]);
    }
    const storeSource = read('store/syncEngineStore.ts');
    expect(storeSource).not.toMatch(/runOnce|runInbound|createSyncCycle|activateSync|setInterval|setTimeout|firebase/);
  });
});
