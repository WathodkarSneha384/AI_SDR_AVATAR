import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Express backend during dev so CORS isn't an issue.
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
  build: {
    outDir: 'dist',
  },
});
