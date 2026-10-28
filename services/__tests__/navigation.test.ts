// Phase 6 — navigation principale : Accueil · Mes Outils · Activités · Profil.
// Ces vérifications portent sur la structure (layout, routes, liens) : Jest ne rend pas d'écran
// dans ce projet. Le comportement des outils (installer, masquer, restaurer) est couvert par
// toolRegistry.test.ts, celui du journal par activity.test.ts.

import fs from 'fs';
import path from 'path';
import { getCatalogModels } from '../toolCatalogService';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

const layout = read('app/(tabs)/_layout.tsx');
const screens = [...layout.matchAll(/<Tabs\.Screen name="(\w+)"([^/]*)\/>/g)].map((m) => ({ name: m[1], hidden: /href:\s*null/.test(m[2]) }));

describe('Barre de navigation', () => {
  it('exactement quatre onglets visibles : Accueil, Mes Outils, Activités, Profil (dans cet ordre)', () => {
    expect(screens.filter((s) => !s.hidden).map((s) => s.name)).toEqual(['index', 'outils', 'activity', 'profile']);

    const meta = read('components/navigation/BottomTabBar.tsx');
    const labels = [...meta.matchAll(/^\s+(\w+): \{ label: '([^']+)'/gm)].map((m) => [m[1], m[2]]);
    expect(labels).toEqual([
      ['index', 'Accueil'],
      ['outils', 'Mes Outils'],
      ['activity', 'Activités'],
      ['profile', 'Profil'],
    ]);
  });

  it('plus de « + » central ni d’onglets Modèles / Stats / Tontines / Formulaires dans la barre', () => {
    const bar = read('components/navigation/BottomTabBar.tsx');
    expect(bar).not.toContain('create-menu');
    expect(bar).not.toMatch(/create|modeles|statistiques|tontines|forms/);
    expect(screens.filter((s) => s.hidden).map((s) => s.name).sort()).toEqual(['create', 'forms', 'modeles', 'statistiques', 'tontines']);
  });

  it('aucune route déclarée ne manque, et aucun fichier de route n’est oublié du layout (rien n’est supprimé)', () => {
    for (const s of screens) expect(exists(`app/(tabs)/${s.name}.tsx`)).toBe(true);
    const files = fs.readdirSync(path.join(root, 'app/(tabs)')).filter((f) => f.endsWith('.tsx') && f !== '_layout.tsx').map((f) => f.replace('.tsx', ''));
    expect(files.sort()).toEqual(screens.map((s) => s.name).sort());
  });
});

describe('Mes Outils', () => {
  it('est l’onglet « Mes Outils » : le « + » de l’en-tête ouvre l’écran de raccourcis (Formulaire, Scanner, Catalogue) et ne crée rien directement', () => {
    expect(read('app/(tabs)/outils.tsx')).toMatch(/MesOutilsScreen[\s\S]*variant="tab"/);
    const screen = read('features/tools/screens/MesOutilsScreen.tsx');
    expect(screen).toContain('title="Mes Outils"');
    expect(screen).toMatch(/trailing=\{<IconButton icon="add" onPress=\{\(\) => router\.push\('\/mes-outils\/ajouter'/);
    for (const direct of ['/tontine/create', '/immobilier/new', '/factures']) expect(screen).not.toContain(direct);
    expect(exists('app/mes-outils/catalogue.tsx')).toBe(true);
    expect(exists('app/mes-outils/ajouter.tsx')).toBe(true);
  });

  it('s’appuie sur le registre de la Phase 4 (aucun second système d’installation)', () => {
    const screen = read('features/tools/screens/MesOutilsScreen.tsx');
    for (const fn of ['getMyTools', 'ensureInstalledTools', 'hideTool', 'restoreTool']) expect(screen).toContain(fn);
    expect(read('features/tools/screens/CatalogueScreen.tsx')).toContain('installTool');
    expect(read('app/mes-outils/index.tsx')).toContain('/(tabs)/outils'); // l'ancienne route mène à l'onglet
  });

  it('le catalogue V1 ne contient toujours pas les anciens modèles', () => {
    expect(getCatalogModels().map((m) => m.key)).toEqual(['immobilier', 'tontine', 'ceet', 'tde', 'commerce']);
  });
});

describe('Modules : leurs espaces restent accessibles', () => {
  it('chaque outil installable ouvre un écran qui existe (Tontine → /tontine, pas son formulaire)', () => {
    for (const model of getCatalogModels().filter((m) => m.installable)) {
      expect(model.route).toBeTruthy();
      expect(exists(`app${model.route}/index.tsx`)).toBe(true);
    }
    expect(getCatalogModels().find((m) => m.key === 'tontine')!.route).toBe('/tontine');
    expect(exists('app/tontine/create.tsx')).toBe(true); // la création reste accessible…
    expect(read('features/tontines/screens/TontineSpaceScreen.tsx')).toContain("router.push('/tontine/create')"); // …depuis l'espace Tontine
  });

  it('les routes internes des modules sont conservées', () => {
    for (const route of ['ceet/participants', 'ceet/releves', 'ceet/historique', 'tde/participants', 'tde/releves', 'immobilier/new', 'factures/facture-partagee-new', 'factures/releves', 'group/[groupId]/tontine/index']) {
      expect(exists(`app/${route}.tsx`)).toBe(true);
    }
  });
});

describe('Anciens points d’entrée', () => {
  it('l’accueil, le profil et les écrans de liaison ne renvoient plus vers l’onglet Modèles', () => {
    expect(read('features/home/screens/HomeScreen.tsx')).not.toContain('(tabs)/modeles');
    // Phase 7 : l'onglet Mes Outils suffit, l'accueil n'en garde plus de raccourci générique (il liste les outils installés).
    expect(read('features/home/screens/HomeScreen.tsx')).not.toContain('(tabs)/outils');
    expect(read('features/profile/screens/ProfileScreen.tsx')).not.toContain('(tabs)/modeles');
    // Phase 8 : les entrées du Profil sont définies dans profileService (PROFILE_ENTRIES) ; Mes Outils y mène toujours à l'onglet.
    expect(read('features/profile/screens/ProfileScreen.tsx')).toContain('PROFILE_ENTRIES');
    expect(read('services/profileService.ts')).toContain('(tabs)/outils');
    expect(read('features/models/screens/MesModelesScreen.tsx')).not.toContain('create-menu');
  });

  it('plus aucun lien ne tombe directement sur un formulaire de création quand un espace existe', () => {
    const menu = read('features/home/screens/CreateMenuModal.tsx');
    for (const direct of ['/tontine/create', '/immobilier/new', '/factures/new', 'form/templates']) expect(menu).not.toContain(direct);
    expect(menu).toContain("href: '/tontine'");
    expect(read('features/activity/screens/CreateActivityScreen.tsx')).not.toContain('/tontine/create');
  });
});

describe('Ouvrir un écran n’enregistre aucune activité', () => {
  it('les écrans de navigation ne contiennent aucun appel à recordActivity', () => {
    for (const file of [
      'features/tools/screens/MesOutilsScreen.tsx',
      'features/tools/screens/CatalogueScreen.tsx',
      'features/activity/screens/ActivityScreen.tsx',
      'features/home/screens/HomeScreen.tsx',
      'features/profile/screens/ProfileScreen.tsx',
      'components/navigation/BottomTabBar.tsx',
    ]) {
      expect(read(file)).not.toContain('recordActivity');
    }
  });

  it('l’écran Activités garde sa source de données et ses filtres', () => {
    const screen = read('features/activity/screens/ActivityScreen.tsx');
    expect(screen).toContain('title="Activités"');
    for (const part of ['useActivityStore', 'selectRecentActivities', 'groupActivitiesByDay', 'activityModule']) expect(screen).toContain(part);
  });
});
