// Étape 5 — tableau de bord et historique CEET/TDE : tout est calculé depuis les
// données réelles, par module, sans état stocké en double.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesToolCached } from '../facturesService';
import { computeRepartitionEquitable, createFacturePartagee, enregistrerPaiementPart, validateRepartition, validerFactureParCompteur, type Participant } from '../utilityBillingService';
import { addExistingContact, addParticipant, archiveParticipation, listParticipations, saveRelevesPeriode } from '../utilityParticipantsService';
import { buildDashboard, buildHistory, loadModuleOverview } from '../utilityOverviewService';
import type { RecordItem } from '@/types/entities';

const read = (rel: string): string => require('fs').readFileSync(require('path').join(__dirname, '../..', rel), 'utf8'); // eslint-disable-line @typescript-eslint/no-require-imports

async function facture(fournisseur: string, mois: string, montant: number): Promise<RecordItem> {
  const ents = await ensureFacturesToolCached();
  return createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur, mois, montant_total: montant } });
}
async function equitable(factureRecord: RecordItem, participants: Participant[], montant: number): Promise<RecordItem[]> {
  const ents = await ensureFacturesToolCached();
  return validateRepartition({ toolId: ents.tool.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: factureRecord.id, mode: 'equitable', lines: computeRepartitionEquitable(participants, montant) });
}
async function counter(factureRecord: RecordItem, participants: Participant[]): Promise<RecordItem[]> {
  const ents = await ensureFacturesToolCached();
  return validerFactureParCompteur({ toolId: ents.tool.id, releveEntityDefinitionId: ents.releveDefinition.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: factureRecord.id, participants });
}

/** Les jeux de données de ce fichier partagent une seule base en mémoire : on
 * isole chaque test en mesurant uniquement ses propres factures / participants. */
async function snapshotFor(module: 'ceet' | 'tde') {
  const ents = await ensureFacturesToolCached();
  const [participations, releves, factures, parts] = await Promise.all([
    listParticipations(module, { includeArchived: true }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.facturePartageeDefinition.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id }),
  ]);
  return { participations, releves, factures, parts };
}

describe('Module vide : zéros et tirets, rien d\'inventé', () => {
  it('sans aucune donnée', () => {
    const d = buildDashboard({ module: 'ceet', participations: [], releves: [], factures: [], parts: [] });
    expect(d).toEqual({ participants: 0, lastReleve: null, lastFacture: null, aRecevoir: 0, aRegler: [], facturesCount: 0 });
    expect(buildHistory([], [], 'ceet')).toEqual([]);
  });
});

