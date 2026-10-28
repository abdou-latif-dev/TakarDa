// Phase 7 — contenu de l'accueil : outils récents, « à surveiller », activités récentes, annonce locale.
// Chaque test repart d'une base vide (jest.resetModules).

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import fs from 'fs';
import path from 'path';
import { ANNOUNCEMENTS } from '@/constants/announcements';
import { formatFcfa } from '@/utils/format';
import { buildImmobilierAlert, buildTontineAlerts, buildUtilityAlert, selectAnnouncement, sortAlerts, sortToolsByRecency, type HomeAlert } from '../homeService';
import type { MyTool } from '../toolRegistryService';
import type { ActivityEvent, RecordItem, Tool } from '@/types/entities';

/* eslint-disable @typescript-eslint/no-require-imports */
function fresh() {
  jest.resetModules();
  return {
    db: require('../db') as typeof import('../db'),
    home: require('../homeService') as typeof import('../homeService'),
    registry: require('../toolRegistryService') as typeof import('../toolRegistryService'),
    groupService: require('../groupService').groupService as typeof import('../groupService').groupService,
    immo: require('../immobilierService') as typeof import('../immobilierService'),
    parts: require('../utilityParticipantsService') as typeof import('../utilityParticipantsService'),
    billing: require('../utilityBillingService') as typeof import('../utilityBillingService'),
    factures: require('../facturesService') as typeof import('../facturesService'),
    core: require('../coreService') as typeof import('../coreService'),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */
type World = ReturnType<typeof fresh>;

const NOW = new Date(2026, 9, 15); // 15 octobre 2026
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const activityCount = (w: World) => w.db.activityEvents.length;

async function louer(w: World, opts: { dateEntree?: Date; dernier?: string | null } = {}) {
  const bien = await w.immo.createBien({ nom: 'Résidence A', adresse: 'Lomé' });
  const { contrat } = await w.immo.createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: 'Studio' },
    nom: 'Kossi Adjo',
    telephone: '90123456',
    loyerMensuel: 50000,
    dateEntree: opts.dateEntree ?? new Date(2026, 0, 5),
    dernierLoyerPaye: opts.dernier === undefined ? null : opts.dernier,
  } as Parameters<typeof w.immo.createLocataireEtContrat>[0]);
  return contrat;
}

/** Facture CEET/TDE validée (équitable) entre `count` participants du module ; renvoie ses parts. */
async function factureValidee(w: World, module: 'ceet' | 'tde', montant: number, count: number, mois = '2026-09') {
  const people = [];
  for (let i = 0; i < count; i += 1) people.push(await w.parts.addParticipant(module, { name: `${module} ${i}` }));
  const ents = await w.factures.ensureFacturesToolCached();
  const facture = await w.billing.createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: module, mois, montant_total: montant } });
  return w.billing.validateRepartition({
    toolId: ents.tool.id,
    partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
    facturePartageeId: facture.id,
    mode: 'equitable',
    lines: w.billing.computeRepartitionEquitable(people.map((p) => p.participant), montant),
  });
}

describe('Accueil vide', () => {
  it('aucun outil installé : rien d’inventé, aucun outil ni donnée créés par l’ouverture', async () => {
    const w = fresh();
    const feed = await w.home.loadHomeFeed(NOW);
    expect(feed.tools).toEqual([]);
    expect(feed.alerts).toEqual([]);
    expect(feed.activities).toEqual([]);
    expect(w.db.tools).toHaveLength(0);
    expect(w.db.records).toHaveLength(0);
  });

  it('outils installés sans donnée : aucune alerte, aucune activité (hors « outil ajouté »)', async () => {
    const w = fresh();
    for (const key of ['immobilier', 'tontine', 'ceet', 'tde'] as const) await w.registry.installTool(key);
    w.db.activityEvents.length = 0;
    const feed = await w.home.loadHomeFeed(NOW);
    expect(feed.tools.map((t) => t.model.key).sort()).toEqual(['ceet', 'immobilier', 'tde', 'tontine']);
    expect(feed.alerts).toEqual([]);
    expect(feed.activities).toEqual([]);
  });

  it('un outil retiré de Mes outils disparaît de l’accueil, avec ses alertes', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('immobilier');
    await louer(w);
    expect((await w.home.loadHomeFeed(NOW)).alerts).toHaveLength(1);
    await w.registry.hideTool(tool.id);
    const feed = await w.home.loadHomeFeed(NOW);
    expect(feed.tools).toEqual([]);
    expect(feed.alerts).toEqual([]);
  });
});

