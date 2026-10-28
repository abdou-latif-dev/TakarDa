// Phase 6, étape 1 — périmètre de la synchronisation V1 : IMMOBILIER SEUL. La liste blanche est vérifiée à chaque couche (capture, planification,
// envoi, transport, réception, applicateur, règles candidates), jamais une seule. Cloud en mémoire : aucun SDK, aucun réseau, aucune publication.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { ensureFacturesTool } from '../facturesService';
import { seedDemoTontine } from '../tontineDemoService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { cloudFinancialKinds, cloudKinds } from '../firebase/syncDocModel';
import { collectSyncableItems } from '../sync/changeScanner';
import { runInbound } from '../sync/inbound';
import { cursorStore } from '../sync/inboundStores';
import { createDefaultApplier } from '../sync/localApplier';
import { ALL_KINDS, KIND, kindsToSync, type Kind } from '../sync/kindRegistry';
import { ownershipStore } from '../sync/ownership';
import { planOperations } from '../sync/syncPlanner';
import { baselineStore, queueStore } from '../sync/syncQueue';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { captureLocalChanges, enqueueChange, runOnce } from '../sync/syncEngine';
import { __useSyncScopeForTests, activeSyncKinds, evaluateScope, isSyncKind, SYNC_SCOPE_V1 } from '../sync/syncScope';
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

const UID = 'alice';
const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T0 = new Date('2026-10-22T10:00:00.000Z');
const clock = () => T0;
let cloud: MemoryCloud;

const clearDevice = () => {
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
};

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  __useSyncScopeForTests(null); // périmètre V1 STRICT
  await switchWorkspace('personal');
  clearDevice();
  setSyncAccount(UID);
  cloud = createMemoryCloud({ uid: UID, start: new Date('2026-10-22T09:00:00.000Z') });
});

const transport = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: UID, now: clock, overlapMs: 0 });
const capture = () => captureLocalChanges({ scope: SCOPE, now: T0 });
const run = () => runOnce({ transport: transport(), ownerUid: UID, now: clock, random: () => 0.5 });
const push = async () => (await capture(), run());
const pull = () => runInbound({ pull: transport(), ownerUid: UID, now: clock });
const ops = async () => (await queueStore.load()).ops;
const items = () => collectSyncableItems(snapshotCollections()).items;
const cloudKindsStored = () => [...cloud.docs.values()].map((d) => d.kind as string);
const rec = (id: string) => records.find((r) => r.id === id) as unknown as { id: string; values: Record<string, unknown> };
const iso = T0.toISOString();

