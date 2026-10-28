// Phase 9 — historique et statistiques par module (Tontine, Immobilier, CEET, TDE).
// Tout est calculé à la lecture depuis les données réelles ; une consultation n'écrit rien.
// Chaque test repart d'une base vide (jest.resetModules).

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import fs from 'fs';
import path from 'path';
import { buildImmobilierStats, buildUtilityStats, formatPaymentDate } from '../moduleStatsService';

/* eslint-disable @typescript-eslint/no-require-imports */
function fresh() {
  jest.resetModules();
  return {
    db: require('../db') as typeof import('../db'),
    core: require('../coreService') as typeof import('../coreService'),
    stats: require('../moduleStatsService') as typeof import('../moduleStatsService'),
    space: require('../tontineOverviewService') as typeof import('../tontineOverviewService'),
    groupService: require('../groupService').groupService as typeof import('../groupService').groupService,
    tontineService: require('../tontineService').tontineService as typeof import('../tontineService').tontineService,
    immo: require('../immobilierService') as typeof import('../immobilierService'),
    parts: require('../utilityParticipantsService') as typeof import('../utilityParticipantsService'),
    billing: require('../utilityBillingService') as typeof import('../utilityBillingService'),
    factures: require('../facturesService') as typeof import('../facturesService'),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */
type World = ReturnType<typeof fresh>;

const NOW = new Date(2026, 9, 15); // 15 octobre 2026
const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const snapshot = (w: World) => ({ tools: w.db.tools.length, records: w.db.records.length, members: w.db.toolMembers.length, groups: w.db.groups.length, tours: w.db.tours.length, contributions: w.db.contributions.length, activities: w.db.activityEvents.length, contacts: w.db.externalContacts.length });

// ------------------------------------------------------------------------------------------------ Immobilier

async function louer(w: World, dernier: string | null, nom = 'Kossi Adjo') {
  const bien = await w.immo.createBien({ nom: `Résidence ${nom}`, adresse: 'Lomé' });
  const { contrat, contact } = await w.immo.createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: 'Studio' },
    nom,
    telephone: '90123456',
    loyerMensuel: 50000,
    dateEntree: new Date(2026, 0, 5),
    dernierLoyerPaye: dernier,
  } as Parameters<typeof w.immo.createLocataireEtContrat>[0]);
  return { contrat, contact };
}

