// P5 — restauration cloud EXPLICITE reliée au moteur : opération `restore` de la file, résolution « garder la version locale » des conflits
// de suppression, protections financières, historique des versions rejetées, modèle de lecture pour l'interface. Cloud en mémoire :
// aucun SDK, aucun réseau, aucun compte.

import * as dbModule from '../db';
import { records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { collectSyncableItems } from '../sync/changeScanner';
import { resolveConflict, restoreTombstone, runInbound, type InboundEnv } from '../sync/inbound';
import { conflictStore, tombstoneStore, type ConflictRecord } from '../sync/inboundStores';
import { availableResolutions, listOpenConflicts, listRecoverableDeletions, listResolvedConflicts, viewConflict } from '../sync/conflictView';
import { createDefaultApplier } from '../sync/localApplier';
import { KIND } from '../sync/kindRegistry';
import { applyChanges, baselineStore, coalesce, queueStore, RESTORED_PLACEHOLDER_HASH, validateOperation, validateQueue, type IncomingChange, type QueuedOperation, type QueueStore } from '../sync/syncQueue';
import { captureLocalChanges, enqueueChange, runOnce } from '../sync/syncEngine';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
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

const UID = 'alice';
const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T0 = new Date('2026-10-20T10:00:00.000Z');
const clock = () => T0;

interface Device {
  mem: Map<string, string>;
  cols: Record<string, unknown[]>;
}
const saveDevice = (): Device => ({ mem: new Map(mockMemory), cols: snapshotCollections() });
function loadDevice(device: Device | null): void {
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  if (device) {
    for (const [key, value] of device.mem) mockMemory.set(key, value);
    for (const [name, list] of Object.entries(device.cols)) (dbModule as unknown as Record<string, unknown[]>)[name].push(...JSON.parse(JSON.stringify(list)));
  } else dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
}

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  await switchWorkspace('personal');
  loadDevice(null);
  setSyncAccount(UID);
});

const item = (id: string) => records.find((r) => r.id === id) as unknown as { id: string; values: Record<string, unknown> } | undefined;
const hashes = () => Object.fromEntries(collectSyncableItems(snapshotCollections()).items.map((i) => [i.id, i.hash]));
const transportFor = (cloud: MemoryCloud) => createFirestoreSyncTransport({ backend: cloud.backend, uid: UID, now: clock });
const push = async (cloud: MemoryCloud, now: () => Date = clock) => {
  await captureLocalChanges({ scope: SCOPE, now: now() });
  return runOnce({ transport: transportFor(cloud), ownerUid: UID, now, random: () => 0.5 });
};
const pull = (cloud: MemoryCloud) => runInbound({ pull: transportFor(cloud), ownerUid: UID, now: clock });
const env = (): InboundEnv => ({ ownerUid: UID, applier: createDefaultApplier(), now: T0 });
const ops = async () => (await queueStore.load()).ops;

/** A a créé et envoyé un bien ; B (appareil vide) l'a reçu. Retourne les deux états. */
async function twoDevices() {
  const cloud = createMemoryCloud({ uid: UID, start: new Date('2026-10-20T09:00:00.000Z') });
  const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
  expect((await push(cloud)).stopped).toBeNull();
  const a = saveDevice();
  loadDevice(null);
  expect((await pull(cloud)).applied).toEqual([bien.id]);
  const b = saveDevice();
  return { cloud, bien, a, b };
}

// ============================================================================================================================
describe('Opération « restauration » de la file', () => {
  const T = new Date('2026-10-20T10:00:00.000Z');
  const change = (op: IncomingChange['op'], baseRev = 0): IncomingChange => ({ recordId: 'r1', kind: KIND.IMMOBILIER_BIEN, op, baseRev, deletedAt: op === 'delete' ? T.toISOString() : undefined });
  const make = (existing: QueuedOperation | undefined, c: IncomingChange) => coalesce(existing, c, 'op-1', T);
  const first = (op: IncomingChange['op'], baseRev = 0) => make(undefined, change(op, baseRev))!;

  it('table de fusion : la restauration remplace une modification en attente ; le contenu part ensuite ; jamais au-dessus d’une suppression locale', () => {
    expect(first('restore', 4)).toMatchObject({ op: 'restore', baseRev: 4, deletedAt: null, block: null });
    const blocked: QueuedOperation = { ...first('update', 1), block: { reason: 'conflict', detail: 'x' }, nextRetryAt: 'x' };
    expect(make(blocked, change('restore', 2))).toMatchObject({ op: 'restore', baseRev: 2, block: null, nextRetryAt: null, opId: 'op-1' });
    expect(make(first('create'), change('restore', 2))?.op).toBe('restore');
    expect(make(first('delete'), change('restore', 2))?.op).toBe('delete');
    expect(make(first('restore', 2), change('update', 2))?.op).toBe('restore');
    expect(make(first('restore', 2), change('create'))?.op).toBe('restore');
    expect(make(first('restore', 2), change('delete'))).toBeNull(); // supprimé localement avant la restauration : rien à faire
  });

  it('validation : une restauration est valide sans horodatage de suppression ; la file qui en contient une reste lisible', () => {
    expect(validateOperation(first('restore', 3))).toEqual([]);
    expect(validateOperation({ ...first('restore', 3), deletedAt: 'x' })).toContain('horodatage de suppression sur une opération qui n’en est pas une');
    const queue: QueueStore = applyChanges({ schemaVersion: 1, seq: 0, nonce: 'q-abc', ops: {} }, [change('restore', 3)], T);
    expect(validateQueue(queue)).toEqual([]);
    expect(queue.ops.r1.opId).toBe('op-q-abc-1');
  });
});

