import type { CostBreakdown, SearchCalls } from './cost'
import { gradeBattery, gradeInverter, overall, pairStatus, sourcedShare, type Check, type Grade, type SpecShare } from './grade'
import type { LinkCheck } from './links'
import type { ProductNeeds } from './needs'
import type { BatteryFind, InverterFind, ProductSearch } from './schema'

const say = (line = '') => console.log(line)
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 3)}`
const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`)
const MARK: Record<Grade, string> = { ok: '✓', fails: '✗', unclear: '?' }

/** The surge counts as one spec: stated when some level gives watts, sourced from that level's page. */
const surgeSpec = (i: InverterFind) => {
  const level = i.surges.find((l) => l.w !== null)
  return { value: level?.w ?? null, source: level?.source ?? null }
}
const inverterSpecs = (i: InverterFind) => [
  i.continuousW, surgeSpec(i), i.batteryVolts, i.chargerA, i.pvInputW, i.pvVocMax, i.maxParallelUnits, i.idleW,
  i.peakEfficiencyPct, i.warrantyYears,
]
const surgeLevelsLine = (i: InverterFind) =>
  i.surges.length === 0 ? 'none stated' : i.surges.map((l) => `${l.w ?? '?'} W for ${l.seconds ?? '?'} s ("${l.asWritten}")`).join(' · ')
const batterySpecs = (b: BatteryFind) => [
  b.nominalV, b.ah, b.kWh, b.maxContinuousA, b.peakA, b.peakSeconds, b.maxParallel, b.cycleLife, b.warrantyYears,
]

export function printNeeds(n: ProductNeeds) {
  say('KIT NEEDS')
  say(`  running ${n.runningW} W → inverter ≥ ${n.inverterW} W · surge ${n.surgeW} W for ${n.surgeSeconds} s · ${n.volts} V`)
  say(`  ${n.chemistry} ≥ ${(n.usableWh / 1000).toFixed(1)} kWh usable · ≥ ${n.dcA} A DC${n.splitPhase ? ' · split-phase' : ''}${n.arrayW ? ` · ${n.arrayW} W solar` : ''}`)
  say()
}

const linkLine = (label: string, url: string | null, links: ReadonlyMap<string, LinkCheck>) => {
  if (url === null) return `${label} none`
  const l = links.get(url)
  return `${label} ${l?.status ?? 'unreachable'}${l?.inSearch ? ' (in search)' : l?.hostInSearch ? ' (host in search)' : ' (not in search)'}`
}
const priceLine = (p: InverterFind['price']) => (p ? `${p.currency} ${p.amount} at ${p.seller}` : 'none')
const checksLine = (checks: readonly Check[]) => checks.map((c) => `${MARK[c.grade]} ${c.label}: ${c.detail}`).join(' · ')

interface Product {
  brand: string; model: string; productUrl: string; datasheetUrl: string | null; price: InverterFind['price']; why: string
  extraSpecs: InverterFind['extraSpecs']
}

function printProduct(i: number, p: Product, checks: readonly Check[], specs: SpecShare, links: ReadonlyMap<string, LinkCheck>, extra = '', detail = '') {
  say(` ${i + 1}. ${MARK[overall(checks)]} ${p.brand} ${p.model}${extra}`)
  say(`    ${checksLine(checks)}`)
  if (detail) say(`    ${detail}`)
  say(`    specs stated ${specs.stated}/${specs.total} · with a source ${specs.sourced}/${specs.stated} · from the datasheet ${specs.fromDatasheet}/${specs.stated} · ${p.extraSpecs.length} extra datasheet lines`)
  say(`    ${linkLine('maker page', p.productUrl, links)} · ${linkLine('datasheet', p.datasheetUrl, links)} · price ${priceLine(p.price)}`)
  if (p.extraSpecs.length > 0) say(`    extra: ${p.extraSpecs.map((x) => `${x.name} ${x.value}`).join(' · ')}`)
  say(`    why: ${p.why}`)
}

