import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devApiPlugin } from "./dev/vite-api-plugin.ts";

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  build: {
    outDir: "dist",
  },
});
