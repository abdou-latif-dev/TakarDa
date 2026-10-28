// P5 — suppression de compte COMPLÈTE : documents de synchronisation purgés et vérifiés AVANT le reste, reprise après interruption, aucune
// suppression partielle présentée comme réussie. Orchestration réelle (`deleteAccount`) + cloud en mémoire : aucun SDK, aucun réseau.

import { deleteAccount, type AccountDeletionApi, type CloudDeletionReport, type LocalCleanup } from '../accountDeletionService';
import { deleteAccountCloudDataWithSync, toCloudDeletionReport } from '../firebase/accountCloudErasure';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { eraseAccountCloudData } from '../firebase/syncAccountErasure';
import { KIND } from '../sync/kindRegistry';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

const UID = 'alice';
let n = 0;

async function seed(cloud: MemoryCloud, count: number) {
  const t = createFirestoreSyncTransport({ backend: cloud.backend, uid: UID });
  for (let i = 0; i < count; i += 1) {
    const id = `r${i}`;
    await t.push({
      opId: `seed-${(n += 1)}`,
      recordId: id,
      kind: KIND.IMMOBILIER_BIEN,
      op: 'create',
      expectedRev: null,
      deletedAt: null,
      wire: { id, kind: KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: UID, statusKey: null, createdAt: 'a', updatedAt: 'a', body: { nom: id }, refs: {} },
    });
  }
}

const restReport = (over: Partial<CloudDeletionReport> = {}): CloudDeletionReport => ({
  ownership: 'proven',
  records: { found: 2, deleted: 2, remaining: 0 },
  space: 'deleted',
  profile: 'deleted',
  verified: true,
  uncertain: false,
  error: null,
  ...over,
});

function setup(count = 5, cloudOptions: Partial<Parameters<typeof createMemoryCloud>[0]> = {}) {
  const cloud = createMemoryCloud({ uid: UID, ...cloudOptions });
  const calls: string[] = [];
  let restResults: CloudDeletionReport[] = [];
  const deleteRest = jest.fn(async () => {
    calls.push('rest');
    return restResults.shift() ?? restReport();
  });
  const released: string[] = [];
  const local: LocalCleanup = { release: async (uid) => (released.push(uid), { released: 1 }) };
  const build = (extra: { timeoutMs?: number } = {}): AccountDeletionApi => ({
    reauthenticate: async () => void calls.push('reauth'),
    deleteCloudData: (uid) => deleteAccountCloudDataWithSync(uid, { backend: cloud.erasure, deleteRest, pageSize: 2, ...extra }),
    deleteAuthAccount: async () => void calls.push('auth'),
  });
  return { cloud, calls, deleteRest, released, local, build, ready: () => seed(cloud, count), restWill: (...r: CloudDeletionReport[]) => (restResults = r) };
}

