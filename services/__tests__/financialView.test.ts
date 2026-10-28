// P5 — totaux et faits financiers : les paiements « effectifs » (après corrections et annulations) donnent des totaux COHÉRENTS avec les formules
// existantes, sans les modifier ; sans correction, résultat strictement identique. La garde dit quoi faire d'un paiement déjà confirmé.
// Aucune donnée n'est modifiée, rien n'est branché.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { records } from '../db';
import { computeUnpaidDueMonths, createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { buildImmobilierReport } from '../immobilierReportService';
import { buildImmobilierStats } from '../moduleStatsService';
import { getAdvanceStatus } from '../rentAdvanceService';
import { switchWorkspace } from '../persistence';
import { adviseFinancialMutation, effectivePaiements, financialBlockers } from '../sync/financialView';
import { effectiveFinancialState, recordCorrection, correctionsOf } from '../sync/financialCorrection';
import { KIND } from '../sync/kindRegistry';
import { setSyncAccount } from '../sync/syncAccount';
import { baselineStore } from '../sync/syncQueue';
import { coreService } from '../coreService';
import type { RecordItem } from '@/types/entities';

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

const NOW = new Date(2026, 9, 20); // 20 octobre 2026
const PERIOD = '2026-10';
const T0 = new Date('2026-10-21T10:00:00.000Z');

beforeEach(async () => {
  mockMemory.clear();
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount('alice');
});

async function seed() {
  const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
  const { contrat, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
  const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
  return { bien, logement, contrat, paiement };
}
const all = (kind: string) => records.filter((r) => kindOfRecordSafe(r) === kind) as RecordItem[];
const kindOfRecordSafe = (r: RecordItem) => {
  const def = dbModule.entityDefinitions.find((d) => d.id === r.entityDefinitionId);
  return def?.key;
};
const input = (paiements: RecordItem[]) => ({ biens: all('bien'), logements: all('logement'), contrats: all('contrat'), paiements });
const correct = (targetId: string, type: 'annulation' | 'correction', correctedAmount?: number, at = T0) =>
  recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId, type, reason: 'Erreur de saisie', correctedAmount, now: at });

describe('Paiements effectifs : cohérence des totaux existants', () => {
  it('sans correction : les MÊMES enregistrements, donc rapport, statistiques, impayés et avance strictement identiques', async () => {
    const { contrat, paiement } = await seed();
    const original = all('paiement');
    const effective = effectivePaiements(original, []);
    expect(effective).toEqual(original);
    effective.forEach((p, i) => expect(p).toBe(original[i])); // mêmes références
    const a = buildImmobilierReport(input(original), { period: PERIOD }, NOW);
    const b = buildImmobilierReport(input(effective), { period: PERIOD }, NOW);
    expect(b).toEqual(a);
    expect(buildImmobilierStats(input(effective), NOW, 'all')).toEqual(buildImmobilierStats(input(original), NOW, 'all'));
    expect(computeUnpaidDueMonths(contrat, effective, NOW)).toEqual(computeUnpaidDueMonths(contrat, original, NOW));
    expect(getAdvanceStatus(contrat, effective)).toEqual(getAdvanceStatus(contrat, original));
    expect(a.loyers.encaisses).toBe(25000);
    expect(paiement.values.montant).toBe(25000);
  });

  it('correction de montant : seul le montant change, partout, de la même façon ; le paiement initial n’est pas modifié', async () => {
    const { paiement } = await seed();
    const before = JSON.stringify(paiement);
    await correct(paiement.id, 'correction', 20000);
    const effective = effectivePaiements(all('paiement'), await correctionsOf(paiement.id));
    const report = buildImmobilierReport(input(effective), { period: PERIOD }, NOW);
    expect(report.loyers.encaisses).toBe(20000);
    expect(report.loyers.paiements).toBe(1);
    expect(buildImmobilierStats(input(effective), NOW, 'all').encaisse).toMatchObject({ amount: 20000, count: 1 });
    expect(JSON.stringify(all('paiement')[0])).toBe(before); // données locales intactes
    expect(effective[0].values.montant).toBe(20000);
    expect(effective[0].statusKey).toBe('paye'); // toujours payé : seul le montant change
  });

  it('plusieurs corrections : la plus récente prévaut', async () => {
    const { paiement } = await seed();
    await correct(paiement.id, 'correction', 20000, new Date('2026-10-21T10:00:00Z'));
    await correct(paiement.id, 'correction', 22000, new Date('2026-10-21T10:05:00Z'));
    const effective = effectivePaiements(all('paiement'), await correctionsOf(paiement.id));
    expect(buildImmobilierReport(input(effective), { period: PERIOD }, NOW).loyers.encaisses).toBe(22000);
    expect(effectiveFinancialState(25000, await correctionsOf(paiement.id)).effectiveAmount).toBe(22000);
  });

  it('annulation : le loyer n’est plus encaissé, le mois redevient dû, de façon cohérente dans le rapport, les statistiques et les impayés', async () => {
    const { contrat, paiement } = await seed();
    const original = all('paiement');
    const before = buildImmobilierReport(input(original), { period: PERIOD }, NOW);
    const unpaidBefore = computeUnpaidDueMonths(contrat, original, NOW);
    expect(before.loyers).toMatchObject({ encaisses: 25000, paiements: 1 });
    await correct(paiement.id, 'annulation');
    const effective = effectivePaiements(original, await correctionsOf(paiement.id));
    const after = buildImmobilierReport(input(effective), { period: PERIOD }, NOW);
    expect(after.loyers.encaisses).toBe(0);
    expect(after.loyers.paiements).toBe(0);
    expect(after.loyers.enRetard.montant + after.loyers.aPayer.montant).toBe(25000); // le mois est de nouveau dû
    expect(buildImmobilierStats(input(effective), NOW, 'all').encaisse).toMatchObject({ amount: 0, count: 0 });
    expect(computeUnpaidDueMonths(contrat, effective, NOW).length).toBeGreaterThanOrEqual(unpaidBefore.length);
    expect(effective[0].statusKey).toBe('rejete');
    expect(original[0].statusKey).toBe('paye'); // l'enregistrement local n'a pas bougé
    expect(paiement.values.montant).toBe(25000);
  });

  it('annulation d’une couverture d’avance : le solde d’avance redevient disponible', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'C' }, nom: 'K', telephone: '90123456', loyerMensuel: 10000, avance: 30000, avanceUtilisable: true, dateEntree: new Date(2026, 8, 1) } as never);
    const cover = await coreService.createRecord({
      toolId: contrat.toolId,
      entityDefinitionId: dbModule.entityDefinitions.find((d) => d.key === 'paiement')!.id,
      statusKey: 'couvert',
      values: { contrat: contrat.id, montant: 10000, mois: '2026-09', date_couverture: '2026-09-01' },
    } as never);
    const live = all('paiement');
    const before = getAdvanceStatus(contrat, live);
    expect(before.consumed).toBe(10000);
    const corrections = [await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: cover.id, type: 'annulation', reason: 'Erreur', now: T0 })];
    const after = getAdvanceStatus(contrat, effectivePaiements(live, corrections));
    expect(after.consumed).toBe(0);
    expect(after.balance).toBe(before.balance + 10000);
  });

  it('correction orpheline (paiement absent) : ignorée sans erreur', async () => {
    await seed();
    const orphan = { id: 'c1', kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: 'absent', type: 'annulation', reason: 'x', correctedAmount: null, createdAt: 'a', updatedAt: 'a', createdBy: 'u-me' } as const;
    const effective = effectivePaiements(all('paiement'), [orphan]);
    expect(effective).toEqual(all('paiement'));
  });
});