describe('Loyers en retard (Immobilier)', () => {
  it('une alerte réelle : seuls les mois entièrement écoulés et impayés comptent, sans montant', async () => {
    const w = fresh();
    await w.registry.installTool('immobilier');
    await louer(w); // entrée janvier 2026, aucun paiement : janvier → septembre sont dus
    const [alert] = (await w.home.loadHomeFeed(NOW)).alerts;
    expect(alert).toMatchObject({ module: 'immobilier', severity: 'late', title: 'Loyers en retard', route: '/immobilier' });
    expect(alert.detail).toBe('1 contrat · 9 loyers impayés');
    expect(alert.detail).not.toMatch(/FCFA|\d\s?\d{3}/);
  });

  it('un paiement réel réduit le retard ; un contrat à jour ou terminé n’alerte pas', async () => {
    const w = fresh();
    await w.registry.installTool('immobilier');
    const contrat = await louer(w, { dernier: '2026-08' }); // dû : septembre seulement
    expect((await w.home.loadHomeFeed(NOW)).alerts[0].detail).toBe('1 contrat · 1 loyer impayé');
    await w.immo.enregistrerPaiementLoyer(contrat.id, NOW); // septembre payé
    expect((await w.home.loadHomeFeed(NOW)).alerts).toEqual([]);
    const retard = await louer(w);
    expect((await w.home.loadHomeFeed(NOW)).alerts).toHaveLength(1);
    await w.immo.terminerContrat(retard.id);
    expect((await w.home.loadHomeFeed(NOW)).alerts).toEqual([]);
  });

  it('entrée dans le mois courant ou dans le futur : aucun retard', () => {
    const contrat = { id: 'c', statusKey: 'actif', values: { date_entree: '2026-10-05', loyer_mensuel: 50000 }, createdAt: '2026-10-05T00:00:00Z' } as unknown as RecordItem;
    expect(buildImmobilierAlert([contrat], [], NOW)).toBeNull();
  });
});

describe('Parts CEET / TDE à régler', () => {
  it('une alerte par fournisseur, jamais mélangés, montants réels', async () => {
    const w = fresh();
    await w.registry.installTool('ceet');
    await w.registry.installTool('tde');
    const ceetParts = await factureValidee(w, 'ceet', 20000, 2);
    const tdeParts = await factureValidee(w, 'tde', 9000, 3);

    let alerts = (await w.home.loadHomeFeed(NOW)).alerts;
    const ceet = alerts.find((a) => a.module === 'ceet')!;
    const tde = alerts.find((a) => a.module === 'tde')!;
    expect(ceet.detail).toBe('2 parts · 20 000 FCFA · 1 facture');
    expect(tde.detail).toBe('3 parts · 9 000 FCFA · 1 facture');
    expect(ceet.route).toBe('/ceet');
    expect(tde.route).toBe('/tde');
    expect(ceet.title).toMatch(/CEET/);
    expect(tde.title).toMatch(/TDE/);

    await w.billing.enregistrerPaiementPart(ceetParts[0].id); // une part CEET payée : TDE inchangé
    alerts = (await w.home.loadHomeFeed(NOW)).alerts;
    expect(alerts.find((a) => a.module === 'ceet')!.detail).toBe('1 part · 10 000 FCFA · 1 facture');
    expect(alerts.find((a) => a.module === 'tde')!.detail).toBe('3 parts · 9 000 FCFA · 1 facture');

    await w.billing.enregistrerPaiementPart(ceetParts[1].id);
    for (const p of tdeParts) await w.billing.enregistrerPaiementPart(p.id);
    expect((await w.home.loadHomeFeed(NOW)).alerts).toEqual([]); // tout est réglé
  });

  it('une facture non répartie n’est pas une somme impayée ; le montant vient des parts, pas d’un calcul', async () => {
    const w = fresh();
    await w.registry.installTool('ceet');
    await w.parts.addParticipant('ceet', { name: 'Awa' });
    const ents = await w.factures.ensureFacturesToolCached();
    await w.billing.createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'ceet', mois: '2026-09', montant_total: 15000 } });
    expect((await w.home.loadHomeFeed(NOW)).alerts).toEqual([]); // facture non validée : aucune part, aucun impayé

    const parts = await factureValidee(w, 'ceet', 10000, 2, '2026-08');
    const unpaid = parts.reduce((sum, p) => sum + Number(p.values.montant_attribue), 0);
    expect(unpaid).toBe(10000); // la somme des parts figées, pas le montant de l'autre facture (15 000)
    expect((await w.home.loadHomeFeed(NOW)).alerts[0].detail).toContain(formatFcfa(unpaid));
  });

  it('constructeur pur : rien sans part impayée', () => {
    expect(buildUtilityAlert('ceet', { aRegler: [], aRecevoir: 0 })).toBeNull();
    expect(buildUtilityAlert('tde', { aRegler: [{ total: 2, paid: 2 } as never], aRecevoir: 0 })).toBeNull();
    expect(buildUtilityAlert('tde', { aRegler: [{ total: 3, paid: 1 } as never], aRecevoir: 6000 })!.detail).toBe('2 parts · 6 000 FCFA · 1 facture');
  });
});

