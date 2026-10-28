// F4 — effacement des espaces partagés avec le compte propriétaire : verrou, vidage dans l'ordre, vérification serveur, reprise, délai, et intégration à la suppression
// de compte (le compte est conservé tant que les espaces ne sont pas tous effacés). Cloud en mémoire qui applique la politique de référence ; aucun SDK, aucun réseau.

import fs from 'fs';
import path from 'path';
import type { CloudDeletionReport } from '../accountDeletionService';
import { deleteAccountCloudDataWithSync } from '../firebase/accountCloudErasure';
import { eraseOwnedModules, type ModuleErasureBackend } from '../firebase/moduleErasure';
import type { ErasureBackend } from '../firebase/syncAccountErasure';
import { setSyncAccount } from '../sync/syncAccount';
import { forgetSyncAccountState } from '../sync/syncAccountCleanup';
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

const root = path.join(__dirname, '..', '..');
const A = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'mod_bbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = 'mod_cccccccccccccccccccccccc';
const STAMP = '2026-10-01T09:00:00.000Z';

let cloud: MemoryModulesCloud;
beforeEach(() => {
  mockMemory.clear();
  cloud = createMemoryModulesCloud(() => new Date('2026-10-21T12:00:00.000Z'));
  const module = (id: string, ownerUid: string) => void (cloud.modules[id] = { ownerUid, type: 'immobilier', name: id, createdAt: STAMP, schemaVersion: 1 });
  module(A, 'alice');
  module(B, 'alice');
  module(OTHER, 'bob');
  for (const id of [A, B, OTHER]) {
    for (const uid of ['koffi', 'ama']) {
      cloud.members[`${id}/${uid}`] = { uid, role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: cloud.modules[id].ownerUid, createdAt: STAMP, updatedAt: STAMP };
      cloud.requests[`${id}/${uid}`] = { uid, state: 'approved', label: uid, decidedBy: cloud.modules[id].ownerUid, createdAt: STAMP, updatedAt: STAMP };
      cloud.tenantItems[`${id}/${uid}/contrat`] = { kind: 'contrat', body: { loyerMensuel: 1 }, rev: 1, updatedAt: STAMP };
      cloud.tenantItems[`${id}/${uid}/paiement_p1`] = { kind: 'paiement', body: { mois: '2026-08' }, rev: 1, updatedAt: STAMP };
    }
    cloud.requests[`${id}/pending`] = { uid: 'pending', state: 'pending', label: null, decidedBy: null, createdAt: STAMP, updatedAt: STAMP };
    cloud.records[`${id}/r1`] = { kind: 'immobilier.bien', ownerUid: cloud.modules[id].ownerUid, rev: 1, deleted: false };
    cloud.records[`${id}/r2`] = { kind: 'immobilier.paiement', ownerUid: cloud.modules[id].ownerUid, rev: 1, deleted: false };
  }
});

const keysOf = (id: string) => [...Object.keys(cloud.members), ...Object.keys(cloud.requests), ...Object.keys(cloud.tenantItems), ...Object.keys(cloud.records)].filter((k) => k.startsWith(`${id}/`));
const wrap = (base: ModuleErasureBackend, over: Partial<ModuleErasureBackend>): ModuleErasureBackend => ({ ...base, ...over });

