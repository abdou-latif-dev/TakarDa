// F2 — moteur de synchronisation : déclenchement automatique après modification, correction/annulation d'un paiement confirmé, envoi VOLONTAIRE des
// anciennes données (aperçu, confirmation, sauvegarde), et refus d'accès du cloud (service suspendu : rien n'est bloqué, la file attend).
// Clouds en mémoire, horloge simulée : aucun SDK, aucun réseau, rien n'est démarré dans l'application.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { externalContacts, records } from '../db';
import { buildPaiementTimeline, createBien, createLocataireEtContrat, enregistrerPaiementLoyer, ensureImmobilierTool, loadContratDetail, resetImmobilierToolCache } from '../immobilierService';
import { ensureFacturesTool } from '../facturesService';
import { seedDemoTontine } from '../tontineDemoService';
import { flushDb, signalLocalDataChange, snapshotCollections, subscribeDataChanges, switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { adoptLegacyData, planAdoption, previewLegacyAdoption, ADOPTION_SAFETY_PREFIX } from '../sync/legacyAdoption';
import { correctionStore } from '../sync/financialCorrection';
import { __useActivationForTests, activateSync, activationStore } from '../sync/syncActivation';
import { createSyncCycle } from '../sync/syncCycle';
import { captureLocalChanges, runOnce, SyncTransportError, type PushRequest, type SyncTransport } from '../sync/syncEngine';
import { setSyncAccount } from '../sync/syncAccount';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { baselineStore, queueStore } from '../sync/syncQueue';
import { engineStatus, bannerModel } from '../sync/syncStatusView';
import { mustCorrectPayment, paymentCorrectionHistory, paymentCorrectionProblem, parseCorrectedAmount, submitPaymentCorrection } from '../paymentCorrectionService';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
let mockFailSafetyWrites = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => {
      if (mockFailSafetyWrites && key.includes('adoption_safety_')) throw new Error('disque plein');
      mockMemory.set(key, value);
    },
    removeItem: async (key: string) => void mockMemory.delete(key),
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

const EARLY = { enabledAt: '2000-01-01T00:00:00.000Z' };
const T_ACTIVATION = new Date(Date.now() - 60_000);
const T_LATER = new Date('2026-10-23T10:00:00.000Z');
const clock = () => T_LATER;
const iso = '2026-10-01T09:00:00.000Z';
const root = path.join(__dirname, '..', '..');
let cloud: MemoryCloud;

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(true);
  mockFailSafetyWrites = false;
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount('alice');
  cloud = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') });
});

const transport = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: clock, overlapMs: 0 });
const capture = () => captureLocalChanges({ scope: EARLY, now: T_LATER });
const run = (t: SyncTransport = transport()) => runOnce({ transport: t, ownerUid: 'alice', now: clock, random: () => 0.5 });
const push = async (t?: SyncTransport) => (await capture(), run(t));
const queued = async () => Object.values((await queueStore.load()).ops);

/** Un appareil d'avant l'activation : Immobilier complet, plus des données hors périmètre (tontine, formulaire, CEET/TDE, contact libre). */
async function seedLegacy() {
  const bien = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  const ents = await ensureImmobilierTool();
  records.push({ id: 'rec-depense-ancienne', toolId: ents.tool.id, entityDefinitionId: ents.depense.id, values: { bien: bien.id, montant: 5000, date: '2026-09-15' }, createdBy: 'u-me', createdAt: iso, updatedAt: iso } as never);
  await seedDemoTontine();
  const f = await ensureFacturesTool();
  records.push({ id: 'rec-facture-ancienne', toolId: f.tool.id, entityDefinitionId: f.entityDefinition.id, values: { fournisseur: 'CEET', montant: 1000, mois: '2026-09' }, createdBy: 'u-me', createdAt: iso, updatedAt: iso } as never);
  externalContacts.push({ id: 'contact-libre-ancien', name: 'Contact libre', createdAt: iso, updatedAt: iso } as never);
  return { bien, contrat, paiement };
}

const safetyKeys = () => [...mockMemory.keys()].filter((k) => k.includes(ADOPTION_SAFETY_PREFIX));