describe('Échéances de tontine', () => {
  const group = (w: World, name: string, startDate: string) =>
    w.groupService.createTontine({ name, contributionAmount: 5000, frequency: 'monthly', startDate, orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0]);

  it('un tour en retard est signalé d’abord, la prochaine échéance ensuite', async () => {
    const w = fresh();
    await w.registry.installTool('tontine');
    const late = await group(w, 'Ancienne', new Date(Date.now() - 60 * 86_400_000).toISOString());
    await w.groupService.addGuestMember(late.id, { firstName: 'Moussa', lastName: 'Test' });
    await group(w, 'Future', new Date(Date.now() + 10 * 86_400_000).toISOString());

    const alerts = (await w.home.loadHomeFeed()).alerts.filter((a) => a.module === 'tontine');
    expect(alerts.map((a) => [a.severity, a.title])).toEqual([['late', 'Tour en retard'], ['info', 'Prochaine échéance']]);
    expect(alerts[0].detail).toContain('Ancienne');
    expect(alerts[0].detail).toContain('2 cotisations manquantes'); // 2 membres actifs, aucune cotisation
    expect(alerts[0].route).toBe(`/group/${late.id}/tontine`);
    expect(alerts.every((a) => !/FCFA/.test(a.detail))).toBe(true);
  });

  it('aucune tontine ou aucune échéance déterminable : aucune alerte', async () => {
    const w = fresh();
    await w.registry.installTool('tontine');
    expect((await w.home.loadHomeFeed()).alerts).toEqual([]);
    expect(buildTontineAlerts({ tontines: [] })).toEqual([]);
  });
});

describe('Alertes : ordre et plafond', () => {
  const alert = (id: string, severity: HomeAlert['severity']): HomeAlert => ({ id, module: 'tontine', severity, title: id, detail: '', route: '/' });
  it('retards, puis à régler, puis informations ; ordre conservé à gravité égale ; plafonné', () => {
    const list = [alert('i1', 'info'), alert('p1', 'pending'), alert('l1', 'late'), alert('l2', 'late'), alert('i2', 'info'), alert('p2', 'pending')];
    expect(sortAlerts(list).map((a) => a.id)).toEqual(['l1', 'l2', 'p1', 'p2', 'i1']);
    expect(sortAlerts(list, 2).map((a) => a.id)).toEqual(['l1', 'l2']);
  });
});

describe('Outils récents', () => {
  const tool = (id: string, kind: Tool['kind'], installedAt: string): MyTool => ({
    tool: { id, name: id, icon: 'x', kind, ownerId: 'u-me', entityDefinitionIds: [], settings: { installedAt }, createdAt: installedAt, updatedAt: installedAt },
    model: { key: kind as never, title: id, description: '', icon: 'home', available: true, installable: true, status: 'available', route: '/' },
    route: '/',
  });
  const event = (toolId: string | undefined, at: string): ActivityEvent => ({ id: `${toolId}${at}`, type: 'group_created', title: 't', description: '', at, toolId });

  it('classés par dernière activité liée à l’outil, sinon par date d’ajout', () => {
    const a = tool('a', 'immobilier', '2026-01-01T00:00:00Z');
    const b = tool('b', 'tontine', '2026-02-01T00:00:00Z');
    const c = tool('c', 'ceet', '2026-03-01T00:00:00Z');
    expect(sortToolsByRecency([a, b, c], []).map((t) => t.tool.id)).toEqual(['c', 'b', 'a']);
    expect(sortToolsByRecency([a, b, c], [event('a', '2026-04-01T00:00:00Z'), event(undefined, '2026-05-01T00:00:00Z')]).map((t) => t.tool.id)).toEqual(['a', 'c', 'b']);
  });

  it('avec le vrai registre, l’outil le plus récemment utilisé passe en premier — sans suivre aucune consultation', async () => {
    const w = fresh();
    await w.registry.installTool('tontine');
    await w.registry.installTool('ceet');
    const before = activityCount(w);
    await w.groupService.createTontine({ name: 'Famille', contributionAmount: 5000, frequency: 'monthly', startDate: new Date().toISOString(), orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0]);
    expect(activityCount(w)).toBe(before + 1);
    const feed = await w.home.loadHomeFeed(NOW);
    expect(feed.tools.map((t) => t.model.key)).toEqual(['tontine', 'ceet']);
  });
});

