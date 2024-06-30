/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js}"],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        gruvbox: {
          primary: "#98971a",
          secondary: "#d79921",
          accent: "#cc241d",
          neutral: "#689d6a",
          "base-100": "#282828",
          "base-content": "#ebdbb2",
          info: "#83a598",
          success: "#b8bb26",
          warning: "#fabd2f",
          error: "#fb4934",
        },
        light: {
          primary: "#98971a",
          secondary: "#d79921",
          accent: "#cc241d",
          neutral: "#689d6a",
          "base-100": "#fbf1c7",
          "base-content": "#3c3836",
          info: "#076678",
          success: "#79740e",
          warning: "#b57614",
          error: "#9d0006",
        },
      },
    ],
  },
};