// ============================================================================================================================
describe('Restauration explicite : garder la version locale d’un élément supprimé ailleurs', () => {
  it('modifié ici, supprimé ailleurs : restauration cloud puis envoi du contenu local ; l’autre appareil le retrouve', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    item(bien.id)!.values.nom = 'Locale A'; // modification locale non envoyée
    const a2 = saveDevice();
    loadDevice(b);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud); // B envoie la suppression (révision 2)
    const b2 = saveDevice();
    expect(cloud.docs.get(bien.id)).toMatchObject({ deleted: true, rev: 2 });

    loadDevice(a2);
    const report = await pull(cloud);
    expect(report.conflicts).toEqual([{ recordId: bien.id, type: 'update_vs_delete', fields: [] }]);
    const view = (await listOpenConflicts())[0];
    expect(view.options.keep_local).toMatchObject({ allowed: true });
    expect(view.options.keep_local.effect).toMatch(/RESTAURÉ/);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    expect((await conflictStore.load()).open[bien.id]).toBeUndefined();
    expect((await ops())[bien.id]).toMatchObject({ op: 'restore', baseRev: 2, deletedAt: null, block: null });
    expect(item(bien.id)!.values.nom).toBe('Locale A'); // rien n'est perdu localement

    // première passe : la restauration ; le cloud est rétabli avec son ancien contenu
    const restored = await push(cloud);
    expect(restored.confirmed).toEqual([bien.id]);
    expect(cloud.docs.get(bien.id)).toMatchObject({ deleted: false, deletedAt: null, rev: 3, body: { nom: 'Maison' } });
    expect(cloud.docs.get(bien.id)!.restoredAt).not.toBeNull();
    expect((await baselineStore.load()).entries[bien.id]).toMatchObject({ rev: 3, hash: RESTORED_PLACEHOLDER_HASH });
    // seconde passe : le contenu local part comme modification ordinaire
    expect((await push(cloud)).confirmed).toEqual([bien.id]);
    expect(cloud.docs.get(bien.id)).toMatchObject({ rev: 4, body: { nom: 'Locale A' } });
    expect((await ops())[bien.id]).toBeUndefined();
    const hashesA = hashes();

    // l'appareil B (qui avait supprimé) retrouve l'élément
    loadDevice(b2);
    expect((await pull(cloud)).applied).toEqual([bien.id]);
    expect(hashes()).toEqual(hashesA);

  });

  it('l’historique du conflit conserve la version locale ET la suppression distante (rien n’est perdu)', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    item(bien.id)!.values.nom = 'Locale A';
    const a2 = saveDevice();
    loadDevice(b);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud);
    loadDevice(a2);
    await pull(cloud);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    const history = (await listResolvedConflicts()) as ConflictRecord[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ recordId: bien.id, type: 'update_vs_delete', resolution: 'restauration cloud demandée (version locale conservée)' });
    expect(history[0].local?.body.nom).toBe('Locale A');
    expect(history[0].remote).toMatchObject({ deleted: true, rev: 2 });
    expect(history[0].base?.body.nom).toBe('Maison');
    expect(history[0].resolvedAt).not.toBeNull();
  });

  it('suppression reçue puis restaurée localement : « garder la version locale » restaure aussi le cloud ; l’autre appareil le retrouve', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud);
    const a2 = saveDevice();
    loadDevice(b);
    expect((await pull(cloud)).tombstoned).toEqual([bien.id]);
    expect((await listRecoverableDeletions()).map((d) => d.recordId)).toEqual([bien.id]);
    await restoreTombstone(bien.id, env());
    expect((await listOpenConflicts())[0]).toMatchObject({ type: 'restored_tombstone' });
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    expect((await ops())[bien.id]).toMatchObject({ op: 'restore', baseRev: 2 });
    expect((await push(cloud)).confirmed).toEqual([bien.id]);
    expect(cloud.docs.get(bien.id)).toMatchObject({ deleted: false, rev: 3 });
    await push(cloud);
    loadDevice(a2);
    expect((await pull(cloud)).applied).toEqual([bien.id]);
    expect(item(bien.id)).toBeDefined();
  });

  it('réponse perdue pendant la restauration : la reprise vérifie le cloud et confirme sans renvoyer', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    item(bien.id)!.values.nom = 'Locale A';
    const a2 = saveDevice();
    loadDevice(b);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud);
    loadDevice(a2);
    await pull(cloud);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    cloud.fail.lostResponse();
    const first = await push(cloud);
    expect(first.stopped).toBe('network');
    expect(cloud.docs.get(bien.id)).toMatchObject({ deleted: false, rev: 3 }); // validé côté serveur
    const commits = cloud.commits();
    const later = new Date(T0.getTime() + 3_600_000);
    const second = await runOnce({ transport: transportFor(cloud), ownerUid: UID, now: () => later, random: () => 0.5 });
    expect(second.confirmed).toEqual([bien.id]);
    expect(cloud.commits()).toBe(commits); // aucune seconde restauration
    expect((await baselineStore.load()).entries[bien.id]).toMatchObject({ rev: 3, hash: RESTORED_PLACEHOLDER_HASH });
  });

  it('le cloud a changé entre la décision et l’envoi : déjà restauré → confirmé ; supprimé à une autre révision → conflit retenu', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    item(bien.id)!.values.nom = 'Locale A';
    const a2 = saveDevice();
    loadDevice(b);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud);
    loadDevice(a2);
    await pull(cloud);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    const doc = cloud.docs.get(bien.id)!;
    // cas 1 : restauré ailleurs entre-temps
    cloud.docs.set(bien.id, { ...doc, deleted: false, deletedAt: null, rev: 3, restoredAt: 'ailleurs', lastOpId: 'autre' });
    const same = await push(cloud);
    expect(same.confirmed).toEqual([bien.id]);
    expect((await baselineStore.load()).entries[bien.id].rev).toBe(3);
  });

  it('le cloud a changé : supprimé de nouveau à une autre révision → conflit retenu, rien n’est envoyé', async () => {
    const { cloud, bien, a, b } = await twoDevices();
    loadDevice(a);
    item(bien.id)!.values.nom = 'Locale A';
    const a2 = saveDevice();
    loadDevice(b);
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await push(cloud);
    loadDevice(a2);
    await pull(cloud);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    const doc = cloud.docs.get(bien.id)!;
    cloud.docs.set(bien.id, { ...doc, rev: 5 }); // supprimé, mais à une autre révision que celle décidée
    const commits = cloud.commits();
    const report = await push(cloud);
    expect(report.conflicts).toEqual([bien.id]);
    expect(cloud.commits()).toBe(commits);
    expect((await ops())[bien.id]).toMatchObject({ op: 'restore', block: { reason: 'conflict' } });
    expect(cloud.docs.get(bien.id)).toMatchObject({ deleted: true, rev: 5 });
  });
});

