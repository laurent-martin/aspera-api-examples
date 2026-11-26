import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
    // local address only: the proxied API has no user authentication
    host: '127.0.0.1',
    proxy: {
      // server.ts listens on 127.0.0.1:9080, proxy API calls to avoid CORS issues
      '/api': 'http://127.0.0.1:9080',
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      // Create an alias so Vite knows exactly where source code is
      '@src': path.resolve(__dirname, './src')
    }
  }
});
