import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { googleTags, seoFiles } from './site-plugins'

export default defineConfig({
  // googleTags / seoFiles: production builds only (site-plugins.ts)
  plugins: [react(), tailwindcss(), googleTags(), seoFiles()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