describe('Garde des mutations de faits financiers confirmés', () => {
  const rec = (p: RecordItem) => ({ id: p.id, toolId: p.toolId, entityDefinitionId: p.entityDefinitionId });

  it('tant qu’un paiement est purement local (jamais confirmé), tout reste permis comme aujourd’hui', async () => {
    const { paiement } = await seed();
    for (const action of ['edit', 'reject', 'delete'] as const) expect(await adviseFinancialMutation(rec(paiement), action)).toEqual({ allowed: true, instead: 'none', reason: null });
    setSyncAccount(null);
    expect((await adviseFinancialMutation(rec(paiement), 'delete')).allowed).toBe(true);
  });

  it('un paiement confirmé par le cloud ne se modifie, ne se rejette ni ne se supprime plus directement : correction ou annulation à la place', async () => {
    const { paiement, contrat } = await seed();
    await baselineStore.update((b) => ({ ...b, entries: { ...b.entries, [paiement.id]: { kind: KIND.IMMOBILIER_PAIEMENT, hash: 'a'.repeat(64), rev: 1 } } }));
    expect(await adviseFinancialMutation(rec(paiement), 'edit')).toMatchObject({ allowed: false, instead: 'correction' });
    expect(await adviseFinancialMutation(rec(paiement), 'reject')).toMatchObject({ allowed: false, instead: 'annulation' });
    expect(await adviseFinancialMutation(rec(paiement), 'delete')).toMatchObject({ allowed: false, instead: 'blocked' });
    // suppression d'un contrat ou d'un bien avec ses paiements : les faits confirmés s'y opposent
    expect(await financialBlockers([rec(paiement), rec(contrat)])).toEqual([paiement.id]);
    // un élément non financier n'est jamais concerné
    expect((await adviseFinancialMutation(rec(contrat), 'delete')).allowed).toBe(true);
  });

  it('l’état d’un autre compte ne protège ni n’expose rien : la garde ne regarde que la référence du compte actif', async () => {
    const { paiement } = await seed();
    await baselineStore.update((b) => ({ ...b, entries: { ...b.entries, [paiement.id]: { kind: KIND.IMMOBILIER_PAIEMENT, hash: 'a'.repeat(64), rev: 1 } } }));
    setSyncAccount('bob');
    expect((await adviseFinancialMutation(rec(paiement), 'delete')).allowed).toBe(true); // confirmé pour Alice seulement
    setSyncAccount('alice');
    expect((await adviseFinancialMutation(rec(paiement), 'delete')).allowed).toBe(false);
  });
});

describe('Branchement (phase 6, étape 5)', () => {
  it('seules les façades services/effectivePayments.ts (lecture) et services/paymentCorrectionService.ts (saisie des corrections, F2) importent la vue effective ; les formules des totaux ne changent pas', () => {
    const root = path.join(__dirname, '..', '..');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const users = walk(root).filter((f) => !f.includes(`${path.sep}services${path.sep}sync${path.sep}`) && /sync\/financial(View|Correction)['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(root, f).replace(/\\/g, '/'))).toEqual(['services/effectivePayments.ts', 'services/paymentCorrectionService.ts']);
    for (const file of ['services/immobilierReportService.ts', 'services/moduleStatsService.ts', 'services/rentAdvanceService.ts']) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(/financialView|financialCorrection|syncAccount/);
    }
  });
});
