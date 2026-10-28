// P2 — moteur de synchronisation hors réseau : file persistante, ordre des dépendances, reprises, idempotence, suppressions logiques,
// références invalides, erreurs de stockage, isolation démonstration / personnel. Transport SIMULÉ en mémoire : aucun réseau, aucun SDK
// Firebase, aucune synchronisation réelle, aucun branchement à l'application.

import fs from 'fs';
import path from 'path';
import { coreService } from '../coreService';
import * as dbModule from '../db';
import { contributions, externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { seedDemoTontine } from '../tontineDemoService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { collectSyncableItems, scanChanges, scanLogicalDuplicates } from '../sync/changeScanner';
import { KIND, kindOfRecord, kindsToSync, type Kind } from '../sync/kindRegistry';
import { loadSyncMeta, updateSyncMeta } from '../sync/localSyncMeta';
import { planOperations } from '../sync/syncPlanner';
import { applyChanges, backoffMs, baselineStore, coalesce, MAX_TRANSIENT_ATTEMPTS, queueStore, validateQueue, type IncomingChange, type QueuedOperation, type QueueStore } from '../sync/syncQueue';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { captureLocalChanges, getQueueSummary, recoverInterruptedOperations, runOnce, SyncEngineError, SyncTransportError, type PushRequest, type RemoteDoc, type SyncTransport } from '../sync/syncEngine';
import { buildWireRecord, contentHash, hashOfItem } from '../sync/wireFormat';
import type { RecordItem } from '@/types/entities';

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

const PREFIX = '@formease/';
const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T0 = new Date('2026-10-17T12:00:00.000Z');
const OWNER = 'uid-test';
const clockAt = (d: Date) => () => d;

function freshApp() {
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
}

beforeEach(() => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  mockMemory.clear();
  mockFail.set = null;
  freshApp();
  setSyncAccount(OWNER);
  __useSyncScopeForTests(kindsToSync()); // moteur générique : types hors V1 inclus (le périmètre V1 est testé dans syncScope.test.ts)
});

// ---- Cloud simulé (transport) ---------------------------------------------------------------------------------------------------
interface Hooks {
  before: null | ((req: PushRequest) => void);
  afterApply: null | ((req: PushRequest) => void);
  onRead: null | (() => void);
}
function makeRemote() {
  const docs = new Map<string, RemoteDoc & { kind: Kind }>();
  const log: PushRequest[] = [];
  const applied = new Map<string, number>();
  const hooks: Hooks = { before: null, afterApply: null, onRead: null };
  const transport: SyncTransport = {
    async push(req) {
      log.push(req);
      hooks.before?.(req);
      const existing = docs.get(req.recordId);
      if (req.op === 'create') {
        if (existing) throw new SyncTransportError('conflict', 'existe déjà');
      } else if (!existing || existing.rev !== req.expectedRev) {
        throw new SyncTransportError('conflict', 'révision différente');
      }
      const rev = (existing?.rev ?? 0) + 1;
      docs.set(req.recordId, { kind: req.kind, rev, hash: req.wire ? contentHash(req.wire) : existing?.hash ?? '', deleted: req.op === 'delete' });
      applied.set(req.recordId, (applied.get(req.recordId) ?? 0) + 1);
      hooks.afterApply?.(req);
      return { rev };
    },
    async read(_kind, id) {
      hooks.onRead?.();
      const d = docs.get(id);
      return d ? { rev: d.rev, hash: d.hash, deleted: d.deleted } : null;
    },
  };
  return { transport, docs, log, applied, hooks, kindsSent: () => log.map((r) => r.kind), idsSent: () => log.map((r) => r.recordId) };
}

const run = (remote: ReturnType<typeof makeRemote>, now: Date = T0, extra: Partial<Parameters<typeof runOnce>[0]> = {}) =>
  runOnce({ transport: remote.transport, ownerUid: OWNER, now: clockAt(now), random: () => 0.5, ...extra });
const capture = (now: Date = T0) => captureLocalChanges({ scope: SCOPE, now });
const ops = async () => (await queueStore.load()).ops;

/** Un bien, un logement, un locataire (contact), un contrat et un paiement de loyer : la chaîne complète d'Immobilier. */
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

