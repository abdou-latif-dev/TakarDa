// Moteur CEET/TDE (utilityBillingService) — relevés, précédent chronologique,
// consommation, répartition, snapshot, paiement, anciennes données, persistance.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesTool, type FacturesEntities } from '../facturesService';
import { createBien, createLocataireEtContrat } from '../immobilierService';
import {
  buildReceiptData,
  buildReceiptText,
  computeConsommation,
  computeConsommationChecked,
  computeConsommationStrict,
  computeRepartitionEquitable,
  computeRepartitionParCompteur,
  createFacturePartagee,
  enregistrerPaiementPart,
  findPreviousReleve,
  getPartPaymentInfo,
  isReleveUsed,
  markPartStatus,
  resolveParticipantReleves,
  resolvePreviousReleve,
  saveReleve,
  validateRepartition,
  validerFactureParCompteur,
  type Participant,
} from '../utilityBillingService';
import type { RecordItem } from '@/types/entities';

let ents: FacturesEntities;
let seq = 0;

beforeAll(async () => {
  ents = await ensureFacturesTool();
});

const releves = () => coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
const partsOf = async (factureId: string) =>
  (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id })).filter((p) => p.values.facture_partagee === factureId);

async function newParticipant(name: string): Promise<Participant> {
  seq += 1;
  const contact = await coreService.createExternalContact({ name: `${name} ${seq}` });
  return { type: 'contact', id: contact.id, label: contact.name };
}

const rel = (p: Participant, periode: string, index: number, fournisseur = 'ceet') =>
  saveReleve({ toolId: ents.tool.id, releveEntityDefinitionId: ents.releveDefinition.id, fournisseur, periode, participant: p, index });

async function newFacture(fournisseur: string, mois: string, montant: number): Promise<RecordItem> {
  return createFacturePartagee({
    toolId: ents.tool.id,
    facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id,
    values: { fournisseur, mois, montant_total: montant },
  });
}

/** 3 participants avec des relevés de février (précédent) et mars (actuel). */
async function setupCounter(fournisseur = 'ceet') {
  const [koffi, ama, yao] = [await newParticipant('Koffi'), await newParticipant('Ama'), await newParticipant('Yao')];
  for (const [p, prev, cur] of [[koffi, 100, 125], [ama, 150, 190], [yao, 200, 235]] as const) {
    await rel(p, '2026-02', prev, fournisseur);
    await rel(p, '2026-03', cur, fournisseur);
  }
  return { koffi, ama, yao, all: [koffi, ama, yao] };
}

