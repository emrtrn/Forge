import { resolve } from "node:path";
import { mergeConfig } from "vite";

import baseConfig from "../../vite.config";

/**
 * S6 production check: builds only the worker spike page with the project's
 * real Vite config (aliases, manualChunks, plugins), into a directory outside
 * dist/ so the app build is untouched. `SPIKE_OUT_DIR` overrides the target.
 *
 *   npx vite build --config spikes/terrain-worker/vite.build.config.ts
 *   node builder/web/verify-dist.mjs --dist <outDir> --strict
 */
export default mergeConfig(baseConfig, {
  build: {
    outDir: process.env.SPIKE_OUT_DIR ?? resolve("node_modules/.spike-worker-dist"),
    emptyOutDir: true,
    rollupOptions: { input: resolve("spikes/terrain-worker/index.html") },
  },
});
