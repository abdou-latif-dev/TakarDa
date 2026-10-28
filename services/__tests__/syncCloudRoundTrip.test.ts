// P4 — moteur local (envoi + réception) branché, DANS LES TESTS SEULEMENT, aux transports de synchronisation avec un cloud simulé en
// mémoire : deux « appareils » du même compte, suppressions, conflits, restauration, faits financiers, réponse perdue, isolation.
// Aucun SDK Firebase, aucun réseau, aucun compte, aucun branchement à l'application.

import * as dbModule from '../db';
import { records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { collectSyncableItems } from '../sync/changeScanner';
import { correctionStore, effectiveFinancialState, recordCorrection } from '../sync/financialCorrection';
import { resolveConflict, restoreTombstone, runInbound, type InboundEnv } from '../sync/inbound';
import { conflictStore, tombstoneStore } from '../sync/inboundStores';
import { createDefaultApplier } from '../sync/localApplier';
import { KIND } from '../sync/kindRegistry';
import { baselineStore, queueStore } from '../sync/syncQueue';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
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
const T0 = new Date('2026-10-19T10:00:00.000Z');
const clock = () => T0;

// ---- Deux appareils dans un seul processus : on sauvegarde / restaure l'état local (données + magasins de synchronisation) --------
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

const item = (id: string) => records.find((r) => r.id === id) as unknown as { id: string; values: Record<string, unknown> };
const hashes = () => Object.fromEntries(collectSyncableItems(snapshotCollections()).items.map((i) => [i.id, i.hash]));

function transportFor(cloud: MemoryCloud, uid = UID) {
  return createFirestoreSyncTransport({ backend: cloud.backend, uid, now: clock });
}
const push = async (cloud: MemoryCloud, uid = UID) => {
  setSyncAccount(uid);
  await captureLocalChanges({ scope: SCOPE, now: T0 });
  return runOnce({ transport: transportFor(cloud, uid), ownerUid: uid, now: clock, random: () => 0.5 });
};
const pull = (cloud: MemoryCloud, uid = UID) => (setSyncAccount(uid), runInbound({ pull: transportFor(cloud, uid), ownerUid: uid, now: clock }));
const env = (): InboundEnv => ({ ownerUid: UID, applier: createDefaultApplier(), now: T0 });

async function seedChain() {
  const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
  const { contrat, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  return { bien, logement, contrat, paiement };
}

/** Appareil A avec une chaîne complète déjà envoyée ; retourne l'état de A, puis B vide qui a tout reçu. */
async function twoDevices() {
  const cloud = createMemoryCloud({ uid: UID, start: new Date('2026-10-19T09:00:00.000Z') });
  const chain = await seedChain();
  const sent = await push(cloud);
  expect(sent.stopped).toBeNull();
  const a = saveDevice();
  loadDevice(null);
  const received = await pull(cloud);
  expect(received.stopped).toBeNull();
  const b = saveDevice();
  return { cloud, chain, a, b, sent, received };
}

// ============================================================================================================================
describe('Aller-retour complet entre deux appareils (cloud simulé)', () => {
  it('A envoie la chaîne Immobilier, B la reçoit à l’identique ; rien n’est renvoyé en écho', async () => {
    const { cloud, chain, a, received } = await twoDevices();
    expect(cloud.docs.size).toBeGreaterThanOrEqual(5);
    const kinds = [...cloud.docs.values()].map((d) => d.kind);
    for (const kind of [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_CONTRAT, KIND.IMMOBILIER_PAIEMENT, KIND.CORE_CONTACT]) expect(kinds).toContain(kind);
    expect(received.applied.length).toBe(cloud.docs.size);
    // même contenu métier des deux côtés (l'empreinte couvre type, contenu, références et statut)
    const hashesB = hashes();
    loadDevice(a);
    expect(hashesB).toEqual(hashes());
    expect(item(chain.bien.id).values.nom).toBe('Maison');
    // B ne renvoie rien : nombre de validations inchangé
    loadDevice(null);
    await pull(cloud);
    const before = cloud.commits();
    const run = await push(cloud);
    expect(run.confirmed).toEqual([]);
    expect(cloud.commits()).toBe(before);
  });

  it('modification sur B → reçue par A (sans conflit) ; modification de champs distincts des deux côtés → fusion, puis envoi du reste', async () => {
    const { cloud, chain, a, b } = await twoDevices();
    loadDevice(b);
    item(chain.bien.id).values.nom = 'Villa';
    expect((await push(cloud)).confirmed).toEqual([chain.bien.id]);
    const b2 = saveDevice();
    loadDevice(a);
    expect((await pull(cloud)).updated).toEqual([chain.bien.id]);
    expect(item(chain.bien.id).values.nom).toBe('Villa');
    // A et B modifient chacun un champ DIFFÉRENT
    item(chain.bien.id).values.adresse = 'Kara'; // A (pas encore envoyé)
    const a2 = saveDevice();
    loadDevice(b2);
    item(chain.bien.id).values.nom = 'Villa Bleue';
    await push(cloud); // B envoie la révision 3
    loadDevice(a2);
    const report = await pull(cloud);
    expect(report.merged).toEqual([chain.bien.id]);
    expect(item(chain.bien.id).values).toMatchObject({ nom: 'Villa Bleue', adresse: 'Kara' });
    expect((await push(cloud)).confirmed).toEqual([chain.bien.id]); // la partie locale part au-dessus de la révision distante
    const stored = cloud.docs.get(chain.bien.id)!;
    expect(stored).toMatchObject({ rev: 4, body: { nom: 'Villa Bleue', adresse: 'Kara' } });
  });

  it('même champ des deux côtés : conflit conservé, rien d’envoyé tant qu’il n’est pas résolu ; résolution puis convergence', async () => {
    const { cloud, chain, a, b } = await twoDevices();
    loadDevice(b);
    item(chain.bien.id).values.nom = 'Nom de B';
    await push(cloud);
    loadDevice(a);
    item(chain.bien.id).values.nom = 'Nom de A';
    const report = await pull(cloud);
    expect(report.conflicts).toEqual([{ recordId: chain.bien.id, type: 'both_modified', fields: ['nom'] }]);
    const before = cloud.commits();
    const run = await push(cloud);
    expect(cloud.commits()).toBe(before);
    expect(run.blocked.find((x) => x.op.recordId === chain.bien.id)?.reason).toBe('conflict');
    await resolveConflict(chain.bien.id, { type: 'keep_local' }, env());
    expect((await push(cloud)).confirmed).toEqual([chain.bien.id]);
    expect(cloud.docs.get(chain.bien.id)).toMatchObject({ body: { nom: 'Nom de A' }, rev: 3 });
    expect((await conflictStore.load()).history[0].discarded?.body.nom).toBe('Nom de B');
  });

  it('suppression logique sur A → B retire l’élément (copie conservée) ; restauration côté cloud → A le retrouve', async () => {
    const { cloud, a } = await twoDevices();
    loadDevice(a);
    const extra = await createBien({ nom: 'À supprimer', adresse: 'Sokodé' });
    await push(cloud);
    const a2 = saveDevice();
    loadDevice(null);
    await pull(cloud);
    expect(item(extra.id)).toBeDefined();
    const bFull = saveDevice();
    // A supprime localement, puis envoie la suppression
    loadDevice(a2);
    records.splice(records.findIndex((r) => r.id === extra.id), 1);
    expect((await push(cloud)).confirmed).toEqual([extra.id]);
    expect(cloud.docs.get(extra.id)).toMatchObject({ deleted: true, body: { nom: 'À supprimer' } }); // contenu conservé dans le cloud
    const a3 = saveDevice();
    // B reçoit la suppression : retrait logique, copie conservée
    loadDevice(bFull);
    const report = await pull(cloud);
    expect(report.tombstoned).toEqual([extra.id]);
    expect(item(extra.id)).toBeUndefined();
    expect((await tombstoneStore.load()).items[extra.id].snapshot).toMatchObject({ values: { nom: 'À supprimer' } });
    // aucun envoi en écho
    const commitsBefore = cloud.commits();
    await push(cloud);
    expect(cloud.commits()).toBe(commitsBefore);
    // restauration explicite côté cloud (opération prévue par le transport), puis réception
    const restored = await transportFor(cloud).restore({ opId: 'restore-1', recordId: extra.id, kind: KIND.IMMOBILIER_BIEN, expectedRev: 2 });
    expect(restored).toEqual({ rev: 3 });
    const bAfter = saveDevice();
    expect((await pull(cloud)).applied).toEqual([extra.id]); // B : élément recréé (la pierre tombale est dépassée)
    expect((await tombstoneStore.load()).items[extra.id].status).toBe('superseded');
    loadDevice(a3);
    expect((await pull(cloud)).applied).toEqual([extra.id]);
    expect(item(extra.id).values.nom).toBe('À supprimer');
    void bAfter;
  });

  it('restauration LOCALE d’une suppression reçue : conflit qui retient tout envoi (la restauration cloud reste explicite)', async () => {
    const { cloud, chain, a, b } = await twoDevices();
    const extra = await (async () => {
      loadDevice(a);
      const e = await createBien({ nom: 'Temporaire', adresse: 'X' });
      await push(cloud);
      return e;
    })();
    const a2 = saveDevice();
    loadDevice(b);
    await pull(cloud);
    const b2 = saveDevice();
    loadDevice(a2);
    records.splice(records.findIndex((r) => r.id === extra.id), 1);
    await push(cloud);
    loadDevice(b2);
    await pull(cloud);
    await restoreTombstone(extra.id, env());
    expect(item(extra.id)).toBeDefined();
    const before = cloud.commits();
    const run = await push(cloud);
    expect(cloud.commits()).toBe(before);
    expect(run.blocked.find((x) => x.op.recordId === extra.id)?.reason ?? 'aucune opération').toBeDefined();
    expect((await conflictStore.load()).open[extra.id].type).toBe('restored_tombstone');
    expect(chain.bien.id).toBeTruthy();
  });

  it('faits financiers : une modification locale reste retenue (jamais envoyée) ; la correction explicite est créée dans le cloud et reçue par l’autre appareil', async () => {
    const { cloud, chain, a, b } = await twoDevices();
    loadDevice(b);
    item(chain.paiement.id).values.montant = 1; // altération locale d'un paiement déjà confirmé
    const before = cloud.commits();
    const run = await push(cloud);
    expect(cloud.commits()).toBe(before);
    expect(run.blocked.find((x) => x.op.recordId === chain.paiement.id)?.reason).toBe('financial_policy');
    expect(cloud.docs.get(chain.paiement.id)!.body.montant).toBe(25000);
    // retour à l'état initial, puis annulation EXPLICITE (nouveau fait tracé)
    item(chain.paiement.id).values.montant = 25000;
    const c = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: chain.paiement.id, type: 'annulation', reason: 'Saisi deux fois', now: T0 });
    expect((await push(cloud)).confirmed).toContain(c.id);
    expect(cloud.docs.get(c.id)).toMatchObject({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, rev: 1, refs: { targetId: chain.paiement.id } });
    expect(cloud.docs.get(chain.paiement.id)).toMatchObject({ rev: 1, deleted: false }); // le paiement initial n'a pas bougé
    loadDevice(a);
    expect((await pull(cloud)).applied).toEqual([c.id]);
    const corrections = Object.values((await correctionStore.load()).items);
    expect(effectiveFinancialState(25000, corrections)).toMatchObject({ state: 'annulled', effectiveAmount: 0 });
  });

  it('réponse perdue : la reprise vérifie le cloud et confirme sans renvoyer (une seule écriture)', async () => {
    const cloud = createMemoryCloud({ uid: UID });
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    cloud.fail.lostResponse();
    const first = await runOnce({ transport: transportFor(cloud), ownerUid: UID, now: clock, random: () => 0.5 });
    expect(first.stopped).toBe('network');
    expect(cloud.docs.get(bien.id)!.rev).toBe(1); // le cloud a bien validé
    const commits = cloud.commits();
    const later = new Date(T0.getTime() + 3_600_000);
    const second = await runOnce({ transport: transportFor(cloud), ownerUid: UID, now: () => later, random: () => 0.5 });
    expect(second.confirmed).toEqual([bien.id]);
    expect(cloud.commits()).toBe(commits);
    expect((await queueStore.load()).ops[bien.id]).toBeUndefined();
    expect((await baselineStore.load()).entries[bien.id]).toMatchObject({ rev: 1 });
  });

  it('lecture interrompue : arrêt propre puis reprise sans perte ni doublon', async () => {
    const { cloud, b } = await twoDevices();
    loadDevice(b);
    const extra = await createBien({ nom: 'Nouveau', adresse: 'Y' });
    await push(cloud);
    const b2 = saveDevice();
    loadDevice(null);
    cloud.fail.reads(1);
    expect((await pull(cloud)).stopped).toBe('network');
    expect(records).toHaveLength(0);
    const ok = await pull(cloud);
    expect(ok.stopped).toBeNull();
    expect(item(extra.id)).toBeDefined();
    const count = records.length;
    expect((await pull(cloud)).applied).toEqual([]);
    expect(records).toHaveLength(count);
    void b2;
  });
});

