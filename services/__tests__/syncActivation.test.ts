// Phase 6, étape 2 — activation SANS envoi rétroactif : ce qui existe avant l'activation reste local, même modifié après ; reconnexion, redémarrage
// et changement de compte ne déplacent jamais l'instant d'activation ; un compte n'adopte jamais les données d'un autre. Mode STRICT (activation
// obligatoire). Clouds en mémoire : aucun SDK, aucun réseau, rien de publié, aucun cycle réel.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, enregistrerPaiementLoyer, ensureImmobilierTool, resetImmobilierToolCache } from '../immobilierService';
import { ensureFacturesTool } from '../facturesService';
import { seedDemoTontine } from '../tontineDemoService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { collectSyncableItems } from '../sync/changeScanner';
import { recordCorrection } from '../sync/financialCorrection';
import { runInbound } from '../sync/inbound';
import { KIND } from '../sync/kindRegistry';
import { ownershipStore } from '../sync/ownership';
import { baselineStore, queueStore } from '../sync/syncQueue';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests, activateSync, activationStore, applyLegacyFilter, getActivation, isActivated, SyncActivationError } from '../sync/syncActivation';
import { createSyncCycle } from '../sync/syncCycle';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { engineStatus } from '../sync/syncStatusView';
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

const EARLY = { enabledAt: '2000-01-01T00:00:00.000Z' }; // portée « large » de l'appelant : l'activation enregistrée doit prévaloir
// les éléments créés par les services portent l'horloge RÉELLE : l'activation se place juste avant, comme dans un vrai usage
const T_ACTIVATION = new Date(Date.now() - 60_000);
const T_BOB = new Date(Date.now() - 30_000);
const T_LATER = new Date(Date.now() + 60_000);
const clock = () => T_LATER;
const iso = '2026-10-01T09:00:00.000Z'; // données d'avant l'activation
let clouds: Record<string, MemoryCloud>;

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(true); // strict
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount('alice');
  clouds = { alice: createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') }), bob: createMemoryCloud({ uid: 'bob', start: new Date('2026-10-22T09:00:00.000Z') }) };
});

let current = 'alice';
const as = (uid: string | null) => {
  setSyncAccount(uid);
  if (uid) current = uid;
};
const cloud = () => clouds[current];
const transport = () => createFirestoreSyncTransport({ backend: cloud().backend, uid: current, now: clock, overlapMs: 0 });
const capture = () => captureLocalChanges({ scope: EARLY, now: T_LATER });
const run = () => runOnce({ transport: transport(), ownerUid: current, now: clock, random: () => 0.5 });
const push = async () => (await capture(), run());
const ops = async () => (await queueStore.load()).ops;
const rec = (id: string) => records.find((r) => r.id === id) as unknown as { id: string; createdAt: string; values: Record<string, unknown> };
const allItems = () => collectSyncableItems(snapshotCollections()).items;

/** Un appareil RÉALISTE d'avant l'activation : Immobilier complet + contact libre + tontine, formulaire, CEET/TDE. */
async function seedLegacy() {
  const bien = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
  const { contrat, contact, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  const ents = await ensureImmobilierTool();
  const depense = { id: 'rec-depense-ancienne', toolId: ents.tool.id, entityDefinitionId: ents.depense.id, values: { bien: bien.id, montant: 5000, date: '2026-09-15' }, createdBy: 'u-me', createdAt: iso, updatedAt: iso };
  records.push(depense as never);
  const correction = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'correction', reason: 'Erreur de saisie', correctedAmount: 20000, now: new Date(iso) });
  await seedDemoTontine();
  dbModule.forms.push({ id: 'form-ancien', title: 'Formulaire', createdAt: iso, updatedAt: iso } as never);
  dbModule.submissions.push({ id: 'sub-ancienne', formId: 'form-ancien', createdAt: iso } as never);
  const f = await ensureFacturesTool();
  records.push({ id: 'rec-facture-ancienne', toolId: f.tool.id, entityDefinitionId: f.entityDefinition.id, values: { fournisseur: 'CEET', montant: 1000, mois: '2026-09' }, createdBy: 'u-me', createdAt: iso, updatedAt: iso } as never);
  externalContacts.push({ id: 'contact-libre-ancien', name: 'Contact libre', createdAt: iso, updatedAt: iso } as never);
  return { bien, contrat, contact, logement, paiement, depense, correction };
}

