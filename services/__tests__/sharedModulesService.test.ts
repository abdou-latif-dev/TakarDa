// F3b — façade des espaces partagés : gardes (drapeau, espace, adresse vérifiée, compte), carnet local propre au compte, flux composés, et structure
// statique (aucun écran n'importe le moteur ni Firebase, tout est derrière le drapeau fermé). Cloud en mémoire ; aucun SDK, aucun réseau.

import fs from 'fs';
import path from 'path';
import { setEmailVerified } from '../accountVerification';
import { switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import { contractEndDay } from '../sharedModuleContracts';
import { createSharedModulesService, sharedModules, type ContractChoice } from '../sharedModulesService';
import { createMemoryModulesCloud, type MemoryModulesCloud } from './helpers/modulesMemoryBackend';

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

const MODULE = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

let cloud: MemoryModulesCloud;
let clock: number;
let choices: ContractChoice[];
const now = () => new Date(clock);

const service = (over: { enabled?: () => boolean } = {}) =>
  createSharedModulesService({
    enabled: over.enabled ?? (() => true),
    backend: (uid) => cloud.as(uid),
    contracts: async () => choices,
    now,
  });
const as = (uid: string, verified = true) => {
  setSyncAccount(uid);
  setEmailVerified(uid, verified);
};
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

beforeEach(async () => {
  mockMemory.clear();
  await switchWorkspace('personal');
  clock = Date.parse('2026-10-21T10:00:00.000Z');
  cloud = createMemoryModulesCloud(now);
  choices = [{ id: 'c1', label: 'Koffi', statusKey: 'actif', endDay: null }, { id: 'c2', label: 'Ama', statusKey: 'termine', endDay: '2026-10-10' }];
  as('alice'); // un seul compte est « vérifié » à la fois (état du compte actif) : `as` le rebascule à chaque changement de compte
});
afterEach(() => {
  setSyncAccount(null);
});

describe('Gardes', () => {
  it('drapeau fermé : tout est refusé, rien n’est chargé ni écrit (service de production)', async () => {
    const closed = { ok: false, message: 'Les comptes cloud ne sont pas ouverts dans cette version.' };
    expect(await sharedModules.createModule('alice', 'Immeuble')).toEqual(closed);
    expect(await sharedModules.requestAccess('alice', MODULE, '')).toEqual(closed);
    expect(await sharedModules.ownerView('alice', MODULE)).toEqual(closed);
    expect(await sharedModules.refreshJoined('alice')).toEqual(closed);
    expect([...mockMemory.keys()].filter((k) => k.includes('shared_modules'))).toEqual([]);
  });

  it('adresse non vérifiée, compte différent, démonstration : refus avec un message clair, aucune écriture', async () => {
    as('alice', false);
    expect((await service().createModule('alice', 'Immeuble')).ok).toBe(false);
    as('alice', true);
    expect(await service().createModule('koffi', 'Immeuble')).toEqual({ ok: false, message: 'Le compte actif a changé : réessayez.' });
    await switchWorkspace('demo');
    expect(await service().createModule('alice', 'Immeuble')).toEqual({ ok: false, message: 'Les espaces partagés ne sont pas disponibles dans la démonstration.' });
    await switchWorkspace('personal');
    expect(cloud.writes).toEqual([]);
  });

  it('cloud impossible à composer (session différente) : message, pas d’exception', async () => {
    const broken = createSharedModulesService({ enabled: () => true, backend: () => { throw new Error('session'); }, contracts: async () => choices, now });
    expect(await broken.createModule('alice', 'Immeuble')).toEqual({ ok: false, message: 'Connexion au compte impossible : reconnectez-vous puis réessayez.' });
  });
});

describe('Carnet local et flux composés', () => {
  it('créer un espace : le cloud le crée, le carnet le retient ; un autre compte du même appareil ne le voit pas', async () => {
    const created = unwrap(await service().createModule('alice', 'Immeuble Tokoin'));
    expect(created.name).toBe('Immeuble Tokoin');
    expect((await service().listLocal()).owned).toEqual([{ moduleId: created.moduleId, name: 'Immeuble Tokoin', createdAt: '2026-10-21T10:00:00.000Z' }]);
    as('bob');
    expect((await service().listLocal()).owned).toEqual([]);
    as('alice');
    unwrap(await service().renameModule('alice', created.moduleId, 'Résidence A'));
    expect((await service().listLocal()).owned[0].name).toBe('Résidence A');
  });

  it('parcours complet à deux comptes : demande → approbation (contrat) → accès actif → révocation → départ impossible → rétablissement → départ', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', moduleId.toUpperCase(), 'Koffi'));
    expect((await service().listLocal()).joined).toMatchObject([{ moduleId, label: 'Koffi', status: 'pending', moduleName: null }]);
    as('alice');
    const view = unwrap(await service().ownerView('alice', moduleId));
    expect(view.requests).toMatchObject([{ uid: 'koffi', state: 'pending', label: 'Koffi' }]);
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c1'));
    as('koffi');
    unwrap(await service().refreshJoined('koffi'));
    expect((await service().listLocal()).joined[0]).toMatchObject({ status: 'active', moduleName: 'Immeuble' });
    as('alice');
    unwrap(await service().revoke('alice', moduleId, 'koffi'));
    as('koffi');
    unwrap(await service().refreshJoined('koffi'));
    expect((await service().listLocal()).joined[0].status).toBe('revoked');
    expect((await service().leave('koffi', moduleId)).ok).toBe(false);
    as('alice');
    unwrap(await service().reactivate('alice', moduleId, { uid: 'koffi', contractId: 'c1' }));
    as('koffi');
    unwrap(await service().leave('koffi', moduleId));
    expect((await service().listLocal()).joined[0].status).toBe('left');
    await service().forgetJoined(moduleId);
    expect((await service().listLocal()).joined).toEqual([]);
  });

  it('annuler une demande en attente la retire du carnet ; un échec réseau pendant l’actualisation d’un espace n’empêche pas les autres', async () => {
    const a = unwrap(await service().createModule('alice', 'A'));
    as('koffi');
    unwrap(await service().requestAccess('koffi', a.moduleId, ''));
    unwrap(await service().cancelRequest('koffi', a.moduleId));
    expect((await service().listLocal()).joined).toEqual([]);
    unwrap(await service().requestAccess('koffi', a.moduleId, ''));
    cloud.offline = true;
    expect(unwrap(await service().refreshJoined('koffi'))).toEqual({ checked: 0, failed: 1 });
    cloud.offline = false;
    expect(unwrap(await service().refreshJoined('koffi'))).toEqual({ checked: 1, failed: 0 });
  });

  it('la fin d’accès d’un contrat terminé est posée à l’approbation, au changement de contrat et à l’ouverture de l’écran du propriétaire', async () => {
    const { moduleId } = unwrap(await service().createModule('alice', 'Immeuble'));
    for (const uid of ['koffi', 'bob']) {
      as(uid);
      unwrap(await service().requestAccess(uid, moduleId, uid));
    }
    as('alice');
    unwrap(await service().approve('alice', moduleId, 'koffi', 'c2')); // contrat terminé le 10 octobre
    expect(cloud.members[`${moduleId}/koffi`].accessUntil).toBe('2027-01-09T00:00:00.000Z');
    unwrap(await service().approve('alice', moduleId, 'bob', 'c1')); // contrat en cours
    expect(cloud.members[`${moduleId}/bob`].accessUntil).toBeNull();
    choices = choices.map((c) => (c.id === 'c1' ? { ...c, statusKey: 'termine', endDay: '2026-10-20' } : c)); // le contrat de Bob se termine
    expect(unwrap(await service().reconcileAccessEnds('alice', moduleId))).toBe(1);
    expect(cloud.members[`${moduleId}/bob`].accessUntil).toBe('2027-01-19T00:00:00.000Z');
    unwrap(await service().setContract('alice', moduleId, 'bob', 'c2'));
    expect(cloud.members[`${moduleId}/bob`]).toMatchObject({ contractId: 'c2', accessUntil: '2027-01-09T00:00:00.000Z' });
  });

  it('un carnet local illisible n’est jamais traité comme vide ; créer un espace dans ce cas dit la vérité (il existe dans le cloud, voici son identifiant)', async () => {
    mockMemory.set('@formease/shared_modules@alice', '{ pas du json');
    await expect(service().listLocal()).rejects.toBeDefined();
    const result = await service().createModule('alice', 'Immeuble');
    expect(result.ok).toBe(false);
    expect(Object.keys(cloud.modules)).toHaveLength(1);
    expect((result as { message: string }).message).toContain(Object.keys(cloud.modules)[0]);
    expect(mockMemory.get('@formease/shared_modules@alice')).toBe('{ pas du json'); // jamais réécrit
  });
});

