import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://diff.city",
  output: "static",
  vite: { plugins: [tailwindcss()] },
});
