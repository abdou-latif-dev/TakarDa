// Version LOCALE (profil `test-local` : EXPO_PUBLIC_BUILD_TARGET=local + EXPO_PUBLIC_APP_VARIANT=test) : preuve d'exécution, au niveau JavaScript, qu'elle ne contacte jamais le réseau ni
// Firebase au démarrage ni pendant la démonstration, et que les comptes restent fermés. Le réseau est remplacé par un détecteur qui LÈVE et consigne toute tentative.
// Limite : ce test s'exécute dans Jest, pas sur un téléphone ; il prouve la chaîne JavaScript (chargement des modules cloud compris), pas le comportement du système Android.

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

// Le SDK Firebase (modules ESM que Jest ne charge pas) est remplacé par un détecteur : TOUT appel d'une de ses fonctions (initializeApp, getAuth, getFirestore, signIn…) est consigné.
const mockSdkCalls: string[] = [];
const mockSdk = () =>
  new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (target, name) => {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        void args;
        mockSdkCalls.push(name);
        return undefined;
      };
    },
  });
jest.mock('firebase/app', () => mockSdk());
jest.mock('firebase/auth', () => mockSdk());
jest.mock('firebase/firestore', () => mockSdk());

describe('Version locale « test-local » : aucun réseau, aucun Firebase, comptes fermés', () => {
  const attempts: string[] = [];
  const realFetch = globalThis.fetch;
  const before = { target: process.env.EXPO_PUBLIC_BUILD_TARGET, variant: process.env.EXPO_PUBLIC_APP_VARIANT };

  beforeAll(() => {
    process.env.EXPO_PUBLIC_BUILD_TARGET = 'local';
    process.env.EXPO_PUBLIC_APP_VARIANT = 'test';
    globalThis.fetch = (async (input: unknown) => {
      attempts.push(`fetch ${typeof input === 'string' ? input.split('?')[0] : 'requête'}`);
      throw new Error('réseau interdit dans la version locale');
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    for (const [key, value] of [['EXPO_PUBLIC_BUILD_TARGET', before.target], ['EXPO_PUBLIC_APP_VARIANT', before.variant]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('cible « local » : comptes fermés ; le magasin cloud et l’adaptateur Firebase sont chargés mais AUCUNE fonction du SDK n’est appelée ; aucune tentative réseau au démarrage ni pendant la démonstration', async () => {
    await jest.isolateModulesAsync(async () => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const features = require('../../constants/features') as typeof import('../../constants/features');
      const target = require('../../constants/buildTarget') as typeof import('../../constants/buildTarget');
      expect(target.BUILD_TARGET).toBe('local');
      expect(features.CLOUD_ACCOUNT_ENABLED).toBe(false);

      // le démarrage de l'application importe le magasin cloud (donc l'adaptateur et le SDK Firebase) : l'import seul ne doit appeler AUCUNE fonction du SDK
      require('../../store/cloudStore');
      require('../../services/firebase/firebaseClient');
      expect(mockSdkCalls).toEqual([]);

      // démarrage réel de la base locale puis première ouverture : espace de démonstration, accueil
      const persistence = require('../persistence') as typeof import('../persistence');
      await persistence.hydrateDb();
      const demo = require('../demoWorkspace') as typeof import('../demoWorkspace');
      expect(await demo.enterDemoIfFreshInstall()).toBe(true);
      const home = require('../homeService') as typeof import('../homeService');
      const feed = await home.loadHomeFeed();
      expect(feed.tools.length).toBeGreaterThan(0);
      const { loadImmobilierStats } = require('../moduleStatsService') as typeof import('../moduleStatsService');
      expect(await loadImmobilierStats('all')).not.toBeNull();
      /* eslint-enable @typescript-eslint/no-require-imports */

      expect(mockSdkCalls).toEqual([]); // après le démarrage et la démonstration : toujours aucun appel au SDK (aucune application Firebase initialisée)
    });
    expect(attempts).toEqual([]);
  }, 120000);

  it('les écrans de compte redirigent, la session cloud n’est pas initialisée, le profil et la fenêtre « compte » n’ouvrent aucun écran de compte', () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    expect(read('app/_layout.tsx')).toMatch(/if \(dbHydrated && CLOUD_ACCOUNT_ENABLED\) useCloudStore\.getState\(\)\.init\(\);/);
    for (const file of ['app/(auth)/login.tsx', 'app/(auth)/sign-up.tsx', 'app/account/cloud.tsx']) expect(read(file)).toContain('CLOUD_ACCOUNT_ENABLED ?');
  });

  it('l’identité de test est portée par la variante, indépendamment du cloud : la version locale reste installable à côté de TakarDa', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appConfig = require('../../app.config.js') as (arg: { config: Record<string, unknown> }) => { android: { package: string }; name: string };
    const config = appConfig({ config: { name: 'TakarDa', android: { package: 'com.takarda.app' } } });
    expect(config).toMatchObject({ name: 'TakarDa (test)', android: { package: 'com.takarda.app.test' } });
  });
});
