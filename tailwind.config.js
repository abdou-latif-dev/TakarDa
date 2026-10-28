/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './features/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Accent — the one color allowed to vary (see constants/theme.ts's
        // header comment). Everything else here is a fixed neutral or a
        // fixed semantic feedback color.
        primary: { DEFAULT: 'rgb(var(--td-primary) / <alpha-value>)', dark: 'rgb(var(--td-primary-dark) / <alpha-value>)', light: 'rgb(var(--td-primary-light) / <alpha-value>)', soft: 'rgb(var(--td-primary-soft) / <alpha-value>)', on: 'rgb(var(--td-on-primary) / <alpha-value>)' },
        background: 'rgb(var(--td-background) / <alpha-value>)',
        'background-secondary': 'rgb(var(--td-background-secondary) / <alpha-value>)',
        surface: 'rgb(var(--td-surface) / <alpha-value>)',
        'surface-container': 'rgb(var(--td-surface-container) / <alpha-value>)',
        'surface-container-high': 'rgb(var(--td-surface-container-high) / <alpha-value>)',
        border: 'rgb(var(--td-border) / <alpha-value>)',
        text: {
          primary: 'rgb(var(--td-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--td-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--td-text-muted) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--td-success) / <alpha-value>)',
          container: 'rgb(var(--td-success-container) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'rgb(var(--td-error) / <alpha-value>)',
          container: 'rgb(var(--td-error-container) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--td-warning) / <alpha-value>)',
          container: 'rgb(var(--td-warning-container) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--td-info) / <alpha-value>)',
          container: 'rgb(var(--td-info-container) / <alpha-value>)',
        },
        skeleton: 'rgb(var(--td-skeleton) / <alpha-value>)',
        'empty-icon': 'rgb(var(--td-empty-icon) / <alpha-value>)',
      },
      fontFamily: {
        manrope: ['Manrope_400Regular'],
        'manrope-medium': ['Manrope_500Medium'],
        'manrope-semibold': ['Manrope_600SemiBold'],
        'manrope-bold': ['Manrope_700Bold'],
        'manrope-extrabold': ['Manrope_800ExtraBold'],
        // Design system Stitch : Manrope partout. Les anciens noms « inter* » (utilisés dans tout le code) pointent
        // maintenant vers les graisses Manrope équivalentes — un seul endroit à changer.
        inter: ['Manrope_400Regular'],
        'inter-medium': ['Manrope_500Medium'],
        'inter-semibold': ['Manrope_600SemiBold'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '22px',
        xl: '24px',
      },
      spacing: {
        'page-margin': '20px',
        'gutter-card': '16px',
        touch: '44px',
      },
      boxShadow: {
        // Neutral black — reads reasonably in both themes without needing a
        // CSS variable (kept static on purpose; see the Étape 4A theme audit).
        soft: '0px 2px 10px -2px rgba(15,23,42,0.05), 0px 1px 3px -1px rgba(15,23,42,0.03)',
        // Was hardcoded to the LIGHT primary's RGB (23,23,23) — in dark mode
        // the accent becomes near-white, so this stayed dark-tinted forever.
        // Now follows --td-primary like every other accent-based color.
        'soft-primary': '0px 4px 12px rgb(var(--td-primary) / 0.18)',
      },
    },
  },
  plugins: [],
};
