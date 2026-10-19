// QA #60 AC1: move every single value of GAUGES (amps75, amps90), AMBIENT_CORRECTION and BUNDLE_ADJUSTMENT
// up and down, one at a time, and record whether `vitest run <spec>` fails. Restores each file after every run.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const [clone, spec, outFile] = process.argv.slice(2)
if (!clone || !spec || !outFile) {
  console.error('usage: node mutate-tables.mjs <clone> <spec> <out.json>')
  process.exit(64)
}

const CATALOG = join(clone, 'src/lib/catalog.ts')
const NEC = join(clone, 'src/lib/nec.ts')

/** Each mutation site: file, 1-based line, the field, and its step. */
function sites() {
  const out = []
  const cat = readFileSync(CATALOG, 'utf8').split('\n')
  const start = cat.findIndex((l) => l.startsWith('export const GAUGES'))
  for (let i = start + 1; cat[i] && !cat[i].startsWith(']'); i++) {
    for (const field of ['amps75', 'amps90']) out.push({ file: CATALOG, line: i, field, step: 1, label: cat[i].match(/awg: '([^']+)'/)[1] })
  }
  const nec = readFileSync(NEC, 'utf8').split('\n')
  const amb = nec.findIndex((l) => l.startsWith('export const AMBIENT_CORRECTION'))
  for (let i = amb + 1; !nec[i].startsWith(']'); i++) {
    const label = `maxC ${nec[i].match(/maxC: (-?\d+)/)[1]}`
    out.push({ file: NEC, line: i, field: 'maxC', step: 1, label })
    out.push({ file: NEC, line: i, field: 'f75', step: 0.01, label })
    out.push({ file: NEC, line: i, field: 'f90', step: 0.01, label })
  }
  const bun = nec.findIndex((l) => l.startsWith('export const BUNDLE_ADJUSTMENT'))
  for (let i = bun + 1; !nec[i].startsWith(']'); i++) {
    const label = `min ${nec[i].match(/minConductors: (\d+)/)[1]}`
    out.push({ file: NEC, line: i, field: 'minConductors', step: 1, label })
    out.push({ file: NEC, line: i, field: 'factor', step: 0.01, label })
  }
  return out
}

const round = (n) => Math.round(n * 1000) / 1000

function runSpec() {
  const r = spawnSync('npx', ['vitest', 'run', spec], { cwd: clone, encoding: 'utf8' })
  return r.status
}

const results = []
for (const s of sites()) {
  const pristine = readFileSync(s.file, 'utf8')
  const lines = pristine.split('\n')
  const re = new RegExp(`(${s.field}: )(-?[\\d.]+)`)
  const value = Number(lines[s.line].match(re)[2])
  for (const dir of [1, -1]) {
    const next = round(value + dir * s.step)
    const mutated = [...lines]
    mutated[s.line] = lines[s.line].replace(re, `$1${next}`)
    if (mutated[s.line] === lines[s.line]) throw new Error(`mutation did not land: ${s.label} ${s.field}`)
    writeFileSync(s.file, mutated.join('\n'))
    let status
    try {
      status = runSpec()
    } finally {
      writeFileSync(s.file, pristine)
    }
    results.push({ table: s.file.endsWith('catalog.ts') ? 'GAUGES' : s.field === 'minConductors' || s.field === 'factor' ? 'BUNDLE_ADJUSTMENT' : 'AMBIENT_CORRECTION', row: s.label, field: s.field, from: value, to: next, caught: status !== 0 })
  }
}

writeFileSync(outFile, JSON.stringify(results, null, 2))
const survived = results.filter((r) => !r.caught)
const values = results.length / 2
console.log(`values=${values} mutants=${results.length} caught=${results.length - survived.length} survived=${survived.length}`)
for (const s of survived) console.log(`SURVIVED ${s.table} ${s.row} ${s.field} ${s.from} -> ${s.to}`)
process.exit(survived.length === 0 ? 0 : 1)
