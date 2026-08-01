import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': 'http://localhost:7171',
            '/health': 'http://localhost:7171',
            '/plex-webhook': 'http://localhost:7171',
        },
    },
});
