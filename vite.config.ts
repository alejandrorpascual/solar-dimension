import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'

const ONE_YEAR_S = 31536000

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tanstackStart(),
    nitro({
      // Global h3 middleware wrapping the TanStack Start handler; see src/server/middleware/client-abort.ts.
      handlers: [{ route: '/**', middleware: true, handler: './src/server/middleware/client-abort.ts' }],
      // Build chunks live under /assets and are cached `immutable` for a year. Declaring the folder non-fallthrough
      // makes a request for a chunk that is not there a `no-store` 404 (on Vercel, a route after the filesystem check)
      // instead of the app's 404 page carrying that same immutable header, which a browser would then keep for a
      // year: a chunk requested mid-deploy stays broken on that device for every later build that reuses its name.
      // The files themselves come from the client build; `dir` is never read (it does not exist, so nothing is copied).
      publicAssets: [{ baseURL: '/assets', dir: 'public/assets', maxAge: ONE_YEAR_S, fallthrough: false }],
    }),
    viteReact(),
  ],
})