describe('Relevés — validation', () => {
  it('accepte un index valide (0 inclus)', async () => {
    const p = await newParticipant('Valide');
    expect((await rel(p, '2026-01', 125)).values.index).toBe(125);
    expect((await rel(p, '2026-02', 0)).values.index).toBe(0);
  });

  it.each([[-1], [NaN], [Infinity], [-Infinity], ['12' as unknown as number], [null as unknown as number]])('refuse l\'index %p', async (bad) => {
    const p = await newParticipant('Invalide');
    await expect(rel(p, '2026-01', bad)).rejects.toMatchObject({ code: 'INDEX_INVALIDE' });
    expect((await releves()).filter((r) => r.values.participant_id === p.id)).toHaveLength(0);
  });

  it('refuse une période invalide et un fournisseur inconnu', async () => {
    const p = await newParticipant('Periode');
    await expect(rel(p, '2026-13', 10)).rejects.toMatchObject({ code: 'PERIODE_INVALIDE' });
    await expect(rel(p, 'mars', 10)).rejects.toMatchObject({ code: 'PERIODE_INVALIDE' });
    await expect(rel(p, '2026-01', 10, 'gaz')).rejects.toMatchObject({ code: 'FOURNISSEUR_INVALIDE' });
  });

  it('refuse un participant inexistant ou invalide', async () => {
    await expect(rel({ type: 'contact', id: 'inconnu', label: 'Fantôme' }, '2026-01', 10)).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(rel({ type: 'contrat', id: 'inconnu', label: 'Fantôme' }, '2026-01', 10)).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(rel({ type: 'contact', id: null, label: 'Sans id' }, '2026-01', 10)).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(rel({ type: 'manuel', id: null, label: '   ' }, '2026-01', 10)).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
  });

  it('accepte un participant externe sans compte, un participant libre et un participant venant d\'Immobilier', async () => {
    const externe = await newParticipant('Externe');
    const libre: Participant = { type: 'manuel', id: null, label: 'Atelier du coin' };
    const bien = await createBien({ nom: 'Maison Agoè', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'A1' }, nom: 'Locataire A1', telephone: '90123456', loyerMensuel: 50000 });
    const immo: Participant = { type: 'contrat', id: contrat.id, label: 'A1' };
    for (const p of [externe, libre, immo]) expect((await rel(p, '2026-04', 10)).values.index).toBe(10);
  });

  it('doublon participant + période + fournisseur : refusé, l\'ancien relevé n\'est jamais écrasé', async () => {
    const p = await newParticipant('Koffi');
    const first = await rel(p, '2026-09', 100);
    await expect(rel(p, '2026-09', 999)).rejects.toMatchObject({ code: 'RELEVE_DEJA_ENREGISTRE', message: expect.stringContaining('Relevé déjà enregistré pour Koffi') });
    expect((await releves()).find((r) => r.id === first.id)!.values.index).toBe(100);
    // même valeur : idempotent, aucun doublon créé
    expect((await rel(p, '2026-09', 100)).id).toBe(first.id);
    expect((await releves()).filter((r) => r.values.participant_id === p.id && r.values.mois === '2026-09')).toHaveLength(1);
  });

  it('relevé différent accepté (autre période, autre participant) et fournisseur respecté (CEET ≠ TDE)', async () => {
    const [a, b] = [await newParticipant('A'), await newParticipant('B')];
    await rel(a, '2026-05', 10);
    await rel(a, '2026-06', 20);
    await rel(b, '2026-05', 30);
    const eau = await rel(a, '2026-05', 5, 'tde');
    expect(eau.values.fournisseur).toBe('tde');
    const all = await releves();
    expect(findPreviousReleve(a, 'tde', '2026-06', all)!.values.index).toBe(5);
    expect(findPreviousReleve(a, 'ceet', '2026-06', all)!.values.index).toBe(10);
  });

  it('les anciens relevés enregistrés en « CEET » restent lisibles (comparaison insensible à la casse)', async () => {
    const p = await newParticipant('Ancien');
    await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.releveDefinition.id,
      values: { fournisseur: 'CEET', mois: '2026-01', compteur: p.label, index: 80, participant_type: 'contact', participant_id: p.id },
    });
    const all = await releves();
    expect(findPreviousReleve(p, 'ceet', '2026-02', all)!.values.index).toBe(80);
    await expect(rel(p, '2026-01', 90)).rejects.toMatchObject({ code: 'RELEVE_DEJA_ENREGISTRE' }); // pas de doublon avec l'ancien
  });
});

describe('Relevé précédent — strictement chronologique', () => {
  it('janvier → mars : janvier est utilisé et l\'écart (février) est signalé, jamais comblé', async () => {
    const p = await newParticipant('Ecart');
    await rel(p, '2026-01', 100);
    await rel(p, '2026-03', 150);
    const all = await releves();
    const r = resolvePreviousReleve(p, 'ceet', '2026-03', all);
    expect(r.releve!.values.mois).toBe('2026-01');
    expect(r.missingMonths).toEqual(['2026-02']);
    expect(all.some((x) => x.values.participant_id === p.id && x.values.mois === '2026-02')).toBe(false);
  });

  it('janvier → février → mars : février est utilisé pour mars, sans écart', async () => {
    const p = await newParticipant('Suite');
    await rel(p, '2026-01', 100);
    await rel(p, '2026-02', 120);
    await rel(p, '2026-03', 150);
    const r = resolvePreviousReleve(p, 'ceet', '2026-03', await releves());
    expect(r.releve!.values.index).toBe(120);
    expect(r.missingMonths).toEqual([]);
  });

  it('un relevé futur ou de la même période n\'est jamais utilisé comme précédent', async () => {
    const p = await newParticipant('Futur');
    await rel(p, '2026-03', 150);
    await rel(p, '2026-04', 170);
    await rel(p, '2026-05', 190);
    const all = await releves();
    expect(resolvePreviousReleve(p, 'ceet', '2026-03', all).releve).toBeNull();
    expect(resolvePreviousReleve(p, 'ceet', '2026-04', all).releve!.values.mois).toBe('2026-03');
  });
});

