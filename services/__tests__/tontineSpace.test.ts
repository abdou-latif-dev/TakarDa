// Phase 5 — espace Tontine : synthèse, historique et statistiques du module, calculés
// depuis les données réelles (Group / Membership / Tour / Contribution), sans Tool par groupe.
// Chaque test repart d'une base vide (jest.resetModules).

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import fs from 'fs';
import path from 'path';
import { buildTontineOverview, buildTontineStats } from '../tontineOverviewService';
import { getCatalogModel } from '../toolCatalogService';

/* eslint-disable @typescript-eslint/no-require-imports */
function fresh() {
  jest.resetModules();
  return {
    db: require('../db') as typeof import('../db'),
    space: require('../tontineOverviewService') as typeof import('../tontineOverviewService'),
    registry: require('../toolRegistryService') as typeof import('../toolRegistryService'),
    groupService: require('../groupService').groupService as typeof import('../groupService').groupService,
    tontineService: require('../tontineService').tontineService as typeof import('../tontineService').tontineService,
    tours: require('../tontineTours') as typeof import('../tontineTours'),
    activity: require('../activityService') as typeof import('../activityService'),
    immo: require('../immobilierService') as typeof import('../immobilierService'),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */
type World = ReturnType<typeof fresh>;

const future = () => new Date(Date.now() + 10 * 86_400_000).toISOString();
const past = () => new Date(Date.now() - 60 * 86_400_000).toISOString();

async function tontine(w: World, name: string, opts: { startDate?: string; guests?: string[]; includeSelf?: boolean; amount?: number } = {}) {
  const group = await w.groupService.createTontine({
    name,
    contributionAmount: opts.amount ?? 5000,
    frequency: 'monthly',
    startDate: opts.startDate ?? future(),
    orderMethod: 'join_order',
    includeSelfAsMember: opts.includeSelf,
  } as Parameters<typeof w.groupService.createTontine>[0]);
  const members = [];
  for (const first of opts.guests ?? []) members.push(await w.groupService.addGuestMember(group.id, { firstName: first, lastName: 'Test' }));
  return { group, members };
}

async function currentTour(w: World, groupId: string) {
  const summary = (await w.tontineService.getSummary(groupId))!;
  return { summary, tour: summary.currentTour! };
}

describe('Aucune donnée', () => {
  it('aucune tontine : état vide, aucune valeur inventée', async () => {
    const w = fresh();
    const overview = await w.space.loadTontineOverview();
    expect(overview).toEqual({ tontines: [], activeTontines: 0, totalMembers: 0, distinctMembers: 0, nextTour: null, pendingContributions: null, expectedAmount: null, lateTontines: 0 });
    expect(buildTontineOverview([])).toEqual(overview);
    expect(w.space.getTontineHistory()).toEqual([]);
    expect(buildTontineStats({ tontines: 0, members: 0, histories: [] })).toMatchObject({ toursGenerated: 0, collected: 0, expected: 0, remaining: 0, paymentRate: null });
  });

  it('une tontine sans membre ne plante pas : tour et montants restent « inconnus » (null)', async () => {
    const w = fresh();
    await tontine(w, 'Vide', { includeSelf: false });
    const overview = await w.space.loadTontineOverview();
    expect(overview.tontines).toHaveLength(1);
    expect(overview.tontines[0]).toMatchObject({ name: 'Vide', memberCount: 0, tour: null, tourStatus: null, nextBeneficiary: null });
    expect(overview.nextTour).toBeNull();
    expect(overview.pendingContributions).toBeNull();
    expect(overview.expectedAmount).toBeNull();
    expect(overview.activeTontines).toBe(1);
    const stats = await w.space.loadTontineStats();
    expect(stats).toMatchObject({ tontines: 1, members: 0, toursGenerated: 0, paymentRate: null });
  });
});

describe('Une tontine', () => {
  it('apparaît avec ses membres, son montant, sa fréquence et son prochain bénéficiaire', async () => {
    const w = fresh();
    const { group } = await tontine(w, 'Famille', { guests: ['Moussa', 'Awa'], amount: 50000 });
    const overview = await w.space.loadTontineOverview();

    expect(overview.tontines.map((c) => c.groupId)).toEqual([group.id]);
    const card = overview.tontines[0];
    expect(card).toMatchObject({ name: 'Famille', memberCount: 3, amountPerMember: 50000, frequency: 'monthly', status: 'active', expectedTotal: 150000, collected: 0, remaining: 150000, paidCount: 0 });
    expect(card.tour).toMatchObject({ tourNumber: 1, cycleNumber: 1, positionInCycle: 1 });
    expect(card.nextBeneficiary).toBe('Vous'); // le créateur est membre n°1
    expect(card.tourStatus).toBe('upcoming');
    expect(overview).toMatchObject({ activeTontines: 1, totalMembers: 3, pendingContributions: 3, expectedAmount: 150000, lateTontines: 0 });
    expect(overview.nextTour).toMatchObject({ groupId: group.id, name: 'Famille', beneficiary: 'Vous', late: false });
  });

  it('les chiffres viennent de tontineService/tontineTours (aucun calcul contradictoire)', async () => {
    const w = fresh();
    const { group } = await tontine(w, 'Cohérence', { guests: ['A', 'B'] });
    const { summary } = await currentTour(w, group.id);
    const card = (await w.space.loadTontineOverview()).tontines[0];
    expect(card.memberCount).toBe(summary.totalMembers);
    expect(card.expectedTotal).toBe(summary.expectedTotal);
    expect(card.nextBeneficiary).toBe(summary.nextBeneficiary?.displayName);
    expect(card.tour?.scheduledDate).toBe(summary.currentTour?.scheduledDate);
  });
});

describe('Plusieurs tontines', () => {
  it('toutes apparaissent une seule fois, et les totaux s’additionnent', async () => {
    const w = fresh();
    const a = await tontine(w, 'Famille', { guests: ['A'] });
    const b = await tontine(w, 'Amis', { guests: ['B', 'C'] });
    const c = await tontine(w, 'Voisins', { guests: [] });
    const overview = await w.space.loadTontineOverview();
    const ids = overview.tontines.map((t) => t.groupId);
    expect(ids.sort()).toEqual([a.group.id, b.group.id, c.group.id].sort());
    expect(new Set(ids).size).toBe(3);
    expect(overview.activeTontines).toBe(3);
    expect(overview.totalMembers).toBe(2 + 3 + 1);
    await w.space.loadTontineOverview(); // relire ne duplique rien
    expect((await w.space.loadTontineOverview()).tontines).toHaveLength(3);
  });

  it('le builder ignore un doublon de synthèse', async () => {
    const w = fresh();
    const { group } = await tontine(w, 'Une seule', { guests: ['A'] });
    const summary = (await w.tontineService.getSummary(group.id))!;
    expect(buildTontineOverview([summary, summary]).tontines).toHaveLength(1);
  });

  it('une tontine supprimée disparaît de la liste', async () => {
    const w = fresh();
    const a = await tontine(w, 'A', { guests: ['X'] });
    await tontine(w, 'B', { guests: ['Y'] });
    await w.groupService.deleteTontine(a.group.id);
    expect((await w.space.loadTontineOverview()).tontines.map((t) => t.name)).toEqual(['B']);
  });
});

describe('Tours terminés et à venir', () => {
  it('un tour complet puis le tour suivant : distinction, prochain bénéficiaire, statistiques', async () => {
    const w = fresh();
    const { group, members } = await tontine(w, 'Rotation', { guests: ['Moussa', 'Awa'], amount: 5000 });
    const { tour, summary } = await currentTour(w, group.id);
    await w.tontineService.recordContributions({ groupId: group.id, tourId: tour.id, memberIds: summary.members.map((m) => m.id) });

    let card = (await w.space.loadTontineOverview()).tontines[0];
    expect(card).toMatchObject({ tourStatus: 'complete', paidCount: 3, collected: 15000, remaining: 0 });

    await w.tontineService.advanceRound(group.id);
    const overview = await w.space.loadTontineOverview();
    card = overview.tontines[0];
    expect(card.tour).toMatchObject({ tourNumber: 2, positionInCycle: 2 });
    expect(card.nextBeneficiary).toBe(members[0].displayName); // 2e position : Moussa
    expect(card).toMatchObject({ tourStatus: 'upcoming', paidCount: 0, collected: 0, remaining: 15000 });
    expect(overview.nextTour).toMatchObject({ beneficiary: members[0].displayName, late: false });

    const stats = await w.space.loadTontineStats();
    expect(stats).toMatchObject({ tontines: 1, members: 3, toursGenerated: 2, toursComplete: 1, collected: 15000, expected: 30000, remaining: 15000, paymentRate: 0.5 });
  });

  it('un tour complet n’est plus « en attente » : pas de prochain tour affiché', async () => {
    const w = fresh();
    const { group } = await tontine(w, 'Fini', { guests: ['A'] });
    const { tour, summary } = await currentTour(w, group.id);
    await w.tontineService.recordContributions({ groupId: group.id, tourId: tour.id, memberIds: summary.members.map((m) => m.id) });
    const overview = await w.space.loadTontineOverview();
    expect(overview.nextTour).toBeNull();
    expect(overview.pendingContributions).toBe(0);
    expect(overview.expectedAmount).toBe(0);
  });

  it('un tour passé et impayé est signalé en retard', async () => {
    const w = fresh();
    await tontine(w, 'Retard', { guests: ['A'], startDate: past() });
    const overview = await w.space.loadTontineOverview();
    expect(overview.tontines[0].tourStatus).toBe('late');
    expect(overview.lateTontines).toBe(1);
    expect(overview.nextTour).toMatchObject({ name: 'Retard', late: true });
  });
});

describe('Cotisations', () => {
  it('montants cohérents avec les cotisations réellement enregistrées, aucune fictive', async () => {
    const w = fresh();
    const { group } = await tontine(w, 'Partiel', { guests: ['A', 'B'], amount: 5000 });
    const { tour, summary } = await currentTour(w, group.id);
    expect(w.db.contributions).toHaveLength(0);
    await w.tontineService.recordContributions({ groupId: group.id, tourId: tour.id, memberIds: [summary.members[1].id] });

    const overview = await w.space.loadTontineOverview();
    expect(w.db.contributions).toHaveLength(1); // consulter n'invente aucune cotisation
    expect(overview.tontines[0]).toMatchObject({ paidCount: 1, collected: 5000, remaining: 10000, tourStatus: 'partial' });
    expect(overview).toMatchObject({ pendingContributions: 2, expectedAmount: 10000 });
  });
});

describe('Outil Tontine', () => {
  it('fonctionne avec l’unique Tool Tontine : aucun Tool créé par groupe', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tontine');
    await tontine(w, 'A', { guests: ['X'] });
    await tontine(w, 'B', { guests: ['Y'] });
    await tontine(w, 'C', { guests: ['Z'] });
    const toolsBefore = w.db.tools.length;
    const overview = await w.space.loadTontineOverview();
    await w.space.loadTontineOverview();
    expect(overview.tontines).toHaveLength(3);
    expect(w.db.tools.filter((t) => t.kind === 'tontine')).toHaveLength(1);
    expect(w.db.tools.filter((t) => t.kind === 'tontine')[0].id).toBe(tool.id);
    expect(w.db.tools).toHaveLength(toolsBefore);
    expect(w.db.groups.every((g) => !w.db.tools.some((t) => t.id === g.id))).toBe(true); // un Group n'est jamais un Tool
  });

  it('une installation existante (données sans outil) retrouve son Tool Tontine, une seule fois', async () => {
    const w = fresh();
    await tontine(w, 'Ancienne', { guests: ['X'] });
    expect(w.db.tools).toHaveLength(0);
    await w.space.loadTontineOverview();
    await w.space.loadTontineOverview();
    expect(w.db.tools.filter((t) => t.kind === 'tontine')).toHaveLength(1);
    expect((await w.registry.getMyTools()).owned.map((t) => t.model.key)).toEqual(['tontine']);
  });

  it('un outil Tontine retiré de Mes outils laisse l’espace et les données intacts', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tontine');
    await tontine(w, 'Gardée', { guests: ['X'] });
    await w.registry.hideTool(tool.id);
    const overview = await w.space.loadTontineOverview();
    expect(overview.tontines).toHaveLength(1);
    expect((await w.registry.getMyTools()).owned).toHaveLength(0); // toujours retirée
  });
});

