// Phase 6, étape 3 — isolation de bout en bout : DEUX COMPTES SUCCESSIFS sur le même appareil, avec les vrais services (coreService, Immobilier,
// rapports, statistiques, activité, contacts), le masquage d'affichage et le moteur de synchronisation. Un compte ne voit, ne modifie ni ne
// supprime les données d'un autre ; les données locales et le fonctionnement hors ligne sont préservés. Clouds en mémoire : aucun SDK, aucun
// réseau. Mode strict (activation obligatoire).

import * as dbModule from '../db';
import { externalContacts, records } from '../db';
import { coreService } from '../coreService';
import { setActiveCloudUid, setCloudStampUid } from '../cloudVisibility';
import {
  createBien,
  createLocataireEtContrat,
  deleteBienCascade,
  enregistrerPaiementLoyer,
  ensureImmobilierTool,
  listBiensWithSummary,
  loadBienOverview,
  loadContratDetail,
  loadLogementDetail,
  resetImmobilierToolCache,
  terminerContrat,
  updateLogement,
} from '../immobilierService';
import { loadImmobilierReport } from '../immobilierReportService';
import { loadImmobilierHistory, loadImmobilierStats } from '../moduleStatsService';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { recordCorrection } from '../sync/financialCorrection';
import { runInbound } from '../sync/inbound';
import { KIND } from '../sync/kindRegistry';
import { __useActivationForTests, activateSync } from '../sync/syncActivation';
import { setSyncAccount } from '../sync/syncAccount';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
import { __useSyncScopeForTests } from '../sync/syncScope';
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

const NOW = new Date(2026, 9, 20);
const PERIOD = '2026-10';
const EARLY = { enabledAt: '2000-01-01T00:00:00.000Z' };
let clouds: Record<string, MemoryCloud>;
let current: string | null = null;

/** Même effet que le store du compte à la connexion : compte d'affichage, compte qui marque les créations, compte de synchronisation. */
const login = (uid: string | null) => {
  current = uid;
  setActiveCloudUid(uid);
  setCloudStampUid(uid);
  setSyncAccount(uid);
};
const transport = () => createFirestoreSyncTransport({ backend: clouds[current as string].backend, uid: current as string, now: () => NOW, overlapMs: 0 });
const push = async () => (await captureLocalChanges({ scope: EARLY, now: NOW }), runOnce({ transport: transport(), ownerUid: current as string, now: () => NOW, random: () => 0.5 }));
const pull = () => runInbound({ pull: transport(), ownerUid: current as string, now: () => NOW });
const clearDevice = () => {
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
};

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(true);
  await switchWorkspace('personal');
  clearDevice();
  login(null);
  clouds = { alice: createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') }), bob: createMemoryCloud({ uid: 'bob', start: new Date('2026-10-22T09:00:00.000Z') }) };
});

async function chain(prefix: string, loyer: number) {
  const bien = await createBien({ nom: `${prefix} bien`, adresse: 'Lomé' });
  const { contrat, contact, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: `${prefix} chambre` }, nom: `${prefix} locataire`, telephone: '90123456', loyerMensuel: loyer, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  const ents = await ensureImmobilierTool();
  const depense = { id: `rec-depense-${prefix}`, toolId: ents.tool.id, entityDefinitionId: ents.depense.id, values: { bien: bien.id, montant: 5000 }, createdBy: 'u-me', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  records.push(depense as never);
  return { bien, contrat, contact, logement, paiement, depense: depense as unknown as { id: string } };
}

const idsOf = (c: Awaited<ReturnType<typeof chain>>) => [c.bien.id, c.logement.id, c.contrat.id, c.paiement.id, c.depense.id];
const allRecordIds = async () => (await coreService.getRecords({})).map((r) => r.id);

async function aliceSession() {
  const legacy = await chain('ancien', 20000); // données d'avant tout compte : locales, visibles pour tous, jamais envoyées
  login('alice');
  await activateSync(new Date(Date.now() - 60_000));
  const mine = await chain('alice', 25000);
  const correction = await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: mine.paiement.id, type: 'correction', reason: 'Erreur de saisie', correctedAmount: 24000, now: new Date() });
  const report = await push();
  expect(report.permanentErrors).toEqual([]);
  expect([...clouds.alice.docs.keys()].sort()).toEqual([...idsOf(mine), mine.contact.id, correction.id].sort()); // toute la chaîne d'Alice, rien d'ancien
  return { legacy, mine, correction };
}

