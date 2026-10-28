// Espace de démonstration et fenêtre « un compte est nécessaire » : isolation des données personnelles, reprise après redémarrage,
// sécurité des écritures pendant le changement d'espace, comptes fermés. Aucun réseau, aucun SDK : stockage simulé en mémoire.

import fs from 'fs';
import path from 'path';
import { ACCOUNT_UNAVAILABLE_COPY, HOME_ACCOUNT_PROMPT_COPY, accountPromptCopy, resolveAccountChoice, showHomeAccountPrompt } from '../accountPromptService';
import { useDemoStore } from '@/store/demoStore';
import { exitDemo as exitDemoDefault } from '../demoWorkspace';
import { isDemoWorkspace as isDemoDefault } from '../persistence';
import { createBien as createBienDefault } from '../immobilierService';
import * as dbDefault from '../db';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

// Stockage en mémoire, partagé par TOUTES les instances de modules (un « redémarrage » recharge les modules, pas la mémoire).
const mockMemory = new Map<string, string>();
const mockFail = { get: null as null | ((key: string) => boolean), set: null as null | ((key: string) => boolean) };
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockFail.get?.(key)) throw new Error('lecture impossible');
      return mockMemory.has(key) ? (mockMemory.get(key) as string) : null;
    },
    setItem: async (key: string, value: string) => {
      if (mockFail.set?.(key)) throw new Error('écriture impossible');
      mockMemory.set(key, value);
    },
    removeItem: async (key: string) => {
      mockMemory.delete(key);
    },
    clear: async () => mockMemory.clear(),
  },
}));

const PREFIX = '@formease/';
const DEMO_PREFIX = `${PREFIX}demo/`;
const DEMO_FLAG = `${PREFIX}demo_mode`;

/** Toutes les clés de l'espace PERSONNEL (ni préfixe de démonstration, ni marqueur), avec leur contenu exact. */
const personalKeys = (): Record<string, string> =>
  Object.fromEntries([...mockMemory.entries()].filter(([key]) => key.startsWith(PREFIX) && !key.startsWith(DEMO_PREFIX) && key !== DEMO_FLAG));
const demoEntries = (): [string, string][] => [...mockMemory.entries()].filter(([key]) => key.startsWith(DEMO_PREFIX));

interface Instance {
  persistence: typeof import('../persistence');
  demo: typeof import('../demoWorkspace');
  db: typeof import('../db');
  immobilier: typeof import('../immobilierService');
}
/** Une instance neuve de l'application (modules et collections en mémoire neufs) : équivaut à un redémarrage. */
function launch(): Instance {
  let instance!: Instance;
  jest.isolateModules(() => {
    instance = {
      persistence: jest.requireActual('../persistence'),
      demo: jest.requireActual('../demoWorkspace'),
      db: jest.requireMock('../db'),
      immobilier: jest.requireActual('../immobilierService'),
    };
  });
  // Un vrai redémarrage repart de collections VIDES (le module de base de données est partagé entre les « lancements » de ce test).
  for (const [name, value] of Object.entries(instance.db)) {
    if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  }
  instance.db.users.push(instance.db.defaultLocalUser());
  return instance;
}
const recordsJson = (i: Instance) => JSON.stringify(i.db.records);

beforeEach(() => {
  mockMemory.clear();
  mockFail.get = null;
  mockFail.set = null;
});

