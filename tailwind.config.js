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
        primary: {
          DEFAULT: '#FF7A00',
          dark: '#994700',
          light: '#FFB68B',
          soft: '#FFF1E5',
        },
        background: '#FFFFFF',
        'background-secondary': '#F7F7F8',
        surface: '#FFFFFF',
        'surface-container': '#F0F0F2',
        'surface-container-high': '#E8E8E9',
        border: '#EDEDEF',
        text: {
          primary: '#171717',
          secondary: '#6B6B6B',
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
        'soft-primary': '0px 4px 12px rgba(255,122,0,0.2)',
      },
    },
  },
  plugins: [],
};
