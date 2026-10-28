// P3 — réception, suppressions logiques, conflits, faits financiers, doublons, reprises. Tout est LOCAL : transports simulés en mémoire,
// aucun réseau, aucun SDK Firebase, aucun branchement à l'application.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { seedDemoTontine } from '../tontineDemoService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { collectSyncableItems, scanLogicalDuplicates } from '../sync/changeScanner';
import { correctionStore, correctionsOf, CorrectionError, effectiveFinancialState, recordCorrection } from '../sync/financialCorrection';
import {
  applyRemoteChanges,
  emptyInboundReport,
  releaseHeldDuplicate,
  resolveConflict,
  restoreTombstone,
  runInbound,
  validateRemoteChange,
  InboundError,
  type InboundEnv,
  type PullPage,
  type PullTransport,
} from '../sync/inbound';
import { conflictStore, cursorStore, pendingInboundStore, tombstoneStore, type RemoteChange } from '../sync/inboundStores';
import { createDefaultApplier, type LocalApplier } from '../sync/localApplier';
import { KIND, kindsToSync, type Kind } from '../sync/kindRegistry';
import { contentEquals, differingFields, mergeThreeWay } from '../sync/merge';
import { planOperations } from '../sync/syncPlanner';
import { baselineStore, queueStore, type BaselineContent } from '../sync/syncQueue';
import { captureLocalChanges, runOnce, SyncEngineError, SyncTransportError, type SyncTransport } from '../sync/syncEngine';
import { buildWireRecord, contentHash, contentOfWire, type WireRecord } from '../sync/wireFormat';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
const mockFail = { set: null as null | ((key: string) => boolean) };
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => {
      if (mockFail.set?.(key)) throw new Error('écriture impossible');
      mockMemory.set(key, value);
    },
    removeItem: async (key: string) => {
      mockMemory.delete(key);
    },
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T0 = new Date('2026-10-17T12:00:00.000Z');
const T1 = new Date('2026-10-17T13:00:00.000Z');
const OWNER = 'uid-test';

function freshApp() {
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
}

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  mockMemory.clear();
  mockFail.set = null;
  await switchWorkspace('personal');
  freshApp();
  setSyncAccount(OWNER);
  __useSyncScopeForTests(kindsToSync()); // moteur générique : types hors V1 inclus (le périmètre V1 est testé dans syncScope.test.ts)
});

const env = (applier: LocalApplier = createDefaultApplier(), now: Date = T1): InboundEnv => ({ ownerUid: OWNER, applier, now });
const clockAt = (d: Date) => () => d;

/** Cloud « qui accepte tout » : sert à établir la référence (contenu confirmé) avant de simuler un autre appareil. */
function acceptingTransport(log: string[] = []): SyncTransport {
  const revs = new Map<string, number>();
  return {
    async push(r) {
      log.push(`${r.op}:${r.recordId}`);
      const rev = (revs.get(r.recordId) ?? 0) + 1;
      revs.set(r.recordId, rev);
      return { rev };
    },
    async read() {
      return null;
    },
  };
}
const syncAll = async (log: string[] = []) => {
  await captureLocalChanges({ scope: SCOPE, now: T0 });
  return runOnce({ transport: acceptingTransport(log), ownerUid: OWNER, now: clockAt(T0), random: () => 0.5 });
};

const item = (id: string) => records.find((r) => r.id === id) as unknown as Record<string, unknown> & { values: Record<string, unknown> };
const wireOf = (kind: Kind, it: Record<string, unknown>, patch: Partial<WireRecord> & { values?: Record<string, unknown> } = {}): WireRecord => {
  const base = buildWireRecord(kind, it, OWNER);
  const { values, ...rest } = patch;
  return { ...base, ...rest, body: values ? { ...base.body, ...values } : base.body };
};
const upsert = (wire: WireRecord, rev: number): RemoteChange => ({ id: wire.id, kind: wire.kind, rev, deleted: false, deletedAt: null, wire });
const removal = (id: string, kind: Kind, rev: number): RemoteChange => ({ id, kind, rev, deleted: true, deletedAt: '2026-10-17T12:30:00.000Z', wire: null });
const apply = (changes: RemoteChange[], e: InboundEnv = env()) => applyRemoteChanges(changes, e);

async function seedChain() {
  const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
  const { contrat, contact, logement } = await createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: 'Chambre 1' },
    nom: 'Koffi',
    telephone: '90123456',
    loyerMensuel: 25000,
    dateEntree: new Date(2026, 0, 5),
    dernierLoyerPaye: '2026-09',
  });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  return { bien, logement, contrat, contact, paiement };
}
const baselineOf = async (id: string) => (await baselineStore.load()).entries[id];