// ============================================================================================================================
describe('Sans activation : rien', () => {
  it('capture, envoi et réception refusés ; le cycle ne démarre pas ; aucune écriture, aucun accès au cloud', async () => {
    await seedLegacy();
    expect(await isActivated()).toBe(false);
    await expect(capture()).rejects.toMatchObject({ code: 'not_activated' });
    await expect(run()).rejects.toMatchObject({ code: 'not_activated' });
    await expect(runInbound({ pull: transport(), ownerUid: 'alice', now: clock })).rejects.toMatchObject({ code: 'not_activated' });
    const cycle = createSyncCycle({ transports: () => ({ push: transport(), pull: transport() }), isOnline: () => true, now: clock, scope: () => EARLY });
    cycle.start();
    expect(await cycle.trigger('manual')).toMatchObject({ ran: false, skipped: 'not_activated' });
    expect(cycle.state().status).toBe('not_activated');
    expect(cloud().log).toEqual([]);
    expect(await ops()).toEqual({});
    expect((await ownershipStore.load()).owners).toEqual({});
  });

  it('l’activation est refusée sans compte actif et dans la démonstration ; une activation illisible n’est jamais réinitialisée', async () => {
    as(null);
    await expect(activateSync(T_ACTIVATION)).rejects.toMatchObject({ code: 'no_account' });
    as('alice');
    await switchWorkspace('demo');
    await expect(activateSync(T_ACTIVATION)).rejects.toBeInstanceOf(SyncActivationError);
    await switchWorkspace('personal');
    mockMemory.set('@formease/sync_activation@alice', '{ pas du json');
    await expect(activateSync(T_ACTIVATION)).rejects.toBeDefined();
    await expect(capture()).rejects.toBeDefined();
    expect(mockMemory.get('@formease/sync_activation@alice')).toBe('{ pas du json'); // intact, jamais réécrit
  });
});

// ============================================================================================================================
describe('Activation avec des données existantes : zéro envoi', () => {
  it('l’activation photographie les anciens éléments (tous types) sans rien écrire dans les données ; plusieurs cycles : 0 opération, 0 envoi', async () => {
    const legacy = await seedLegacy();
    const before = JSON.stringify(snapshotCollections());
    const { created, data } = await activateSync(T_ACTIVATION);
    expect(created).toBe(true);
    expect(data).toMatchObject({ enabledAt: T_ACTIVATION.toISOString(), adoptedIds: [] });
    for (const id of [legacy.bien.id, legacy.logement.id, legacy.contrat.id, legacy.contact.id, legacy.paiement.id, legacy.depense.id, legacy.correction.id, 'form-ancien', 'sub-ancienne', 'rec-facture-ancienne', 'contact-libre-ancien']) expect(data.legacyIds).toContain(id);
    expect(JSON.stringify(snapshotCollections())).toBe(before); // aucune donnée métier touchée
    for (let i = 0; i < 3; i += 1) {
      const captured = await capture();
      expect(captured.enqueued).toBe(0);
      const report = await run();
      expect(report.confirmed).toEqual([]);
    }
    expect(cloud().log).toEqual([]);
    expect(cloud().docs.size).toBe(0);
    expect(await ops()).toEqual({});
    expect(Object.keys((await baselineStore.load()).entries)).toEqual([]);
    expect((await ownershipStore.load()).owners).toEqual({}); // rien n'est revendiqué
    const status = await engineStatus();
    expect(Object.values(status.states).every((s) => s === 'local')).toBe(true); // tout reste « Local »
    expect(status.pending).toBe(0);
  });

  it('modifier ensuite un ancien bien, contrat, locataire, paiement ou dépense : toujours aucun envoi, même avec une date de création falsifiée', async () => {
    const legacy = await seedLegacy();
    await activateSync(T_ACTIVATION);
    rec(legacy.bien.id).values.nom = 'Renommée après activation';
    rec(legacy.contrat.id).values.loyer_mensuel = 30000;
    rec(legacy.paiement.id).values.montant = 1;
    rec('rec-depense-ancienne').values.montant = 9999;
    (externalContacts.find((c) => c.id === legacy.contact.id) as unknown as { name: string }).name = 'Nom modifié';
    // date de création « dans le futur » (horloge fausse, import…) : la photographie des anciens éléments l'emporte sur la date
    rec(legacy.bien.id).createdAt = '2999-01-01T00:00:00.000Z';
    rec(legacy.logement.id).createdAt = '2999-01-01T00:00:00.000Z';
    const captured = await capture();
    expect(captured.enqueued).toBe(0);
    expect((await run()).confirmed).toEqual([]);
    expect(cloud().log).toEqual([]);
    expect(await ops()).toEqual({});
    expect(Object.values((await engineStatus()).states).every((s) => s === 'local')).toBe(true);
  });
});

