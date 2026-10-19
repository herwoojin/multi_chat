/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Pretendard Variable', 'sans-serif'],
      },
      colors: {
        ink: { 950: '#070a16', 900: '#0b1022', 800: '#121a33', 700: '#1b2547' },
        brand: { 400: '#a78bfa', 500: '#7c5cff', 600: '#6243f5' },
        aqua: { 400: '#22d3ee', 500: '#06b6d4' },
      },
      keyframes: {
        blob: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(30px,-40px) scale(1.08)' },
          '66%': { transform: 'translate(-25px,20px) scale(0.95)' },
        },
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
        blink: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
        breathe: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        blob: 'blob 18s ease-in-out infinite',
        rise: 'rise .28s ease-out both',
        'blink-fast': 'blink .6s steps(2,start) infinite',
        'blink-mid': 'blink 1.2s ease-in-out infinite',
        breathe: 'breathe 3.2s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [],
};