async function seedImmobilier(nom = 'Maison') {
  const bien = await createBien({ nom, adresse: 'Lomé' });
  const { contrat, contact, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  return { bien, contrat, contact, logement, paiement };
}

/** Données d'autres modules, créées localement comme aujourd'hui : tontine, formulaire, CEET/TDE et un contact sans contrat. */
async function seedOthers() {
  await seedDemoTontine();
  dbModule.forms.push({ id: 'form-1', title: 'Formulaire', createdAt: iso, updatedAt: iso } as never);
  dbModule.submissions.push({ id: 'sub-1', formId: 'form-1', createdAt: iso } as never);
  const f = await ensureFacturesTool();
  records.push({ id: 'rec-facture-1', toolId: f.tool.id, entityDefinitionId: f.entityDefinition.id, values: { fournisseur: 'CEET', montant: 1000, mois: '2026-10' }, createdBy: 'u-me', createdAt: iso, updatedAt: iso } as never);
  externalContacts.push({ id: 'contact-libre', name: 'Contact libre', createdAt: iso, updatedAt: iso } as never);
}

// ============================================================================================================================
describe('Liste blanche V1', () => {
  it('exactement les types immobiliers et le contact locataire ; tout autre type du registre est exclu ; transport et règles suivent la même liste', () => {
    expect([...SYNC_SCOPE_V1].sort()).toEqual([KIND.CORE_CONTACT, KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_CONTRAT, KIND.IMMOBILIER_CORRECTION_PAIEMENT, KIND.IMMOBILIER_DEPENSE, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_PAIEMENT].sort());
    expect([...activeSyncKinds()]).toEqual([...SYNC_SCOPE_V1]);
    const excluded = ALL_KINDS.filter((k) => !SYNC_SCOPE_V1.includes(k));
    expect(excluded.length).toBeGreaterThanOrEqual(20);
    for (const kind of excluded) expect(isSyncKind(kind)).toBe(false);
    for (const kind of [KIND.UTILITY_FACTURE, KIND.UTILITY_RELEVE, KIND.UTILITY_FACTURE_PARTAGEE, KIND.UTILITY_PART_LOCATAIRE, KIND.UTILITY_PARTICIPATION, KIND.TONTINE_GROUPE, KIND.TONTINE_MEMBRE, KIND.TONTINE_TOUR, KIND.TONTINE_COTISATION, KIND.TONTINE_CORRECTION_COTISATION, KIND.FORMS_FORMULAIRE, KIND.FORMS_REPONSE]) {
      expect(kindsToSync()).toContain(kind); // « prévus » par le registre…
      expect(isSyncKind(kind)).toBe(false); // …mais JAMAIS dans le périmètre V1
    }
    expect([...cloudKinds()].sort()).toEqual([...SYNC_SCOPE_V1].sort());
    expect([...cloudFinancialKinds()].sort()).toEqual([KIND.IMMOBILIER_CORRECTION_PAIEMENT, KIND.IMMOBILIER_PAIEMENT].sort());
  });

  it('les règles candidates admettent exactement ces types ; aucun type exclu n’y figure ; elles ne sont pas publiées par un script', () => {
    const root = path.join(__dirname, '..', '..');
    const rules = fs.readFileSync(path.join(root, 'firestore.p4.rules'), 'utf8');
    const list = (fn: string) => [...(new RegExp(`function ${fn}\\(\\) \\{\\s*return \\[([^\\]]*)\\];`).exec(rules)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(list('syncKinds').sort()).toEqual([...SYNC_SCOPE_V1].sort());
    expect(list('financialKinds').sort()).toEqual([...cloudFinancialKinds()].sort());
    for (const kind of ALL_KINDS.filter((k) => !SYNC_SCOPE_V1.includes(k))) expect(list('syncKinds')).not.toContain(kind);
    expect(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts)).not.toMatch(/deploy|firebase/i);
  });
});

// ============================================================================================================================
describe('Règles d’élément (locataire, contrat, paiement)', () => {
  it('contrat complet : contrat, locataire, paiement, bien, logement autorisés ; contact sans contrat, tontine, formulaire, CEET/TDE exclus', async () => {
    const { bien, logement, contrat, contact, paiement } = await seedImmobilier();
    await seedOthers();
    const result = evaluateScope(items());
    const allowed = new Set(result.allowed.map((i) => i.id));
    for (const id of [bien.id, logement.id, contrat.id, contact.id, paiement.id]) expect(allowed.has(id)).toBe(true);
    const reasons = Object.fromEntries(result.excluded.map((e) => [e.id, e.reason]));
    expect(reasons['contact-libre']).toBe('contact_unlinked');
    expect(reasons['form-1']).toBe('kind_not_allowed');
    expect(reasons['sub-1']).toBe('kind_not_allowed');
    expect(reasons['rec-facture-1']).toBe('kind_not_allowed');
    expect(result.excluded.filter((e) => e.kind.startsWith('tontine.')).length).toBeGreaterThan(0);
    for (const e of result.excluded.filter((x) => x.kind.startsWith('tontine.'))) expect(e.reason).toBe('kind_not_allowed');
    expect(result.allowed.every((i) => SYNC_SCOPE_V1.includes(i.kind))).toBe(true);
  });

  it('un contact utilisé par un autre module seulement reste local (la règle ne s’étend pas aux autres modules)', async () => {
    await seedOthers();
    const contact = { id: 'contact-tontine', name: 'Membre', createdAt: iso, updatedAt: iso };
    externalContacts.push(contact as never);
    const result = evaluateScope(items());
    expect(result.allowed.map((i) => i.id)).not.toContain('contact-tontine');
    expect(result.excluded.find((e) => e.id === 'contact-tontine')?.reason).toBe('contact_unlinked');
  });

  it('contrat incomplet : locataire absent ou introuvable → exclu, avec ses paiements (jamais envoyé)', async () => {
    const { contrat, paiement, contact } = await seedImmobilier();
    rec(contrat.id).values.locataire_id = '';
    let result = evaluateScope(items());
    expect(result.excluded.find((e) => e.id === contrat.id)?.reason).toBe('tenant_missing');
    expect(result.excluded.find((e) => e.id === paiement.id)?.reason).toBe('contract_not_allowed');
    expect(result.excluded.find((e) => e.id === contact.id)?.reason).toBe('contact_unlinked'); // plus référencé par un contrat autorisé
    rec(contrat.id).values.locataire_id = 'contact-inexistant';
    result = evaluateScope(items());
    expect(result.excluded.find((e) => e.id === contrat.id)?.reason).toBe('tenant_missing');
    rec(contrat.id).values.locataire_id = contact.id; // le locataire est de nouveau disponible
    result = evaluateScope(items());
    expect(result.allowed.map((i) => i.id)).toEqual(expect.arrayContaining([contrat.id, paiement.id, contact.id]));
  });

  it('l’évaluation ne modifie rien', async () => {
    await seedImmobilier();
    await seedOthers();
    const before = JSON.stringify(snapshotCollections());
    evaluateScope(items());
    expect(JSON.stringify(snapshotCollections())).toBe(before);
  });
});

// ============================================================================================================================
describe('Capture et envoi : seul le périmètre part', () => {
  it('un appareil avec Immobilier ET tontines, formulaires, CEET/TDE, contact libre : seul Immobilier (et son locataire) est capturé, revendiqué et envoyé', async () => {
    const { bien, contrat, contact } = await seedImmobilier();
    await seedOthers();
    const report = await push();
    expect(report.stopped).toBeNull();
    expect(report.permanentErrors).toEqual([]);
    expect(new Set(cloudKindsStored())).toEqual(new Set([KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_CONTRAT, KIND.IMMOBILIER_PAIEMENT, KIND.CORE_CONTACT]));
    expect(cloud.docs.has(contact.id)).toBe(true);
    expect(cloud.docs.has('contact-libre')).toBe(false);
    expect(cloud.docs.get(contrat.id)!.refs).toMatchObject({ locataire_id: contact.id }); // identité et référence du locataire préservées
    expect(cloud.docs.has(bien.id)).toBe(true);
    const owners = Object.keys((await ownershipStore.load()).owners);
    expect(owners.sort()).toEqual([...cloud.docs.keys()].sort()); // seuls les éléments du périmètre sont revendiqués
    expect(owners).not.toContain('contact-libre');
    for (const op of Object.values(await ops())) expect(SYNC_SCOPE_V1).toContain(op.kind);
    // les données des autres modules sont intactes
    expect(dbModule.groups.length).toBeGreaterThan(0);
    expect(dbModule.forms).toHaveLength(1);
    expect(externalContacts.some((c) => c.id === 'contact-libre')).toBe(true);
  });

  it('un contrat dont le locataire n’est pas disponible n’est jamais envoyé ; il part, avec son locataire et dans le bon ordre, dès qu’il est complet', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat, contact } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'C' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 10000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const saved = rec(contrat.id).values.locataire_id;
    rec(contrat.id).values.locataire_id = '';
    await push();
    expect(cloud.docs.has(contrat.id)).toBe(false);
    expect(cloud.docs.has(paiement.id)).toBe(false);
    expect(cloud.docs.has(contact.id)).toBe(false);
    expect(Object.keys(await ops())).not.toContain(contrat.id);
    rec(contrat.id).values.locataire_id = saved;
    await push();
    for (const id of [contact.id, contrat.id, paiement.id]) expect(cloud.docs.has(id)).toBe(true);
    const order = cloud.log.filter((l) => l.kind === 'commit').map((l) => l.id);
    expect(order.indexOf(contact.id)).toBeLessThan(order.indexOf(contrat.id)); // locataire avant contrat
    expect(order.indexOf(contrat.id)).toBeLessThan(order.indexOf(paiement.id));
  });

  it('changement de locataire : le nouveau part avec le contrat ; l’ancien n’est ni modifié ni supprimé dans le cloud (il reste figé)', async () => {
    const { contrat, contact } = await seedImmobilier();
    await push();
    const oldDoc = JSON.stringify(cloud.docs.get(contact.id));
    const original = externalContacts.find((c) => c.id === contact.id)!;
    externalContacts.push({ ...original, id: 'contact-nouveau', name: 'Nouveau locataire' } as never);
    rec(contrat.id).values.locataire_id = 'contact-nouveau';
    await capture();
    const queued = await ops();
    expect(Object.keys(queued).sort()).toEqual(['contact-nouveau', contrat.id].sort());
    expect(queued[contact.id]).toBeUndefined(); // aucune suppression ni modification de l'ancien
    await run();
    expect(cloud.docs.get('contact-nouveau')).toMatchObject({ kind: KIND.CORE_CONTACT, rev: 1 });
    expect(cloud.docs.get(contrat.id)!.refs).toMatchObject({ locataire_id: 'contact-nouveau' });
    expect(JSON.stringify(cloud.docs.get(contact.id))).toBe(oldDoc); // intact, non supprimé
    expect(cloud.docs.get(contact.id)!.deleted).toBe(false);
  });

  it('contrat qui perd son locataire après une modification en attente : l’opération est retenue (hors périmètre), jamais envoyée ; rien ne change dans le cloud', async () => {
    const { contrat } = await seedImmobilier();
    await push();
    const before = JSON.stringify([...cloud.docs.entries()]);
    rec(contrat.id).values.loyer_mensuel = 99999;
    await capture();
    expect((await ops())[contrat.id]).toMatchObject({ op: 'update' });
    rec(contrat.id).values.locataire_id = '';
    const report = await run();
    expect(report.blocked.find((b) => b.op.recordId === contrat.id)?.reason).toBe('out_of_scope');
    expect(JSON.stringify([...cloud.docs.entries()])).toBe(before);
    expect((await ops())[contrat.id]).toBeDefined(); // conservée, pas perdue
    // une modification locale d'un élément sorti du périmètre n'est pas non plus capturée
    rec(contrat.id).values.loyer_mensuel = 1;
    const again = await capture();
    expect(again.enqueued).toBe(0);
  });

  it('suppression : un contrat supprimé localement est supprimé dans le cloud ; son ancien locataire reste ; un locataire encore référencé n’est jamais supprimé seul', async () => {
    const { contrat, contact, paiement } = await seedImmobilier();
    await push();
    // locataire supprimé localement alors que le contrat confirmé le référence : retenu
    externalContacts.splice(externalContacts.findIndex((c) => c.id === contact.id), 1);
    const held = await push();
    expect(held.blocked.find((b) => b.op.recordId === contact.id)).toMatchObject({ reason: 'invalid_reference' });
    expect(cloud.docs.get(contact.id)!.deleted).toBe(false);
    expect(cloud.docs.get(contrat.id)!.deleted).toBe(false);
    // le contrat et son paiement sont supprimés avec lui : suppression de l'ensemble (enfants d'abord), le locataire peut alors partir
    records.splice(records.findIndex((r) => r.id === paiement.id), 1);
    records.splice(records.findIndex((r) => r.id === contrat.id), 1);
    const final = await push();
    expect(final.blocked.find((b) => b.op.recordId === contact.id)).toBeUndefined();
    expect(cloud.docs.get(contrat.id)!.deleted).toBe(true);
    expect(cloud.docs.get(contact.id)!.deleted).toBe(true);
  });
});