// ============================================================================================================================
describe('Fusion à trois voies (pure)', () => {
  const c = (body: Record<string, unknown>, statusKey: string | null = null): BaselineContent => ({ body, refs: {}, statusKey });
  const base = c({ nom: 'A', adresse: 'X', note: 'n' });

  it('identique, ou une seule modification : jamais de conflit', () => {
    expect(mergeThreeWay(base, c({ nom: 'B', adresse: 'X', note: 'n' }), c({ nom: 'B', adresse: 'X', note: 'n' })).status).toBe('identical');
    const remoteOnly = mergeThreeWay(base, base, c({ nom: 'B', adresse: 'X', note: 'n' }));
    expect(remoteOnly).toMatchObject({ status: 'clean', fromRemote: ['nom'], keptLocal: [] });
    const localOnly = mergeThreeWay(base, c({ nom: 'A', adresse: 'Y', note: 'n' }), base);
    expect(localOnly).toMatchObject({ status: 'clean', keptLocal: ['adresse'] });
  });

  it('champs distincts : fusion sûre ; ajouts et retraits de champs compris', () => {
    const r = mergeThreeWay(base, c({ nom: 'A', adresse: 'Y', note: 'n' }), c({ nom: 'B', adresse: 'X' }));
    expect(r.status).toBe('clean');
    if (r.status === 'clean') expect(r.merged.body).toEqual({ nom: 'B', adresse: 'Y' });
  });

  it('même champ modifié différemment des deux côtés : conflit, aucune version choisie', () => {
    const r = mergeThreeWay(base, c({ nom: 'L', adresse: 'X', note: 'n' }), c({ nom: 'R', adresse: 'X', note: 'n' }));
    expect(r).toEqual({ status: 'conflict', fields: ['nom'] });
    expect(mergeThreeWay(base, c({ nom: 'A', adresse: 'X', note: 'n' }, 'a'), c({ nom: 'A', adresse: 'X', note: 'n' }, 'b'))).toEqual({ status: 'conflict', fields: ['@statut'] });
  });

  it('sans version de base : aucune fusion devinée', () => {
    expect(mergeThreeWay(undefined, c({ nom: 'L' }), c({ nom: 'R' })).status).toBe('no_base');
    expect(mergeThreeWay(null, c({ nom: 'L' }), c({ nom: 'L' })).status).toBe('identical');
  });

  it('objets imbriqués comparés en bloc, indépendamment de l’ordre des clés', () => {
    const b = c({ o: { a: 1, b: 2 } });
    expect(contentEquals(c({ o: { b: 2, a: 1 } }), b)).toBe(true);
    expect(mergeThreeWay(b, c({ o: { a: 9, b: 2 } }), c({ o: { a: 1, b: 7 } })).status).toBe('conflict');
    expect(differingFields(c({ a: 1, b: 2 }, 'x'), c({ a: 1, b: 3 }, 'y'))).toEqual(['@statut', 'b']);
  });
});

// ============================================================================================================================
describe('Validation des changements reçus', () => {
  it('refuse type inconnu, révision invalide, autre compte, champ réservé, référence non déclarée, contenu incohérent', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const good = upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never), 1);
    expect(validateRemoteChange(good, OWNER)).toEqual({ problems: [], newerSchema: false });
    const bad = (patch: Partial<RemoteChange>, wire?: Partial<WireRecord>) => validateRemoteChange({ ...good, ...patch, wire: wire ? { ...good.wire, ...wire } : good.wire }, OWNER).problems.join('|');
    expect(bad({ kind: 'immobilier.inconnu' })).toContain('type inconnu');
    expect(bad({ kind: KIND.CORE_OUTIL })).toContain('non synchronisable');
    expect(bad({ rev: 0 })).toContain('révision invalide');
    expect(bad({ rev: 1.5 })).toContain('révision invalide');
    expect(bad({}, { ownerUid: 'autre' })).toContain('autre compte');
    expect(bad({}, { id: 'autre-id' })).toContain('identifiant du contenu');
    expect(bad({}, { body: { ...good.wire!.body, toolId: 'x' } })).toContain('réservé à l’appareil');
    expect(bad({}, { refs: { inventee: 'x' } })).toContain('non déclarée');
    const logement = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'L' }, nom: 'K', telephone: '90123456', loyerMensuel: 1000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    const lw = wireOf(KIND.IMMOBILIER_LOGEMENT, logement.logement as never);
    expect(validateRemoteChange(upsert({ ...lw, refs: { bien: 'x' } }, 1), OWNER).problems.join()).toContain('incohérentes');
    expect(validateRemoteChange(null, OWNER).problems).toContain('changement illisible');
    expect(validateRemoteChange({ ...good, deleted: true, wire: null, deletedAt: null }, OWNER).problems).toContain('suppression sans horodatage');
    expect(validateRemoteChange({ ...good, wire: null }, OWNER).problems).toContain('contenu manquant');
  });

  it('une version de schéma plus récente est retenue, jamais appliquée à l’aveugle', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const wire = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'bien-futur', schemaVersion: 99 };
    expect(validateRemoteChange(upsert(wire, 1), OWNER).newerSchema).toBe(true);
    const report = await apply([upsert(wire, 1)]);
    expect(report.deferred).toEqual([expect.objectContaining({ recordId: 'bien-futur', reason: 'newer_schema' })]);
    expect(item('bien-futur')).toBeUndefined();
    expect((await pendingInboundStore.load()).items['bien-futur'].reason).toBe('newer_schema');
  });

  it('un changement invalide est signalé et conservé pour diagnostic, sans rien écrire dans les données', async () => {
    const before = JSON.stringify(snapshotCollections());
    const report = await apply([{ id: 'x', kind: 'inconnu.inconnu', rev: 1, deleted: false, deletedAt: null, wire: null }]);
    expect(report.rejected).toHaveLength(1);
    expect(JSON.stringify(snapshotCollections())).toBe(before);
    expect((await pendingInboundStore.load()).items.x.reason).toBe('invalid');
  });
});