describe('Activités', () => {
  it('les actions Tontine gardent le toolId ; consulter l’espace, l’historique ou les statistiques n’enregistre rien', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('tontine');
    w.db.activityEvents.length = 0;

    const { group, members } = await tontine(w, 'Famille', { guests: ['Moussa'] });
    const { tour, summary } = await currentTour(w, group.id);
    await w.tontineService.recordContributions({ groupId: group.id, tourId: tour.id, memberIds: [members[0].id] });

    const recorded = w.db.activityEvents.filter((e) => e.module === 'tontine');
    expect(recorded.map((e) => e.type).sort()).toEqual(['contribution_added', 'group_created', 'member_invited']);
    expect(recorded.every((e) => e.toolId === tool.id)).toBe(true);
    expect(summary.members.length).toBeGreaterThan(0);

    const count = w.db.activityEvents.length;
    await w.space.loadTontineOverview();
    await w.space.loadTontineStats();
    w.space.getTontineHistory();
    await w.groupService.listMyGroups();
    await w.tontineService.getTourHistory(group.id);
    expect(w.db.activityEvents).toHaveLength(count);
  });

  it('l’historique du module ne contient que les événements Tontine, du plus récent au plus ancien', async () => {
    const w = fresh();
    await w.registry.installTool('tontine');
    await tontine(w, 'Famille', { guests: ['Moussa'] });
    await w.immo.createBien({ nom: 'Résidence', adresse: 'Lomé' }); // autre module
    const history = w.space.getTontineHistory();
    expect(history.map((e) => e.type)).toEqual(['member_invited', 'group_created']);
    expect(history.every((e) => e.module === 'tontine')).toBe(true);
    expect(w.space.getTontineHistory(1)).toHaveLength(1);
  });
});

