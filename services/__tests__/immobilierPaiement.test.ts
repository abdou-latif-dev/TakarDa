// Parcours « Enregistrer le paiement » du module Immobilier — logique réelle
// (db en mémoire + coreService), seul le délai artificiel du mock est supprimé.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import {
  buildPaiementTimeline,
  computeContratLateness,
  computeNextDueMonth,
  computeUnpaidDueMonths,
  createBien,
  createLocataireEtContrat,
  enregistrerPaiementLoyer,
  ensureImmobilierTool,
} from '../immobilierService';
import type { RecordItem } from '@/types/entities';

// Contrat/paiements synthétiques pour les cas de trous (logique pure).
const fakeContrat = (values: Record<string, unknown> = {}): RecordItem =>
  ({ id: 'c', statusKey: 'actif', values: { date_entree: '2026-01-01', dernier_loyer_paye: null, loyer_mensuel: 50000, ...values }, createdAt: '2026-01-01T00:00:00Z' }) as unknown as RecordItem;
const fakePaid = (...months: string[]): RecordItem[] =>
  months.map((mois) => ({ id: `p-${mois}`, statusKey: 'paye', values: { contrat: 'c', mois, montant: 50000 } }) as unknown as RecordItem);

let counter = 0;

async function newContrat(opts: { loyer?: number; dernierLoyerPaye?: string | null; dateEntree?: Date } = {}): Promise<RecordItem> {
  counter += 1;
  const bien = await createBien({ nom: `Maison ${counter}`, adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: `Chambre ${counter}` },
    nom: `Locataire ${counter}`,
    telephone: '90123456',
    loyerMensuel: opts.loyer ?? 50000,
    dateEntree: opts.dateEntree ?? new Date(2026, 0, 5),
    dernierLoyerPaye: opts.dernierLoyerPaye === undefined ? '2026-09' : opts.dernierLoyerPaye,
  });
  return contrat;
}

async function paiementsOf(contratId: string): Promise<RecordItem[]> {
  const ents = await ensureImmobilierTool();
  const all = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id });
  return all.filter((p) => p.values.contrat === contratId);
}

const nextOf = async (contrat: RecordItem) => computeNextDueMonth((await coreService.getRecord(contrat.id))!, await paiementsOf(contrat.id));