describe('Consommation', () => {
  it('100 → 150 = 50 ; 500 → 450 = erreur explicite (jamais 0)', () => {
    expect(computeConsommationChecked(100, 150)).toEqual({ valid: true, consommation: 50 });
    expect(computeConsommationChecked(500, 450)).toMatchObject({ valid: false, error: 'INDEX_ACTUEL_INFERIEUR' });
    expect(() => computeConsommationStrict(500, 450)).toThrow(expect.objectContaining({ code: 'INDEX_ACTUEL_INFERIEUR' }));
    expect(computeConsommationChecked(NaN, 10)).toMatchObject({ valid: false, error: 'INDEX_INVALIDE' });
    expect(computeConsommation(100, 150)).toBe(50); // fonction d'affichage historique conservée
  });

  it('index précédent manquant : pas de précédent = 0, pas de consommation = index actuel', async () => {
    const p = await newParticipant('Neuf');
    await rel(p, '2026-03', 150);
    const res = computeRepartitionParCompteur({ participants: [p], fournisseur: 'ceet', periode: '2026-03', releves: await releves(), montantTotal: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toMatchObject([{ code: 'INDEX_PRECEDENT_MANQUANT' }]);
  });
});

describe('Calcul de répartition', () => {
  it('par compteur : consommations, prix unitaire et parts (exemple 100 / 15 000 F)', async () => {
    const { all } = await setupCounter();
    const res = computeRepartitionParCompteur({ participants: all, fournisseur: 'ceet', periode: '2026-03', releves: await releves(), montantTotal: 15000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalConsommation).toBe(100);
    expect(res.prixUnitaire).toBe(150);
    expect(res.lines.map((l) => l.consommation)).toEqual([25, 40, 35]);
    expect(res.lines.map((l) => l.montant)).toEqual([3750, 6000, 5250]);
    expect(res.lines[0]).toMatchObject({ indexPrecedent: 100, indexActuel: 125, prixUnitaire: 150, nbParticipants: 3 });
    expect(res.warnings).toEqual([]);
  });

  it('partage équitable : 10 000 F / 4 = 2 500 F, sans index', () => {
    const ps: Participant[] = ['a', 'b', 'c', 'd'].map((l) => ({ type: 'manuel', id: null, label: l }));
    const lines = computeRepartitionEquitable(ps, 10000);
    expect(lines.map((l) => l.montant)).toEqual([2500, 2500, 2500, 2500]);
    expect(lines.every((l) => l.nbParticipants === 4 && l.indexActuel === undefined)).toBe(true);
  });

  it('arrondis : la somme des parts vaut toujours la facture (équitable et par compteur)', async () => {
    const ps: Participant[] = ['a', 'b', 'c'].map((l) => ({ type: 'manuel', id: null, label: l }));
    const eq = computeRepartitionEquitable(ps, 10000);
    expect(eq.map((l) => l.montant)).toEqual([3334, 3333, 3333]);
    expect(eq.reduce((s, l) => s + l.montant, 0)).toBe(10000);

    const p = [await newParticipant('R1'), await newParticipant('R2'), await newParticipant('R3')];
    for (const [i, x] of p.entries()) {
      await rel(x, '2026-02', 100);
      await rel(x, '2026-03', 101 + i * 0); // 1 unité chacun
    }
    const res = computeRepartitionParCompteur({ participants: p, fournisseur: 'ceet', periode: '2026-03', releves: await releves(), montantTotal: 10000 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines.reduce((s, l) => s + l.montant, 0)).toBe(10000);
  });

  it('écart de relevé : calcul possible mais avertissement explicite', async () => {
    const p = await newParticipant('Ecart2');
    await rel(p, '2026-01', 100);
    await rel(p, '2026-03', 150);
    const res = computeRepartitionParCompteur({ participants: [p], fournisseur: 'ceet', periode: '2026-03', releves: await releves(), montantTotal: 5000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines[0].consommation).toBe(50);
    expect(res.warnings[0]).toMatchObject({ previousPeriode: '2026-01', missingMonths: ['2026-02'] });
    expect(res.warnings[0].message).toContain('janvier 2026');
    expect(res.warnings[0].message).toContain('février 2026');
  });

  it('aucun calcul faux silencieux : index actuel manquant, inférieur, montant invalide, total nul', async () => {
    const { koffi, ama } = await setupCounter();
    const inf = await newParticipant('Inf');
    await rel(inf, '2026-02', 500);
    await rel(inf, '2026-03', 450);
    const sans = await newParticipant('Sans');
    const all = await releves();
    const base = { fournisseur: 'ceet', periode: '2026-03', releves: all };
    const r1 = computeRepartitionParCompteur({ ...base, participants: [koffi, sans], montantTotal: 1000 });
    expect(r1.ok === false && r1.issues.map((i) => i.code)).toEqual(['INDEX_ACTUEL_MANQUANT']);
    const r2 = computeRepartitionParCompteur({ ...base, participants: [koffi, inf], montantTotal: 1000 });
    expect(r2.ok === false && r2.issues.map((i) => i.code)).toEqual(['INDEX_ACTUEL_INFERIEUR']);
    expect(computeRepartitionParCompteur({ ...base, participants: [ama], montantTotal: -5 })).toMatchObject({ ok: false, error: 'MONTANT_INVALIDE' });
    expect(computeRepartitionParCompteur({ ...base, participants: [], montantTotal: 100 })).toMatchObject({ ok: false, error: 'AUCUN_PARTICIPANT' });
    const zero = [await newParticipant('Z1'), await newParticipant('Z2')];
    for (const z of zero) {
      await rel(z, '2026-02', 10);
      await rel(z, '2026-03', 10);
    }
    expect(computeRepartitionParCompteur({ ...base, releves: await releves(), participants: zero, montantTotal: 100 })).toMatchObject({ ok: false, error: 'CONSOMMATION_TOTALE_NULLE' });
  });

  it('validation bloquée si un participant n\'a pas d\'index précédent : aucune part créée', async () => {
    const { all } = await setupCounter();
    const neuf = await newParticipant('Neuf2');
    await rel(neuf, '2026-03', 40); // pas de précédent
    const facture = await newFacture('ceet', '2026-03', 15000);
    await expect(
      validerFactureParCompteur({
        toolId: ents.tool.id,
        releveEntityDefinitionId: ents.releveDefinition.id,
        partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
        facturePartageeId: facture.id,
        participants: [...all, neuf],
      }),
    ).rejects.toMatchObject({ code: 'INDEX_PRECEDENT_MANQUANT' });
    expect(await partsOf(facture.id)).toHaveLength(0);
    expect((await coreService.getRecord(facture.id))!.values.mode_repartition).toBeUndefined();
  });
});

describe('Snapshot des parts et reçu', () => {
  async function validated() {
    const { koffi, all } = await setupCounter();
    const facture = await newFacture('ceet', '2026-03', 15000);
    const parts = await validerFactureParCompteur({
      toolId: ents.tool.id,
      releveEntityDefinitionId: ents.releveDefinition.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      participants: all,
    });
    return { facture, parts, koffi };
  }

  it('la part fige index, consommation, prix, participants, montant, période, fournisseur', async () => {
    const { parts } = await validated();
    expect(parts[0].statusKey).toBe('a_payer');
    expect(parts[0].values).toMatchObject({
      fournisseur: 'ceet', periode: '2026-03', index_precedent: 100, index_actuel: 125, consommation: 25, prix_unitaire: 150, nb_participants: 3, montant_attribue: 3750, montant_facture: 15000, label: expect.any(String),
    });
  });

  it('modifier ensuite les relevés ou la facture ne change ni la part ni le reçu', async () => {
    const { facture, parts, koffi } = await validated();
    const before = JSON.stringify(parts[0].values);
    const receiptBefore = buildReceiptData((await coreService.getRecord(facture.id))!, parts[0]);

    const koffiMars = (await releves()).find((r) => r.values.participant_id === koffi.id && r.values.mois === '2026-03')!;
    expect(isReleveUsed(koffiMars, await partsOf(facture.id), [facture, ...[]].map((f) => ({ ...f, values: { ...f.values, mode_repartition: 'proportionnel' } })))).toBe(true);
    await coreService.updateRecord(koffiMars.id, { values: { index: 999 } });
    await coreService.updateRecord(facture.id, { values: { montant_total: 1 } });

    const after = (await partsOf(facture.id)).find((p) => p.id === parts[0].id)!;
    expect(JSON.stringify(after.values)).toBe(before);
    const receiptAfter = buildReceiptData((await coreService.getRecord(facture.id))!, after);
    expect(receiptAfter).toEqual(receiptBefore);
    expect(receiptAfter).toMatchObject({ indexPrecedent: 100, indexActuel: 125, consommation: 25, prixUnitaire: 150, montant: 3750, montantFacture: 15000, detailFige: true, nombreParticipants: 3 });
    expect(buildReceiptText((await coreService.getRecord(facture.id))!, [after])).toContain('index 100 → 125');
  });

  it('un reçu équitable n\'affiche aucun faux index', async () => {
    const ps = [await newParticipant('E1'), await newParticipant('E2'), await newParticipant('E3'), await newParticipant('E4')];
    const facture = await newFacture('tde', '2026-03', 12000);
    const parts = await validateRepartition({
      toolId: ents.tool.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      mode: 'equitable',
      lines: computeRepartitionEquitable(ps, 12000),
    });
    const data = buildReceiptData((await coreService.getRecord(facture.id))!, parts[0]);
    expect(data).toMatchObject({ fournisseurLabel: 'TDE', mode: 'equitable', montant: 3000, montantFacture: 12000, nombreParticipants: 4, indexPrecedent: null, indexActuel: null, prixUnitaire: null, detailFige: false });
  });

  it('refuse de répartir deux fois la même facture et une somme incohérente', async () => {
    const ps = [await newParticipant('D1'), await newParticipant('D2')];
    const facture = await newFacture('ceet', '2026-03', 1000);
    const args = { toolId: ents.tool.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: facture.id, mode: 'equitable' as const };
    await expect(validateRepartition({ ...args, lines: computeRepartitionEquitable(ps, 900) })).rejects.toMatchObject({ code: 'REPARTITION_INCOMPLETE' });
    await validateRepartition({ ...args, lines: computeRepartitionEquitable(ps, 1000) });
    await expect(validateRepartition({ ...args, lines: computeRepartitionEquitable(ps, 1000) })).rejects.toMatchObject({ code: 'FACTURE_DEJA_REPARTIE' });
    expect(await partsOf(facture.id)).toHaveLength(2);
  });
});

describe('Paiement', () => {
  async function twoParts() {
    const ps = [await newParticipant('P1'), await newParticipant('P2')];
    const facture = await newFacture('ceet', '2026-03', 1000);
    const parts = await validateRepartition({
      toolId: ents.tool.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      mode: 'equitable',
      lines: computeRepartitionEquitable(ps, 1000),
    });
    return { facture, parts };
  }

  it('a_payer → payee en un geste avec la date réelle ; statut de la facture dérivé', async () => {
    const { facture, parts } = await twoParts();
    const paid = await enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 5));
    expect(paid.statusKey).toBe('payee');
    expect(paid.values.date_paiement).toBe('2026-10-05');
    expect(paid.values.montant_attribue).toBe(500); // inchangé : montant automatique
    expect((await coreService.getRecord(facture.id))!.statusKey).toBe('partielle');
    await enregistrerPaiementPart(parts[1].id, new Date(2026, 9, 6));
    expect((await coreService.getRecord(facture.id))!.statusKey).toBe('payee');
  });

  it('un second appel (simultané ou plus tard) ne crée pas un second paiement', async () => {
    const { parts } = await twoParts();
    const [a, b] = await Promise.allSettled([enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 5)), enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 9))]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 20))).rejects.toMatchObject({ code: 'PART_DEJA_PAYEE' });
    const part = (await coreService.getRecord(parts[0].id))!;
    expect(part.values.date_paiement).toBe('2026-10-05'); // la date du premier paiement est conservée
  });

  it('un paiement effectué ne revient jamais à a_payer', async () => {
    const { facture, parts } = await twoParts();
    await enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 5));
    const all = await partsOf(facture.id);
    await expect(markPartStatus({ toolId: ents.tool.id, facturePartageeId: facture.id, partId: parts[0].id, statusKey: 'a_payer', allParts: all })).rejects.toMatchObject({ code: 'PAIEMENT_IMMUTABLE' });
    expect((await coreService.getRecord(parts[0].id))!.statusKey).toBe('payee');
    // markPartStatus a_payer → payee passe par le même chemin (date réelle)
    await markPartStatus({ toolId: ents.tool.id, facturePartageeId: facture.id, partId: parts[1].id, statusKey: 'payee', allParts: all });
    expect((await coreService.getRecord(parts[1].id))!.values.date_paiement).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('le paiement est associé à la bonne part et conservé dans l\'historique', async () => {
    const { facture, parts } = await twoParts();
    await enregistrerPaiementPart(parts[1].id, new Date(2026, 9, 5));
    const all = await partsOf(facture.id);
    expect(all.find((p) => p.id === parts[0].id)!.statusKey).toBe('a_payer');
    expect(all.find((p) => p.id === parts[1].id)!.statusKey).toBe('payee');
    expect(getPartPaymentInfo(all.find((p) => p.id === parts[1].id)!)).toEqual({ paid: true, date: '2026-10-05', dateKnown: true });
    await expect(enregistrerPaiementPart('inexistant')).rejects.toMatchObject({ code: 'PART_INTROUVABLE' });
  });
});