describe('Espace de démonstration : isolation des données personnelles', () => {
  it('entrer : l’espace personnel est enregistré tel quel, puis AUCUNE clé personnelle n’est plus écrite ; les exemples sont identifiés', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();
    const before = personalKeys();
    expect(Object.keys(before).length).toBeGreaterThan(0);

    const result = await app.demo.enterDemo();
    expect(result.seeded).toBe(true);
    expect(app.persistence.isDemoWorkspace()).toBe(true);
    expect(recordsJson(app)).toContain('Maison Agoè (démo)'); // exemples clairement identifiés
    expect(recordsJson(app)).not.toContain('Maison perso'); // aucune donnée personnelle dans l'espace de démonstration

    await app.immobilier.createBien({ nom: 'Mon essai', adresse: 'Kara' });
    await app.persistence.flushDb();
    expect(personalKeys()).toEqual(before); // identique octet pour octet : rien écrit, rien écrasé
    expect(demoEntries().length).toBeGreaterThan(0);
    expect(mockMemory.get(DEMO_FLAG)).toBe('true');
    const demoJson = demoEntries().map(([, v]) => v).join('');
    expect(demoJson).toContain('Mon essai');
    expect(demoJson).not.toContain('Maison perso');
  });

  it('quitter : les données personnelles sont restituées à l’identique, les exemples restent dans leur espace, aucun doublon d’outil', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();
    const personalRecords = recordsJson(app);
    const personalTools = JSON.stringify(app.db.tools);
    const before = personalKeys();

    await app.demo.enterDemo();
    await app.demo.exitDemo();
    expect(app.persistence.isDemoWorkspace()).toBe(false);
    expect(recordsJson(app)).toBe(personalRecords);
    expect(JSON.stringify(app.db.tools)).toBe(personalTools);
    expect(mockMemory.has(DEMO_FLAG)).toBe(false);
    expect(demoEntries().length).toBeGreaterThan(0); // les exemples ne sont pas supprimés
    expect(personalKeys()).toEqual(before);

    // l'application personnelle fonctionne normalement après le retour (le cache de l'outil a été oublié)
    await app.immobilier.createBien({ nom: 'Autre bien perso', adresse: 'Kpalimé' });
    expect(app.db.tools.filter((t) => t.kind === 'immobilier')).toHaveLength(1);
    expect(recordsJson(app)).toContain('Autre bien perso');
  });

  it('redémarrage : l’espace de démonstration est retrouvé (essais compris) sans toucher aux clés personnelles ; la sortie ramène le personnel', async () => {
    const first = launch();
    await first.persistence.hydrateDb();
    await first.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await first.persistence.flushDb();
    const before = personalKeys();
    await first.demo.enterDemo();
    await first.immobilier.createBien({ nom: 'Essai avant fermeture', adresse: 'x' });
    await first.persistence.flushDb();

    const restarted = launch(); // l'application est fermée puis rouverte
    expect(restarted.persistence.isDemoWorkspace()).toBe(false); // avant le chargement, état neuf
    await restarted.persistence.hydrateDb();
    expect(restarted.persistence.isDemoWorkspace()).toBe(true);
    expect(recordsJson(restarted)).toContain('Essai avant fermeture');
    expect(recordsJson(restarted)).not.toContain('Maison perso');
    await restarted.persistence.flushDb();
    expect(personalKeys()).toEqual(before);

    await restarted.demo.exitDemo();
    expect(recordsJson(restarted)).toContain('Maison perso');
    expect(recordsJson(restarted)).not.toContain('Essai avant fermeture');

    const afterExit = launch(); // nouveau redémarrage, hors démonstration
    await afterExit.persistence.hydrateDb();
    expect(afterExit.persistence.isDemoWorkspace()).toBe(false);
    expect(recordsJson(afterExit)).toContain('Maison perso');
  });

  it('les exemples ne sont créés qu’une fois : rentrer retrouve exactement l’espace de démonstration précédent', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    expect((await app.demo.enterDemo()).seeded).toBe(true);
    const demoRecords = recordsJson(app);
    await app.demo.exitDemo();
    expect((await app.demo.enterDemo()).seeded).toBe(false);
    expect(recordsJson(app)).toBe(demoRecords);
  });

  it('première utilisation sans aucune donnée personnelle : entrer puis sortir laisse un espace personnel vide, sans exemple', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.demo.enterDemo();
    await app.demo.exitDemo();
    expect(app.db.records).toHaveLength(0);
    expect(app.db.groups).toHaveLength(0);
    expect(recordsJson(app)).not.toContain('démo');
  });
});

