// Avance consommable : règles métier (jamais de faux paiement, jamais de double consommation, pas de rétroactivité).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import {
  buildPaiementTimeline,
  computeContratLateness,
  computeNextDueMonth,
  createBien,
  createLocataireEtContrat,
  enregistrerPaiementLoyer,
  ensureImmobilierTool,
} from '../immobilierService';
import { buildImmobilierStats } from '../moduleStatsService';
import { applyAdvanceCoverage, disableAdvanceUse, enableAdvanceUse, getAdvanceStatus, planAdvanceCoverage, reconcileAdvances } from '../rentAdvanceService';
import type { RecordItem } from '@/types/entities';

// jest.mock est remonté avant les imports par babel-jest.
jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

let counter = 0;
const OCT = new Date(2026, 9, 12);
const NOV = new Date(2026, 10, 3);
const DEC = new Date(2026, 11, 2);
const JAN = new Date(2027, 0, 4);

async function newContrat(opts: { loyer?: number; avance?: number | null; caution?: number | null; dernierLoyerPaye?: string | null } = {}): Promise<RecordItem> {
  counter += 1;
  const bien = await createBien({ nom: `Maison ${counter}`, adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: `Chambre ${counter}` },
    nom: `Locataire ${counter}`,
    telephone: '90123456',
    loyerMensuel: opts.loyer ?? 25000,
    dateEntree: new Date(2026, 0, 5),
    avance: opts.avance === undefined ? 75000 : opts.avance,
    caution: opts.caution === undefined ? 75000 : opts.caution,
    dernierLoyerPaye: opts.dernierLoyerPaye === undefined ? '2026-09' : opts.dernierLoyerPaye,
  });
  return contrat;
}

async function load(contrat: RecordItem) {
  const ents = await ensureImmobilierTool();
  const paiements = (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id })).filter((p) => p.values.contrat === contrat.id);
  const fresh = (await coreService.getRecord(contrat.id))!;
  return { contrat: fresh, paiements };
}

