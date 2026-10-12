import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    __VITE_API_URL__: JSON.stringify(process.env.VITE_API_URL || 'https://paypro.swansol.net/api')
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5002', changeOrigin: true },
    },
  },
})