describe('Espace de démonstration : sécurité des écritures pendant le changement d’espace', () => {
  it('des enregistrements automatiques déclenchés PENDANT la bascule n’écrivent rien au mauvais endroit', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();
    const before = personalKeys();

    const entering = app.demo.enterDemo();
    const interleaved = Promise.all([app.persistence.flushDb(), app.persistence.flushDb()]); // cycles d'enregistrement concurrents
    await entering;
    await interleaved;
    await app.persistence.flushDb();

    expect(personalKeys()).toEqual(before);
    expect(demoEntries().map(([, v]) => v).join('')).not.toContain('Maison perso'); // aucune donnée personnelle copiée dans la démonstration
  });

  it('échec du chargement des données personnelles au retour : l’enregistrement reste SUSPENDU (aucun écrasement) ; le redémarrage retrouve tout', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();
    await app.demo.enterDemo();
    await app.persistence.flushDb();
    const before = personalKeys();

    mockFail.get = (key) => key === `${PREFIX}core_records`; // lecture des données personnelles impossible
    await expect(app.demo.exitDemo()).rejects.toThrow();
    expect(app.persistence.isPersistencePaused()).toBe(true);
    await app.persistence.flushDb(); // collections vides en mémoire : cet appel ne doit RIEN écrire
    expect(personalKeys()).toEqual(before);
    expect(JSON.parse(personalKeys()[`${PREFIX}core_records`])).not.toHaveLength(0);

    mockFail.get = null;
    const restarted = launch();
    await restarted.persistence.hydrateDb();
    expect(restarted.persistence.isDemoWorkspace()).toBe(true); // le marqueur n'a pas été retiré
    expect(personalKeys()).toEqual(before);
    await restarted.demo.exitDemo();
    expect(recordsJson(restarted)).toContain('Maison perso');
  });

  it('échec de la sauvegarde initiale : on reste dans l’espace personnel, collections et enregistrement intacts', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();

    mockFail.set = (key) => key === `${PREFIX}core_records`;
    await expect(app.demo.enterDemo()).rejects.toThrow();
    expect(app.persistence.isDemoWorkspace()).toBe(false);
    expect(app.persistence.isPersistencePaused()).toBe(false);
    expect(recordsJson(app)).toContain('Maison perso');
    expect(mockMemory.has(DEMO_FLAG)).toBe(false);

    mockFail.set = null;
    await app.persistence.flushDb(); // l'enregistrement fonctionne toujours
  });

  it('lecture impossible du marqueur de démonstration au démarrage : espace personnel (jamais l’inverse)', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.demo.enterDemo();
    await app.persistence.flushDb();
    mockFail.get = (key) => key === DEMO_FLAG;
    const restarted = launch();
    await restarted.persistence.hydrateDb();
    expect(restarted.persistence.isDemoWorkspace()).toBe(false);
  });
});

describe('Découverte : première utilisation sans travail personnel', () => {
  it('aucun travail personnel : l’exploration commence AUTOMATIQUEMENT dans la démonstration (exemples identifiés)', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    expect(await app.demo.personalWorkspaceHasData()).toBe(false);
    expect(await app.demo.enterDemoIfFreshInstall()).toBe(true);
    expect(app.persistence.isDemoWorkspace()).toBe(true);
    expect(recordsJson(app)).toContain('Maison Agoè (démo)');
    expect(await app.demo.enterDemoIfFreshInstall()).toBe(true); // idempotent : déjà en démonstration
  });

  it('travail personnel existant : AUCUNE entrée automatique, aucune donnée touchée, aucun marqueur écrit', async () => {
    const app = launch();
    await app.persistence.hydrateDb();
    await app.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await app.persistence.flushDb();
    const before = personalKeys();
    const records = recordsJson(app);

    expect(await app.demo.personalWorkspaceHasData()).toBe(true);
    expect(await app.demo.enterDemoIfFreshInstall()).toBe(false);
    expect(app.persistence.isDemoWorkspace()).toBe(false);
    expect(recordsJson(app)).toBe(records);
    await app.persistence.flushDb();
    expect(personalKeys()).toEqual(before);
    expect(mockMemory.has(DEMO_FLAG)).toBe(false);
    expect(demoEntries()).toHaveLength(0);
  });

  it('chaque sorte de travail personnel suffit à empêcher l’entrée automatique (outil, contact, tontine, formulaire, réponse)', async () => {
    for (const collection of ['tools', 'externalContacts', 'groups', 'forms', 'submissions'] as const) {
      mockMemory.clear();
      const app = launch();
      await app.persistence.hydrateDb();
      (app.db[collection] as unknown[]).push({ id: `x-${collection}` });
      expect(await app.demo.personalWorkspaceHasData()).toBe(true);
      expect(await app.demo.enterDemoIfFreshInstall()).toBe(false);
      expect(app.persistence.isDemoWorkspace()).toBe(false);
    }
  });

  it('depuis la démonstration, « travail personnel existant ? » relit le stockage personnel sans y toucher ; lecture impossible = oui', async () => {
    const withData = launch();
    await withData.persistence.hydrateDb();
    await withData.immobilier.createBien({ nom: 'Maison perso', adresse: 'Lomé' });
    await withData.demo.enterDemo();
    const before = personalKeys();
    expect(await withData.demo.personalWorkspaceHasData()).toBe(true);
    expect(personalKeys()).toEqual(before);
    mockFail.get = (key) => key === `${PREFIX}core_records`;
    expect(await withData.demo.personalWorkspaceHasData()).toBe(true); // doute : on protège, jamais « vide »
    mockFail.get = null;

    mockMemory.clear();
    const fresh = launch();
    await fresh.persistence.hydrateDb();
    await fresh.demo.enterDemo();
    expect(await fresh.demo.personalWorkspaceHasData()).toBe(false);
  });
});