// ============================================================================================================================
describe('Format d’échange et empreinte', () => {
  it('exclut tout ce qui est propre à l’appareil, porte le type stable, le propriétaire fourni et les références', async () => {
    const { bien, logement } = await seedChain();
    const wire = buildWireRecord(KIND.IMMOBILIER_LOGEMENT, logement as unknown as Record<string, unknown>, 'uid-X');
    expect(wire).toMatchObject({ id: logement.id, kind: KIND.IMMOBILIER_LOGEMENT, ownerUid: 'uid-X', schemaVersion: 1 });
    expect(wire.refs).toEqual({ bien: bien.id });
    const text = JSON.stringify(wire);
    for (const forbidden of ['toolId', 'entityDefinitionId', 'cloudOwnerUid', 'u-me', logement.toolId, logement.entityDefinitionId]) expect(text).not.toContain(forbidden);
    expect(wire.body).toMatchObject({ nom: 'Chambre 1' });
  });

  it('l’empreinte ne dépend que du contenu : ni updatedAt, ni propriétaire, ni marque locale, ni ordre des clés', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const base = hashOfItem(KIND.IMMOBILIER_BIEN, bien as unknown as Record<string, unknown>);
    const touched = { ...bien, updatedAt: '2030-01-01T00:00:00.000Z', cloudOwnerUid: 'uid-A' } as unknown as Record<string, unknown>;
    expect(hashOfItem(KIND.IMMOBILIER_BIEN, touched)).toBe(base);
    expect(contentHash(buildWireRecord(KIND.IMMOBILIER_BIEN, bien as unknown as Record<string, unknown>, 'u1'))).toBe(contentHash(buildWireRecord(KIND.IMMOBILIER_BIEN, bien as unknown as Record<string, unknown>, 'u2')));
    const reordered = { ...bien, values: { adresse: bien.values.adresse, nom: bien.values.nom, ...(bien.values.type !== undefined ? { type: bien.values.type } : {}) } };
    expect(hashOfItem(KIND.IMMOBILIER_BIEN, reordered as unknown as Record<string, unknown>)).toBe(base);
    expect(hashOfItem(KIND.IMMOBILIER_BIEN, { ...bien, values: { ...bien.values, nom: 'Autre' } } as unknown as Record<string, unknown>)).not.toBe(base);
    expect(hashOfItem(KIND.IMMOBILIER_BIEN, { ...bien, statusKey: 'archive' } as unknown as Record<string, unknown>)).not.toBe(base);
  });

  it('blocs historiques : la référence de groupe est une référence, l’identité locale « createdBy » n’est pas envoyée', async () => {
    await seedDemoTontine();
    const member = dbModule.memberships[0] as unknown as Record<string, unknown>;
    const wire = buildWireRecord(KIND.TONTINE_MEMBRE, member, 'uid-X');
    expect(wire.refs.groupId).toBe(member.groupId);
    expect(wire.body.displayName).toBe(member.displayName);
    expect(wire.body).not.toHaveProperty('id');
  });
});

// ============================================================================================================================
describe('File d’opérations : fusion sans perte', () => {
  const T = new Date('2026-10-17T10:00:00.000Z');
  const change = (op: IncomingChange['op'], baseRev = 0): IncomingChange => ({ recordId: 'r1', kind: KIND.IMMOBILIER_BIEN, op, baseRev, deletedAt: op === 'delete' ? T.toISOString() : undefined });
  const merged = (existing: QueuedOperation | undefined, c: IncomingChange) => coalesce(existing, c, 'op-1', T);
  const first = (op: IncomingChange['op']) => merged(undefined, change(op))!;
  const tried = (o: QueuedOperation): QueuedOperation => ({ ...o, attempts: 1, lastAttemptAt: T.toISOString() });

  it('table de fusion', () => {
    expect(first('create')).toMatchObject({ op: 'create', attempts: 0, inFlight: false, block: null, deletedAt: null });
    expect(first('delete')).toMatchObject({ op: 'delete', deletedAt: T.toISOString() });
    expect(merged(first('create'), change('update'))?.op).toBe('create');
    expect(merged(first('update'), change('update'))?.op).toBe('update');
    expect(merged(first('update'), change('delete'))).toMatchObject({ op: 'delete', deletedAt: T.toISOString() });
    expect(merged(first('delete'), change('update'))?.op).toBe('update'); // supprimé puis recréé avant l'envoi : le cloud n'a rien supprimé
    expect(merged(first('delete'), change('create'))?.op).toBe('update');
    expect(merged(first('delete'), change('delete'))?.op).toBe('delete');
  });

  it('création jamais envoyée puis suppression : annulées ; création déjà tentée puis suppression : suppression conservée', () => {
    expect(merged(first('create'), change('delete'))).toBeNull();
    expect(merged(tried(first('create')), change('delete'))).toMatchObject({ op: 'delete' });
    expect(merged({ ...first('create'), uncertain: true }, change('delete'))?.op).toBe('delete');
  });

  it('une suppression en attente n’est jamais rétrogradée par une modification tardive sur un autre type de changement', () => {
    const del = first('delete');
    expect(merged(del, change('delete'))?.opId).toBe(del.opId);
    expect(coalesce(del, change('update'), 'op-9', T)?.opId).toBe(del.opId); // l'identifiant d'opération ne change pas
  });

  it('applyChanges : une opération par enregistrement, identifiants d’opération attribués une seule fois, idempotent', () => {
    const empty: QueueStore = { schemaVersion: 1, seq: 0, ops: {} };
    const once = applyChanges(empty, [change('create'), { ...change('create'), recordId: 'r2' }], T);
    const twice = applyChanges(once, [change('create'), change('update'), { ...change('create'), recordId: 'r2' }], T);
    expect(Object.keys(twice.ops).sort()).toEqual(['r1', 'r2']);
    expect(twice.ops.r1.opId).toBe(once.ops.r1.opId);
    expect(twice.ops.r2.op).toBe('create');
    expect(validateQueue(twice)).toEqual([]);
  });

  it('délai de nouvelle tentative : exponentiel, plafonné à 15 minutes, gigue bornée', () => {
    expect(backoffMs(1, () => 0.5)).toBe(1000);
    expect(backoffMs(2, () => 0.5)).toBe(2000);
    expect(backoffMs(5, () => 0.5)).toBe(16000);
    expect(backoffMs(40, () => 0.5)).toBe(15 * 60 * 1000);
    expect(backoffMs(3, () => 0)).toBe(3000);
    expect(backoffMs(3, () => 0.999)).toBeLessThanOrEqual(5000);
    expect(validateQueue({ schemaVersion: 1, seq: 0, ops: { x: { ...first('create'), recordId: 'autre' } } }).join(' ')).toMatch(/clé différente/);
    expect(validateQueue({ schemaVersion: 1, seq: 0, ops: { r1: { ...first('delete'), deletedAt: null } } }).join(' ')).toMatch(/suppression sans horodatage/);
  });
});