// ============================================================================================================================
describe('Réception : créations et mises à jour', () => {
  it('crée localement un élément distant, mémorise son contenu de base, et rejouer ne change rien (idempotence)', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const wire = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'bien-distant-1', updatedAt: '2026-10-01T00:00:00.000Z' };
    const first = await apply([upsert(wire, 1)]);
    expect(first.applied).toEqual(['bien-distant-1']);
    const created = item('bien-distant-1');
    expect(created.values).toEqual(bien.values);
    expect(created.createdBy).toBe('u-me');
    expect(created.toolId).toBe(bien.toolId);
    const entry = await baselineOf('bien-distant-1');
    expect(entry).toMatchObject({ kind: KIND.IMMOBILIER_BIEN, rev: 1, hash: contentHash(wire), base: contentOfWire(wire) });
    const snapshot = JSON.stringify(records);
    const again = await apply([upsert(wire, 1)]);
    expect(again.stale).toEqual(['bien-distant-1']);
    expect(again.applied).toEqual([]);
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  it('un élément reçu n’est pas renvoyé en écho au cloud', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await apply([upsert({ ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'bien-distant-2' }, 1)]);
    const capture = await captureLocalChanges({ scope: SCOPE, now: T0 });
    expect((await queueStore.load()).ops['bien-distant-2']).toBeUndefined();
    expect(capture.enqueued).toBeGreaterThanOrEqual(0);
  });

  it('modification distante sur un élément inchangé localement : appliquée sans conflit', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    const report = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Villa' } }), 2)]);
    expect(report.updated).toEqual([bien.id]);
    expect(item(bien.id).values.nom).toBe('Villa');
    expect((await baselineOf(bien.id)).rev).toBe(2);
  });

  it('un changement plus ancien que la version connue est ignoré', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'V2' } }), 2)]);
    const stale = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'V1-ancien' } }), 1)]);
    expect(stale.stale).toEqual([bien.id]);
    expect(item(bien.id).values.nom).toBe('V2');
  });

  it('parents d’abord : l’enfant reçu avant son parent attend, puis est appliqué', async () => {
    const { bien, logement } = await seedChain();
    const parent = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'bien-p' };
    const child = { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never), id: 'log-c', refs: { bien: 'bien-p' }, body: { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never).body, bien: 'bien-p' } };
    const alone = await apply([upsert(child, 1)]);
    expect(alone.deferred).toEqual([expect.objectContaining({ recordId: 'log-c', reason: 'waiting_parent' })]);
    expect(item('log-c')).toBeUndefined();
    const both = await apply([upsert(child, 1), upsert(parent, 1)]);
    expect(both.applied.sort()).toEqual(['bien-p', 'log-c']);
    expect(item('log-c')).toBeDefined();
    expect((await pendingInboundStore.load()).items['log-c']).toBeUndefined();
  });

  it('un parent qui arrive plus tard débloque l’enfant retenu (reprise des changements en attente)', async () => {
    const { bien, logement } = await seedChain();
    const parent = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'bien-p2' };
    const child = { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never), id: 'log-c2', refs: { bien: 'bien-p2' }, body: { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never).body, bien: 'bien-p2' } };
    await apply([upsert(child, 1)]);
    const pull: PullTransport = { pull: async () => ({ changes: [upsert(parent, 1)], nextCursor: 'c1', hasMore: false }) };
    const report = await runInbound({ pull, ownerUid: OWNER, now: clockAt(T1) });
    expect(report.applied.sort()).toEqual(['bien-p2', 'log-c2']);
  });

  it('une référence vers un autre type est refusée', async () => {
    const { bien, logement } = await seedChain();
    const child = { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never), id: 'log-x', refs: { bien: logement.id }, body: { ...wireOf(KIND.IMMOBILIER_LOGEMENT, logement as never).body, bien: logement.id } };
    const report = await apply([upsert(child, 1)]);
    expect(report.rejected.length + report.deferred.length).toBeGreaterThan(0);
    expect(item('log-x')).toBeUndefined();
    expect(bien.id).toBeTruthy();
  });
});

// ============================================================================================================================
describe('Conflits non financiers', () => {
  it('champs distincts : fusion automatique, la partie locale repart ensuite comme modification', async () => {
    const created = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const bien = JSON.parse(JSON.stringify(created)); // copie : l'élément local est modifié en place plus bas
    await syncAll();
    item(bien.id).values.adresse = 'Kara'; // modification locale
    const report = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Villa' } }), 2)]);
    expect(report.merged).toEqual([bien.id]);
    expect(item(bien.id).values).toMatchObject({ nom: 'Villa', adresse: 'Kara' });
    expect((await baselineOf(bien.id)).rev).toBe(2);
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    const op = (await queueStore.load()).ops[bien.id];
    expect(op).toMatchObject({ op: 'update', baseRev: 2 });
  });

  it('même champ des deux côtés : les deux versions sont conservées, rien n’est écrasé ni envoyé', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    const report = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Distante' } }), 2)]);
    expect(report.conflicts).toEqual([{ recordId: bien.id, type: 'both_modified', fields: ['nom'] }]);
    expect(item(bien.id).values.nom).toBe('Locale');
    const conflict = (await conflictStore.load()).open[bien.id];
    expect(conflict.local?.body.nom).toBe('Locale');
    expect(conflict.remote.wire?.body.nom).toBe('Distante');
    expect(conflict.base?.body.nom).toBe('Maison');
    // aucun envoi tant que le conflit est ouvert
    const log: string[] = [];
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    const run = await runOnce({ transport: acceptingTransport(log), ownerUid: OWNER, now: clockAt(T0), random: () => 0.5 });
    expect(log).toEqual([]);
    expect(run.blocked.find((b) => b.op.recordId === bien.id)?.reason).toBe('conflict');
  });

  it('sans version de base : conflit « no_base », jamais une fusion devinée', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    await baselineStore.update((b) => ({ ...b, entries: { ...b.entries, [bien.id]: { ...b.entries[bien.id], base: undefined } } }));
    item(bien.id).values.adresse = 'Kara';
    const report = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Villa' } }), 2)]);
    expect(report.conflicts[0]).toMatchObject({ type: 'no_base' });
  });

  it('résolution : garder la version distante', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Distante' } }), 2)]);
    await resolveConflict(bien.id, { type: 'keep_remote' }, env());
    expect(item(bien.id).values.nom).toBe('Distante');
    const store = await conflictStore.load();
    expect(store.open[bien.id]).toBeUndefined();
    expect(store.history[0]).toMatchObject({ resolution: 'version distante conservée', discarded: expect.objectContaining({ body: expect.objectContaining({ nom: 'Locale' }) }) });
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    expect((await queueStore.load()).ops[bien.id]).toBeUndefined();
  });

  it('résolution : garder la version locale (elle repart au-dessus de la révision distante)', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Distante' } }), 2)]);
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    expect(item(bien.id).values.nom).toBe('Locale');
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    expect((await queueStore.load()).ops[bien.id]).toMatchObject({ op: 'update', baseRev: 2, block: null });
    expect((await conflictStore.load()).history[0].discarded?.body.nom).toBe('Distante');
  });

  it('résolution champ par champ : chaque champ en désaccord doit être choisi', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'Distante' } }), 2)]);
    await expect(resolveConflict(bien.id, { type: 'fields', picks: {} }, env())).rejects.toMatchObject({ code: 'invalid_pick' });
    await expect(resolveConflict(bien.id, { type: 'fields', picks: { nom: 'remote', adresse: 'local' } }, env())).rejects.toMatchObject({ code: 'invalid_pick' });
    expect(item(bien.id).values.nom).toBe('Locale'); // rien n'a changé
    await resolveConflict(bien.id, { type: 'fields', picks: { nom: 'remote' } }, env());
    expect(item(bien.id).values.nom).toBe('Distante');
    expect((await conflictStore.load()).open[bien.id]).toBeUndefined();
    await expect(resolveConflict(bien.id, { type: 'keep_local' }, env())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('une version distante plus récente remplace le conflit ouvert (toujours une seule entrée par enregistrement)', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'D2' } }), 2)]);
    await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'D3' } }), 3)]);
    const open = (await conflictStore.load()).open;
    expect(Object.keys(open)).toEqual([bien.id]);
    expect(open[bien.id].remote.rev).toBe(3);
    const stale = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, bien as never, { values: { nom: 'D2' } }), 2)]);
    expect(stale.stale).toEqual([bien.id]);
  });
});