describe('Espace de démonstration : store', () => {
  afterEach(async () => {
    if (isDemoDefault()) await exitDemoDefault();
    useDemoStore.setState({ active: false, busy: false, error: null, canReturn: false });
  });

  it('entrer puis quitter par le store ; un second appui pendant le changement est ignoré', async () => {
    await createBienDefault({ nom: 'Maison perso store', adresse: 'Lomé' });
    const first = useDemoStore.getState().enter();
    const second = await useDemoStore.getState().enter(); // déjà en cours
    expect(second).toBe(false);
    expect(await first).toBe(true);
    expect(useDemoStore.getState()).toMatchObject({ active: true, busy: false, error: null });
    expect(await useDemoStore.getState().exit()).toBe(true);
    expect(useDemoStore.getState().active).toBe(false);
  });

  it('échec : message clair, jamais « actif » à tort', async () => {
    mockFail.set = (key) => key.includes('core_');
    expect(await useDemoStore.getState().enter()).toBe(false);
    expect(useDemoStore.getState().active).toBe(false);
    expect(useDemoStore.getState().error).toMatch(/données personnelles ne sont pas supprimées/);
    expect(useDemoStore.getState().busy).toBe(false);
  });
});

describe('Découverte : store (passage à l’espace personnel)', () => {
  const resetDefaultCollections = () => {
    for (const [name, value] of Object.entries(dbDefault)) {
      if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
    }
    dbDefault.users.push(dbDefault.defaultLocalUser());
  };
  afterEach(async () => {
    if (isDemoDefault()) await exitDemoDefault();
    useDemoStore.setState({ active: false, busy: false, error: null, canReturn: false });
    resetDefaultCollections();
  });

  it('première utilisation : enterIfFresh entre dans la démonstration ; « Mon espace personnel » sans travail personnel exige un compte (on reste dans la démonstration)', async () => {
    resetDefaultCollections();
    expect(await useDemoStore.getState().enterIfFresh()).toBe(true);
    expect(useDemoStore.getState().active).toBe(true);
    expect(await useDemoStore.getState().requestPersonal()).toBe('needs_account');
    expect(useDemoStore.getState().active).toBe(true);
    expect(isDemoDefault()).toBe(true);
  });

  it('travail personnel existant : enterIfFresh ne fait rien ; depuis la démonstration, « Mon espace personnel » ramène les données', async () => {
    resetDefaultCollections();
    await createBienDefault({ nom: 'Maison perso store', adresse: 'Lomé' });
    expect(await useDemoStore.getState().enterIfFresh()).toBe(false);
    expect(useDemoStore.getState().active).toBe(false);
    expect(await useDemoStore.getState().enter()).toBe(true); // choix volontaire (Profil)
    expect(await useDemoStore.getState().requestPersonal()).toBe('left');
    expect(useDemoStore.getState().active).toBe(false);
    expect(JSON.stringify(dbDefault.records)).toContain('Maison perso store');
  });

  it('installation neuve : aucun lien de retour à afficher ; avec des données personnelles : le lien de retour est conservé, puis retiré à la sortie', async () => {
    resetDefaultCollections();
    expect(await useDemoStore.getState().enterIfFresh()).toBe(true);
    expect(useDemoStore.getState()).toMatchObject({ active: true, canReturn: false }); // rien à retrouver : aucun bandeau
    await exitDemoDefault();
    useDemoStore.setState({ active: false, canReturn: false });
    resetDefaultCollections();
    await createBienDefault({ nom: 'Maison perso store', adresse: 'Lomé' });
    expect(await useDemoStore.getState().enter()).toBe(true);
    expect(useDemoStore.getState()).toMatchObject({ active: true, canReturn: true }); // données personnelles : « Retrouver mes données personnelles »
    expect(await useDemoStore.getState().exit()).toBe(true);
    expect(useDemoStore.getState().canReturn).toBe(false);
  });

  it('hors démonstration, requestPersonal ne change rien ; un échec de changement d’espace est signalé sans erreur levée', async () => {
    expect(await useDemoStore.getState().requestPersonal()).toBe('left');
    resetDefaultCollections();
    await createBienDefault({ nom: 'Maison perso store', adresse: 'Lomé' });
    expect(await useDemoStore.getState().enter()).toBe(true);
    mockFail.get = (key) => key === `${PREFIX}core_records`;
    expect(await useDemoStore.getState().requestPersonal()).toBe('failed'); // lecture impossible = « il y a des données » : retour tenté, échec signalé
    expect(useDemoStore.getState().error).toMatch(/données personnelles ne sont pas supprimées/);
    mockFail.get = null;
  });
});

