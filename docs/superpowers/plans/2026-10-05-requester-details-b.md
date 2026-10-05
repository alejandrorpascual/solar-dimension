# Requester Details on the Spec Sheet (Variant B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people add who is asking for the kit (name, cédula/RIF/EIN, contact details) from the Download panel, and print it as a "Datos del solicitante" band on the PDF/PNG spec sheet.

**Architecture:** A pure `src/lib/requester.ts` module owns the requester shape, the per-country ID rules, validation, normalization and the lines the sheet prints. `Project` gains a nullable `requester`, which syncs to the account through a new nullable `jsonb` column. The UI is a card in `DownloadPanel` that opens a react-aria dialog (`RequesterSheet`). `KitSheet` renders the band from `requesterLines()`. A "use in my other projects" copy lives in `localStorage` and only prefills the form.

**Tech Stack:** React 19, TanStack Start (server functions), react-aria-components (Modal/Dialog), zod 4, Drizzle ORM + Neon Postgres, Vitest (node, `src/**/*.test.ts`), Playwright (desktop + phone projects), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-10-05-requester-details-b-design.md` (design canvas: https://claude.ai/artifact/85pxKokpPDZ3GDQUQ5ug9U, board B).

## Global Constraints

- **Never run `npm run db:migrate` locally.** `drizzle.config.ts` loads `.env.local`, which points at **production**. Vercel runs the migration on deploy (`vercel.json` buildCommand). The e2e branch is migrated only with the guarded command in Task 5.
- The worktree needs `.env.local` and `.env.test.local` symlinked from the main checkout before e2e: `ln -s ../../../.env.local .env.local && ln -s ../../../.env.test.local .env.test.local` (run at the worktree root).
- Every string the UI shows comes from the dictionaries. `en` and `es` must have the same keys (`src/i18n/i18n.test.ts` enforces it).
- Immutable updates only: return new objects, never mutate arguments or state.
- Vitest runs in `node` with no DOM. Components are covered by Playwright, pure logic by Vitest. Coverage on `src/lib` and `src/i18n` stays ≥ 80% (`npm run test:coverage`).
- Text limits (chars): name 120, contact 80, ID 40, phone 40, email 120, address 160. Every input gets `maxLength` from `REQUESTER_MAX`.
- Only the name is required. The ID is printed only where the country asks for one.
- Commit messages: `<type>: <description>`, with no attribution lines.
- Do not push, open a PR or merge without the user's explicit OK.

## Review Focus

1. **Pasting a full ID with its letter** ("J-40123456-7") into the number field: the letter moves into the letter picker and the number keeps the rest. Tested in Task 1 (`withDocInput`) and Task 7 (e2e fill).
2. **A stored requester that no longer parses** (hand-edited localStorage, a future schema change): the projects still load and only the requester becomes `null`. Tested in Task 2.
3. **Text longer than the limits:** inputs cap at `REQUESTER_MAX`, so Save never fails silently on a schema error. Tested in Task 1 (`normalizeRequester` returns null past the limit) and Task 7 (e2e: a 200-char name stays at 120).
4. **Switching country or kind after typing an ID:** the ID is cleared, so a cédula never prints under "EIN", and a US person stores no ID. Tested in Task 1 (`withCountry`, `withKind`, `normalizeRequester`).
5. **The dialog opened from inside the phone rail sheet** (nested modal): Escape closes only the dialog, and the rail sheet with "Add client details" stays. Tested in Task 7 (the e2e runs on the `phone` project too).

---

### Task 1: Requester model

**Files:**
- Create: `src/lib/requester.ts`
- Test: `src/lib/requester.test.ts`

**Interfaces:**
- Consumes: `Locale` type from `src/i18n/types.ts`.
- Produces (used by Tasks 2–7):
  - `REQUESTER_KINDS`, `REQUESTER_COUNTRIES`, `REQUESTER_MAX`
  - types `RequesterKind`, `RequesterCountry`, `Requester`, `DocRule`, `DocField`, `DocPrintKey`, `RequesterError`, `RequesterErrors`, `RequesterLine`, `RequesterLineLabel`
  - `RequesterSchema` (zod)
  - `docRule(kind, country): DocRule | null`
  - `emptyRequester(country): Requester`
  - `defaultCountry(locale): RequesterCountry`
  - `withKind(d, kind): Requester`, `withCountry(d, country): Requester`, `withDocInput(d, raw): Requester`
  - `validateRequester(d): RequesterErrors`, `normalizeRequester(d): Requester | null`
  - `formatDoc(r): { label: DocPrintKey; value: string } | null`
  - `requesterLines(r): RequesterLine[]`
  - `requesterInitials(name): string`

- [ ] **Step 1: Write the failing tests**

`src/lib/requester.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  REQUESTER_MAX, RequesterSchema, defaultCountry, docRule, emptyRequester, formatDoc, normalizeRequester, requesterInitials,
  requesterLines, validateRequester, withCountry, withDocInput, withKind, type Requester,
} from './requester'

const company: Requester = {
  kind: 'company', country: 'VE', name: 'Junta de Condominio Res. Los Samanes', contact: 'Luis Pérez',
  docPrefix: 'J', doc: '401234567', phone: '+58 414 555 0192', email: 'admin@lossamanes.com', address: 'La Trinidad, Caracas',
}
const person: Requester = { ...emptyRequester('VE'), name: 'María Rondón', docPrefix: 'V', doc: '18456789' }

describe('docRule', () => {
  test('asks a Venezuelan person for a cédula and a Venezuelan company for a RIF', () => {
    expect(docRule('person', 'VE')).toMatchObject({ field: 'cedula', print: 'printCedula', prefixes: ['V', 'E'], isOptional: false })
    expect(docRule('company', 'VE')).toMatchObject({ field: 'rif', print: 'printRif', prefixes: ['J', 'G', 'C', 'V'], isOptional: false })
  })
  test('asks nothing of a person in the United States and an optional EIN of a company', () => {
    expect(docRule('person', 'US')).toBeNull()
    expect(docRule('company', 'US')).toMatchObject({ field: 'ein', prefixes: [], isOptional: true })
  })
  test('takes optional free text in other countries', () => {
    expect(docRule('person', 'OTHER')).toMatchObject({ field: 'idNumber', prefixes: [], isOptional: true })
    expect(docRule('company', 'OTHER')).toMatchObject({ field: 'taxId', prefixes: [], isOptional: true })
  })
})

describe('emptyRequester and defaultCountry', () => {
  test('starts as a person with the first letter the country uses', () => {
    expect(emptyRequester('VE')).toEqual({ kind: 'person', country: 'VE', name: '', contact: '', docPrefix: 'V', doc: '', phone: '', email: '', address: '' })
    expect(emptyRequester('US').docPrefix).toBe('')
  })
  test('defaults to Venezuela in Spanish and the United States in English', () => {
    expect(defaultCountry('es')).toBe('VE')
    expect(defaultCountry('en')).toBe('US')
  })
})

describe('withKind and withCountry', () => {
  test('switching kind picks the new first letter and clears the number', () => {
    expect(withKind(person, 'company')).toMatchObject({ kind: 'company', docPrefix: 'J', doc: '' })
  })
  test('switching country clears an ID the new country reads differently', () => {
    expect(withCountry(person, 'US')).toMatchObject({ country: 'US', docPrefix: '', doc: '' })
    expect(withCountry(company, 'OTHER')).toMatchObject({ country: 'OTHER', docPrefix: '', doc: '' })
  })
  test('returns the same draft when nothing changes, and never edits the one passed in', () => {
    expect(withKind(person, 'person')).toBe(person)
    expect(withCountry(person, 'VE')).toBe(person)
    withKind(person, 'company')
    expect(person.kind).toBe('person')
  })
})

