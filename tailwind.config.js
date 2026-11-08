/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        vazir: ["Vazirmatn Variable", "Vazirmatn", "system-ui", "sans-serif"],
      },
      colors: {
        ink: { 900: "#070b14", 800: "#0b1120", 700: "#0f172a", 600: "#16203a" },
      },
      boxShadow: {
        glass: "0 20px 60px -20px rgba(0,0,0,0.75), inset 0 1px 0 0 rgba(255,255,255,0.06)",
        glow: "0 0 40px -8px rgba(16,185,129,0.55)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        floaty: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        shimmer: "shimmer 3.5s linear infinite",
        floaty: "floaty 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
