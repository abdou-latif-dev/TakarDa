// Étape 9B — design system TakarDa (maquettes Stitch) : jetons de couleur, contrastes, en-tête de l'accueil.
// Les couleurs viennent d'UN seul endroit (constants/theme.ts) ; ces tests figent le contrat et les contrastes.

import fs from 'fs';
import path from 'path';
import { DARK_COLORS, ERROR_TEXT_ON_CONTAINER, getStatusColors, getThemeVariables, LIGHT_COLORS } from '@/constants/theme';
import { greetingName } from '../profileService';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('Jetons de couleur', () => {
  it('couleur primaire #1F03A8, canvas gris clair, cartes blanches, bordures fines', () => {
    expect(LIGHT_COLORS.primary).toBe('#1F03A8');
    expect(LIGHT_COLORS.primaryDark).toBe('#170282'); // état pressé du design system
    expect(LIGHT_COLORS.background).toBe('#F8FAFC');
    expect(LIGHT_COLORS.surface).toBe('#FFFFFF');
    expect(LIGHT_COLORS.border).toBe('#E2E8F0');
    expect(LIGHT_COLORS.textPrimary).toBe('#0F172A');
    expect(LIGHT_COLORS.textSecondary).toBe('#475569');
  });

  it('les classes Tailwind héritent du même jeton (variable --td-primary = #1F03A8)', () => {
    expect(getThemeVariables('light')['--td-primary']).toBe('31 3 168');
    expect(read('tailwind.config.js')).toContain("DEFAULT: 'rgb(var(--td-primary) / <alpha-value>)'"); // pas de seconde couleur primaire
  });

  it('aucune ancienne couleur monochrome ne subsiste dans le code des écrans et composants', () => {
    for (const dir of ['components', 'features', 'app']) {
      const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
      for (const file of walk(dir)) expect(read(file)).not.toMatch(/#171717/i);
    }
  });
});

describe('Contrastes (WCAG)', () => {
  it('texte blanc sur le violet primaire et violet sur blanc : très lisibles', () => {
    expect(contrast(LIGHT_COLORS.textOnPrimary, LIGHT_COLORS.primary)).toBeGreaterThanOrEqual(7);
    expect(contrast(LIGHT_COLORS.primary, LIGHT_COLORS.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(LIGHT_COLORS.primary, LIGHT_COLORS.background)).toBeGreaterThanOrEqual(7);
  });

  it('texte principal et secondaire lisibles sur le canvas, les cartes et les pastilles teintées', () => {
    for (const bg of [LIGHT_COLORS.background, LIGHT_COLORS.surface]) {
      expect(contrast(LIGHT_COLORS.textPrimary, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(LIGHT_COLORS.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LIGHT_COLORS.textMuted, bg)).toBeGreaterThanOrEqual(4.5); // texte discret (« À payer », dates…)
    }
    expect(contrast(LIGHT_COLORS.primary, LIGHT_COLORS.primarySoft)).toBeGreaterThanOrEqual(7);
  });

  it('badges payé / en attente / en retard : texte lisible sur leur fond teinté', () => {
    const palette = getStatusColors('light');
    for (const key of ['paid', 'pending', 'late', 'validated', 'rejected', 'active'] as const) {
      expect(contrast(palette[key].text, palette[key].bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(palette.paid.bg).toBe('#ECFDF5');
    expect(palette.pending.bg).toBe('#FFFBEB');
    expect(palette.late.bg).toBe('#FEF2F2');
  });

  it('succès et avertissement (utilisés comme texte de statut) : au moins 4,5:1 sur les cartes blanches et le canvas', () => {
    for (const bg of [LIGHT_COLORS.surface, LIGHT_COLORS.background]) {
      expect(contrast(LIGHT_COLORS.success, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LIGHT_COLORS.warning, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(LIGHT_COLORS.warning, LIGHT_COLORS.warningContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT_COLORS.success, LIGHT_COLORS.successContainer)).toBeGreaterThanOrEqual(4.5);
  });

  it('rouge d’erreur : lisible sur les cartes blanches ; sur son fond teinté, le texte utilise le rouge plus foncé (bouton destructif, badges)', () => {
    expect(contrast(LIGHT_COLORS.error, LIGHT_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ERROR_TEXT_ON_CONTAINER, LIGHT_COLORS.errorContainer)).toBeGreaterThanOrEqual(4.5);
    expect(read('components/ui/Button.tsx')).toContain('Colors.errorOnContainer');
    expect(contrast(DARK_COLORS.errorOnContainer, DARK_COLORS.errorContainer)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Typographie et composants partagés', () => {
  it('Manrope partout : les alias « inter* » pointent vers les graisses Manrope', () => {
    const tw = read('tailwind.config.js');
    expect(tw).toMatch(/inter: \['Manrope_400Regular'\]/);
    expect(tw).toMatch(/'inter-medium': \['Manrope_500Medium'\]/);
    expect(tw).toMatch(/'inter-semibold': \['Manrope_600SemiBold'\]/);
    expect(read('app/_layout.tsx')).toContain('Manrope_600SemiBold'); // les graisses sont bien chargées au démarrage
  });

  it('boutons de 48 px, rayon 12 ; destructif en rouge clair ; champs de 48 px', () => {
    const button = read('components/ui/Button.tsx');
    expect(button).not.toMatch(/52px/);
    expect(button).toContain('h-12');
    expect(button).not.toContain('rounded-xl');
    expect(button).toContain('bg-error-container');
    expect(read('components/ui/TextField.tsx')).toContain('h-12 flex-row');
  });

  it('barre d’onglets blanche, toujours à quatre onglets', () => {
    const bar = read('components/navigation/BottomTabBar.tsx');
    expect(bar).toContain('bg-surface');
    expect([...bar.matchAll(/^\s+(\w+): \{ label: '([^']+)'/gm)].map((m) => m[2])).toEqual(['Accueil', 'Mes Outils', 'Activités', 'Profil']);
  });

  it('thème sombre réactivé : le thème actif suit le réglage Clair / Sombre / Système', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("mode === 'system' ? (colorScheme === 'dark' ? 'dark' : 'light') : mode");
    expect(layout).not.toContain("(true as boolean) ? 'light' : 'dark'");
    expect(JSON.parse(read('app.json')).expo.userInterfaceStyle).toBe('automatic'); // nécessaire pour suivre le téléphone
    expect(read('components/ui/StatusBadge.tsx')).toContain("getStatusColors(colorScheme === 'dark' ? 'dark' : 'light')");
    expect(read('components/ui/StatusBadge.tsx')).not.toContain("getStatusColors('light')");
    expect(read('services/profileService.ts')).toContain("route: '/account/appearance'");
  });

  it('avatar : initiales (couleur « sur accent ») sur violet plein avec `solid`, teinte douce sinon', () => {
    const avatar = read('components/ui/Avatar.tsx');
    expect(avatar).toMatch(/solid \? 'bg-primary' : 'bg-primary-soft'/);
    expect(avatar).toContain('solid ? Colors.textOnPrimary : Colors.primaryDark');
  });
});

describe('En-tête de l’accueil', () => {
  it('affiche le prénom (premier mot), « Vous » à défaut ; un nom très long reste un seul mot, tronqué par l’interface', () => {
    expect(greetingName({ name: 'Abdou-latif Tagba' })).toBe('Abdou-latif');
    expect(greetingName({ name: '  Awa   Kossi ' })).toBe('Awa');
    expect(greetingName({ name: 'Maximilienne-Alexandrine-Constance' })).toBe('Maximilienne-Alexandrine-Constance');
    expect(greetingName({ name: '' })).toBe('Vous');
    expect(greetingName(null)).toBe('Vous');
  });

  it('une seule ligne : avatar (photo ou initiales), « Bonjour, » + nom tronqué, cloche à droite centrée verticalement', () => {
    const header = read('features/home/components/HomeHeader.tsx');
    expect(header).toContain('flex-row items-center gap-3');
    expect(header).toContain('<Avatar solid');
    expect(header).toContain('uri={view.avatarUri}'); // photo locale si disponible, sinon initiales
    expect(header).toMatch(/numberOfLines=\{1\}/);
    expect(header).toContain('min-w-0'); // empêche tout débordement sur 375 px
    expect(header).toContain('Bonjour, ');
    expect(header).toContain('greetingName(user)');
    expect(header.indexOf('<Avatar')).toBeLessThan(header.indexOf('notifications-none')); // la cloche vient après, à droite
    expect(read('features/home/screens/HomeScreen.tsx')).toContain('<HomeHeader />');
  });

  it('la cloche ouvre l’écran Notifications existant ; la pastille ne vient que de notifications réelles non lues', () => {
    const header = read('features/home/components/HomeHeader.tsx');
    expect(header).toContain("router.push('/notifications'");
    expect(header).toMatch(/unreadCount > 0 &&/);
    expect(header).not.toMatch(/useState|setTimeout|Math\.random/); // aucune valeur inventée
    expect(fs.existsSync(path.join(root, 'app/notifications/index.tsx'))).toBe(true);
    expect(read('features/notifications/screens/NotificationsScreen.tsx')).toContain('Tout est à jour');
    expect(read('store/notificationStore.ts')).toContain('notificationService.list()');
  });

  it('aucune fausse notification : aucun service ne crée de notification en V1', () => {
    const services = fs.readdirSync(path.join(root, 'services')).filter((f) => f.endsWith('.ts'));
    for (const file of services) expect(read(`services/${file}`)).not.toMatch(/notifications\.(push|unshift)\(/);
  });
});

describe('Thème sombre (maquettes Stitch)', () => {
  it('fond noir, cartes #1C1C1E, accent indigo clair, mêmes clés que le thème clair', () => {
    expect(DARK_COLORS.background).toBe('#000000');
    expect(DARK_COLORS.surface).toBe('#1C1C1E');
    expect(DARK_COLORS.primary).toBe('#818CF8');
    expect(Object.keys(DARK_COLORS).sort()).toEqual(Object.keys(LIGHT_COLORS).sort());
    const light = getThemeVariables('light');
    const dark = getThemeVariables('dark');
    expect(Object.keys(dark)).toEqual(Object.keys(light));
    expect(dark['--td-background']).toBe('0 0 0');
  });

  it('contrastes sombres : textes, accent, texte sur accent, pastilles', () => {
    for (const bg of [DARK_COLORS.background, DARK_COLORS.surface]) {
      expect(contrast(DARK_COLORS.textPrimary, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(DARK_COLORS.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS.primary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS.success, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS.warning, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS.error, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(DARK_COLORS.textOnPrimary, DARK_COLORS.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK_COLORS.primary, DARK_COLORS.primarySoft)).toBeGreaterThanOrEqual(4.5);
    const palette = getStatusColors('dark');
    for (const key of ['paid', 'pending', 'late', 'validated', 'rejected', 'active', 'inactive'] as const) {
      expect(contrast(palette[key].text, palette[key].bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cartes arrondies (22 px) à bordure fine et ombre douce, comme les maquettes', () => {
    const tw = read('tailwind.config.js');
    expect(tw).toContain("lg: '22px'");
    expect(tw).toContain("xl: '24px'");
    expect(read('components/ui/Card.tsx')).toContain('rounded-lg border border-border');
  });

  it('aucun texte blanc codé en dur sur les fonds d’accent : il suit le thème', () => {
    for (const file of ['components/ui/Avatar.tsx', 'components/ui/Chip.tsx', 'features/home/components/HomeHeader.tsx']) {
      expect(read(file)).not.toContain('text-white');
      expect(read(file)).toContain('Colors.textOnPrimary'); // en style (pas en classe : une classe de couleur est écrasée par celle du composant de texte)
    }
  });
});

describe('Changement de thème en direct (Android et web)', () => {
  it('la navigation est remontée quand le thème change, pour que les couleurs lues dans Colors se rafraîchissent', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('<Stack key={activeScheme}');
    expect(layout).toContain('SystemUI.setBackgroundColorAsync');
  });

  it('une classe de couleur passée à un composant de texte remplace sa couleur par défaut', () => {
    const typography = read('components/ui/Typography.tsx');
    expect(typography).toContain('COLOR_CLASS');
    expect(typography).toContain('replace(COLOR_CLASS');
    expect(typography).toContain('replace(SIZE_CLASS');
  });

  it('la barre d’onglets colore l’onglet actif avec l’accent du thème et garde les 4 onglets', () => {
    const bar = read('components/navigation/BottomTabBar.tsx');
    expect(bar).toContain('Colors.primary');
    expect(bar).toContain('text-primary');
    expect(bar).toContain('bg-surface');
  });
});

describe('Variables de thème sur Android', () => {
  it('les variables --td-* sont posées sur une View React Native (NativeWind ignore vars() sur un composant tiers)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/<View style=\{\[\{ flex: 1 \}, vars\(getThemeVariables\(activeScheme\)\)\]\}>/);
    expect(layout).not.toMatch(/<GestureHandlerRootView style=\{\[/);
  });
});

describe('Hiérarchie des boutons', () => {
  it('le bouton secondaire est « tonal » (fond teinté de l’accent, texte d’accent), jamais du texte nu', () => {
    const button = read('components/ui/Button.tsx');
    const secondary = button.slice(button.indexOf('export function SecondaryButton'), button.indexOf('export function DestructiveButton'));
    expect(secondary).toContain('bg-primary-soft');
    expect(secondary).toContain('border-primary/20');
    expect(secondary).toContain('color: Colors.primary');
    expect(secondary).not.toContain('bg-surface');
  });

  it('l’action d’un état vide est un bouton plein (action principale)', () => {
    expect(read('components/ui/States.tsx')).toContain('<PrimaryButton label={actionLabel}');
  });

  it('le texte tonal reste lisible dans les deux thèmes', () => {
    expect(contrast(LIGHT_COLORS.primary, LIGHT_COLORS.primarySoft)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK_COLORS.primary, DARK_COLORS.primarySoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK_COLORS.textOnPrimary, DARK_COLORS.primary)).toBeGreaterThanOrEqual(4.5);
  });
});
