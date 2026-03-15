/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{astro,html,js,jsx,ts,tsx,vue,svelte}",
  ],

  theme: {
    extend: {
      colors:
      {
        brand:"#0fa9e6",
      },

      fontFamily: {
        Grotesk: 'Grotesk-wide',
        Archivo: 'Archivo Black',
        TimesNewRoman: 'TimesNewRoman',
      },

    },
  },
  plugins: [require('tailwind-scrollbar')],
}