// ============================================================================================================================
describe('Deux comptes successifs sur le même appareil : affichage', () => {
  it('Bob ne voit AUCUNE donnée d’Alice (listes, détails, contrats, rapports, statistiques, activité, contacts) ; il voit les données locales historiques', async () => {
    const { legacy, mine } = await aliceSession();
    login('bob');
    const visible = await allRecordIds();
    for (const id of idsOf(mine)) expect(visible).not.toContain(id);
    for (const id of idsOf(legacy)) expect(visible).toContain(id); // anciennes données : visibles pour tous, comme avant
    // listes et détails
    const biens = await listBiensWithSummary();
    expect(biens.map((b) => b.bien.id)).toEqual([legacy.bien.id]);
    expect(await loadBienOverview(mine.bien.id)).toMatchObject({ bien: null, views: [], depenses: [] }); // aucune donnée d'Alice
    expect(await loadLogementDetail(mine.logement.id)).toBeNull();
    expect(await loadContratDetail(mine.contrat.id)).toBeNull();
    expect(await coreService.getRecord(mine.paiement.id)).toBeNull();
    // rapports, statistiques, activité : uniquement l'ancien
    const report = await loadImmobilierReport({ period: PERIOD }, NOW);
    expect(report?.biens.map((b) => b.id)).toEqual([legacy.bien.id]);
    expect(report?.report.loyers.encaisses).toBe(20000); // le loyer d'Alice (25000) n'y est pas
    const stats = await loadImmobilierStats('all', NOW);
    expect(stats).toMatchObject({ biens: 1, logements: 1, contratsActifs: 1 });
    expect(stats?.encaisse.amount).toBe(20000);
    const history = await loadImmobilierHistory();
    const hidden = new Set(idsOf(mine));
    expect(history.filter((e) => JSON.stringify(e).split('"').some((token) => hidden.has(token)))).toEqual([]);
    // contacts : le locataire d'Alice est masqué, celui d'avant visible
    const contactIds = (await coreService.getExternalContacts()).map((c) => c.id);
    expect(contactIds).toContain(legacy.contact.id);
    expect(contactIds).not.toContain(mine.contact.id);
    expect(await coreService.getExternalContact(mine.contact.id)).toBeNull();
  });

  it('retour d’Alice : tout est là, rien de Bob ; sans compte : ses données restent masquées mais conservées, les anciennes restent utilisables hors ligne', async () => {
    const { legacy, mine } = await aliceSession();
    const reportBefore = await loadImmobilierReport({ period: PERIOD }, NOW);
    login('bob');
    const his = await chain('bob', 30000);
    login(null); // sans compte : fonctionnement local habituel
    expect(await allRecordIds()).toEqual(expect.arrayContaining(idsOf(legacy)));
    for (const id of [...idsOf(mine), ...idsOf(his)]) expect(await allRecordIds()).not.toContain(id);
    const offline = await createBien({ nom: 'Créé hors compte', adresse: 'X' }); // création locale : inchangée
    expect(await allRecordIds()).toContain(offline.id);
    login('alice');
    const visible = await allRecordIds();
    for (const id of [...idsOf(mine), ...idsOf(legacy)]) expect(visible).toContain(id);
    for (const id of idsOf(his)) expect(visible).not.toContain(id);
    const reportAfter = await loadImmobilierReport({ period: PERIOD }, NOW);
    expect(reportAfter?.report.loyers.encaisses).toBe(reportBefore ? reportBefore.report.loyers.encaisses + 0 : 0); // les totaux d'Alice sont ceux d'avant : ni Bob, ni la création locale n'y entrent
    expect((await loadContratDetail(mine.contrat.id))?.contrat.id).toBe(mine.contrat.id);
    expect((await coreService.getExternalContacts()).map((c) => c.id)).toEqual(expect.arrayContaining([mine.contact.id, legacy.contact.id]));
  });
});