// ============================================================================================================================
describe('Déclenchement automatique après une modification locale', () => {
  it('l’enregistrement automatique prévient SEULEMENT quand le contenu a changé (référence au premier passage, jamais en double)', async () => {
    const listener = jest.fn();
    const stop = subscribeDataChanges(listener);
    await flushDb(); // première empreinte : simple référence
    expect(listener).not.toHaveBeenCalled();
    await flushDb(); // rien n'a changé
    expect(listener).not.toHaveBeenCalled();
    await createBien({ nom: 'Un', adresse: 'X' });
    await flushDb();
    expect(listener).toHaveBeenCalledTimes(1);
    await flushDb();
    expect(listener).toHaveBeenCalledTimes(1); // même contenu : pas de nouvelle notification
    stop();
    await createBien({ nom: 'Deux', adresse: 'Y' });
    await flushDb();
    expect(listener).toHaveBeenCalledTimes(1); // désabonné
  });

  it('sans écouteur rien n’est calculé ; un changement d’espace ne notifie pas et repart d’une nouvelle référence', async () => {
    const listener = jest.fn();
    await flushDb();
    const stop = subscribeDataChanges(listener);
    await flushDb();
    await switchWorkspace('demo');
    await flushDb();
    await flushDb();
    expect(listener).not.toHaveBeenCalled(); // le contenu de la démonstration n'est pas un « changement local »
    await switchWorkspace('personal');
    await flushDb();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('un écouteur défaillant n’empêche ni l’enregistrement ni les autres écouteurs ; le signal explicite prévient sans comparer', async () => {
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    const stops = [subscribeDataChanges(bad), subscribeDataChanges(good)];
    await flushDb();
    await createBien({ nom: 'Un', adresse: 'X' });
    await expect(flushDb()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    signalLocalDataChange();
    expect(good).toHaveBeenCalledTimes(2);
    stops.forEach((s) => s());
  });

  it('le démarrage du moteur branche cet écouteur sur le runtime et l’arrêt le retire', () => {
    const boot = fs.readFileSync(path.join(root, 'services/firebase/syncRuntimeBoot.ts'), 'utf8');
    expect(boot).toContain('subscribeDataChanges(() => runtime.notifyLocalChange())');
    const subscribe = boot.indexOf('subscribeDataChanges(() =>');
    const shutdown = boot.indexOf('export function shutdownSyncRuntime');
    expect(boot.indexOf('unsubscribeDataChanges?.()', shutdown)).toBeGreaterThan(shutdown);
    expect(subscribe).toBeGreaterThan(-1);
  });
});

// ============================================================================================================================
describe('Envoi volontaire des anciennes données', () => {
  it('l’aperçu est en lecture seule, sans réseau, et ne compte que le périmètre Immobilier (ni tontine, ni CEET/TDE, ni contact libre)', async () => {
    await seedLegacy();
    await activateSync(T_ACTIVATION);
    const before = JSON.stringify(snapshotCollections());
    const preview = await previewLegacyAdoption();
    const kinds = preview.byKind.map((k) => k.kind);
    for (const kind of ['immobilier.bien', 'immobilier.logement', 'immobilier.contrat', 'immobilier.paiement', 'immobilier.depense', 'core.contact']) expect(kinds).toContain(kind);
    expect(kinds.some((k) => k.startsWith('tontine') || k.startsWith('ceet') || k.startsWith('tde'))).toBe(false);
    expect(preview.total).toBe(preview.byKind.reduce((sum, k) => sum + k.count, 0));
    expect(preview.total).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(snapshotCollections())).toBe(before);
    expect(cloud.log).toEqual([]);
    expect((await activationStore.load()).adoptedIds).toEqual([]);
  });

  it('refusée sans confirmation, sans compte, sans activation, dans la démonstration : rien ne change, aucune sauvegarde écrite', async () => {
    await seedLegacy();
    await expect(previewLegacyAdoption()).rejects.toMatchObject({ code: 'not_activated' });
    await expect(adoptLegacyData({ confirmed: true })).rejects.toMatchObject({ code: 'not_activated' });
    await activateSync(T_ACTIVATION);
    await expect(adoptLegacyData({ confirmed: false })).rejects.toMatchObject({ code: 'not_confirmed' });
    await expect(adoptLegacyData({ confirmed: undefined as never })).rejects.toMatchObject({ code: 'not_confirmed' });
    expect((await activationStore.load()).adoptedIds).toEqual([]);
    expect(safetyKeys()).toEqual([]);
    setSyncAccount(null);
    await expect(adoptLegacyData({ confirmed: true })).rejects.toMatchObject({ code: 'no_account' });
    setSyncAccount('alice');
    await switchWorkspace('demo');
    await expect(previewLegacyAdoption()).rejects.toMatchObject({ code: 'demo_workspace' });
    await switchWorkspace('personal');
    expect((await queued()).length).toBe(0);
  });

  it('la sauvegarde de sécurité est écrite ET relue avant la décision ; si elle échoue, rien n’est adopté', async () => {
    await seedLegacy();
    await activateSync(T_ACTIVATION);
    mockFailSafetyWrites = true;
    await expect(adoptLegacyData({ confirmed: true })).rejects.toMatchObject({ code: 'safety_failed' });
    expect((await activationStore.load()).adoptedIds).toEqual([]);
    expect(await capture()).toMatchObject({ enqueued: 0 });
    mockFailSafetyWrites = false;
    const result = await adoptLegacyData({ confirmed: true });
    expect(result.safetyKey).not.toBeNull();
    expect(safetyKeys()).toHaveLength(1);
    const saved = JSON.parse(mockMemory.get(safetyKeys()[0]) as string) as { checksum: string; data: { records: unknown[] } };
    expect(saved.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.data.records.length).toBeGreaterThan(0);
  });

  it('adopter n’envoie rien tout de suite : le moteur envoie ensuite exactement ce que l’aperçu annonçait, sans doublon, sans toucher aux données locales', async () => {
    await seedLegacy();
    await activateSync(T_ACTIVATION);
    const preview = await previewLegacyAdoption();
    const before = JSON.stringify(snapshotCollections());
    const result = await adoptLegacyData({ confirmed: true });
    expect(result.willSend).toBe(preview.total);
    expect(cloud.log).toEqual([]); // la décision elle-même n'écrit rien dans le cloud
    expect(JSON.stringify(snapshotCollections())).toBe(before);
    const report = await push();
    expect(report.confirmed).toHaveLength(preview.total);
    expect(report.permanentErrors).toEqual([]);
    expect(Object.keys((await baselineStore.load()).entries)).toHaveLength(preview.total);
    // le reste (tontine, CEET/TDE, contact libre) n'est jamais parti
    expect(Object.keys((await baselineStore.load()).entries)).not.toContain('rec-facture-ancienne');
    expect(Object.keys((await baselineStore.load()).entries)).not.toContain('contact-libre-ancien');
    expect(JSON.stringify(snapshotCollections())).toBe(before);
    // idempotent : une seconde décision n'ajoute rien, et un nouveau passage n'envoie plus rien
    expect(await adoptLegacyData({ confirmed: true })).toMatchObject({ adopted: 0, willSend: 0, safetyKey: null });
    expect(await previewLegacyAdoption()).toMatchObject({ total: 0, legacyCount: 0 });
    expect((await push()).confirmed).toEqual([]);
  });

  it('une donnée récente liée à une ancienne donnée attend l’adoption puis part avec elle, jamais avant', async () => {
    const { contrat } = await seedLegacy();
    await activateSync(T_ACTIVATION);
    const recent = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 10, 12)); // nouveau paiement d'un ancien contrat
    expect((await push()).confirmed).toEqual([]);
    expect(Object.keys((await baselineStore.load()).entries)).not.toContain(recent.id);
    const preview = await previewLegacyAdoption();
    expect(preview.total).toBeGreaterThan(preview.legacyCount); // le paiement récent s'ajoute aux anciennes données
    await adoptLegacyData({ confirmed: true });
    const report = await push();
    expect(report.confirmed).toContain(recent.id);
    expect(report.confirmed).toHaveLength(preview.total);
  });

  it('planAdoption est pur : il ne modifie ni l’activation ni la référence qu’on lui donne', async () => {
    await seedLegacy();
    const { data } = await activateSync(T_ACTIVATION);
    const baseline = await baselineStore.load();
    const frozen = JSON.stringify([data, baseline]);
    planAdoption([], data, baseline);
    expect(JSON.stringify([data, baseline])).toBe(frozen);
  });

  it('l’écran n’offre l’envoi qu’après un aperçu et une confirmation, et rien ne l’appelle automatiquement', () => {
    const card = fs.readFileSync(path.join(root, 'features/profile/components/LegacyAdoptionCard.tsx'), 'utf8');
    expect(card).toContain('Voir ce qui serait envoyé');
    expect(card).toContain('confirmed: true');
    const callers = ['services', 'store', 'app', 'features', 'components'].flatMap((dir) => walk(path.join(root, dir))).filter((f) => !f.includes('__tests__') && /adoptLegacyData\(/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort()).toEqual(['features/profile/components/LegacyAdoptionCard.tsx', 'services/sync/legacyAdoption.ts']);
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

// ============================================================================================================================
describe('Correction et annulation d’un paiement confirmé', () => {
  /** Paiement créé APRÈS l'activation et confirmé par le cloud. */
  async function confirmedPayment() {
    await activateSync(T_ACTIVATION);
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 30000, dateEntree: new Date(2026, 8, 5), dernierLoyerPaye: '2026-08' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const report = await push();
    expect(report.confirmed).toContain(paiement.id);
    return paiement;
  }

  it('saisie vérifiée en français : motif obligatoire et borné, montant en chiffres supérieur à zéro et différent du montant actuel', () => {
    expect(parseCorrectedAmount('45 000')).toBe(45000);
    expect(parseCorrectedAmount('45000 FCFA')).toBe(45000);
    for (const bad of ['', '0', '-5', '12,5', 'abc', '1e3']) expect(parseCorrectedAmount(bad)).toBeNull();
    expect(paymentCorrectionProblem({ type: 'annulation', reason: '   ' })).toMatch(/motif/);
    expect(paymentCorrectionProblem({ type: 'annulation', reason: 'x'.repeat(501) })).toMatch(/trop long/);
    expect(paymentCorrectionProblem({ type: 'annulation', reason: 'Erreur' })).toBeNull();
    expect(paymentCorrectionProblem({ type: 'correction', reason: 'Erreur', amountText: '0' })).toMatch(/Annuler le paiement/);
    expect(paymentCorrectionProblem({ type: 'correction', reason: 'Erreur', amountText: '30000', currentAmount: 30000 })).toMatch(/déjà celui/);
    expect(paymentCorrectionProblem({ type: 'correction', reason: 'Erreur', amountText: '25000', currentAmount: 30000 })).toBeNull();
  });

  it('un paiement purement local se modifie comme avant ; un paiement confirmé doit passer par une correction', async () => {
    await activateSync(T_ACTIVATION);
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 30000, dateEntree: new Date(2026, 8, 5), dernierLoyerPaye: '2026-08' });
    const local = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    expect(await mustCorrectPayment(local)).toBe(false); // jamais confirmé par le cloud
    await push();
    expect(await mustCorrectPayment(local)).toBe(true);
    setSyncAccount(null);
    expect(await mustCorrectPayment(local)).toBe(false); // sans compte actif, comportement d'origine
  });

  it('une correction ajoute un NOUVEAU fait (le paiement initial ne change pas), se synchronise, et le moteur est prévenu', async () => {
    const paiement = await confirmedPayment();
    const initial = JSON.stringify(records.find((r) => r.id === paiement.id));
    const signal = jest.fn();
    const stop = subscribeDataChanges(signal);
    const refused = await submitPaymentCorrection({ paymentId: paiement.id, type: 'correction', reason: '', amountText: '25000' });
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/motif/) });
    expect(signal).not.toHaveBeenCalled();
    const result = await submitPaymentCorrection({ paymentId: paiement.id, type: 'correction', reason: 'Montant mal saisi', amountText: '25 000', currentAmount: 30000 });
    expect(result.ok).toBe(true);
    expect(signal).toHaveBeenCalledTimes(1);
    stop();
    expect(JSON.stringify(records.find((r) => r.id === paiement.id))).toBe(initial);
    const history = await paymentCorrectionHistory(paiement.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: 'correction', correctedAmount: 25000, reason: 'Montant mal saisi' });
    const report = await push();
    expect(report.confirmed).toHaveLength(1); // la correction part comme tout fait financier : une création
    expect(report.permanentErrors).toEqual([]);
    expect(cloud.log.length).toBeGreaterThan(0);
  });

  it('une annulation est définitive : une seconde annulation ou une correction après coup est refusée avec un message clair', async () => {
    const paiement = await confirmedPayment();
    expect(await submitPaymentCorrection({ paymentId: paiement.id, type: 'annulation', reason: 'Paiement reçu en double' })).toMatchObject({ ok: true });
    expect(await submitPaymentCorrection({ paymentId: paiement.id, type: 'annulation', reason: 'Encore' })).toEqual({ ok: false, message: 'Ce paiement est déjà annulé : une annulation est définitive.' });
    expect(await submitPaymentCorrection({ paymentId: paiement.id, type: 'correction', reason: 'Trop tard', amountText: '10000' })).toMatchObject({ ok: false });
    expect(Object.keys((await correctionStore.load()).items)).toHaveLength(1);
  });

  it('la chronologie des loyers affiche « Annulé » pour une annulation explicite (le mois redevient à payer), et rien de tel pour une correction ou un rejet manuel', async () => {
    const paiement = await confirmedPayment();
    const contratId = String(paiement.values.contrat);
    const timeline = async () => {
      const detail = await loadContratDetail(contratId);
      return buildPaiementTimeline(detail!.contrat, detail!.paiements, new Date(2026, 10, 20)).filter((r) => r.mois === paiement.values.mois);
    };
    expect((await timeline()).map((r) => r.status)).toEqual(['paye']);
    await submitPaymentCorrection({ paymentId: paiement.id, type: 'correction', reason: 'Montant mal saisi', amountText: '25000', currentAmount: 30000 });
    const corrected = await timeline();
    expect(corrected.map((r) => r.status)).toEqual(['paye']); // une correction reste un paiement
    expect(corrected[0].montant).toBe(25000);
    await submitPaymentCorrection({ paymentId: paiement.id, type: 'annulation', reason: 'Paiement reçu en double' });
    const annulled = await timeline();
    expect(annulled).toHaveLength(2);
    expect(annulled.map((r) => r.status)).toContain('annule');
    expect(annulled.some((r) => r.status === 'en_retard' || r.status === 'a_payer')).toBe(true); // le mois redevient à payer
    const row = annulled.find((r) => r.status === 'annule');
    expect(row?.paiement?.id).toBe(paiement.id);
  });

  it('un paiement rejeté à la main (sans annulation explicite) n’est jamais présenté comme « Annulé »', async () => {
    await activateSync(T_ACTIVATION);
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 30000, dateEntree: new Date(2026, 8, 5), dernierLoyerPaye: '2026-08' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    (records.find((r) => r.id === paiement.id) as { statusKey: string }).statusKey = 'rejete';
    const detail = await loadContratDetail(contrat.id);
    expect(buildPaiementTimeline(detail!.contrat, detail!.paiements, new Date(2026, 10, 20)).some((r) => r.status === 'annule')).toBe(false);
  });

  it('paiement introuvable ou sans compte : refus en français, rien n’est écrit', async () => {
    await activateSync(T_ACTIVATION);
    expect(await submitPaymentCorrection({ paymentId: 'inconnu', type: 'annulation', reason: 'Test' })).toEqual({ ok: false, message: 'Ce paiement est introuvable.' });
    setSyncAccount(null);
    const refused = await submitPaymentCorrection({ paymentId: 'inconnu', type: 'annulation', reason: 'Test' });
    expect(refused.ok).toBe(false);
    expect(Object.keys((await correctionStore.load().catch(() => ({ items: {} }))).items)).toHaveLength(0);
  });
});

