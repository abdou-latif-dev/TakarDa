/**
 * TakarDa design tokens — mirrors tailwind.config.js.
 * Use these for values NativeWind className strings can't express
 * (SVG props, chart colors, dynamic style objects, Stack screen options).
 *
 * `primary*` is the ACCENT — the one color the whole app is allowed to vary
 * (a future "Apparence" screen would let a user pick a different accent; see
 * store/themeStore.ts for the persisted preference this points to). Every
 * other token is a neutral (monochrome scale) or a semantic feedback color
 * (success/error/warning/info) that must stay fixed regardless of accent —
 * a red error and a green success need to read as red/green no matter what
 * the user's chosen brand color is. No module (Factures, Immobilier, ...)
 * may hardcode its own color literal — see the "Étape 2" report for the one
 * instance (Factures' StatusDefinition) that used to and was fixed.
 */

// Palette TakarDa (maquettes Stitch « iPhone redesign » + design system 9B) : violet profond #1F03A8 réservé aux
// actions, à l'état actif et aux liens ; canvas slate très clair avec des cartes blanches à bordure fine ; encre navy.
// Mode sombre : fond noir, cartes #1C1C1E à bordure discrète, accent indigo clair. Les couleurs sont ici, à UN seul
// endroit : classes Tailwind (variables --td-*) et composants natifs (Colors) en héritent.
export const LIGHT_COLORS = {
  primary: '#1F03A8',
  primaryDark: '#170282', // état actif / pressé
  primaryLight: '#504AD3',
  primarySoft: '#EEF0FF', // fond teinté des pastilles d'icône et des sélections
  onPrimary: '#FFFFFF',

  background: '#F8FAFC',
  backgroundSecondary: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceContainer: '#F1F5F9',
  surfaceContainerHigh: '#E2E8F0',
  border: '#E2E8F0',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',

  success: '#047857',
  successContainer: '#ECFDF5',
  error: '#DC2626',
  errorContainer: '#FEF2F2',
  errorOnContainer: '#B91C1C', // texte rouge posé SUR errorContainer (#DC2626 n'y atteint que 4,4:1)
  warning: '#B45309',
  warningContainer: '#FFFBEB',
  info: '#504AD3',
  infoContainer: '#E0E7FF',

  skeleton: '#E2E8F0',
  emptyIcon: '#CBD5E1',
};

/** Texte rouge posé SUR le fond teinté errorContainer (thème clair) : conservé pour compatibilité. */
export const ERROR_TEXT_ON_CONTAINER = LIGHT_COLORS.errorOnContainer;

export const DARK_COLORS = {
  primary: '#818CF8', primaryDark: '#A5B4FC', primaryLight: '#6366F1', primarySoft: '#26264F', onPrimary: '#0B0B1F',
  background: '#000000', backgroundSecondary: '#0A0A0C', surface: '#1C1C1E',
  surfaceContainer: '#2C2C2E', surfaceContainerHigh: '#3A3A3C', border: '#2C2C2E',
  textPrimary: '#FFFFFF', textSecondary: '#A1A1AA', textMuted: '#8E8E99', textOnPrimary: '#0B0B1F',
  success: '#34D399', successContainer: '#0B2E22', error: '#F87171', errorContainer: '#3B1416', errorOnContainer: '#FCA5A5',
  warning: '#FBBF24', warningContainer: '#33260A', info: '#818CF8', infoContainer: '#26264F',
  skeleton: '#2C2C2E', emptyIcon: '#71717A',
};

/** Mutable runtime palette for components that need native style colors (icons,
 * SVG, shadow colors, Stack screen options) — anything a NativeWind className
 * can't express, so it can't pick up the `--td-*` CSS variables the way
 * `bg-background`/`text-text-primary`/etc. do.
 *
 * IMPORTANT — this object is mutated in place, not replaced (existing code
 * holds a reference to `Colors` itself, e.g. `import { Colors } from
 * '@/constants/theme'` at module scope), so mutating it does NOT by itself
 * trigger a React re-render anywhere. It only reads correctly when
 * `setColorsForScheme` runs SYNCHRONOUSLY as part of the same render pass
 * that reacts to a scheme change — see app/_layout.tsx's `RootLayout`, which
 * calls it directly in the render body (not inside a `useEffect`) for exactly
 * this reason. Calling it from a `useEffect` was the root cause of Étape 4A's
 * dark-mode incoherence bug: colors would only refresh a render late, so a
 * component could keep showing the previous scheme's colors until something
 * unrelated happened to re-render it. */