describe('Anciennes données', () => {
  it('une ancienne part payée sans date reste lisible : date inconnue, jamais la date du jour', async () => {
    const facture = await newFacture('ceet', '2026-01', 6000);
    await coreService.updateRecord(facture.id, { values: { mode_repartition: 'proportionnel' } });
    const old = await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.partLocataireDefinition.id,
      statusKey: 'payee',
      values: { facture_partagee: facture.id, participant_type: 'manuel', participant_id: null, label: 'Ancien locataire', consommation: 30, montant_attribue: 2000 },
    });
    expect(getPartPaymentInfo(old)).toEqual({ paid: true, date: null, dateKnown: false });
    const data = buildReceiptData((await coreService.getRecord(facture.id))!, old);
    expect(data).toMatchObject({ participant: 'Ancien locataire', montant: 2000, statut: 'payee', datePaiement: null, datePaiementConnue: false, detailFige: false, indexPrecedent: null, prixUnitaire: null, montantFacture: 6000, periode: '2026-01', fournisseur: 'ceet' });
    const text = buildReceiptText((await coreService.getRecord(facture.id))!, [old]);
    expect(text).toContain('date inconnue');
    expect(text).not.toContain('index');
    // l'ancienne part n'a pas été modifiée par la lecture
    expect((await coreService.getRecord(old.id))!.values.date_paiement).toBeUndefined();
  });
});

