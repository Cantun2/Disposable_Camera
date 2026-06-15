/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark-mode-by-default palette: deep navy canvas + warm gold accents.
        navy: {
          DEFAULT: '#0b1020',
          900: '#070b18',
          800: '#0e1530',
          700: '#131c42',
          600: '#1b2752',
        },
        gold: {
          DEFAULT: '#d4af37',
          600: '#b8941f',
          500: '#d4af37',
          400: '#e6c860',
          300: '#f0d77f',
          200: '#f7e7ad',
        },
      },
      fontFamily: {
        // Display serif (loaded via @fontsource in index.css) + Inter body text.
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        widest: '0.18em',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // Warm gold glows for primary actions + soft elevation for cards.
        gold: '0 10px 34px -10px rgba(212, 175, 55, 0.55)',
        'gold-sm': '0 4px 16px -6px rgba(212, 175, 55, 0.5)',
        card: '0 18px 50px -18px rgba(0, 0, 0, 0.7)',
        'inner-gold': 'inset 0 1px 0 0 rgba(247, 231, 173, 0.35)',
      },
      backgroundImage: {
        // Reusable gold gradients + a subtle navy vignette for page backdrops.
        'gold-gradient':
          'linear-gradient(135deg, #f7e7ad 0%, #e6c860 35%, #d4af37 65%, #b8941f 100%)',
        'gold-sheen':
          'linear-gradient(120deg, rgba(247,231,173,0) 30%, rgba(247,231,173,0.55) 50%, rgba(247,231,173,0) 70%)',
        'navy-radial':
          'radial-gradient(120% 90% at 50% -10%, #131c42 0%, #0b1020 55%, #070b18 100%)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-150% 0' },
          '100%': { backgroundPosition: '150% 0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(16px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        'fade-in': 'fade-in 0.4s ease both',
        'fade-in-up': 'fade-in-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-in': 'toast-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
