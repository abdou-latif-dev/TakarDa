// Phase 7 — modules sans propriétaire (tontines, formulaires, CEET/TDE, contacts non locataires) : INDISPONIBLES en contexte multi-compte, sans rien
// supprimer ni migrer ; inchangés quand le drapeau est fermé, sans compte, ou avec un seul compte connu. Registre des comptes de l'appareil persistant.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { activityEvents, groups, forms } from '../db';
import { setActiveCloudUid } from '../cloudVisibility';
import { __resetDeviceAccountsForTests, hydrateDeviceAccounts, isDeviceAccountsHydrated, knownDeviceAccounts, registerDeviceAccount } from '../deviceAccounts';
import { __useLockFlagForTests, isActivityLocked, isMultiAccount, isMultiAccountContext, isPathLocked, lockedModuleForPath, type LockContext } from '../moduleLock';
import { getRecentActivities, recordActivity, visibleActivities } from '../activityService';
import { statisticsService } from '../statisticsService';
import { loadUtilityPayments, loadUtilityStats } from '../moduleStatsService';
import { loadHomeFeed } from '../homeService';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

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

beforeEach(() => {
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  __resetDeviceAccountsForTests();
  __useLockFlagForTests(null);
  setActiveCloudUid(null);
});
afterEach(() => {
  __useLockFlagForTests(null);
  setActiveCloudUid(null);
});

const ctx = (over: Partial<LockContext> = {}): LockContext => ({ flagOpen: true, activeUid: 'alice', hydrated: true, known: ['alice', 'bob'], ...over });

describe('Décision multi-compte (pure)', () => {
  it('multi-compte seulement si drapeau ouvert, compte actif et un AUTRE compte connu', () => {
    expect(isMultiAccount(ctx())).toBe(true);
    expect(isMultiAccount(ctx({ flagOpen: false }))).toBe(false); // drapeau fermé : jamais de verrou
    expect(isMultiAccount(ctx({ activeUid: null }))).toBe(false); // sans compte : comportement actuel
    expect(isMultiAccount(ctx({ known: ['alice'] }))).toBe(false); // un seul compte connu
    expect(isMultiAccount(ctx({ known: [] }))).toBe(false);
  });

  it('registre illisible ou non lu avec un compte actif : multi-compte présumé (prudence)', () => {
    expect(isMultiAccount(ctx({ hydrated: false, known: [] }))).toBe(true);
  });
});

describe('Registre des comptes de l’appareil', () => {
  it('persiste, survit à un redémarrage simulé, ne contient que des identifiants et n’enregistre pas deux fois', async () => {
    expect(isDeviceAccountsHydrated()).toBe(false);
    await registerDeviceAccount('alice');
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    expect(knownDeviceAccounts().sort()).toEqual(['alice', 'bob']);
    expect(JSON.parse(mockMemory.get('@formease/device_accounts') as string).sort()).toEqual(['alice', 'bob']);
    __resetDeviceAccountsForTests(); // redémarrage
    expect(knownDeviceAccounts()).toEqual([]);
    await hydrateDeviceAccounts();
    expect(knownDeviceAccounts().sort()).toEqual(['alice', 'bob']);
    expect(isDeviceAccountsHydrated()).toBe(true);
  });
});

describe('Chemins verrouillés', () => {
  it('tontines, formulaires, CEET/TDE, factures et leurs entrées dans Immobilier ; jamais Immobilier ni le compte', () => {
    for (const p of ['/tontine', '/tontine/create', '/group/g1/tontine', '/group/g1/add-member', '/tontines', '/(tabs)/tontines', '/form/new', '/form/f1/fill', '/forms', '/modeles', '/ceet', '/ceet/releves', '/tde/participants', '/factures/new', '/immobilier/b1/facture-utility-new', '/immobilier/facture-utility/f1']) {
      expect([p, lockedModuleForPath(p) !== null]).toEqual([p, true]);
    }
    for (const p of ['/', '/(tabs)', '/immobilier', '/immobilier/b1', '/immobilier/b1/contrat', '/account', '/account/cloud', '/account/conflicts', '/statistics', '/notifications', '/indisponible']) {
      expect([p, lockedModuleForPath(p)]).toEqual([p, null]);
    }
  });

  it('drapeau fermé : aucun chemin n’est jamais verrouillé, même avec plusieurs comptes connus', async () => {
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    setActiveCloudUid('alice');
    expect(isMultiAccountContext()).toBe(false);
    expect(isPathLocked('/tontine')).toBe(false);
  });
});