describe('Fenêtre « un compte est nécessaire »', () => {
  it('explique la nécessité d’un compte, selon le contexte, sans promettre ce qui n’existe pas', () => {
    const sync = accountPromptCopy('sync');
    const save = accountPromptCopy('demo_save');
    for (const copy of [sync, save]) {
      expect(copy.title).toBe('Un compte est nécessaire');
      expect(copy.message).toMatch(/compte est nécessaire/);
    }
    expect(sync.message).not.toBe(save.message);
    expect(sync.message).toMatch(/vos données y restent/); // sans compte, rien n'est perdu sur le téléphone
    expect(save.message).toMatch(/séparés de vos données personnelles/);
  });

  it('commencer un travail personnel : explique qu’un compte est nécessaire et que la démonstration reste utilisable sans compte', () => {
    const copy = accountPromptCopy('personal_start');
    expect(copy.title).toBe('Un compte est nécessaire');
    expect(copy.message).toMatch(/travail personnel/);
    expect(copy.message).toMatch(/explorer la démonstration sans compte/);
    expect(copy.message).not.toBe(accountPromptCopy('sync').message);
  });

  it('comptes fermés : « S’inscrire » et « Se connecter » n’ouvrent AUCUN écran de compte (message explicatif)', () => {
    expect(resolveAccountChoice('sign-up', false)).toEqual({ kind: 'unavailable' });
    expect(resolveAccountChoice('login', false)).toEqual({ kind: 'unavailable' });
    expect(ACCOUNT_UNAVAILABLE_COPY.message).toMatch(/pas encore activée/);
    expect(ACCOUNT_UNAVAILABLE_COPY.message).toMatch(/données personnelles ne sont pas touchées/);
  });

  it('comptes ouverts (plus tard) : navigation vers l’inscription ou la connexion', () => {
    expect(resolveAccountChoice('sign-up', true)).toEqual({ kind: 'navigate', route: '/(auth)/sign-up' });
    expect(resolveAccountChoice('login', true)).toEqual({ kind: 'navigate', route: '/(auth)/login' });
  });
});

describe('Accueil : bloc « S’inscrire / Se connecter »', () => {
  it('comptes fermés : toujours affiché (personne ne peut être connecté) ; le texte reste facultatif', () => {
    for (const status of ['initializing', 'signedOut', 'signedIn'] as const) expect(showHomeAccountPrompt(false, status)).toBe(true);
    expect(HOME_ACCOUNT_PROMPT_COPY.message).toMatch(/Facultatif/);
    expect(HOME_ACCOUNT_PROMPT_COPY.message).toMatch(/sans compte/);
  });

  it('comptes ouverts : affiché seulement une fois la session lue et personne connecté ; disparaît à la connexion', () => {
    expect(showHomeAccountPrompt(true, 'initializing')).toBe(false); // aucun clignotement pendant la restauration de session
    expect(showHomeAccountPrompt(true, 'signedOut')).toBe(true);
    expect(showHomeAccountPrompt(true, 'signedIn')).toBe(false);
  });
});

