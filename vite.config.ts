import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Optional GLB character models live in /assets/models (next to the reference art).
// The dev server already serves project-root files; this copies them into the build.
function copyModels(): Plugin {
  return {
    name: 'copy-models',
    apply: 'build',
    closeBundle() {
      const src = resolve(process.cwd(), 'assets/models');
      if (existsSync(src)) cpSync(src, resolve(process.cwd(), 'dist/assets/models'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [copyModels()],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
});
