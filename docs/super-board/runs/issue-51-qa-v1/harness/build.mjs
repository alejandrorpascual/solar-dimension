// Bundles the QA harness against the clone's source and node_modules. Usage: node build.mjs <clone-dir>
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const clone = process.argv[2]
if (!clone) throw new Error('usage: node build.mjs <clone-dir>')
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist')
const { build } = await import(join(clone, 'node_modules/esbuild/lib/main.js'))

const stubRoot = {
  name: 'stub-root-data',
  setup(b) {
    b.onResolve({ filter: /\/useRootData$/ }, (args) =>
      args.importer.endsWith('stub-root.ts') ? undefined : { path: join(here, 'stub-root.ts') })
  },
}

mkdirSync(out, { recursive: true })
await build({
  entryPoints: [join(here, 'entry.tsx')],
  bundle: true,
  outdir: out,
  format: 'esm',
  jsx: 'automatic',
  alias: { '@app': join(clone, 'src') },
  nodePaths: [join(clone, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl' },
  plugins: [stubRoot],
  logLevel: 'warning',
})

const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="entry.css"><title>QA harness #51</title></head>
<body><div id="root"></div><script type="module" src="entry.js"></script></body></html>
`)
console.log('built', out)
