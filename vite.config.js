import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, 'src', 'renderer');
const DEFAULT_DEV_PORT = 5583;
const devPort = Number(process.env.DEV_SERVER_PORT || process.env.PORT || DEFAULT_DEV_PORT);

export default defineConfig({
  root: rendererRoot,
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    watch: {
      ignored: ['../data/**'],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(rendererRoot),
    },
  },
});

