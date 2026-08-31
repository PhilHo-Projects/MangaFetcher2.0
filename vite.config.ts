import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
