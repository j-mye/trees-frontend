import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appConfigPlugin } from './vite-plugin-app-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Always load `.env*` from this package (`frontend/`), not from whatever the shell cwd is.
  const env = loadEnv(mode, __dirname, '')
  return {
    envDir: __dirname,
    plugins: [tailwindcss(), react(), appConfigPlugin(env)],
  }
})