describe('Avance consommable — règles', () => {
  it('désactivée par défaut : aucun mois n’est couvert, rien ne change pour un contrat existant', async () => {
    const contrat = await newContrat();
    expect(contrat.values.avance_utilisable).toBeUndefined();
    expect(await reconcileAdvances(NOV)).toBe(0);
    const { paiements } = await load(contrat);
    expect(paiements).toHaveLength(0);
    expect(getAdvanceStatus(contrat, paiements)).toMatchObject({ authorized: false, active: false, balance: 75000, coveredMonths: 0 });
  });

  it('activée : couvre le mois dû, sans paiement ni reçu, et le mois n’est plus « à payer » ni en retard', async () => {
    const contrat = await newContrat();
    const covered = await enableAdvanceUse(contrat.id, OCT);
    expect(covered).toEqual([{ mois: '2026-10', montant: 25000 }]);
    const { contrat: fresh, paiements } = await load(contrat);
    expect(paiements).toHaveLength(1);
    const c = paiements[0];
    expect(c.statusKey).toBe('couvert');
    expect(c.values).toMatchObject({ mois: '2026-10', montant: 25000, source: 'avance', avance_avant: 75000, avance_restante: 50000, date_couverture: '2026-10-12' });
    expect(c.values.mode_paiement).toBeUndefined(); // pas de faux paiement espèces / Mobile Money / banque
    expect(c.values.date_validation).toBeUndefined(); // pas de validation de paiement
    expect(computeContratLateness(fresh, paiements, OCT).key).toBe('a_jour');
    expect(computeNextDueMonth(fresh, paiements)).toBe('2026-11'); // le prochain paiement réel va au mois suivant
    expect(buildPaiementTimeline(fresh, paiements, OCT).find((r) => r.mois === '2026-10')).toMatchObject({ status: 'couvert', montant: 25000 });
  });

  it('un mois à la fois, à l’échéance ; arrêt automatique quand l’avance est épuisée, avec signalement', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    expect((await applyAdvanceCoverage(contrat.id, NOV)).map((c) => c.mois)).toEqual(['2026-11']);
    expect((await applyAdvanceCoverage(contrat.id, DEC)).map((c) => c.mois)).toEqual(['2026-12']);
    let { contrat: fresh, paiements } = await load(contrat);
    expect(getAdvanceStatus(fresh, paiements)).toMatchObject({ balance: 0, consumed: 75000, coveredMonths: 3, monthsLeft: 0, exhausted: true });
    expect(await applyAdvanceCoverage(contrat.id, JAN)).toEqual([]); // janvier : plus d’avance, rien n’est couvert
    ({ contrat: fresh, paiements } = await load(contrat));
    expect(paiements).toHaveLength(3);
    expect(planAdvanceCoverage(fresh, paiements, JAN)).toMatchObject({ toCover: [], blockedMonth: '2027-01' });
    expect(computeContratLateness(fresh, paiements, new Date(2027, 1, 3)).key).toBe('retard'); // janvier devient un vrai impayé
    expect(computeNextDueMonth(fresh, paiements)).toBe('2027-01'); // un paiement normal redevient nécessaire
  });

  it('ne consomme jamais deux fois : appels répétés et redémarrage sans doublon', async () => {
    jest.useFakeTimers();
    try {
      const contrat = await newContrat();
      await enableAdvanceUse(contrat.id, OCT);
      await Promise.all([applyAdvanceCoverage(contrat.id, OCT), applyAdvanceCoverage(contrat.id, OCT), reconcileAdvances(OCT)]);
      await applyAdvanceCoverage(contrat.id, OCT);
      expect((await load(contrat)).paiements.filter((p) => p.statusKey === 'couvert')).toHaveLength(1);

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0; // redémarrage : mémoire vide puis relecture du stockage local
      await hydrateDb();
      await reconcileAdvances(OCT);
      const { contrat: fresh, paiements } = await load(contrat);
      expect(paiements.filter((p) => p.statusKey === 'couvert')).toHaveLength(1);
      expect(getAdvanceStatus(fresh, paiements).balance).toBe(50000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('pas de rétroactivité : les mois écoulés avant l’activation restent dus', async () => {
    const contrat = await newContrat({ dernierLoyerPaye: '2026-06' }); // juillet, août, septembre impayés
    await enableAdvanceUse(contrat.id, OCT);
    const { contrat: fresh, paiements } = await load(contrat);
    expect(paiements.map((p) => p.values.mois)).toEqual(['2026-10']); // seulement le mois d’activation
    expect(computeContratLateness(fresh, paiements, OCT)).toMatchObject({ key: 'retard', lateMonths: 3 });
  });

  it('jamais avant le début du contrat ni sur un mois futur', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    const { contrat: fresh, paiements } = await load(contrat);
    expect(planAdvanceCoverage(fresh, paiements, new Date(2026, 9, 31)).toCover).toEqual([]); // octobre déjà couvert, novembre pas encore dû
    expect(planAdvanceCoverage(fresh, paiements, new Date(2026, 5, 1)).toCover).toEqual([]); // date antérieure à l’activation
  });

  it('pas de couverture partielle : un reste inférieur à un loyer n’est jamais compté', async () => {
    const contrat = await newContrat({ avance: 60000 }); // 2 loyers + 10 000
    await enableAdvanceUse(contrat.id, OCT);
    await applyAdvanceCoverage(contrat.id, NOV);
    await applyAdvanceCoverage(contrat.id, DEC);
    const { contrat: fresh, paiements } = await load(contrat);
    expect(paiements.filter((p) => p.statusKey === 'couvert').map((p) => p.values.mois).sort()).toEqual(['2026-10', '2026-11']);
    expect(getAdvanceStatus(fresh, paiements)).toMatchObject({ balance: 10000, unusableRemainder: 10000, monthsLeft: 0, exhausted: true });
    expect(computeNextDueMonth(fresh, paiements)).toBe('2026-12'); // décembre n’est PAS couvert
  });

  it('loyer modifié après coup : les mois déjà couverts gardent leur loyer figé', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    await coreService.updateRecord(contrat.id, { values: { loyer_mensuel: 30000 } });
    await applyAdvanceCoverage(contrat.id, NOV);
    const { paiements } = await load(contrat);
    const byMois = Object.fromEntries(paiements.map((p) => [p.values.mois as string, p.values.montant]));
    expect(byMois).toEqual({ '2026-10': 25000, '2026-11': 30000 });
  });

  it('un vrai paiement existant n’est ni transformé ni doublé : le mois payé n’est pas consommé', async () => {
    const contrat = await newContrat();
    const real = await enregistrerPaiementLoyer(contrat.id, OCT); // octobre payé pour de vrai
    await enableAdvanceUse(contrat.id, OCT);
    let { contrat: fresh, paiements } = await load(contrat);
    expect(paiements.filter((p) => p.statusKey === 'couvert')).toHaveLength(0);
    expect(paiements.find((p) => p.id === real.id)?.statusKey).toBe('paye');
    await applyAdvanceCoverage(contrat.id, NOV);
    ({ contrat: fresh, paiements } = await load(contrat));
    expect(paiements.filter((p) => p.statusKey === 'couvert').map((p) => p.values.mois)).toEqual(['2026-11']);
    expect(getAdvanceStatus(fresh, paiements).balance).toBe(50000);
  });

  it('la couverture n’est jamais un revenu : les loyers encaissés ne bougent pas', async () => {
    const contrat = await newContrat();
    await enregistrerPaiementLoyer(contrat.id, OCT); // vrai paiement d’octobre : 25 000
    await enableAdvanceUse(contrat.id, OCT);
    await applyAdvanceCoverage(contrat.id, NOV);
    const ents = await ensureImmobilierTool();
    const [biens, logements, contrats, paiements] = await Promise.all([
      coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.bien.id }),
      coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.logement.id }),
      coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id }),
      coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id }),
    ]);
    const mine = paiements.filter((p) => p.values.contrat === contrat.id);
    expect(mine.some((p) => p.statusKey === 'couvert')).toBe(true);
    const stats = buildImmobilierStats({ biens, logements, contrats: contrats.filter((c) => c.id === contrat.id), paiements: mine }, NOV);
    expect(stats.encaisse).toMatchObject({ amount: 25000, count: 1 });
  });

  it('la caution ne couvre jamais un loyer : sans avance, rien n’est possible', async () => {
    const contrat = await newContrat({ avance: null, caution: 75000 });
    await expect(enableAdvanceUse(contrat.id, OCT)).rejects.toThrow(/pas d’avance/);
    expect((await load(contrat)).paiements).toHaveLength(0);
    expect(getAdvanceStatus((await load(contrat)).contrat, []).balance).toBe(0);
  });

  it('désactiver garde la trace des mois déjà couverts et stoppe la suite ; contrat terminé : plus rien', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    await disableAdvanceUse(contrat.id);
    expect(await applyAdvanceCoverage(contrat.id, NOV)).toEqual([]);
    expect((await load(contrat)).paiements.filter((p) => p.statusKey === 'couvert')).toHaveLength(1);

    const ended = await newContrat();
    await enableAdvanceUse(ended.id, OCT);
    await coreService.updateRecord(ended.id, { statusKey: 'termine' });
    expect(await applyAdvanceCoverage(ended.id, NOV)).toEqual([]);
    await expect(enableAdvanceUse(ended.id, NOV)).rejects.toThrow(/terminé/);
  });

  it('avance modifiée à la baisse sous le montant déjà consommé : solde nul, jamais négatif', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    await coreService.updateRecord(contrat.id, { values: { avance: 10000 } });
    const { contrat: fresh, paiements } = await load(contrat);
    expect(getAdvanceStatus(fresh, paiements)).toMatchObject({ balance: 0, exhausted: true });
    expect(planAdvanceCoverage(fresh, paiements, NOV).toCover).toEqual([]);
  });
});

afterAll(async () => {
  await AsyncStorage.clear();
});
