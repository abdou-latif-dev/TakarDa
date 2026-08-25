/**
 * FormEase design tokens — mirrors tailwind.config.js.
 * Use these for values NativeWind className strings can't express
 * (SVG props, chart colors, dynamic style objects, Stack screen options).
 */

export const Colors = {
  primary: '#FF7A00',
  primaryDark: '#994700',
  primaryLight: '#FFB68B',
  primarySoft: '#FFF1E5',

  background: '#FFFFFF',
  backgroundSecondary: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceContainer: '#F0F0F2',
  surfaceContainerHigh: '#E8E8E9',
  border: '#EDEDEF',

  textPrimary: '#171717',
  textSecondary: '#6B6B6B',
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
