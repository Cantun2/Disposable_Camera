/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark-mode-by-default palette: deep navy + gold accents
        navy: {
          DEFAULT: '#0b1020',
          800: '#0e1530',
          700: '#131c42',
        },
        gold: {
          DEFAULT: '#d4af37',
          400: '#e6c860',
          300: '#f0d77f',
        },
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
