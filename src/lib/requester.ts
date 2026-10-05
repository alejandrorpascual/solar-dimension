import { z } from 'zod'
import type { Locale } from '../i18n/types'

/** Who asked for the kit, printed on the spec sheet. Only the name is required; the ID depends on the country. */
export const REQUESTER_KINDS = ['person', 'company'] as const
export const REQUESTER_COUNTRIES = ['VE', 'US', 'OTHER'] as const
export type RequesterKind = (typeof REQUESTER_KINDS)[number]
export type RequesterCountry = (typeof REQUESTER_COUNTRIES)[number]

/** Character limits; the form's inputs use them as maxLength so Save never meets a value the schema rejects. */
export const REQUESTER_MAX = { name: 120, contact: 80, doc: 40, phone: 40, email: 120, address: 160 } as const

/** Dictionary keys (`t.requester`) for an ID's form label, how the sheet prints it, and its letter picker's label. */
export type DocField = 'cedula' | 'rif' | 'ein' | 'idNumber' | 'taxId'
export type DocPrintKey = 'printCedula' | 'printRif' | 'printEin' | 'printIdNumber' | 'printTaxId'

export interface DocRule {
  field: DocField
  print: DocPrintKey
  /** Letters picked in front of the number (V/E for a cédula, J/G/C/V for a RIF); empty means free text. */
  prefixes: readonly string[]
  prefixLabel: 'prefixCedula' | 'prefixRif' | null
  placeholder: string
  isOptional: boolean
}

const CEDULA_DIGITS = { min: 5, max: 9 } as const
const RIF_DIGITS = 9
const RIF_BODY_DIGITS = 8
const EIN_DIGITS = 9
const EIN_HEAD_DIGITS = 2
const DIGITS_AND_SEPARATORS = /^[\d.\s-]+$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LEADING_LETTER = /^\s*([A-Za-z])\s*-?\s*/

const CEDULA: DocRule = { field: 'cedula', print: 'printCedula', prefixes: ['V', 'E'], prefixLabel: 'prefixCedula', placeholder: '12345678', isOptional: false }
const RIF: DocRule = { field: 'rif', print: 'printRif', prefixes: ['J', 'G', 'C', 'V'], prefixLabel: 'prefixRif', placeholder: '12345678-9', isOptional: false }
const EIN: DocRule = { field: 'ein', print: 'printEin', prefixes: [], prefixLabel: null, placeholder: '12-3456789', isOptional: true }
const ID_NUMBER: DocRule = { field: 'idNumber', print: 'printIdNumber', prefixes: [], prefixLabel: null, placeholder: '', isOptional: true }
const TAX_ID: DocRule = { field: 'taxId', print: 'printTaxId', prefixes: [], prefixLabel: null, placeholder: '', isOptional: true }

/** The ID a requester gives in their country, or null where none is asked for (a person in the United States). */
export function docRule(kind: RequesterKind, country: RequesterCountry): DocRule | null {
  const isCompany = kind === 'company'
  if (country === 'VE') return isCompany ? RIF : CEDULA
  if (country === 'US') return isCompany ? EIN : null
  return isCompany ? TAX_ID : ID_NUMBER
}

/** A stored requester's letter fits its ID: none without an ID or a picker, one of the country's letters otherwise. */
function fitsRule(r: { kind: RequesterKind; country: RequesterCountry; docPrefix: string; doc: string }): boolean {
  const rule = docRule(r.kind, r.country)
  if (!rule) return r.doc === '' && r.docPrefix === ''
  if (rule.prefixes.length === 0 || r.doc === '') return r.docPrefix === ''
  return rule.prefixes.includes(r.docPrefix)
}

const text = (max: number) => z.string().trim().max(max)

export const RequesterSchema = z.object({
  kind: z.enum(REQUESTER_KINDS),
  country: z.enum(REQUESTER_COUNTRIES),
  name: text(REQUESTER_MAX.name).min(1),
  contact: text(REQUESTER_MAX.contact),
  docPrefix: z.string().max(1),
  doc: text(REQUESTER_MAX.doc),
  phone: text(REQUESTER_MAX.phone),
  email: text(REQUESTER_MAX.email),
  address: text(REQUESTER_MAX.address),
}).refine(fitsRule, { message: 'The ID does not fit the requester kind and country', path: ['doc'] })

/** Also the form's draft: same fields, which may be blank or untrimmed until `normalizeRequester`. */
export type Requester = z.infer<typeof RequesterSchema>

const firstPrefix = (kind: RequesterKind, country: RequesterCountry): string => docRule(kind, country)?.prefixes[0] ?? ''

export function emptyRequester(country: RequesterCountry): Requester {
  return { kind: 'person', country, name: '', contact: '', docPrefix: firstPrefix('person', country), doc: '', phone: '', email: '', address: '' }
}

export function defaultCountry(locale: Locale): RequesterCountry {
  return locale === 'es' ? 'VE' : 'US'
}

/** A new kind asks for a different ID, so the letter resets and the number clears. */
export function withKind(d: Requester, kind: RequesterKind): Requester {
  return d.kind === kind ? d : { ...d, kind, docPrefix: firstPrefix(kind, d.country), doc: '' }
}