describe('Effacement des espaces partagés du compte', () => {
  it('chaque espace est verrouillé, vidé, vérifié puis supprimé ; l’espace d’un autre compte n’est jamais touché', async () => {
    const report = await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice', pageSize: 3 });
    expect(report).toMatchObject({ status: 'purged', modules: 2, deleted: 2, pending: [], error: null, uncertain: false });
    expect(report.docsDeleted).toBe(2 * (4 + 3 + 2 + 2)); // 4 vues, 3 demandes, 2 fiches, 2 données par espace
    expect(Object.keys(cloud.modules)).toEqual([OTHER]);
    expect(keysOf(A)).toEqual([]);
    expect(keysOf(B)).toEqual([]);
    expect(keysOf(OTHER)).toHaveLength(4 + 3 + 2 + 2); // intact
    expect(cloud.modules[OTHER].deletionLockedAt).toBeUndefined();
  });

  it('un compte sans espace partagé : rien à faire, aucune écriture', async () => {
    const writes = cloud.writes.length;
    expect(await eraseOwnedModules({ backend: cloud.erasure('carol'), uid: 'carol' })).toMatchObject({ status: 'none', modules: 0, deleted: 0, error: null });
    expect(cloud.writes.length).toBe(writes);
  });

  it('ordre : le verrou d’abord, puis les vues AVANT les fiches de membres et les demandes (les vues se retrouvent par elles), le module en dernier', async () => {
    const events: string[] = [];
    const base = cloud.erasure('alice');
    const spy = wrap(base, {
      lockModule: async (id, at) => (events.push(`lock:${id}`), base.lockModule(id, at)),
      removeModuleDocs: async (id, paths) => (events.push(...paths.map((p) => `rm:${id.slice(4, 5)}:${p[0]}`)), base.removeModuleDocs(id, paths)),
      deleteModule: async (id) => (events.push(`del:${id}`), base.deleteModule(id)),
    });
    await eraseOwnedModules({ backend: spy, uid: 'alice', pageSize: 2 });
    const forA = events.filter((e) => e === `lock:${A}` || e === `del:${A}` || e.startsWith('rm:a:'));
    expect(forA[0]).toBe(`lock:${A}`);
    expect(forA[forA.length - 1]).toBe(`del:${A}`);
    const firstOf = (kind: string) => forA.findIndex((e) => e === `rm:a:${kind}`);
    const lastOf = (kind: string) => forA.map((e) => e === `rm:a:${kind}`).lastIndexOf(true);
    expect(lastOf('tenantViews')).toBeLessThan(firstOf('syncRecords'));
    expect(lastOf('tenantViews')).toBeLessThan(firstOf('members'));
    expect(lastOf('tenantViews')).toBeLessThan(firstOf('requests'));
  });

  it('sous verrou, les locataires perdent leur lecture immédiatement et plus rien ne s’écrit ; une panne en cours de route laisse un état sûr et la reprise termine', async () => {
    let calls = 0;
    const base = cloud.erasure('alice');
    const flaky = wrap(base, {
      removeModuleDocs: async (id, paths) => {
        calls += 1;
        if (calls === 3) throw Object.assign(new Error('réseau'), { code: 'unavailable' });
        return base.removeModuleDocs(id, paths);
      },
    });
    const first = await eraseOwnedModules({ backend: flaky, uid: 'alice', pageSize: 2 });
    expect(first.status).toBe('incomplete');
    expect(first.pending).toEqual([A]); // B n'est pas touché par l'échec de A… et A reste verrouillé
    expect(first.error).toMatchObject({ code: 'unavailable' });
    expect(cloud.modules[A].deletionLockedAt).toBeDefined();
    // le verrou ferme : un locataire ne lit plus, l'ancien propriétaire non plus n'écrit plus
    await expect(cloud.as('koffi').getModule(A)).rejects.toMatchObject({ code: 'permission' });
    await expect(cloud.as('koffi').listTenantItems(A, 'koffi')).rejects.toMatchObject({ code: 'permission' });
    await expect(cloud.as('alice').renameModule(A, 'Autre')).rejects.toMatchObject({ code: 'permission' });
    await expect(cloud.as('alice').putTenantItems(A, 'koffi', [{ id: 'contrat', doc: { kind: 'contrat', body: { loyerMensuel: 2 }, rev: 2, updatedAt: STAMP } }])).rejects.toMatchObject({ code: 'permission' });
    // la reprise relit le serveur et termine, sans rien refaire d'inutile
    const second = await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice', pageSize: 2 });
    expect(second).toMatchObject({ status: 'purged', error: null, pending: [] });
    expect(Object.keys(cloud.modules)).toEqual([OTHER]);
    // une troisième passe : plus rien
    expect(await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice' })).toMatchObject({ status: 'none' });
  });

  it('un verrou non confirmé par le serveur : rien n’est supprimé ; une liste qui ne se vide pas : jamais de suppression du module', async () => {
    const base = cloud.erasure('alice');
    const unlocked = wrap(base, { lockModule: async () => undefined });
    const a = await eraseOwnedModules({ backend: unlocked, uid: 'alice' });
    expect(a.status).toBe('incomplete');
    expect(a.error).toMatchObject({ code: 'lock-unconfirmed' });
    expect(keysOf(A).length).toBeGreaterThan(0);
    expect(cloud.modules[A]).toBeDefined();
    const stuck = wrap(base, { removeModuleDocs: async () => undefined }); // « supprime » sans rien supprimer
    const b = await eraseOwnedModules({ backend: stuck, uid: 'alice' });
    expect(b.status).toBe('incomplete');
    expect(b.error).toMatchObject({ code: 'no-progress' });
    expect(cloud.modules[A]).toBeDefined(); // vidé ? non : jamais supprimé
  });

  it('un module dont la propriété n’est pas démontrée n’est jamais touché ; l’échec d’un module ne bloque pas les autres ; l’ensemble reste « non terminé »', async () => {
    const base = cloud.erasure('alice');
    // la liste renvoie A, mais la lecture serveur dit que son propriétaire est un autre compte
    const lying = wrap(base, { readModule: async (id) => (id === A ? { exists: true, ownerUid: 'mallory', locked: false } : base.readModule(id)) });
    const report = await eraseOwnedModules({ backend: lying, uid: 'alice' });
    expect(report.status).toBe('unproven');
    expect(report.pending).toEqual([A]);
    expect(report.deleted).toBe(1); // B est bien effacé
    expect(keysOf(A).length).toBeGreaterThan(0);
    expect(cloud.modules[A].deletionLockedAt).toBeUndefined();
    expect(cloud.modules[B]).toBeUndefined();
  });

  it('hors ligne : rapport « non terminé », rien n’est supprimé, aucune exception ; un délai dépassé marque le résultat comme incertain', async () => {
    cloud.offline = true;
    const offline = await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice' });
    expect(offline).toMatchObject({ status: 'incomplete', modules: 0 });
    expect(offline.error).not.toBeNull();
    cloud.offline = false;
    const hanging = wrap(cloud.erasure('alice'), { lockModule: () => new Promise(() => undefined) });
    const slow = await eraseOwnedModules({ backend: hanging, uid: 'alice', timeoutMs: 20 });
    expect(slow.uncertain).toBe(true);
    expect(slow.status).toBe('incomplete');
    expect(await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: '' })).toMatchObject({ status: 'incomplete', error: { code: 'no-account' } });
  });

  it('durée maximale d’une tentative : arrêt propre, reprise possible', async () => {
    let t = 0;
    const report = await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice', pageSize: 1, deadlineMs: 5, now: () => (t += 3) });
    expect(report.status).toBe('incomplete');
    expect(report.error).toMatchObject({ code: 'deadline' });
    expect(await eraseOwnedModules({ backend: cloud.erasure('alice'), uid: 'alice' })).toMatchObject({ status: 'purged' });
  });
});