describe('Tableau de bord', () => {
  it('participants (actifs seulement), dernier relevé, dernière facture, à recevoir — par module', async () => {
    const [a, b, c] = [await addParticipant('ceet', { name: 'D1 A' }), await addParticipant('ceet', { name: 'D1 B' }), await addParticipant('ceet', { name: 'D1 C' })];
    await archiveParticipation(c.record.id);
    const before = buildDashboard({ module: 'ceet', ...(await snapshotFor('ceet')) });

    for (const [periode, va, vb] of [['2027-01', 100, 200], ['2027-02', 130, 260]] as const) {
      await saveRelevesPeriode({ fournisseur: 'ceet', periode, entries: [{ participationId: a.record.id, index: va }, { participationId: b.record.id, index: vb }] });
    }
    const f = await facture('ceet', '2027-02', 9000); // 30 + 60 = 90 unités → 100 F l'unité : 3 000 + 6 000
    await counter(f, [a.participant, b.participant]);
    const d = buildDashboard({ module: 'ceet', ...(await snapshotFor('ceet')) });

    expect(d.participants).toBe(before.participants + 0); // C archivé : déjà exclu avant ; A et B comptés dans les deux mesures
    expect(d.participants).toBeGreaterThanOrEqual(2);
    expect(d.lastReleve).toEqual({ periode: '2027-02', count: 2 });
    expect(d.lastFacture).toMatchObject({ factureId: f.id, periode: '2027-02', montant: 9000 });
    expect(d.aRecevoir - before.aRecevoir).toBe(9000);
    expect(d.aRegler[0]).toMatchObject({ factureId: f.id, state: 'a_payer', paid: 0, total: 2, montantRestant: 9000 });
  });

  it('à recevoir diminue à chaque paiement ; la facture réglée sort de « à régler »', async () => {
    const [a, b] = [await addParticipant('tde', { name: 'D2 A' }), await addParticipant('tde', { name: 'D2 B' })];
    const f = await facture('tde', '2027-03', 8000);
    const parts = await equitable(f, [a.participant, b.participant], 8000);
    const dash = async () => buildDashboard({ module: 'tde', ...(await snapshotFor('tde')) });
    const base = (await dash()).aRecevoir;
    await enregistrerPaiementPart(parts[0].id, new Date(2027, 2, 5));
    expect((await dash()).aRecevoir).toBe(base - 4000);
    expect((await dash()).aRegler.find((r) => r.factureId === f.id)).toMatchObject({ state: 'partielle', paid: 1, total: 2, montantRestant: 4000 });
    await enregistrerPaiementPart(parts[1].id, new Date(2027, 2, 6));
    expect((await dash()).aRecevoir).toBe(base - 8000);
    expect((await dash()).aRegler.some((r) => r.factureId === f.id)).toBe(false);
  });

  it('dernier relevé : uniquement les participants du module — ni l\'autre module, ni les relevés « saisie libre »', async () => {
    const p = await addParticipant('ceet', { name: 'D3 Ceet' });
    const mixte = await addExistingContact('tde', p.participant.id!);
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2028-01', entries: [{ participationId: p.record.id, index: 10 }] });
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2028-06', entries: [{ participationId: mixte.record.id, index: 3 }] }); // période plus récente, mais TDE
    // relevé hérité « saisie libre » (aucune participation) à une période encore plus récente
    const ents = await ensureFacturesToolCached();
    await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id, values: { fournisseur: 'CEET', mois: '2030-12', compteur: 'Libre', index: 1, participant_type: 'manuel', participant_id: null } });

    const ceet = buildDashboard({ module: 'ceet', ...(await snapshotFor('ceet')) });
    const tde = buildDashboard({ module: 'tde', ...(await snapshotFor('tde')) });
    expect(ceet.lastReleve!.periode).toBe('2028-01');
    expect(tde.lastReleve!.periode).toBe('2028-06');
  });

  it('un ancien relevé enregistré en « CEET » (majuscules) d\'un participant du module compte', async () => {
    const p = await addParticipant('ceet', { name: 'D4 Ancien' });
    const ents = await ensureFacturesToolCached();
    await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id, values: { fournisseur: 'CEET', mois: '2029-05', compteur: p.participant.label, index: 12, participant_type: 'contact', participant_id: p.participant.id } });
    expect(buildDashboard({ module: 'ceet', ...(await snapshotFor('ceet')) }).lastReleve!.periode).toBe('2029-05');
  });
});