describe('Jour de fin de contrat', () => {
  it('date de sortie si renseignée ; sinon contrat terminé : jour de la dernière mise à jour ; contrat en cours : aucun', () => {
    expect(contractEndDay({ statusKey: 'actif', values: { date_sortie: '2026-01-01' } })).toBeNull();
    expect(contractEndDay({ statusKey: 'termine', values: { date_sortie: '2026-03-15' } })).toBe('2026-03-15');
    expect(contractEndDay({ statusKey: 'termine', updatedAt: '2026-04-02T08:00:00.000Z', values: {} })).toBe('2026-04-02');
    expect(contractEndDay({ statusKey: 'termine', values: { date_sortie: 'demain' } })).toBeNull();
    expect(contractEndDay({ statusKey: 'archive', values: {} })).toBeNull();
    expect(contractEndDay({ statusKey: 'archive', values: { date_sortie: '2026-05-05T00:00:00.000Z' } })).toBe('2026-05-05');
  });
});

describe('Structure : rien n’est ouvert, rien n’est importé à tort', () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '__tests__'].includes(e.name) ? [] : walk(`${dir}/${e.name}`)) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
  const imports = (file: string) => read(file).split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');

  it('les écrans et routes n’importent que la façade et les flux : ni le moteur, ni Firebase, ni le port Firestore', () => {
    for (const file of ['features/profile/screens/SharedModulesScreen.tsx', 'features/profile/screens/SharedModuleOwnerScreen.tsx', 'features/profile/components/ContractPickerDialog.tsx']) {
      expect({ file, bad: imports(file).match(/services\/sync\/|services\/firebase|firebase\/|firestore/gi) }).toEqual({ file, bad: null });
    }
    expect(imports('features/profile/screens/SharedModulesScreen.tsx')).toContain("@/services/sharedModulesService");
  });

  it('les routes redirigent tant que le drapeau est fermé (même par lien profond)', () => {
    for (const file of ['app/account/shared/index.tsx', 'app/account/shared/[moduleId].tsx']) {
      const source = read(file);
      expect(source).toContain('CLOUD_ACCOUNT_ENABLED ?');
      expect(source).toContain('<Redirect href="/(tabs)" />');
    }
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });

  it('l’écran de compte n’ouvre les espaces partagés qu’à une adresse vérifiée', () => {
    const screen = read('features/profile/screens/CloudAccountScreen.tsx');
    expect(screen).toMatch(/\{s\.user\.emailVerified \? \(\s*<Card className="gap-3">\s*<SectionTitleText className="text-base">Espaces partagés/);
    expect(screen).toContain("router.push('/account/shared' as never)");
  });

  it('le SDK Firestore n’est importé que par le port Firestore des modules ; sa composition n’est chargée qu’à la demande, derrière le drapeau', () => {
    const files = ['services', 'store', 'features', 'components', 'app'].flatMap(walk);
    // la composition de l'application (modulesBoot, chargée à la demande) et celle de la suppression de compte (cloudDeletionComposition : port d'effacement, F4)
    expect(files.filter((f) => /firestoreModulesBackend/.test(imports(f)) && !f.endsWith('firestoreModulesBackend.ts'))).toEqual(['services/firebase/cloudDeletionComposition.ts', 'services/firebase/modulesBoot.ts', 'services/firebase/sharedSpacesDeparture.ts']);
    expect(files.filter((f) => /\.\/firebase\/modulesBoot|firebase\/modulesBoot/.test(imports(f)))).toEqual([]); // jamais d'import statique
    const facade = read('services/sharedModulesService.ts');
    expect(facade).toContain("require('./firebase/modulesBoot')");
    expect(facade).toMatch(/if \(!enabled\(\)\) return failure\(/);
    expect(imports('services/firebase/firestoreModulesBackend.ts')).not.toMatch(/firebaseClient|firebaseWebConfig|firebase\/auth|firebase\/app/);
    expect(read('services/firebase/firestoreModulesBackend.ts')).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket/);
  });

  it('le port Firestore ordinaire des modules n’écrit jamais dans les données du module (syncRecords) : fiches d’accès et vue publiée seulement ; seul le port d’EFFACEMENT (sous verrou) les supprime', () => {
    const backend = read('services/firebase/firestoreModulesBackend.ts');
    const ordinary = backend.slice(0, backend.indexOf('export function createFirestoreModuleErasureBackend')).split('\n').filter((l) => !/^\s*(import|\/\/)/.test(l) && !l.startsWith(' * ') && !l.startsWith('/**')).join('\n');
    expect(ordinary).not.toMatch(/syncRecords|MODULE_SYNC_COLLECTION|SYNC_COLLECTION/);
    const erasure = backend.slice(backend.indexOf('export function createFirestoreModuleErasureBackend'));
    expect(erasure).toContain('MODULE_SYNC_COLLECTION'); // ... pour les supprimer, jamais pour les écrire
    expect(erasure).not.toMatch(/setDoc|updateDoc\(doc\(db, MODULES_COLLECTION, moduleId, MODULE_SYNC/);
    expect(read('services/sharedModules/moduleFlows.ts')).not.toMatch(/syncRecords|tenantViews|snapshotCollections|coreService/);
  });
});
