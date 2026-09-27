import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

import { join } from "path";

const root = join(import.meta.dirname, "../vendor/thor");
const demoModules = join(import.meta.dirname, "../../node_modules");

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  base: "/",
  resolve: {
    alias: {
      // Local source
      "thor.gl": join(root, "index.ts"),
      // Pin peer deps to demo/node_modules (same pattern as deck.gl-community)
      react: join(demoModules, "react"),
      "react-dom": join(demoModules, "react-dom"),
      "@deck.gl/core": join(demoModules, "@deck.gl/core"),
      "@mediapipe/tasks-vision": join(demoModules, "@mediapipe/tasks-vision"),
    },
  },
});