describe('Navigation et intégration', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('l’espace est l’entrée de l’outil Tontine ; l’ancienne liste redirige vers lui', () => {
    expect(getCatalogModel('tontine')!.route).toBe('/tontine');
    expect(read('app/tontine/index.tsx')).toContain('TontineSpaceScreen');
    expect(read('app/(tabs)/tontines.tsx')).toMatch(/Redirect[\s\S]*\/tontine/);
  });

  it('ouvrir une tontine passe par le détail existant ; la création reste accessible par « Nouvelle tontine »', () => {
    const screen = read('features/tontines/screens/TontineSpaceScreen.tsx');
    expect(screen).toContain('TontineSpaceCard'); // chaque carte ouvre le détail existant
    expect(read('components/tontine/TontineSpaceCard.tsx')).toMatch(/\/group\/\$\{[^}]+\}\/tontine/);
    expect(screen).toContain('/tontine/create');
    expect(screen).toContain('Nouvelle tontine');
    expect(screen).toContain('/tontine/historique');
    expect(screen).toContain('/tontine/statistiques');
  });

  it('supprimer une tontine ramène à l’espace Tontine, plus à l’ancien onglet Modèles', () => {
    const detail = read('features/tontines/screens/TontineDashboardScreen.tsx');
    expect(detail).toContain("pathname: '/tontine'");
    expect(detail).not.toContain('/(tabs)/modeles');
  });
});
