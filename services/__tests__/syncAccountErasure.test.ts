// P4.1 — procédure d'effacement du compte côté cloud : `syncRecords` puis le reste. Backend EN MÉMOIRE, aucune connexion, aucun SDK,
// non branchée à l'application. Les règles réelles (suppression physique seulement sous verrou) sont vérifiées par le test d'émulateur
// et par le test du projet de test (non exécutés ici).

import type { CloudDeletionReport } from '../accountDeletionService';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { eraseAccountCloudData, ErasureTimeout } from '../firebase/syncAccountErasure';
import { KIND } from '../sync/kindRegistry';
import type { WireRecord } from '../sync/wireFormat';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

const UID = 'alice';
const wire = (id: string): WireRecord => ({ id, kind: KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: UID, statusKey: null, createdAt: 'a', updatedAt: 'a', body: { nom: id }, refs: {} });
let n = 0;

async function seed(cloud: MemoryCloud, count: number) {
  const t = createFirestoreSyncTransport({ backend: cloud.backend, uid: UID });
  for (let i = 0; i < count; i += 1) {
    const id = `r${i}`;
    await t.push({ opId: `seed-${(n += 1)}`, recordId: id, kind: KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: wire(id) });
  }
}

const rest = (over: Partial<CloudDeletionReport> = {}): CloudDeletionReport => ({
  ownership: 'proven',
  records: { found: 2, deleted: 2, remaining: 0 },
  space: 'deleted',
  profile: 'deleted',
  verified: true,
  uncertain: false,
  error: null,
  ...over,
});

function setup(count = 5, options: Partial<Parameters<typeof createMemoryCloud>[0]> = {}) {
  const cloud = createMemoryCloud({ uid: UID, ...options });
  const calls: string[] = [];
  const deleteRest = jest.fn(async () => {
    calls.push('rest');
    return rest();
  });
  const run = (extra: Partial<Parameters<typeof eraseAccountCloudData>[0]> = {}) => eraseAccountCloudData({ backend: cloud.erasure, uid: UID, deleteRest, pageSize: 2, ...extra });
  return { cloud, deleteRest, calls, run, ready: () => seed(cloud, count) };
}