describe('withDocInput', () => {
  test('moves a pasted letter the country uses into the letter picker', () => {
    expect(withDocInput(company, 'g-20000001-5')).toMatchObject({ docPrefix: 'G', doc: '20000001-5' })
    expect(withDocInput(person, 'E 8456789')).toMatchObject({ docPrefix: 'E', doc: '8456789' })
  })
  test('leaves a letter the country does not use in the number, so validation flags it', () => {
    expect(withDocInput(company, 'X-1')).toMatchObject({ docPrefix: 'J', doc: 'X-1' })
  })
  test('keeps free text as typed where the country uses no letters', () => {
    const other: Requester = { ...emptyRequester('OTHER'), name: 'Ana' }
    expect(withDocInput(other, 'AB-123')).toMatchObject({ docPrefix: '', doc: 'AB-123' })
  })
})

describe('validateRequester', () => {
  test('needs a name and nothing else', () => {
    expect(validateRequester({ ...person, name: '   ' })).toEqual({ name: 'errName' })
    expect(validateRequester({ ...emptyRequester('US'), name: 'Ann Lee' })).toEqual({})
  })
  test('accepts a blank ID and a well-formed cédula with or without dots', () => {
    expect(validateRequester({ ...person, doc: '' })).toEqual({})
    expect(validateRequester({ ...person, doc: '18.456.789' })).toEqual({})
  })
  test('rejects a cédula with too few or too many digits, or letters inside', () => {
    expect(validateRequester({ ...person, doc: '1234' })).toEqual({ doc: 'errCedula' })
    expect(validateRequester({ ...person, doc: '1234567890' })).toEqual({ doc: 'errCedula' })
    expect(validateRequester({ ...person, doc: '18A56789' })).toEqual({ doc: 'errCedula' })
  })
  test('rejects a RIF without its check digit', () => {
    expect(validateRequester({ ...company, doc: '40123456' })).toEqual({ doc: 'errRif' })
    expect(validateRequester({ ...company, doc: '40123456-7' })).toEqual({})
  })
  test('rejects a malformed EIN and email', () => {
    const us: Requester = { ...emptyRequester('US'), kind: 'company', name: 'Acme LLC' }
    expect(validateRequester({ ...us, doc: '12-345' })).toEqual({ doc: 'errEin' })
    expect(validateRequester({ ...us, doc: '12-3456789', email: 'not-an-email' })).toEqual({ email: 'errEmail' })
  })
  test('accepts any text as an ID in other countries', () => {
    expect(validateRequester({ ...emptyRequester('OTHER'), name: 'Ana', doc: 'AB-123' })).toEqual({})
  })
})

describe('normalizeRequester', () => {
  test('trims every field and keeps a valid company as stored', () => {
    expect(normalizeRequester({ ...company, name: `  ${company.name}  `, phone: ' +58 414 555 0192 ' })).toEqual(company)
  })
  test('drops the contact for a person and the letter when the number is blank', () => {
    expect(normalizeRequester({ ...person, contact: 'Someone', doc: '' })).toMatchObject({ contact: '', docPrefix: '', doc: '' })
  })
  test('drops an ID typed before switching to a country that asks for none', () => {
    expect(normalizeRequester({ ...person, country: 'US' })).toMatchObject({ docPrefix: '', doc: '' })
  })
  test('is null while the draft is invalid or past a limit', () => {
    expect(normalizeRequester({ ...person, name: '' })).toBeNull()
    expect(normalizeRequester({ ...person, name: 'x'.repeat(REQUESTER_MAX.name + 1) })).toBeNull()
  })
})

describe('RequesterSchema', () => {
  test('accepts a stored requester and rejects a letter that does not fit the country', () => {
    expect(RequesterSchema.safeParse(company).success).toBe(true)
    expect(RequesterSchema.safeParse({ ...company, country: 'US', doc: '123456789', docPrefix: 'J' }).success).toBe(false)
    expect(RequesterSchema.safeParse({ ...company, docPrefix: '' }).success).toBe(false)
  })
})

describe('formatDoc', () => {
  test('groups a cédula with dots after its letter', () => {
    expect(formatDoc(person)).toEqual({ label: 'printCedula', value: 'V-18.456.789' })
  })
  test('splits the RIF check digit, typed with or without its hyphen', () => {
    expect(formatDoc(company)).toEqual({ label: 'printRif', value: 'J-40123456-7' })
    expect(formatDoc({ ...company, doc: '40123456-7' })?.value).toBe('J-40123456-7')
  })
  test('formats a 9-digit EIN and prints other countries as typed', () => {
    const us: Requester = { ...emptyRequester('US'), kind: 'company', name: 'Acme LLC', doc: '123456789' }
    expect(formatDoc(us)).toEqual({ label: 'printEin', value: '12-3456789' })
    expect(formatDoc({ ...emptyRequester('OTHER'), name: 'Ana', doc: 'AB-123' })).toEqual({ label: 'printIdNumber', value: 'AB-123' })
  })
  test('is null without a number or where no ID is asked for', () => {
    expect(formatDoc({ ...person, doc: '' })).toBeNull()
    expect(formatDoc({ ...person, country: 'US' })).toBeNull()
  })
})

describe('requesterLines', () => {
  test('lists a company with its RIF, contact and address; the name spans two columns, the address the whole row', () => {
    expect(requesterLines(company).map((l) => [l.label, l.value, l.width])).toEqual([
      ['nameCompany', company.name, 'double'],
      ['printRif', 'J-40123456-7', 'normal'],
      ['contact', 'Luis Pérez', 'normal'],
      ['phone', '+58 414 555 0192', 'normal'],
      ['email', 'admin@lossamanes.com', 'normal'],
      ['address', 'La Trinidad, Caracas', 'full'],
    ])
  })
  test('leaves out what a person did not give', () => {
    expect(requesterLines({ ...emptyRequester('US'), name: 'Ann Lee' })).toEqual([{ label: 'namePerson', value: 'Ann Lee', width: 'double' }])
  })
})

