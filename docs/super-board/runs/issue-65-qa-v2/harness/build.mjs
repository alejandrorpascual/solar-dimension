// Bundles entry.tsx against a checkout's src with that checkout's esbuild and node_modules.
// Usage: node build.mjs <checkout> <out.js>
import { createRequire } from 'node:module'
import path from 'node:path'

const [checkout, out, srcOverride] = process.argv.slice(2)
if (!checkout || !out) throw new Error('usage: node build.mjs <checkout> <out.js> [<src dir>]')
const require = createRequire(path.join(checkout, 'package.json'))
const esbuild = require('esbuild')
const here = path.dirname(new URL(import.meta.url).pathname)
const src = srcOverride ?? path.join(checkout, 'src')

const stubLocale = {
  name: 'stub-use-locale',
  setup(build) {
    build.onResolve({ filter: /hooks\/useLocale$/ }, () => ({ path: path.join(here, 'locale-stub.ts') }))
  },
}

await esbuild.build({
  entryPoints: [path.join(here, 'entry.tsx')],
  outfile: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { '@app': src },
  nodePaths: [path.join(checkout, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.SSR': 'false', 'import.meta.env.DEV': 'false' },
  loader: { '.svg': 'dataurl' },
  plugins: [stubLocale],
  logLevel: 'warning',
})
console.log(`built ${out}`)
