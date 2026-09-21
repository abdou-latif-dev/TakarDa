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
        primary: {
          DEFAULT: '#171717',
          dark: '#000000',
          light: '#595959',
          soft: '#F0F0F0',
        },
        background: '#FFFFFF',
        'background-secondary': '#F7F7F8',
        surface: '#FFFFFF',
        'surface-container': '#EEEEEE',
        'surface-container-high': '#E0E0E0',
        border: '#E5E5E5',
        text: {
          primary: '#171717',
          secondary: '#666666',
          muted: '#9A9A9A',
        },
        success: {
          DEFAULT: '#2E7D32',
          container: '#E6F4EA',
        },
        error: {
          DEFAULT: '#BA1A1A',
          container: '#FFDAD6',
        },
        warning: {
          DEFAULT: '#B45309',
          container: '#FEF3C7',
        },
        info: {
          DEFAULT: '#006399',
          container: '#CDE5FF',
        },
        skeleton: '#EEEEEF',
        'empty-icon': '#DADADB',
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