describe('Historique', () => {
  it('une ligne par facture du module, la plus récente d\'abord, avec méthode, n/N payés et état dérivé des parts', async () => {
    const [a, b] = [await addParticipant('ceet', { name: 'H1 A' }), await addParticipant('ceet', { name: 'H1 B' })];
    for (const periode of ['2031-01', '2031-02']) await saveRelevesPeriode({ fournisseur: 'ceet', periode, entries: [{ participationId: a.record.id, index: periode === '2031-01' ? 100 : 150 }, { participationId: b.record.id, index: periode === '2031-01' ? 50 : 70 }] });
    const fJan = await facture('ceet', '2031-01', 5000);
    const fFev = await facture('ceet', '2031-02', 7000); // 50 + 20 : par compteur
    const fMars = await facture('ceet', '2031-03', 3000); // non répartie
    const partsJan = await equitable(fJan, [a.participant, b.participant], 5000);
    await counter(fFev, [a.participant, b.participant]);
    await enregistrerPaiementPart(partsJan[0].id, new Date(2031, 1, 1));
    await enregistrerPaiementPart(partsJan[1].id, new Date(2031, 1, 2));

    const { factures, parts } = await snapshotFor('ceet');
    const rows = buildHistory(factures, parts, 'ceet').filter((r) => [fJan.id, fFev.id, fMars.id].includes(r.factureId));
    expect(rows.map((r) => r.periode)).toEqual(['2031-03', '2031-02', '2031-01']); // récent d'abord
    expect(rows[0]).toMatchObject({ factureId: fMars.id, state: 'a_repartir', methode: null, total: 0, montantTotal: 3000 });
    expect(rows[1]).toMatchObject({ factureId: fFev.id, state: 'a_payer', methode: 'Par compteur', paid: 0, total: 2, montantRestant: 7000 });
    expect(rows[2]).toMatchObject({ factureId: fJan.id, state: 'payee', methode: 'Partage équitable', paid: 2, total: 2, montantRestant: 0 });
  });

  it('l\'état vient des parts réelles, pas d\'un statut stocké (même si le statut de la facture est périmé)', async () => {
    const [a, b] = [await addParticipant('tde', { name: 'H2 A' }), await addParticipant('tde', { name: 'H2 B' })];
    const f = await facture('tde', '2032-01', 2000);
    await equitable(f, [a.participant, b.participant], 2000);
    await coreService.updateRecord(f.id, { statusKey: 'payee' }); // statut stocké volontairement faux
    const { factures, parts } = await snapshotFor('tde');
    expect(buildHistory(factures, parts, 'tde').find((r) => r.factureId === f.id)).toMatchObject({ state: 'a_payer', paid: 0, total: 2 });
  });

  it('isolation : l\'historique CEET ne contient jamais une facture TDE (et inversement) ni une facture « autre »', async () => {
    const p = await addParticipant('ceet', { name: 'H3 P' });
    const q = await addExistingContact('tde', p.participant.id!);
    const fc = await facture('ceet', '2033-01', 1000);
    const ft = await facture('tde', '2033-01', 2000);
    const fa = await facture('autre', '2033-01', 3000);
    await equitable(fc, [p.participant], 1000);
    await equitable(ft, [q.participant], 2000);
    const { factures, parts } = await snapshotFor('ceet');
    const ids = (m: 'ceet' | 'tde') => buildHistory(factures, parts, m).map((r) => r.factureId);
    expect(ids('ceet')).toContain(fc.id);
    expect(ids('ceet')).not.toContain(ft.id);
    expect(ids('tde')).toContain(ft.id);
    expect(ids('tde')).not.toContain(fc.id);
    expect([...ids('ceet'), ...ids('tde')]).not.toContain(fa.id);
  });

  it('une ancienne facture « CEET » avec une part payée sans date apparaît, sans rien inventer', async () => {
    const ents = await ensureFacturesToolCached();
    const old = await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.facturePartageeDefinition.id, statusKey: 'partielle', values: { fournisseur: 'CEET', mois: '2024-12', montant_total: 6000, mode_repartition: 'proportionnel' } });
    await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id, statusKey: 'payee', values: { facture_partagee: old.id, participant_type: 'manuel', participant_id: null, label: 'Ancien', consommation: 30, montant_attribue: 2000 } });
    await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id, statusKey: 'a_payer', values: { facture_partagee: old.id, participant_type: 'manuel', participant_id: null, label: 'Autre', consommation: 60, montant_attribue: 4000 } });
    const { factures, parts } = await snapshotFor('ceet');
    expect(buildHistory(factures, parts, 'ceet').find((r) => r.factureId === old.id)).toMatchObject({ periode: '2024-12', methode: 'Par compteur', state: 'partielle', paid: 1, total: 2, montantRestant: 4000 });
  });
});

describe("Création d'une facture : fournisseur normalisé", () => {
  it('le libellé du formulaire (« TDE », « CEET », « Autre ») est enregistré comme identifiant (tde, ceet, autre)', async () => {
    expect((await facture('TDE', '2036-01', 100)).values.fournisseur).toBe('tde');
    expect((await facture('CEET', '2036-01', 100)).values.fournisseur).toBe('ceet');
    expect((await facture('Autre', '2036-01', 100)).values.fournisseur).toBe('autre');
    expect((await facture('ceet', '2036-01', 100)).values.fournisseur).toBe('ceet');
    expect((await facture('Gaz', '2036-01', 100)).values.fournisseur).toBe('Gaz'); // inconnu : laissé tel quel, jamais deviné
  });

  it("une facture créée avec « TDE » apparaît dans l'historique TDE (et pas CEET)", async () => {
    const f = await facture('TDE', '2036-02', 4000);
    const { factures, parts } = await snapshotFor('tde');
    expect(buildHistory(factures, parts, 'tde').some((r) => r.factureId === f.id)).toBe(true);
    expect(buildHistory(factures, parts, 'ceet').some((r) => r.factureId === f.id)).toBe(false);
  });
});

