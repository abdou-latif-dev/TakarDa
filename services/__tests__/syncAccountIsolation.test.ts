// P5 — isolation locale PAR COMPTE sur un même appareil : un compte ne consulte, ne capture, n'envoie ni ne reçoit par-dessus les données d'un
// autre compte. Deux comptes, deux clouds en mémoire, un seul appareil. Aucun SDK, aucun réseau, aucune migration.

import * as dbModule from '../db';
import { records } from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { visibleRecordsFor } from '../cloudVisibility';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { correctionStore, recordCorrection, CorrectionError } from '../sync/financialCorrection';
import { resolveConflict, restoreTombstone, runInbound, type InboundEnv } from '../sync/inbound';
import { conflictStore } from '../sync/inboundStores';
import { listOpenConflicts, listRecoverableDeletions, listResolvedConflicts } from '../sync/conflictView';
import { createDefaultApplier } from '../sync/localApplier';
import { KIND } from '../sync/kindRegistry';
import { ownershipStore } from '../sync/ownership';
import { accountChangePending, getSyncAccount, setSyncAccount, SyncAccountError } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { forgetSyncAccountState } from '../sync/syncAccountCleanup';
import { baselineStore, queueStore } from '../sync/syncQueue';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
import { buildWireRecord } from '../sync/wireFormat';
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

const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T0 = new Date('2026-10-21T10:00:00.000Z');
const clock = () => T0;

let alice: MemoryCloud;
let bob: MemoryCloud;
const cloudOf = (uid: string) => (uid === 'alice' ? alice : bob);

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  mockMemory.clear();
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount(null);
  alice = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-21T09:00:00.000Z') });
  bob = createMemoryCloud({ uid: 'bob', start: new Date('2026-10-21T09:00:00.000Z') });
});

const transportFor = (uid: string) => createFirestoreSyncTransport({ backend: cloudOf(uid).backend, uid, now: clock });
const as = (uid: string | null) => setSyncAccount(uid);
const capture = (uid?: string, scope = SCOPE) => captureLocalChanges({ scope, now: T0, ownerUid: uid });
const push = async (uid: string) => {
  as(uid);
  await capture(uid);
  return runOnce({ transport: transportFor(uid), ownerUid: uid, now: clock, random: () => 0.5 });
};
const pull = (uid: string) => (as(uid), runInbound({ pull: transportFor(uid), ownerUid: uid, now: clock }));
const env = (uid: string): InboundEnv => ({ ownerUid: uid, applier: createDefaultApplier(uid), now: T0 });
const ops = async () => (await queueStore.load()).ops;
const item = (id: string) => records.find((r) => r.id === id);

// ============================================================================================================================
describe('Sans compte actif, ou avec le mauvais compte : rien', () => {
  it('toutes les entrées du moteur refusent sans compte actif, avant tout accès aux données ou au cloud', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    expect(getSyncAccount()).toBeNull();
    await expect(capture()).rejects.toMatchObject({ code: 'no_account' });
    await expect(runOnce({ transport: transportFor('alice'), ownerUid: 'alice', now: clock })).rejects.toMatchObject({ code: 'no_account' });
    await expect(runInbound({ pull: transportFor('alice'), ownerUid: 'alice', now: clock })).rejects.toMatchObject({ code: 'no_account' });
    await expect(resolveConflict('x', { type: 'keep_local' }, { ownerUid: 'alice', applier: {} as never, now: T0 })).rejects.toBeInstanceOf(SyncAccountError);
    await expect(restoreTombstone('x', { ownerUid: 'alice', applier: {} as never, now: T0 })).rejects.toBeInstanceOf(SyncAccountError);
    expect(() => createDefaultApplier()).toThrow(SyncAccountError);
    await expect(queueStore.load()).rejects.toBeInstanceOf(SyncAccountError); // pas de repli sur une clé commune
    await expect(recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: 'x', type: 'annulation', reason: 'm' })).rejects.toMatchObject({ code: 'no_account' });
    expect(await listOpenConflicts()).toEqual([]);
    expect(await listResolvedConflicts()).toEqual([]);
    expect(await listRecoverableDeletions()).toEqual([]);
    expect(alice.log).toEqual([]);
    expect([...mockMemory.keys()].filter((k) => k.includes('sync_'))).toEqual([]); // rien n'a été écrit
  });

  it('le compte annoncé doit être le compte actif : aucun envoi ni réception au nom d’un autre', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    as('alice');
    await expect(capture('bob')).rejects.toMatchObject({ code: 'account_mismatch' });
    await expect(runOnce({ transport: transportFor('bob'), ownerUid: 'bob', now: clock })).rejects.toMatchObject({ code: 'account_mismatch' });
    await expect(runInbound({ pull: transportFor('bob'), ownerUid: 'bob', now: clock })).rejects.toMatchObject({ code: 'account_mismatch' });
    await expect(resolveConflict('x', { type: 'keep_local' }, env('bob'))).rejects.toBeInstanceOf(SyncAccountError);
    expect(bob.log).toEqual([]);
    expect(await ops()).toEqual({});
  });

  it('identifiant de compte inutilisable comme clé : refusé', () => {
    for (const bad of ['', '../x', 'a/b', 'a@b', 'a b', 'x'.repeat(129)]) expect(() => setSyncAccount(bad)).toThrow(SyncAccountError);
    expect(getSyncAccount()).toBeNull();
  });
});