export function withCountry(d: Requester, country: RequesterCountry): Requester {
  return d.country === country ? d : { ...d, country, docPrefix: firstPrefix(d.kind, country), doc: '' }
}

/** The number field as typed. A leading letter the country uses ("J-4012…", pasted whole) moves into the letter picker. */
export function withDocInput(d: Requester, raw: string): Requester {
  const prefixes = docRule(d.kind, d.country)?.prefixes ?? []
  const match = raw.match(LEADING_LETTER)
  const letter = match?.[1]?.toUpperCase()
  if (match && letter && prefixes.includes(letter)) return { ...d, docPrefix: letter, doc: raw.slice(match[0].length) }
  return { ...d, doc: raw }
}

export type RequesterError = 'errName' | 'errCedula' | 'errRif' | 'errEin' | 'errEmail'
export type RequesterErrors = Partial<Record<'name' | 'doc' | 'email', RequesterError>>

const digitsOf = (s: string): string => s.replace(/\D/g, '')

function docError(rule: DocRule | null, raw: string): RequesterError | null {
  if (!rule || raw === '') return null
  const isNumeric = DIGITS_AND_SEPARATORS.test(raw)
  const count = digitsOf(raw).length
  if (rule.field === 'cedula') return isNumeric && count >= CEDULA_DIGITS.min && count <= CEDULA_DIGITS.max ? null : 'errCedula'
  if (rule.field === 'rif') return isNumeric && count === RIF_DIGITS ? null : 'errRif'
  if (rule.field === 'ein') return isNumeric && count === EIN_DIGITS ? null : 'errEin'
  return null
}

/** Field errors as dictionary keys; an empty object means the draft can be saved. */
export function validateRequester(d: Requester): RequesterErrors {
  const name = d.name.trim() ? null : 'errName'
  const doc = docError(docRule(d.kind, d.country), d.doc.trim())
  const email = d.email.trim() && !EMAIL.test(d.email.trim()) ? 'errEmail' : null
  return { ...(name ? { name } : {}), ...(doc ? { doc } : {}), ...(email ? { email } : {}) }
}

/** The requester as stored: trimmed, the contact only for a company, the ID only where the country asks for one. Null while invalid. */
export function normalizeRequester(d: Requester): Requester | null {
  if (Object.keys(validateRequester(d)).length > 0) return null
  const rule = docRule(d.kind, d.country)
  const doc = rule ? d.doc.trim() : ''
  const parsed = RequesterSchema.safeParse({
    ...d,
    contact: d.kind === 'company' ? d.contact : '',
    doc,
    docPrefix: doc && rule && rule.prefixes.length > 0 ? d.docPrefix : '',
  })
  return parsed.success ? parsed.data : null
}

/** The ID as the sheet prints it: "V-18.456.789", "J-40123456-7", "12-3456789", or other countries' text as typed. */
export function formatDoc(r: Requester): { label: DocPrintKey; value: string } | null {
  const rule = docRule(r.kind, r.country)
  const raw = r.doc.trim()
  if (!rule || !raw) return null
  const digits = digitsOf(raw)
  if (rule.field === 'cedula') return { label: rule.print, value: `${r.docPrefix}-${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` }
  if (rule.field === 'rif') {
    const number = digits.length === RIF_DIGITS ? `${digits.slice(0, RIF_BODY_DIGITS)}-${digits.slice(RIF_BODY_DIGITS)}` : digits
    return { label: rule.print, value: `${r.docPrefix}-${number}` }
  }
  if (rule.field === 'ein') return { label: rule.print, value: digits.length === EIN_DIGITS ? `${digits.slice(0, EIN_HEAD_DIGITS)}-${digits.slice(EIN_HEAD_DIGITS)}` : raw }
  return { label: rule.print, value: raw }
}

export type RequesterLineLabel = 'nameCompany' | 'namePerson' | DocPrintKey | 'contact' | 'phone' | 'email' | 'address'
/** One cell of the sheet's requester band; `label` is a `t.requester` key, `width` its share of the 3-column grid. */
export interface RequesterLine { label: RequesterLineLabel; value: string; width: 'normal' | 'double' | 'full' }

export function requesterLines(r: Requester): RequesterLine[] {
  const doc = formatDoc(r)
  const lines: Array<RequesterLine | null> = [
    { label: r.kind === 'company' ? 'nameCompany' : 'namePerson', value: r.name, width: 'double' },
    doc ? { label: doc.label, value: doc.value, width: 'normal' } : null,
    r.kind === 'company' && r.contact ? { label: 'contact', value: r.contact, width: 'normal' } : null,
    r.phone ? { label: 'phone', value: r.phone, width: 'normal' } : null,
    r.email ? { label: 'email', value: r.email, width: 'normal' } : null,
    r.address ? { label: 'address', value: r.address, width: 'full' } : null,
  ]
  return lines.filter((l): l is RequesterLine => l !== null)
}

/** Two letters for the card's badge, from the first two words longer than two letters ("de", "C.A." are skipped). */
export function requesterInitials(name: string): string {
  const words = name.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter((w) => w.length > 2)
  const initials = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return initials || name.trim().charAt(0).toUpperCase() || '·'
}
