import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "chrome120",
    rollupOptions: {
      input: {
        guide: "index.html",
        sidepanel: "sidepanel.html",
        background: "src/background.ts",
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