// ============================================================================================================================
describe('Deux comptes sur le même appareil', () => {
  it('l’élément créé sous un compte n’est ni capturé ni envoyé par l’autre ; chacun a sa file et sa référence', async () => {
    const mine = await createBien({ nom: 'Bien d’Alice', adresse: 'Lomé' });
    expect((await push('alice')).confirmed).toEqual([mine.id]);
    expect(alice.docs.size).toBe(1);
    expect((await ownershipStore.load()).owners[mine.id]).toBe('alice');

    // Bob se connecte sur le même appareil : l'élément d'Alice n'est ni capturé, ni envoyé, ni dans sa file ou sa référence
    as('bob');
    const captured = await capture('bob');
    expect(captured.enqueued).toBe(0);
    expect(await ops()).toEqual({});
    expect((await runOnce({ transport: transportFor('bob'), ownerUid: 'bob', now: clock })).confirmed).toEqual([]);
    expect(bob.docs.size).toBe(0);
    expect(Object.keys((await baselineStore.load()).entries)).toEqual([]);

    // Bob crée le sien : seul celui-là part, vers SON cloud
    const his = await createBien({ nom: 'Bien de Bob', adresse: 'Kara' });
    expect((await push('bob')).confirmed).toEqual([his.id]);
    expect([...bob.docs.keys()]).toEqual([his.id]);
    expect([...alice.docs.keys()]).toEqual([mine.id]);

    // retour d'Alice : son état est intact, rien de Bob n'y apparaît
    as('alice');
    expect(Object.keys((await baselineStore.load()).entries)).toEqual([mine.id]);
    const again = await push('alice');
    expect(again.confirmed).toEqual([]);
    expect([...alice.docs.keys()]).toEqual([mine.id]);
  });

  it('une modification en attente d’Alice survit à la connexion de Bob et ne part jamais vers son cloud', async () => {
    const mine = await createBien({ nom: 'Bien d’Alice', adresse: 'Lomé' });
    await push('alice');
    (item(mine.id) as { values: Record<string, unknown> }).values.nom = 'Modifié';
    as('alice');
    await capture('alice');
    expect((await ops())[mine.id]).toMatchObject({ op: 'update' });
    // Bob se connecte puis se déconnecte : la file d'Alice reste là, intacte
    as('bob');
    expect(await ops()).toEqual({});
    await runOnce({ transport: transportFor('bob'), ownerUid: 'bob', now: clock });
    expect(bob.docs.size).toBe(0);
    as(null);
    as('alice'); // « réouverture de l'application » : le compte revient, son état est retrouvé
    expect((await ops())[mine.id]).toMatchObject({ op: 'update' });
    expect((await runOnce({ transport: transportFor('alice'), ownerUid: 'alice', now: clock, random: () => 0.5 })).confirmed).toEqual([mine.id]);
    expect(alice.docs.get(mine.id)).toMatchObject({ rev: 2, body: { nom: 'Modifié' } });
  });

  it('un élément reçu pour Alice porte sa marque ; Bob ne le voit pas, ne le capture pas, ne peut pas l’écraser ni le retirer', async () => {
    const bien = await createBien({ nom: 'Bien d’Alice', adresse: 'Lomé' });
    await push('alice');
    // appareil vide : Alice reçoit ses données
    for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
    dbModule.users.push(dbModule.defaultLocalUser());
    resetImmobilierToolCache();
    mockMemory.clear();
    expect((await pull('alice')).applied).toEqual([bien.id]);
    const received = item(bien.id) as unknown as { cloudOwnerUid?: string };
    expect(received.cloudOwnerUid).toBe('alice');
    expect((await ownershipStore.load()).owners[bien.id]).toBe('alice');

    // affichage : masqué pour un autre compte et sans compte (mécanisme V1), visible pour Alice
    expect(visibleRecordsFor(records, 'alice').some((r) => r.id === bien.id)).toBe(true);
    expect(visibleRecordsFor(records, 'bob').some((r) => r.id === bien.id)).toBe(false);
    expect(visibleRecordsFor(records, null).some((r) => r.id === bien.id)).toBe(false);

    // moteur de Bob : ni capture, ni vue, ni écriture
    as('bob');
    expect((await capture('bob')).enqueued).toBe(0);
    const applier = createDefaultApplier('bob');
    expect((await applier.snapshot()).some((i) => i.id === bien.id)).toBe(false);
    const wire = { ...buildWireRecord(KIND.IMMOBILIER_BIEN, item(bien.id) as never, 'bob'), id: bien.id, body: { nom: 'Écrasé' } };
    await expect(applier.upsert(wire)).rejects.toThrow(/autre compte/);
    await expect(applier.remove(KIND.IMMOBILIER_BIEN, bien.id)).rejects.toThrow(/autre compte/);
    await expect(applier.insert(KIND.IMMOBILIER_BIEN, { ...(item(bien.id) as object), id: 'autre' } as never)).resolves.toBeUndefined(); // un autre identifiant libre reste possible
    expect((item(bien.id) as unknown as { values: { nom: string } }).values.nom).toBe('Bien d’Alice');
    expect(bob.docs.size).toBe(0);
    // la réception de Bob ne voit pas non plus l'élément : un document de même identifiant venu de SON cloud est refusé
    bob.docs.set(bien.id, { ...alice.docs.get(bien.id)!, ownerUid: 'bob' });
    const report = await pull('bob');
    expect(report.applied).toEqual([]);
    expect((item(bien.id) as unknown as { values: { nom: string } }).values.nom).toBe('Bien d’Alice');
  });

  it('données anciennes (antérieures à l’activation) : jamais adoptées ni capturées, quel que soit le compte', async () => {
    await createBien({ nom: 'Ancien', adresse: 'Lomé' });
    const future = { enabledAt: '2999-01-01T00:00:00.000Z' };
    for (const uid of ['alice', 'bob']) {
      as(uid);
      const result = await capture(uid, future);
      expect(result.enqueued).toBe(0);
      expect(result.ignoredLegacy).toBeGreaterThan(0);
    }
    expect((await ownershipStore.load()).owners).toEqual({});
    expect(alice.docs.size + bob.docs.size).toBe(0);
  });

  it('corrections financières, conflits et suppressions reçues sont rangés par compte', async () => {
    as('alice');
    expect(Object.keys((await correctionStore.load()).items)).toEqual([]);
    await conflictStore.update((s) => ({ ...s, open: { x: { recordId: 'x', kind: KIND.IMMOBILIER_BIEN, type: 'both_modified', detectedAt: 'd', base: null, local: null, remote: { rev: 2, deleted: false, deletedAt: null, wire: null }, fields: [], resolvedAt: null, resolution: null, discarded: null } } }));
    expect((await listOpenConflicts()).map((c) => c.recordId)).toEqual(['x']);
    as('bob');
    expect(await listOpenConflicts()).toEqual([]);
    expect((await conflictStore.load()).open).toEqual({});
    as('alice');
    expect((await listOpenConflicts()).map((c) => c.recordId)).toEqual(['x']);
    expect(CorrectionError).toBeDefined();
  });
});

