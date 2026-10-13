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
export type CustomError = Extract<UiKey, 'errName' | 'errNameLong' | 'errVa' | 'errWatts' | 'errSurge' | 'errThousands'>
export type ParseResult = { ok: true; item: ParsedCustomLoad } | { ok: false; error: CustomError }

const ID_PREFIX = 'custom'
const CUSTOM_ID = new RegExp(`^${ID_PREFIX}\\d+$`)
/**
 * Whether an id is one this form hands out. No catalog appliance may have one, so such an id with no custom appliance
 * behind it belongs to one that could not be read back.
 */
export const isCustomLoadId = (id: string): boolean => CUSTOM_ID.test(id)
/** The longest name a custom appliance keeps. The saved-project schema holds the same limit, so the form can never write a load a reload would refuse. */
export const CUSTOM_NAME_MAX = 80
/**
 * Digits in groups of three behind "." or ",": 1,500 the way much of Latin America ("1.500") or English ("1,500")
 * writes it. Watts are stored whole, so read as a decimal it would silently become 2 W; the form asks instead.
 */
const THOUSANDS = /^\d{1,3}([.,]\d{3})+$/
const isGrouped = (v: string): boolean => THOUSANDS.test(v.trim())

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
  if (name.length > CUSTOM_NAME_MAX) return { ok: false, error: 'errNameLong' }
  if ((!isVa && isGrouped(form.watts)) || isGrouped(form.surge)) return { ok: false, error: 'errThousands' }
  const watts = Math.round(computed)
  // Whole, finite watts are what is stored: a load that rounds to zero, or volts × amps that overflow, would be one the saved project refuses.
  if (!(watts >= 1 && Number.isFinite(watts))) {
    return { ok: false, error: isVa ? 'errVa' : 'errWatts' }
  }
  const surge = num(form.surge)
  if (surge > 0 && surge < computed) return { ok: false, error: 'errSurge' }
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