// ============================================================================================================================
describe('Repérage des changements locaux', () => {
  it('création, modification, suppression logique ; rien d’autre ; idempotent', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const remote = makeRemote();
    expect((await capture()).enqueued).toBe(1);
    expect((await capture()).enqueued).toBe(1); // même changement vu deux fois…
    expect(Object.keys(await ops())).toEqual([bien.id]); // …une seule opération
    expect(await run(remote)).toMatchObject({ confirmed: [bien.id], stopped: null });
    expect((await capture()).enqueued).toBe(0); // rien n'a changé depuis la confirmation

    await coreService.updateRecord(bien.id, { values: { nom: 'Maison rénovée' } });
    expect((await capture()).enqueued).toBe(1);
    expect((await ops())[bien.id]).toMatchObject({ op: 'update', baseRev: 1 });
    await run(remote);
    expect(remote.log.map((r) => r.op)).toEqual(['create', 'update']);
    expect(remote.log[1].expectedRev).toBe(1);

    await coreService.deleteRecord(bien.id);
    expect((await capture()).enqueued).toBe(1);
    expect((await ops())[bien.id]).toMatchObject({ op: 'delete', baseRev: 2 });
    await run(remote);
    const del = remote.log[2];
    expect(del).toMatchObject({ op: 'delete', wire: null, expectedRev: 2 });
    expect(del.deletedAt).toEqual(expect.any(String)); // suppression LOGIQUE : horodatage, jamais de suppression physique
    expect(remote.docs.get(bien.id)?.deleted).toBe(true);
    expect(await ops()).toEqual({});
    expect((await baselineStore.load()).entries[bien.id]).toBeUndefined();
  });

  it('les anciennes données ne partent jamais d’elles-mêmes ; seule l’adoption explicite les met en file', async () => {
    const old = await createBien({ nom: 'Ancien', adresse: 'Kara' });
    old.createdAt = '2020-01-01T00:00:00.000Z';
    const recent = await createBien({ nom: 'Récent', adresse: 'Lomé' });
    const scope = { enabledAt: '2026-01-01T00:00:00.000Z' };
    expect(await captureLocalChanges({ scope, now: T0 })).toMatchObject({ enqueued: 1, ignoredLegacy: 1 });
    expect(Object.keys(await ops())).toEqual([recent.id]);
    await captureLocalChanges({ scope: { ...scope, adoptedIds: new Set([old.id]) }, now: T0 });
    expect(Object.keys(await ops()).sort()).toEqual([old.id, recent.id].sort());
  });

  it('les types non synchronisables (outils, définitions, journaux, profil) ne sont jamais mis en file', async () => {
    await seedChain();
    await capture();
    const kinds = new Set(Object.values(await ops()).map((o) => o.kind));
    for (const k of [KIND.CORE_OUTIL, KIND.CORE_DEFINITION_ENTITE, KIND.CORE_EVENEMENT, KIND.ACTIVITE_EVENEMENT, KIND.PROFIL_LOCAL, KIND.NOTIFICATION, KIND.CORE_ROLE, KIND.CORE_MEMBRE_OUTIL]) expect(kinds.has(k)).toBe(false);
    for (const k of [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_CONTRAT, KIND.IMMOBILIER_PAIEMENT, KIND.CORE_CONTACT]) expect(kinds.has(k)).toBe(true);
    const { items, skippedUnsynced } = collectSyncableItems(snapshotCollections());
    expect(skippedUnsynced).toBeGreaterThan(0);
    expect(items.every((i) => i.hash.length === 64)).toBe(true);
  });

  it('création jamais envoyée puis supprimée : annulée, aucune trace, rien d’envoyé', async () => {
    const bien = await createBien({ nom: 'Éphémère', adresse: 'x' });
    await capture();
    expect(await getQueueSummary()).toMatchObject({ total: 1 });
    await coreService.deleteRecord(bien.id);
    await capture();
    expect(await ops()).toEqual({});
    expect((await loadSyncMeta()).entries[bien.id]).toBeUndefined();
    const remote = makeRemote();
    await run(remote);
    expect(remote.log).toEqual([]);
  });

  it('les métadonnées locales suivent la file (en attente → synchronisé) sans toucher aux données métier', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const dataBefore = JSON.stringify(snapshotCollections());
    await capture();
    expect((await loadSyncMeta()).entries[bien.id]).toMatchObject({ status: 'pending', pendingOp: 'create', baseRev: 0, origin: 'user' });
    await run(makeRemote());
    expect((await loadSyncMeta()).entries[bien.id]).toMatchObject({ status: 'synced', pendingOp: null, baseRev: 1, attempts: 0 });
    expect(JSON.stringify(snapshotCollections())).toBe(dataBefore);
  });

  it('scanChanges est pur : il ne modifie ni la file ni la référence', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { items } = collectSyncableItems(snapshotCollections());
    const baseline = await baselineStore.load();
    const before = [JSON.stringify(baseline), JSON.stringify(await queueStore.load()), mockMemory.size];
    scanChanges(items, baseline, SCOPE, T0);
    expect([JSON.stringify(baseline), JSON.stringify(await queueStore.load()), mockMemory.size]).toEqual(before);
  });
});

