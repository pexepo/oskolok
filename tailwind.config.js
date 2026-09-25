/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#f0f4f9',
        surface: 'rgba(255, 255, 255, 0.8)',
        elevated: '#ffffff',
        border: 'rgba(59, 130, 246, 0.14)',
        oskolok: {
          bg: '#f0f4f9',
          card: 'rgba(255, 255, 255, 0.85)',
          blue: '#163b96',
          deepBlue: '#0e2680',
          accent: '#2563eb',
          sky: '#38bdf8',
          text: '#162b50',
          muted: '#5a6e85',
          faint: '#8ea2ba',
          line: 'rgba(70, 120, 210, 0.28)',
        },
        brand: {
          DEFAULT: '#2563eb',
          purple: '#2563eb',
          pink: '#818cf8',
          blue: '#163b96',
          cyan: '#0ea5e9',
          violet: '#4f46e5',
          gradientFrom: '#38bdf8',
          gradientTo: '#1d4ed8',
        }
      },
      boxShadow: {
        'oskolok-glow': '0 0 30px rgba(59, 130, 246, 0.2)',
        'oskolok-card': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      },
      animation: {
        'pulse-subtle': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