// ============================================================================================================================
describe('Nouvelles données après activation', () => {
  it('une nouvelle chaîne Immobilier complète (bien, logement, contrat, locataire, paiement, dépense, correction) est synchronisée ; aucun ancien élément ne part', async () => {
    const legacy = await seedLegacy();
    await activateSync(T_ACTIVATION);
    const bien = await createBien({ nom: 'Villa nouvelle', adresse: 'Kara' });
    const { contrat, contact, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Studio' }, nom: 'Ama', telephone: '90111111', loyerMensuel: 15000, dateEntree: new Date(2026, 9, 1), dernierLoyerPaye: '2026-09' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const ents = await ensureImmobilierTool();
    records.push({ id: 'rec-depense-nouvelle', toolId: ents.tool.id, entityDefinitionId: ents.depense.id, values: { bien: bien.id, montant: 7000 }, createdBy: 'u-me', createdAt: T_LATER.toISOString(), updatedAt: T_LATER.toISOString() } as never);
    const correction = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: paiement.id, type: 'annulation', reason: 'Saisi deux fois', now: T_LATER });
    const report = await push();
    expect(report.stopped).toBeNull();
    expect(report.permanentErrors).toEqual([]);
    const expected = [bien.id, logement.id, contrat.id, contact.id, paiement.id, 'rec-depense-nouvelle', correction.id];
    expect([...cloud().docs.keys()].sort()).toEqual(expected.sort());
    for (const id of [legacy.bien.id, legacy.logement.id, legacy.contrat.id, legacy.contact.id, legacy.paiement.id, legacy.depense.id, legacy.correction.id]) expect(cloud().docs.has(id)).toBe(false);
    const status = await engineStatus();
    for (const id of expected) expect(status.states[id]).toBe('synced');
    expect(status.states[legacy.bien.id]).toBe('local');
    // modifier un NOUVEAU élément continue de fonctionner
    rec(bien.id).values.nom = 'Villa renommée';
    expect((await push()).confirmed).toEqual([bien.id]);
    expect(cloud().docs.get(bien.id)).toMatchObject({ rev: 2, body: { nom: 'Villa renommée' } });
  });

  it('les dépendances historiques ne partent jamais indirectement : un nouvel élément qui dépend d’un ancien reste local (ni envoyé, ni « en attente »)', async () => {
    const legacy = await seedLegacy();
    await activateSync(T_ACTIVATION);
    // 1. nouveau logement d'un ANCIEN bien
    const logement = await createLogement({ bienId: legacy.bien.id, nom: 'Nouveau studio' } as never);
    // 2. nouveau paiement d'un ANCIEN contrat
    const ents = await ensureImmobilierTool();
    records.push({ id: 'rec-paiement-nouveau-ancien-contrat', toolId: ents.tool.id, entityDefinitionId: ents.paiement.id, statusKey: 'paye', values: { contrat: legacy.contrat.id, montant: 25000, mois: '2026-11' }, createdBy: 'u-me', createdAt: T_LATER.toISOString(), updatedAt: T_LATER.toISOString() } as never);
    // 3. nouveau contrat (et son locataire neuf) rattaché à un ANCIEN logement ; 4. nouveau contrat dont le locataire est un ANCIEN contact
    const attached = await createLocataireEtContrat({ bienId: legacy.bien.id, logementId: legacy.logement.id, nom: 'Nouveau locataire', telephone: '90222222', loyerMensuel: 10000, dateEntree: new Date(2026, 9, 1), dernierLoyerPaye: '2026-09' } as never).catch(() => null);
    const bien = await createBien({ nom: 'Bien neuf', adresse: 'Sokodé' });
    const fresh = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Neuf' }, nom: 'Locataire neuf', telephone: '90333333', loyerMensuel: 12000, dateEntree: new Date(2026, 9, 1), dernierLoyerPaye: '2026-09' });
    rec(fresh.contrat.id).values.locataire_id = legacy.contact.id; // ancien contact comme locataire
    const report = await push();
    expect(report.permanentErrors).toEqual([]);
    const sent = new Set(cloud().docs.keys());
    for (const id of [logement.id, 'rec-paiement-nouveau-ancien-contrat', fresh.contrat.id, legacy.contact.id, legacy.bien.id, legacy.logement.id, legacy.contrat.id]) expect(sent.has(id)).toBe(false);
    if (attached) for (const id of [attached.contrat.id, attached.contact.id]) expect(sent.has(id)).toBe(false);
    expect(sent.has(bien.id)).toBe(true); // le nouveau bien, lui, part
    const status = await engineStatus();
    for (const id of [logement.id, 'rec-paiement-nouveau-ancien-contrat', fresh.contrat.id]) expect(status.states[id]).toBe('local'); // pas « en attente » pour toujours
    expect(status.pending).toBe(0);
    for (const op of Object.values(await ops())) expect([logement.id, 'rec-paiement-nouveau-ancien-contrat', fresh.contrat.id, legacy.contact.id]).not.toContain(op.recordId);
  });

  it('le filtre est pur et ne conserve que le nécessaire : un ancien élément déjà confirmé par le cloud reste synchronisable', async () => {
    const legacy = await seedLegacy();
    await activateSync(T_ACTIVATION);
    const items = allItems();
    const activation = await getActivation();
    const none = applyLegacyFilter(items, activation, { schemaVersion: 1, entries: {} });
    expect(none.allowed).toEqual([]);
    const confirmed = applyLegacyFilter(items, activation, { schemaVersion: 1, entries: { [legacy.bien.id]: { kind: KIND.IMMOBILIER_BIEN, hash: 'a'.repeat(64), rev: 1 } } });
    expect(confirmed.allowed.map((i) => i.id)).toEqual([legacy.bien.id]);
  });
});

