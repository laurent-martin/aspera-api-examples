import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // server.ts runs on 9080, proxy API calls to avoid CORS issues
      '/api': 'http://localhost:9080',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      // Create an alias so Vite knows exactly where source code is
      '@src': path.resolve(__dirname, './src')
    }
  }
});
