import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.VYNODE_DEV_API_URL ?? 'http://localhost:7273',
      '/health': process.env.VYNODE_DEV_API_URL ?? 'http://localhost:7273',
      '/plex-webhook': process.env.VYNODE_DEV_API_URL ?? 'http://localhost:7273',
    },
  },
});