describe('Activités récentes', () => {
  it('les trois dernières activités réelles, de la plus récente à la plus ancienne', async () => {
    const w = fresh();
    const tool = await w.registry.installTool('immobilier');
    for (const nom of ['A', 'B', 'C']) await w.immo.createBien({ nom, adresse: 'Lomé' });
    const feed = await w.home.loadHomeFeed(NOW);
    expect(feed.activities).toHaveLength(3);
    expect(feed.activities.map((e) => e.description)).toEqual(['C', 'B', 'A']);
    expect(feed.activities.every((e) => e.toolId === tool.id)).toBe(true);
  });
});

describe('Annonces locales', () => {
  it('première annonce non masquée ; masquée, elle ne revient pas, et la suivante apparaît', async () => {
    expect(selectAnnouncement(ANNOUNCEMENTS, [])!.id).toBe(ANNOUNCEMENTS[0].id);
    expect(selectAnnouncement(ANNOUNCEMENTS, [ANNOUNCEMENTS[0].id])!.id).toBe(ANNOUNCEMENTS[1].id);
    expect(selectAnnouncement(ANNOUNCEMENTS, ANNOUNCEMENTS.map((a) => a.id))).toBeNull();

    const w = fresh();
    expect((await w.home.loadHomeFeed(NOW)).announcement!.id).toBe(ANNOUNCEMENTS[0].id);
    await w.home.dismissAnnouncement(ANNOUNCEMENTS[0].id);
    await w.home.dismissAnnouncement(ANNOUNCEMENTS[0].id); // idempotent
    expect(await w.home.loadDismissedAnnouncements()).toEqual([ANNOUNCEMENTS[0].id]);
    expect((await w.home.loadHomeFeed(NOW)).announcement!.id).toBe(ANNOUNCEMENTS[1].id);
  });

  it('une annonce n’est ni une notification ni une activité : rien n’est écrit', async () => {
    const w = fresh();
    const before = { notifications: w.db.notifications.length, activities: activityCount(w) };
    await w.home.loadHomeFeed(NOW);
    await w.home.dismissAnnouncement(ANNOUNCEMENTS[0].id);
    expect({ notifications: w.db.notifications.length, activities: activityCount(w) }).toEqual(before);
    for (const a of ANNOUNCEMENTS) expect(a).not.toHaveProperty('read'); // pas le format d'une AppNotification
  });
});

describe('Ouvrir l’accueil n’écrit rien', () => {
  it('ni activité, ni outil, ni donnée métier, même après plusieurs ouvertures', async () => {
    const w = fresh();
    await w.registry.installTool('immobilier');
    await w.registry.installTool('ceet');
    await louer(w);
    await factureValidee(w, 'ceet', 10000, 2);
    const snapshot = () => ({ activities: activityCount(w), tools: w.db.tools.length, records: w.db.records.length, members: w.db.toolMembers.length, groups: w.db.groups.length });
    const before = snapshot();
    for (let i = 0; i < 3; i += 1) await w.home.loadHomeFeed(NOW);
    expect(snapshot()).toEqual(before);
  });

  it('un outil CEET installé sans outil Factures n’en provoque pas la création', async () => {
    const w = fresh();
    await w.registry.installTool('ceet');
    await w.home.loadHomeFeed(NOW);
    expect(w.db.tools.some((t) => t.kind === 'facture')).toBe(false);
  });
});

describe('Écran d’accueil', () => {
  const home = read('features/home/screens/HomeScreen.tsx');

  it('lit le service d’aperçu, n’écrit aucune activité, ne duplique plus Mes Outils', () => {
    expect(home).toContain('loadHomeFeed');
    expect(home).not.toContain('recordActivity');
    expect(home).not.toContain('title="Mes Outils"'); // l'onglet suffit
    expect(home).not.toContain('(tabs)/modeles');
  });

  it('plus d’entrée Factures simples ni Scanner sur l’accueil (fichiers et routes conservés)', () => {
    expect(home).not.toMatch(/title="Factures"|title="Scanner"|router\.push\('\/factures'\)|router\.push\('\/scan'\)/);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'app/factures/index.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'app/scan.tsx'))).toBe(true);
  });

  it('les outils de l’accueil ouvrent la route de leur modèle (CEET → /ceet, TDE → /tde…)', () => {
    expect(home).toMatch(/item\.route/);
    const catalog = read('services/toolCatalogService.ts');
    expect(catalog).toMatch(/key: 'ceet'[\s\S]*?route: '\/ceet'/);
    expect(catalog).toMatch(/key: 'tde'[\s\S]*?route: '\/tde'/);
  });
});