// ============================================================================================================================
describe('Isolation des comptes et de l’espace de démonstration', () => {
  it('deux comptes ont deux espaces distincts ; un transport refuse le contenu d’un autre propriétaire ; une réception refuse un autre compte', async () => {
    const aliceCloud = createMemoryCloud({ uid: 'alice' });
    const bobCloud = createMemoryCloud({ uid: 'bob' });
    await createBien({ nom: 'De Alice', adresse: 'Lomé' });
    await push(aliceCloud, 'alice');
    expect(aliceCloud.docs.size).toBe(1);
    expect(bobCloud.docs.size).toBe(0);
    // Bob ne reçoit rien du cloud d'Alice : son espace est vide
    expect((await pull(bobCloud, 'bob')).applied).toEqual([]);
    // un contenu signé « alice » ne peut pas être écrit par le transport de Bob
    const wireOfAlice = [...aliceCloud.docs.entries()][0];
    await expect(
      transportFor(bobCloud, 'bob').push({ opId: 'x', recordId: wireOfAlice[0], kind: KIND.IMMOBILIER_BIEN, op: 'create', expectedRev: null, deletedAt: null, wire: { id: wireOfAlice[0], kind: KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: 'alice', statusKey: null, createdAt: 'a', updatedAt: 'a', body: {}, refs: {} } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    // un document d'un autre compte glissé dans l'espace de Bob est refusé à la réception
    bobCloud.docs.set(wireOfAlice[0], { ...wireOfAlice[1] });
    loadDevice(null);
    const report = await pull(bobCloud, 'bob');
    expect(report.applied).toEqual([]);
    expect(report.rejected[0].problems.join()).toContain('autre compte');
  });

  it('espace de démonstration : ni envoi, ni réception, aucun accès au cloud', async () => {
    const cloud = createMemoryCloud({ uid: UID });
    await switchWorkspace('demo');
    await expect(runOnce({ transport: transportFor(cloud), ownerUid: UID, now: clock })).rejects.toMatchObject({ code: 'demo_workspace' });
    await expect(runInbound({ pull: transportFor(cloud), ownerUid: UID, now: clock })).rejects.toMatchObject({ code: 'demo_workspace' });
    expect(cloud.log).toEqual([]);
    expect(cloud.docs.size).toBe(0);
  });
});
