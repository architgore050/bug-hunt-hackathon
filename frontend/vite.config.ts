import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Bug Hunt CTF console. The API runs at http://127.0.0.1:8100 and is reached
// through the /v1 and /health proxies so the refresh cookie stays first-party.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: false,
      },
      '/health': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8100', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:8100', changeOrigin: false },
    },
  },
})
