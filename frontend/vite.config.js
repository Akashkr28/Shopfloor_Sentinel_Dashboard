import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.SENTINEL_API || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from phones / the shopfloor TV on the same Wi-Fi
    port: 5173,
    proxy: { '/api': backend, '/uploads': backend },
  },
});