describe('Comptes cloud fermés et câblage statique', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('l’interrupteur est fermé et la session cloud n’est initialisée que s’il est ouvert (Firebase non touché)', () => {
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/if \(dbHydrated && CLOUD_ACCOUNT_ENABLED\) useCloudStore\.getState\(\)\.init\(\);/);
    expect(layout.match(/getState\(\)\.init\(\)/g)).toHaveLength(1);
  });

  it('les écrans de compte, de connexion, d’inscription et de réinitialisation redirigent (liens profonds compris)', () => {
    for (const file of ['app/account/cloud.tsx', 'app/(auth)/login.tsx', 'app/(auth)/sign-up.tsx', 'app/(auth)/forgot-password.tsx']) {
      const src = read(file);
      expect(src).toContain('CLOUD_ACCOUNT_ENABLED ?');
      expect(src).toMatch(/<Redirect href="\/\(tabs\)" \/>/);
    }
  });

  it('les accès au compte (Profil, bandeau de synchronisation) sont masqués ou remplacés par la fenêtre explicative', () => {
    expect(read('features/profile/screens/ProfileScreen.tsx')).toMatch(/entry\.id === 'cloud' && !CLOUD_ACCOUNT_ENABLED \? openAccountPrompt\('sync'\)/);
    expect(read('components/immobilier/SyncBanner.tsx')).toMatch(/if \(!CLOUD_ACCOUNT_ENABLED \|\| authStatus !== 'signedIn'\) return null;/);
  });

  it('le bandeau de démonstration, la fenêtre de compte et la proposition d’exemples sont montés', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('<DemoBanner />');
    expect(layout).toContain('<AccountRequiredDialog />');
    expect(layout).toContain('useDemoStore.getState().sync()');
    // aucun parcours imposé : l'accueil ne propose plus d'espace distinct ; la démonstration reste un choix facultatif dans le Profil
    expect(read('features/home/screens/HomeScreen.tsx')).not.toContain('DemoEntryCard');
    expect(read('features/profile/screens/ProfileScreen.tsx')).toContain('<DemoEntryCard />');
    expect(read('components/demo/DemoEntryCard.tsx')).not.toContain('Essayer avec des exemples');
    // la présentation mène à l'exploration (démonstration) à la première utilisation, jamais bloquante
    const onboarding = read('features/auth/screens/OnboardingScreen.tsx');
    expect(onboarding).toMatch(/await useDemoStore\.getState\(\)\.enterIfFresh\(\)\.catch\(\(\) => false\);\s*router\.replace\('\/\(tabs\)'\);/);
    expect(onboarding).toContain('Explorez sans compte');
    expect(onboarding).not.toMatch(/aucune inscription n'est demandée\.["']/); // plus de promesse d'usage personnel durable sans compte
    const banner = read('components/demo/DemoBanner.tsx');
    expect(banner).toMatch(/MODE DÉMONSTRATION/);
    // démo simple : plus de « Enregistrer mon travail » ; le bandeau ne s'affiche que s'il faut un lien de retour vers des données personnelles
    expect(banner).not.toMatch(/Enregistrer mon travail|Mon espace personnel/);
    expect(banner).toContain('if (!showReturn && !error) return null;');
    expect(banner).toContain('const showReturn = active && canReturn;');
  });

  it('accueil : le bloc « S’inscrire / Se connecter » est juste sous l’en-tête (profil, notifications) et avant « Mes outils récents »', () => {
    const home = read('features/home/screens/HomeScreen.tsx');
    const header = home.indexOf('<HomeHeader />');
    const prompt = home.indexOf('<HomeAccountPrompt />');
    const tools = home.indexOf('title="Mes outils récents"');
    expect(header).toBeGreaterThan(-1);
    expect(prompt).toBeGreaterThan(header);
    expect(tools).toBeGreaterThan(prompt);
    const block = read('components/account/HomeAccountPrompt.tsx');
    expect(block).toContain('showHomeAccountPrompt(CLOUD_ACCOUNT_ENABLED, authStatus)');
    expect(block).toContain('resolveAccountChoice(choice, CLOUD_ACCOUNT_ENABLED)');
    expect(block).toMatch(/S’inscrire/);
    expect(block).toMatch(/Se connecter/);
    expect(block).not.toMatch(/firebase|firestore/i);
  });

  it('les clés de l’espace personnel n’ont pas changé (aucune migration) : seules les clés de démonstration sont préfixées', () => {
    const persistence = read('services/persistence.ts');
    expect(persistence).toContain("const LEGACY_SNAPSHOT_KEY = 'db_snapshot';");
    expect(persistence).toContain("const CORE_KEY_PREFIX = 'core_';");
    expect(persistence).toContain("let namespace = '';");
    expect(persistence).toContain("const DEMO_NAMESPACE = 'demo/';");
  });

  it('aucun fichier Firebase, de règles ou de configuration de production n’est référencé par les nouveaux fichiers', () => {
    for (const file of ['services/demoWorkspace.ts', 'store/demoStore.ts', 'services/accountPromptService.ts', 'components/demo/DemoBanner.tsx', 'components/demo/DemoEntryCard.tsx', 'components/account/AccountRequiredDialog.tsx']) {
      expect(read(file)).not.toMatch(/firebase|firestore/i);
    }
  });
});