// ============================================================================================================================
describe('Ordre des dépendances', () => {
  it('parents avant enfants, en plusieurs passes : bien et contact, puis logement, contrat, paiement', async () => {
    const { bien, logement, contrat, contact, paiement } = await seedChain();
    await capture();
    const remote = makeRemote();
    const report = await run(remote);
    expect(report.stopped).toBeNull();
    expect(report.confirmed).toHaveLength(5);
    const sent = remote.idsSent();
    const at = (id: string) => sent.indexOf(id);
    expect(at(bien.id)).toBeLessThan(at(logement.id));
    expect(at(logement.id)).toBeLessThan(at(contrat.id));
    expect(at(contact.id)).toBeLessThan(at(contrat.id));
    expect(at(contrat.id)).toBeLessThan(at(paiement.id));
    expect(await ops()).toEqual({});
    expect(report.passes).toBeGreaterThanOrEqual(4);
  });

  it('le planificateur retient un enfant tant que son parent n’est pas confirmé (« waiting_parent ») et ne l’envoie pas', async () => {
    const { bien, logement } = await seedChain();
    await capture();
    const queue = await queueStore.load();
    const { items } = collectSyncableItems(snapshotCollections());
    const plan = planOperations({ queue, baseline: await baselineStore.load(), items, now: T0 });
    expect(plan.ready.map((o) => o.recordId)).toContain(bien.id);
    expect(plan.ready.map((o) => o.recordId)).not.toContain(logement.id);
    expect(plan.blocked.find((b) => b.op.recordId === logement.id)).toMatchObject({ reason: 'waiting_parent' });
  });

  it('suppressions : enfants avant parents ; les enfants sont supprimés avant le bien dans le cloud', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre', type: 'Chambre simple', cuisine: 'Cuisine externe', wc: 'WC externe', loyerReference: 20000 });
    await capture();
    const remote = makeRemote();
    await run(remote);
    await coreService.deleteRecord(logement.id);
    await coreService.deleteRecord(bien.id);
    await capture();
    remote.log.length = 0;
    await run(remote);
    expect(remote.log.map((r) => `${r.op}:${r.recordId}`)).toEqual([`delete:${logement.id}`, `delete:${bien.id}`]);
  });
});

// ============================================================================================================================
describe('Références absentes ou invalides', () => {
  it('référence introuvable : opération bloquée « invalid_reference », jamais envoyée, jamais perdue ; reprise quand le parent réapparaît', async () => {
    const { logement, contrat } = await seedChain();
    const saved = records.splice(records.indexOf(logement), 1)[0]; // le logement disparaît localement : le contrat pointe dans le vide
    await capture();
    const remote = makeRemote();
    const report = await run(remote);
    expect(remote.idsSent()).not.toContain(contrat.id);
    expect(report.blocked.find((b) => b.op.recordId === contrat.id)).toMatchObject({ reason: 'invalid_reference' });
    expect(report.blocked.find((b) => b.op.recordId === contrat.id)?.detail).toMatch(/introuvable/);
    expect((await ops())[contrat.id]).toBeDefined(); // conservée

    records.push(saved);
    await capture();
    const second = await run(remote);
    expect(second.confirmed).toEqual(expect.arrayContaining([logement.id, contrat.id]));
    expect(await ops()).toEqual({});
  });

  it('parent jamais suivi (ancienne donnée non adoptée) : l’enfant reste local, signalé, rien n’est envoyé', async () => {
    const bien = await createBien({ nom: 'Ancien bien', adresse: 'Kara' });
    bien.createdAt = '2020-01-01T00:00:00.000Z';
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre', type: 'Chambre simple', cuisine: 'Cuisine externe', wc: 'WC externe', loyerReference: 20000 });
    await captureLocalChanges({ scope: { enabledAt: '2026-01-01T00:00:00.000Z' }, now: T0 });
    const remote = makeRemote();
    const report = await run(remote);
    expect(remote.log).toEqual([]);
    expect(report.blocked.find((b) => b.op.recordId === logement.id)?.detail).toMatch(/n’est pas suivi/);
  });

  it('référence vers un type différent ou vers un parent en cours de suppression : signalée', async () => {
    const { bien, logement } = await seedChain();
    await capture();
    const remote = makeRemote();
    await run(remote);
    // le parent est supprimé alors que l'enfant est modifié
    await coreService.deleteRecord(bien.id);
    await coreService.updateRecord(logement.id, { values: { nom: 'Renommée' } });
    await capture();
    const { items } = collectSyncableItems(snapshotCollections());
    const plan = planOperations({ queue: await queueStore.load(), baseline: await baselineStore.load(), items, now: T0 });
    const child = plan.blocked.find((b) => b.op.recordId === logement.id);
    expect(child).toMatchObject({ reason: 'invalid_reference' });
    expect(child?.detail).toMatch(/en cours de suppression/);
  });
});