describe('Immobilier — statistiques', () => {
  it('sans outil Immobilier : null, et rien n’est créé en consultant', async () => {
    const w = fresh();
    expect(await w.stats.loadImmobilierStats('all', NOW)).toBeNull();
    expect(await w.stats.loadImmobilierHistory()).toEqual([]);
    expect(w.db.tools).toHaveLength(0);
    expect(buildImmobilierStats({ biens: [], logements: [], contrats: [], paiements: [] }, NOW)).toMatchObject({
      biens: 0, logements: 0, occupes: 0, vacants: 0, contratsActifs: 0, contratsTermines: 0, encaisse: { amount: 0, count: 0, sansDate: 0 }, impayes: { contrats: 0, loyers: 0 },
    });
  });

  it('compte biens, logements, occupation et contrats à partir des vraies données', async () => {
    const w = fresh();
    await louer(w, '2026-08', 'Awa');
    const { contrat } = await louer(w, '2026-08', 'Moussa');
    await w.immo.terminerContrat(contrat.id);
    const s = (await w.stats.loadImmobilierStats('all', NOW))!;
    expect(s).toMatchObject({ biens: 2, logements: 2, occupes: 1, vacants: 1, contratsActifs: 1, contratsTermines: 1 });
  });

  it('loyers encaissés : seulement les paiements enregistrés, par période ; le « dernier loyer payé » déclaré n’est pas un encaissement', async () => {
    const w = fresh();
    const { contrat } = await louer(w, '2026-07'); // juillet déclaré payé : aucun paiement enregistré
    expect((await w.stats.loadImmobilierStats('all', NOW))!.encaisse).toMatchObject({ amount: 0, count: 0 });

    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2025, 11, 20)); // août, validé fin 2025 (autre année)
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 8, 5)); // septembre, validé en septembre
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 3)); // octobre, validé ce mois-ci

    expect((await w.stats.loadImmobilierStats('all', NOW))!.encaisse).toMatchObject({ amount: 150000, count: 3 });
    expect((await w.stats.loadImmobilierStats('year', NOW))!.encaisse).toMatchObject({ amount: 100000, count: 2 });
    expect((await w.stats.loadImmobilierStats('month', NOW))!.encaisse).toMatchObject({ amount: 50000, count: 1 });
  });

  it('encaissé ≠ attendu : les loyers impayés ne sont comptés qu’en nombre de loyers, jamais en montant', async () => {
    const w = fresh();
    await louer(w, '2026-07'); // août et septembre dus et non payés au 15 octobre
    const s = (await w.stats.loadImmobilierStats('all', NOW))!;
    expect(s.impayes).toEqual({ contrats: 1, loyers: 2 });
    expect(s.encaisse.amount).toBe(0);
    expect(Object.keys(s)).not.toContain('attendu');
  });

  it('un paiement sans date exploitable est signalé et exclu d’une période précise, mais compté dans « Tout »', () => {
    const paiement = { id: 'p', statusKey: 'paye', values: { montant: 50000, contrat: 'c' }, createdAt: '2026-10-01T00:00:00Z' } as never;
    expect(buildImmobilierStats({ biens: [], logements: [], contrats: [], paiements: [paiement] }, NOW, 'month').encaisse).toMatchObject({ amount: 0, count: 0, sansDate: 1 });
    expect(buildImmobilierStats({ biens: [], logements: [], contrats: [], paiements: [paiement] }, NOW, 'all').encaisse).toMatchObject({ amount: 50000, count: 1, sansDate: 0 });
  });
});

describe('Immobilier — historique', () => {
  it('liste les loyers enregistrés, avec nom et période, même sans aucun événement de journal (anciens paiements)', async () => {
    const w = fresh();
    const { contrat } = await louer(w, '2026-07');
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 7, 10));
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 8, 5));
    w.db.activityEvents.length = 0; // simule des paiements antérieurs au journal

    const rows = await w.stats.loadImmobilierHistory();
    const loyers = rows.filter((r) => r.type === 'immobilier.loyer_paid');
    expect(loyers).toHaveLength(2);
    expect(loyers[0].description).toContain('Kossi Adjo');
    expect(loyers[0].description).toContain('Studio');
    expect(loyers.map((r) => r.amount)).toEqual([50000, 50000]);
    expect(rows.map((r) => r.at)).toEqual([...rows.map((r) => r.at)].sort().reverse()); // du plus récent au plus ancien
  });

  it('un paiement n’apparaît qu’une fois (enregistrement + événement), et l’événement d’un paiement supprimé reste', async () => {
    const w = fresh();
    const { contrat } = await louer(w, '2026-07');
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 7, 10));
    const loyers = async () => (await w.stats.loadImmobilierHistory()).filter((r) => r.type === 'immobilier.loyer_paid');
    expect(await loyers()).toHaveLength(1); // 1 paiement, pas 2
    await w.immo.deleteContratCascade(contrat.id); // le paiement n'existe plus, son événement de journal oui
    expect(await loyers()).toHaveLength(1);
  });

  it('ne reprend jamais les événements des autres modules', async () => {
    const w = fresh();
    await louer(w, '2026-07');
    await w.groupService.createTontine({ name: 'Famille', contributionAmount: 5000, frequency: 'monthly', startDate: new Date().toISOString(), orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0]);
    await w.parts.addParticipant('ceet', { name: 'Awa' });
    const rows = await w.stats.loadImmobilierHistory();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.module === 'immobilier')).toBe(true);
    expect(rows.some((r) => r.type === 'group_created' || r.type === 'utility.participant_added')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ CEET / TDE

async function participants(w: World, module: 'ceet' | 'tde', names: string[]) {
  const out = [];
  for (const name of names) out.push(await w.parts.addParticipant(module, { name }));
  return out;
}
async function newFacture(w: World, module: string, mois: string, montant: number) {
  const ents = await w.factures.ensureFacturesToolCached();
  return w.billing.createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: module, mois, montant_total: montant } });
}
async function validerEquitable(w: World, module: 'ceet' | 'tde', list: Awaited<ReturnType<typeof participants>>, mois: string, montant: number) {
  const ents = await w.factures.ensureFacturesToolCached();
  const facture = await newFacture(w, module, mois, montant);
  return w.billing.validateRepartition({
    toolId: ents.tool.id,
    partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
    facturePartageeId: facture.id,
    mode: 'equitable',
    lines: w.billing.computeRepartitionEquitable(list.map((p) => p.participant), montant),
  });
}
async function validerParCompteur(w: World, list: Awaited<ReturnType<typeof participants>>, mois: string, montant: number) {
  const ents = await w.factures.ensureFacturesToolCached();
  const facture = await newFacture(w, list[0].fournisseur, mois, montant);
  return w.billing.validerFactureParCompteur({
    toolId: ents.tool.id,
    releveEntityDefinitionId: ents.releveDefinition.id,
    partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
    facturePartageeId: facture.id,
    participants: list.map((p) => p.participant),
  });
}
const releves = (w: World, module: 'ceet' | 'tde', periode: string, list: Awaited<ReturnType<typeof participants>>, indexes: number[]) =>
  w.parts.saveRelevesPeriode({ fournisseur: module, periode, entries: list.map((p, i) => ({ participationId: p.record.id, index: indexes[i] })) });