// ============================================================================================================================
describe('Suppressions distantes : logiques et réversibles', () => {
  it('élément inchangé : retiré des collections vives, copie conservée, aucune suppression renvoyée en écho', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    const original = JSON.parse(JSON.stringify(item(bien.id)));
    const report = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]);
    expect(report.tombstoned).toEqual([bien.id]);
    expect(item(bien.id)).toBeUndefined();
    const tomb = (await tombstoneStore.load()).items[bien.id];
    expect(tomb).toMatchObject({ status: 'deleted', remoteRev: 2, snapshot: original });
    expect(await baselineOf(bien.id)).toBeUndefined();
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    expect((await queueStore.load()).ops[bien.id]).toBeUndefined();
    // rejouer ne change rien
    expect((await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)])).stale).toEqual([bien.id]);
  });

  it('restauration locale : l’élément revient tel qu’il était, un conflit retient tout envoi (pas de restauration cloud définie)', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    const original = JSON.parse(JSON.stringify(item(bien.id)));
    await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]);
    await restoreTombstone(bien.id, env());
    expect(item(bien.id)).toEqual(original);
    expect((await tombstoneStore.load()).items[bien.id].status).toBe('restored');
    expect((await conflictStore.load()).open[bien.id].type).toBe('restored_tombstone');
    await expect(restoreTombstone(bien.id, env())).rejects.toBeInstanceOf(InboundError);
    const log: string[] = [];
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    await runOnce({ transport: acceptingTransport(log), ownerUid: OWNER, now: clockAt(T0), random: () => 0.5 });
    expect(log).toEqual([]);
    // aucun champ à choisir (la version distante est une suppression) : refusé, rien ne change ; « garder la version locale » = restauration cloud (voir syncRestore.test.ts)
    await expect(resolveConflict(bien.id, { type: 'fields', picks: {} }, env())).rejects.toMatchObject({ code: 'unsupported' }); // aucun champ à choisir : la version distante est une suppression
    expect(item(bien.id)).toBeDefined();
    // accepter la suppression retire à nouveau l'élément (copie conservée)
    await resolveConflict(bien.id, { type: 'keep_remote' }, env());
    expect(item(bien.id)).toBeUndefined();
    expect((await tombstoneStore.load()).items[bien.id].status).toBe('deleted');
  });

  it('élément modifié localement puis supprimé à distance : conflit, rien n’est retiré', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    item(bien.id).values.nom = 'Locale';
    const report = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]);
    expect(report.conflicts).toEqual([{ recordId: bien.id, type: 'update_vs_delete', fields: [] }]);
    expect(item(bien.id).values.nom).toBe('Locale');
    await expect(resolveConflict(bien.id, { type: 'fields', picks: {} }, env())).rejects.toMatchObject({ code: 'unsupported' });
    await resolveConflict(bien.id, { type: 'keep_remote' }, env());
    expect(item(bien.id)).toBeUndefined();
    expect((await tombstoneStore.load()).items[bien.id].snapshot.values).toMatchObject({ nom: 'Locale' }); // la modification locale est conservée
  });

  it('supprimé localement et modifié à distance : conflit ; deux issues possibles', async () => {
    const a = await createBien({ nom: 'A', adresse: 'Lomé' });
    const b = await createBien({ nom: 'B', adresse: 'Kara' });
    await syncAll();
    for (const id of [a.id, b.id]) records.splice(records.findIndex((r) => r.id === id), 1);
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    const ra = await apply([upsert(wireOf(KIND.IMMOBILIER_BIEN, a as never, { values: { nom: 'A2' } }), 2), upsert(wireOf(KIND.IMMOBILIER_BIEN, b as never, { values: { nom: 'B2' } }), 2)]);
    expect(ra.conflicts.map((c) => c.type)).toEqual(['delete_vs_update', 'delete_vs_update']);
    await resolveConflict(a.id, { type: 'keep_remote' }, env());
    expect(item(a.id).values.nom).toBe('A2');
    expect((await queueStore.load()).ops[a.id]).toBeUndefined();
    await resolveConflict(b.id, { type: 'keep_local' }, env());
    expect(item(b.id)).toBeUndefined();
    expect((await queueStore.load()).ops[b.id]).toMatchObject({ op: 'delete', baseRev: 2, block: null });
  });

  it('supprimé des deux côtés : le suivi disparaît sans rien envoyer', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    records.splice(records.findIndex((r) => r.id === bien.id), 1);
    await captureLocalChanges({ scope: SCOPE, now: T0 });
    const report = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]);
    expect(report.converged).toEqual([bien.id]);
    expect(await baselineOf(bien.id)).toBeUndefined();
    expect((await queueStore.load()).ops[bien.id]).toBeUndefined();
  });

  it('un parent encore référencé n’est pas retiré ; enfants d’abord dans le même lot', async () => {
    const { bien, logement } = await seedChain();
    await syncAll();
    const alone = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]);
    expect(alone.deferred).toEqual([expect.objectContaining({ recordId: bien.id, reason: 'has_dependents' })]);
    expect(item(bien.id)).toBeDefined();
    // supprimer le logement ET ses dépendants (contrat, paiement) à distance : financier → conflit, donc le parent reste retenu
    const withChild = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2), removal(logement.id, KIND.IMMOBILIER_LOGEMENT, 2)]);
    expect(item(bien.id)).toBeDefined();
    expect(withChild.tombstoned).toEqual([]);
  });

  it('suppression de deux éléments liés non financiers : enfant puis parent', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { logement } = (await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'C1' }, nom: 'K', telephone: '90123456', loyerMensuel: 1000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' })) as never as { logement: { id: string } };
    await syncAll();
    // le contrat et le contact dépendent du logement : on les retire localement d'abord pour isoler le couple bien/logement
    for (const kind of [KIND.IMMOBILIER_CONTRAT]) for (const it of collectSyncableItems(snapshotCollections()).items.filter((i) => i.kind === kind)) records.splice(records.findIndex((r) => r.id === it.id), 1);
    const report = await apply([removal(bien.id, KIND.IMMOBILIER_BIEN, 2), removal(logement.id, KIND.IMMOBILIER_LOGEMENT, 2)]);
    expect(report.tombstoned).toEqual([logement.id, bien.id]);
  });
});