export const Colors = { ...LIGHT_COLORS };
export type ColorScheme = 'light' | 'dark';
export function setColorsForScheme(scheme: ColorScheme) {
  Object.assign(Colors, scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS);
}

const toRgb = (hex: string) => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
};

/** CSS variables inherited by NativeWind classes across the complete app tree. */
export function getThemeVariables(scheme: ColorScheme): Record<`--${string}`, string> {
  const p = scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  return {
    '--td-primary': toRgb(p.primary), '--td-primary-dark': toRgb(p.primaryDark), '--td-primary-light': toRgb(p.primaryLight), '--td-primary-soft': toRgb(p.primarySoft), '--td-on-primary': toRgb(p.onPrimary),
    '--td-background': toRgb(p.background), '--td-background-secondary': toRgb(p.backgroundSecondary), '--td-surface': toRgb(p.surface),
    '--td-surface-container': toRgb(p.surfaceContainer), '--td-surface-container-high': toRgb(p.surfaceContainerHigh), '--td-border': toRgb(p.border),
    '--td-text-primary': toRgb(p.textPrimary), '--td-text-secondary': toRgb(p.textSecondary), '--td-text-muted': toRgb(p.textMuted),
    '--td-success': toRgb(p.success), '--td-success-container': toRgb(p.successContainer), '--td-error': toRgb(p.error), '--td-error-container': toRgb(p.errorContainer),
    '--td-warning': toRgb(p.warning), '--td-warning-container': toRgb(p.warningContainer), '--td-info': toRgb(p.info), '--td-info-container': toRgb(p.infoContainer),
    '--td-skeleton': toRgb(p.skeleton), '--td-empty-icon': toRgb(p.emptyIcon),
  };
}

/** Explicit shape of the token architecture — `Colors` above is the "default"
 * implementation of it. Kept separate from `Colors` (rather than typing
 * `Colors` itself) so a future alternate theme object can be checked against
 * the same contract without touching the working default. */
export interface ThemeTokens {
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceContainer: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
}

/** No consumer yet (verified during the Étape 4A theme audit) — kept as a
 * function of `scheme`, not a frozen object computed once at import time,
 * specifically so a future consumer can't silently inherit the same
 * always-light bug `StatusColors` had before this audit. */
export function getDefaultTheme(scheme: ColorScheme): ThemeTokens {
  const p = scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  return {
    background: p.background,
    backgroundSecondary: p.backgroundSecondary,
    surface: p.surface,
    surfaceContainer: p.surfaceContainer,
    border: p.border,
    textPrimary: p.textPrimary,
    textSecondary: p.textSecondary,
    accent: p.primary,
    accentDark: p.primaryDark,
    accentSoft: p.primarySoft,
    success: p.success,
    warning: p.warning,
    danger: p.error,
  };
}

/** Semantic keys a domain service can put on a StatusDefinition.color instead
 * of a raw hex — resolved against the live theme by the UI. Nothing renders
 * this yet (no screen currently colors a status chip from StatusDefinition.color),
 * but Immobilier/Factures already seed their statuses with these keys so the
 * wiring is a pure UI change whenever a screen wants it, never a data migration. */
export type SemanticColorKey = 'success' | 'warning' | 'danger' | 'accent' | 'muted';

export function resolveSemanticColor(key: string | undefined): string {
  switch (key as SemanticColorKey) {
    case 'success':
      return Colors.success;
    case 'warning':
      return Colors.warning;
    case 'danger':
      return Colors.error;
    case 'accent':
      return Colors.primary;
    case 'muted':
    default:
      return Colors.textMuted;
  }
}

export const Fonts = {
  displayLg: { fontFamily: 'Manrope_800ExtraBold', fontSize: 34, lineHeight: 42, letterSpacing: -0.6 },
  headlineMd: { fontFamily: 'Manrope_700Bold', fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  sectionTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 18, lineHeight: 24 },
  bodyLg: { fontFamily: 'Inter_400Regular', fontSize: 17, lineHeight: 24 },
  bodyMd: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  labelSm: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20 },
} as const;