describe('Effets sur les agrégats (drapeau simulé ouvert)', () => {
  const seedData = () => {
    groups.push({ id: 'g1', name: 'Tontine A', kind: 'tontine' } as never);
    forms.push({ id: 'f1', title: 'Form' } as never);
    activityEvents.push(
      { id: 'e1', type: 'contribution_added', title: 'Cotisation', description: '', at: '2026-10-20T10:00:00.000Z', groupId: 'g1' } as never,
      { id: 'e2', type: 'immobilier.loyer_paid', title: 'Loyer', description: '', at: '2026-10-20T11:00:00.000Z', module: 'immobilier' } as never,
      { id: 'e3', type: 'utility.facture_validated', title: 'Facture', description: '', at: '2026-10-20T12:00:00.000Z', module: 'ceet' } as never,
      { id: 'e4', type: 'form_created', title: 'Formulaire', description: '', at: '2026-10-20T13:00:00.000Z' } as never,
    );
  };

  it('contexte non multi-compte (un seul compte) : tout reste visible, comme aujourd’hui', async () => {
    seedData();
    __useLockFlagForTests(true);
    await registerDeviceAccount('alice');
    setActiveCloudUid('alice');
    expect(isMultiAccountContext()).toBe(false);
    expect(visibleActivities(activityEvents).map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    const overview = await statisticsService.getOverview();
    expect(overview.tontinesCount).toBe(1);
    expect(overview.formsCount).toBe(1);
  });

  it('contexte multi-compte : activités, statistiques et accueil des modules sans propriétaire masqués ; Immobilier intact ; données conservées', async () => {
    seedData();
    __useLockFlagForTests(true);
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    setActiveCloudUid('alice');
    expect(isMultiAccountContext()).toBe(true);
    expect(isPathLocked('/tontine')).toBe(true);
    expect(isPathLocked('/immobilier')).toBe(false);
    expect(visibleActivities(activityEvents).map((e) => e.id)).toEqual(['e2']); // seule l'activité d'Immobilier
    expect(getRecentActivities().map((e) => e.id)).toEqual(['e2']);
    const overview = await statisticsService.getOverview();
    expect(overview).toMatchObject({ tontinesCount: 0, formsCount: 0 });
    expect(await loadUtilityStats('ceet')).toBeNull();
    expect(await loadUtilityPayments('tde')).toEqual([]);
    const feed = await loadHomeFeed();
    expect(feed.alerts.filter((a) => a.module !== 'immobilier')).toEqual([]);
    // rien n'a été supprimé ni modifié
    expect(groups).toHaveLength(1);
    expect(forms).toHaveLength(1);
    expect(activityEvents).toHaveLength(4);
    // un nouveau journal Immobilier reste visible
    recordActivity({ type: 'immobilier.bien_created', title: 'Bien', description: '', module: 'immobilier' });
    expect(visibleActivities(activityEvents).filter((e) => e.module === 'immobilier')).toHaveLength(2);
  });

  it('retour à un seul compte ou déconnexion : tout redevient accessible', async () => {
    seedData();
    __useLockFlagForTests(true);
    await registerDeviceAccount('alice');
    await registerDeviceAccount('bob');
    setActiveCloudUid('alice');
    expect(visibleActivities(activityEvents)).toHaveLength(1);
    setActiveCloudUid(null); // déconnexion
    expect(visibleActivities(activityEvents)).toHaveLength(4);
    expect(isActivityLocked({ type: 'contribution_added', groupId: 'g1' })).toBe(false);
  });

  it('registre non lu avec un compte actif : verrouillé par prudence', async () => {
    seedData();
    __useLockFlagForTests(true);
    setActiveCloudUid('alice'); // registre jamais lu
    expect(isMultiAccountContext()).toBe(true);
    expect(visibleActivities(activityEvents).map((e) => e.id)).toEqual(['e2']);
  });
});

describe('Structure', () => {
  const root = path.join(__dirname, '..', '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');

  it('l’accès de test au drapeau n’est utilisé par aucun code de production', () => {
    expect(walk(root).filter((f) => /__useLockFlagForTests/.test(fs.readFileSync(f, 'utf8'))).map(rel)).toEqual(['services/moduleLock.ts']);
  });

  it('le garde est monté seulement avec le drapeau ouvert ; le registre est alimenté par la connexion ; la route d’information existe', () => {
    expect(fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')).toContain('{CLOUD_ACCOUNT_ENABLED ? <ModuleLockGuard /> : null}');
    expect(fs.readFileSync(path.join(root, 'store/cloudStore.ts'), 'utf8')).toContain('registerDeviceAccount(user.uid)');
    expect(fs.existsSync(path.join(root, 'app/indisponible.tsx'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'constants/features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