test('requesterInitials takes the first letters of the first two real words', () => {
  expect(requesterInitials('Junta de Condominio Res. Los Samanes')).toBe('JC')
  expect(requesterInitials('Ann Lee')).toBe('AL')
  expect(requesterInitials('Al')).toBe('A')
  expect(requesterInitials('  ')).toBe('·')
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/requester.test.ts`
Expected: FAIL. The file `./requester` can't be found.

- [ ] **Step 3: Write the module**

`src/lib/requester.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/requester.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/requester.ts src/lib/requester.test.ts
git commit -m "feat: requester model with per-country ID rules"
```

---

### Task 2: A project carries its requester

**Files:**
- Modify: `src/lib/schema.ts` (`ProjectSchema`)
- Modify: `src/lib/store.ts:18-20` (`newProject`)
- Test: `src/lib/schema.test.ts`, `src/lib/store.test.ts`, `src/lib/sync.test.ts`

**Interfaces:**
- Consumes: `RequesterSchema`, `Requester` from Task 1.
- Produces: `Project['requester']: Requester | null`. Every new project has `requester: null`, and `patchCurrent(store, { requester })` sets it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/schema.test.ts`:

```ts
const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' }

test('a project has no requester until one is added, and keeps a valid one', () => {
  expect(StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' }).projects[0]?.requester).toBeNull()
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, requester }], currentId: 'p1' }).projects[0]?.requester).toEqual(requester)
})

test('an unreadable requester is dropped instead of losing every saved project', () => {
  const parsed = StoreSchema.safeParse({ version: 1, projects: [{ ...project, requester: { name: 42 } }], currentId: 'p1' })
  expect(parsed.success).toBe(true)
  expect(parsed.data?.projects[0]?.requester).toBeNull()
})
```

Append inside the `describe('project store', …)` block of `src/lib/store.test.ts`:

```ts
  test('a new project has no requester, and a duplicate keeps the original's', () => {
    const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' } as const
    const s = patchCurrent(initialStore(), { requester })
    expect(currentProject(initialStore()).requester).toBeNull()
    expect(currentProject(addProject(s)).requester).toBeNull()
    expect(currentProject(duplicateProject(s)).requester).toEqual(requester)
  })
```

Append to `src/lib/sync.test.ts` (add `import { initialStore, patchCurrent } from './store'` at the top if not already imported):

```ts
test('a changed requester makes the project an upsert', () => {
  const before = initialStore().projects
  const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' } as const
  const after = patchCurrent(initialStore(), { requester }).projects
  expect(diffProjects(before, after).upserts.map((p) => p.id)).toEqual([before[0]!.id])
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/schema.test.ts src/lib/store.test.ts src/lib/sync.test.ts`
Expected: FAIL. `requester` is `undefined`, not `null`, and tsc-in-vitest may also report that `requester` is not a key of `Partial<Project>`.

- [ ] **Step 3: Add the field**

In `src/lib/schema.ts`, add `import { RequesterSchema } from './requester'` and add this as the last key of `ProjectSchema` (after `updatedAt`):

```ts
  /**
   * Who asked for the kit, printed on the spec sheet; null until added. A copy that no longer parses becomes null, so
   * one bad field never makes the whole saved store unreadable.
   */
  requester: RequesterSchema.nullable().default(null).catch(null),
```

In `src/lib/store.ts`, change the object `newProject` returns to end with `batteryUnit: null, requester: null, updatedAt`:

```ts
  return { id, name: name ?? `Project ${projects.length + 1}`, qty: { ...DEFAULT_QTY }, custom: [], hours: DEFAULT_HOURS, volts: 48, chemistry: 'lifepo4', batteryUnit: null, requester: null, updatedAt }
```

(`duplicateProject` already spreads `src`, so the copy keeps the requester. The requester object is never mutated, so sharing it is safe.)

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `src/server/projects.ts` `toProject` if TypeScript flags the missing `requester`. If so, leave them for Task 5. Otherwise there are none. Note which one you got in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts src/lib/store.ts src/lib/schema.test.ts src/lib/store.test.ts src/lib/sync.test.ts
git commit -m "feat: projects carry an optional requester"
```

---

### Task 3: Remember the requester on this device

**Files:**
- Modify: `src/lib/persistence.ts`
- Test: `src/lib/persistence.test.ts`

**Interfaces:**
- Consumes: `RequesterSchema`, `Requester` from Task 1.
- Produces:
  - `REQUESTER_KEY = 'solar-dimension.requester.v1'`
  - `loadRememberedRequester(storage?): Requester | null`
  - `rememberRequester(r: Requester, storage?): void`
  - `forgetRequester(storage?): void`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/persistence.test.ts` (extend the import from `./persistence` with `REQUESTER_KEY, forgetRequester, loadRememberedRequester, rememberRequester`):

```ts
const ann = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '+1 305 555 0100', email: '', address: '' } as const

function removableStorage(initial: Record<string, string> = {}) {
  const mem = memoryStorage(initial)
  return { ...mem, removeItem: (k: string) => { delete mem.data[k] } }
}

test('remembers a requester, reads it back, and forgets it', () => {
  const mem = removableStorage()
  rememberRequester(ann, mem)
  expect(loadRememberedRequester(mem)).toEqual(ann)
  forgetRequester(mem)
  expect(loadRememberedRequester(mem)).toBeNull()
})

test('a missing, corrupt or invalid remembered requester reads as none', () => {
  expect(loadRememberedRequester(memoryStorage())).toBeNull()
  expect(loadRememberedRequester(memoryStorage({ [REQUESTER_KEY]: '{not json' }))).toBeNull()
  expect(loadRememberedRequester(memoryStorage({ [REQUESTER_KEY]: JSON.stringify({ ...ann, name: '' }) }))).toBeNull()
})

test('blocked or missing storage never throws', () => {
  const throwing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  expect(loadRememberedRequester(throwing)).toBeNull()
  expect(() => rememberRequester(ann, throwing)).not.toThrow()
  expect(() => forgetRequester(throwing)).not.toThrow()
  expect(loadRememberedRequester(null)).toBeNull()
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/persistence.test.ts`
Expected: FAIL. `rememberRequester` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/persistence.ts`, add `import { RequesterSchema, type Requester } from './requester'` and append:

```ts
/** The requester saved with "use these details in my other projects". This browser only; it fills a blank form, never a project. */
export const REQUESTER_KEY = 'solar-dimension.requester.v1'

export function loadRememberedRequester(storage: Reader | null = browserStorage()): Requester | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(REQUESTER_KEY)
    if (!raw) return null
    const parsed = RequesterSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function rememberRequester(requester: Requester, storage: Writer | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(REQUESTER_KEY, JSON.stringify(requester))
  } catch {
    // Blocked storage: the project still keeps its own copy.
  }
}

export function forgetRequester(storage: Remover | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(REQUESTER_KEY)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/persistence.ts src/lib/persistence.test.ts
git commit -m "feat: remember the last requester on this device"
```

---

### Task 4: Requester copy in both languages, and the privacy page

**Files:**
- Create: `src/i18n/requester-en.ts`, `src/i18n/requester-es.ts`
- Modify: `src/i18n/types.ts` (`Dictionary.requester`, `RequesterKey`, `UiKey` + `'incRequester'`)
- Modify: `src/i18n/en.ts`, `src/i18n/es.ts` (`ui.incRequester`, `requester`, privacy "What we store")
- Modify: `src/routes/privacy.tsx` (`UPDATED`)
- Test: `src/i18n/i18n.test.ts`, `e2e/privacy.spec.ts`

**Interfaces:**
- Consumes: `DocField`, `DocPrintKey`, `RequesterLineLabel`, `RequesterError` from Task 1 (as key lists).
- Produces: `t.requester: Record<RequesterKey, string>` with the keys below, and `t.ui.incRequester`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('dictionaries', …)` block of `src/i18n/i18n.test.ts`:

```ts
  test('es has every requester key that en has, and nothing extra', () => {
    expect(Object.keys(es.requester).sort()).toEqual(Object.keys(en.requester).sort())
  })
  test('every key the requester model and form use has copy in both languages', () => {
    const keys = [
      'cedula', 'rif', 'ein', 'idNumber', 'taxId', 'printCedula', 'printRif', 'printEin', 'printIdNumber', 'printTaxId',
      'prefixCedula', 'prefixRif', 'nameCompany', 'namePerson', 'contact', 'phone', 'email', 'address',
      'countryVE', 'countryUS', 'countryOTHER', 'phonePhVE', 'phonePhUS', 'phonePhOTHER', 'person', 'company',
      'errName', 'errCedula', 'errRif', 'errEin', 'errEmail',
    ] as const
    for (const d of [en, es]) for (const k of keys) expect(d.requester[k]).toBeTruthy()
  })
  test('the privacy page names the requester details in both languages', () => {
    expect(en.privacy.sections[0]?.body).toContain('client details for the spec sheet')
    expect(es.privacy.sections[0]?.body).toContain('datos del solicitante para la ficha')
  })
```

In `e2e/privacy.spec.ts`, inside the first test, after the `We don't sell or share your data` assertion, add:

```ts
  await expect(page.getByText('client details for the spec sheet', { exact: false })).toBeVisible()
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/i18n/i18n.test.ts`
Expected: FAIL. `es.requester` is undefined.

- [ ] **Step 3: Add the dictionaries**

`src/i18n/requester-en.ts`:

```ts
export const requesterEn = {
  section: 'Client',
  add: 'Add client details',
  addHint: 'Name, ID and phone for the spec sheet',
  edit: 'Edit',
  sheetTitle: 'Client details',
  sheetHelp: 'They go at the top of the spec sheet, for the installer.',
  close: 'Close',
  kindLabel: 'Client type',
  person: 'Individual',
  company: 'Company',
  country: 'Country',
  countryVE: 'Venezuela',
  countryUS: 'United States',
  countryOTHER: 'Other country',
  namePerson: 'Full name',
  nameCompany: 'Business name',
  namePersonHint: 'As it appears on the ID',
  nameCompanyHint: 'Company or condo board',
  contact: 'Contact person',
  contactHint: 'Who meets the installer',
  cedula: 'Cédula (ID card)',
  rif: 'RIF (tax ID)',
  ein: 'EIN',
  idNumber: 'ID number',
  taxId: 'Tax ID',
  prefixCedula: 'Nationality',
  prefixRif: 'RIF type',
  optional: '(optional)',
  noIdUS: 'In the United States no ID is needed. A name and a contact are enough.',
  phone: 'Phone',
  phonePhVE: '+58 412 000 0000',
  phonePhUS: '+1 305 000 0000',
  phonePhOTHER: '+ country code and number',
  email: 'Email',
  address: 'Installation address',
  addressHint: 'Street, city',
  remember: 'Use these details in my other projects',
  save: 'Save',
  remove: 'Remove',
  errName: 'Enter a name.',
  errCedula: 'A cédula has 5 to 9 digits.',
  errRif: 'A RIF has 8 digits and a check digit, like 12345678-9.',
  errEin: 'An EIN has 9 digits, like 12-3456789.',
  errEmail: 'Check the email address.',
  bandTitle: 'Client details',
  printCedula: 'C.I.',
  printRif: 'RIF',
  printEin: 'EIN',
  printIdNumber: 'ID',
  printTaxId: 'Tax ID',
}
```

`src/i18n/requester-es.ts`:

```ts
import type { RequesterKey } from './types'

export const requesterEs: Record<RequesterKey, string> = {
  section: 'Solicitante',
  add: 'Añadir solicitante',
  addHint: 'Nombre, documento y teléfono para la ficha',
  edit: 'Editar',
  sheetTitle: 'Datos del solicitante',
  sheetHelp: 'Salen arriba de la ficha, para el instalador.',
  close: 'Cerrar',
  kindLabel: 'Tipo de solicitante',
  person: 'Persona',
  company: 'Empresa',
  country: 'País',
  countryVE: 'Venezuela',
  countryUS: 'Estados Unidos',
  countryOTHER: 'Otro país',
  namePerson: 'Nombre y apellido',
  nameCompany: 'Razón social',
  namePersonHint: 'Como aparece en la cédula',
  nameCompanyHint: 'Empresa o junta de condominio',
  contact: 'Persona de contacto',
  contactHint: 'Quién atiende al instalador',
  cedula: 'Cédula de identidad',
  rif: 'RIF',
  ein: 'EIN',
  idNumber: 'Documento de identidad',
  taxId: 'Registro fiscal',
  prefixCedula: 'Nacionalidad',
  prefixRif: 'Tipo de RIF',
  optional: '(opcional)',
  noIdUS: 'En Estados Unidos no hace falta un documento de identidad. El nombre y un contacto bastan.',
  phone: 'Teléfono',
  phonePhVE: '+58 412 000 0000',
  phonePhUS: '+1 305 000 0000',
  phonePhOTHER: '+ código de país y número',
  email: 'Correo',
  address: 'Dirección de la instalación',
  addressHint: 'Urbanización, calle, ciudad',
  remember: 'Usar estos datos en mis otros proyectos',
  save: 'Guardar',
  remove: 'Quitar',
  errName: 'Escribe un nombre.',
  errCedula: 'La cédula lleva de 5 a 9 números.',
  errRif: 'El RIF lleva 8 números y el dígito verificador, como 12345678-9.',
  errEin: 'El EIN lleva 9 números, como 12-3456789.',
  errEmail: 'Revisa el correo.',
  bandTitle: 'Datos del solicitante',
  printCedula: 'C.I.',
  printRif: 'RIF',
  printEin: 'EIN',
  printIdNumber: 'Documento',
  printTaxId: 'Registro fiscal',
}
```

In `src/i18n/types.ts`:
- add `import type { requesterEn } from './requester-en'`
- add `requester: Record<RequesterKey, string>` to `Dictionary` (after `quoteItemsList`)
- add `export type RequesterKey = keyof typeof requesterEn` (next to `QuoteKey`)
- in `UiKey`, change `| 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes'` to `| 'incSummary' | 'incAppliances' | 'incParts' | 'incNotes' | 'incRequester'`

In `src/i18n/index.ts`, change the type re-export to `export type { Dictionary, LegalPage, Locale, QuoteKey, RequesterKey, UiKey } from './types'`.

In `src/i18n/en.ts`:
- add `import { requesterEn } from './requester-en'`
- in `ui`, after `incNotes: 'Assumptions',` add `incRequester: 'Client details',`
- add `requester: requesterEn,` next to `quotes: quotesEn,`
- replace the "What we store" body with:

```ts
      { heading: 'What we store', body: 'Your email and name, and, if you sign in with Google, your Google account ID. We also store the projects you save: appliances, hours, voltage and battery choices, and, if you add them, the client details for the spec sheet (name, ID number, phone, email and address). If you tick "Use these details in my other projects", a copy of those details also stays in this browser. If you upload installer quotes, we store the files and the prices and items we read from them.' },
```

In `src/i18n/es.ts`:
- add `import { requesterEs } from './requester-es'`
- in `ui`, after `incNotes: 'Supuestos',` add `incRequester: 'Datos del solicitante',`
- add `requester: requesterEs,` next to `quotes: quotesEs,`
- replace the "Qué guardamos" body with:

```ts
      { heading: 'Qué guardamos', body: 'Tu correo y tu nombre y, si inicias sesión con Google, el identificador de tu cuenta de Google. También guardamos los proyectos que guardes: aparatos, horas, voltaje y elección de baterías y, si los añades, los datos del solicitante para la ficha (nombre, número de documento, teléfono, correo y dirección). Si marcas "Usar estos datos en mis otros proyectos", una copia de esos datos también queda en este navegador. Si subes cotizaciones de instaladores, guardamos los archivos y los precios y componentes que leemos de ellos.' },
```

In `src/routes/privacy.tsx`, set `const UPDATED = new Date(2026, 9, 5)` (use the actual day you make this change, month 0-based).

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/i18n && npx tsc --noEmit`
Expected: PASS, with no type errors except, possibly, `toProject` from Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/i18n src/routes/privacy.tsx e2e/privacy.spec.ts
git commit -m "feat: requester copy in English and Spanish; privacy lists requester details"
```

---

### Task 5: Store the requester with the account

**Files:**
- Modify: `src/db/schema.ts` (`projects` table)
- Modify: `src/server/projects.ts` (`toProject`, `upsertAll`)
- Create: `drizzle/0010_project_requester.sql` (+ `drizzle/meta/0010_snapshot.json`, `drizzle/meta/_journal.json`, all generated)
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `Requester` type (Task 1), `Project.requester` (Task 2).
- Produces: `projects.requester` (nullable `jsonb`). `listProjects`, `saveProjects` and `importProjects` round-trip `requester`.

- [ ] **Step 1: Link the env files into the worktree (once)**

Run at the worktree root:

```bash
ln -s ../../../.env.local .env.local && ln -s ../../../.env.test.local .env.test.local
```

Expected: both links exist (`ls -la .env.local .env.test.local`).

- [ ] **Step 2: Write the failing test**

In `src/db/schema.test.ts`, change the first test's expected list to include `requester`:

```ts
  expect(cols).toEqual(['batteryUnit', 'chemistry', 'createdAt', 'custom', 'hours', 'id', 'name', 'qty', 'requester', 'updatedAt', 'userId', 'volts'])
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL. `requester` is missing from the columns.

- [ ] **Step 4: Add the column and round-trip it**

In `src/db/schema.ts`, add `import type { Requester } from '../lib/requester'` and, in `projects`, after `batteryUnit`:

```ts
    /** Who asked for the kit (printed on the spec sheet); null until added. Validated by RequesterSchema on read. */
    requester: jsonb('requester').$type<Requester>(),
```

In `src/server/projects.ts`, in `toProject`, add `requester: row.requester,` after `batteryUnit: row.batteryUnit,`. In `upsertAll`'s `set`, add after `batteryUnit`:

```ts
        requester: sql`excluded.requester`,
```

(The `values(list.map((p) => ({ ...p, … })))` already carries `requester`.)

- [ ] **Step 5: Generate the migration (offline, touches no database)**

Run: `npx drizzle-kit generate --name project_requester`
Expected: a new `drizzle/0010_project_requester.sql` containing exactly:

```sql
ALTER TABLE "projects" ADD COLUMN "requester" jsonb;
```

plus an updated `drizzle/meta/_journal.json` and a new `drizzle/meta/0010_snapshot.json`. If the SQL differs (for example a NOT NULL or a default), stop and fix the schema; don't hand-edit the SQL.

- [ ] **Step 6: Apply it to the e2e branch only (guarded)**

Run at the worktree root:

```bash
node --input-type=module -e "
import { loadTestEnv } from './e2e/test-env.ts'
loadTestEnv()
const { neon } = await import('@neondatabase/serverless')
const { drizzle } = await import('drizzle-orm/neon-http')
const { migrate } = await import('drizzle-orm/neon-http/migrator')
await migrate(drizzle({ client: neon(process.env.DATABASE_URL) }), { migrationsFolder: './drizzle' })
console.log('e2e branch migrated')
"
```

Expected: `e2e branch migrated`. `loadTestEnv()` throws before any write if `DATABASE_URL` is production or the same database as `.env.local`. **Do not** run `npm run db:migrate`.

- [ ] **Step 7: Run unit tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts src/server/projects.ts drizzle
git commit -m "feat: save the requester with the account's projects"
```

---

### Task 6: Requester band on the spec sheet, and its Include box

**Files:**
- Modify: `src/components/KitSheet.tsx`
- Modify: `src/components/DownloadPanel.tsx` (`INCLUDES`, initial `include`, `KitSheet` prop)
- Modify: `src/styles/rail.css` (append the band styles after the `.ksheet__fine` rule)
- Create: `e2e/requester.spec.ts`

**Interfaces:**
- Consumes: `requesterLines`, `Requester` (Task 1), `Project.requester` (Task 2), `t.requester`, `t.ui.incRequester` (Task 4).
- Produces:
  - `ExportInclude` gains `requester: boolean`.
  - `KitSheet` takes a `requester: Requester | null` prop.
  - e2e helper `seedRequester(page)` and fixture `LOS_SAMANES` in `e2e/requester.spec.ts`, reused by Task 7.

- [ ] **Step 1: Write the failing e2e test**

`e2e/requester.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { showDownload } from './projects'

const STORAGE_KEY = 'solar-dimension.projects.v1'
const LOS_SAMANES = {
  kind: 'company', country: 'VE', name: 'Junta de Condominio Res. Los Samanes', contact: 'Luis Pérez',
  docPrefix: 'J', doc: '401234567', phone: '+58 414 555 0192', email: '', address: 'La Trinidad, Caracas',
}

/** Opens the app with one saved project that already has a requester. Later reloads keep whatever the test changed. */
async function seedRequester(page: Page): Promise<void> {
  await page.addInitScript(([key, requester]) => {
    if (localStorage.getItem(key)) return
    const project = { id: 'p1', name: 'Garita', qty: { fridge: 1, lights: 1 }, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, updatedAt: 1, requester }
    localStorage.setItem(key, JSON.stringify({ version: 1, projects: [project], currentId: 'p1' }))
  }, [STORAGE_KEY, LOS_SAMANES] as const)
}

test('the spec sheet prints the requester band, and Include takes it off', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=3')
  await showDownload(page)
  const band = page.locator('.ksheet__client')
  await expect(band.getByText('Client details')).toBeVisible()
  await expect(band.getByText('Company · Venezuela')).toBeVisible()
  await expect(band.getByText('J-40123456-7')).toBeVisible()
  await expect(band.getByText('Luis Pérez')).toBeVisible()
  await expect(band.getByText('La Trinidad, Caracas')).toBeVisible()

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  const bytes = await readFile((await pdf.path())!)
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1)

  await page.getByRole('checkbox', { name: 'Client details' }).uncheck()
  await expect(band).toHaveCount(0)
  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  await expect(page.getByRole('checkbox', { name: 'Client details' })).toBeDisabled()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/requester.spec.ts --project=desktop`
Expected: FAIL. `.ksheet__client` is not found.

- [ ] **Step 3: Render the band in `KitSheet`**

In `src/components/KitSheet.tsx`:
- add `import { requesterLines, type Requester } from '../lib/requester'`
- change `export interface ExportInclude { summary: boolean; appliances: boolean; parts: boolean; notes: boolean }` to `export interface ExportInclude { summary: boolean; appliances: boolean; parts: boolean; notes: boolean; requester: boolean }`
- add `requester: Requester | null` to `Props` (after `parts`), and destructure it: `export function KitSheet({ projectName, result: r, parts, requester, include, date, t, locale, ref }: Props)`
- insert right after the closing `</header>`:

```tsx
      {requester && (
        <section className="ksheet__client" data-pdf-block="">
          <div className="ksheet__client-head">
            <h3 className="ksheet__h">{t.requester.bandTitle}</h3>
            <span className="ksheet__lab">{`${t.requester[requester.kind]} · ${t.requester[`country${requester.country}`]}`}</span>
          </div>
          <dl className="ksheet__client-grid">
            {requesterLines(requester).map((line) => (
              <div key={line.label} className={`ksheet__client-cell ksheet__client-cell--${line.width}`}>
                <dt className="ksheet__lab">{t.requester[line.label]}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
```

The parent decides whether to pass a requester, so `include.requester` isn't read inside `KitSheet`.

- [ ] **Step 4: Wire the Include box in `DownloadPanel`**

In `src/components/DownloadPanel.tsx`:
- change the `INCLUDES` type's `label` union to `'incSummary' | 'incAppliances' | 'incParts' | 'incNotes' | 'incRequester'`, and append the row `{ key: 'requester', label: 'incRequester', inCsv: false },`
- change the initial include state to `useState<ExportInclude>({ summary: true, appliances: true, parts: true, notes: true, requester: true })`
- pass the requester to the sheet: in the `<KitSheet …/>` element add `requester={include.requester ? project.requester : null}`

- [ ] **Step 5: Style the band**

Append to `src/styles/rail.css` after `.ksheet__fine`:

```css
/* The requester band: who asked for the kit, between the header and the summary figures. */
.ksheet__client { display: flex; flex-direction: column; gap: 12px; margin-top: -6px; }
.ksheet__client-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.ksheet__client-head .ksheet__h { margin-bottom: 0; }
.ksheet__client-grid { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 24px; padding: 16px 20px; background: var(--ground); border-radius: 10px; }
.ksheet__client-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ksheet__client-cell--double { grid-column: span 2; }
.ksheet__client-cell--full { grid-column: 1 / -1; }
.ksheet__client-cell .ksheet__lab { font-size: 10px; }
.ksheet__client-cell dd { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 6: Fix the one call site the type change breaks**

`src/routes/index.tsx` doesn't construct `ExportInclude`, so nothing changes there. Run `npm run typecheck`. Expected: no errors.

- [ ] **Step 7: Run the e2e and watch it pass on both viewports**

Run: `npx playwright test e2e/requester.spec.ts e2e/download.spec.ts`
Expected: PASS on `desktop` and `phone`. The existing download tests still pass, and the PDF is still one page.

- [ ] **Step 8: Commit**

```bash
git add src/components/KitSheet.tsx src/components/DownloadPanel.tsx src/styles/rail.css e2e/requester.spec.ts
git commit -m "feat: print the requester band on the spec sheet"
```

---

### Task 7: Requester card and form in the Download panel

**Files:**
- Create: `src/components/RequesterCard.tsx`
- Create: `src/components/RequesterSheet.tsx`
- Modify: `src/components/DownloadPanel.tsx` (props, card, sheet)
- Modify: `src/routes/index.tsx:57` (pass `onRequesterChange`)
- Modify: `src/styles/rail.css` (append the card and form styles)
- Test: `e2e/requester.spec.ts` (append)

**Interfaces:**
- Consumes:
  - Task 1: `REQUESTER_KINDS`, `REQUESTER_COUNTRIES`, `REQUESTER_MAX`, `docRule`, `emptyRequester`, `defaultCountry`, `withKind`, `withCountry`, `withDocInput`, `validateRequester`, `normalizeRequester`, `formatDoc`, `requesterInitials`
  - Task 3: `loadRememberedRequester`, `rememberRequester`, `forgetRequester`
  - Task 4: `t.requester.*`
  - Task 6: `seedRequester` and `LOS_SAMANES` in the e2e file
- Produces:
  - `DownloadPanel` props become `{ project: Project; result: SizingResult; onRequesterChange: (requester: Requester | null) => void }`
  - `RequesterCard({ requester, isDisabled, onOpen })`
  - `RequesterSheet({ isOpen, onOpenChange, requester, onSave, onRemove })`

- [ ] **Step 1: Write the failing e2e tests**

Append to `e2e/requester.spec.ts` (add `hideProjects, showProjects` to the `./projects` import):

```ts
async function openForm(page: Page) {
  await page.getByRole('button', { name: /^Add client details/ }).click()
  return page.getByRole('dialog', { name: 'Client details' })
}

test('a client added in the Download panel prints on the sheet and stays after a reload', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  await form.getByLabel('Business name').fill('Junta de Condominio Res. Los Samanes')
  await form.getByLabel('RIF (tax ID)').fill('J-40123456-7')
  await expect(form.getByLabel('RIF type')).toHaveValue('J')
  await expect(form.getByLabel('RIF (tax ID)')).toHaveValue('40123456-7')
  await form.getByLabel('Phone').fill('+58 414 555 0192')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(page.locator('.ksheet__client').getByText('J-40123456-7')).toBeVisible()
  await expect(page.getByText('RIF J-40123456-7 · +58 414 555 0192')).toBeVisible()

  await page.reload()
  await showDownload(page)
  await expect(page.getByRole('button', { name: 'Edit: Junta de Condominio Res. Los Samanes' })).toBeVisible()
})

test('the form explains a bad RIF, caps long text, and Escape closes only the form', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByRole('button', { name: 'Company' }).click()
  await form.getByLabel('Country').selectOption('VE')
  await form.getByLabel('Business name').fill('x'.repeat(200))
  await expect(form.getByLabel('Business name')).toHaveValue('x'.repeat(120))
  await form.getByLabel('RIF (tax ID)').fill('4012345')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeVisible()
  await expect(form.getByLabel('RIF (tax ID)')).toHaveAttribute('aria-invalid', 'true')
  await form.getByLabel('RIF (tax ID)').fill('401234567')
  await expect(form.getByText('A RIF has 8 digits and a check digit, like 12345678-9.')).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
  await expect(page.locator('.ksheet__client')).toHaveCount(0)
})