describe('CEET / TDE — statistiques', () => {
  it('sans outil Factures ou sans facture : null / zéros, et rien n’est créé', async () => {
    const w = fresh();
    expect(await w.stats.loadUtilityStats('ceet')).toBeNull();
    expect(await w.stats.loadUtilityPayments('tde')).toEqual([]);
    expect(w.db.tools).toHaveLength(0);
    expect(buildUtilityStats('ceet', [], [])).toMatchObject({ facturesValidees: 0, facturesEnAttente: 0, parts: { total: 0, payees: 0, restantes: 0 }, montants: { paye: 0, restant: 0 }, periodes: [] });
  });

  it('séparation stricte : CEET et TDE ne voient chacun que leurs propres factures, parts et paiements', async () => {
    const w = fresh();
    const ceet = await participants(w, 'ceet', ['A', 'B']);
    const tde = await participants(w, 'tde', ['C', 'D', 'E']);
    const ceetParts = await validerEquitable(w, 'ceet', ceet, '2026-09', 20000);
    await validerEquitable(w, 'tde', tde, '2026-09', 9000);
    await w.billing.enregistrerPaiementPart(ceetParts[0].id, new Date(2026, 9, 12));

    const c = (await w.stats.loadUtilityStats('ceet'))!;
    const t = (await w.stats.loadUtilityStats('tde'))!;
    expect(c).toMatchObject({ facturesValidees: 1, parts: { total: 2, payees: 1, restantes: 1 }, montants: { paye: 10000, restant: 10000 } });
    expect(t).toMatchObject({ facturesValidees: 1, parts: { total: 3, payees: 0, restantes: 3 }, montants: { paye: 0, restant: 9000 } });
    expect((await w.stats.loadUtilityPayments('ceet')).map((p) => p.label)).toEqual(['A']);
    expect(await w.stats.loadUtilityPayments('tde')).toEqual([]);
  });

  it('payé + restant = total des parts figées ; une facture non répartie n’est ni validée ni impayée', async () => {
    const w = fresh();
    const list = await participants(w, 'ceet', ['A', 'B', 'C']);
    await newFacture(w, 'ceet', '2026-08', 15000); // jamais validée
    const parts = await validerEquitable(w, 'ceet', list, '2026-09', 30000);
    await w.billing.enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 1));
    await w.billing.enregistrerPaiementPart(parts[1].id, new Date(2026, 9, 2));
    const s = (await w.stats.loadUtilityStats('ceet'))!;
    expect(s).toMatchObject({ facturesValidees: 1, facturesEnAttente: 1, parts: { total: 3, payees: 2, restantes: 1 } });
    expect(s.montants.paye + s.montants.restant).toBe(30000);
    expect(s.montants).toEqual({ paye: 20000, restant: 10000 });
  });

  it('consommation par période : figée à la validation, jamais confondue avec le montant, variation seulement entre mois consécutifs connus', async () => {
    const w = fresh();
    const list = await participants(w, 'ceet', ['A', 'B']);
    await releves(w, 'ceet', '2026-08', list, [100, 200]);
    await releves(w, 'ceet', '2026-09', list, [130, 250]); // consommation 30 + 50 = 80
    await releves(w, 'ceet', '2026-10', list, [150, 290]); // consommation 20 + 40 = 60
    await validerParCompteur(w, list, '2026-09', 8000);
    await validerParCompteur(w, list, '2026-10', 6000);
    await validerEquitable(w, 'ceet', list, '2026-11', 7000); // partage équitable : aucune consommation connue

    const periodes = (await w.stats.loadUtilityStats('ceet'))!.periodes;
    expect(periodes.map((p) => p.periode)).toEqual(['2026-11', '2026-10', '2026-09']);
    const [nov, oct, sep] = periodes;
    expect(sep).toMatchObject({ montantFacture: 8000, consommation: 80, variation: null }); // pas d'août validé : rien à comparer
    expect(oct).toMatchObject({ montantFacture: 6000, consommation: 60, variation: -25 });
    expect(nov).toMatchObject({ montantFacture: 7000, consommation: null, variation: null }); // inconnue ≠ 0
  });

  it('pas de variation entre deux mois non consécutifs ni sans consommation de référence', async () => {
    const w = fresh();
    const list = await participants(w, 'tde', ['A', 'B']);
    await releves(w, 'tde', '2026-05', list, [10, 20]);
    await releves(w, 'tde', '2026-06', list, [20, 40]);
    await releves(w, 'tde', '2026-09', list, [30, 60]); // juin → septembre : trois mois d'écart, relevé précédent = juin
    await validerParCompteur(w, list, '2026-06', 4000);
    await validerParCompteur(w, list, '2026-09', 3000);
    const periodes = (await w.stats.loadUtilityStats('tde'))!.periodes;
    expect(periodes.find((p) => p.periode === '2026-09')).toMatchObject({ consommation: 30, variation: null });
  });

  it('respecte les instantanés : renommer un participant ou changer son contact ne modifie ni les montants ni les paiements passés', async () => {
    const w = fresh();
    const list = await participants(w, 'ceet', ['Koffi', 'Awa']);
    const parts = await validerEquitable(w, 'ceet', list, '2026-09', 10000);
    await w.billing.enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 12));
    const before = { stats: await w.stats.loadUtilityStats('ceet'), payments: await w.stats.loadUtilityPayments('ceet') };

    const contact = (await w.core.coreService.getExternalContacts()).find((c) => c.name === 'Koffi')!;
    await w.core.coreService.updateExternalContact(contact.id, { name: 'Nouveau nom' });

    expect(await w.stats.loadUtilityStats('ceet')).toEqual(before.stats);
    expect(await w.stats.loadUtilityPayments('ceet')).toEqual(before.payments);
    expect(before.payments[0].label).toBe('Koffi'); // le nom figé à la validation
  });

  it('une période qui n’est pas au format mois/année est comptée dans les totaux mais absente du détail par période', async () => {
    const w = fresh();
    const list = await participants(w, 'ceet', ['A', 'B']);
    await validerEquitable(w, 'ceet', list, 'Septembre', 10000);
    const s = (await w.stats.loadUtilityStats('ceet'))!;
    expect(s).toMatchObject({ facturesValidees: 1, periodesNonStandard: 1, periodes: [] });
    expect(s.parts.total).toBe(2);
  });
});