// ============================================================================================================================
describe('Faits financiers : jamais supprimés ni réécrits silencieusement', () => {
  it('modification distante d’un paiement : conflit explicite, le paiement local reste intact', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    const before = JSON.stringify(item(paiement.id));
    const report = await apply([upsert(wireOf(KIND.IMMOBILIER_PAIEMENT, paiement as never, { values: { montant: 1 } }), 2)]);
    expect(report.conflicts).toEqual([expect.objectContaining({ recordId: paiement.id, type: 'financial_remote_change' })]);
    expect(JSON.stringify(item(paiement.id))).toBe(before);
    expect((await conflictStore.load()).open[paiement.id].remote.wire?.body.montant).toBe(1);
  });

  it('suppression distante d’un paiement : conflit, rien n’est retiré, la décision « garder local » et l’effacement sont refusés', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    const report = await apply([removal(paiement.id, KIND.IMMOBILIER_PAIEMENT, 2)]);
    expect(report.conflicts).toEqual([expect.objectContaining({ type: 'financial_remote_delete' })]);
    expect(item(paiement.id)).toBeDefined();
    for (const resolution of [{ type: 'keep_remote' }, { type: 'keep_local' }] as const) {
      await expect(resolveConflict(paiement.id, resolution, env())).rejects.toMatchObject({ code: 'unsupported' });
    }
    expect(item(paiement.id)).toBeDefined();
    expect((await conflictStore.load()).open[paiement.id]).toBeDefined();
    expect((await tombstoneStore.load()).items[paiement.id]).toBeUndefined();
  });

  it('modification distante acceptée explicitement : le contenu écarté reste dans l’historique', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    await apply([upsert(wireOf(KIND.IMMOBILIER_PAIEMENT, paiement as never, { values: { montant: 1 } }), 2)]);
    await resolveConflict(paiement.id, { type: 'keep_remote' }, env());
    expect(item(paiement.id).values.montant).toBe(1);
    expect((await conflictStore.load()).history[0].discarded?.body.montant).toBe(paiement.values.montant);
  });

  it('création distante d’un paiement : appliquée (un nouveau fait n’en réécrit aucun)', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    const report = await apply([upsert({ ...wireOf(KIND.IMMOBILIER_PAIEMENT, paiement as never), id: 'paiement-distant' }, 1)]);
    expect(report.applied).toEqual(['paiement-distant']);
  });
});

