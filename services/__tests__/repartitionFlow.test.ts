// Étape 3 — raccordement Participants → Participations → Relevés → Calcul → Validation.
// Le flux de répartition CEET/TDE part des PARTICIPATIONS du module et des relevés
// enregistrés ; aucun nom n'est retapé, aucun index n'est ressaisi.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesToolCached } from '../facturesService';
import {
  buildPartReceiptText,
  buildReceiptData,
  buildReceiptLines,
  computeRepartitionEquitable,
  computeRepartitionParCompteur,
  enregistrerPaiementPart,
  formatReceiptDate,
  markPartStatus,
  sortPartsForDisplay,
  summarizePayments,
  UtilityBillingError,
  createFacturePartagee,
  loadLockedReleveIds,
  resolveParticipantReleves,
  updateReleveIndex,
  validateRepartition,
  validerFactureParCompteur,
  type Participant,
} from '../utilityBillingService';
import { friendlyMessage } from '@/features/utilities/errors';
import { addExistingContact, addParticipant, listParticipations, saveRelevesPeriode, type UtilityParticipation } from '../utilityParticipantsService';
import type { RecordItem } from '@/types/entities';

const relevesOf = async () => {
  const ents = await ensureFacturesToolCached();
  return coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
};
const partsOf = async (factureId: string) => {
  const ents = await ensureFacturesToolCached();
  return (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id })).filter((p) => p.values.facture_partagee === factureId);
};
const releve = (p: UtilityParticipation, module: 'ceet' | 'tde', periode: string, index: number) =>
  saveRelevesPeriode({ fournisseur: module, periode, entries: [{ participationId: p.record.id, index }] });

async function newFacture(fournisseur: string, mois: string, montant: number): Promise<RecordItem> {
  const ents = await ensureFacturesToolCached();
  return createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur, mois, montant_total: montant } });
}
const validate = async (factureId: string, participants: Participant[]) => {
  const ents = await ensureFacturesToolCached();
  return validerFactureParCompteur({
    toolId: ents.tool.id,
    releveEntityDefinitionId: ents.releveDefinition.id,
    partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
    facturePartageeId: factureId,
    participants,
  });
};

describe('A. Résolution des participants depuis les participations', () => {
  it('participation CEET → bonne personne ; participation TDE → bonne personne', async () => {
    const koffi = await addParticipant('ceet', { name: 'Koffi Flux', phone: '90000101' });
    const yao = await addParticipant('tde', { name: 'Yao Flux', phone: '90000102' });
    const ceet = (await listParticipations('ceet')).find((p) => p.record.id === koffi.record.id)!;
    const tde = (await listParticipations('tde')).find((p) => p.record.id === yao.record.id)!;
    expect(ceet).toMatchObject({ displayName: 'Koffi Flux', phone: '90000101', fournisseur: 'ceet', participant: { type: 'contact', id: koffi.participant.id, label: 'Koffi Flux' } });
    expect(tde).toMatchObject({ displayName: 'Yao Flux', fournisseur: 'tde' });
    // une participation CEET n'apparaît jamais dans TDE, et inversement
    expect((await listParticipations('tde')).some((p) => p.record.id === koffi.record.id)).toBe(false);
    expect((await listParticipations('ceet')).some((p) => p.record.id === yao.record.id)).toBe(false);
  });

  it('même personne en CEET et TDE : participations différentes, même contactId, même identité de personne', async () => {
    const a = await addParticipant('ceet', { name: 'Ama Flux' });
    const b = await addExistingContact('tde', a.participant.id!);
    const ceet = (await listParticipations('ceet')).find((p) => p.record.id === a.record.id)!;
    const tde = (await listParticipations('tde')).find((p) => p.record.id === b.record.id)!;
    expect(ceet.record.id).not.toBe(tde.record.id);
    expect(ceet.contactId).toBe(tde.contactId);
    expect(ceet.contactId).toBe(a.participant.id);
    expect(ceet.displayName).toBe(tde.displayName);
  });
});