// ============================================================================================================================
describe('Faits financiers et doublons logiques : retenus, jamais envoyés en silence', () => {
  it('modifier ou supprimer un paiement synchronisé est RETENU (financial_policy) ; la création reste possible ; une décision explicite le libère', async () => {
    const { paiement } = await seedChain();
    await capture();
    const remote = makeRemote();
    await run(remote);
    expect(remote.idsSent()).toContain(paiement.id); // la création d'un fait financier est permise

    await coreService.updateRecord(paiement.id, { values: { note: 'corrigé en silence ?' } });
    await capture();
    remote.log.length = 0;
    const held = await run(remote);
    expect(remote.log).toEqual([]);
    expect(held.blocked.find((b) => b.op.recordId === paiement.id)).toMatchObject({ reason: 'financial_policy' });
    expect((await ops())[paiement.id]).toMatchObject({ op: 'update' }); // conservée
    expect((await loadSyncMeta()).entries[paiement.id].status).toBe('pending');

    records.splice(records.indexOf(records.find((r) => r.id === paiement.id)!), 1); // suppression locale
    await capture();
    expect((await ops())[paiement.id]).toMatchObject({ op: 'delete' });
    expect((await run(remote)).blocked.find((b) => b.op.recordId === paiement.id)?.reason).toBe('financial_policy');
    expect(remote.log).toEqual([]);

    // décision explicite (autre politique, fournie par l'appelant) : l'opération part — rien d'irréversible n'a été décidé avant
    await run(remote, T0, { policy: { decide: () => 'allow' } });
    expect(remote.log.map((r) => r.op)).toEqual(['delete']);
  });

  it('les cotisations de tontine suivent la même politique', async () => {
    await seedDemoTontine();
    await capture();
    const remote = makeRemote();
    await run(remote);
    const paid = contributions[0];
    expect(remote.idsSent()).toContain(paid.id);
    paid.amount = 1;
    await capture();
    remote.log.length = 0;
    const report = await run(remote);
    expect(remote.idsSent()).not.toContain(paid.id);
    expect(report.blocked.find((b) => b.op.recordId === paid.id)?.reason).toBe('financial_policy');
  });

  it('doublons logiques (même tour et même membre, identifiants différents) : repérés, retenus, jamais fusionnés ni envoyés en double', async () => {
    await seedDemoTontine();
    const original = contributions[0];
    const twin = { ...original, id: 'ct-doublon', reference: 'FE-00000' };
    contributions.push(twin);
    expect(scanLogicalDuplicates(collectSyncableItems(snapshotCollections()).items)).toEqual([{ kind: KIND.TONTINE_COTISATION, key: `${original.tourId}|${original.memberId}`, ids: [original.id, 'ct-doublon'].sort() }]);
    await capture();
    const remote = makeRemote();
    const report = await run(remote);
    expect(remote.idsSent()).not.toContain(original.id);
    expect(remote.idsSent()).not.toContain('ct-doublon');
    expect(report.blocked.filter((b) => b.reason === 'logical_duplicate').map((b) => b.op.recordId).sort()).toEqual([original.id, 'ct-doublon'].sort());
    expect(contributions.filter((c) => c.tourId === original.tourId && c.memberId === original.memberId)).toHaveLength(2); // rien n'est fusionné ni supprimé
    expect(remote.idsSent().length).toBeGreaterThan(0); // le reste de la tontine est parti
  });
});

