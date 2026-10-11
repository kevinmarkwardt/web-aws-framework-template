import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The admin site (admin.<domain>). Locally on :5174 next to the user site's :5173; /api goes to the local API
// (scripts/local-api.py sends /api/admin/* to api/admin_handler.py).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