// ============================================================================================================================
describe('Changement de compte pendant une exécution', () => {
  it('déconnexion en cours d’envoi : différée, arrêt propre à l’opération suivante, rien n’est écrit dans un autre compte', async () => {
    const a = await createBien({ nom: 'Un', adresse: 'X' });
    const b = await createBien({ nom: 'Deux', adresse: 'Y' });
    as('alice');
    await capture('alice');
    const inner = transportFor('alice');
    let first = true;
    const transport = {
      ...inner,
      push: async (req: Parameters<typeof inner.push>[0]) => {
        const result = await inner.push(req);
        if (first) {
          first = false;
          expect(setSyncAccount(null)).toBe('deferred'); // l'utilisateur se déconnecte pendant l'exécution
          expect(getSyncAccount()).toBe('alice'); // le compte courant reste le sien jusqu'à la fin de l'exécution
          expect(accountChangePending()).toBe(true);
        }
        return result;
      },
    };
    const report = await runOnce({ transport, ownerUid: 'alice', now: clock, random: () => 0.5 });
    expect(report.stopped).toBe('account_changed');
    expect(report.confirmed).toHaveLength(1);
    expect(getSyncAccount()).toBeNull(); // appliqué à la fin
    expect(accountChangePending()).toBe(false);
    expect(alice.docs.size).toBe(1);
    // la file d'Alice garde l'autre opération, intacte ; aucun état d'Alice n'a fui vers un autre compte
    as('alice');
    expect(Object.keys(await ops())).toHaveLength(1);
    as('bob');
    expect(await ops()).toEqual({});
    expect([a.id, b.id]).toContain([...alice.docs.keys()][0]);
  });

  it('changement de compte en cours de réception : arrêt entre deux pages, curseur conservé pour le bon compte', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    await createBien({ nom: 'Deux', adresse: 'Y' });
    await push('alice');
    for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
    dbModule.users.push(dbModule.defaultLocalUser());
    resetImmobilierToolCache();
    mockMemory.clear();
    as('alice');
    const inner = transportFor('alice');
    let calls = 0;
    const pullTransport = {
      pull: async (request: Parameters<typeof inner.pull>[0]) => {
        calls += 1;
        if (calls === 1) setSyncAccount('bob'); // pendant la première page
        return inner.pull({ ...request, limit: 1 });
      },
    };
    const report = await runInbound({ pull: pullTransport, ownerUid: 'alice', now: clock });
    expect(report.stopped).toBe('account_changed');
    expect(report.applied).toHaveLength(1);
    expect(getSyncAccount()).toBe('bob');
    expect((await ops())).toEqual({});
    const cursorBob = [...mockMemory.keys()].filter((k) => k.includes('sync_inbound_cursor@bob'));
    const cursorAlice = [...mockMemory.keys()].filter((k) => k.includes('sync_inbound_cursor@alice'));
    expect(cursorBob).toEqual([]);
    expect(cursorAlice).toHaveLength(1);
  });
});

