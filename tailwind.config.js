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
        primary: { DEFAULT: 'rgb(var(--td-primary) / <alpha-value>)', dark: 'rgb(var(--td-primary-dark) / <alpha-value>)', light: 'rgb(var(--td-primary-light) / <alpha-value>)', soft: 'rgb(var(--td-primary-soft) / <alpha-value>)' },
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
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
      },
      spacing: {
        'page-margin': '20px',
        'gutter-card': '16px',
        touch: '44px',
      },
      boxShadow: {
        soft: '0px 4px 12px rgba(0,0,0,0.05)',
        'soft-primary': '0px 4px 12px rgba(23,23,23,0.18)',
      },
    },
  },
  plugins: [],
};
