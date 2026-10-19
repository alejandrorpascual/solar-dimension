// QA #60: apply one code mutant at a time (exact string replace), run the given specs, restore, and record red/green.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const [clone, mutantsFile, outFile] = process.argv.slice(2)
if (!clone || !mutantsFile || !outFile) {
  console.error('usage: node mutate-ops.mjs <clone> <mutants.json> <out.json>')
  process.exit(64)
}

const mutants = JSON.parse(readFileSync(mutantsFile, 'utf8'))
const results = []
for (const m of mutants) {
  const path = join(clone, m.file)
  const pristine = readFileSync(path, 'utf8')
  const hits = pristine.split(m.from).length - 1
  if (hits !== 1) throw new Error(`${m.id}: expected one match in ${m.file}, found ${hits}`)
  writeFileSync(path, pristine.replace(m.from, m.to))
  let r
  try {
    r = spawnSync('npx', ['vitest', 'run', ...m.specs], { cwd: clone, encoding: 'utf8' })
  } finally {
    writeFileSync(path, pristine)
  }
  const failed = (r.stdout + r.stderr).match(/^\s*(?:×|FAIL)\s.*$/gm) ?? []
  results.push({ id: m.id, ac: m.ac, file: m.file, caught: r.status !== 0, failing: [...new Set(failed.map((l) => l.trim()))].slice(0, 6) })
}
writeFileSync(outFile, JSON.stringify(results, null, 2))
for (const r of results) console.log(`${r.caught ? 'CAUGHT  ' : 'SURVIVED'} ${r.ac} ${r.id}${r.caught ? '' : ''}`)
const survived = results.filter((r) => !r.caught)
console.log(`mutants=${results.length} caught=${results.length - survived.length} survived=${survived.length}`)
