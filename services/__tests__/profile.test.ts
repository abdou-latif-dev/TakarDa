// Phase 8 — Profil V1 et nettoyage des entrées visibles.
// Le profil est l'identité LOCALE (aucun compte) ; les anciens raccourcis ont disparu du Profil mais leurs
// routes, services et données sont conservés.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import fs from 'fs';
import path from 'path';
import { buildProfileView, LOCAL_PROFILE_NOTE, PROFILE_ENTRIES } from '../profileService';

/* eslint-disable @typescript-eslint/no-require-imports */
function fresh() {
  jest.resetModules();
  return {
    db: require('../db') as typeof import('../db'),
    auth: require('../authService').authService as typeof import('../authService').authService,
    profile: require('../profileService') as typeof import('../profileService'),
    registry: require('../toolRegistryService') as typeof import('../toolRegistryService'),
    groupService: require('../groupService').groupService as typeof import('../groupService').groupService,
    parts: require('../utilityParticipantsService') as typeof import('../utilityParticipantsService'),
    persistence: require('../persistence') as typeof import('../persistence'),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const routeFile = (route: string) => {
  const clean = route.replace(/^\//, '');
  if (clean.startsWith('(tabs)/')) return `app/${clean}.tsx`;
  return exists(`app/${clean}/index.tsx`) ? `app/${clean}/index.tsx` : `app/${clean}.tsx`;
};

describe('Identité locale affichée', () => {
  const user = { name: 'Awa Kossi', email: 'awa@example.com', phone: '90123456', formeaseId: 'FE-4821', avatarUrl: 'file:///a.jpg' };

  it('montre le nom, les coordonnées renseignées, la photo et l’identifiant local', () => {
    expect(buildProfileView(user)).toMatchObject({ name: 'Awa Kossi', contact: ['awa@example.com', '90123456'], avatarUri: 'file:///a.jpg', localIdLabel: 'ID local : FE-4821' });
  });

  it('un profil par défaut ou incomplet ne produit ni ligne vide ni valeur inventée', () => {
    expect(buildProfileView({ name: 'Utilisateur', email: '', phone: undefined, formeaseId: 'FE-4821', avatarUrl: undefined })).toMatchObject({ name: 'Utilisateur', contact: [], avatarUri: undefined });
    expect(buildProfileView({ name: '  ', email: '  ', formeaseId: '' } as never)).toMatchObject({ name: 'Utilisateur', contact: [], localIdLabel: null });
    expect(buildProfileView(null)).toMatchObject({ name: 'Utilisateur', contact: [], localIdLabel: null, avatarUri: undefined });
  });

  it('présente honnêtement ce qui n’existe pas encore : profil local, fonctions à venir', () => {
    const { note } = buildProfileView(user);
    expect(note).toBe(LOCAL_PROFILE_NOTE);
    expect(note).toMatch(/sur cet appareil/);
    expect(note).toMatch(/arrivera dans une prochaine version/);
    expect(note).not.toMatch(/connecté|synchronisé|sauvegardé en ligne|Firebase/i);
    expect(buildProfileView(user).localIdLabel).not.toMatch(/compte/i); // un identifiant local n'est pas un compte
    expect(read('features/profile/screens/AccountScreen.tsx')).toMatch(/aucun compte n(?:'|&apos;)est créé et rien n(?:'|&apos;)est envoyé en ligne/);
  });
});

describe('Modifier le profil', () => {
  it('les modifications persistent après un redémarrage et ne touchent ni outils ni données', async () => {
    jest.useFakeTimers();
    try {
      const w = fresh();
      await w.auth.restoreSession();
      const tool = await w.registry.installTool('tontine');
      await w.groupService.createTontine({ name: 'Famille', contributionAmount: 5000, frequency: 'monthly', startDate: new Date().toISOString(), orderMethod: 'join_order' } as Parameters<typeof w.groupService.createTontine>[0]);
      await w.registry.hideTool(tool.id);
      await w.parts.addParticipant('ceet', { name: 'Kossi' });
      const counts = () => ({ groups: w.db.groups.length, memberships: w.db.memberships.length, tools: w.db.tools.length, members: w.db.toolMembers.length, records: w.db.records.length, contacts: w.db.externalContacts.length, activities: w.db.activityEvents.length });
      const before = counts();

      await w.auth.updateProfile({ name: 'Koffi Mensah', email: 'koffi@example.com', phone: '90000000' });
      expect(counts()).toEqual(before);

      const stop = w.persistence.startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      w.db.users.length = 0; // redémarrage : mémoire vide, puis relecture du stockage
      await w.persistence.hydrateDb();
      const restored = await w.auth.restoreSession();
      expect(w.profile.buildProfileView(restored)).toMatchObject({ name: 'Koffi Mensah', contact: ['koffi@example.com', '90000000'] });
      expect(counts()).toEqual(before);
      expect(w.db.tools.find((t) => t.id === tool.id)!.settings).toMatchObject({ hidden: true }); // l'outil masqué le reste, avec ses données
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Entrées du Profil', () => {
  it('seulement ce qui fonctionne : Mon profil, Mes Outils, Apparence, Compte et synchronisation, Stockage, Mes données', () => {
    expect(PROFILE_ENTRIES.map((e) => e.id)).toEqual(['profil', 'outils', 'apparence', 'cloud', 'stockage', 'donnees']);
    expect(PROFILE_ENTRIES.find((e) => e.id === 'donnees')!.route).toBe('/privacy');
    expect(PROFILE_ENTRIES.find((e) => e.id === 'apparence')!.route).toBe('/account/appearance');
    expect(PROFILE_ENTRIES.find((e) => e.id === 'outils')!.route).toBe('/(tabs)/outils');
    expect(exists('app/(tabs)/outils.tsx')).toBe(true);
    for (const entry of PROFILE_ENTRIES) expect(exists(routeFile(entry.route))).toBe(true);
  });

  it('plus de raccourci vers Immobilier, Factures simples, Statistiques globales, Notifications ni Sécurité', () => {
    const routes = PROFILE_ENTRIES.map((e) => e.route).join(' ');
    for (const forbidden of ['/immobilier', '/factures', 'statistiques', '/statistics', '/notifications', '/account/security', '/scan', '/form', '/records']) {
      expect(routes).not.toContain(forbidden);
    }
    const screen = read('features/profile/screens/ProfileScreen.tsx');
    expect(screen).toContain('PROFILE_ENTRIES');
    for (const forbidden of ['/factures', '/immobilier', 'statistiques', '/notifications', 'account/security']) expect(screen).not.toContain(forbidden);
  });

  it('aucune connexion ni déconnexion obligatoire n’est introduite', () => {
    for (const file of ['features/profile/screens/ProfileScreen.tsx', 'features/profile/screens/AccountScreen.tsx', 'services/profileService.ts']) {
      const src = read(file);
      expect(src).not.toMatch(/\(auth\)|logout|Déconnexion|signUp|login/);
    }
    expect(read('app/index.tsx')).not.toContain('/(auth)/login');
  });

  it('aucun faux bouton de partage ni de notification (la synchronisation des biens et logements est réelle et facultative)', () => {
    const everything = PROFILE_ENTRIES.map((e) => `${e.label} ${e.subtitle}`).join(' ') + read('features/profile/screens/ProfileScreen.tsx');
    expect(everything).not.toMatch(/Partager|Notification|Google|Aide|Confidentialité/i); // la synchronisation de biens et logements existe désormais (Compte et synchronisation) ; ni partage, ni notifications
  });
});

describe('Entrées visibles hors périmètre V1', () => {
  const visibleScreens = [
    'features/home/screens/HomeScreen.tsx',
    'features/profile/screens/ProfileScreen.tsx',
    'features/tools/screens/MesOutilsScreen.tsx',
    'features/tools/screens/CatalogueScreen.tsx',
    'features/activity/screens/ActivityScreen.tsx',
    'features/tontines/screens/TontineSpaceScreen.tsx',
    'components/navigation/BottomTabBar.tsx',
  ];

  it('les écrans de la navigation V1 ne renvoient ni vers Factures simples, ni Scanner, ni Statistiques globales, ni Formulaires, ni Dossiers', () => {
    for (const file of visibleScreens) {
      const src = read(file);
      expect(src).not.toMatch(/'\/factures'|\/scan'|\/statistics|\(tabs\)\/statistiques|\/form\/|'\/records|\(tabs\)\/modeles|create-menu/);
    }
  });

  it('les routes et fichiers gelés restent en place', () => {
    for (const file of ['app/factures/index.tsx', 'app/factures/new.tsx', 'app/scan.tsx', 'app/statistics.tsx', 'app/(tabs)/statistiques.tsx', 'app/(tabs)/modeles.tsx', 'app/(tabs)/forms.tsx', 'app/form/index.tsx', 'app/records/index.tsx', 'app/account/security.tsx', 'app/notifications/settings.tsx', 'app/account/appearance.tsx']) {
      expect(exists(file)).toBe(true);
    }
  });

  it('le moteur de facturation et les routes internes CEET/TDE sont toujours là', () => {
    for (const file of [
      'services/facturesService.ts', 'services/utilityBillingService.ts', 'services/utilityParticipantsService.ts', 'services/utilityOverviewService.ts', 'services/utilityLegacyService.ts',
      'app/ceet/index.tsx', 'app/ceet/participants.tsx', 'app/ceet/releves.tsx', 'app/ceet/historique.tsx', 'app/ceet/anciens-releves.tsx',
      'app/tde/index.tsx', 'app/tde/participants.tsx', 'app/tde/releves.tsx', 'app/tde/historique.tsx', 'app/tde/anciens-releves.tsx',
      'app/factures/facture-partagee-new.tsx', 'app/factures/releves.tsx',
    ]) {
      expect(exists(file)).toBe(true);
    }
    expect(read('features/utilities/screens/UtilityDashboardScreen.tsx')).toContain('/factures/facture-partagee-new'); // le calcul reste accessible depuis CEET/TDE
  });
});