describe('B/C. Résolution des relevés et calcul', () => {
  it('relevé actuel + précédent : janvier 100, février 130 → consommation 30 (récupérés sans ressaisie)', async () => {
    const p = await addParticipant('ceet', { name: 'Calc Simple' });
    await releve(p, 'ceet', '2026-01', 100);
    await releve(p, 'ceet', '2026-02', 130);
    const r = resolveParticipantReleves(p.participant, 'ceet', '2026-02', await relevesOf());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r).toMatchObject({ indexPrecedent: 100, indexActuel: 130, consommation: 30, missingMonths: [] });
      expect(r.precedent.values.mois).toBe('2026-01');
      expect(r.actuel.values.mois).toBe('2026-02');
    }
  });

  it('aucun précédent : pas de consommation = index actuel, pas de précédent = 0, aucun autre participant utilisé', async () => {
    const seul = await addParticipant('ceet', { name: 'Seul Sans Precedent' });
    const autre = await addParticipant('ceet', { name: 'Autre Avec Historique' });
    await releve(autre, 'ceet', '2026-01', 5);
    await releve(seul, 'ceet', '2026-02', 130);
    const r = resolveParticipantReleves(seul.participant, 'ceet', '2026-02', await relevesOf());
    expect(r).toMatchObject({ ok: false, precedent: null, issue: { code: 'INDEX_PRECEDENT_MANQUANT' } });
    const calc = computeRepartitionParCompteur({ participants: [seul.participant], fournisseur: 'ceet', periode: '2026-02', releves: await relevesOf(), montantTotal: 1000 });
    expect(calc.ok).toBe(false);
  });

  it('trou de périodes : janvier 100, avril 150 → précédent janvier, consommation 50, février/mars jamais créés', async () => {
    const p = await addParticipant('ceet', { name: 'Calc Trou' });
    await releve(p, 'ceet', '2026-01', 100);
    await releve(p, 'ceet', '2026-04', 150);
    const all = await relevesOf();
    const r = resolveParticipantReleves(p.participant, 'ceet', '2026-04', all);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r).toMatchObject({ consommation: 50, missingMonths: ['2026-02', '2026-03'] });
    expect(all.filter((x) => x.values.participant_id === p.participant.id)).toHaveLength(2);
  });

  it('un relevé futur n\'est jamais utilisé comme précédent', async () => {
    const p = await addParticipant('ceet', { name: 'Calc Futur' });
    await releve(p, 'ceet', '2026-02', 130);
    await releve(p, 'ceet', '2026-05', 400);
    const r = resolveParticipantReleves(p.participant, 'ceet', '2026-02', await relevesOf());
    expect(r).toMatchObject({ ok: false, precedent: null, issue: { code: 'INDEX_PRECEDENT_MANQUANT' } });
  });

  it('index actuel inférieur : INDEX_ACTUEL_INFERIEUR, jamais consommation 0 ; le participant n\'est pas calculable', async () => {
    const p = await addParticipant('ceet', { name: 'Calc Inferieur' });
    await releve(p, 'ceet', '2026-01', 90);
    await releve(p, 'ceet', '2026-02', 80);
    const r = resolveParticipantReleves(p.participant, 'ceet', '2026-02', await relevesOf());
    expect(r).toMatchObject({ ok: false, issue: { code: 'INDEX_ACTUEL_INFERIEUR' } });
    const calc = computeRepartitionParCompteur({ participants: [p.participant], fournisseur: 'ceet', periode: '2026-02', releves: await relevesOf(), montantTotal: 1000 });
    expect(calc).toMatchObject({ ok: false });
    await expect(validate((await newFacture('ceet', '2026-02', 1000)).id, [p.participant])).rejects.toMatchObject({ code: 'INDEX_ACTUEL_INFERIEUR' });
  });

  it('participant sans relevé actuel : INDEX_ACTUEL_MANQUANT, aucune saisie possible dans le calcul', async () => {
    const p = await addParticipant('ceet', { name: 'Calc Sans Actuel' });
    await releve(p, 'ceet', '2026-01', 100);
    const r = resolveParticipantReleves(p.participant, 'ceet', '2026-02', await relevesOf());
    expect(r).toMatchObject({ ok: false, actuel: null, issue: { code: 'INDEX_ACTUEL_MANQUANT' } });
    expect(r.precedent!.values.index).toBe(100); // le précédent connu reste affichable
  });
});

