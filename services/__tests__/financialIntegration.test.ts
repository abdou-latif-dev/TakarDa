// Phase 6, étape 5 — la vue des paiements effectifs est BRANCHÉE dans les chargeurs réels (rapport, statistiques, détail du contrat, loyer à
// enregistrer, avances) et les garde-fous de mutation protègent les faits confirmés. Sans compte actif ou sans correction : résultats identiques
// à ceux des chargeurs d'origine. Aucune donnée locale n'est modifiée par une correction.

import * as dbModule from '../db';
import { createBien, createLocataireEtContrat, deleteBienCascade, deleteContratCascade, enregistrerPaiementLoyer, listBiensWithSummary, loadContratDetail, resetImmobilierToolCache } from '../immobilierService';
import { loadImmobilierReport } from '../immobilierReportService';
import { loadImmobilierStats } from '../moduleStatsService';
import { effectivePaiementsFor, adviseMutation, deletionBlockedReason } from '../effectivePayments';
import { switchWorkspace } from '../persistence';
import { recordCorrection } from '../sync/financialCorrection';
import { KIND } from '../sync/kindRegistry';
import { setSyncAccount } from '../sync/syncAccount';
import { baselineStore } from '../sync/syncQueue';
import { coreService } from '../coreService';

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

beforeEach(async () => {
  mockMemory.clear();
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount(null);
});

async function seed() {
  const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  return { bien, contrat, paiement };
}
const rec = (p: { id: string; toolId: string; entityDefinitionId: string }) => ({ id: p.id, toolId: p.toolId, entityDefinitionId: p.entityDefinitionId });
const confirm = (id: string) => baselineStore.update((b) => ({ ...b, entries: { ...b.entries, [id]: { kind: KIND.IMMOBILIER_PAIEMENT, hash: 'a'.repeat(64), rev: 1 } } }));
const correct = (targetId: string, type: 'annulation' | 'correction', correctedAmount?: number) =>
  recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId, type, reason: 'Erreur de saisie', correctedAmount, now: new Date() });

describe('Sans correction : résultats strictement identiques', () => {
  it('sans compte actif : la façade rend le même tableau, sans lire le stockage', async () => {
    await seed();
    const all = await coreService.getRecords({});
    expect(await effectivePaiementsFor(all)).toBe(all);
  });

  it('avec un compte mais sans correction : rapport, statistiques et détail identiques à ceux sans compte', async () => {
    const { contrat } = await seed();
    const refReport = await loadImmobilierReport({ period: PERIOD }, NOW);
    const refStats = await loadImmobilierStats('all', NOW);
    const refDetail = await loadContratDetail(contrat.id);
    const refSummary = await listBiensWithSummary();
    setSyncAccount('alice');
    expect((await loadImmobilierReport({ period: PERIOD }, NOW))?.report).toEqual(refReport?.report);
    expect(await loadImmobilierStats('all', NOW)).toEqual(refStats);
    expect(await loadContratDetail(contrat.id)).toEqual(refDetail);
    expect(await listBiensWithSummary()).toEqual(refSummary);
    expect(refReport?.report.loyers.encaisses).toBe(25000);
  });
});

describe('Avec corrections : totaux cohérents dans les chargeurs réels', () => {
  it('correction de montant : rapport, statistiques et détail du contrat suivent ; l’enregistrement local ne bouge pas', async () => {
    const { contrat, paiement } = await seed();
    setSyncAccount('alice');
    await correct(paiement.id, 'correction', 20000);
    expect((await loadImmobilierReport({ period: PERIOD }, NOW))?.report.loyers.encaisses).toBe(20000);
    expect((await loadImmobilierStats('all', NOW))?.encaisse).toMatchObject({ amount: 20000, count: 1 });
    const detail = await loadContratDetail(contrat.id);
    expect(detail?.paiements.find((p) => p.id === paiement.id)?.values.montant).toBe(20000);
    expect((await coreService.getRecord(paiement.id))?.values.montant).toBe(25000);
  });

  it('annulation : le loyer n’est plus encaissé, le mois est de nouveau à payer et un nouveau loyer peut être enregistré', async () => {
    const { contrat, paiement } = await seed();
    setSyncAccount('alice');
    await correct(paiement.id, 'annulation');
    const report = (await loadImmobilierReport({ period: PERIOD }, NOW))?.report;
    expect(report?.loyers.encaisses).toBe(0);
    expect((await loadImmobilierStats('all', NOW))?.encaisse).toMatchObject({ amount: 0, count: 0 });
    expect((await coreService.getRecord(paiement.id))?.statusKey).toBe('paye');
    const next = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 13));
    expect(next.values.mois).toBe(paiement.values.mois); // le mois annulé redevient le prochain mois dû
  });

  it('la correction d’un autre compte n’affecte pas le compte actif', async () => {
    const { paiement } = await seed();
    setSyncAccount('alice');
    await correct(paiement.id, 'annulation');
    setSyncAccount('bob');
    expect((await loadImmobilierReport({ period: PERIOD }, NOW))?.report.loyers.encaisses).toBe(25000);
  });
});

describe('Garde-fous de mutation', () => {
  it('suppression d’un contrat ou d’un bien : refusée tant qu’un paiement confirmé existe, rien n’est supprimé', async () => {
    const { bien, contrat, paiement } = await seed();
    setSyncAccount('alice');
    await confirm(paiement.id);
    await expect(deleteContratCascade(contrat.id)).rejects.toThrow(/annulez-les/);
    await expect(deleteBienCascade(bien.id)).rejects.toThrow(/annulez-les/);
    expect(await coreService.getRecord(paiement.id)).not.toBeNull();
    expect(await coreService.getRecord(contrat.id)).not.toBeNull();
    expect(await coreService.getRecord(bien.id)).not.toBeNull();
  });

  it('paiement purement local ou sans compte : suppression en cascade comme aujourd’hui', async () => {
    const { bien, paiement } = await seed();
    setSyncAccount('alice'); // compte actif mais rien de confirmé
    await deleteBienCascade(bien.id);
    expect(await coreService.getRecord(paiement.id)).toBeNull();
    expect(await deletionBlockedReason([])).toBeNull();
  });

  it('rejet ou validation d’un paiement confirmé : conseil « annulation » / « correction » ; permis sinon', async () => {
    const { paiement } = await seed();
    setSyncAccount('alice');
    expect((await adviseMutation(rec(paiement), 'reject')).allowed).toBe(true);
    await confirm(paiement.id);
    expect(await adviseMutation(rec(paiement), 'reject')).toMatchObject({ allowed: false, instead: 'annulation' });
    expect(await adviseMutation(rec(paiement), 'edit')).toMatchObject({ allowed: false, instead: 'correction' });
  });
});