describe('Chargement réel et persistance', () => {
  it('loadModuleOverview : même résultat avant et après un redémarrage', async () => {
    jest.useFakeTimers();
    try {
      const [a, b] = [await addParticipant('ceet', { name: 'P1 A' }), await addParticipant('ceet', { name: 'P1 B' })];
      const f = await facture('ceet', '2035-04', 6000);
      const parts = await equitable(f, [a.participant, b.participant], 6000);
      await enregistrerPaiementPart(parts[0].id, new Date(2035, 3, 2));
      const before = await loadModuleOverview('ceet');

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0;
      await hydrateDb();

      const after = await loadModuleOverview('ceet');
      expect(after).toEqual(before);
      expect(after.history.find((r) => r.factureId === f.id)).toMatchObject({ state: 'partielle', paid: 1, total: 2, montantRestant: 3000 });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Écrans et points d\'entrée', () => {
  it('routes /ceet, /tde, historique, index et participants existent pour les deux modules', () => {
    for (const m of ['ceet', 'tde']) {
      expect(read(`app/${m}/index.tsx`)).toContain(`<UtilityDashboardScreen module="${m}" />`);
      expect(read(`app/${m}/historique.tsx`)).toContain(`<UtilityHistoryScreen module="${m}" />`);
      expect(read(`app/${m}/releves.tsx`)).toContain(`module="${m}"`);
      expect(read(`app/${m}/participants.tsx`)).toContain(`module="${m}"`);
    }
  });

  it('accueil : quatre indicateurs et les actions demandées, sans ressaisie ni donnée stockée', () => {
    const src = read('features/utilities/screens/UtilityDashboardScreen.tsx');
    for (const label of ['Participants', 'Dernier relevé', 'Dernière facture', 'À recevoir', 'Enregistrer les index', 'Calculer une facture', 'Historique']) expect(src).toContain(label);
    expect(src).toMatch(/loadModuleOverview\(module\)/);
    expect(src).toMatch(/params: \{ fournisseur: module \}/);
    expect(src).not.toMatch(/TextField|saveReleve|AsyncStorage/);
  });

  it('historique : une carte par facture qui ouvre la facture existante (parts, paiements, reçus)', () => {
    const src = read('features/utilities/screens/UtilityHistoryScreen.tsx');
    expect(src).toMatch(/\/factures\/facture-partagee\/\$\{row\.factureId\}/);
    expect(src).toMatch(/HistoryRowCard/);
    const card = read('features/utilities/components/HistoryRowCard.tsx');
    expect(card).toMatch(/payé\$\{row\.total > 1 \? 's' : ''\}/);
  });

  it('entrées visibles : cartes CEET et TDE sur l\'accueil, boutons Factures vers les accueils, fournisseur présélectionné', () => {
    const home = read('features/home/screens/HomeScreen.tsx');
    expect(home).toMatch(/title="CEET"[\s\S]*router\.push\('\/ceet'/);
    expect(home).toMatch(/title="TDE"[\s\S]*router\.push\('\/tde'/);
    const list = read('features/factures/screens/FacturesListScreen.tsx');
    expect(list).toMatch(/router\.push\('\/ceet' as never\)/);
    expect(list).toMatch(/router\.push\('\/tde' as never\)/);
    expect(list).not.toMatch(/'\/ceet\/releves'|'\/tde\/releves'/);
    const form = read('features/immobilier/screens/FacturePartageeFormScreen.tsx');
    expect(form).toMatch(/fournisseur === 'ceet' \|\| fournisseur === 'tde'/);
  });
});