// ============================================================================================================================
describe('Dans la suppression du compte', () => {
  const restReport: CloudDeletionReport = { ownership: 'proven', records: { found: 0, deleted: 0, remaining: 0 }, space: 'deleted', profile: 'deleted', verified: true, uncertain: false, error: null };
  const spaceAbsent: ErasureBackend = { readSpace: async () => ({ exists: false, ownerUid: null, memberUids: [], locked: false }), lockSpace: async () => undefined, listSyncIds: async () => [], removeSyncDocs: async () => undefined };

  it('espaces effacés : le reste est lancé, le rapport est vérifié et porte le détail des espaces', async () => {
    const deleteRest = jest.fn(async () => restReport);
    const report = await deleteAccountCloudDataWithSync('alice', { backend: spaceAbsent, deleteRest, modules: cloud.erasure('alice') });
    expect(deleteRest).toHaveBeenCalledTimes(1);
    expect(report.verified).toBe(true);
    expect(report.modules).toEqual({ status: 'purged', modules: 2, deleted: 2, docsDeleted: 2 * 11, pending: 0 });
    expect(Object.keys(cloud.modules)).toEqual([OTHER]);
  });

  it('espaces NON effacés : le reste n’est PAS lancé, le rapport n’est pas vérifié, le compte est conservé et la reprise est possible', async () => {
    const deleteRest = jest.fn(async () => restReport);
    const base = cloud.erasure('alice');
    const failing = wrap(base, { removeModuleDocs: async () => { throw Object.assign(new Error('coupure'), { code: 'unavailable' }); } });
    const report = await deleteAccountCloudDataWithSync('alice', { backend: spaceAbsent, deleteRest, modules: failing });
    expect(deleteRest).not.toHaveBeenCalled();
    expect(report).toMatchObject({ verified: false, space: 'skipped', profile: 'skipped', error: { code: 'unavailable' }, modules: { status: 'incomplete', pending: 2 } });
    // reprise : tout se termine
    const again = await deleteAccountCloudDataWithSync('alice', { backend: spaceAbsent, deleteRest, modules: cloud.erasure('alice') });
    expect(again.verified).toBe(true);
    expect(deleteRest).toHaveBeenCalledTimes(1);
  });

  it('sans espaces partagés ni port : comportement d’avant, inchangé (aucun champ « modules »)', async () => {
    const deleteRest = jest.fn(async () => restReport);
    const without = await deleteAccountCloudDataWithSync('alice', { backend: spaceAbsent, deleteRest });
    expect(without).not.toHaveProperty('modules');
    const none = await deleteAccountCloudDataWithSync('carol', { backend: spaceAbsent, deleteRest, modules: cloud.erasure('carol') });
    expect(none.verified).toBe(true);
    expect(none.modules).toMatchObject({ status: 'none', modules: 0 });
  });

  it('le carnet local des espaces partagés est oublié avec le compte (aucune donnée d’Immobilier n’y figure) ; celui d’un autre compte est intact', async () => {
    setSyncAccount('alice');
    for (const base of ['shared_modules', 'tenant_view_published', 'tenant_view_received']) {
      mockMemory.set(`@formease/${base}@alice`, '{"schemaVersion":1}');
      mockMemory.set(`@formease/${base}@bob`, '{"schemaVersion":1}');
    }
    const result = await forgetSyncAccountState('alice');
    expect(result.removedStores).toBe(3);
    expect([...mockMemory.keys()].filter((k) => k.endsWith('@alice'))).toEqual([]);
    expect([...mockMemory.keys()].filter((k) => k.endsWith('@bob'))).toHaveLength(3);
    setSyncAccount(null);
  });
});

describe('Structure', () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

  it('la procédure est pure (aucun SDK) ; la composition de production la lance AVANT le reste ; les règles n’autorisent la suppression que sous verrou', () => {
    const imports = read('services/firebase/moduleErasure.ts').split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');
    expect(imports).toBe('');
    const compose = read('services/firebase/accountCloudErasure.ts');
    expect(compose.indexOf('eraseOwnedModules(')).toBeGreaterThan(-1);
    expect(compose.indexOf('eraseOwnedModules(')).toBeLessThan(compose.indexOf('eraseAccountCloudData({'));
    expect(read('services/firebase/cloudDeletionComposition.ts')).toContain('createFirestoreModuleErasureBackend(db, uid)');
    expect(read('firestore.p5.rules')).toContain('allow delete: if isOwner() && moduleLocked();');
  });
});
