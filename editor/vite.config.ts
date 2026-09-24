import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer build config. The Electron main/preload processes are compiled
// separately by `tsc -p electron/tsconfig.json` (see package.json scripts) -
// Vite only ever builds src/ (the React UI that runs inside the
// BrowserWindow), not the Node-side Electron code.
export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // src/engineSettings.ts imports ../compiler/engine_settings.json.
    fs: { allow: [".."] },
  },
});
