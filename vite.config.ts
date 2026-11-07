import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
  server: {
    host: true,
    fs: { allow: ['..'] },
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