// ============================================================================================================================
describe('Corrections et annulations financières explicites', () => {
  it('annulation : nouveau fait tracé qui référence le paiement ; le paiement initial n’est jamais modifié', async () => {
    const { paiement } = await seedChain();
    const before = JSON.stringify(item(paiement.id));
    const c = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'annulation', reason: 'Saisi deux fois', now: T0 });
    expect(c).toMatchObject({ targetId: paiement.id, type: 'annulation', correctedAmount: null, createdBy: 'u-me' });
    expect(JSON.stringify(item(paiement.id))).toBe(before);
    expect(await correctionsOf(paiement.id)).toHaveLength(1);
    expect(effectiveFinancialState(25000, await correctionsOf(paiement.id))).toMatchObject({ state: 'annulled', effectiveAmount: 0 });
  });

  it('corrections successives : la plus récente prévaut ; une annulation est définitive', async () => {
    const { paiement } = await seedChain();
    const mk = (type: 'correction' | 'annulation', amount?: number, at = T0) => recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type, reason: 'motif', correctedAmount: amount, now: at });
    await mk('correction', 20000, new Date('2026-10-17T12:00:00Z'));
    await mk('correction', 22000, new Date('2026-10-17T12:05:00Z'));
    expect(effectiveFinancialState(25000, await correctionsOf(paiement.id))).toMatchObject({ state: 'corrected', effectiveAmount: 22000 });
    await mk('annulation', undefined, new Date('2026-10-17T12:10:00Z'));
    await expect(mk('annulation')).rejects.toMatchObject({ code: 'already_annulled' });
    await expect(mk('correction', 5)).rejects.toMatchObject({ code: 'already_annulled' });
    expect(effectiveFinancialState(25000, await correctionsOf(paiement.id))).toMatchObject({ state: 'annulled', effectiveAmount: 0 });
  });

  it('refuse motif vide, montant invalide, fait introuvable, mauvais type, espace de démonstration', async () => {
    const { paiement, bien } = await seedChain();
    const base = { kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, now: T0 } as const;
    await expect(recordCorrection({ ...base, type: 'annulation', reason: '  ' })).rejects.toBeInstanceOf(CorrectionError);
    await expect(recordCorrection({ ...base, type: 'correction', reason: 'x', correctedAmount: -1 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(recordCorrection({ ...base, type: 'correction', reason: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(recordCorrection({ ...base, targetId: 'inconnu', type: 'annulation', reason: 'x' })).rejects.toMatchObject({ code: 'target_missing' });
    await expect(recordCorrection({ ...base, targetId: bien.id, type: 'annulation', reason: 'x' })).rejects.toMatchObject({ code: 'target_kind' });
    expect(Object.keys((await correctionStore.load()).items)).toHaveLength(0);
    await switchWorkspace('demo');
    await expect(recordCorrection({ ...base, type: 'annulation', reason: 'x' })).rejects.toMatchObject({ code: 'demo_workspace' });
  });

  it('la correction est envoyée comme création (fait financier ajouté) ; toute modification ou suppression ultérieure est retenue', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    const c = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'annulation', reason: 'Erreur', now: T0 });
    const log: string[] = [];
    await syncAll(log);
    expect(log).toEqual([`create:${c.id}`]);
    const entry = await baselineOf(c.id);
    expect(entry.kind).toBe(KIND.IMMOBILIER_CORRECTION_PAIEMENT);
    expect(buildWireRecord(KIND.IMMOBILIER_CORRECTION_PAIEMENT, c as never, OWNER).refs).toEqual({ targetId: paiement.id });
    // altérer la correction : jamais envoyé
    await correctionStore.update((s) => ({ ...s, items: { ...s.items, [c.id]: { ...c, reason: 'Réécrit' } } }));
    const log2: string[] = [];
    const run = await syncAll(log2);
    expect(log2).toEqual([]);
    expect(run.blocked.find((b) => b.op.recordId === c.id)?.reason).toBe('financial_policy');
  });

  it('une correction reçue est appliquée ; sa suppression distante est retenue', async () => {
    const { paiement } = await seedChain();
    await syncAll();
    const c = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'correction', reason: 'm', correctedAmount: 10, now: T0 });
    const wire = { ...buildWireRecord(KIND.IMMOBILIER_CORRECTION_PAIEMENT, c as never, OWNER), id: 'corr-distante' };
    const report = await apply([upsert(wire, 1)]);
    expect(report.applied).toEqual(['corr-distante']);
    expect((await correctionStore.load()).items['corr-distante']).toMatchObject({ targetId: paiement.id, correctedAmount: 10 });
    const del = await apply([removal('corr-distante', KIND.IMMOBILIER_CORRECTION_PAIEMENT, 2)]);
    expect(del.conflicts).toEqual([expect.objectContaining({ type: 'financial_remote_delete' })]);
    expect((await correctionStore.load()).items['corr-distante']).toBeDefined();
  });

  it('une correction reçue qui référence un paiement absent attend son parent', async () => {
    const { paiement } = await seedChain();
    const c = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'annulation', reason: 'm', now: T0 });
    const wire = { ...buildWireRecord(KIND.IMMOBILIER_CORRECTION_PAIEMENT, c as never, OWNER), id: 'corr-orpheline', refs: { targetId: 'absent' }, body: { ...buildWireRecord(KIND.IMMOBILIER_CORRECTION_PAIEMENT, c as never, OWNER).body, targetId: 'absent' } };
    const report = await apply([upsert(wire, 1)]);
    expect(report.deferred[0]).toMatchObject({ reason: 'waiting_parent' });
  });
});

