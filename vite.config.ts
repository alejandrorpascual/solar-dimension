import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tanstackStart(),
    nitro({
      // Global h3 middleware wrapping the TanStack Start handler; see src/server/middleware/client-abort.ts.
      handlers: [{ route: '/**', middleware: true, handler: './src/server/middleware/client-abort.ts' }],
    }),
    viteReact(),
  ],
})
