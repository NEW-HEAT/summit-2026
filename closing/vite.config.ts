import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {existsSync, readdirSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  publicDir: 'private-inputs/public',
  build: {copyPublicDir: false},
  plugins: [react(), {
    name: 'local-private-inputs',
    // Link footage and masks into the local preview without duplicating their bytes.
    closeBundle() {
      const inputs = join(import.meta.dirname, 'private-inputs/public');
      if (!existsSync(inputs)) return;
      for (const entry of readdirSync(inputs)) {
        const destination = join(import.meta.dirname, 'dist', entry);
        if (existsSync(destination)) throw new Error('Private input conflicts with a build asset');
        symlinkSync(join(inputs, entry), destination);
      }
    }
  }],
  server: {host: 'localhost', port: 5195, strictPort: true},
  preview: {host: 'localhost', port: 5195, strictPort: true}
});