test('a person in the United States is not asked for an ID', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await expect(form.getByLabel('Country')).toHaveValue('US')
  await expect(form.getByText('In the United States no ID is needed.', { exact: false })).toBeVisible()
  await form.getByRole('button', { name: 'Company' }).click()
  await expect(form.getByLabel('EIN')).toBeVisible()
})

test('saved details fill the form of a new project when "use in my other projects" is on', async ({ page }) => {
  await page.goto('/?step=3')
  await showDownload(page)
  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await expect(form.getByRole('checkbox', { name: 'Use these details in my other projects' })).toBeChecked()
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()

  await hideProjects(page)
  await showProjects(page)
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  await showDownload(page)
  const next = await openForm(page)
  await expect(next.getByLabel('Full name')).toHaveValue('Ann Lee')
})

test('Remove takes the client off this project', async ({ page }) => {
  await seedRequester(page)
  await page.goto('/?step=3')
  await showDownload(page)
  await page.getByRole('button', { name: `Edit: ${LOS_SAMANES.name}` }).click()
  await page.getByRole('dialog', { name: 'Client details' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.locator('.ksheet__client')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Add client details/ })).toBeVisible()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx playwright test e2e/requester.spec.ts --project=desktop`
Expected: the Task 6 test passes; the five new ones FAIL because there's no "Add client details" button.

- [ ] **Step 3: Write the card**

`src/components/RequesterCard.tsx`:

```tsx
import { Plus } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { formatDoc, requesterInitials, type Requester } from '../lib/requester'

interface Props { requester: Requester | null; isDisabled: boolean; onOpen: () => void }

/** Who the spec sheet is for: an add button until there is a requester, then their name, ID and phone with Edit. */
export function RequesterCard({ requester, isDisabled, onOpen }: Props) {
  const { t } = useLocale()
  if (!requester) {
    return (
      <button type="button" className="rq-add" disabled={isDisabled} onClick={onOpen}>
        <span className="rq-mark rq-mark--add" aria-hidden="true"><Plus size={20} /></span>
        <span className="rq-text"><strong>{t.requester.add}</strong><span className="rq-text__sub">{t.requester.addHint}</span></span>
      </button>
    )
  }
  const doc = formatDoc(requester)
  const sub = [doc ? `${t.requester[doc.label]} ${doc.value}` : t.requester[requester.kind], requester.phone].filter(Boolean).join(' · ')
  return (
    <div className="rq-card">
      <span className="rq-mark" aria-hidden="true">{requesterInitials(requester.name)}</span>
      <span className="rq-text"><strong>{requester.name}</strong><span className="rq-text__sub">{sub}</span></span>
      <button type="button" className="btn rq-card__edit" disabled={isDisabled} aria-label={`${t.requester.edit}: ${requester.name}`} onClick={onOpen}>
        {t.requester.edit}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Write the form dialog**

`src/components/RequesterSheet.tsx`:

```tsx
import { X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { forgetRequester, loadRememberedRequester, rememberRequester } from '../lib/persistence'
import {
  REQUESTER_COUNTRIES, REQUESTER_KINDS, REQUESTER_MAX, defaultCountry, docRule, emptyRequester, normalizeRequester,
  validateRequester, withCountry, withDocInput, withKind, type Requester,
} from '../lib/requester'

interface Props {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The open project's requester; null opens the one remembered on this device, or a blank form. */
  requester: Requester | null
  onSave: (requester: Requester) => void
  onRemove: () => void
}

/** The requester's details in a dialog (a bottom sheet on phones). Nothing reaches the project until Save. */
export function RequesterSheet({ isOpen, onOpenChange, requester, onSave, onRemove }: Props) {
  const { t } = useLocale()
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <button type="button" className="qdialog__close" aria-label={t.requester.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              <Heading slot="title" className="qdialog__title">{t.requester.sheetTitle}</Heading>
              <p className="qdialog__text">{t.requester.sheetHelp}</p>
              <RequesterForm
                initial={requester}
                onSave={(saved) => { onSave(saved); close() }}
                onRemove={requester ? () => { onRemove(); close() } : null}
              />
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function Field({ id, label, isOptional = false, error, children }: { id: string; label: string; isOptional?: boolean; error?: string; children: ReactNode }) {
  const { t } = useLocale()
  return (
    <div className="rq-field">
      <label className="rq-field__label" htmlFor={id}>
        {label}
        {isOptional && <span className="rq-field__opt"> {t.requester.optional}</span>}
      </label>
      {children}
      {error && <span className="rq-err" id={`${id}-err`}>{error}</span>}
    </div>
  )
}

/** Mounted each time the dialog opens, so the draft starts from the saved requester every time. */
function RequesterForm({ initial, onSave, onRemove }: { initial: Requester | null; onSave: (r: Requester) => void; onRemove: (() => void) | null }) {
  const { t, locale } = useLocale()
  const id = useId()
  const [draft, setDraft] = useState<Requester>(() => initial ?? loadRememberedRequester() ?? emptyRequester(defaultCountry(locale)))
  const [shouldRemember, setRemember] = useState(true)
  const [hasTriedSave, setTriedSave] = useState(false)
  // Errors appear after the first Save attempt, then follow the typing.
  const errors = hasTriedSave ? validateRequester(draft) : {}
  const rule = docRule(draft.kind, draft.country)
  const isCompany = draft.kind === 'company'
  const ids = { country: `${id}-country`, name: `${id}-name`, contact: `${id}-contact`, doc: `${id}-doc`, phone: `${id}-phone`, email: `${id}-email`, address: `${id}-address` }
  const invalid = (field: 'name' | 'doc' | 'email', inputId: string) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${inputId}-err` } : {}

  const save = () => {
    setTriedSave(true)
    const clean = normalizeRequester(draft)
    if (!clean) return
    if (shouldRemember) rememberRequester(clean)
    else forgetRequester()
    onSave(clean)
  }

  return (
    <form className="rq-form" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
      <div className="rq-kinds" role="group" aria-label={t.requester.kindLabel}>
        {REQUESTER_KINDS.map((kind) => (
          <button key={kind} type="button" className={`seg${draft.kind === kind ? ' seg--on' : ''}`} aria-pressed={draft.kind === kind} onClick={() => setDraft(withKind(draft, kind))}>
            {t.requester[kind]}
          </button>
        ))}
      </div>

      <Field id={ids.country} label={t.requester.country}>
        <select
          id={ids.country}
          className="in"
          value={draft.country}
          onChange={(e) => setDraft(withCountry(draft, REQUESTER_COUNTRIES.find((c) => c === e.target.value) ?? draft.country))}
        >
          {REQUESTER_COUNTRIES.map((c) => <option key={c} value={c}>{t.requester[`country${c}`]}</option>)}
        </select>
      </Field>

      <Field id={ids.name} label={isCompany ? t.requester.nameCompany : t.requester.namePerson} error={errors.name && t.requester[errors.name]}>
        <input
          id={ids.name} className="in" type="text" maxLength={REQUESTER_MAX.name} autoComplete={isCompany ? 'organization' : 'name'}
          placeholder={isCompany ? t.requester.nameCompanyHint : t.requester.namePersonHint}
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} {...invalid('name', ids.name)}
        />
      </Field>

      {isCompany && (
        <Field id={ids.contact} label={t.requester.contact} isOptional>
          <input
            id={ids.contact} className="in" type="text" maxLength={REQUESTER_MAX.contact} autoComplete="name" placeholder={t.requester.contactHint}
            value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
          />
        </Field>
      )}

      {rule === null && <p className="rq-note">{t.requester.noIdUS}</p>}
      {rule && (
        <Field id={ids.doc} label={t.requester[rule.field]} isOptional={rule.isOptional} error={errors.doc && t.requester[errors.doc]}>
          <div className={rule.prefixLabel ? 'rq-doc' : undefined}>
            {rule.prefixLabel && (
              <select className="in" aria-label={t.requester[rule.prefixLabel]} value={draft.docPrefix} onChange={(e) => setDraft({ ...draft, docPrefix: e.target.value })}>
                {rule.prefixes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <input
              id={ids.doc} className="in" type="text" maxLength={REQUESTER_MAX.doc} inputMode={rule.prefixLabel ? 'numeric' : 'text'}
              placeholder={rule.placeholder} value={draft.doc} onChange={(e) => setDraft(withDocInput(draft, e.target.value))} {...invalid('doc', ids.doc)}
            />
          </div>
        </Field>
      )}

      <Field id={ids.phone} label={t.requester.phone}>
        <input
          id={ids.phone} className="in" type="tel" maxLength={REQUESTER_MAX.phone} autoComplete="tel" placeholder={t.requester[`phonePh${draft.country}`]}
          value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
      </Field>
      <Field id={ids.email} label={t.requester.email} isOptional error={errors.email && t.requester[errors.email]}>
        <input
          id={ids.email} className="in" type="email" maxLength={REQUESTER_MAX.email} autoComplete="email"
          value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} {...invalid('email', ids.email)}
        />
      </Field>
      <Field id={ids.address} label={t.requester.address} isOptional>
        <input
          id={ids.address} className="in" type="text" maxLength={REQUESTER_MAX.address} autoComplete="street-address" placeholder={t.requester.addressHint}
          value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
      </Field>

      <label className="dl__check">
        <input type="checkbox" checked={shouldRemember} onChange={() => setRemember(!shouldRemember)} />
        {t.requester.remember}
      </label>
      <div className="qdialog__actions">
        {onRemove && <button type="button" className="btn" onClick={onRemove}>{t.requester.remove}</button>}
        <button type="submit" className="btn btn--primary">{t.requester.save}</button>
      </div>
    </form>
  )
}
```

- [ ] **Step 5: Put the card and the dialog in the Download panel**

In `src/components/DownloadPanel.tsx`:
- add the imports `import type { Requester } from '../lib/requester'`, `import { RequesterCard } from './RequesterCard'` and `import { RequesterSheet } from './RequesterSheet'`
- change the signature to:

```tsx
export function DownloadPanel({ project, result, onRequesterChange }: { project: Project; result: SizingResult; onRequesterChange: (requester: Requester | null) => void }) {
```

- add `const [isRequesterOpen, setRequesterOpen] = useState(false)` and `const requesterLabelId = useId()` next to the other state
- insert between the preview `</div>` and the Format `<fieldset>`:

```tsx
      <section className="dl__group" aria-labelledby={requesterLabelId}>
        <span className="lab" id={requesterLabelId}>{t.requester.section}</span>
        <RequesterCard requester={project.requester} isDisabled={isBusy} onOpen={() => setRequesterOpen(true)} />
      </section>
      <RequesterSheet
        isOpen={isRequesterOpen}
        onOpenChange={setRequesterOpen}
        requester={project.requester}
        onSave={onRequesterChange}
        onRemove={() => onRequesterChange(null)}
      />
```

In `src/routes/index.tsx`:
- add `import { patchCurrent } from '../lib/store'`
- change the `download:` entry of `rail` to:

```tsx
download: <DownloadPanel project={project} result={result} onRequesterChange={(requester) => commit(patchCurrent(store, { requester }))} />
```

- [ ] **Step 6: Style the card and the form**

Append to `src/styles/rail.css`:

```css
/* The requester in the Download panel: an add button or a card; the form reuses the .qdialog dialog. */
.rq-add { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 68px; padding: 12px 14px; border: 1.5px dashed var(--line-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: border-color 120ms, background 120ms; }
.rq-add:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-tint); }
.rq-add:disabled { opacity: 0.55; cursor: default; }
.rq-add:focus-visible, .rq-card__edit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rq-card { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border: 1.5px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.rq-card__edit { flex: 0 0 auto; min-height: var(--tap); padding: 0 14px; font-size: 14px; border-color: var(--line-strong); }
.rq-mark { display: inline-grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; background: var(--accent-tint); color: var(--accent); font-family: var(--font-display); font-size: 15px; font-weight: 700; }
.rq-mark--add { background: var(--ground); }
.rq-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.rq-text strong { font-size: 14px; line-height: 1.3; }
.rq-text strong, .rq-text__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rq-text__sub { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.rq-form { display: flex; flex-direction: column; gap: 14px; }
.rq-kinds { display: flex; gap: 8px; }
.rq-field { display: flex; flex-direction: column; gap: 6px; }
.rq-field__label { font-size: 13px; font-weight: 600; }
.rq-field__opt { font-weight: 400; color: var(--muted); }
.rq-doc { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
.rq-err { font-size: 12px; color: var(--error); }
.rq-note { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--ground); font-size: 13px; line-height: 1.4; color: var(--muted); }
.in[aria-invalid='true'] { border-color: var(--error); }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors. In particular, `t.requester[\`country${c}\`]` and `t.requester[\`phonePh${draft.country}\`]` resolve to keys from Task 4.

- [ ] **Step 8: Run the e2e and watch it pass on both viewports**

Run: `npx playwright test e2e/requester.spec.ts e2e/download.spec.ts`
Expected: PASS on `desktop` and `phone`. On `phone`, the Escape test proves the rail sheet survives closing the form.

- [ ] **Step 9: Look at it**

Start the dev server with the preview tool (`preview_start`; add a `.claude/launch.json` entry `{ "name": "dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }` if none exists). Open `/?step=3`, then Download. Add a Venezuelan company and screenshot the card and the sheet. Switch the language to Spanish, open Editar, and screenshot the dialog at phone width (375×812). Compare with board B on the canvas: the card layout, the band under the header, and the bottom sheet on phone.

- [ ] **Step 10: Commit**

```bash
git add src/components/RequesterCard.tsx src/components/RequesterSheet.tsx src/components/DownloadPanel.tsx src/routes/index.tsx src/styles/rail.css e2e/requester.spec.ts
git commit -m "feat: add and edit the requester from the Download panel"
```

---

### Task 8: The requester comes back from the account

**Files:**
- Test: `e2e/requester.spec.ts` (append)

**Interfaces:**
- Consumes: Task 5's column and server round trip, and Task 7's UI.
- Produces: proof that `saveProjects` → `listProjects` keeps `requester`.

- [ ] **Step 1: Write the test**

Append to `e2e/requester.spec.ts`:

```ts
test('a signed-in client comes back from the account on a fresh browser', async ({ page }) => {
  const email = `e2e-req-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'correct-horse-battery'
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await page.goto('/?step=3')
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  await showDownload(page)

  const form = await openForm(page)
  await form.getByLabel('Full name').fill('Ann Lee')
  await form.getByRole('checkbox', { name: 'Use these details in my other projects' }).uncheck()
  const saved = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'POST' && r.ok())
  await form.getByRole('button', { name: 'Save' }).click()
  await saved

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  await page.goto('/?step=3')
  await expect(page.getByText('Syncing your projects…')).toBeHidden()
  await showDownload(page)
  await expect(page.getByRole('button', { name: 'Edit: Ann Lee' })).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/requester.spec.ts -g "comes back from the account"`
Expected: PASS on both viewports. If it fails with the card showing "Add client details", check that `upsertAll`'s `set` has `requester: sql\`excluded.requester\`` and that `toProject` maps `row.requester` (Task 5).

- [ ] **Step 3: Commit**

```bash
git add e2e/requester.spec.ts
git commit -m "test: the requester survives a round trip through the account"
```

---

### Task 9: Whole-branch verification

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm run test:coverage && npx playwright test`
Expected: no type errors; every unit test passes, with coverage ≥ 80% on lines, functions, statements and branches; every e2e test passes on `desktop` and `phone`.

- [ ] **Step 2: Review**

Dispatch a code reviewer on `git diff main...HEAD`. Ask it to check the Review Focus list above, the server upsert (`requester` in `set`), the privacy copy, and that no personal data reaches logs. `DownloadPanel`'s `console.error` logs only the format, the project id and the error. Fix CRITICAL and HIGH findings, re-run Step 1, and commit the fixes as `fix: …`.

- [ ] **Step 3: Hand back**

Report what was built, with the Task 7 screenshots. Stop there: pushing, the PR and the production migration (which runs on Vercel's build) wait for the user's OK.
