// Démonstration crédible : exemples COMPLETS et COHÉRENTS (Immobilier avec historique de loyers et retards, tontine, CEET/TDE, formulaire), créés dans l'espace de démonstration SEULEMENT.
// Les chiffres attendus sont dérivés de la SPÉCIFICATION des exemples (loyers × mois payés), pas des fonctions testées : une statistique truquée ou incohérente ferait échouer ce test.
// Aucun réseau, aucun SDK Firebase : stockage en mémoire.

import fs from 'fs';
import path from 'path';

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

/* eslint-disable @typescript-eslint/no-require-imports */
interface App {
  persistence: typeof import('../persistence');
  demo: typeof import('../demoWorkspace');
  db: typeof import('../db');
  home: typeof import('../homeService');
  stats: typeof import('../moduleStatsService');
  immo: typeof import('../immobilierService');
  immoDemo: typeof import('../immobilierDemoService');
  tontineDemo: typeof import('../tontineDemoService');
  utilityDemo: typeof import('../utilityDemoService');
  formDemo: typeof import('../formDemoService');
  factures: typeof import('../facturesService');
  report: typeof import('../immobilierReportService');
  coreService: typeof import('../coreService');
}
async function withFreshApp(run: (app: App) => Promise<void>): Promise<void> {
  mockMemory.clear();
  await jest.isolateModulesAsync(async () => {
    const app: App = {
      persistence: require('../persistence'),
      demo: require('../demoWorkspace'),
      db: require('../db'),
      home: require('../homeService'),
      stats: require('../moduleStatsService'),
      immo: require('../immobilierService'),
      immoDemo: require('../immobilierDemoService'),
      tontineDemo: require('../tontineDemoService'),
      utilityDemo: require('../utilityDemoService'),
      formDemo: require('../formDemoService'),
      factures: require('../facturesService'),
      report: require('../immobilierReportService'),
      coreService: require('../coreService'),
    };
    await app.persistence.hydrateDb();
    await run(app);
  });
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Spécification des exemples « historique » : loyer et nombre de loyers payés, en comptant le mois d'entrée (3 mois avant aujourd'hui) puis les suivants. */
const TENANTS = [
  { nom: 'Koffi Mensah', loyer: 25000, paye: 4 },
  { nom: 'Ama Dossou', loyer: 30000, paye: 3 },
  { nom: 'Yao Kossi', loyer: 75000, paye: 1 },
  { nom: 'Sena Afi', loyer: 20000, paye: 2 },
  { nom: 'Edem Amegah', loyer: 35000, paye: 4 },
  { nom: 'Akossiwa Tevi', loyer: 28000, paye: 3 },
  { nom: 'Kokou Lawson', loyer: 60000, paye: 1 },
  { nom: 'Mawuli Agbo', loyer: 22000, paye: 2 },
];
// trois mois entièrement écoulés depuis l'entrée : un locataire qui a payé k loyers en doit 3 − k (le mois en cours reste « à payer », jamais « en retard »)
const lateMonths = (paye: number) => Math.max(0, 3 - paye);
const EXPECTED = {
  paiements: TENANTS.reduce((n, t) => n + t.paye, 0),
  encaisse: TENANTS.reduce((sum, t) => sum + t.loyer * t.paye, 0),
  contratsEnRetard: TENANTS.filter((t) => lateMonths(t.paye) > 0).length,
  loyersImpayes: TENANTS.reduce((n, t) => n + lateMonths(t.paye), 0),
};

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

