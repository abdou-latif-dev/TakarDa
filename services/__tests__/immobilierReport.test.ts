// Rapport Immobilier : consultation informative, sans mélange avance / caution / loyers, sans double compte.

import { coreService } from '../coreService';
import { records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, ensureImmobilierTool } from '../immobilierService';
import { buildImmobilierReport, loadImmobilierReport } from '../immobilierReportService';
import { applyAdvanceCoverage, enableAdvanceUse } from '../rentAdvanceService';
import type { RecordItem } from '@/types/entities';

// jest.mock est remonté avant les imports par babel-jest.
jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const OCT = new Date(2026, 9, 12);
const NOV = new Date(2026, 10, 3);

async function tenant(bienId: string, nom: string, loyer: number, extra: { avance?: number; caution?: number; dernier?: string } = {}) {
  const { contrat } = await createLocataireEtContrat({
    bienId,
    nouveauLogement: { nom: `Logement ${nom}` },
    nom,
    telephone: '90123456',
    loyerMensuel: loyer,
    dateEntree: new Date(2026, 0, 5),
    avance: extra.avance ?? null,
    caution: extra.caution ?? null,
    dernierLoyerPaye: extra.dernier ?? '2026-09',
  });
  return contrat;
}

async function readAll() {
  const ents = await ensureImmobilierTool();
  const read = (id: string) => coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: id });
  const [biens, logements, contrats, paiements] = await Promise.all([read(ents.bien.id), read(ents.logement.id), read(ents.contrat.id), read(ents.paiement.id)]);
  return { biens, logements, contrats, paiements };
}