// ============================================================================================================================
describe('Doublons logiques : signalés, jamais fusionnés', () => {
  it('un tour reçu avec la clé d’un tour existant est retenu et signalé ; la libération explicite l’applique sans rien fusionner', async () => {
    await seedDemoTontine();
    const tour = dbModule.tours[0] as unknown as Record<string, unknown>;
    expect(tour).toBeDefined();
    const wire = buildWireRecord(KIND.TONTINE_TOUR, { ...tour, id: 'tour-doublon' }, OWNER);
    const toursBefore = dbModule.tours.length;
    const report = await apply([upsert(wire, 1)]);
    expect(report.duplicates).toEqual([expect.objectContaining({ recordId: 'tour-doublon', with: [tour.id as string] })]);
    expect(dbModule.tours).toHaveLength(toursBefore);
    expect((await pendingInboundStore.load()).items['tour-doublon'].reason).toBe('logical_duplicate');
    // la reprise automatique ne le libère pas
    const pull: PullTransport = { pull: async () => ({ changes: [], nextCursor: null, hasMore: false }) };
    await runInbound({ pull, ownerUid: OWNER, now: clockAt(T1) });
    expect(dbModule.tours).toHaveLength(toursBefore);
    await releaseHeldDuplicate('tour-doublon', env());
    expect(dbModule.tours).toHaveLength(toursBefore + 1);
    expect(dbModule.tours.some((t) => t.id === tour.id)).toBe(true); // l'original n'a pas bougé
    await expect(releaseHeldDuplicate('tour-doublon', env())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('le rapport de doublons compare aussi la référence : un élément connu du cloud mais absent localement compte', async () => {
    await seedDemoTontine();
    const tour = dbModule.tours[0] as unknown as Record<string, unknown>;
    const key = `${tour.groupId as string}|${tour.tourNumber as number}`;
    const items = collectSyncableItems(snapshotCollections()).items;
    const baseline = { schemaVersion: 1 as const, entries: { 'tour-absent': { kind: KIND.TONTINE_TOUR, hash: 'a'.repeat(64), rev: 1, naturalKey: key } } };
    const report = scanLogicalDuplicates(items, baseline);
    expect(report).toEqual([expect.objectContaining({ kind: KIND.TONTINE_TOUR, key, ids: [tour.id as string, 'tour-absent'].sort() })]);
    expect(scanLogicalDuplicates(items)).toEqual([]);
  });

  it('côté envoi : une création locale qui partage la clé d’un élément connu du cloud est retenue', async () => {
    await seedDemoTontine();
    const tour = dbModule.tours[0] as unknown as Record<string, unknown>;
    const key = `${tour.groupId as string}|${tour.tourNumber as number}`;
    const items = collectSyncableItems(snapshotCollections()).items;
    const queue = { schemaVersion: 1 as const, seq: 1, ops: { [tour.id as string]: { opId: 'op-1', recordId: tour.id as string, kind: KIND.TONTINE_TOUR, op: 'create' as const, baseRev: 0, deletedAt: null, enqueuedAt: T0.toISOString(), updatedAt: T0.toISOString(), attempts: 0, lastAttemptAt: null, nextRetryAt: null, lastError: null, inFlight: false, uncertain: false, block: null } } };
    const plan = planOperations({ queue, baseline: { schemaVersion: 1, entries: {} }, items, now: T0, externalKeys: new Map([[`${KIND.TONTINE_TOUR}|${key}`, ['tour-connu']]]) });
    expect(plan.blocked[0]).toMatchObject({ reason: 'logical_duplicate' });
  });
});

// ============================================================================================================================
describe('Réception par pages : curseur, interruptions, reprises', () => {
  const pagesOf = (changesByPage: RemoteChange[][]): PullTransport & { calls: (string | null)[] } => {
    const calls: (string | null)[] = [];
    return {
      calls,
      async pull({ cursor }) {
        calls.push(cursor);
        const index = cursor === null ? 0 : Number(cursor);
        return { changes: changesByPage[index] ?? [], nextCursor: String(index + 1), hasMore: index + 1 < changesByPage.length } as PullPage;
      },
    };
  };

  it('lit toutes les pages, mémorise le curseur, puis ne rejoue rien', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const w = (id: string) => ({ ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id });
    const pull = pagesOf([[upsert(w('b1'), 1)], [upsert(w('b2'), 1)], []]);
    const report = await runInbound({ pull, ownerUid: OWNER, now: clockAt(T1) });
    expect(report.applied.sort()).toEqual(['b1', 'b2']);
    expect(report.pages).toBe(3);
    expect((await cursorStore.load()).cursor).toBe('3');
    const again = await runInbound({ pull: pagesOf([[upsert(w('b1'), 1)]]), ownerUid: OWNER, now: clockAt(T1) });
    expect(again.applied).toEqual([]);
  });

  it('erreur réseau : arrêt propre, curseur inchangé, reprise ensuite', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const failing: PullTransport = { pull: async () => { throw new SyncTransportError('network', 'hors ligne'); } };
    const stopped = await runInbound({ pull: failing, ownerUid: OWNER, now: clockAt(T1) });
    expect(stopped).toMatchObject({ stopped: 'network', cursor: null });
    const ok = pagesOf([[upsert({ ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'b9' }, 1)]]);
    expect((await runInbound({ pull: ok, ownerUid: OWNER, now: clockAt(T1) })).applied).toEqual(['b9']);
  });

  it('échec d’écriture locale : le curseur n’avance pas ; la reprise applique sans doublon', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const w = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'b-crash' };
    const real = createDefaultApplier();
    const broken: LocalApplier = { ...real, upsert: async () => { throw new Error('disque plein'); } };
    const first = await runInbound({ pull: pagesOf([[upsert(w, 1)]]), ownerUid: OWNER, applier: broken, now: clockAt(T1) });
    expect(first).toMatchObject({ stopped: 'persistence_error', error: 'disque plein' });
    expect((await cursorStore.load()).cursor).toBeNull();
    const second = await runInbound({ pull: pagesOf([[upsert(w, 1)]]), ownerUid: OWNER, now: clockAt(T1) });
    expect(second.applied).toEqual(['b-crash']);
    expect(records.filter((r) => r.id === 'b-crash')).toHaveLength(1);
  });

  it('interruption entre l’écriture de l’élément et celle de la référence : la reprise adopte sans doublon ni conflit', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const w = { ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'b-mid' };
    mockFail.set = (key) => key.includes('sync_baseline');
    const first = await runInbound({ pull: pagesOf([[upsert(w, 1)]]), ownerUid: OWNER, now: clockAt(T1) });
    expect(first.stopped).toBe('persistence_error');
    expect(records.filter((r) => r.id === 'b-mid')).toHaveLength(1);
    mockFail.set = null;
    const second = await runInbound({ pull: pagesOf([[upsert(w, 1)]]), ownerUid: OWNER, now: clockAt(T1) });
    expect(second.converged).toEqual(['b-mid']);
    expect(second.conflicts).toEqual([]);
    expect(records.filter((r) => r.id === 'b-mid')).toHaveLength(1);
    expect((await baselineOf('b-mid')).rev).toBe(1);
  });

  it('interruption pendant une suppression distante : la copie existe déjà, la reprise termine le retrait', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await syncAll();
    const real = createDefaultApplier();
    const broken: LocalApplier = { ...real, remove: async () => { throw new Error('écriture impossible'); } };
    const first = await runInbound({ pull: pagesOf([[removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]]), ownerUid: OWNER, applier: broken, now: clockAt(T1) });
    expect(first.stopped).toBe('persistence_error');
    expect((await tombstoneStore.load()).items[bien.id]).toBeDefined();
    expect(item(bien.id)).toBeDefined(); // pas encore retiré : aucune perte
    const second = await runInbound({ pull: pagesOf([[removal(bien.id, KIND.IMMOBILIER_BIEN, 2)]]), ownerUid: OWNER, now: clockAt(T1) });
    expect(second.tombstoned).toEqual([bien.id]);
    expect(item(bien.id)).toBeUndefined();
  });

  it('un curseur qui n’avance pas n’entraîne pas de boucle', async () => {
    const stuck: PullTransport = { pull: async () => ({ changes: [], nextCursor: 'x', hasMore: true }) };
    const report = await runInbound({ pull: stuck, ownerUid: OWNER, now: clockAt(T1), maxPages: 10 });
    expect(report.pages).toBeLessThanOrEqual(2);
  });

  it('magasin illisible : arrêt avant toute écriture, contenu laissé intact', async () => {
    mockMemory.set(`@formease/sync_conflicts@${OWNER}`, '{ pas du json');
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const before = JSON.stringify(records);
    await expect(runInbound({ pull: pagesOf([[upsert({ ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'b-x' }, 1)]]), ownerUid: OWNER, now: clockAt(T1) })).rejects.toMatchObject({ code: 'store_corrupted' });
    expect(JSON.stringify(records)).toBe(before);
    expect(mockMemory.get(`@formease/sync_conflicts@${OWNER}`)).toBe('{ pas du json');
  });

  it('un changement d’un autre compte est refusé', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const foreign = upsert({ ...wireOf(KIND.IMMOBILIER_BIEN, bien as never), id: 'b-etranger', ownerUid: 'uid-autre' }, 1);
    const report = await apply([foreign]);
    expect(report.rejected[0].problems.join()).toContain('autre compte');
    expect(item('b-etranger')).toBeUndefined();
  });

  it('refuse sans propriétaire ; deux exécutions simultanées : la seconde est ignorée', async () => {
    const empty: PullTransport = { pull: async () => ({ changes: [], nextCursor: null, hasMore: false }) };
    await expect(runInbound({ pull: empty, ownerUid: '' })).rejects.toBeInstanceOf(SyncEngineError);
    let release: () => void = () => undefined;
    const slow: PullTransport = { pull: () => new Promise<PullPage>((resolve) => { release = () => resolve({ changes: [], nextCursor: null, hasMore: false }); }) };
    const first = runInbound({ pull: slow, ownerUid: OWNER, now: clockAt(T1) });
    await new Promise((r) => setTimeout(r, 20));
    expect((await runInbound({ pull: empty, ownerUid: OWNER })).skipped).toBe('already_running');
    release();
    await first;
  });
});

