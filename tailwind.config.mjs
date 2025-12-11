import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'queens': {
          DEFAULT: '#0a79c8', // Brand Blue (Secondary)
          primary: '#0b1121', // Dark Navy (Primary)
          secondary: '#0a79c8', // Brand Blue
          dark: '#080c17',    // Darker shade of primary
          light: '#1489e1',   // Lighter shade of secondary
          white: '#ffffff',
          gray: '#f4f4f4',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['"Source Serif 4"', 'serif'],
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(to right, rgba(17,17,17,0.95), rgba(17,17,17,0.6))',
      }
    },
  },
  plugins: [
    typography,
  ],
}