describe('Persistance', () => {
  it('participants, relevés, calculs et paiements survivent à un redémarrage', async () => {
    jest.useFakeTimers();
    try {
      const { all } = await setupCounter('tde');
      const facture = await newFacture('tde', '2026-03', 15000);
      const parts = await validerFactureParCompteur({
        toolId: ents.tool.id,
        releveEntityDefinitionId: ents.releveDefinition.id,
        partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
        facturePartageeId: facture.id,
        participants: all,
      });
      await enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 5));

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0;
      await hydrateDb();

      const reloaded = await partsOf(facture.id);
      expect(reloaded).toHaveLength(3);
      expect(reloaded.find((p) => p.id === parts[0].id)!.values).toMatchObject({ date_paiement: '2026-10-05', index_precedent: 100, index_actuel: 125, prix_unitaire: 150, montant_attribue: 3750 });
      expect(reloaded.find((p) => p.id === parts[0].id)!.statusKey).toBe('payee');
      expect((await releves()).filter((r) => all.some((p) => p.id === r.values.participant_id))).toHaveLength(6);
      expect((await coreService.getRecord(facture.id))!.statusKey).toBe('partielle');
      expect(await coreService.getExternalContact(all[0].id!)).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Flux unique : relevés enregistrés → calcul → validation → snapshot', () => {
  const validateArgs = (factureId: string) => ({ toolId: ents.tool.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: factureId, mode: 'proportionnel' as const });

  it("le calcul relit les relevés enregistrés : modifier un relevé avant calcul change le résultat", async () => {
    const { koffi, all } = await setupCounter();
    const base = { participants: all, fournisseur: 'ceet', periode: '2026-03', montantTotal: 15000 };
    const before = computeRepartitionParCompteur({ ...base, releves: await releves() });
    const koffiMars = (await releves()).find((r) => r.values.participant_id === koffi.id && r.values.mois === '2026-03')!;
    await coreService.updateRecord(koffiMars.id, { values: { index: 150 } }); // 50 au lieu de 25
    const after = computeRepartitionParCompteur({ ...base, releves: await releves() });
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(before.lines[0].consommation).toBe(25);
      expect(after.lines[0].consommation).toBe(50);
      expect(after.lines[0].indexActuel).toBe(150);
    }
  });

  it("résolution chronologique et relevé actuel pris dans les données existantes (lecture seule pour l'écran)", async () => {
    const p = await newParticipant('Lecture');
    await rel(p, '2026-01', 100);
    await rel(p, '2026-03', 150);
    await rel(p, '2026-05', 400); // futur
    const r = resolveParticipantReleves(p, 'ceet', '2026-03', await releves());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r).toMatchObject({ indexPrecedent: 100, indexActuel: 150, consommation: 50, missingMonths: ['2026-02'] });
      expect(r.precedent.values.mois).toBe('2026-01');
      expect(r.actuel.values.mois).toBe('2026-03');
    }
    // en cas de problème, les relevés trouvés restent disponibles pour l'affichage
    const manquant = resolveParticipantReleves(p, 'ceet', '2026-06', await releves());
    expect(manquant).toMatchObject({ ok: false, actuel: null, issue: { code: 'INDEX_ACTUEL_MANQUANT' } });
    expect(manquant.precedent!.values.mois).toBe('2026-05');
  });

  it('les parts référencent exactement les relevés utilisés (releve_precedent_id / releve_actuel_id + index)', async () => {
    const { koffi, all } = await setupCounter();
    const facture = await newFacture('ceet', '2026-03', 15000);
    const parts = await validerFactureParCompteur({
      toolId: ents.tool.id,
      releveEntityDefinitionId: ents.releveDefinition.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      participants: all,
    });
    const all2 = await releves();
    const part = parts.find((p) => p.values.participant_id === koffi.id)!;
    const prec = all2.find((r) => r.id === part.values.releve_precedent_id)!;
    const act = all2.find((r) => r.id === part.values.releve_actuel_id)!;
    expect([prec.values.mois, act.values.mois]).toEqual(['2026-02', '2026-03']);
    expect(part.values).toMatchObject({ index_precedent: prec.values.index, index_actuel: act.values.index, periode: '2026-03', fournisseur: 'ceet', consommation: 25, prix_unitaire: 150, montant_attribue: 3750 });
    expect([prec, act].every((r) => r.values.participant_id === koffi.id)).toBe(true);
  });

  it('validateRepartition (proportionnel) refuse une ligne sans snapshot — ancien appelant, aucune part créée', async () => {
    const ps = [await newParticipant('Old1'), await newParticipant('Old2')];
    const facture = await newFacture('ceet', '2026-03', 1000);
    const legacy = ps.map((participant, i) => ({ participant, consommation: 10 * (i + 1), montant: i === 0 ? 333 : 667 }));
    await expect(validateRepartition({ ...validateArgs(facture.id), lines: legacy })).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' });
    expect(await partsOf(facture.id)).toHaveLength(0);
  });

  it("validateRepartition refuse un index inventé, un relevé inexistant, d'un autre participant ou d'une autre période", async () => {
    const { all } = await setupCounter();
    const other = await newParticipant('Autre');
    await rel(other, '2026-02', 10);
    await rel(other, '2026-03', 20);
    const facture = await newFacture('ceet', '2026-03', 15000);
    const good = computeRepartitionParCompteur({ participants: all, fournisseur: 'ceet', periode: '2026-03', releves: await releves(), montantTotal: 15000 });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const tryLines = (lines: typeof good.lines) => validateRepartition({ ...validateArgs(facture.id), lines });
    const withLine = (i: number, patch: Partial<(typeof good.lines)[number]>) => good.lines.map((l, k) => (k === i ? { ...l, ...patch } : l));

    // index « inventé » (consommation recalculée pour rester cohérente : seul le lien aux relevés le trahit)
    await expect(tryLines(withLine(0, { indexActuel: 130, consommation: 30 }))).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' });
    await expect(tryLines(withLine(0, { releveActuelId: 'rec-inexistant' }))).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' });
    const otherMars = (await releves()).find((r) => r.values.participant_id === other.id && r.values.mois === '2026-03')!;
    await expect(tryLines(withLine(0, { releveActuelId: otherMars.id, indexActuel: 20, consommation: 20 - good.lines[0].indexPrecedent! }))).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' });
    const koffiFev = good.lines[0].relevePrecedentId!;
    await expect(tryLines(withLine(0, { releveActuelId: koffiFev, indexActuel: good.lines[0].indexPrecedent!, consommation: 0 }))).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' }); // relevé d'une autre période
    await expect(tryLines(withLine(0, { prixUnitaire: undefined }))).rejects.toMatchObject({ code: 'SNAPSHOT_INCOMPLET' });
    expect(await partsOf(facture.id)).toHaveLength(0);

    // les lignes issues du moteur, elles, sont acceptées
    expect(await tryLines(good.lines)).toHaveLength(3);
  });

  it("écart de plusieurs mois : janvier → juin signale février à mai, sans rien inventer", async () => {
    const p = await newParticipant('Long');
    await rel(p, '2026-01', 100);
    await rel(p, '2026-06', 350);
    const res = computeRepartitionParCompteur({ participants: [p], fournisseur: 'ceet', periode: '2026-06', releves: await releves(), montantTotal: 2500 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines[0].consommation).toBe(250);
    expect(res.warnings[0].missingMonths).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
    expect(res.warnings[0].message).toContain('mai 2026');
  });

  it('index précédent manquant / index actuel manquant / actuel inférieur : calcul bloqué, jamais remplacé par 0', async () => {
    const neuf = await newParticipant('Neuf3');
    const sans = await newParticipant('Sans3');
    const inf = await newParticipant('Inf3');
    await rel(neuf, '2026-03', 40);
    await rel(inf, '2026-02', 500);
    await rel(inf, '2026-03', 450);
    const all = await releves();
    const run = (ps: Participant[]) => computeRepartitionParCompteur({ participants: ps, fournisseur: 'ceet', periode: '2026-03', releves: all, montantTotal: 1000 });
    for (const [p, code] of [[neuf, 'INDEX_PRECEDENT_MANQUANT'], [sans, 'INDEX_ACTUEL_MANQUANT'], [inf, 'INDEX_ACTUEL_INFERIEUR']] as const) {
      const res = run([p]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.map((i) => i.code)).toEqual([code]);
    }
  });

  it("RepartitionScreen ne saisit plus d'index et n'appelle plus saveReleve (source unique : le moteur)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source: string = require('fs').readFileSync(require('path').join(__dirname, '../../features/immobilier/screens/RepartitionScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/saveReleve/);
    expect(source).not.toMatch(/indexPrecedentPrefilled|indicesReady/);
    expect(source).not.toMatch(/indexActuel:\s*''|indexPrecedent:\s*''/);
    expect(source).not.toMatch(/label="Index (actuel|précédent)/);
    expect(source).not.toMatch(/computeConsommation\b|computeRepartitionProportionnelle/);
    expect(source).toMatch(/computeRepartitionParCompteur\(/);
    expect(source).toMatch(/validerFactureParCompteur\(/);
  });
});