describe('CEET / TDE — paiements dans l’historique', () => {
  it('dates réelles, plus récent d’abord ; un paiement sans date enregistrée est dit tel quel, jamais daté d’aujourd’hui', async () => {
    const w = fresh();
    const list = await participants(w, 'tde', ['A', 'B', 'C']);
    const parts = await validerEquitable(w, 'tde', list, '2026-09', 9000);
    await w.billing.enregistrerPaiementPart(parts[0].id, new Date(2026, 9, 3));
    await w.billing.enregistrerPaiementPart(parts[1].id, new Date(2026, 9, 12));
    await w.core.coreService.updateRecord(parts[2].id, { statusKey: 'payee' }); // ancienne part payée, sans date_paiement

    const rows = await w.stats.loadUtilityPayments('tde');
    expect(rows.map((r) => r.datePaiement)).toEqual(['2026-10-12', '2026-10-03', null]);
    expect(rows.map((r) => r.label)).toEqual(['B', 'A', 'C']);
    expect(rows.every((r) => r.montant === 3000)).toBe(true);
    expect(formatPaymentDate('2026-10-12')).toBe('12 octobre 2026');
    expect(formatPaymentDate(null)).toBe('date non enregistrée');
  });
});

// ------------------------------------------------------------------------------------------------ Tontine

