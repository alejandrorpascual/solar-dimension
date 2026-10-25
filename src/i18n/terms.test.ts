import { expect, test } from 'vitest'
import type { WarningParams } from '../lib/sizing'
import { en } from './en'
import { es } from './es'
import type { Dictionary } from './types'

/** Warning params that reach every branch between them: one inverter and a set, LiFePO₄ and AGM, a start-up over the rating and one that outlasts it, the main run and a string lead. */
const BASE: WarningParams = {
  inverterW: 5000, unitW: 5000, runningW: 4000, headroomPct: 10, needPct: 25, volts: 48, voltsList: '24 / 48', amps: 463, nextVolts: 48,
  strings: 2, itemName: 'Fridge', sharePct: 54, count: 2, unitLabel: '12 V 100 Ah', needA: 278, maxA: 100, seconds: 3, surgeW: 9400,
  ratedW: 7500, inverterSurgeW: 10000, fuseA: 175, surgeA: 309, shortCircuitA: 21600, aicA: 20000, maxVdc: 32, needVdc: 60, dropPct: 12,
  maxDropPct: 3, ambientC: 90, gauge: '4/0 AWG', conductor: 'mainCable', fit: 1, need: 4,
}
const VARIANTS: WarningParams[] = [
  BASE,
  { ...BASE, inverters: 2, tooLong: true, chemistry: 'agm', conductor: 'stringLeads', count: 1, volts: 36, runningW: 6000 },
  { ...BASE, inverters: 2, tooLong: false },
  { ...BASE, tooLong: true },
]

/** Every piece of copy a dictionary can show: each string in it, and each warning under every variant. */
function copyOf(d: Dictionary): string[] {
  const { warnings, ...rest } = d
  const walk = (v: unknown): string[] => (typeof v === 'string' ? [v] : typeof v === 'object' && v !== null ? Object.values(v).flatMap(walk) : [])
  return [...walk(rest), ...Object.values(warnings).flatMap((warning) => VARIANTS.map((p) => warning(p)))]
}

/** The copy that still has `word` once the phrases it may appear in, and the `{placeholders}` no reader sees, are taken out. */
const strays = (d: Dictionary, word: RegExp, allowed: RegExp): string[] =>
  copyOf(d).filter((text) => word.test(text.replace(/\{\w+\}/g, '').replace(allowed, '')))

test('"surge" appears only in the inverter\'s surge rating, and "peak" only in battery peak current and peak sun hours', () => {
  expect(strays(en, /surge/i, /surge rating/gi)).toEqual([])
  expect(strays(en, /\bpeak/i, /peak current|peak sun/gi)).toEqual([])
})

test('Spanish keeps "pico" for the inverter\'s potencia pico and the battery\'s corriente pico, never for a start-up', () => {
  // A letter on either side, not \b: \b treats the í of "típico" as a word break.
  expect(strays(es, /(?<!\p{L})pico(?!\p{L})/iu, /potencia pico|corriente pico/gi)).toEqual([])
})

test('copy that names a load\'s start-up says start-up power, in English and Spanish', () => {
  const lines = (d: Dictionary) => [
    d.ui.q1Help, d.ui.runningSurgeLine, d.ui.surgeOptional, d.ui.errSurge, d.ui.startupPeak, d.ui.footer1,
    d.ui.inverterNote, d.ui.inverterNoteTight, d.ui.inverterNotePeak, d.ui.inverterNoteTightPeak,
    d.ui.checkSurgeOk, d.ui.checkSurgeOkMany, d.ui.checkSurgeOkNoStart, d.ui.checkSurgeOkManyNoStart,
    d.quotes.needsSurge, d.quotes.gapSurge, d.warnings.lockedRotor(BASE), ...VARIANTS.map((p) => d.warnings.surgeDuration(p)),
  ]
  for (const line of lines(en)) expect(line).toMatch(/start-up power/i)
  for (const line of lines(es)) expect(line).toMatch(/potencia de arranque/i)
})