describe('D. Isolation CEET / TDE', () => {
  it('un relevé CEET n\'est jamais utilisé dans un calcul TDE, et inversement', async () => {
    const ceet = await addParticipant('ceet', { name: 'Iso Flux' });
    const tde = await addExistingContact('tde', ceet.participant.id!);
    await releve(ceet, 'ceet', '2026-01', 1000);
    await releve(ceet, 'ceet', '2026-02', 1500); // CEET : 500 kWh
    await releve(tde, 'tde', '2026-01', 10);
    await releve(tde, 'tde', '2026-02', 14); // TDE : 4 m³
    const all = await relevesOf();
    const ceetCalc = resolveParticipantReleves(ceet.participant, 'ceet', '2026-02', all);
    const tdeCalc = resolveParticipantReleves(tde.participant, 'tde', '2026-02', all);
    expect(ceetCalc.ok && ceetCalc.consommation).toBe(500);
    expect(tdeCalc.ok && tdeCalc.consommation).toBe(4);

    // fournisseur sans relevé : rien n'est emprunté à l'autre module
    const solo = await addParticipant('tde', { name: 'Solo Eau' });
    await releve(solo, 'tde', '2026-02', 9);
    const wrongModule = resolveParticipantReleves(solo.participant, 'ceet', '2026-02', await relevesOf());
    expect(wrongModule).toMatchObject({ ok: false, actuel: null, precedent: null });
    const wrongModule2 = resolveParticipantReleves(ceet.participant, 'tde', '2026-03', await relevesOf());
    expect(wrongModule2.precedent!.values.fournisseur).toBe('tde');
  });
});

describe('E. Validation : parts, snapshot, verrouillage', () => {
  async function scenario() {
    const [koffi, ama, yao] = [await addParticipant('ceet', { name: 'Val Koffi', phone: '90000201' }), await addParticipant('ceet', { name: 'Val Ama' }), await addParticipant('ceet', { name: 'Val Yao' })];
    for (const [p, jan, feb] of [[koffi, 100, 125], [ama, 150, 190], [yao, 200, 235]] as const) {
      await releve(p, 'ceet', '2026-01', jan);
      await releve(p, 'ceet', '2026-02', feb);
    }
    const facture = await newFacture('ceet', '2026-02', 15000);
    return { koffi, ama, yao, facture };
  }

  it('les participants viennent des participations ; les parts conservent les IDs de relevés et le snapshot complet', async () => {
    const { koffi, ama, yao, facture } = await scenario();
    const list = (await listParticipations('ceet')).filter((p) => [koffi, ama, yao].some((x) => x.record.id === p.record.id));
    const parts = await validate(facture.id, list.map((p) => p.participant));
    expect(parts).toHaveLength(3);
    const rel = await relevesOf();
    const part = parts.find((p) => p.values.participant_id === koffi.participant.id)!;
    const prec = rel.find((r) => r.id === part.values.releve_precedent_id)!;
    const act = rel.find((r) => r.id === part.values.releve_actuel_id)!;
    expect([prec.values.mois, prec.values.index, act.values.mois, act.values.index]).toEqual(['2026-01', 100, '2026-02', 125]);
    expect(part.values).toMatchObject({
      participant_type: 'contact',
      participant_id: koffi.participant.id,
      fournisseur: 'ceet',
      periode: '2026-02',
      index_precedent: 100,
      index_actuel: 125,
      consommation: 25,
      prix_unitaire: 150,
      nb_participants: 3,
      montant_facture: 15000,
      montant_attribue: 3750,
    });
    const amountOf = (x: typeof koffi) => parts.find((p) => p.values.participant_id === x.participant.id)!.values.montant_attribue;
    expect([amountOf(koffi), amountOf(ama), amountOf(yao)]).toEqual([3750, 6000, 5250]);
  });

  it('seuls les participants retenus sont validés (un participant décoché n\'est pas dans les parts)', async () => {
    const { koffi, ama, yao, facture } = await scenario();
    const parts = await validate(facture.id, [koffi.participant, ama.participant]);
    expect(parts.map((p) => p.values.participant_id).sort()).toEqual([koffi.participant.id, ama.participant.id].sort());
    expect(parts.every((p) => p.values.participant_id !== yao.participant.id)).toBe(true);
    expect(parts[0].values.nb_participants).toBe(2);
    expect(parts.reduce((s, p) => s + (p.values.montant_attribue as number), 0)).toBe(15000);
  });

  it('après validation, les relevés actuels ET précédents sont verrouillés ; les autres restent libres', async () => {
    const { koffi, ama, yao, facture } = await scenario();
    await releve(yao, 'ceet', '2026-05', 400); // jamais utilisé
    await validate(facture.id, [koffi.participant, ama.participant]);
    const rel = await relevesOf();
    const locked = await loadLockedReleveIds(rel);
    const of = (p: typeof koffi, mois: string) => rel.find((r) => r.values.participant_id === p.participant.id && r.values.mois === mois)!;
    for (const p of [koffi, ama]) {
      expect(locked.has(of(p, '2026-01').id)).toBe(true);
      expect(locked.has(of(p, '2026-02').id)).toBe(true);
    }
    expect(locked.has(of(yao, '2026-02').id)).toBe(false); // yao non retenu
    expect(locked.has(of(yao, '2026-05').id)).toBe(false);
  });

  it('un relevé précédent déjà utilisé reste verrouillé quand une facture suivante le réutilise comme précédent', async () => {
    const { koffi, facture } = await scenario();
    await validate(facture.id, [koffi.participant]);
    await releve(koffi, 'ceet', '2026-03', 160);
    const mars = await newFacture('ceet', '2026-03', 3000);
    const parts = await validate(mars.id, [koffi.participant]);
    expect(parts[0].values).toMatchObject({ index_precedent: 125, index_actuel: 160, consommation: 35, periode: '2026-03' });
    const rel = await relevesOf();
    const locked = await loadLockedReleveIds(rel);
    expect(locked.has(rel.find((r) => r.values.participant_id === koffi.participant.id && r.values.mois === '2026-03')!.id)).toBe(true);
    expect(locked.has(rel.find((r) => r.values.participant_id === koffi.participant.id && r.values.mois === '2026-02')!.id)).toBe(true);
  });

  it('mode équitable : les participants des participations suffisent (aucun index requis)', async () => {
    const [a, b] = [await addParticipant('tde', { name: 'Eq A' }), await addParticipant('tde', { name: 'Eq B' })];
    const facture = await newFacture('tde', '2026-02', 9001);
    const list = (await listParticipations('tde')).filter((p) => [a, b].some((x) => x.record.id === p.record.id)).map((p) => p.participant);
    const ents = await ensureFacturesToolCached();
    const parts = await validateRepartition({
      toolId: ents.tool.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      mode: 'equitable',
      lines: computeRepartitionEquitable(list, 9001),
    });
    expect(parts.map((p) => p.values.montant_attribue)).toEqual([4501, 4500]);
    expect(parts.every((p) => p.values.participant_type === 'contact' && p.values.fournisseur === 'tde' && p.values.index_actuel === undefined)).toBe(true);
  });
});