// ============================================================================================================================
describe('Reprises, erreurs et idempotence', () => {
  it('panne réseau : l’opération reste en file avec tentative et prochaine échéance ; avant l’échéance rien n’est renvoyé ; après, tout reprend sans doublon', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    remote.hooks.before = () => {
      throw new SyncTransportError('network', 'hors ligne');
    };
    const down = await run(remote, T0);
    expect(down.stopped).toBe('network');
    const op = (await ops())[bien.id];
    expect(op).toMatchObject({ attempts: 1, uncertain: true, inFlight: false, op: 'create' });
    expect(op.nextRetryAt).not.toBeNull();
    expect((await loadSyncMeta()).entries[bien.id]).toMatchObject({ status: 'error', attempts: 1 });

    remote.hooks.before = null;
    remote.log.length = 0;
    const early = await run(remote, new Date(T0.getTime() + 100));
    expect(remote.log).toEqual([]); // trop tôt : « retry_later »
    expect(early.blocked.find((b) => b.op.recordId === bien.id)?.reason).toBe('retry_later');

    const later = await run(remote, new Date(T0.getTime() + 60_000));
    expect(later.confirmed).toEqual([bien.id]);
    expect(remote.applied.get(bien.id)).toBe(1);
    expect(await ops()).toEqual({});
  });

  it('réponse perdue (le cloud a appliqué, le client n’a pas reçu la réponse) : la reprise VÉRIFIE avant de renvoyer — appliqué une seule fois', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    remote.hooks.afterApply = () => {
      throw new SyncTransportError('network', 'réponse perdue');
    };
    expect((await run(remote, T0)).stopped).toBe('network');
    expect(remote.applied.get(bien.id)).toBe(1);
    remote.hooks.afterApply = null;
    remote.log.length = 0;
    const resumed = await run(remote, new Date(T0.getTime() + 60_000));
    expect(resumed.confirmed).toEqual([bien.id]);
    expect(remote.log).toEqual([]); // aucun renvoi : le contenu du cloud était déjà le nôtre
    expect(remote.applied.get(bien.id)).toBe(1);
    expect((await baselineStore.load()).entries[bien.id]).toMatchObject({ rev: 1 });
  });

  it('réponse perdue puis suppression locale : la suppression logique est bien envoyée (le cloud contient l’enregistrement)', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    remote.hooks.afterApply = () => {
      throw new SyncTransportError('network', 'réponse perdue');
    };
    await run(remote, T0);
    remote.hooks.afterApply = null;
    await coreService.deleteRecord(bien.id);
    await capture(new Date(T0.getTime() + 1000));
    expect((await ops())[bien.id]).toMatchObject({ op: 'delete' }); // pas annulée : une tentative avait eu lieu
    await run(remote, new Date(T0.getTime() + 60_000));
    expect(remote.docs.get(bien.id)?.deleted).toBe(true);
  });

  it('processus interrompu en plein envoi : l’opération « en cours » est vérifiée à la reprise, jamais renvoyée à l’aveugle', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    await run(remote); // le cloud contient déjà le bien…
    // …mais l'application a été tuée avant d'enregistrer la confirmation : on rejoue l'état persistant d'avant la confirmation
    await baselineStore.update((b) => ({ ...b, entries: {} }));
    await queueStore.update((q) => ({
      ...q,
      seq: 1,
      ops: { [bien.id]: { opId: 'op-1', recordId: bien.id, kind: KIND.IMMOBILIER_BIEN, op: 'create', baseRev: 0, deletedAt: null, enqueuedAt: T0.toISOString(), updatedAt: T0.toISOString(), attempts: 0, lastAttemptAt: T0.toISOString(), nextRetryAt: null, lastError: null, inFlight: true, uncertain: false, block: null } },
    }));
    expect(await recoverInterruptedOperations()).toBe(1);
    expect((await ops())[bien.id]).toMatchObject({ inFlight: false, uncertain: true });
    remote.log.length = 0;
    await run(remote);
    expect(remote.log).toEqual([]);
    expect(remote.applied.get(bien.id)).toBe(1);
    expect(await ops()).toEqual({});
  });

  it('erreur d’enregistrement local APRÈS un envoi réussi : exécution arrêtée, aucune perte, reprise sans second envoi', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    remote.hooks.afterApply = () => {
      mockFail.set = (key) => key.includes('sync_queue'); // le stockage de la file tombe en panne juste après l'envoi
    };
    const failed = await run(remote, T0);
    expect(failed.stopped).toBe('persistence_error');
    expect(failed.error).toBeTruthy();
    mockFail.set = null;
    remote.hooks.afterApply = null;
    const stored = (await ops())[bien.id];
    expect(stored).toMatchObject({ inFlight: true }); // l'opération est toujours là, marquée « en cours »
    const resumed = await run(remote, new Date(T0.getTime() + 1000));
    expect(resumed.confirmed).toEqual([bien.id]);
    expect(remote.applied.get(bien.id)).toBe(1);
    expect(await ops()).toEqual({});
  });

  it('conflit : l’opération est retenue de façon durable, jamais retentée ni écrasée ; les autres opérations continuent', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const contact = await coreService.createExternalContact({ name: 'Ama' });
    await capture();
    const remote = makeRemote();
    remote.docs.set(bien.id, { kind: KIND.IMMOBILIER_BIEN, rev: 4, hash: 'f'.repeat(64), deleted: false }); // version différente déjà dans le cloud
    const report = await run(remote);
    expect(report.conflicts).toEqual([bien.id]);
    expect(report.confirmed).toEqual([contact.id]);
    expect((await ops())[bien.id].block).toMatchObject({ reason: 'conflict' });
    expect((await loadSyncMeta()).entries[bien.id].status).toBe('conflict');
    remote.log.length = 0;
    await run(remote, new Date(T0.getTime() + 3_600_000));
    expect(remote.log).toEqual([]); // collant : aucune nouvelle tentative automatique
    expect(remote.docs.get(bien.id)?.rev).toBe(4); // le cloud n'a pas été écrasé
  });

  it('refus du cloud (permission) : erreur définitive collante ; erreurs inconnues répétées : définitive après le nombre maximal de tentatives', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const contact = await coreService.createExternalContact({ name: 'Ama' });
    await capture();
    const remote = makeRemote();
    remote.hooks.before = (req) => {
      if (req.recordId === bien.id) throw new SyncTransportError('permission', 'refusé');
    };
    const report = await run(remote);
    expect(report.permanentErrors).toEqual([bien.id]);
    expect(report.confirmed).toEqual([contact.id]);
    expect((await ops())[bien.id].block?.reason).toBe('permanent_error');

    await queueStore.update((q) => ({ ...q, ops: { ...q.ops, [bien.id]: { ...q.ops[bien.id], block: null, attempts: 0, nextRetryAt: null } } })); // décision explicite de réessayer
    remote.hooks.before = (req) => {
      if (req.recordId === bien.id) throw new Error('erreur imprévue');
    };
    let now = T0;
    for (let i = 0; i < MAX_TRANSIENT_ATTEMPTS + 1; i += 1) {
      await run(remote, now);
      const op = (await ops())[bien.id];
      now = new Date((op.nextRetryAt ? new Date(op.nextRetryAt) : now).getTime() + 1);
      if (op.block) break;
    }
    expect((await ops())[bien.id].block).toMatchObject({ reason: 'permanent_error' });
  });

  it('idempotence : relancer l’exécution, recapturer ou retoucher une date ne renvoie rien', async () => {
    const { bien } = await seedChain();
    await capture();
    const remote = makeRemote();
    await run(remote);
    const sent = remote.log.length;
    await capture();
    await run(remote);
    await run(remote);
    const target = records.find((r) => r.id === bien.id)!;
    target.updatedAt = '2031-01-01T00:00:00.000Z';
    target.cloudOwnerUid = 'uid-local';
    await capture();
    await run(remote);
    expect(remote.log).toHaveLength(sent);
    expect(await ops()).toEqual({});
  });

  it('une seule exécution à la fois ; un compte propriétaire est obligatoire', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const remote = makeRemote();
    let release: () => void = () => undefined;
    remote.hooks.before = () => undefined;
    const slowTransport: SyncTransport = { ...remote.transport, push: (req) => new Promise((resolve) => (release = () => resolve(remote.transport.push(req)))) };
    const first = runOnce({ transport: slowTransport, ownerUid: OWNER, now: clockAt(T0) });
    await new Promise((r) => setTimeout(r, 20));
    expect((await run(remote)).skipped).toBe('already_running');
    release();
    await first;
    await expect(runOnce({ transport: remote.transport, ownerUid: '' })).rejects.toMatchObject({ code: 'no_owner' });
  });
});