describe('Rapport Immobilier', () => {
  it('compte logements, loyers attendus / encaissés / en retard, avances et cautions — chacun à part', async () => {
    const b1 = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    const b2 = await createBien({ nom: 'Maison B', adresse: 'Kara' });
    const a = await tenant(b1.id, 'Ama', 25000, { avance: 75000, caution: 75000 });
    const b = await tenant(b1.id, 'Koffi', 30000, { caution: 60000 });
    await tenant(b2.id, 'Yao', 20000);
    await createBien({ nom: 'Maison vide', adresse: 'X' });

    await enableAdvanceUse(a.id, OCT); // octobre d'Ama : couvert par l'avance (PAS un loyer encaissé)
    await enregistrerPaiementLoyer(b.id, OCT); // octobre de Koffi : vrai paiement de 30 000

    const data = await readAll();
    const report = buildImmobilierReport(data, { period: '2026-10' }, OCT);

    expect(report.scope).toMatchObject({ kind: 'all', label: 'Tous les biens' });
    expect(report.logements).toEqual({ total: 3, occupes: 3, vacants: 0 });
    expect(report.loyers.attendus).toBe(25000 + 30000 + 20000);
    expect(report.loyers.encaisses).toBe(30000); // seulement le vrai paiement
    expect(report.loyers.paiements).toBe(1);
    expect(report.loyers.aPayer).toEqual({ contrats: 1, montant: 20000 }); // Yao : mois en cours non réglé
    expect(report.loyers.enRetard).toEqual({ contrats: 0, montant: 0 });
    expect(report.avances.couvertsCePeriode).toEqual({ mois: 1, montant: 25000 });
    expect(report.avances.enregistrees).toBe(75000);
    expect(report.avances.consommees).toBe(25000);
    expect(report.avances.disponibles).toBe(50000);
    expect(report.cautions).toEqual({ detenues: 135000, contrats: 2 }); // jamais ajoutées aux loyers
    expect(report.loyers.encaisses + report.cautions.detenues).not.toBe(report.loyers.encaisses);
    expect(report.missing.join(' ')).toContain('restitution');
  });

  it('rapport d’un bien : seulement ses logements, contrats et paiements', async () => {
    const b1 = await createBien({ nom: 'Maison A2', adresse: 'Lomé' });
    const b2 = await createBien({ nom: 'Maison B2', adresse: 'Kara' });
    const c1 = await tenant(b1.id, 'Esso', 25000);
    await tenant(b2.id, 'Afi', 40000);
    await enregistrerPaiementLoyer(c1.id, OCT);
    const data = await readAll();
    const report = buildImmobilierReport(data, { bienId: b1.id, period: '2026-10' }, OCT);
    expect(report.scope).toMatchObject({ kind: 'bien', label: 'Maison A2' });
    expect(report.logements.total).toBe(1);
    expect(report.loyers).toMatchObject({ attendus: 25000, encaisses: 25000, paiements: 1 });
  });

  it('un paiement n’est jamais compté deux fois (même enregistrement présent deux fois)', async () => {
    const b1 = await createBien({ nom: 'Maison D', adresse: 'Lomé' });
    const c = await tenant(b1.id, 'Doublon', 25000);
    const p = await enregistrerPaiementLoyer(c.id, OCT);
    const data = await readAll();
    const report = buildImmobilierReport({ ...data, paiements: [...data.paiements, p] }, { bienId: b1.id, period: '2026-10' }, OCT);
    expect(report.loyers.encaisses).toBe(25000);
    expect(report.loyers.paiements).toBe(1);
  });

  it('mois écoulé non réglé = en retard ; un mois couvert par l’avance ne l’est pas ; avance épuisée signalée', async () => {
    const b1 = await createBien({ nom: 'Maison E', adresse: 'Lomé' });
    const c = await tenant(b1.id, 'Retard', 25000, { avance: 25000 });
    const late = await tenant(b1.id, 'Impayé', 25000);
    await enableAdvanceUse(c.id, OCT);
    await applyAdvanceCoverage(c.id, NOV); // avance épuisée : novembre non couvert
    const data = await readAll();
    const oct = buildImmobilierReport(data, { bienId: b1.id, period: '2026-10' }, NOV);
    expect(oct.loyers.enRetard).toEqual({ contrats: 1, montant: 25000 }); // Impayé (octobre écoulé) ; Retard est couvert
    expect(oct.avances.contratsEpuises).toBe(1);
    expect(late).toBeTruthy();
  });

  it('données manquantes signalées, jamais inventées ; rapport en lecture seule', async () => {
    const b1 = await createBien({ nom: 'Maison F', adresse: 'Lomé' });
    const c = await tenant(b1.id, 'Sans loyer', 25000);
    await coreService.updateRecord(c.id, { values: { loyer_mensuel: null } });
    const before = JSON.stringify(records);
    const data = await readAll();
    const report = buildImmobilierReport(data, { bienId: b1.id, period: '2026-10' }, OCT);
    expect(report.loyers.attendus).toBe(0);
    expect(report.missing.join(' ')).toMatch(/sans loyer mensuel/);
    expect(JSON.stringify(records)).toBe(before);
    expect(report.period).toBe('2026-10');
  });

  it('période invalide : retombe sur le mois en cours', () => {
    const data = { biens: [], logements: [], contrats: [], paiements: [] } as { biens: RecordItem[]; logements: RecordItem[]; contrats: RecordItem[]; paiements: RecordItem[] };
    expect(buildImmobilierReport(data, { period: 'oups' }, OCT).period).toBe('2026-10');
    expect(buildImmobilierReport(data, { period: '2026-10' }, OCT).logements).toEqual({ total: 0, occupes: 0, vacants: 0 });
  });

  it('le chargeur lit sans rien écrire et renvoie aussi la liste des biens pour le sélecteur', async () => {
    const before = JSON.stringify(records);
    const loaded = await loadImmobilierReport({ period: '2026-10' }, OCT);
    expect(loaded).not.toBeNull();
    expect(loaded!.biens.length).toBeGreaterThan(0);
    expect(JSON.stringify(records)).toBe(before);
  });
});