// ============================================================================================================================
describe('Suppression du compte : état technique oublié, données conservées', () => {
  it('retire file, référence, métadonnées, curseur et attente de CE compte ; garde données métier, corrections, conflits ; l’autre compte est intact', async () => {
    const mine = await createBien({ nom: 'Bien d’Alice', adresse: 'Lomé' });
    await push('alice');
    await pull('alice');
    const his = await createBien({ nom: 'Bien de Bob', adresse: 'Kara' });
    await push('bob');
    const keysBefore = [...mockMemory.keys()];
    expect(keysBefore.some((k) => k.endsWith('sync_baseline@alice'))).toBe(true);
    const businessBefore = JSON.stringify(snapshotCollections());

    const result = await forgetSyncAccountState('alice');
    expect(result.removedStores).toBeGreaterThanOrEqual(3);
    expect(result.releasedItems).toBe(1);
    for (const base of ['sync_queue', 'sync_baseline', 'sync_meta', 'sync_inbound_cursor', 'sync_inbound_pending']) expect([...mockMemory.keys()].some((k) => k.endsWith(`${base}@alice`))).toBe(false);
    expect(JSON.stringify(snapshotCollections())).toBe(businessBefore); // aucune donnée métier touchée
    expect((await ownershipStore.load()).owners).toEqual({ [his.id]: 'bob' }); // les éléments d'Alice redeviennent sans propriétaire (visibles)
    as('bob');
    expect(Object.keys((await baselineStore.load()).entries)).toEqual([his.id]); // l'autre compte est intact
    expect(item(mine.id)).toBeDefined();
  });

  it('dans la démonstration : rien à oublier', async () => {
    await switchWorkspace('demo');
    expect(await forgetSyncAccountState('alice')).toEqual({ removedStores: 0, releasedItems: 0 });
    await switchWorkspace('personal');
  });
});