// ============================================================================================================================
describe('Protections des faits financiers', () => {
  async function financialSetup() {
    const cloud = createMemoryCloud({ uid: UID, start: new Date('2026-10-20T09:00:00.000Z') });
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    expect((await push(cloud)).stopped).toBeNull();
    return { cloud, paiement };
  }

  it('une restauration ne contourne pas la politique : retenue par le moteur, refusée par le transport, cloud inchangé', async () => {
    const { cloud, paiement } = await financialSetup();
    await enqueueChange({ recordId: paiement.id, kind: KIND.IMMOBILIER_PAIEMENT, op: 'restore', baseRev: 1 }, T0);
    const before = cloud.commits();
    const report = await runOnce({ transport: transportFor(cloud), ownerUid: UID, now: clock, random: () => 0.5 });
    expect(report.blocked.find((x) => x.op.recordId === paiement.id)?.reason).toBe('financial_policy');
    expect(cloud.commits()).toBe(before);
    // même si la politique était levée, le transport refuse
    await expect(
      transportFor(cloud).push({ opId: 'x', recordId: paiement.id, kind: KIND.IMMOBILIER_PAIEMENT, op: 'restore', expectedRev: 1, deletedAt: null, wire: null }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(transportFor(cloud).restore({ opId: 'y', recordId: paiement.id, kind: KIND.IMMOBILIER_PAIEMENT, expectedRev: 1 })).rejects.toMatchObject({ code: 'invalid' });
    expect(cloud.docs.get(paiement.id)).toMatchObject({ rev: 1, deleted: false });
  });

  it('suppression distante d’un fait financier : aucune décision destructrice ni restauration ; le fait local reste intact', async () => {
    const { cloud, paiement } = await financialSetup();
    const doc = cloud.docs.get(paiement.id)!;
    cloud.docs.set(paiement.id, { ...doc, deleted: true, deletedAt: 'x', rev: 2, lastOpId: 'autre', serverUpdatedAt: '2026-10-20T09:30:00.000Z' }); // état anormal : les règles réelles l'interdisent
    const report = await pull(cloud);
    expect(report.conflicts).toEqual([expect.objectContaining({ recordId: paiement.id, type: 'financial_remote_delete' })]);
    const view = (await listOpenConflicts()).find((c) => c.recordId === paiement.id)!;
    expect(view.financial).toBe(true);
    for (const name of ['keep_local', 'keep_remote', 'fields'] as const) {
      expect(view.options[name].allowed).toBe(false);
      expect(view.options[name].reason).toBeTruthy();
    }
    for (const resolution of [{ type: 'keep_local' }, { type: 'keep_remote' }] as const) {
      await expect(resolveConflict(paiement.id, resolution, env())).rejects.toMatchObject({ code: 'unsupported' });
    }
    expect(item(paiement.id)).toBeDefined();
    expect((await ops())[paiement.id]).toBeUndefined();
    expect((await tombstoneStore.load()).items[paiement.id]).toBeUndefined();
  });
});

// ============================================================================================================================
describe('Modèle de lecture pour l’interface', () => {
  type Shape = Pick<ConflictRecord, 'kind' | 'local' | 'remote'>;
  const base: Shape = { kind: KIND.IMMOBILIER_BIEN, local: { body: { nom: 'L' }, refs: {}, statusKey: null }, remote: { rev: 2, deleted: false, deletedAt: null, wire: { id: 'x' } as never } };

  it('décisions offertes par type de conflit (miroir de la résolution)', () => {
    const o = (type: ConflictRecord['type'], over: Partial<Shape> = {}) => availableResolutions({ ...base, ...over, type });
    expect(o('both_modified')).toMatchObject({ keep_local: { allowed: true }, keep_remote: { allowed: true }, fields: { allowed: true } });
    expect(o('no_base')).toMatchObject({ fields: { allowed: true } });
    expect(o('delete_vs_update', { local: null })).toMatchObject({ keep_local: { allowed: true }, keep_remote: { allowed: true }, fields: { allowed: false } });
    const deletion = { remote: { rev: 2, deleted: true, deletedAt: 'x', wire: null } };
    expect(o('update_vs_delete', deletion)).toMatchObject({ keep_local: { allowed: true }, keep_remote: { allowed: true }, fields: { allowed: false } });
    expect(o('restored_tombstone', deletion)).toMatchObject({ keep_local: { allowed: true } });
    expect(o('financial_remote_change', { kind: KIND.IMMOBILIER_PAIEMENT })).toMatchObject({ keep_local: { allowed: true }, keep_remote: { allowed: true } });
    expect(o('financial_remote_change', { kind: KIND.IMMOBILIER_PAIEMENT }).keep_local.effect).toMatch(/correction explicite/);
    expect(o('update_vs_delete', { ...deletion, kind: KIND.IMMOBILIER_PAIEMENT }).keep_local.allowed).toBe(false);
    expect(o('financial_remote_delete', { ...deletion, kind: KIND.IMMOBILIER_PAIEMENT })).toMatchObject({ keep_local: { allowed: false }, keep_remote: { allowed: false }, fields: { allowed: false } });
    expect(o('both_modified', { local: null }).keep_local.allowed).toBe(false); // version introuvable : rien n'est proposé
  });

  it('la vue d’un conflit porte le libellé du type, le caractère financier et les trois versions', () => {
    const view = viewConflict({ ...base, recordId: 'r', type: 'both_modified', detectedAt: 'd', base: null, fields: ['nom'], resolvedAt: null, resolution: null, discarded: null });
    expect(view).toMatchObject({ recordId: 'r', kindLabel: 'Bien', financial: false, fields: ['nom'] });
    expect(view.options.keep_local.allowed).toBe(true);
  });
});