// ============================================================================================================================
describe('Isolation démonstration / personnel', () => {
  it('l’espace de démonstration ne reçoit rien et n’écrit aucun magasin de réception', async () => {
    await switchWorkspace('demo');
    const empty: PullTransport = { pull: async () => { throw new Error('ne doit jamais être appelé'); } };
    await expect(runInbound({ pull: empty, ownerUid: OWNER })).rejects.toMatchObject({ code: 'demo_workspace' });
    await expect(restoreTombstone('x', env())).rejects.toMatchObject({ code: 'demo_workspace' });
    await expect(resolveConflict('x', { type: 'keep_local' }, env())).rejects.toMatchObject({ code: 'demo_workspace' });
    await expect(createDefaultApplier().upsert({ id: 'a', kind: KIND.TONTINE_GROUPE, schemaVersion: 1, ownerUid: OWNER, statusKey: null, createdAt: 'x', updatedAt: 'x', body: {}, refs: {} })).rejects.toThrow();
    expect([...mockMemory.keys()].filter((k) => /sync_(conflicts|tombstones|inbound|corrections)/.test(k))).toEqual([]);
  });

  it('les magasins de réception du personnel et de la démonstration sont distincts', async () => {
    expect(conflictStore.key()).toBe(`sync_conflicts@${OWNER}`); // propre au compte actif
    await switchWorkspace('demo');
    expect(conflictStore.key()).toBe(`demo/sync_conflicts@${OWNER}`);
    expect(tombstoneStore.key()).toBe(`demo/sync_tombstones@${OWNER}`);
    expect(cursorStore.key()).toBe(`demo/sync_inbound_cursor@${OWNER}`);
  });
});

// ============================================================================================================================
describe('Données anciennes et garde-fous statiques', () => {
  it('les éléments antérieurs à l’activation ne sont ni adoptés ni envoyés par la capture', async () => {
    await createBien({ nom: 'Ancien', adresse: 'Lomé' });
    const result = await captureLocalChanges({ scope: { enabledAt: '2999-01-01T00:00:00.000Z' }, now: T0 });
    expect(result.enqueued).toBe(0);
    expect(result.ignoredLegacy).toBeGreaterThan(0);
  });

  it('aucun code de production n’importe les modules de synchronisation ; aucun module ne touche au réseau', () => {
    const root = path.resolve(__dirname, '..', '..');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '__tests__', 'android', 'ios', '.expo', 'coverage', 'dist'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const importers = walk(root).filter((f) => !f.includes(`${path.sep}services${path.sep}sync${path.sep}`) && !f.includes('.test.') && !/services[\\/]firebase[\\/](syncDocModel|firestoreSyncTransport|firestoreSyncBackend).ts$/.test(f) && !f.includes(`${path.sep}__tests__${path.sep}`)).filter((f) => /^import .*['"][^'"]*\/sync\/(syncEngine|inbound|localApplier|inboundStores|financialCorrection|merge|syncQueue|syncPlanner|changeScanner|syncLock)['"]/m.test(fs.readFileSync(f, 'utf8')));
    // seules les façades de la phase 6 lisent le moteur : paiements effectifs (étape 5) et affichage/décisions (étapes 4 et 6)
    expect(importers.map((f) => path.relative(root, f).split(path.sep).join('/'))).toEqual(['services/effectivePayments.ts', 'services/paymentCorrectionService.ts', 'services/syncDisplay.ts']);
    const syncDir = path.join(root, 'services', 'sync');
    for (const file of fs.readdirSync(syncDir)) {
      const source = fs.readFileSync(path.join(syncDir, file), 'utf8');
      const imports = source.split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');
      expect(imports).not.toMatch(/firebase|firestore|cloudSyncService|firestoreRecordsApi|fetch|axios/i);
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });

  it('rapport vide cohérent', () => {
    expect(Object.values(emptyInboundReport()).every((v) => Array.isArray(v) && v.length === 0)).toBe(true);
  });
});