describe('F. Historique : le snapshot ne suit pas le nom de la personne', () => {
  it('renommer la personne après validation ne change ni la part ni le reçu', async () => {
    const p = await addParticipant('ceet', { name: 'Hist Avant' });
    await releve(p, 'ceet', '2026-01', 10);
    await releve(p, 'ceet', '2026-02', 40);
    const facture = await newFacture('ceet', '2026-02', 3000);
    const [part] = await validate(facture.id, [p.participant]);
    await coreService.updateExternalContact(p.participant.id!, { name: 'Hist Apres' });
    const after = (await partsOf(facture.id))[0];
    expect(after.values.label).toBe('Hist Avant');
    expect(buildReceiptData((await coreService.getRecord(facture.id))!, after).participant).toBe('Hist Avant');
    expect(after.values).toEqual(part.values);
    expect((await listParticipations('ceet')).find((x) => x.record.id === p.record.id)!.displayName).toBe('Hist Apres');
  });
});

describe('G. Écran de répartition : aucune ressaisie, participants issus des participations', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const source: string = require('fs').readFileSync(require('path').join(__dirname, '../../features/immobilier/screens/RepartitionScreen.tsx'), 'utf8');

  it('utilise les participations du module (identifiant) pour CEET/TDE et plus de recherche par nom', () => {
    expect(source).toMatch(/listParticipations\(/);
    expect(source).toMatch(/setSource\('participations'\)/);
    expect(source).toMatch(/moduleOfFacture === 'ceet' \|\| moduleOfFacture === 'tde'/);
    expect(source).toMatch(/accessibilityRole="checkbox"/);
    expect(source).not.toMatch(/saveReleve|computeConsommation\b|computeRepartitionProportionnelle/);
  });

  it('le nom tapé n\'existe plus que pour la saisie libre (fournisseur « autre »)', () => {
    const occurrences = source.split('label="Nom du participant"').length - 1;
    expect(occurrences).toBe(1);
    const idx = source.indexOf('label="Nom du participant"');
    expect(source.lastIndexOf('isStandalone ? (', idx)).toBeGreaterThan(source.lastIndexOf('source === \'participations\'', idx) - 2000);
    expect(source).toMatch(/setSource\('libre'\)/);
    expect(source).toMatch(/const isStandalone = source === 'libre'/);
  });

  it('aucun champ d\'index : messages explicites et renvoi vers l\'écran Index', () => {
    expect(source).not.toMatch(/label="Index (actuel|précédent)/);
    expect(source).not.toMatch(/keyboardType="numeric"/);
    expect(source).toMatch(/Ajoutez le relevé depuis l’écran Index/);
    expect(source).toMatch(/Relevé précédent manquant\. Ce participant ne peut pas encore être calculé\./);
    expect(source).toMatch(/Corrigez le relevé avant de valider la facture/);
    expect(source).toMatch(/Ouvrir l’écran Index/);
  });
});

describe('H. Validation de bout en bout : calcul → validation → parts → persistance, sans double exécution', () => {
  async function trio(tag: string) {
    const [koffi, ama, yao] = [await addParticipant('ceet', { name: `${tag} Koffi` }), await addParticipant('ceet', { name: `${tag} Ama` }), await addParticipant('ceet', { name: `${tag} Yao` })];
    for (const [p, jan, feb] of [[koffi, 100, 125], [ama, 150, 190], [yao, 200, 235]] as const) {
      await releve(p, 'ceet', '2026-01', jan);
      await releve(p, 'ceet', '2026-02', feb);
    }
    return { koffi, ama, yao, participants: [koffi.participant, ama.participant, yao.participant] };
  }

  it('calcul valide → validation → parts créées → relues après redémarrage (persistance) avec snapshot et verrous', async () => {
    jest.useFakeTimers();
    try {
      const { koffi, participants } = await trio('H1');
      const facture = await newFacture('ceet', '2026-02', 15000);
      const calc = computeRepartitionParCompteur({ participants, fournisseur: 'ceet', periode: '2026-02', releves: await relevesOf(), montantTotal: 15000 });
      expect(calc.ok).toBe(true);

      const parts = await validate(facture.id, participants);
      expect(parts).toHaveLength(3);
      expect(await partsOf(facture.id)).toHaveLength(3);
      expect((await coreService.getRecord(facture.id))!.statusKey).toBe('a_payer');
      expect((await coreService.getRecord(facture.id))!.values.mode_repartition).toBe('proportionnel');

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100); // sauvegarde périodique
      stop();
      records.length = 0; // redémarrage : mémoire vide…
      await hydrateDb(); // …puis relecture du stockage

      const reloaded = await partsOf(facture.id);
      expect(reloaded).toHaveLength(3);
      const part = reloaded.find((p) => p.values.participant_id === koffi.participant.id)!;
      expect(part.values).toMatchObject({ index_precedent: 100, index_actuel: 125, consommation: 25, prix_unitaire: 15000 / 100, nb_participants: 3, montant_facture: 15000, montant_attribue: 3750, periode: '2026-02', fournisseur: 'ceet' });
      const rel = await relevesOf();
      expect(rel.find((r) => r.id === part.values.releve_actuel_id)!.values.index).toBe(125);
      expect((await loadLockedReleveIds(rel)).has(part.values.releve_precedent_id as string)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('deux validations simultanées : une seule aboutit, jamais de parts en double', async () => {
    const { participants } = await trio('H2');
    const facture = await newFacture('ceet', '2026-02', 15000);
    const [a, b] = await Promise.allSettled([validate(facture.id, participants), validate(facture.id, participants)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'FACTURE_DEJA_REPARTIE' });
    expect(await partsOf(facture.id)).toHaveLength(3); // pas 6
    // et une validation ultérieure reste refusée : la facture est déjà répartie
    await expect(validate(facture.id, participants)).rejects.toMatchObject({ code: 'FACTURE_DEJA_REPARTIE' });
    expect(await partsOf(facture.id)).toHaveLength(3);
  });

  it('une validation refusée n\'écrit rien et ne bloque pas la suivante (aucun état « en cours » résiduel)', async () => {
    const { participants } = await trio('H3');
    const bad = await addParticipant('ceet', { name: 'H3 Incoherent' });
    await releve(bad, 'ceet', '2026-01', 90);
    await releve(bad, 'ceet', '2026-02', 80); // inférieur
    const facture = await newFacture('ceet', '2026-02', 15000);
    await expect(validate(facture.id, [...participants, bad.participant])).rejects.toMatchObject({ code: 'INDEX_ACTUEL_INFERIEUR' });
    expect(await partsOf(facture.id)).toHaveLength(0);
    expect((await coreService.getRecord(facture.id))!.values.mode_repartition).toBeUndefined();
    // sans le participant incohérent : la même facture se valide du premier coup
    expect(await validate(facture.id, participants)).toHaveLength(3);
    expect(await partsOf(facture.id)).toHaveLength(3);
  });

  it('un aperçu obsolète n\'influence pas le résultat : la validation relit les relevés et les participants au moment de valider', async () => {
    const { koffi, ama, yao, participants } = await trio('H4');
    const facture = await newFacture('ceet', '2026-02', 15000);
    const preview = computeRepartitionParCompteur({ participants, fournisseur: 'ceet', periode: '2026-02', releves: await relevesOf(), montantTotal: 15000 });
    expect(preview.ok && preview.lines.map((l) => l.consommation)).toEqual([25, 40, 35]);

    // entre l'aperçu et la validation : un relevé non utilisé est corrigé et un participant est exclu
    const yaoFev = (await relevesOf()).find((r) => r.values.participant_id === yao.participant.id && r.values.mois === '2026-02')!;
    await updateReleveIndex(yaoFev.id, 260); // 60 au lieu de 35
    const parts = await validate(facture.id, [koffi.participant, ama.participant, yao.participant].slice(0, 3));
    const byId = (x: typeof koffi) => parts.find((p) => p.values.participant_id === x.participant.id)!.values;
    expect(byId(yao)).toMatchObject({ index_actuel: 260, consommation: 60 }); // valeurs actuelles des relevés, pas celles de l'aperçu
    expect(parts.reduce((s, p) => s + (p.values.montant_attribue as number), 0)).toBe(15000);
  });
});

describe('I. Paiement des parts et reçus', () => {
  async function counterScenario(tag: string) {
    const [koffi, ama] = [await addParticipant('ceet', { name: `${tag} Koffi` }), await addParticipant('ceet', { name: `${tag} Ama` })];
    for (const [p, jan, feb] of [[koffi, 100, 130], [ama, 150, 190]] as const) {
      await releve(p, 'ceet', '2026-01', jan);
      await releve(p, 'ceet', '2026-02', feb);
    }
    const facture = await newFacture('ceet', '2026-02', 7000); // 70 unités → 100 F l'unité : Koffi 3000, Ama 4000
    const parts = await validate(facture.id, [koffi.participant, ama.participant]);
    const partOf = (x: typeof koffi) => parts.find((p) => p.values.participant_id === x.participant.id)!;
    return { koffi, ama, facture, partOf };
  }

  it('un appui : la part passe directement à « payée » avec la date réelle, montant et participant inchangés', async () => {
    const { koffi, facture, partOf } = await counterScenario('I1');
    const paid = await enregistrerPaiementPart(partOf(koffi).id, new Date(2026, 9, 5));
    expect(paid.statusKey).toBe('payee'); // jamais d'état intermédiaire
    expect(paid.values).toMatchObject({ date_paiement: '2026-10-05', montant_attribue: 3000, participant_id: koffi.participant.id, periode: '2026-02' });
    expect(await coreService.getRecord(facture.id)).toMatchObject({ statusKey: 'partielle' });
  });

  it('payer toutes les parts : la facture devient « payée » ; le résumé compte payés / encaissé / restant', async () => {
    const { koffi, ama, facture, partOf } = await counterScenario('I2');
    expect(summarizePayments(await partsOf(facture.id))).toEqual({ total: 2, paid: 0, montantPaye: 0, montantRestant: 7000 });
    await enregistrerPaiementPart(partOf(koffi).id, new Date(2026, 9, 5));
    expect(summarizePayments(await partsOf(facture.id))).toEqual({ total: 2, paid: 1, montantPaye: 3000, montantRestant: 4000 });
    await enregistrerPaiementPart(partOf(ama).id, new Date(2026, 9, 6));
    expect(summarizePayments(await partsOf(facture.id))).toEqual({ total: 2, paid: 2, montantPaye: 7000, montantRestant: 0 });
    expect(await coreService.getRecord(facture.id)).toMatchObject({ statusKey: 'payee' });
  });

  it('double appui : un seul paiement ; un paiement enregistré ne se défait pas ; la date d\'origine est conservée', async () => {
    const { koffi, facture, partOf } = await counterScenario('I3');
    const id = partOf(koffi).id;
    const [a, b] = await Promise.allSettled([enregistrerPaiementPart(id, new Date(2026, 9, 5)), enregistrerPaiementPart(id, new Date(2026, 9, 9))]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(enregistrerPaiementPart(id, new Date(2026, 9, 20))).rejects.toMatchObject({ code: 'PART_DEJA_PAYEE' });
    await expect(markPartStatus({ toolId: (await ensureFacturesToolCached()).tool.id, facturePartageeId: facture.id, partId: id, statusKey: 'a_payer', allParts: await partsOf(facture.id) })).rejects.toMatchObject({ code: 'PAIEMENT_IMMUTABLE' });
    const part = (await coreService.getRecord(id))!;
    expect(part.statusKey).toBe('payee');
    expect(part.values.date_paiement).toBe('2026-10-05');
  });

  it('reçu par compteur : module, période, participant, montant payé, statut, date, index, consommation, prix unitaire, facture totale, méthode', async () => {
    const { koffi, facture, partOf } = await counterScenario('I4');
    await enregistrerPaiementPart(partOf(koffi).id, new Date(2026, 9, 5));
    const part = (await partsOf(facture.id)).find((p) => p.values.participant_id === koffi.participant.id)!;
    const lines = Object.fromEntries(buildReceiptLines(buildReceiptData((await coreService.getRecord(facture.id))!, part)).map((l) => [l.label, l.value]));
    expect(lines).toMatchObject({
      Module: 'CEET',
      Période: 'février 2026',
      Participant: 'I4 Koffi',
      'Montant payé': expect.stringContaining('3'),
      Statut: 'PAYÉ',
      'Date du paiement': '05/10/2026',
      Méthode: 'Par compteur',
      'Index précédent': '100',
      'Index actuel': '130',
      Consommation: '30 kWh',
    });
    expect(lines['Prix unitaire']).toContain('100');
    expect(lines['Facture totale']).toContain('7');
    const text = buildPartReceiptText((await coreService.getRecord(facture.id))!, part);
    expect(text).toContain('REÇU DE PAIEMENT — CEET');
    expect(text).toContain('Index précédent : 100');
    expect(text).toContain('Date du paiement : 05/10/2026');
  });

  it('reçu équitable : méthode, nombre de participants, facture totale, part — aucun faux index', async () => {
    const [a, b, c] = [await addParticipant('tde', { name: 'I5 A' }), await addParticipant('tde', { name: 'I5 B' }), await addParticipant('tde', { name: 'I5 C' })];
    const facture = await newFacture('tde', '2026-02', 12000);
    const ents = await ensureFacturesToolCached();
    const parts = await validateRepartition({ toolId: ents.tool.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: facture.id, mode: 'equitable', lines: computeRepartitionEquitable([a, b, c].map((x) => x.participant), 12000) });
    await enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 5));
    const part = (await coreService.getRecord(parts[0].id))!;
    const labels = buildReceiptLines(buildReceiptData((await coreService.getRecord(facture.id))!, part)).map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Méthode', 'Participants', 'Facture totale', 'Part']));
    expect(labels).not.toEqual(expect.arrayContaining(['Index précédent']));
    expect(labels).not.toEqual(expect.arrayContaining(['Index actuel']));
    const unpaid = buildPartReceiptText((await coreService.getRecord(facture.id))!, (await coreService.getRecord(parts[1].id))!);
    expect(unpaid).toContain('À PAYER');
    expect(unpaid).not.toContain('Date du paiement');
  });

  it('le reçu ne change pas si un relevé, la facture ou le nom de la personne changent ensuite', async () => {
    const { koffi, facture, partOf } = await counterScenario('I6');
    await enregistrerPaiementPart(partOf(koffi).id, new Date(2026, 9, 5));
    const text = async () => buildPartReceiptText((await coreService.getRecord(facture.id))!, (await coreService.getRecord(partOf(koffi).id))!);
    const before = await text();
    const fev = (await relevesOf()).find((r) => r.values.participant_id === koffi.participant.id && r.values.mois === '2026-02')!;
    await coreService.updateRecord(fev.id, { values: { index: 999 } }); // modification directe d'un relevé utilisé
    await coreService.updateRecord(facture.id, { values: { montant_total: 1 } });
    await coreService.updateExternalContact(koffi.participant.id!, { name: 'I6 Koffi Renomme' });
    expect(await text()).toBe(before);
  });

  it('ancienne part payée sans date ni détail : reçu honnête (date inconnue, détail non conservé), rien d\'inventé', async () => {
    const facture = await newFacture('ceet', '2026-01', 6000);
    await coreService.updateRecord(facture.id, { values: { mode_repartition: 'proportionnel' } });
    const ents = await ensureFacturesToolCached();
    const old = await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id, statusKey: 'payee', values: { facture_partagee: facture.id, participant_type: 'manuel', participant_id: null, label: 'Ancien I7', consommation: 30, montant_attribue: 2000 } });
    expect(formatReceiptDate(null)).toBe('inconnue');
    const lines = Object.fromEntries(buildReceiptLines(buildReceiptData((await coreService.getRecord(facture.id))!, old)).map((l) => [l.label, l.value]));
    expect(lines['Date du paiement']).toBe('inconnue');
    expect(lines['Détail des index']).toContain('non conservé');
    expect(lines['Index actuel']).toBeUndefined();
    expect(buildPartReceiptText((await coreService.getRecord(facture.id))!, old)).not.toContain(String(new Date().getFullYear()) + '-');
  });

  it('écran : bouton « Enregistrer le paiement » en un appui, reçu consultable, plus d\'ancienne bascule ni d\'Alert', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source: string = require('fs').readFileSync(require('path').join(__dirname, '../../features/immobilier/screens/RepartitionScreen.tsx'), 'utf8');
    expect(source).toMatch(/label="Enregistrer le paiement"/);
    expect(source).toMatch(/enregistrerPaiementPart\(part\.id\)/);
    expect(source).toMatch(/Voir le reçu/);
    expect(source).toMatch(/Payé \(date inconnue\)/); // jamais « Payé le inconnue » ni la date du jour
    expect(source).toMatch(/<ReceiptCard/);
    expect(source).toMatch(/payingRef\.current/); // garde anti double appui
    expect(source).not.toMatch(/onTogglePartStatus|markPartStatus|Remettre en attente|Alert\.alert\(/);
  });

  it("ordre d'affichage stable : payer une part ne la fait pas changer de place", async () => {
    const { facture } = await counterScenario('I8');
    const order = () => partsOf(facture.id).then((ps) => sortPartsForDisplay(ps).map((p) => p.values.participant_id));
    const before = await order();
    expect(before).toHaveLength(2);
    expect(await order()).toEqual(before); // déterministe : deux lectures successives donnent le même ordre
    // on paie chaque part, en commençant par la dernière : son updatedAt devient le plus récent, l'ordre ne bouge pas
    for (const participantId of [...before].reverse()) {
      const part = (await partsOf(facture.id)).find((p) => p.values.participant_id === participantId)!;
      await enregistrerPaiementPart(part.id, new Date(2026, 9, 5));
      expect(await order()).toEqual(before);
    }
    expect((await partsOf(facture.id)).every((p) => p.statusKey === 'payee')).toBe(true);
  });

  it('messages de paiement lisibles', () => {
    expect(friendlyMessage(new UtilityBillingError('PART_DEJA_PAYEE', 'x'))).toBe('Cette part est déjà payée.');
    expect(friendlyMessage(new UtilityBillingError('PAIEMENT_IMMUTABLE', 'x'))).toBe('Un paiement enregistré ne peut pas être annulé.');
    expect(friendlyMessage(new UtilityBillingError('PAIEMENT_EN_COURS', 'x'))).toContain('en cours');
  });
});