// ============================================================================================================================
describe('Magasins illisibles : jamais écrasés', () => {
  it.each([
    ['sync_queue', '{pas du json'],
    ['sync_queue', JSON.stringify({ schemaVersion: 1, seq: 0, ops: { x: { recordId: 'y' } } })],
    ['sync_baseline', JSON.stringify({ schemaVersion: 7, entries: {} })],
    ['sync_meta', JSON.stringify({ schemaVersion: 1, entries: { x: { kind: 'inconnu' } } })],
  ])('%s corrompu : exécution et capture refusées avant tout envoi, contenu intact', async (store, raw) => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    await run(makeRemote());
    await createBien({ nom: 'Autre', adresse: 'Kara' });
    mockMemory.set(`${PREFIX}${store}@${OWNER}`, raw);
    const remote = makeRemote();
    await expect(run(remote)).rejects.toMatchObject({ code: 'store_corrupted' });
    await expect(capture()).rejects.toBeInstanceOf(SyncEngineError);
    expect(remote.log).toEqual([]);
    expect(mockMemory.get(`${PREFIX}${store}@${OWNER}`)).toBe(raw); // intact, pour analyse
  });

  it('une lecture impossible n’est pas prise pour « vide » : ni capture ni exécution', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const before = mockMemory.get(`${PREFIX}sync_queue@${OWNER}`);
    mockMemory.set(`${PREFIX}sync_queue@${OWNER}`, 'null-pas-valide{');
    await expect(capture()).rejects.toMatchObject({ code: 'store_corrupted' });
    mockMemory.set(`${PREFIX}sync_queue@${OWNER}`, before as string);
    await expect(capture()).resolves.toBeDefined();
  });

  it('une modification qui produirait une file invalide n’écrit rien', async () => {
    await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await capture();
    const before = mockMemory.get(`${PREFIX}sync_queue@${OWNER}`);
    await expect(queueStore.update((q) => ({ ...q, ops: { ...q.ops, faux: { ...Object.values(q.ops)[0], recordId: 'autre' } } }))).rejects.toBeDefined();
    expect(mockMemory.get(`${PREFIX}sync_queue@${OWNER}`)).toBe(before);
    await expect(updateSyncMeta((s) => ({ ...s, entries: { ...s.entries, x: { kind: 'inconnu' } as never } }))).rejects.toBeDefined();
  });
});