// ============================================================================================================================
describe('Le cloud refuse tout : service suspendu, rien n’est bloqué ni perdu', () => {
  const denyAll = (real: SyncTransport): SyncTransport => ({
    push: async () => {
      throw new SyncTransportError('permission', 'Accès refusé par les règles de sécurité.');
    },
    read: (kind, id) => real.read(kind, id),
  });
  const denyOnly = (real: SyncTransport, recordId: string): SyncTransport => ({
    push: async (request: PushRequest) => {
      if (request.recordId === recordId) throw new SyncTransportError('permission', 'Accès refusé par les règles de sécurité.');
      return real.push(request);
    },
    read: (kind, id) => real.read(kind, id),
  });

  async function twoNewItems() {
    await activateSync(T_ACTIVATION);
    const a = await createBien({ nom: 'A', adresse: 'X' });
    const b = await createBien({ nom: 'B', adresse: 'Y' });
    await capture();
    return { a, b };
  }

  it('refus de tout : arrêt « suspended », AUCUN blocage définitif, la file est intacte et repart au retour du service', async () => {
    const { a, b } = await twoNewItems();
    const report = await run(denyAll(transport()));
    expect(report.stopped).toBe('suspended');
    expect(report.permanentErrors).toEqual([]);
    expect(report.confirmed).toEqual([]);
    const ops = await queued();
    expect(ops.map((o) => o.recordId).sort()).toEqual([a.id, b.id].sort());
    expect(ops.every((o) => !o.block && !o.inFlight && !o.uncertain)).toBe(true);
    // à l'écran : « en attente », pas « refusé par le cloud »
    const status = await engineStatus();
    expect(status.errors).toEqual([]);
    expect(status.pending).toBe(2);
    // plusieurs tentatives pendant la coupure ne bloquent toujours rien
    for (let i = 0; i < 12; i += 1) expect((await run(denyAll(transport()))).stopped).toBe('suspended');
    expect((await queued()).every((o) => !o.block)).toBe(true);
    // le service revient : les envois en attente repartent, sans doublon
    const back = await run();
    expect(back.confirmed.sort()).toEqual([a.id, b.id].sort());
    expect(back.stopped).toBeNull();
    expect(await queued()).toEqual([]);
  });

  it('refus propre à UN élément alors que le reste est accepté : cet élément est bloqué (comme avant), les autres partent', async () => {
    const { a, b } = await twoNewItems();
    const report = await run(denyOnly(transport(), a.id));
    expect(report.confirmed).toEqual([b.id]);
    expect(report.permanentErrors).toEqual([a.id]);
    expect(report.stopped).toBeNull();
    expect((await queued()).find((o) => o.recordId === a.id)?.block?.reason).toBe('permanent_error');
    expect((await engineStatus()).errors).toEqual([a.id]);
  });

  it('le cycle passe en « suspended », reprend lentement, et un simple changement local ne relance pas d’envoi voué à l’échec', async () => {
    await twoNewItems();
    let now = Date.parse('2026-10-23T10:00:00.000Z');
    const timers: { at: number; fn: () => void }[] = [];
    const real = transport();
    const cycle = createSyncCycle({
      transports: () => ({ push: denyAll(real), pull: { pull: async () => { throw new SyncTransportError('permission', 'Accès refusé par les règles de sécurité.'); } } }),
      isOnline: () => true,
      now: () => new Date(now),
      schedule: (fn, delay) => {
        const entry = { at: now + delay, fn };
        timers.push(entry);
        return () => void timers.splice(timers.indexOf(entry), 1);
      },
      scope: () => EARLY,
      random: () => 0.5,
    });
    cycle.start();
    const first = await cycle.trigger('start');
    expect(first.ran).toBe(true);
    expect(cycle.state()).toMatchObject({ status: 'suspended', lastError: expect.stringMatching(/règles de sécurité/), consecutiveFailures: 0 });
    expect(cycle.state().nextAttemptAt).toBe(new Date(now + 30 * 60_000).toISOString()); // reprise lente, pas de rafale
    now += 60_000;
    expect(await cycle.trigger('push_only')).toMatchObject({ ran: false, skipped: 'suspended' }); // un changement local ne relance pas d'envoi
    now += 60_000;
    expect((await cycle.trigger('manual')).ran).toBe(true); // une action manuelle, elle, essaie
    expect(cycle.state().status).toBe('suspended');
    expect((await queued()).every((o) => !o.block)).toBe(true);
    cycle.stop();
  });

  it('le bandeau explique la suspension dans un langage clair et la range parmi les pauses', () => {
    const summary = { account: 'alice', states: {}, pending: 3, conflicts: [], errors: [], recoverable: [] };
    const banner = bannerModel(summary, { status: 'suspended' });
    expect(banner.tone).toBe('paused');
    expect(banner.summary).toMatch(/Service temporairement suspendu/);
    expect(banner.summary).toMatch(/3 en attente/);
    expect(banner.summary).not.toMatch(/Firebase|Firestore|règles/i);
  });
});
