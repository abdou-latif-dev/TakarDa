// F6 — minimisation des données : supprimer un espace partagé, quitter un espace en retirant le nom saisi, départ des espaces rejoints à la suppression du compte.
// Cloud en mémoire qui applique la politique de référence ; aucun SDK, aucun réseau.

import fs from 'fs';
import path from 'path';
import { setEmailVerified } from '../accountVerification';
import { switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import { leaveSharedSpacesBestEffort } from '../firebase/sharedSpacesDeparture';
import { leaveJoinedModules } from '../sharedModules/departure';
import { listLocalModules, rememberOwnedModule } from '../sharedModules/localModules';
import { loadPublishedState, savePublishedState } from '../sharedModules/tenantViewLocal';
import { createSharedModulesService } from '../sharedModulesService';
import { createMemoryModulesCloud, type MemoryModulesCloud } from './helpers/modulesMemoryBackend';

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

jest.mock('firebase/firestore', () => ({ Timestamp: class {}, collection: jest.fn(), deleteDoc: jest.fn(), doc: jest.fn(), getDocFromServer: jest.fn(), getDocsFromServer: jest.fn(), limit: jest.fn(), query: jest.fn(), setDoc: jest.fn(), updateDoc: jest.fn(), where: jest.fn(), writeBatch: jest.fn() }));

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
let cloud: MemoryModulesCloud;
let clock: number;
const now = () => new Date(clock);
const MODULE_A = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
const MODULE_B = 'mod_bbbbbbbbbbbbbbbbbbbbbbbb';

const as = (uid: string) => {
  setSyncAccount(uid);
  setEmailVerified(uid, true);
};
const service = () =>
  createSharedModulesService({
    enabled: () => true,
    backend: (uid: string) => cloud.as(uid),
    erasure: (uid: string) => cloud.erasure(uid),
    contracts: async () => [{ id: 'c1', label: 'Koffi', statusKey: 'actif', endDay: null }],
    buildView: async () => [{ id: 'contrat', kind: 'contrat', body: { loyerMensuel: 30000 } }],
    now,
  });
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

beforeEach(async () => {
  await switchWorkspace('personal');
  mockMemory.clear();
  clock = Date.parse('2026-11-20T10:00:00.000Z');
  cloud = createMemoryModulesCloud(now);
  as('alice');
});
afterEach(() => setSyncAccount(null));

/** Alice a deux espaces ; Koffi est membre actif de A (avec une vue publiée), Ama a une demande refusée sur A. */
async function seed() {
  for (const [id, name] of [[MODULE_A, 'Immeuble A'], [MODULE_B, 'Immeuble B']] as const) {
    cloud.modules[id] = { ownerUid: 'alice', type: 'immobilier', name, createdAt: '2026-10-01T00:00:00.000Z', schemaVersion: 1 };
  }
  await rememberOwnedModule({ moduleId: MODULE_A, name: 'Immeuble A', createdAt: '2026-10-01T00:00:00.000Z' });
  await rememberOwnedModule({ moduleId: MODULE_B, name: 'Immeuble B', createdAt: '2026-10-01T00:00:00.000Z' });
  as('koffi');
  unwrap(await service().requestAccess('koffi', MODULE_A, 'Koffi Mensah'));
  as('ama');
  unwrap(await service().requestAccess('ama', MODULE_A, 'Ama'));
  as('alice');
  unwrap(await service().approve('alice', MODULE_A, 'koffi', 'c1'));
  unwrap(await service().refuse('alice', MODULE_A, 'ama'));
  cloud.records[`${MODULE_A}/r1`] = { kind: 'immobilier.bien', ownerUid: 'alice', rev: 1, deleted: false };
  await savePublishedState(MODULE_A, 'koffi', { items: { contrat: { hash: 'h', rev: 1 } } });
}

describe('Supprimer un espace partagé', () => {
  it('l’espace est verrouillé, vidé, supprimé ; l’autre espace du compte est intact ; le carnet local et l’état publié l’oublient', async () => {
    await seed();
    expect(Object.keys(cloud.tenantItems).length).toBeGreaterThan(0);
    const result = unwrap(await service().deleteModule('alice', MODULE_A));
    expect(result.docsDeleted).toBeGreaterThan(3);
    expect(cloud.modules[MODULE_A]).toBeUndefined();
    expect(Object.keys(cloud.members).filter((k) => k.startsWith(MODULE_A))).toEqual([]);
    expect(Object.keys(cloud.requests).filter((k) => k.startsWith(MODULE_A))).toEqual([]);
    expect(Object.keys(cloud.tenantItems).filter((k) => k.startsWith(MODULE_A))).toEqual([]);
    expect(Object.keys(cloud.records)).toEqual([]);
    expect(cloud.modules[MODULE_B]).toBeDefined(); // l'autre espace n'est pas touché
    expect((await listLocalModules()).owned.map((o) => o.moduleId)).toEqual([MODULE_B]);
    expect(await loadPublishedState(MODULE_A, 'koffi')).toEqual({ items: {} });
    // le locataire n'a plus accès
    as('koffi');
    await expect(cloud.as('koffi').getModule(MODULE_A)).rejects.toMatchObject({ code: 'permission' });
  });

  it('un espace qui n’est pas à soi n’est jamais supprimé (la suppression ne vise que SES espaces) ; un espace déjà supprimé est simplement oublié', async () => {
    await seed();
    as('mallory');
    expect((await service().deleteModule('mallory', MODULE_A)).ok).toBe(true); // rien à supprimer pour ce compte
    expect(cloud.modules[MODULE_A]).toBeDefined();
    expect(Object.keys(cloud.members).filter((k) => k.startsWith(MODULE_A))).toHaveLength(1);
    as('alice');
    unwrap(await service().deleteModule('alice', MODULE_A));
    expect(unwrap(await service().deleteModule('alice', MODULE_A))).toEqual({ docsDeleted: 0 }); // idempotent
  });

  it('suppression non terminée : l’espace reste VERROUILLÉ (les locataires n’y ont déjà plus accès), un message clair, et la reprise termine', async () => {
    await seed();
    let first = true;
    const failing = createSharedModulesService({
      enabled: () => true,
      backend: (uid: string) => cloud.as(uid),
      erasure: (uid: string) => {
        const base = cloud.erasure(uid);
        return { ...base, removeModuleDocs: async (id, paths) => (first ? ((first = false), Promise.reject(Object.assign(new Error('coupure'), { code: 'unavailable' }))) : base.removeModuleDocs(id, paths)) };
      },
      contracts: async () => [],
      now,
    });
    const failed = await failing.deleteModule('alice', MODULE_A);
    expect(failed).toEqual({ ok: false, message: 'La suppression n’est pas terminée : l’espace est verrouillé (vos locataires n’y ont déjà plus accès). Réessayez.' });
    expect(cloud.modules[MODULE_A].deletionLockedAt).toBeDefined();
    await expect(cloud.as('koffi').listTenantItems(MODULE_A, 'koffi')).rejects.toMatchObject({ code: 'permission' });
    expect((await listLocalModules()).owned.map((o) => o.moduleId)).toContain(MODULE_A); // pas oublié tant que ce n'est pas terminé
    unwrap(await failing.deleteModule('alice', MODULE_A));
    expect(cloud.modules[MODULE_A]).toBeUndefined();
  });

  it('gardes : drapeau fermé, adresse non vérifiée : rien n’est supprimé', async () => {
    await seed();
    const closed = createSharedModulesService({ enabled: () => false, erasure: (uid: string) => cloud.erasure(uid) });
    expect((await closed.deleteModule('alice', MODULE_A)).ok).toBe(false);
    setEmailVerified('alice', false);
    expect((await service().deleteModule('alice', MODULE_A)).ok).toBe(false);
    expect(cloud.modules[MODULE_A]).toBeDefined();
  });
});

describe('Quitter un espace : le nom saisi est retiré, la fiche d’accès reste', () => {
  it('le locataire qui quitte efface sa demande approuvée (nom saisi) ; la fiche reste « a quitté » ; une demande refusée n’est jamais effacée par son auteur', async () => {
    await seed();
    as('koffi');
    unwrap(await service().leave('koffi', MODULE_A));
    expect(cloud.requests[`${MODULE_A}/koffi`]).toBeUndefined(); // le nom « Koffi Mensah » n'est plus conservé
    expect(cloud.members[`${MODULE_A}/koffi`]).toMatchObject({ state: 'left', contractId: 'c1' }); // historique du propriétaire
    // la demande refusée d'Ama reste : elle bloque, et son auteur ne peut pas l'effacer
    as('ama');
    expect((await service().cancelRequest('ama', MODULE_A)).ok).toBe(false);
    expect(cloud.requests[`${MODULE_A}/ama`]).toMatchObject({ state: 'refused', label: 'Ama' });
    // le propriétaire voit toujours le départ, sans nom
    as('alice');
    const view = unwrap(await service().ownerView('alice', MODULE_A));
    expect(view.members).toMatchObject([{ uid: 'koffi', state: 'left' }]);
    expect(view.requests.map((r) => r.uid)).toEqual(['ama']);
  });
});

describe('Départ des espaces rejoints à la suppression du compte', () => {
  it('l’accès actif devient « quitté », les demandes en attente ou approuvées sont effacées, la demande refusée reste ; un échec est compté sans jamais lever', async () => {
    await seed();
    cloud.requests[`${MODULE_B}/koffi`] = { uid: 'koffi', state: 'pending', label: 'K', decidedBy: null, createdAt: 'x', updatedAt: 'x' };
    const report = await leaveJoinedModules(cloud.as('koffi'), 'koffi', [MODULE_A, MODULE_B, 'mod_zzzzzzzzzzzzzzzzzzzzzzzz'], now);
    expect(report).toEqual({ left: 1, erased: 2, failed: 0 }); // le module inexistant ne donne rien (lecture de SA fiche : absente)
    expect(cloud.members[`${MODULE_A}/koffi`].state).toBe('left');
    expect(cloud.requests[`${MODULE_A}/koffi`]).toBeUndefined();
    expect(cloud.requests[`${MODULE_B}/koffi`]).toBeUndefined();
    const refused = await leaveJoinedModules(cloud.as('ama'), 'ama', [MODULE_A], now);
    expect(refused).toEqual({ left: 0, erased: 0, failed: 0 });
    expect(cloud.requests[`${MODULE_A}/ama`]).toBeDefined();
    cloud.offline = true;
    expect(await leaveJoinedModules(cloud.as('koffi'), 'koffi', [MODULE_A], now)).toEqual({ left: 0, erased: 0, failed: 1 });
  });

  it('la composition de production ne bloque jamais la suppression du compte : carnet illisible → rien ne se passe, aucune exception', async () => {
    mockMemory.set('@formease/shared_modules@alice', '{ pas du json');
    await expect(leaveSharedSpacesBestEffort({} as never, 'alice')).resolves.toBeNull();
    mockMemory.clear();
    await expect(leaveSharedSpacesBestEffort({} as never, 'alice')).resolves.toEqual({ left: 0, erased: 0, failed: 0 });
  });

  it('la suppression du compte appelle ce départ AVANT l’effacement des données, sans en dépendre', () => {
    const api = read('services/firebase/accountDeletionApi.ts');
    expect(api.indexOf('leaveSharedSpacesBestEffort(getFirestoreDb(), uid)')).toBeGreaterThan(-1);
    expect(api.indexOf('leaveSharedSpacesBestEffort(getFirestoreDb(), uid)')).toBeLessThan(api.indexOf('createCloudDeletion(getFirestoreDb())(uid)'));
    expect(read('services/firebase/sharedSpacesDeparture.ts')).toMatch(/catch \{\s*return null;/);
  });
});