describe('Enregistrer le paiement (Immobilier)', () => {
  it('1. dernier loyer payé = septembre → prochain mois = octobre', async () => {
    const contrat = await newContrat();
    expect(await nextOf(contrat)).toBe('2026-10');
  });

  it('2. enregistrer octobre crée un paiement PAID complet (jamais PENDING)', async () => {
    const contrat = await newContrat();
    const now = new Date(2026, 9, 12);
    const p = await enregistrerPaiementLoyer(contrat.id, now);
    expect(p.statusKey).toBe('paye');
    expect(p.id).toBeTruthy(); // paymentId
    expect(p.values).toMatchObject({
      contrat: contrat.id,
      logement: contrat.values.logement,
      bien: contrat.values.bien,
      locataire_id: contrat.values.locataire_id,
      mois: '2026-10',
      montant: 50000,
      date_validation: '2026-10-12',
    });
    expect(p.createdAt).toBeTruthy();
    expect((await paiementsOf(contrat.id)).some((x) => x.statusKey === 'en_attente')).toBe(false);
  });

  it("3. octobre reste dans l'historique et 4. prochain mois = novembre", async () => {
    const contrat = await newContrat();
    await enregistrerPaiementLoyer(contrat.id);
    const fresh = (await coreService.getRecord(contrat.id))!;
    const timeline = buildPaiementTimeline(fresh, await paiementsOf(contrat.id), new Date(2026, 9, 12));
    expect(timeline.map((r) => `${r.mois}:${r.status}`)).toEqual(['2026-11:a_payer', '2026-10:paye']);
    expect(await nextOf(contrat)).toBe('2026-11');
  });

  it("5. aucun paiement précédent n'est écrasé", async () => {
    const contrat = await newContrat();
    const first = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 3));
    const snapshot = JSON.stringify(first);
    await enregistrerPaiementLoyer(contrat.id, new Date(2026, 10, 4));
    const ps = await paiementsOf(contrat.id);
    expect(ps).toHaveLength(2);
    expect(new Set(ps.map((p) => p.id)).size).toBe(2);
    expect(JSON.stringify(ps.find((p) => p.id === first.id))).toBe(snapshot);
  });

  it('6. le montant vient automatiquement du contrat', async () => {
    const contrat = await newContrat({ loyer: 73500 });
    const p = await enregistrerPaiementLoyer(contrat.id);
    expect(p.values.montant).toBe(73500);
  });

  it('7. plusieurs mois successifs, un par un', async () => {
    const contrat = await newContrat();
    const months: string[] = [];
    for (let i = 0; i < 4; i += 1) months.push(String((await enregistrerPaiementLoyer(contrat.id)).values.mois));
    expect(months).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(await nextOf(contrat)).toBe('2027-02');
  });

  it("8. un mois impayé ne disparaît pas automatiquement (pas de saut vers le mois courant)", async () => {
    const contrat = await newContrat({ dernierLoyerPaye: '2026-03' });
    // « Aujourd'hui » est bien plus tard : avril reste dû, puis mai.
    expect(await nextOf(contrat)).toBe('2026-04');
    await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 1));
    expect(await nextOf(contrat)).toBe('2026-05');
  });

  it('8b. un trou dans les paiements est signalé en premier (jan–mars payés, avril/mai non)', () => {
    const contrat = { id: 'c', statusKey: 'actif', values: { date_entree: '2026-01-01', dernier_loyer_paye: null }, createdAt: '2026-01-01T00:00:00Z' } as unknown as RecordItem;
    const paid = (mois: string) => ({ id: mois, statusKey: 'paye', values: { contrat: 'c', mois } }) as unknown as RecordItem;
    expect(computeNextDueMonth(contrat, ['2026-01', '2026-02', '2026-03', '2026-06'].map(paid))).toBe('2026-04');
    expect(computeNextDueMonth(contrat, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-06'].map(paid))).toBe('2026-05');
  });

  it("9. un mois avant la date d'entrée n'est jamais dû", async () => {
    const contrat = await newContrat({ dernierLoyerPaye: null, dateEntree: new Date(2026, 5, 20) });
    expect(await nextOf(contrat)).toBe('2026-06');
    const entreeApresDeclare = await newContrat({ dernierLoyerPaye: '2026-02', dateEntree: new Date(2026, 5, 20) });
    expect(await nextOf(entreeApresDeclare)).toBe('2026-06');
  });

  it("10. une date d'entrée future ne produit aucun retard", async () => {
    const contrat = await newContrat({ dernierLoyerPaye: null, dateEntree: new Date(2027, 2, 1) });
    const fresh = (await coreService.getRecord(contrat.id))!;
    const lateness = computeContratLateness(fresh, [], new Date(2026, 9, 4));
    expect(lateness.lateMonths).toBe(0);
    expect(lateness.key).not.toBe('retard');
    expect(await nextOf(contrat)).toBe('2027-03');
  });

  it('11. changer le loyer plus tard ne modifie pas les anciens paiements', async () => {
    const contrat = await newContrat({ loyer: 50000 });
    const old = await enregistrerPaiementLoyer(contrat.id);
    await coreService.updateRecord(contrat.id, { values: { loyer_mensuel: 60000 } });
    const next = await enregistrerPaiementLoyer(contrat.id);
    const ps = await paiementsOf(contrat.id);
    expect(ps.find((p) => p.id === old.id)!.values.montant).toBe(50000);
    expect(next.values.montant).toBe(60000);
  });

  it("12. rechargement/persistance conserve l'historique", async () => {
    jest.useFakeTimers();
    try {
      const contrat = await newContrat();
      const a = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 3));
      const b = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 10, 4));

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100); // autosave
      stop();
      expect(await AsyncStorage.getItem('@formease/core_records')).toContain(a.id);

      records.length = 0; // simule un redémarrage : mémoire vide…
      await hydrateDb(); // …puis relecture du stockage
      const ps = await paiementsOf(contrat.id);
      expect(ps.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
      expect(ps.every((p) => p.statusKey === 'paye')).toBe(true);
      expect(await nextOf(contrat)).toBe('2026-12');
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuse un double enregistrement simultané et un contrat terminé', async () => {
    const contrat = await newContrat();
    const [r1, r2] = await Promise.allSettled([enregistrerPaiementLoyer(contrat.id), enregistrerPaiementLoyer(contrat.id)]);
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(await paiementsOf(contrat.id)).toHaveLength(1);
    await coreService.updateRecord(contrat.id, { statusKey: 'termine' });
    await expect(enregistrerPaiementLoyer(contrat.id)).rejects.toThrow();
  });
});

