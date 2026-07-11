import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  root: "dashboard",
  build: {
    emptyOutDir: true,
    outDir: "../dist/dashboard"
  }
});