describe('Suppression de compte : synchronisation purgée et vérifiée avant le reste', () => {
  it('parcours réel complet : réauthentification → purge de syncRecords (vérifiée) → reste → nettoyage local → compte', async () => {
    const t = setup(5);
    await t.ready();
    const outcome = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(outcome.status).toBe('completed');
    expect(t.calls).toEqual(['reauth', 'rest', 'auth']);
    expect(t.cloud.docs.size).toBe(0);
    expect(t.cloud.space.locked).toBe(true);
    expect(outcome.report?.syncRecords).toEqual({ status: 'purged', found: 5, deleted: 5, remaining: 0 });
    expect(outcome.report?.verified).toBe(true);
    expect(t.released).toEqual([UID]);
  });

  it('purge interrompue : « incomplète », compte et données locales conservés, le reste n’est pas touché ; la reprise termine', async () => {
    const t = setup(7);
    await t.ready();
    t.cloud.erasureFail.removeAfter(1);
    const first = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(first.status).toBe('cloud_incomplete');
    expect(t.calls).toEqual(['reauth']); // ni le reste, ni la suppression du compte
    expect(t.released).toEqual([]);
    expect(first.authDeleted).toBe(false);
    expect(first.report).toMatchObject({ verified: false, ownership: 'proven', space: 'skipped', profile: 'skipped', locked: true });
    expect(first.report?.syncRecords).toMatchObject({ status: 'incomplete', deleted: 2 });
    expect(first.message).toMatch(/2 document\(s\) de synchronisation supprimé\(s\)/);
    expect(t.cloud.docs.size).toBe(5);

    const second = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(second.status).toBe('completed');
    expect(second.report?.syncRecords).toMatchObject({ status: 'purged', found: 5, remaining: 0 });
    expect(t.cloud.docs.size).toBe(0);
    expect(t.calls).toEqual(['reauth', 'reauth', 'rest', 'auth']);
  });

  it('suppression « réussie » côté serveur mais documents toujours présents : jamais un succès', async () => {
    const t = setup(3);
    await t.ready();
    t.cloud.erasureFail.removalIgnored();
    const outcome = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(outcome.status).toBe('cloud_incomplete');
    expect(outcome.message).toMatch(/restent dans le cloud|synchronisation/);
    expect(t.calls).not.toContain('rest');
    expect(t.calls).not.toContain('auth');
  });

  it('le reste est interrompu APRÈS la purge : incomplète (pas de succès), puis reprise sans rien refaire d’inutile', async () => {
    const t = setup(3);
    await t.ready();
    t.restWill(restReport({ verified: false, space: 'unknown', error: { code: 'unavailable', message: 'réseau coupé' } }), restReport());
    const first = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(first.status).toBe('cloud_incomplete');
    expect(first.report?.syncRecords?.status).toBe('purged');
    expect(first.report?.verified).toBe(false);
    expect(t.calls).not.toContain('auth');
    const second = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(second.status).toBe('completed');
    expect(second.report?.syncRecords).toEqual({ status: 'purged', found: 0, deleted: 0, remaining: 0 });
    expect(t.deleteRest).toHaveBeenCalledTimes(2);
  });

  it('propriété non démontrée (autre propriétaire ou espace partagé) : RIEN n’est supprimé', async () => {
    for (const space of [{ ownerUid: 'bob' }, { memberUids: [UID, 'bob'] }]) {
      const t = setup(2, { space });
      await t.ready();
      const outcome = await deleteAccount(t.build(), UID, 'pw', t.local);
      expect(outcome.status).toBe('ownership_unproven');
      expect(t.cloud.docs.size).toBe(2);
      expect(t.cloud.space.locked).toBe(false);
      expect(t.calls).toEqual(['reauth']);
    }
  });

  it('serveur sans réponse : résultat INCERTAIN (jamais présumé), compte conservé', async () => {
    const t = setup(3);
    await t.ready();
    const slow = { ...t.cloud.erasure, listSyncIds: () => new Promise<string[]>(() => undefined) };
    const api: AccountDeletionApi = {
      reauthenticate: async () => undefined,
      deleteCloudData: (uid) => deleteAccountCloudDataWithSync(uid, { backend: slow, deleteRest: t.deleteRest, timeoutMs: 20 }),
      deleteAuthAccount: async () => void t.calls.push('auth'),
    };
    const outcome = await deleteAccount(api, UID, 'pw', t.local);
    expect(outcome.status).toBe('cloud_uncertain');
    expect(t.calls).not.toContain('auth');
    expect(t.cloud.docs.size).toBe(3);
  });

  it('après le verrou, aucune écriture de synchronisation ne peut recréer un document pendant la suppression', async () => {
    const t = setup(2);
    await t.ready();
    await deleteAccount(t.build(), UID, 'pw', t.local);
    await expect(seed(t.cloud, 1)).rejects.toMatchObject({ code: 'permission' });
    expect(t.cloud.docs.size).toBe(0);
  });
});

describe('Conversion du rapport d’effacement en rapport de suppression de compte', () => {
  const run = (rest: CloudDeletionReport | null, cloudOptions: Partial<Parameters<typeof createMemoryCloud>[0]> = {}) => {
    const cloud = createMemoryCloud({ uid: UID, ...cloudOptions });
    return eraseAccountCloudData({ backend: cloud.erasure, uid: UID, deleteRest: async () => rest ?? restReport() });
  };

  it('vérifié seulement si la synchronisation est purgée ET le reste vérifié', async () => {
    expect(toCloudDeletionReport(await run(restReport())).verified).toBe(true);
    const rest = toCloudDeletionReport(await run(restReport({ verified: false })));
    expect(rest.verified).toBe(false);
    expect(rest.syncRecords?.status).toBe('purged');
  });

  it('espace absent : le reste conclut, la synchronisation est signalée comme inatteignable (pas comme purgée)', async () => {
    const report = toCloudDeletionReport(await run(restReport({ ownership: 'space_absent', space: 'absent' }), { space: { exists: false, ownerUid: null, memberUids: [] } }));
    expect(report.syncRecords?.status).toBe('space_absent');
    expect(report.ownership).toBe('space_absent');
    expect(report.verified).toBe(true);
  });

  it('sans propriété démontrée : rapport « unproven », reste non lancé', async () => {
    const report = toCloudDeletionReport(await run(null, { space: { ownerUid: 'bob' } }));
    expect(report).toMatchObject({ ownership: 'unproven', verified: false, space: 'skipped', profile: 'skipped' });
  });
});