describe('Trous dans l’historique (calcul période par période)', () => {
  const now = new Date(2026, 5, 10); // juin 2026

  it('mars payé, avril impayé, mai payé → avril reste impayé / en retard, mai payé', () => {
    const c = fakeContrat();
    const paid = fakePaid('2026-01', '2026-02', '2026-03', '2026-05');
    expect(computeUnpaidDueMonths(c, paid, new Date(2026, 4, 20))).toEqual(['2026-04']);
    expect(computeContratLateness(c, paid, new Date(2026, 4, 20))).toMatchObject({ key: 'retard', lateMonths: 1 });
    const rows = buildPaiementTimeline(c, paid, now).map((r) => r.mois + ":" + r.status);
    expect(rows).toEqual(['2026-06:a_payer', '2026-05:paye', '2026-04:en_retard', '2026-03:paye', '2026-02:paye', '2026-01:paye']);
    expect(computeNextDueMonth(c, paid)).toBe('2026-04');
  });

  it('février et mars impayés, avril payé → février et mars restent impayés', () => {
    const c = fakeContrat();
    const paid = fakePaid('2026-01', '2026-04');
    expect(computeUnpaidDueMonths(c, paid, new Date(2026, 3, 20))).toEqual(['2026-02', '2026-03']);
    expect(computeContratLateness(c, paid, new Date(2026, 3, 20))).toMatchObject({ key: 'retard', lateMonths: 2 });
    const late = buildPaiementTimeline(c, paid, new Date(2026, 3, 20)).filter((r) => r.status === 'en_retard').map((r) => r.mois);
    expect(late.sort()).toEqual(['2026-02', '2026-03']);
  });

  it('le prochain mois à enregistrer est toujours le premier mois dû non payé', () => {
    const c = fakeContrat();
    expect(computeNextDueMonth(c, fakePaid('2026-01', '2026-04'))).toBe('2026-02');
    expect(computeNextDueMonth(c, fakePaid('2026-01', '2026-02', '2026-04'))).toBe('2026-03');
    expect(computeNextDueMonth(c, fakePaid('2026-01', '2026-02', '2026-03', '2026-04'))).toBe('2026-05');
    expect(computeNextDueMonth(c, [])).toBe('2026-01');
  });

  it('enregistrer le trou le comble, puis le mois suivant le dernier paiement devient dû', async () => {
    const c = fakeContrat();
    const before = fakePaid('2026-01', '2026-04');
    expect(computeNextDueMonth(c, before)).toBe('2026-02');
    expect(computeNextDueMonth(c, [...before, ...fakePaid('2026-02')])).toBe('2026-03');
    expect(computeNextDueMonth(c, [...before, ...fakePaid('2026-02', '2026-03')])).toBe('2026-05');
  });

  it('aucun mois avant la date d’entrée n’est dû (ni en retard)', () => {
    const c = fakeContrat({ date_entree: '2026-04-15' });
    expect(computeUnpaidDueMonths(c, [], new Date(2026, 5, 10))).toEqual(['2026-04', '2026-05']); // juin (en cours) = À payer, pas en retard
    const rows = buildPaiementTimeline(c, [], new Date(2026, 5, 10));
    expect(rows.filter((r) => r.status === 'en_retard').length).toBe(computeContratLateness(c, [], new Date(2026, 5, 10)).lateMonths);
    expect(rows.find((r) => r.mois === '2026-06')?.status).toBe('a_payer');
    expect(buildPaiementTimeline(c, [], new Date(2026, 5, 10)).map((r) => r.mois)).not.toContain('2026-03');
    expect(computeNextDueMonth(c, [])).toBe('2026-04');
  });

  it('une date d’entrée future ne produit aucun retard', () => {
    const c = fakeContrat({ date_entree: '2027-03-01' });
    expect(computeUnpaidDueMonths(c, [], new Date(2026, 9, 4))).toEqual([]);
    expect(computeContratLateness(c, [], new Date(2026, 9, 4)).lateMonths).toBe(0);
    expect(buildPaiementTimeline(c, [], new Date(2026, 9, 4)).every((r) => r.status !== 'en_retard')).toBe(true);
  });
});

describe('Dernier loyer payé = point de départ, pas un paiement', () => {
  it('ne crée aucun paiement (donc aucun « Payé — montant inconnu »)', async () => {
    const contrat = await newContrat({ dernierLoyerPaye: '2026-09' });
    expect(await paiementsOf(contrat.id)).toHaveLength(0);
    const rows = buildPaiementTimeline(contrat, [], new Date(2026, 9, 4));
    expect(rows.some((r) => r.status === 'paye')).toBe(false);
    expect(rows.map((r) => r.mois)).toEqual(['2026-10']);
    expect(computeNextDueMonth(contrat, [])).toBe('2026-10');
    // septembre déclaré n'est pas dû non plus : pas de retard avant le 1er octobre
    expect(computeUnpaidDueMonths(contrat, [], new Date(2026, 8, 20))).toEqual([]);
  });

  it('après le premier vrai paiement, le mois suivant devient le prochain à payer', async () => {
    const contrat = await newContrat({ dernierLoyerPaye: '2026-09' });
    const p = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 4));
    expect(p.values.mois).toBe('2026-10');
    expect(typeof p.values.montant).toBe('number');
    expect(await nextOf(contrat)).toBe('2026-11');
    const rows = buildPaiementTimeline((await coreService.getRecord(contrat.id))!, await paiementsOf(contrat.id), new Date(2026, 9, 4));
    expect(rows.map((r) => r.mois + ":" + r.status)).toEqual(['2026-11:a_payer', '2026-10:paye']);
    expect(rows.every((r) => r.status !== 'paye' || (r.paiement && r.montant !== null))).toBe(true);
  });

  it('persistance après redémarrage : trous et prochain mois inchangés', async () => {
    jest.useFakeTimers();
    try {
      const contrat = await newContrat({ dernierLoyerPaye: '2026-03' });
      await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 1)); // avril
      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0;
      await hydrateDb();
      expect(await paiementsOf(contrat.id)).toHaveLength(1);
      expect(await nextOf(contrat)).toBe('2026-05');
      expect(computeUnpaidDueMonths((await coreService.getRecord(contrat.id))!, await paiementsOf(contrat.id), new Date(2026, 6, 1))).toEqual(['2026-05', '2026-06']);
    } finally {
      jest.useRealTimers();
    }
  });
});
