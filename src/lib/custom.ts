import type { UiKey } from '../i18n/types'

export interface CustomForm {
  name: string
  mode: 'watts' | 'va'
  watts: string
  volts: string
  amps: string
  surge: string
}

export const EMPTY_FORM: CustomForm = { name: '', mode: 'watts', watts: '', volts: '', amps: '', surge: '' }

export interface ParsedCustomLoad { id: string; name: string; watts: number; surge: number; note: string }
export type CustomError = Extract<UiKey, 'errName' | 'errVa' | 'errWatts' | 'errSurge'>
export type ParseResult = { ok: true; item: ParsedCustomLoad } | { ok: false; error: CustomError }

const ID_PREFIX = 'custom'

function num(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function nextId(existingIds: readonly string[]): string {
  let n = 1
  while (existingIds.includes(`${ID_PREFIX}${n}`)) n++
  return `${ID_PREFIX}${n}`
}

export function parseCustom(form: CustomForm, existingIds: readonly string[]): ParseResult {
  const name = form.name.trim()
  const isVa = form.mode === 'va'
  const volts = num(form.volts)
  const amps = num(form.amps)
  const computed = isVa ? volts * amps : num(form.watts)
  if (!name) return { ok: false, error: 'errName' }
  if (!(computed > 0)) {
    return { ok: false, error: isVa ? 'errVa' : 'errWatts' }
  }
  const surge = num(form.surge)
  if (surge > 0 && surge < computed) return { ok: false, error: 'errSurge' }
  const watts = Math.round(computed)
  return {
    ok: true,
    item: {
      id: nextId(existingIds),
      name,
      watts,
      surge: Math.round(surge > 0 ? surge : computed),
      note: isVa ? `Custom · ${volts} V × ${amps} A` : `Custom · ${watts} W`,
    },
  }
}
