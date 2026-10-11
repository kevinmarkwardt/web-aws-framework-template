import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { googleTags, seoFiles } from './site-plugins'
import { mockGuard } from '../packages/shared/vite/mockGuard'

export default defineConfig({
  // googleTags / seoFiles: production builds only (site-plugins.ts); mockGuard: VITE_STAGE=prod builds fail while an
  // entity is still mocked (packages/shared/src/mocks/mocks.config.ts)
  plugins: [react(), tailwindcss(), googleTags(), seoFiles(), mockGuard()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
