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

export const Colors = {
  primary: '#171717',
  primaryDark: '#000000',
  primaryLight: '#595959',
  primarySoft: '#F0F0F0',

  background: '#FFFFFF',
  backgroundSecondary: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceContainer: '#EEEEEE',
  surfaceContainerHigh: '#E0E0E0',
  border: '#E5E5E5',

  textPrimary: '#171717',
  textSecondary: '#666666',
  textMuted: '#9A9A9A',
  textOnPrimary: '#FFFFFF',

  success: '#2E7D32',
  successContainer: '#E6F4EA',
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  warning: '#B45309',
  warningContainer: '#FEF3C7',
  info: '#006399',
  infoContainer: '#CDE5FF',

  skeleton: '#EEEEEF',
  emptyIcon: '#DADADB',
} as const;

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

export const defaultTheme: ThemeTokens = {
  background: Colors.background,
  backgroundSecondary: Colors.backgroundSecondary,
  surface: Colors.surface,
  surfaceContainer: Colors.surfaceContainer,
  border: Colors.border,
  textPrimary: Colors.textPrimary,
  textSecondary: Colors.textSecondary,
  accent: Colors.primary,
  accentDark: Colors.primaryDark,
  accentSoft: Colors.primarySoft,
  success: Colors.success,
  warning: Colors.warning,
  danger: Colors.error,
};

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
  lg: 16,
  xl: 20,
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

export const StatusColors: Record<StatusKind, { bg: string; text: string; label: string }> = {
  paid: { bg: Colors.successContainer, text: '#137333', label: 'Payé' },
  pending: { bg: Colors.surfaceContainer, text: Colors.textSecondary, label: 'En attente' },
  late: { bg: Colors.errorContainer, text: '#93000A', label: 'En retard' },
  active: { bg: Colors.primary, text: Colors.textOnPrimary, label: 'Actif' },
  inactive: { bg: Colors.surfaceContainer, text: Colors.textSecondary, label: 'Inactif' },
  validated: { bg: Colors.successContainer, text: '#137333', label: 'Validé' },
  rejected: { bg: Colors.errorContainer, text: '#93000A', label: 'Rejeté' },
};