describe('Marqueur « compte supprimé » : posé AVANT toute suppression (protection contre un ancien jeton, test A6)', () => {
  const tombstoneOf = (calls: string[], result: 'created' | 'exists' | Error | 'never' = 'created') => ({
    mark: jest.fn(async () => {
      calls.push('tombstone');
      if (result instanceof Error) throw result;
      if (result === 'never') return new Promise<'created'>(() => undefined);
      return result;
    }),
  });
  const withTombstone = (t: ReturnType<typeof setup>, tombstone: ReturnType<typeof tombstoneOf>, extra: { timeoutMs?: number } = {}): AccountDeletionApi => ({
    reauthenticate: async () => void t.calls.push('reauth'),
    deleteCloudData: (uid) => deleteAccountCloudDataWithSync(uid, { backend: t.cloud.erasure, deleteRest: t.deleteRest, pageSize: 2, tombstone, ...extra }),
    deleteAuthAccount: async () => void t.calls.push('auth'),
  });

  it('ordre : réauthentification → marqueur → synchronisation et reste → compte ; le rapport le consigne', async () => {
    const t = setup(3);
    await t.ready();
    const outcome = await deleteAccount(withTombstone(t, tombstoneOf(t.calls)), UID, 'pw', t.local);
    expect(outcome.status).toBe('completed');
    expect(t.calls).toEqual(['reauth', 'tombstone', 'rest', 'auth']);
    expect(outcome.report?.tombstone).toBe('created');
    expect(t.cloud.docs.size).toBe(0);
  });

  it('marqueur impossible à poser : RIEN n’est supprimé, le compte est conservé, la suppression se reprend', async () => {
    const t = setup(3);
    await t.ready();
    const failing = tombstoneOf(t.calls, Object.assign(new Error('refusé'), { code: 'permission-denied' }));
    const outcome = await deleteAccount(withTombstone(t, failing), UID, 'pw', t.local);
    expect(outcome.status).toBe('cloud_incomplete');
    expect(outcome.report).toMatchObject({ tombstone: 'failed', verified: false, space: 'skipped', profile: 'skipped', error: { code: 'tombstone-failed' } });
    expect(t.calls).toEqual(['reauth', 'tombstone']); // ni synchronisation, ni reste, ni suppression du compte
    expect(t.cloud.docs.size).toBe(3); // aucun document touché
    expect(t.released).toEqual([]); // données locales non libérées
  });

  it('reprise : un marqueur déjà posé est constaté, la suppression continue', async () => {
    const t = setup(3);
    await t.ready();
    const outcome = await deleteAccount(withTombstone(t, tombstoneOf(t.calls, 'exists')), UID, 'pw', t.local);
    expect(outcome.status).toBe('completed');
    expect(outcome.report?.tombstone).toBe('exists');
  });

  it('pas de réponse du serveur : « incertain », rien n’est supprimé', async () => {
    const t = setup(3);
    await t.ready();
    const outcome = await deleteAccount(withTombstone(t, tombstoneOf(t.calls, 'never'), { timeoutMs: 30 }), UID, 'pw', t.local);
    expect(outcome.status).toBe('cloud_uncertain');
    expect(outcome.report?.tombstone).toBe('failed');
    expect(t.cloud.docs.size).toBe(3);
    expect(t.calls).toEqual(['reauth', 'tombstone']);
  });

  it('propriété de l’espace contredite : aucun marqueur irréversible, rien n’est touché (comme avant)', async () => {
    const t = setup(0, { space: { ownerUid: 'bob' } });
    const tombstone = tombstoneOf(t.calls);
    const outcome = await deleteAccount(withTombstone(t, tombstone), UID, 'pw', t.local);
    expect(tombstone.mark).not.toHaveBeenCalled();
    expect(outcome.status).toBe('ownership_unproven');
    expect(t.calls).toEqual(['reauth']);
  });

  it('espace déjà absent : le marqueur est quand même posé (c’est précisément le cas d’un compte déjà vidé que l’on veut protéger)', async () => {
    const t = setup(0, { space: { exists: false, ownerUid: null, memberUids: [] } });
    t.restWill({ ownership: 'space_absent', records: { found: 0, deleted: 0, remaining: 0 }, space: 'absent', profile: 'deleted', verified: true, uncertain: false, error: null });
    const outcome = await deleteAccount(withTombstone(t, tombstoneOf(t.calls)), UID, 'pw', t.local);
    expect(outcome.status).toBe('completed');
    expect(t.calls[1]).toBe('tombstone');
  });

  it('sans marqueur (essais contre d’anciennes règles) : comportement inchangé', async () => {
    const t = setup(2);
    await t.ready();
    const outcome = await deleteAccount(t.build(), UID, 'pw', t.local);
    expect(outcome.status).toBe('completed');
    expect(outcome.report?.tombstone).toBeUndefined();
  });
});
