// « + » de Mes Outils : trois raccourcis distincts qui mènent aux vrais parcours, sans fonction fictive.

import fs from 'fs';
import path from 'path';
import { ADD_SHORTCUTS, CAMERA_PERMISSION, shortcutAvailability, visibleShortcuts } from '../shortcutService';

const root = path.join(__dirname, '..', '..');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const routeFile = (route: string) => {
  const base = `app${route}`;
  return [`${base}.tsx`, `${base}/index.tsx`].find(exists);
};

describe('Raccourcis du « + »', () => {
  it('Formulaire, Scanner, Catalogue — chacun avec une icône, un titre, une description', () => {
    expect(ADD_SHORTCUTS.map((s) => s.title)).toEqual(['Formulaire', 'Scanner', 'Catalogue']);
    for (const s of ADD_SHORTCUTS) {
      expect(s.icon).toBeTruthy();
      expect(s.description.length).toBeGreaterThan(10);
    }
  });

  it('chaque raccourci mène à une route qui existe (aucun écran cassé)', () => {
    for (const s of ADD_SHORTCUTS) expect(routeFile(s.route)).toBeTruthy();
    expect(ADD_SHORTCUTS.find((s) => s.id === 'catalogue')!.route).toBe('/mes-outils/catalogue');
    expect(ADD_SHORTCUTS.find((s) => s.id === 'formulaire')!.route).toBe('/form/new');
    expect(ADD_SHORTCUTS.find((s) => s.id === 'scanner')!.route).toBe('/scan');
  });

  it('le Scanner est annoncé indisponible quand la caméra Android est bloquée, jamais présenté comme fonctionnel', () => {
    const scanner = ADD_SHORTCUTS.find((s) => s.id === 'scanner')!;
    expect(shortcutAvailability(scanner, 'android', [CAMERA_PERMISSION, 'android.permission.RECORD_AUDIO']).available).toBe(false);
    expect(shortcutAvailability(scanner, 'android', [CAMERA_PERMISSION]).reason).toMatch(/Indisponible/);
    expect(shortcutAvailability(scanner, 'android', []).available).toBe(true);
    expect(shortcutAvailability(scanner, 'ios', [CAMERA_PERMISSION]).available).toBe(true);
    const form = ADD_SHORTCUTS.find((s) => s.id === 'formulaire')!;
    expect(shortcutAvailability(form, 'android', [CAMERA_PERMISSION]).available).toBe(true);
  });

  it('V1 : le Scanner n’est PAS proposé tant que la caméra est bloquée (Formulaire et Catalogue restent) ; il réapparaît si la caméra est autorisée ; iOS inchangé', () => {
    expect(visibleShortcuts('android', [CAMERA_PERMISSION]).map((s) => s.title)).toEqual(['Formulaire', 'Catalogue']);
    expect(visibleShortcuts('android', []).map((s) => s.title)).toEqual(['Formulaire', 'Scanner', 'Catalogue']);
    expect(visibleShortcuts('ios', [CAMERA_PERMISSION]).map((s) => s.title)).toEqual(['Formulaire', 'Scanner', 'Catalogue']);
    // l'écran n'affiche que les raccourcis visibles, et aucun autre parcours n'ouvre le scanner (le code est conservé, rien n'est supprimé)
    expect(read('features/tools/screens/AddShortcutsScreen.tsx')).toContain('visibleShortcuts(Platform.OS, blocked)');
    expect(exists('features/qr/screens/ScanScreen.tsx')).toBe(true);
    expect(exists('app/scan.tsx')).toBe(true);
  });

  it('aucune autre fonction ne dépend de la caméra : seuls l’écran du scanner et son cadre utilisent expo-camera ; les photos passent par la bibliothèque, jamais par la caméra', () => {
    const sources = ['features', 'components', 'app', 'services'].flatMap((dir) => {
      const out: string[] = [];
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
          const rel = `${d}/${entry.name}`;
          if (entry.isDirectory()) walk(rel);
          else if (/.(ts|tsx)$/.test(entry.name) && !rel.includes('__tests__')) out.push(rel);
        }
      };
      walk(dir);
      return out;
    });
    const usingCamera = sources.filter((file) => /expo-camera|launchCameraAsync|requestCameraPermissionsAsync/.test(read(file)));
    expect(usingCamera).toEqual(['features/qr/screens/ScanScreen.tsx']);
  });

  it('la configuration actuelle bloque bien la caméra Android (donc le Scanner s’annonce indisponible)', () => {
    expect(JSON.parse(read('app.json')).expo.android.blockedPermissions).toContain(CAMERA_PERMISSION);
  });

  it('le système d’installation du catalogue n’est pas touché', () => {
    expect(exists('app/mes-outils/catalogue.tsx')).toBe(true);
    expect(read('features/tools/screens/MesOutilsScreen.tsx')).toContain('hideTool');
    expect(read('features/tools/screens/MesOutilsScreen.tsx')).toContain('restoreTool');
  });
});
