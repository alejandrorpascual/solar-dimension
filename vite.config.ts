import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'

const ONE_YEAR_S = 31536000
/**
 * Where the client build's chunks are served from. Moved off Vite's default `assets` so every chunk got a URL no
 * browser had seen: before the no-store rule below, a chunk requested mid-deploy could be cached as a 404 for a year.
 */
const BUILD_ASSETS_DIR = '_build'

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tanstackStart(),
    nitro({
      // Global h3 middleware wrapping the TanStack Start handler; see src/server/middleware/client-abort.ts.
      handlers: [{ route: '/**', middleware: true, handler: './src/server/middleware/client-abort.ts' }],
      buildAssetsDir: BUILD_ASSETS_DIR,
      // Build chunks are cached `immutable` for a year. Declaring their folder non-fallthrough makes a request for a
      // chunk that is not there a `no-store` 404 (on Vercel, a route after the filesystem check) instead of the app's
      // 404 page carrying that same immutable header, which a browser would then keep for a year: a chunk requested
      // mid-deploy stays broken on that device for every later build that reuses its name.
      // The files themselves come from the client build; `dir` is never read (it does not exist, so nothing is copied).
      publicAssets: [{ baseURL: `/${BUILD_ASSETS_DIR}`, dir: `public/${BUILD_ASSETS_DIR}`, maxAge: ONE_YEAR_S, fallthrough: false }],
    }),
    viteReact(),
  ],
})