// ============================================================================================================================
describe('L’instant d’activation est stable', () => {
  it('reconnexion, redémarrage, réactivation et changement de compte ne le déplacent jamais ; les nouveaux éléments ne deviennent pas anciens', async () => {
    await seedLegacy();
    const first = await activateSync(T_ACTIVATION);
    const fresh = await createBien({ nom: 'Nouveau', adresse: 'Y' });
    await push();
    // reconnexion : déconnexion puis retour du même compte
    as(null);
    as('alice');
    const again = await activateSync(T_LATER);
    expect(again.created).toBe(false);
    expect(again.data).toEqual(first.data);
    // « redémarrage » : l'état vit dans le stockage ; rien en mémoire ne le porte (les clés sont relues telles quelles)
    const raw = mockMemory.get('@formease/sync_activation@alice');
    expect(JSON.parse(raw as string)).toMatchObject({ enabledAt: T_ACTIVATION.toISOString() });
    expect((await activationStore.load()).enabledAt).toBe(T_ACTIVATION.toISOString());
    // un autre compte active plus tard : son instant est le sien, celui d'Alice ne bouge pas
    as('bob');
    const bob = await activateSync(T_BOB);
    expect(bob.created).toBe(true);
    expect(bob.data.enabledAt).toBe(T_BOB.toISOString());
    as('alice');
    expect((await getActivation()).enabledAt).toBe(T_ACTIVATION.toISOString());
    // le nouvel élément d'Alice reste synchronisable après tout cela (il n'est pas devenu « ancien »)
    rec(fresh.id).values.nom = 'Nouveau renommé';
    expect((await push()).confirmed).toEqual([fresh.id]);
    expect(first.data.legacyIds).not.toContain(fresh.id);
  });

  it('un autre compte n’adopte jamais les données d’un compte : ni les siennes envoyées, ni ses anciennes, ni ses nouvelles', async () => {
    const legacy = await seedLegacy();
    await activateSync(T_ACTIVATION); // Alice
    const mine = await createBien({ nom: 'Bien d’Alice', adresse: 'Lomé' });
    await push();
    expect(clouds.alice.docs.has(mine.id)).toBe(true);
    as('bob');
    const bob = await activateSync(T_BOB);
    expect(bob.data.legacyIds).toContain(legacy.bien.id); // les anciens éléments sans propriétaire sont aussi anciens pour Bob
    expect(bob.data.legacyIds).not.toContain(mine.id); // le bien d'Alice lui est invisible : il n'est même pas photographié
    expect((await capture()).enqueued).toBe(0);
    expect((await run()).confirmed).toEqual([]);
    expect(clouds.bob.log).toEqual([]);
    const his = await createBien({ nom: 'Bien de Bob', adresse: 'Kara' });
    expect((await push()).confirmed).toEqual([his.id]);
    expect([...clouds.bob.docs.keys()]).toEqual([his.id]);
    expect([...clouds.alice.docs.keys()]).toEqual([mine.id]);
    expect((await ownershipStore.load()).owners).toEqual({ [mine.id]: 'alice', [his.id]: 'bob' });
  });
});

