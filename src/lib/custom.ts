import type { UiKey } from '../i18n/types'
import { MAX_APPLIANCE_SURGE, MAX_APPLIANCE_WATTS, SIZING } from './catalog'

export interface CustomForm {
  name: string
  mode: 'watts' | 'va'
  watts: string
  volts: string
  amps: string
  surge: string
  /** Percent of each hour it runs; empty means 100. */
  dutyPct: string
}

export const EMPTY_FORM: CustomForm = { name: '', mode: 'watts', watts: '', volts: '', amps: '', surge: '', dutyPct: '' }

export interface ParsedCustomLoad { id: string; name: string; watts: number; surge: number; note: string; duty?: number }
export type CustomError = Extract<UiKey, 'errName' | 'errNameLong' | 'errVa' | 'errWatts' | 'errSurge' | 'errThousands' | 'errDuty'>
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

/**
 * The tag the form saves in front of a custom load's note. It stays in English, as on every load saved before, and
 * `customNote` shows it in the language on screen.
 */
const NOTE_TAG = 'Custom'
const NOTE_SEP = ' · '

/** A custom load's saved note with its tag in the language on screen (`tag`, e.g. "Personalizado") and its figures as saved. */
export function customNote(note: string, tag: string): string {
  const saved = `${NOTE_TAG}${NOTE_SEP}`
  return note.startsWith(saved) ? `${tag}${NOTE_SEP}${note.slice(saved.length)}` : note
}

const PERCENT = 100
/** The lowest percent the form takes: the floor the duty picker clamps an override to. */
export const CUSTOM_DUTY_MIN_PCT = SIZING.DUTY_MIN * PERCENT

/** The share of each hour from the form's percent: 1 when left empty, null when it is not one the duty picker could hold. */
function dutyOf(pct: string): number | null {
  if (pct.trim() === '') return 1
  const n = Number(pct)
  return Number.isFinite(n) && n >= CUSTOM_DUTY_MIN_PCT && n <= PERCENT ? n / PERCENT : null
}

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
  // Whole watts within the catalog's ceiling are what is stored: a load that rounds to zero, or one above the ceiling
  // (volts × amps that overflow included), would be one the saved project refuses.
  if (!(watts >= 1 && watts <= MAX_APPLIANCE_WATTS)) {
    return { ok: false, error: isVa ? 'errVa' : 'errWatts' }
  }
  const surge = num(form.surge)
  if (surge > 0 && (surge < computed || Math.round(surge) > MAX_APPLIANCE_SURGE)) return { ok: false, error: 'errSurge' }
  const duty = dutyOf(form.dutyPct)
  if (duty === null) return { ok: false, error: 'errDuty' }
  return {
    ok: true,
    item: {
      id: nextId(existingIds),
      name,
      watts,
      surge: Math.round(surge > 0 ? surge : computed),
      note: `${NOTE_TAG}${NOTE_SEP}${isVa ? `${volts} V × ${amps} A` : `${watts} W`}`,
      // Only a load that cycles stores a duty, so one at 100% is saved exactly as before.
      ...(duty < 1 ? { duty } : {}),
    },
  }
}
