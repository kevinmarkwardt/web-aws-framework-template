import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mockGuard } from '../packages/shared/vite/mockGuard'

// The admin site (admin.<domain>). Locally on :5174 next to the user site's :5173; /api goes to the local API
// (scripts/local-api.py sends /api/admin/* to api/admin_handler.py). mockGuard: VITE_STAGE=prod builds fail while an
// entity is still mocked (packages/shared/src/mocks/mocks.config.ts).
export default defineConfig({
  plugins: [react(), tailwindcss(), mockGuard()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