describe('Effacement du compte : documents de synchronisation puis le reste', () => {
  it('ordre : propriété → verrou → purge de syncRecords → vérification → reste (records, espace, profil)', async () => {
    const { cloud, run, ready, deleteRest } = setup(5);
    await ready();
    expect(cloud.space.locked).toBe(false);
    const report = await run();
    expect(report).toMatchObject({ locked: true, verified: true, uncertain: false, orphansPossible: false, error: null });
    expect(report.syncRecords).toEqual({ status: 'purged', found: 5, deleted: 5, remaining: 0 });
    expect(cloud.space.locked).toBe(true);
    expect(cloud.docs.size).toBe(0);
    expect(deleteRest).toHaveBeenCalledTimes(1);
    expect(report.rest?.verified).toBe(true);
  });

  it('espace sans documents de synchronisation : verrou posé, rien à supprimer, le reste est traité', async () => {
    const { run, deleteRest } = setup(0);
    const report = await run();
    expect(report.syncRecords).toEqual({ status: 'purged', found: 0, deleted: 0, remaining: 0 });
    expect(report.verified).toBe(true);
    expect(deleteRest).toHaveBeenCalled();
  });

  it('le reste n’est PAS lancé tant que syncRecords n’est pas confirmé vide (sinon des orphelins resteraient sous un espace supprimé)', async () => {
    const { cloud, run, ready, deleteRest } = setup(5);
    await ready();
    cloud.erasureFail.removalIgnored(); // le serveur répond « succès » mais les documents restent
    const report = await run();
    expect(report.syncRecords.status).toBe('incomplete');
    expect(report.error?.code).toBe('no-progress');
    expect(report.verified).toBe(false);
    expect(deleteRest).not.toHaveBeenCalled();
    expect(cloud.docs.size).toBe(5);
  });

  it('interruption (réseau) au milieu de la purge : arrêt propre, rien d’autre n’est touché ; la reprise termine sans refaire le verrou', async () => {
    const { cloud, run, ready, deleteRest } = setup(7);
    await ready();
    cloud.erasureFail.removeAfter(2); // deux lots de 2 réussissent, le troisième échoue
    const first = await run();
    expect(first.error?.code).toBeDefined();
    expect(first.syncRecords).toMatchObject({ status: 'incomplete', deleted: 4 });
    expect(first.verified).toBe(false);
    expect(deleteRest).not.toHaveBeenCalled();
    expect(cloud.docs.size).toBe(3);
    expect(cloud.space.locked).toBe(true);
    const second = await run(); // reprise
    expect(second.syncRecords).toMatchObject({ status: 'purged', found: 3, deleted: 3, remaining: 0 });
    expect(second).toMatchObject({ verified: true, error: null });
    expect(cloud.docs.size).toBe(0);
    expect(deleteRest).toHaveBeenCalledTimes(1);
  });

  it('interruption après la purge, pendant le reste : la reprise ne supprime plus rien de syncRecords et termine le reste', async () => {
    const { cloud, ready } = setup(3);
    await ready();
    let attempt = 0;
    const flaky = jest.fn(async () => {
      attempt += 1;
      return attempt === 1 ? rest({ verified: false, space: 'unknown', error: { code: 'unavailable', message: 'réseau coupé' } }) : rest();
    });
    const run = () => eraseAccountCloudData({ backend: cloud.erasure, uid: UID, deleteRest: flaky });
    const first = await run();
    expect(first.syncRecords.status).toBe('purged');
    expect(first.verified).toBe(false); // reste non vérifié : jamais un succès
    const second = await run();
    expect(second.syncRecords).toEqual({ status: 'purged', found: 0, deleted: 0, remaining: 0 });
    expect(second.verified).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('verrou non confirmé par le serveur : rien n’est supprimé ; échec de pose : erreur conservée', async () => {
    const a = setup(3);
    await a.ready();
    a.cloud.erasureFail.lockIgnored();
    const unconfirmed = await a.run();
    expect(unconfirmed.error?.code).toBe('lock-unconfirmed');
    expect(unconfirmed.locked).toBe(false);
    expect(a.cloud.docs.size).toBe(3);
    expect(a.deleteRest).not.toHaveBeenCalled();

    const b = setup(3);
    await b.ready();
    b.cloud.erasureFail.lockFails();
    const failed = await b.run();
    expect(failed.error?.code).toBeDefined();
    expect(failed.verified).toBe(false);
    expect(b.cloud.docs.size).toBe(3);
  });

  it('la suppression physique est impossible sans verrou (modèle des règles) : la procédure ne la tente qu’après confirmation', async () => {
    const { cloud, ready } = setup(2);
    await ready();
    await expect(cloud.erasure.removeSyncDocs(['r0'])).rejects.toThrow(/non verrouillé/);
    expect(cloud.docs.size).toBe(2);
  });

  it('propriété non démontrée (autre propriétaire ou espace partagé) : rien n’est touché', async () => {
    for (const space of [{ ownerUid: 'bob' }, { memberUids: [UID, 'bob'] }, { memberUids: [] as string[] }]) {
      const { cloud, run, ready, deleteRest } = setup(2, { space });
      await ready();
      const report = await run();
      expect(report.syncRecords.status).toBe('unproven');
      expect(report.verified).toBe(false);
      expect(cloud.space.locked).toBe(false);
      expect(cloud.docs.size).toBe(2);
      expect(deleteRest).not.toHaveBeenCalled();
    }
  });

  it('espace déjà absent (suppression ancienne ou interrompue) : le reste conclut ; des documents inatteignables sont signalés', async () => {
    const { run, deleteRest } = setup(0, { space: { exists: false, ownerUid: null, memberUids: [] } });
    const report = await run();
    expect(report.syncRecords.status).toBe('space_absent');
    expect(report.orphansPossible).toBe(true);
    expect(deleteRest).toHaveBeenCalled();
    expect(report.verified).toBe(true);
  });

  it('délai dépassé (réponse inconnue) : « incertain », rien n’est présumé ; durée maximale : arrêt propre', async () => {
    const { cloud, ready, deleteRest } = setup(3);
    await ready();
    const slow = { ...cloud.erasure, listSyncIds: () => new Promise<string[]>(() => undefined) };
    const timedOut = await eraseAccountCloudData({ backend: slow, uid: UID, deleteRest, timeoutMs: 20 });
    expect(timedOut.uncertain).toBe(true);
    expect(timedOut.error?.code).toBe('client-timeout');
    expect(timedOut.verified).toBe(false);
    expect(new ErasureTimeout('x', 1000).code).toBe('client-timeout');

    let clock = 0;
    const late = await eraseAccountCloudData({ backend: cloud.erasure, uid: UID, deleteRest, now: () => (clock += 400_000), deadlineMs: 300_000, pageSize: 1 });
    expect(late.error?.code).toBe('deadline');
    expect(late.verified).toBe(false);
    expect(cloud.docs.size).toBe(3);
  });

  it('sans compte : rien n’est fait', async () => {
    const { cloud, deleteRest } = setup(1);
    const report = await eraseAccountCloudData({ backend: cloud.erasure, uid: '', deleteRest });
    expect(report.error?.code).toBe('no-account');
    expect(deleteRest).not.toHaveBeenCalled();
  });

  it('après le verrou, plus aucune écriture de synchronisation n’est possible (aucun document ne réapparaît pendant la purge)', async () => {
    const { cloud, run, ready } = setup(3);
    await ready();
    await run();
    const t = createFirestoreSyncTransport({ backend: cloud.backend, uid: UID });
    await expect(t.push({ opId: 'late', recordId: 'late', kind: KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: wire('late') })).rejects.toMatchObject({ code: 'permission' });
    expect(cloud.docs.size).toBe(0);
  });
});