// ============================================================================================================================
describe('Isolation démonstration / personnel', () => {
  it('dans la démonstration : aucune capture, aucune écriture, aucun envoi ; la file personnelle n’est pas touchée', async () => {
    await createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await capture();
    const personalQueue = mockMemory.get(`${PREFIX}sync_queue@${OWNER}`);
    const remote = makeRemote();
    await switchWorkspace('demo');
    try {
      await createBien({ nom: 'Bien de démonstration', adresse: 'x' });
      const before = [...mockMemory.keys()].filter((k) => k.includes('demo/sync_'));
      expect(await capture()).toMatchObject({ skipped: 'demo_workspace', enqueued: 0 });
      await expect(run(remote)).rejects.toMatchObject({ code: 'demo_workspace' });
      expect(remote.log).toEqual([]);
      expect([...mockMemory.keys()].filter((k) => k.includes('demo/sync_'))).toEqual(before); // aucun magasin de synchronisation créé pour la démonstration
    } finally {
      await switchWorkspace('personal');
    }
    expect(mockMemory.get(`${PREFIX}sync_queue@${OWNER}`)).toBe(personalQueue);
    const report = await run(remote);
    expect(report.confirmed).toHaveLength(1); // seul le bien personnel part
    expect(remote.log.every((r) => (r.wire?.body as { nom?: string }).nom !== 'Bien de démonstration')).toBe(true);
  });

  it('un bien créé en démonstration n’entre jamais dans la file personnelle, même après le retour', async () => {
    await switchWorkspace('demo');
    let demoId = '';
    try {
      demoId = (await createBien({ nom: 'Démo', adresse: 'x' })).id;
    } finally {
      await switchWorkspace('personal');
    }
    await capture();
    expect(Object.keys(await ops())).not.toContain(demoId);
    const remote = makeRemote();
    await run(remote);
    expect(remote.idsSent()).not.toContain(demoId);
  });
});

// ============================================================================================================================
describe('Le moteur est isolé de l’application', () => {
  const root = path.join(__dirname, '..', '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

  it('aucun code de l’application (écrans, stores, services métier) n’importe le moteur ; aucun SDK ni réseau dans les modules de synchronisation', () => {
    const syncDir = path.join(root, 'services', 'sync');
    const engineFiles = ['syncEngine', 'syncQueue', 'syncPlanner', 'changeScanner', 'wireFormat', 'localStore'];
    const pattern = new RegExp(`sync/(${engineFiles.join('|')})|from '\\./(${engineFiles.join('|')})'`);
    for (const dir of ['app', 'features', 'components', 'store', 'services', 'utils', 'constants']) {
      for (const file of walk(path.join(root, dir)).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && !f.startsWith(syncDir) && !/services[\\/]firebase[\\/](syncDocModel|firestoreSyncTransport|firestoreSyncBackend).ts$/.test(f))) { // P4 : adaptateurs Firebase, vérifiés à part (firestoreSyncRules.test.ts)
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(pattern);
      }
    }
    for (const file of fs.readdirSync(syncDir)) {
      const src = fs.readFileSync(path.join(syncDir, file), 'utf8');
      expect(src.split('\n').filter((l) => /^import /.test(l)).join('\n')).not.toMatch(/firebase|firestore|cloudSyncService|netinfo|axios/i);
      expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket/);
    }
  });

  it('le transport est un paramètre OBLIGATOIRE (aucun transport par défaut) et la synchronisation de l’application reste fermée', () => {
    const src = fs.readFileSync(path.join(root, 'services', 'sync', 'syncEngine.ts'), 'utf8');
    expect(src).toMatch(/export interface RunOptions \{\s*transport: SyncTransport;/);
    expect(src).not.toMatch(/transport\s*\?:|defaultTransport|firestoreRecordsApi/);
    expect(fs.readFileSync(path.join(root, 'constants', 'features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });

  it('un type de contrat présent dans les enregistrements garde son type stable (contrôle de non-régression du registre)', async () => {
    const { contrat } = await seedChain();
    expect(kindOfRecord(contrat as RecordItem)).toBe(KIND.IMMOBILIER_CONTRAT);
    expect(externalContacts.length).toBeGreaterThan(0);
  });
});
