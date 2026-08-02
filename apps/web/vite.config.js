var _a, _b, _c;
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': (_a = process.env.VYNODE_DEV_API_URL) !== null && _a !== void 0 ? _a : 'http://localhost:7273',
            '/health': (_b = process.env.VYNODE_DEV_API_URL) !== null && _b !== void 0 ? _b : 'http://localhost:7273',
            '/plex-webhook': (_c = process.env.VYNODE_DEV_API_URL) !== null && _c !== void 0 ? _c : 'http://localhost:7273',
        },
    },
});