describe('Tontine — statistiques', () => {
  const group = (w: World, name: string, startDate: string, guests: string[]) =>
    w.groupService
      .createTontine({ name, contributionAmount: 5000, frequency: 'monthly', startDate, orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0])
      .then(async (g) => {
        const members = [];
        for (const first of guests) members.push(await w.groupService.addGuestMember(g.id, { firstName: first, lastName: 'Test' }));
        return { group: g, members };
      });
  const past = () => new Date(Date.now() - 60 * 86_400_000).toISOString();
  const future = () => new Date(Date.now() + 10 * 86_400_000).toISOString();

  it('une même personne dans plusieurs tontines n’est comptée qu’une fois ; les participations restent additionnées', async () => {
    const w = fresh();
    await group(w, 'Famille', future(), ['A', 'B']); // « Vous » + 2 invités
    await group(w, 'Amis', future(), ['C']); // « Vous » + 1 invité
    const stats = await w.space.loadTontineStats();
    expect(stats.members).toBe(5);
    expect(stats.distinctMembers).toBe(4); // « Vous » une seule fois ; les invités sont des personnes distinctes
    const overview = await w.space.loadTontineOverview();
    expect(overview.totalMembers).toBe(5);
    expect(overview.distinctMembers).toBe(4);
  });

  it('cotisations payées, en attente et en retard selon les statuts réels des tours', async () => {
    const w = fresh();
    const late = await group(w, 'Ancienne', past(), ['A', 'B']); // tour 1 échu : 3 membres
    await group(w, 'Future', future(), ['C']); // tour 1 à venir : 2 membres
    const { summary, tour } = await (async () => {
      const s = (await w.tontineService.getSummary(late.group.id))!;
      return { summary: s, tour: s.currentTour! };
    })();
    await w.tontineService.getSummary((await w.groupService.listMyGroups()).find((g) => g.name === 'Future')!.id);
    await w.tontineService.recordContributions({ groupId: late.group.id, tourId: tour.id, memberIds: [summary.members[0].id] });

    const stats = await w.space.loadTontineStats();
    expect(stats).toMatchObject({ toursGenerated: 2, toursComplete: 0, paidContributions: 1, lateContributions: 2, pendingContributions: 2 });
    expect(stats.paidContributions + stats.lateContributions + stats.pendingContributions).toBe(5); // 3 + 2 cotisations attendues, aucune inventée
  });

  it('un tour complet n’a aucune cotisation en attente ni en retard, même si sa date est passée', async () => {
    const w = fresh();
    const { group: g } = await group(w, 'Complète', past(), ['A']);
    const s = (await w.tontineService.getSummary(g.id))!;
    await w.tontineService.recordContributions({ groupId: g.id, tourId: s.currentTour!.id, memberIds: s.members.map((m) => m.id) });
    const stats = await w.space.loadTontineStats();
    expect(stats).toMatchObject({ toursComplete: 1, paidContributions: 2, pendingContributions: 0, lateContributions: 0 });
  });

  it('les statistiques ne génèrent aucun tour et ne modifient aucune donnée', async () => {
    const w = fresh();
    await group(w, 'Sans tour', future(), ['A', 'B']);
    expect(w.db.tours).toHaveLength(0);
    const before = snapshot(w);
    const stats = await w.space.loadTontineStats();
    expect(stats).toMatchObject({ tontines: 1, members: 3, toursGenerated: 0, paymentRate: null, paidContributions: 0, pendingContributions: 0, lateContributions: 0 });
    expect(snapshot(w)).toEqual(before);
  });

  it('état vide : zéros honnêtes et taux inconnu', async () => {
    const w = fresh();
    expect(await w.space.loadTontineStats()).toMatchObject({ tontines: 0, members: 0, distinctMembers: 0, toursGenerated: 0, paymentRate: null, paidContributions: 0 });
  });
});