export const Radius = {
  sm: 4,
  DEFAULT: 8,
  md: 12,
  lg: 22,
  xl: 24,
  full: 9999,
} as const;

export const Spacing = {
  unit: 4,
  pageMargin: 20,
  gutterCard: 16,
  stackSm: 8,
  stackMd: 16,
  stackLg: 24,
  touchTarget: 44,
} as const;

// Verified during the Étape 4A theme audit: no consumer anywhere in the app
// (every screen uses the equivalent `shadow-soft`/`shadow-soft-primary`
// NativeWind classes from tailwind.config.js instead, which are the live,
// CSS-variable-driven, theme-reactive ones). Left as dead code rather than
// reworked, to keep this pass scoped to the theme's real bugs — `softPrimary`
// below would have the exact same frozen-at-import-time bug as the old
// `StatusColors` if anything ever started reading it.
export const Shadows = {
  soft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  softPrimary: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

export type StatusKind = 'paid' | 'pending' | 'late' | 'active' | 'inactive' | 'validated' | 'rejected';

// `text` here is a text-on-container color, chosen for contrast against that
// state's `bg` — never the same value for light and dark (a dark-green text on
// a pale-green light background needs to become a pale-green text on a
// dark-green dark background, not stay dark-on-dark). These dark-mode values
// were validated in components/ui/StatusBadge.tsx before this audit folded
// them in here as the single source — StatusBadge no longer keeps its own copy.
const STATUS_PALETTE: Record<'light' | 'dark', Record<StatusKind, { bg: string; text: string }>> = {
  light: {
    // Payé / en attente / en retard : vert, ambre, rouge (design system), texte lisible sur le fond teinté.
    paid: { bg: LIGHT_COLORS.successContainer, text: '#047857' },
    pending: { bg: LIGHT_COLORS.warningContainer, text: '#B45309' },
    late: { bg: LIGHT_COLORS.errorContainer, text: LIGHT_COLORS.errorOnContainer },
    active: { bg: LIGHT_COLORS.primary, text: LIGHT_COLORS.textOnPrimary },
    inactive: { bg: LIGHT_COLORS.surfaceContainer, text: LIGHT_COLORS.textSecondary },
    validated: { bg: LIGHT_COLORS.successContainer, text: '#047857' },
    rejected: { bg: LIGHT_COLORS.errorContainer, text: LIGHT_COLORS.errorOnContainer },
  },
  dark: {
    paid: { bg: DARK_COLORS.successContainer, text: '#6EE7B7' },
    pending: { bg: DARK_COLORS.warningContainer, text: '#FCD34D' },
    late: { bg: DARK_COLORS.errorContainer, text: DARK_COLORS.errorOnContainer },
    active: { bg: DARK_COLORS.primary, text: DARK_COLORS.textOnPrimary },
    inactive: { bg: DARK_COLORS.surfaceContainer, text: DARK_COLORS.textSecondary },
    validated: { bg: DARK_COLORS.successContainer, text: '#6EE7B7' },
    rejected: { bg: DARK_COLORS.errorContainer, text: DARK_COLORS.errorOnContainer },
  },
};

const STATUS_LABELS: Record<StatusKind, string> = {
  paid: 'Payé', pending: 'En attente', late: 'En retard', active: 'Actif',
  inactive: 'Inactif', validated: 'Validé', rejected: 'Rejeté',
};

/** Was a frozen `StatusColors` object computed once at import time — always
 * light, forever, even in dark mode (a real bug found during the Étape 4A
 * theme audit). Now a function of the actual scheme, the same shape as
 * `getThemeVariables`/`getDefaultTheme`. */
export function getStatusColors(scheme: ColorScheme): Record<StatusKind, { bg: string; text: string; label: string }> {
  const palette = STATUS_PALETTE[scheme];
  const result = {} as Record<StatusKind, { bg: string; text: string; label: string }>;
  (Object.keys(STATUS_LABELS) as StatusKind[]).forEach((key) => {
    result[key] = { ...palette[key], label: STATUS_LABELS[key] };
  });
  return result;
}