describe('Démonstration : exemples complets et cohérents', () => {
  it('première ouverture : immobilier, tontine, CEET/TDE et formulaire, chiffres cohérents avec la spécification, alertes cohérentes avec les chiffres', async () => {
    await withFreshApp(async (app) => {
      expect(await app.demo.enterDemoIfFreshInstall()).toBe(true);
      expect(app.persistence.isDemoWorkspace()).toBe(true);

      const stats = await app.stats.loadImmobilierStats('all');
      expect(stats).toMatchObject({ biens: 3, logements: 10, occupes: 8, vacants: 2, contratsActifs: 8, contratsTermines: 0 });
      expect(stats?.encaisse).toMatchObject({ count: EXPECTED.paiements, amount: EXPECTED.encaisse, sansDate: 0 });
      expect(stats?.impayes).toEqual({ contrats: EXPECTED.contratsEnRetard, loyers: EXPECTED.loyersImpayes });

      // le rapport du mois dit la même chose que les statistiques : mêmes paiements, aucun retard compté deux fois
      const report = (await app.report.loadImmobilierReport({ period: ym(new Date()) }))!.report;
      expect(report.logements).toEqual({ total: 10, occupes: 8, vacants: 2 });
      expect(report.loyers.attendus).toBe(TENANTS.reduce((sum, t) => sum + t.loyer, 0));

      for (const module of ['ceet', 'tde'] as const) {
        const utility = await app.stats.loadUtilityStats(module);
        expect(utility).toMatchObject({ facturesValidees: 1, parts: { total: 3, payees: 2, restantes: 1 } });
        const total = module === 'ceet' ? 54000 : 18000;
        expect(utility?.montants).toEqual({ paye: (total / 3) * 2, restant: total / 3 }); // 2 parts payées sur 3, parts égales à la consommation près : montants cohérents avec la facture
      }

      const feed = await app.home.loadHomeFeed();
      const alerts = feed.alerts.map((a) => `${a.title} — ${a.detail}`);
      expect(alerts).toContain(`Loyers en retard — ${EXPECTED.contratsEnRetard} contrats · ${EXPECTED.loyersImpayes} loyers impayés`);
      expect(alerts.some((a) => /^Tour en retard — Solidarité \d{4} \(démo\) · échéance .+ · 2 cotisations manquantes$/.test(a))).toBe(true);
      expect(alerts.some((a) => /^CEET : parts à régler — 1 part · 18\s000 FCFA · 1 facture$/.test(a.replace(/ | /g, ' ')))).toBe(true);
      expect(alerts.some((a) => /^TDE : parts à régler — 1 part · 6\s000 FCFA · 1 facture$/.test(a.replace(/ | /g, ' ')))).toBe(true);

      expect(app.db.forms).toHaveLength(1);
      expect(app.db.forms[0]).toMatchObject({ title: app.formDemo.DEMO_FORM_TITLE, responseCount: 2 });
      expect(app.db.forms[0].fields).toHaveLength(3);
      expect(app.db.submissions).toHaveLength(2);
    });
  }, 120000);

  it('tout est marqué « (démo) » ou manifestement fictif : biens, tontine, formulaire, personnes, numéros', async () => {
    await withFreshApp(async (app) => {
      await app.demo.enterDemo();
      const biens = await app.immo.listBiensWithSummary();
      expect(biens).toHaveLength(3);
      for (const b of biens) expect(String(b.bien.values.nom)).toMatch(/ \(démo\)$/);
      for (const g of app.db.groups) expect(g.name).toMatch(/ \(démo\)$/);
      for (const f of app.db.forms) expect(f.title).toMatch(/ \(démo\)$/);
      expect(app.db.externalContacts.length).toBeGreaterThan(10);
      for (const contact of app.db.externalContacts) {
        expect({ name: contact.name, marked: / \(démo\)$/.test(contact.name) }).toEqual({ name: contact.name, marked: true });
        if (contact.phone) expect(contact.phone).toMatch(/^\+228 90 00 00 \d\d$/);
      }
      for (const s of app.db.submissions) expect(s.clientName).toMatch(/ \(démo\)$/);
    });
  }, 120000);

  it('dates RELATIVES : à une autre date, les mois payés et la tontine suivent la date (rien de codé en dur) ; le mois en cours n’est jamais daté du futur', async () => {
    await withFreshApp(async (app) => {
      await app.persistence.switchWorkspace('demo');
      const now = new Date(2027, 2, 15); // 15 mars 2027
      await app.immoDemo.seedDemoImmobilier({ history: true, now });
      await app.tontineDemo.seedDemoTontine({ relativeDates: true, now });
      const paid = app.db.records.filter((r) => r.statusKey === 'paye' && typeof r.values.mois === 'string' && typeof r.values.montant === 'number');
      expect(paid).toHaveLength(EXPECTED.paiements);
      const months = new Set(paid.map((r) => r.values.mois));
      expect([...months].sort()).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']); // trois mois avant mars 2027, puis les suivants
      for (const r of paid) expect(String(r.values.date_validation) <= '2027-03-15').toBe(true); // jamais une date future
      expect(app.db.groups[0].name).toBe('Solidarité 2027 (démo)');
      expect(JSON.stringify(app.db.records.map((r) => r.values))).not.toContain('2026-10'); // aucune date de contenu codée en dur (les horodatages techniques suivent l'horloge)
    });
  }, 120000);

  it('ISOLATION : les exemples ne touchent jamais les données personnelles (octet pour octet) ; ils refusent de se créer hors de l’espace de démonstration', async () => {
    await withFreshApp(async (app) => {
      await app.immo.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
      await app.persistence.flushDb();
      // les clés de l'espace de démonstration contiennent « demo/ » ; le marqueur « demo_mode » (qui dit quel espace est actif) est écrit dans l'espace personnel par conception : ce n'est pas une donnée
      const isDemoKey = (key: string) => key.includes('demo/') || key.endsWith('demo_mode');
      const personalKeys = () => [...mockMemory.entries()].filter(([key]) => !isDemoKey(key)).map(([key, value]) => `${key}=${value}`).sort().join('\n');
      const before = personalKeys();
      expect(before).toContain('Maison perso');

      // hors de l'espace de démonstration : refus net, rien n'est créé
      for (const attempt of [
        () => app.immoDemo.seedDemoImmobilier({ history: true }),
        () => app.tontineDemo.seedDemoTontine({ relativeDates: true }),
        () => app.utilityDemo.seedDemoUtilities(),
        () => app.formDemo.seedDemoForms(),
      ]) await expect(attempt()).rejects.toThrow(/espace de démonstration/);
      await app.persistence.flushDb();
      expect(personalKeys()).toBe(before);

      // entrée dans la démonstration (exemples complets) puis retour : l'espace personnel est inchangé
      await app.demo.enterDemo();
      await app.persistence.flushDb();
      expect(personalKeys()).toBe(before); // aucune clé personnelle n'a été écrite pendant la démonstration
      const demoJson = [...mockMemory.entries()].filter(([key]) => key.includes('demo/')).map(([, v]) => v).join('');
      expect(demoJson).toContain('Résidence Kodjoviakopé (démo)');
      expect(demoJson).not.toContain('Maison perso');
      await app.demo.exitDemo();
      expect(personalKeys()).toBe(before);
      expect(JSON.stringify(app.db.records)).toContain('Maison perso');
      expect(JSON.stringify(app.db.records)).not.toContain('(démo)');
      expect(app.db.forms).toHaveLength(0);
    });
  }, 120000);

  it('RÉGRESSION : les définitions Factures (CEET/TDE) mises en cache ne passent jamais d’un espace à l’autre, dans les deux sens', async () => {
    await withFreshApp(async (app) => {
      const personal = await app.factures.ensureFacturesToolCached(); // espace personnel : crée et met en cache
      const inCurrentTools = (id: string) => app.db.tools.some((t) => t.id === id);
      expect(inCurrentTools(personal.tool.id)).toBe(true);

      await app.demo.enterDemo(); // l'espace de démonstration reçoit SES propres définitions
      const demo = await app.factures.ensureFacturesToolCached();
      expect(demo.tool.id).not.toBe(personal.tool.id);
      expect(inCurrentTools(demo.tool.id)).toBe(true);
      expect(inCurrentTools(personal.tool.id)).toBe(false);

      await app.demo.exitDemo(); // retour : ce sont de nouveau les définitions PERSONNELLES (relues, pas recréées)
      const back = await app.factures.ensureFacturesToolCached();
      expect(back.tool.id).toBe(personal.tool.id);
      expect(inCurrentTools(back.tool.id)).toBe(true);
      expect(inCurrentTools(demo.tool.id)).toBe(false);
    });
    // sens inverse : la démonstration est ouverte AVANT toute utilisation personnelle de CEET/TDE
    await withFreshApp(async (app) => {
      await app.demo.enterDemo();
      const demo = await app.factures.ensureFacturesToolCached();
      await app.demo.exitDemo();
      const personal = await app.factures.ensureFacturesToolCached();
      expect(personal.tool.id).not.toBe(demo.tool.id);
      expect(app.db.tools.some((t) => t.id === personal.tool.id)).toBe(true);
      expect(app.db.tools.some((t) => t.id === demo.tool.id)).toBe(false);
    });
  }, 120000);

  it('CONTRÔLE NÉGATIF : sans l’oubli du cache à la bascule, l’identifiant de l’espace personnel serait utilisé dans la démonstration (le défaut est bien celui que le test détecte)', async () => {
    await withFreshApp(async (app) => {
      const personal = await app.factures.ensureFacturesToolCached();
      const spy = jest.spyOn(app.factures, 'resetFacturesToolCache').mockImplementation(() => undefined);
      try {
        await app.persistence.switchWorkspace('demo'); // bascule SANS l'oubli du cache
        const stale = await app.factures.ensureFacturesToolCached();
        expect(stale.tool.id).toBe(personal.tool.id); // identifiant d'un autre espace réutilisé : exactement le défaut corrigé
        expect(app.db.tools.some((t) => t.id === stale.tool.id)).toBe(false); // il n'existe pas dans l'espace courant
      } finally {
        spy.mockRestore();
      }
    });
  }, 120000);

  it('les exemples n’importent ni Firebase ni la synchronisation : ils ne peuvent ni être envoyés ni synchronisés', () => {
    for (const file of ['services/immobilierDemoService.ts', 'services/tontineDemoService.ts', 'services/utilityDemoService.ts', 'services/formDemoService.ts', 'services/demoWorkspace.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
      expect({ file, imports: /from '(\.\/firebase|\.\/sync|@\/services\/firebase|@\/services\/sync)/.test(source) || /firebase|firestore/i.test(source.replace(/\/\/.*$/gm, '')) }).toEqual({ file, imports: false });
    }
  });
});