// ------------------------------------------------------------------------------------------------ Consultation et navigation

describe('Consultation sans écriture', () => {
  it('lire historiques et statistiques ne modifie ni données, ni outils, ni activités', async () => {
    const w = fresh();
    const { contrat } = await louer(w, '2026-07');
    await w.immo.enregistrerPaiementLoyer(contrat.id, new Date(2026, 7, 10));
    const list = await participants(w, 'ceet', ['A', 'B']);
    await validerEquitable(w, 'ceet', list, '2026-09', 10000);
    const before = snapshot(w);
    for (let i = 0; i < 2; i += 1) {
      await w.stats.loadImmobilierStats('all', NOW);
      await w.stats.loadImmobilierHistory();
      await w.stats.loadUtilityStats('ceet');
      await w.stats.loadUtilityStats('tde');
      await w.stats.loadUtilityPayments('ceet');
      await w.space.loadTontineStats();
    }
    expect(snapshot(w)).toEqual(before);
    expect(read('services/moduleStatsService.ts')).not.toContain('recordActivity');
  });
});

describe('Accès depuis les espaces des modules', () => {
  it('les routes existent et sont liées depuis l’espace de chaque module', () => {
    for (const route of ['app/immobilier/historique.tsx', 'app/immobilier/statistiques.tsx', 'app/ceet/historique.tsx', 'app/ceet/statistiques.tsx', 'app/tde/historique.tsx', 'app/tde/statistiques.tsx', 'app/tontine/historique.tsx', 'app/tontine/statistiques.tsx']) {
      expect(exists(route)).toBe(true);
    }
    const biens = read('features/immobilier/screens/BiensListScreen.tsx');
    expect(biens).toContain('/immobilier/historique');
    expect(biens).toContain('/immobilier/statistiques');
    const dashboard = read('features/utilities/screens/UtilityDashboardScreen.tsx');
    expect(dashboard).toContain('/${module}/historique');
    expect(dashboard).toContain('/${module}/statistiques');
    const space = read('features/tontines/screens/TontineSpaceScreen.tsx');
    expect(space).toContain('/tontine/historique');
    expect(space).toContain('/tontine/statistiques');
    expect(read('app/ceet/statistiques.tsx')).toContain('module="ceet"');
    expect(read('app/tde/statistiques.tsx')).toContain('module="tde"');
  });

  it('aucun onglet ni lien vers les anciennes statistiques globales ou les modules masqués', () => {
    for (const file of ['features/immobilier/screens/ImmobilierHistoryScreen.tsx', 'features/immobilier/screens/ImmobilierStatsScreen.tsx', 'features/utilities/screens/UtilityStatsScreen.tsx', 'features/utilities/screens/UtilityHistoryScreen.tsx', 'features/tontines/screens/TontineModuleStatsScreen.tsx']) {
      expect(read(file)).not.toMatch(/\(tabs\)\/statistiques|\/statistics|'\/scan|'\/form|'\/records|'\/factures'|\(tabs\)\/modeles/);
    }
    expect(read('app/(tabs)/_layout.tsx')).toMatch(/name="statistiques" options=\{\{ href: null \}\}/);
  });
});
