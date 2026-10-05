import { describe, expect, test } from 'vitest'
import {
  REQUESTER_MAX, RequesterSchema, defaultCountry, docRule, emptyRequester, formatDoc, normalizeRequester, requesterInitials, toDraft,
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

describe('editing a requester saved without an ID', () => {
  const savedPerson = normalizeRequester({ ...emptyRequester('VE'), name: 'Ana' })!
  const savedCompany = normalizeRequester({ ...emptyRequester('VE'), kind: 'company', docPrefix: 'J', name: 'Acme C.A.' })!

  test('toDraft puts back the letter the picker shows, so a stored blank letter never reaches the form', () => {
    expect(savedPerson.docPrefix).toBe('')
    expect(toDraft(savedPerson).docPrefix).toBe('V')
    expect(toDraft(savedCompany).docPrefix).toBe('J')
    expect(toDraft(company)).toBe(company)
  })
  test('adding a cédula or RIF afterwards saves', () => {
    expect(normalizeRequester(withDocInput(toDraft(savedPerson), '18456789'))).toMatchObject({ docPrefix: 'V', doc: '18456789' })
    expect(normalizeRequester(withDocInput(toDraft(savedCompany), '401234567'))).toMatchObject({ docPrefix: 'J', doc: '401234567' })
  })
  test('normalize falls back to the first letter when a draft has none, instead of failing silently', () => {
    expect(normalizeRequester(withDocInput(savedPerson, '18456789'))?.docPrefix).toBe('V')
  })
})