// ============================================================================================================================
describe('Défense en profondeur : une couche précédente qui laisse passer ne suffit pas', () => {
  it('opération hors périmètre mise en file par un autre chemin : retenue par le moteur, jamais envoyée', async () => {
    await seedOthers();
    const group = dbModule.groups[0] as unknown as { id: string };
    await enqueueChange({ recordId: group.id, kind: KIND.TONTINE_GROUPE, op: 'create', baseRev: 0 }, T0);
    await enqueueChange({ recordId: 'rec-facture-1', kind: KIND.UTILITY_FACTURE, op: 'create', baseRev: 0 }, T0);
    const report = await run();
    expect(report.blocked.map((b) => b.reason)).toEqual(['out_of_scope', 'out_of_scope']);
    expect(cloud.log).toEqual([]);
    expect(cloud.docs.size).toBe(0);
  });

  it('le planificateur seul (sans la capture) retient aussi tout type hors périmètre et tout élément exclu', async () => {
    const { contrat } = await seedImmobilier();
    const queue = await (async () => {
      await enqueueChange({ recordId: 'x', kind: KIND.FORMS_FORMULAIRE, op: 'create', baseRev: 0 }, T0);
      await enqueueChange({ recordId: contrat.id, kind: KIND.IMMOBILIER_CONTRAT, op: 'create', baseRev: 0 }, T0);
      return queueStore.load();
    })();
    const plan = planOperations({ queue, baseline: { schemaVersion: 1, entries: {} }, items: items(), now: T0, excludedIds: new Set([contrat.id]) });
    expect(plan.ready).toEqual([]);
    expect(plan.blocked.map((b) => b.reason)).toEqual(['out_of_scope', 'out_of_scope']);
  });

  it('le transport refuse chaque type exclu, même si le moteur l’avait laissé passer', async () => {
    const t = transport();
    const base = { schemaVersion: 1, ownerUid: UID, statusKey: null, createdAt: iso, updatedAt: iso, body: { nom: 'x' }, refs: {} };
    for (const kind of [KIND.UTILITY_FACTURE, KIND.UTILITY_RELEVE, KIND.TONTINE_GROUPE, KIND.TONTINE_COTISATION, KIND.FORMS_FORMULAIRE, KIND.FORMS_REPONSE, KIND.CORE_OUTIL, KIND.PROFIL_LOCAL] as Kind[]) {
      await expect(t.push({ opId: `o-${kind}`, recordId: 'r1', kind, op: 'create', expectedRev: null, deletedAt: null, wire: { id: 'r1', kind, ...base } })).rejects.toMatchObject({ code: 'invalid' });
      await expect(t.read(kind, 'r1')).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(cloud.log).toEqual([]);
  });

  it('un document hors périmètre présent dans le cloud n’est jamais appliqué à la réception (conservé comme invalide)', async () => {
    const { bien } = await seedImmobilier();
    await push();
    const tontineDoc = { ...cloud.docs.get(bien.id)!, kind: KIND.TONTINE_GROUPE, serverUpdatedAt: '2026-10-22T09:59:00.000Z' };
    const factureDoc = { ...cloud.docs.get(bien.id)!, kind: KIND.UTILITY_FACTURE, serverUpdatedAt: '2026-10-22T09:59:01.000Z' };
    cloud.docs.set('tontine-distante', tontineDoc);
    cloud.docs.set('facture-distante', factureDoc);
    clearDevice();
    setSyncAccount(UID);
    const report = await pull();
    expect(report.rejected.map((r) => r.recordId).sort()).toEqual(['facture-distante', 'tontine-distante']);
    expect(report.rejected.every((r) => r.problems.join().includes('hors du périmètre'))).toBe(true);
    expect(dbModule.groups).toHaveLength(0);
    expect(records.some((r) => r.id === 'facture-distante')).toBe(false);
    expect(report.applied.length).toBeGreaterThan(0); // le reste (Immobilier) est bien reçu
  });

  it('l’applicateur local refuse d’écrire, de retirer ou de restaurer un type hors périmètre', async () => {
    const applier = createDefaultApplier(UID);
    const wire = { id: 'g1', kind: KIND.TONTINE_GROUPE, schemaVersion: 1, ownerUid: UID, statusKey: null, createdAt: iso, updatedAt: iso, body: { name: 'T' }, refs: {} };
    await expect(applier.upsert(wire)).rejects.toThrow(/périmètre/);
    await expect(applier.remove(KIND.TONTINE_GROUPE, 'g1')).rejects.toThrow(/périmètre/);
    await expect(applier.insert(KIND.FORMS_FORMULAIRE, { id: 'f1' })).rejects.toThrow(/périmètre/);
    expect(dbModule.groups).toHaveLength(0);
  });
});

// ============================================================================================================================
describe('Réception du locataire et du contrat', () => {
  it('un autre appareil reçoit le locataire AVANT le contrat, avec les mêmes identifiants et références ; un contrat reçu seul attend son locataire', async () => {
    const { contrat, contact } = await seedImmobilier();
    await push();
    const sentContrat = cloud.docs.get(contrat.id)!;
    clearDevice();
    setSyncAccount(UID);
    // le contrat seul d'abord : son locataire n'est pas encore présent
    const only = createFirestoreSyncTransport({ backend: { ...cloud.backend, page: async () => (await cloud.backend.page({ after: null, from: null, limit: 100 })).filter((r) => r.id !== contact.id) }, uid: UID, overlapMs: 0 });
    const first = await runInbound({ pull: only, ownerUid: UID, now: clock });
    expect(first.deferred.find((d) => d.recordId === contrat.id)).toMatchObject({ reason: 'waiting_parent' });
    expect(records.some((r) => r.id === contrat.id)).toBe(false);
    // le locataire arrive (la lecture repart du début : le filtre ci-dessus simulait un document pas encore visible) : tout est appliqué, identité préservée
    await cursorStore.update((c) => ({ ...c, cursor: null }));
    const second = await pull();
    expect(second.applied).toEqual(expect.arrayContaining([contact.id, contrat.id]));
    expect(rec(contrat.id).values.locataire_id).toBe(contact.id);
    const received = externalContacts.find((c) => c.id === contact.id) as unknown as Record<string, unknown>;
    expect(received.name).toBe('Koffi');
    expect(buildWireRecord(KIND.IMMOBILIER_CONTRAT, rec(contrat.id) as never, UID).body).toEqual(sentContrat.body);
    expect((await baselineStore.load()).entries[contact.id]).toBeDefined();
  });
});

// ============================================================================================================================
describe('Comportement local préservé, cloud fermé', () => {
  it('sans compte ni drapeau : créer ou modifier tontines, formulaires, CEET/TDE, contacts et Immobilier n’écrit aucun état de synchronisation', async () => {
    setSyncAccount(null);
    await seedImmobilier();
    await seedOthers();
    expect([...mockMemory.keys()].filter((k) => k.includes('sync_'))).toEqual([]);
    expect(dbModule.groups.length).toBeGreaterThan(0);
    expect(dbModule.forms).toHaveLength(1);
    expect(records.length).toBeGreaterThan(0);
    expect(cloud.log).toEqual([]);
  });

  it('le drapeau reste fermé ; aucun code de l’application n’importe le périmètre ; la fonction réservée aux tests n’est appelée que par des tests', () => {
    const root = path.join(__dirname, '..', '..');
    expect(fs.readFileSync(path.join(root, 'constants/features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const files = walk(root).map((f) => path.relative(root, f).replace(/\\/g, '/'));
    const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    const production = files.filter((f) => !f.includes('__tests__/'));
    expect(production.filter((f) => f !== 'services/sync/syncScope.ts' && /__useSyncScopeForTests/.test(read(f)))).toEqual([]);
    const outsideSync = production.filter((f) => !f.startsWith('services/sync/') && !f.startsWith('services/firebase/') && /sync\/syncScope['"]/.test(read(f)));
    expect(outsideSync).toEqual([]); // ni écrans, ni stores, ni services métier
  });
});