// ============================================================================================================================
describe('Deux comptes successifs : modification et suppression', () => {
  it('Bob ne peut ni modifier ni supprimer les données d’Alice, par aucun chemin (services du cœur, Immobilier, contacts, cascades) ; tout reste identique', async () => {
    const { mine } = await aliceSession();
    const before = JSON.stringify([...records.filter((r) => idsOf(mine).includes(r.id)), ...externalContacts.filter((c) => c.id === mine.contact.id)]);
    login('bob');
    await expect(coreService.updateRecord(mine.bien.id, { values: { nom: 'Piraté' } })).rejects.toThrow(/introuvable/);
    await expect(coreService.updateRecord(mine.paiement.id, { values: { montant: 1 } })).rejects.toThrow(/introuvable/);
    await expect(coreService.updateRecord(mine.contrat.id, { statusKey: 'termine' })).rejects.toThrow(/introuvable/);
    await coreService.deleteRecord(mine.bien.id); // sans effet
    await coreService.deleteRecord(mine.paiement.id);
    await expect(coreService.updateExternalContact(mine.contact.id, { name: 'Piraté' })).rejects.toThrow(/introuvable/);
    await coreService.deleteExternalContact(mine.contact.id);
    await expect(enregistrerPaiementLoyer(mine.contrat.id, NOW)).rejects.toBeDefined();
    await expect(terminerContrat(mine.contrat.id)).rejects.toBeDefined();
    await expect(updateLogement(mine.logement.id, { nom: 'Piraté' } as never)).rejects.toBeDefined();
    await deleteBienCascade(mine.bien.id).catch(() => undefined);
    expect(JSON.stringify([...records.filter((r) => idsOf(mine).includes(r.id)), ...externalContacts.filter((c) => c.id === mine.contact.id)])).toBe(before);
    // Bob n'envoie rien d'Alice et son état de synchronisation est le sien
    await activateSync(new Date(Date.now() - 30_000));
    expect((await push()).confirmed).toEqual([]);
    expect(clouds.bob.log).toEqual([]);
    expect(clouds.bob.docs.size).toBe(0);
    // Bob peut modifier et supprimer SES données et les données locales historiques
    const his = await chain('bob', 30000);
    await coreService.updateRecord(his.bien.id, { values: { nom: 'Bob renomme' } });
    expect((await push()).confirmed.length).toBeGreaterThan(0);
    expect([...clouds.bob.docs.keys()].every((id) => !idsOf(mine).includes(id))).toBe(true);
    // les données d'Alice sont toujours identiques et toujours dans SON cloud
    expect(JSON.stringify([...records.filter((r) => idsOf(mine).includes(r.id)), ...externalContacts.filter((c) => c.id === mine.contact.id)])).toBe(before);
    expect(clouds.alice.docs.has(mine.bien.id)).toBe(true);
  });
});

// ============================================================================================================================
describe('Données reçues du cloud', () => {
  it('ce qu’Alice reçoit sur un appareil vide porte sa marque : un autre compte ne le voit, ne le modifie, ne le supprime ni ne le capture ; le locataire reçu garde son identité', async () => {
    const { mine } = await aliceSession();
    clearDevice(); // nouvel appareil (ou réinstallation) : la synchronisation d'Alice y reçoit ses données
    login('alice');
    await activateSync(new Date(Date.now() - 60_000));
    const received = await pull();
    expect(received.applied.length).toBeGreaterThanOrEqual(7);
    expect(received.rejected).toEqual([]);
    const contact = externalContacts.find((c) => c.id === mine.contact.id) as unknown as { name: string; cloudOwnerUid?: string };
    expect(contact).toMatchObject({ name: 'alice locataire', cloudOwnerUid: 'alice' }); // identité préservée, marque posée
    expect((records.find((r) => r.id === mine.contrat.id) as unknown as { values: { locataire_id: string } }).values.locataire_id).toBe(mine.contact.id);
    expect(await allRecordIds()).toEqual(expect.arrayContaining([mine.bien.id, mine.contrat.id, mine.paiement.id]));
    // le compte suivant
    login('bob');
    for (const id of [mine.bien.id, mine.logement.id, mine.contrat.id, mine.paiement.id]) expect(await allRecordIds()).not.toContain(id);
    expect((await coreService.getExternalContacts()).map((c) => c.id)).not.toContain(mine.contact.id);
    expect(await listBiensWithSummary()).toEqual([]);
    await expect(coreService.updateRecord(mine.bien.id, { values: { nom: 'x' } })).rejects.toThrow(/introuvable/);
    await coreService.deleteRecord(mine.bien.id);
    await coreService.deleteExternalContact(mine.contact.id);
    expect(records.some((r) => r.id === mine.bien.id)).toBe(true);
    expect(externalContacts.some((c) => c.id === mine.contact.id)).toBe(true);
    await activateSync(new Date(Date.now() - 30_000));
    expect((await push()).confirmed).toEqual([]);
    expect(clouds.bob.docs.size).toBe(0);
    // retour d'Alice : tout est intact
    login('alice');
    expect(await allRecordIds()).toEqual(expect.arrayContaining([mine.bien.id, mine.contrat.id]));
    expect((await coreService.getExternalContacts()).map((c) => c.id)).toContain(mine.contact.id);
    expect(JSON.stringify(snapshotCollections().records).includes('Piraté')).toBe(false);
  });
});
