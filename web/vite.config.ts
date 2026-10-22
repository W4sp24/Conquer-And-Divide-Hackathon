import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: the API runs on :8000 and Vite proxies /api to it, so the browser sees one origin.
// Prod: `npm run build` and the FastAPI app serves web/dist itself (one port for the demo).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
})