// ============================================================================================================================
describe('Adoption volontaire (F2) : un seul écrivain ; comportement local inchangé', () => {
  it('« adoptedIds » n’est rempli que par l’envoi volontaire (legacyAdoption.ts) ; l’activation n’est appelée par aucun autre code ; la fonction réservée aux tests non plus', () => {
    const root = path.join(__dirname, '..', '..');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const files = walk(root).map((f) => path.relative(root, f).replace(/\\/g, '/'));
    const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    const production = files.filter((f) => !f.includes('__tests__/'));
    const code = (f: string) => read(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    // un SEUL écrivain de « adoptedIds » (F2) : l'envoi volontaire, qui exige une confirmation et une sauvegarde vérifiée ; le moteur n'y écrit jamais
    const writers = production.filter((f) => /adoptedIds\s*[:=]\s*(?!\[\])\[|adoptedIds\.(push|splice|concat)|adoptedIds\s*=/.test(code(f)) && f !== 'services/sync/syncActivation.ts');
    expect(writers).toEqual(['services/sync/legacyAdoption.ts']);
    expect(code('services/sync/legacyAdoption.ts').match(/activationStore\.update\(/g)).toHaveLength(1);
    expect(code('services/sync/legacyAdoption.ts')).toMatch(/confirmed !== true/);
    expect(code('services/sync/syncEngine.ts')).not.toMatch(/adoptedIds\s*=|adoptedIds\.(push|splice|concat)/);
    expect(code('services/sync/syncActivation.ts')).toContain('adoptedIds: []');
    expect(code('services/sync/syncActivation.ts')).not.toMatch(/adoptedIds\.(push|splice|concat)/);
    expect(production.filter((f) => f !== 'services/sync/syncActivation.ts' && /__useActivationForTests/.test(read(f)))).toEqual([]);
    const outside = production.filter((f) => !f.startsWith('services/sync/') && /sync\/syncActivation['"]/.test(read(f)));
    // phase 7 : seul point d'entrée, l'activation EXPLICITE du moteur (action de l'utilisateur, `activateEngine`) ; ni écrans, ni stores, ni autres services
    expect(outside).toEqual(['services/syncLifecycle.ts']);
    expect(code('services/syncLifecycle.ts').match(/activateSync\(/g)).toHaveLength(1);
    expect(code('services/syncLifecycle.ts')).not.toMatch(/adoptedIds/);
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });

  it('sans compte ni activation (cloud fermé) : le comportement local est inchangé et n’écrit aucun état de synchronisation', async () => {
    as(null);
    await seedLegacy().catch(() => undefined); // la correction financière exige un compte : le reste du jeu s'exécute comme avant
    const bien = await createBien({ nom: 'Local', adresse: 'X' });
    rec(bien.id).values.nom = 'Local modifié';
    expect([...mockMemory.keys()].filter((k) => k.includes('sync_'))).toEqual([]);
    expect(clouds.alice.log).toEqual([]);
    expect(records.length).toBeGreaterThan(0);
  });
});