export function printProducts(s: ProductSearch, n: ProductNeeds, links: ReadonlyMap<string, LinkCheck>) {
  say('INVERTERS')
  s.inverters.forEach((inv, i) =>
    printProduct(i, inv, gradeInverter(inv, n), sourcedShare(inverterSpecs(inv), inv.datasheetUrl), links, '', `surge levels: ${surgeLevelsLine(inv)}`))
  say()
  say('BATTERIES')
  s.batteries.forEach((b, i) => {
    const { checks, bank } = gradeBattery(b, n)
    const extra = bank ? ` · bank ${bank.units} units (${bank.series}S${bank.strings}P)` : ''
    printProduct(i, b, checks, sourcedShare(batterySpecs(b), b.datasheetUrl), links, extra)
  })
  say()
  say('PAIRING (inverter rows × battery columns)')
  say(`      ${s.batteries.map((_, j) => `B${j + 1}`.padEnd(7)).join('')}`)
  s.inverters.forEach((inv, i) => say(`  I${i + 1}  ${s.batteries.map((b) => pairStatus(inv, b, n).padEnd(7)).join('')}`))
  if (s.notes.length > 0) {
    say()
    say('MODEL NOTES')
    s.notes.forEach((note) => say(`  - ${note}`))
  }
  say()
}

function gradeCounts(grades: readonly Grade[]): string {
  const count = (g: Grade) => grades.filter((x) => x === g).length
  return `${count('ok')} ok, ${count('unclear')} unclear, ${count('fails')} fail`
}

const isReachable = (l: LinkCheck | undefined): boolean => l !== undefined && l.status !== null && l.status < 400

export function printFeasibility(s: ProductSearch, n: ProductNeeds, links: readonly LinkCheck[]) {
  const products: Product[] = [...s.inverters, ...s.batteries]
  const shares = [
    ...s.inverters.map((i) => sourcedShare(inverterSpecs(i), i.datasheetUrl)),
    ...s.batteries.map((b) => sourcedShare(batterySpecs(b), b.datasheetUrl)),
  ]
  const add = (f: (x: SpecShare) => number) => shares.reduce((a, x) => a + f(x), 0)
  const [total, stated, sourced, fromDatasheet] = [add((x) => x.total), add((x) => x.stated), add((x) => x.sourced), add((x) => x.fromDatasheet)]
  const byUrl = new Map(links.map((l) => [l.url, l]))
  const datasheets = products.flatMap((p) => (p.datasheetUrl ? [p.datasheetUrl] : []))
  say('FEASIBILITY')
  say(`  returned: ${s.inverters.length} inverters, ${s.batteries.length} batteries`)
  say(`  inverters: ${gradeCounts(s.inverters.map((i) => overall(gradeInverter(i, n))))}`)
  say(`  batteries: ${gradeCounts(s.batteries.map((b) => overall(gradeBattery(b, n).checks)))}`)
  say(`  specs stated ${pct(stated, total)} (${stated}/${total}) · with a source ${pct(sourced, stated)} · from a datasheet ${pct(fromDatasheet, stated)}`)
  say(`  datasheets found ${datasheets.length}/${products.length}, reachable ${datasheets.filter((u) => isReachable(byUrl.get(u))).length}`)
  say(`  maker pages reachable ${products.filter((p) => isReachable(byUrl.get(p.productUrl))).length}/${products.length}`)
  say(`  links in search results: exact ${links.filter((l) => l.inSearch).length}/${links.length}, same host ${links.filter((l) => l.hostInSearch).length}/${links.length}`)
  say(`  prices given ${products.filter((p) => p.price !== null).length}/${products.length} (secondary)`)
  say()
}

export function printCost(model: string, seconds: number, calls: SearchCalls, c: CostBreakdown) {
  const actions = Object.entries(calls.byAction).map(([k, v]) => `${k} ${v}`).join(', ')
  say('COST')
  say(`  model ${model} · ${seconds.toFixed(0)} s`)
  say(`  tokens: ${c.inputTokens} in (${c.cachedTokens} cached, ${c.cacheWriteTokens} cache writes) · ${c.outputTokens} out (${c.reasoningTokens} reasoning)`)
  say(`  web search calls: ${calls.total} (${actions || 'none'})`)
  say(`  tokens ${usd(c.tokensUSD)} + search ${usd(c.searchUSD)} = ${usd(c.totalUSD)} per search (search-only billing: ${usd(c.tokensUSD + c.searchUSDSearchOnly)})`)
  say(`  per 1,000 searches: ≈ $${(c.totalUSD * 1000).toFixed(2)}`)
}
